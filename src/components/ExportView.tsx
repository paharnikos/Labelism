import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Copy,
  Check,
  Upload,
  FileJson,
  HardDrive,
  Archive,
  Loader2,
  AlertCircle,
  Scissors,
  Layers,
  Image as ImageIcon,
  Square,
} from 'lucide-react';
import type { DatasetImage, Project, SplitType, ToastMessage } from '../types/annotation';
import {
  exportProjectBackup,
  exportToCOCO,
  exportToCSV,
  exportToJSONL,
  filterImagesForExport,
  type ExportOptions,
} from '../utils/exporters';
import {
  collectMaskExportItems,
  generateObjectMasksZip,
  renderMaskPreviewSamples,
  type MaskExportConfig,
  type MaskFolderStructure,
  type MaskOutputMode,
  type MaskPreviewSample,
  type MaskShapeFilter,
  type MaskZipProgress,
} from '../utils/maskExporter';

type ExportFormat = 'coco' | 'jsonl' | 'csv' | 'masks_zip' | 'backup';

interface ExportViewProps {
  project: Project;
  images: DatasetImage[];
  imageUrls: Record<string, string>;
  onImportAnnotationsJson: (rawJson: string) => void;
  onOpenDriveBrowse: () => void;
  onOpenDriveUpload: () => void;
  onNotify?: (text: string, tone?: ToastMessage['tone']) => void;
}

const FORMATS: Array<{
  id: ExportFormat;
  name: string;
  ext: string;
  mime: string;
  desc: string;
}> = [
  {
    id: 'coco',
    name: 'COCO JSON',
    ext: 'coco.json',
    mime: 'application/json',
    desc: 'Standard COCO categories (supercategory = Class, name = Object), bboxes, polygon segmentations, areas, polylines, and captions.',
  },
  {
    id: 'jsonl',
    name: 'JSONL (VLM / Multimodal)',
    ext: 'dataset.jsonl',
    mime: 'application/x-ndjson',
    desc: 'One JSON record per image with captions, short captions, tags, splits, and normalized hierarchical Class/Object annotations.',
  },
  {
    id: 'csv',
    name: 'CSV Table',
    ext: 'captions.csv',
    mime: 'text/csv',
    desc: 'Spreadsheet-ready RFC-4180 table of filenames, dimensions, splits, captions, tags, and class:object summary counts.',
  },
  {
    id: 'masks_zip',
    name: 'Cropped Object Masks (ZIP)',
    ext: 'masks.zip',
    mime: 'application/zip',
    desc: 'ZIP archive of individual cropped PNG masks or transparent cutouts for every polygon and bounding box annotation, plus manifest.json.',
  },
  {
    id: 'backup',
    name: 'Reticle Project Backup',
    ext: 'reticle-backup.json',
    mime: 'application/json',
    desc: 'Full portable project schema including taxonomy colors, hotkeys, captions, and all geometry records.',
  },
];

const MASK_MODES: Array<{ id: MaskOutputMode; title: string; sub: string }> = [
  {
    id: 'binary_mask',
    title: 'Binary Masks (B&W)',
    sub: 'White object silhouette on black PNG',
  },
  {
    id: 'alpha_cutout',
    title: 'Transparent Cutouts',
    sub: 'Cropped RGBA object with alpha mask',
  },
  {
    id: 'paired_crop_and_mask',
    title: 'Paired RGB + Mask',
    sub: 'Both RGB crop & aligned binary mask',
  },
];

const PADDING_PRESETS = [0, 4, 8, 16, 32];

