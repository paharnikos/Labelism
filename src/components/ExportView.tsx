import { useMemo, useState } from 'react';
import { Download, Copy, Check, Upload, FileJson } from 'lucide-react';
import type { DatasetImage, Project, SplitType } from '../types/annotation';
import {
  exportProjectBackup,
  exportToCOCO,
  exportToCSV,
  exportToJSONL,
  filterImagesForExport,
  type ExportOptions,
} from '../utils/exporters';

type ExportFormat = 'coco' | 'jsonl' | 'csv' | 'backup';

interface ExportViewProps {
  project: Project;
  images: DatasetImage[];
  onImportAnnotationsJson: (rawJson: string) => void;
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
    id: 'backup',
    name: 'Reticle Project Backup',
    ext: 'reticle-backup.json',
    mime: 'application/json',
    desc: 'Full portable project schema including taxonomy colors, hotkeys, captions, and all geometry records.',
  },
];

export default function ExportView({
  project,
  images,
  onImportAnnotationsJson,
}: ExportViewProps) {
  const [format, setFormat] = useState<ExportFormat>('coco');
  const [splits, setSplits] = useState<SplitType[]>(['train', 'val', 'test']);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [includeAiSuggestions, setIncludeAiSuggestions] = useState(false);
  const [copied, setCopied] = useState(false);

  const options: ExportOptions = useMemo(
    () => ({ splits, verifiedOnly, includeAiSuggestions }),
    [splits, verifiedOnly, includeAiSuggestions]
  );

  const matchedImages = useMemo(
    () => filterImagesForExport(images, options),
    [images, options]
  );

  const payload = useMemo(() => {
    if (format === 'coco') return exportToCOCO(project, images, options);
    if (format === 'jsonl') return exportToJSONL(project, images, options);
    if (format === 'csv') return exportToCSV(project, images, options);
    return exportProjectBackup(project, images);
  }, [format, project, images, options]);

  const activeFormatMeta = FORMATS.find((f) => f.id === format)!;
  const byteSize = new Blob([payload]).size;
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

  const handleDownload = () => {
    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const blob = new Blob([payload], { type: activeFormatMeta.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'reticle'}_${activeFormatMeta.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0D10] p-6">
      <div className="max-w-[1320px] mx-auto space-y-6">
        <div className="border-b border-[#232834] pb-5">
          <h1 className="text-xl font-semibold text-[#E8ECF2] tracking-tight">
            Export &amp; Import Dataset
          </h1>
          <p className="text-xs text-[#8B95A5] mt-1">
            Generate training-ready COCO JSON, VLM JSONL, or CSV tables, or import existing COCO
            annotations onto matching images.
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
                        <span className="text-xs font-semibold text-[#E8ECF2]">{f.name}</span>
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
            </section>
          </div>

          {/* Right Live Preview Column */}
          <section className="lg:col-span-7 bg-[#12151B] border border-[#232834] rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-[#232834] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#E8ECF2]">
                  Live Payload Preview — {activeFormatMeta.name}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#8B95A5] mt-0.5">
                  {format === 'backup' ? images.length : matchedImages.length} images · {sizeLabel}
                </div>
              </div>

              <div className="flex items-center gap-2">
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
        </div>
      </div>
    </div>
  );
}