export default function ExportView({
  project,
  images,
  imageUrls,
  onImportAnnotationsJson,
  onOpenDriveBrowse,
  onOpenDriveUpload,
  onNotify,
}: ExportViewProps) {
  const [format, setFormat] = useState<ExportFormat>('coco');
  const [splits, setSplits] = useState<SplitType[]>(['train', 'val', 'test']);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [includeAiSuggestions, setIncludeAiSuggestions] = useState(false);
  const [copied, setCopied] = useState(false);

  // Cropped Object Masks ZIP config
  const [maskMode, setMaskMode] = useState<MaskOutputMode>('binary_mask');
  const [maskShapeFilter, setMaskShapeFilter] = useState<MaskShapeFilter>('both');
  const [maskPaddingPx, setMaskPaddingPx] = useState<number>(0);
  const [maskFolderStructure, setMaskFolderStructure] =
    useState<MaskFolderStructure>('by_class');
  const [includeManifest, setIncludeManifest] = useState<boolean>(true);

  const [previewSamples, setPreviewSamples] = useState<MaskPreviewSample[]>([]);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [generatingZip, setGeneratingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState<MaskZipProgress | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const zipAbortRef = useRef<AbortController | null>(null);

  const options: ExportOptions = useMemo(
    () => ({ splits, verifiedOnly, includeAiSuggestions }),
    [splits, verifiedOnly, includeAiSuggestions]
  );

  const maskConfig: MaskExportConfig = useMemo(
    () => ({
      mode: maskMode,
      shapeFilter: maskShapeFilter,
      paddingPx: maskPaddingPx,
      folderStructure: maskFolderStructure,
      includeManifest,
    }),
    [maskMode, maskShapeFilter, maskPaddingPx, maskFolderStructure, includeManifest]
  );

  const matchedImages = useMemo(
    () => filterImagesForExport(images, options),
    [images, options]
  );

  const maskItems = useMemo(
    () => collectMaskExportItems(images, project.classes, options, maskConfig),
    [images, project.classes, options, maskConfig]
  );

  const maskStats = useMemo(() => {
    let polygons = 0;
    let bboxes = 0;
    const imgSet = new Set<string>();
    for (const item of maskItems) {
      imgSet.add(item.image.id);
      if (item.annotation.type === 'polygon') polygons += 1;
      else bboxes += 1;
    }
    const perObjFiles = maskMode === 'paired_crop_and_mask' ? 2 : 1;
    const totalFiles =
      maskItems.length * perObjFiles + (maskItems.length > 0 && includeManifest ? 1 : 0);
    return {
      polygons,
      bboxes,
      imageCount: imgSet.size,
      totalFiles,
    };
  }, [maskItems, maskMode, includeManifest]);

  // Render live sample thumbnails when Cropped Object Masks format is active
  useEffect(() => {
    if (format !== 'masks_zip') return;
    let cancelled = false;
    setLoadingPreviews(true);
    setZipError(null);

    void renderMaskPreviewSamples(maskItems, imageUrls, maskMode, 6)
      .then((samples) => {
        if (!cancelled) setPreviewSamples(samples);
      })
      .catch(() => {
        if (!cancelled) setPreviewSamples([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreviews(false);
      });

    return () => {
      cancelled = true;
    };
  }, [format, maskItems, imageUrls, maskMode]);

  const payload = useMemo(() => {
    if (format === 'masks_zip') return '';
    if (format === 'coco') return exportToCOCO(project, images, options);
    if (format === 'jsonl') return exportToJSONL(project, images, options);
    if (format === 'csv') return exportToCSV(project, images, options);
    return exportProjectBackup(project, images);
  }, [format, project, images, options]);

  const activeFormatMeta = FORMATS.find((f) => f.id === format)!;
  const byteSize = format === 'masks_zip' ? 0 : new Blob([payload]).size;
  const sizeLabel =
    byteSize > 1024 * 1024
      ? `${(byteSize / (1024 * 1024)).toFixed(2)} MB`
      : `${(byteSize / 1024).toFixed(1)} KB`;

  const toggleSplit = (sp: SplitType) => {
    setSplits((prev) =>
      prev.includes(sp)
        ? prev.length > 1
          ? prev.filter((x) => x !== sp)
          : prev
        : [...prev, sp]
    );
  };

  const getProjectSlug = () =>
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'reticle';

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    if (format === 'masks_zip') {
      void handleGenerateMasksZip();
      return;
    }
    const blob = new Blob([payload], { type: activeFormatMeta.mime });
    triggerBlobDownload(blob, `${getProjectSlug()}_${activeFormatMeta.ext}`);
  };

  const handleGenerateMasksZip = async () => {
    if (maskItems.length === 0 || generatingZip) return;

    zipAbortRef.current?.abort();
    const controller = new AbortController();
    zipAbortRef.current = controller;

    setGeneratingZip(true);
    setZipError(null);
    setZipProgress({ phase: 'rendering', processed: 0, total: maskItems.length });

    try {
      const result = await generateObjectMasksZip({
        project,
        items: maskItems,
        imageUrls,
        config: maskConfig,
        onProgress: setZipProgress,
        signal: controller.signal,
      });

      const modeSuffix =
        maskMode === 'binary_mask'
          ? 'masks'
          : maskMode === 'alpha_cutout'
          ? 'cutouts'
          : 'crops_and_masks';
      triggerBlobDownload(result.blob, `${getProjectSlug()}_${modeSuffix}.zip`);

      const skipNote =
        result.skippedImages > 0 ? ` (${result.skippedImages} image(s) skipped)` : '';
      onNotify?.(
        `Downloaded ZIP with ${result.exportedObjects} cropped object${
          result.exportedObjects === 1 ? '' : 's'
        } (${result.fileCount} files)${skipNote}.`,
        'success'
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        onNotify?.('Mask ZIP generation cancelled.', 'info');
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to generate masks ZIP.';
        setZipError(msg);
      }
    } finally {
      if (zipAbortRef.current === controller) {
        zipAbortRef.current = null;
      }
      setGeneratingZip(false);
      setZipProgress(null);
    }
  };

  const handleCancelMasksZip = () => {
    zipAbortRef.current?.abort();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored silently
    }
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onImportAnnotationsJson(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const progressPct =
    zipProgress && zipProgress.total > 0
      ? Math.round((zipProgress.processed / zipProgress.total) * 100)
      : 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0D10] p-6">
      <div className="max-w-[1320px] mx-auto space-y-6">
        <div className="border-b border-[#232834] pb-5">
          <h1 className="text-xl font-semibold text-[#E8ECF2] tracking-tight">
            Export &amp; Import Dataset
          </h1>
          <p className="text-xs text-[#8B95A5] mt-1">
            Generate training-ready COCO JSON, VLM JSONL, CSV tables, or cropped per-object PNG
            mask ZIP archives, or import existing COCO annotations onto matching images.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Config Column */}
          <div className="lg:col-span-5 space-y-5">
            {/* Format Picker */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-[#E8ECF2]">Export Format</h2>
              <div className="space-y-2">
                {FORMATS.map((f) => {
                  const active = f.id === format;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFormat(f.id)}
                      className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                        active
                          ? 'bg-[#181C24] border-[#38BDF8]'
                          : 'bg-[#12151B] border-[#232834] hover:border-[#323949]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#E8ECF2] flex items-center gap-1.5">
                          {f.id === 'masks_zip' && (
                            <Archive className="w-3.5 h-3.5 text-[#38BDF8]" />
                          )}
                          <span>{f.name}</span>
                        </span>
                        <span className="text-[11px] font-mono text-[#8B95A5]">.{f.ext}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#8B95A5] leading-relaxed">{f.desc}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Export Scope Filters */}
            {format !== 'backup' && (
              <section className="bg-[#12151B] border border-[#232834] rounded-lg p-4 space-y-3.5">
                <h2 className="text-xs font-semibold text-[#E8ECF2]">Filter Scope</h2>
                <div>
                  <span className="block text-[11px] text-[#8B95A5] mb-1.5">Include Splits</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['train', 'val', 'test'] as SplitType[]).map((sp) => {
                      const active = splits.includes(sp);
                      return (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => toggleSplit(sp)}
                          className={`py-1.5 rounded text-xs font-mono uppercase border transition-colors ${
                            active
                              ? 'bg-[#38BDF8]/15 border-[#38BDF8]/50 text-[#38BDF8]'
                              : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5]'
                          }`}
                        >
                          {sp}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-[#CBD5E1] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={verifiedOnly}
                    onChange={(e) => setVerifiedOnly(e.target.checked)}
                    className="accent-[#38BDF8] rounded"
                  />
                  <span>Export verified images only</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-[#CBD5E1] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAiSuggestions}
                    onChange={(e) => setIncludeAiSuggestions(e.target.checked)}
                    className="accent-[#38BDF8] rounded"
                  />
                  <span>Include unreviewed AI box suggestions</span>
                </label>
              </section>
            )}

            {/* Import Existing COCO / Backup JSON */}
            <section className="bg-[#12151B] border border-[#232834] rounded-lg p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-[#38BDF8]" />
                <h2 className="text-xs font-semibold text-[#E8ECF2]">
                  Import COCO JSON or Backup
                </h2>
              </div>
              <p className="text-[11px] text-[#8B95A5] leading-relaxed">
                Reconstructs hierarchical <strong className="text-[#CBD5E1]">Class → Object</strong>{' '}
                pairs from COCO <code className="font-mono text-[#E8ECF2]">supercategory</code> and{' '}
                <code className="font-mono text-[#E8ECF2]">name</code>, matching project images by
                filename.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] cursor-pointer transition-colors">
                  <Upload className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Select JSON File</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImportFile(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={onOpenDriveBrowse}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
                >
                  <HardDrive className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Import from Drive</span>
                </button>
              </div>
            </section>
          </div>

          {/* Right Preview / Mask Builder Column */}
          {format === 'masks_zip' ? (
            <section className="lg:col-span-7 bg-[#12151B] border border-[#232834] rounded-lg overflow-hidden flex flex-col">
              {/* Top Action Header */}
              <div className="px-4 py-3 border-b border-[#232834] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[#E8ECF2] flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>Cropped Object Masks — ZIP Builder</span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#8B95A5] mt-0.5">
                    {maskItems.length} objects ({maskStats.polygons} poly · {maskStats.bboxes} bbox)
                    across {maskStats.imageCount} images · {maskStats.totalFiles} ZIP files
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {generatingZip ? (
                    <button
                      type="button"
                      onClick={handleCancelMasksZip}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#EF4444]/40 text-[#FCA5A5] text-xs font-medium transition-colors"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Cancel</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={maskItems.length === 0}
                      onClick={() => void handleGenerateMasksZip()}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] disabled:opacity-45 text-[#07090C] text-xs font-semibold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Generate &amp; Download .zip</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 space-y-5 bg-[#0B0D10]/60">
                {/* Progress Bar */}
                {generatingZip && zipProgress && (
                  <div className="p-3 rounded-md bg-[#12151B] border border-[#38BDF8]/40 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-[#E8ECF2] font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                        {zipProgress.phase === 'compressing'
                          ? 'Compressing PNG masks into ZIP archive...'
                          : `Rendering cropped object masks (${zipProgress.processed} / ${zipProgress.total})...`}
                      </span>
                      <span className="font-mono tabular-nums text-[#38BDF8]">{progressPct}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#07090C] rounded overflow-hidden">
                      <div
                        className="h-full bg-[#38BDF8] transition-all duration-150"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    {zipProgress.currentFile && zipProgress.phase === 'rendering' && (
                      <div className="text-[11px] font-mono text-[#8B95A5] truncate">
                        Source: {zipProgress.currentFile}
                      </div>
                    )}
                  </div>
                )}

                {zipError && (
                  <div className="p-3 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#FCA5A5] flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
                    <span>{zipError}</span>
                  </div>
                )}

                {/* Output Mode Picker */}
                <div className="space-y-2">
                  <span className="text-[11px] font-medium text-[#8B95A5] block">
                    Mask Output Mode
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {MASK_MODES.map((m) => {
                      const active = maskMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMaskMode(m.id)}
                          className={`text-left p-3 rounded-md border transition-colors ${
                            active
                              ? 'bg-[#181C24] border-[#38BDF8]'
                              : 'bg-[#12151B] border-[#232834] hover:border-[#323949]'
                          }`}
                        >
                          <div className="text-xs font-semibold text-[#E8ECF2] flex items-center gap-1.5">
                            {m.id === 'binary_mask' && (
                              <Layers className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                            )}
                            {m.id === 'alpha_cutout' && (
                              <Scissors className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                            )}
                            {m.id === 'paired_crop_and_mask' && (
                              <ImageIcon className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                            )}
                            <span className="truncate">{m.title}</span>
                          </div>
                          <div className="text-[11px] text-[#8B95A5] mt-1 leading-snug">
                            {m.sub}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Shape Filter, Context Padding, Folder Layout */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-md bg-[#12151B] border border-[#232834] space-y-1.5">
                    <label
                      htmlFor="mask-shape-filter"
                      className="text-[11px] font-medium text-[#8B95A5] block"
                    >
                      Geometry Source
                    </label>
                    <select
                      id="mask-shape-filter"
                      value={maskShapeFilter}
                      onChange={(e) => setMaskShapeFilter(e.target.value as MaskShapeFilter)}
                      className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
                    >
                      <option value="both">Polygons &amp; Boxes</option>
                      <option value="polygon">Polygons Only</option>
                      <option value="bbox">Bounding Boxes Only</option>
                    </select>
                  </div>

                  <div className="p-3 rounded-md bg-[#12151B] border border-[#232834] space-y-1.5">
                    <label
                      htmlFor="mask-folder-layout"
                      className="text-[11px] font-medium text-[#8B95A5] block"
                    >
                      ZIP Folder Structure
                    </label>
                    <select
                      id="mask-folder-layout"
                      value={maskFolderStructure}
                      onChange={(e) =>
                        setMaskFolderStructure(e.target.value as MaskFolderStructure)
                      }
                      className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
                    >
                      <option value="by_class">By Class / Object</option>
                      <option value="by_image">By Source Image</option>
                      <option value="flat">Flat Directory</option>
                    </select>
                  </div>

                  <div className="p-3 rounded-md bg-[#12151B] border border-[#232834] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[#8B95A5]">
                        Crop Padding (px)
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-[#38BDF8]">
                        {maskPaddingPx}px
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {PADDING_PRESETS.map((px) => (
                        <button
                          key={px}
                          type="button"
                          onClick={() => setMaskPaddingPx(px)}
                          className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors ${
                            maskPaddingPx === px
                              ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                              : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                          }`}
                        >
                          {px}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Manifest Toggle + Path Example */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 rounded-md bg-[#12151B] border border-[#232834]">
                  <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeManifest}
                      onChange={(e) => setIncludeManifest(e.target.checked)}
                      className="accent-[#38BDF8] rounded"
                    />
                    <span>
                      Include <code className="font-mono text-[#E8ECF2]">manifest.json</code>{' '}
                      metadata index
                    </span>
                  </label>
                  <span className="text-[11px] font-mono text-[#8B95A5] truncate">
                    {maskFolderStructure === 'by_class' && 'class/object/image_001_poly.png'}
                    {maskFolderStructure === 'by_image' && 'image/class_object_001_poly.png'}
                    {maskFolderStructure === 'flat' && 'image__class__object__001_poly.png'}
                  </span>
                </div>

                {/* Live Cropped Mask Sample Grid */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[#8B95A5]">
                      Live Crop Preview ({Math.min(6, maskItems.length)} of {maskItems.length}{' '}
                      objects)
                    </span>
                    {loadingPreviews && (
                      <span className="flex items-center gap-1 text-[11px] text-[#8B95A5]">
                        <Loader2 className="w-3 h-3 animate-spin text-[#38BDF8]" />
                        <span>Rendering samples…</span>
                      </span>
                    )}
                  </div>

                  {maskItems.length === 0 ? (
                    <div className="p-8 rounded-md bg-[#07090C] border border-[#232834] text-center space-y-1.5">
                      <p className="text-xs font-medium text-[#CBD5E1]">
                        No polygon or bounding box annotations match the selected filters.
                      </p>
                      <p className="text-[11px] text-[#8B95A5]">
                        Draw bounding boxes or polygons in the Annotate tab, or adjust the Filter
                        Scope on the left.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {previewSamples.map((sample) => (
                        <div
                          key={sample.id}
                          className="rounded-md bg-[#12151B] border border-[#232834] overflow-hidden flex flex-col"
                        >
                          <div
                            className={`h-28 flex items-center justify-center p-2 gap-1.5 relative overflow-hidden ${
                              maskMode === 'alpha_cutout'
                                ? 'bg-[#07090C] bg-[radial-gradient(#232834_1px,transparent_1px)] [background-size:10px_10px]'
                                : 'bg-[#07090C]'
                            }`}
                          >
                            <img
                              src={sample.primaryDataUrl}
                              alt={`${sample.className} / ${sample.objectName}`}
                              className={`${
                                sample.secondaryMaskDataUrl ? 'max-w-[48%]' : 'max-w-full'
                              } max-h-full object-contain rounded-xs border border-[#232834]/80`}
                            />
                            {sample.secondaryMaskDataUrl && (
                              <img
                                src={sample.secondaryMaskDataUrl}
                                alt={`${sample.objectName} binary mask`}
                                className="max-w-[48%] max-h-full object-contain rounded-xs border border-[#232834]/80"
                              />
                            )}
                          </div>
                          <div className="px-2.5 py-2 border-t border-[#232834] space-y-0.5">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: sample.color }}
                                />
                                <span className="text-[11px] font-medium text-[#E8ECF2] truncate">
                                  {sample.objectName}
                                </span>
                              </span>
                              <span className="text-[10px] font-mono uppercase text-[#8B95A5] shrink-0">
                                {sample.annotationType === 'polygon' ? 'POLY' : 'BOX'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-[#8B95A5]">
                              <span className="truncate">{sample.className}</span>
                              <span className="shrink-0">
                                {sample.width}×{sample.height}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <section className="lg:col-span-7 bg-[#12151B] border border-[#232834] rounded-lg overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-[#232834] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[#E8ECF2]">
                    Live Payload Preview — {activeFormatMeta.name}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#8B95A5] mt-0.5">
                    {format === 'backup' ? images.length : matchedImages.length} images ·{' '}
                    {sizeLabel}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenDriveUpload}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors"
                  >
                    <HardDrive className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>Save to Drive</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-[#8B95A5]" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .{activeFormatMeta.ext}</span>
                  </button>
                </div>
              </div>

              <pre className="p-4 bg-[#07090C] text-[11px] font-mono text-[#CBD5E1] leading-relaxed overflow-auto max-h-[580px] whitespace-pre">
                {payload.slice(0, 60000)}
                {payload.length > 60000
                  ? '\n\n... [Preview truncated for display — full dataset included in Download]'
                  : ''}
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
