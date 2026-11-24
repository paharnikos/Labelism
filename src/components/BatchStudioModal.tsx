import { useMemo, useRef, useState } from 'react';
import {
  X,
  Crop,
  Maximize,
  Tags,
  FileText,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  Square,
  Plus,
} from 'lucide-react';
import type {
  Annotation,
  CaptionStyle,
  DatasetImage,
  LabelClass,
} from '../types/annotation';
import { clamp, prepareImageForAI, resolveTaxonomy } from '../utils/geometry';
import {
  buildCroppedFileName,
  computeAspectCropRect,
  computeBoundingRectForAnnotations,
  computePercentageInsetCrop,
  computeResizePlan,
  remapAnnotationsForCrop,
  remapAnnotationsForResize,
  renderCroppedImageBlob,
  renderResizedImageBlob,
  type BatchResizeMode,
  type CropAnchor,
  type CropAnnotationMode,
  type CropOutputFormat,
  type CropRect,
  type CropSaveMode,
} from '../utils/crop';

export type BatchTab = 'crop' | 'resize' | 'tags' | 'captions';

export interface BatchImageMediaUpdate {
  imageId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType: CropOutputFormat;
  fileName: string;
  annotations: Annotation[];
  saveMode: CropSaveMode;
  copyMetadata: boolean;
}

export interface BatchImageMetaPatch {
  imageId: string;
  patch: Partial<DatasetImage>;
}

interface BatchStudioModalProps {
  initialTab: BatchTab;
  allImages: DatasetImage[];
  selectedIds: string[];
  filteredIds: string[];
  imageUrls: Record<string, string>;
  classes: LabelClass[];
  onClose: () => void;
  onApplyMediaBatch: (items: BatchImageMediaUpdate[], summaryMessage: string) => Promise<void>;
  onApplyMetaBatch: (patches: BatchImageMetaPatch[], summaryMessage?: string) => Promise<void>;
}

type ScopeMode = 'selected' | 'filtered' | 'all';
type BatchCropStrategy = 'aspect' | 'fit_labels' | 'inset';
type BatchTagMode = 'add' | 'remove' | 'replace' | 'from_labels';
type BatchCaptionMode = 'template' | 'find_replace' | 'ai' | 'clear';
type TemplateApplyMode = 'replace' | 'prepend' | 'append';

const ASPECT_OPTIONS: Array<{ id: string; label: string; ratio: number }> = [
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
];

const RESIZE_PRESETS = [224, 384, 512, 640, 768, 1024];

const PAD_COLORS = [
  { hex: '#000000', label: 'Black' },
  { hex: '#727272', label: 'YOLO Gray' },
  { hex: '#FFFFFF', label: 'White' },
];

function parseTagInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

function interpolateCaptionTemplate(
  template: string,
  img: DatasetImage,
  classes: LabelClass[]
): string {
  const manualAnns = img.annotations.filter((a) => a.source !== 'ai_suggestion');
  const resolved = manualAnns.map((a) => resolveTaxonomy(classes, a.classId, a.objectId));
  const uniqueClasses = Array.from(new Set(resolved.map((r) => r.className)));
  const uniqueObjects = Array.from(new Set(resolved.map((r) => r.objectName)));
  const uniqueFull = Array.from(new Set(resolved.map((r) => r.fullLabel)));
  const baseName = img.fileName.replace(/\.[^/.]+$/, '');

  return template
    .replaceAll('{filename}', baseName)
    .replaceAll('{objects}', uniqueObjects.join(', '))
    .replaceAll('{classes}', uniqueClasses.join(', '))
    .replaceAll('{labels}', uniqueFull.join(', '))
    .replaceAll('{tags}', img.tags.join(', '))
    .replaceAll('{split}', img.split)
    .replaceAll('{count}', String(manualAnns.length))
    .replace(/\s+/g, ' ')
    .trim();
}

export default function BatchStudioModal({
  initialTab,
  allImages,
  selectedIds,
  filteredIds,
  imageUrls,
  classes,
  onClose,
  onApplyMediaBatch,
  onApplyMetaBatch,
}: BatchStudioModalProps) {
  const [tab, setTab] = useState<BatchTab>(initialTab);
  const [scope, setScope] = useState<ScopeMode>(() => {
    if (selectedIds.length > 0) return 'selected';
    if (filteredIds.length > 0 && filteredIds.length < allImages.length) return 'filtered';
    return 'all';
  });

  // --- Batch Crop State ---
  const [cropStrategy, setCropStrategy] = useState<BatchCropStrategy>('aspect');
  const [cropAspectId, setCropAspectId] = useState<string>('1:1');
  const [cropAnchor, setCropAnchor] = useState<CropAnchor>('center');
  const [labelPaddingPct, setLabelPaddingPct] = useState(12);
  const [unlabeledFallback, setUnlabeledFallback] = useState<'skip' | 'center_square'>('skip');
  const [insetTop, setInsetTop] = useState(5);
  const [insetBottom, setInsetBottom] = useState(5);
  const [insetLeft, setInsetLeft] = useState(5);
  const [insetRight, setInsetRight] = useState(5);
  const [cropResizeOut, setCropResizeOut] = useState<'original' | '512' | '640' | '768' | '1024'>(
    'original'
  );
  const [cropFormat, setCropFormat] = useState<CropOutputFormat>('image/jpeg');
  const [cropQuality, setCropQuality] = useState(92);
  const [cropAnnMode, setCropAnnMode] = useState<CropAnnotationMode>('clip');
  const [cropMarkTruncated, setCropMarkTruncated] = useState(true);
  const [cropSaveMode, setCropSaveMode] = useState<CropSaveMode>('new');
  const [cropCopyMeta, setCropCopyMeta] = useState(true);

  // --- Batch Resize State ---
  const [resizeMode, setResizeMode] = useState<BatchResizeMode>('letterbox');
  const [resizeW, setResizeW] = useState(640);
  const [resizeH, setResizeH] = useState(640);
  const [resizeScalePct, setResizeScalePct] = useState(50);
  const [padColor, setPadColor] = useState('#727272');
  const [resizeFormat, setResizeFormat] = useState<CropOutputFormat>('image/jpeg');
  const [resizeQuality, setResizeQuality] = useState(92);
  const [resizeKeepAnns, setResizeKeepAnns] = useState(true);
  const [resizeSaveMode, setResizeSaveMode] = useState<CropSaveMode>('replace');
  const [resizeCopyMeta, setResizeCopyMeta] = useState(true);

  // --- Batch Tags State ---
  const [tagMode, setTagMode] = useState<BatchTagMode>('add');
  const [tagInput, setTagInput] = useState('');
  const [tagsToRemove, setTagsToRemove] = useState<string[]>([]);
  const [autoTagSource, setAutoTagSource] = useState<'objects' | 'classes' | 'both'>('objects');
  const [autoTagLowercase, setAutoTagLowercase] = useState(true);

  // --- Batch Captions State ---
  const [captionMode, setCaptionMode] = useState<BatchCaptionMode>('template');
  const [templateApplyMode, setTemplateApplyMode] = useState<TemplateApplyMode>('replace');
  const [templateText, setTemplateText] = useState('A photo showing {objects}.');
  const [templateSeparator, setTemplateSeparator] = useState(' ');
  const [alsoUpdateShort, setAlsoUpdateShort] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [aiStyle, setAiStyle] = useState<CaptionStyle>('descriptive');
  const [aiSkipExisting, setAiSkipExisting] = useState(true);
  const [aiMergeTags, setAiMergeTags] = useState(true);
  const [clearShortCaption, setClearShortCaption] = useState(true);

  // --- Execution / Progress State ---
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; currentName: string }>({
    done: 0,
    total: 0,
    currentName: '',
  });
  const [errorText, setErrorText] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Target images based on selected scope
  const targetImages = useMemo(() => {
    if (scope === 'selected' && selectedIds.length > 0) {
      const set = new Set(selectedIds);
      return allImages.filter((i) => set.has(i.id));
    }
    if (scope === 'filtered' && filteredIds.length > 0) {
      const set = new Set(filteredIds);
      return allImages.filter((i) => set.has(i.id));
    }
    return allImages;
  }, [scope, selectedIds, filteredIds, allImages]);

  // Existing tags across target images with frequencies (for Remove Tags picker)
  const existingTagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const img of targetImages) {
      for (const t of img.tags) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [targetImages]);

  const computeCropForImage = (img: DatasetImage): CropRect | null => {
    if (cropStrategy === 'aspect') {
      const ratio = ASPECT_OPTIONS.find((a) => a.id === cropAspectId)?.ratio ?? 1;
      return computeAspectCropRect(img.width, img.height, ratio, cropAnchor);
    }
    if (cropStrategy === 'inset') {
      return computePercentageInsetCrop(
        img.width,
        img.height,
        insetTop,
        insetRight,
        insetBottom,
        insetLeft
      );
    }
    // fit_labels
    const manualAnns = img.annotations.filter((a) => a.source !== 'ai_suggestion');
    const box = computeBoundingRectForAnnotations(
      manualAnns.length > 0 ? manualAnns : img.annotations,
      img.width,
      img.height,
      labelPaddingPct
    );
    if (box) return box;
    if (unlabeledFallback === 'center_square') {
      return computeAspectCropRect(img.width, img.height, 1, 'center');
    }
    return null;
  };

  const handleCancelRun = () => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
  };

  // --- Execute Batch Crop ---
  const handleRunBatchCrop = async () => {
    if (targetImages.length === 0) return;
    setRunning(true);
    setErrorText(null);
    cancelRef.current = false;

    const results: BatchImageMediaUpdate[] = [];
    let skipped = 0;

    try {
      for (let i = 0; i < targetImages.length; i++) {
        if (cancelRef.current) break;
        const img = targetImages[i];
        setProgress({ done: i, total: targetImages.length, currentName: img.fileName });

        const src = imageUrls[img.id] || img.seedUrl;
        const rect = computeCropForImage(img);
        if (!src || !rect) {
          skipped += 1;
          continue;
        }

        const outW = cropResizeOut === 'original' ? rect.width : Number(cropResizeOut);
        const outH = cropResizeOut === 'original' ? rect.height : Number(cropResizeOut);

        const rendered = await renderCroppedImageBlob(
          src,
          rect,
          outW,
          outH,
          cropFormat,
          cropQuality
        );
        const remapped = remapAnnotationsForCrop(
          img.annotations,
          rect,
          rendered.width,
          rendered.height,
          cropAnnMode,
          cropMarkTruncated,
          cropSaveMode === 'new'
        );

        results.push({
          imageId: img.id,
          blob: rendered.blob,
          width: rendered.width,
          height: rendered.height,
          mimeType: rendered.mimeType,
          fileName:
            cropSaveMode === 'new'
              ? buildCroppedFileName(img.fileName, rendered.mimeType, 'crop')
              : img.fileName,
          annotations: remapped.annotations,
          saveMode: cropSaveMode,
          copyMetadata: cropCopyMeta,
        });
      }

      setProgress({
        done: targetImages.length,
        total: targetImages.length,
        currentName: 'Saving to IndexedDB...',
      });

      if (results.length === 0) {
        setErrorText(
          skipped > 0
            ? `All ${skipped} images were skipped (no labels found to fit). Try "Center 1:1" fallback.`
            : 'No images were cropped.'
        );
        return;
      }

      const verb = cropSaveMode === 'new' ? 'Created' : 'Cropped';
      const skipNote = skipped > 0 ? ` (${skipped} skipped)` : '';
      await onApplyMediaBatch(
        results,
        `${verb} ${results.length} cropped image${results.length === 1 ? '' : 's'}${skipNote}.`
      );
      onClose();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Batch crop failed.');
    } finally {
      setRunning(false);
    }
  };

  // --- Execute Batch Resize ---
  const handleRunBatchResize = async () => {
    if (targetImages.length === 0) return;
    setRunning(true);
    setErrorText(null);
    cancelRef.current = false;

    const results: BatchImageMediaUpdate[] = [];
    try {
      for (let i = 0; i < targetImages.length; i++) {
        if (cancelRef.current) break;
        const img = targetImages[i];
        setProgress({ done: i, total: targetImages.length, currentName: img.fileName });

        const src = imageUrls[img.id] || img.seedUrl;
        if (!src) continue;

        const plan = computeResizePlan(
          img.width,
          img.height,
          resizeMode,
          resizeW,
          resizeH,
          resizeScalePct
        );
        const rendered = await renderResizedImageBlob(
          src,
          plan,
          resizeFormat,
          resizeQuality,
          padColor
        );
        const remapped = remapAnnotationsForResize(
          img.annotations,
          plan,
          resizeKeepAnns ? 'clip' : 'drop',
          true,
          resizeSaveMode === 'new'
        );

        results.push({
          imageId: img.id,
          blob: rendered.blob,
          width: rendered.width,
          height: rendered.height,
          mimeType: rendered.mimeType,
          fileName:
            resizeSaveMode === 'new'
              ? buildCroppedFileName(
                  img.fileName,
                  rendered.mimeType,
                  `${rendered.width}x${rendered.height}`
                )
              : img.fileName,
          annotations: remapped.annotations,
          saveMode: resizeSaveMode,
          copyMetadata: resizeCopyMeta,
        });
      }

      setProgress({
        done: targetImages.length,
        total: targetImages.length,
        currentName: 'Saving to IndexedDB...',
      });

      if (results.length > 0) {
        const verb = resizeSaveMode === 'new' ? 'Created' : 'Resized';
        await onApplyMediaBatch(
          results,
          `${verb} ${results.length} resized image${results.length === 1 ? '' : 's'} with remapped coordinates.`
        );
        onClose();
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Batch resize failed.');
    } finally {
      setRunning(false);
    }
  };

  // --- Execute Batch Tags ---
  const handleRunBatchTags = async () => {
    if (targetImages.length === 0) return;
    setErrorText(null);
    const parsedInput = parseTagInput(tagInput);

    if (tagMode === 'add' && parsedInput.length === 0) {
      setErrorText('Enter at least one tag to add.');
      return;
    }
    if (tagMode === 'remove' && tagsToRemove.length === 0 && parsedInput.length === 0) {
      setErrorText('Select or enter at least one tag to remove.');
      return;
    }

    setRunning(true);
    try {
      const removeSet = new Set(
        [...tagsToRemove, ...parsedInput].map((t) => t.toLowerCase())
      );

      const patches: BatchImageMetaPatch[] = targetImages.map((img) => {
        let nextTags: string[] = [...img.tags];

        if (tagMode === 'add') {
          const existingLower = new Set(nextTags.map((t) => t.toLowerCase()));
          for (const tag of parsedInput) {
            if (!existingLower.has(tag.toLowerCase())) {
              nextTags.push(tag);
              existingLower.add(tag.toLowerCase());
            }
          }
        } else if (tagMode === 'remove') {
          nextTags = nextTags.filter((t) => !removeSet.has(t.toLowerCase()));
        } else if (tagMode === 'replace') {
          nextTags = [...parsedInput];
        } else if (tagMode === 'from_labels') {
          const derived: string[] = [];
          for (const ann of img.annotations) {
            if (ann.source === 'ai_suggestion') continue;
            const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
            const fmt = (s: string) => (autoTagLowercase ? s.toLowerCase() : s);
            if (autoTagSource === 'objects' || autoTagSource === 'both') {
              derived.push(fmt(tax.objectName));
            }
            if (autoTagSource === 'classes' || autoTagSource === 'both') {
              derived.push(fmt(tax.className));
            }
          }
          const existingLower = new Set(nextTags.map((t) => t.toLowerCase()));
          for (const d of derived) {
            if (!existingLower.has(d.toLowerCase())) {
              nextTags.push(d);
              existingLower.add(d.toLowerCase());
            }
          }
        }

        return { imageId: img.id, patch: { tags: nextTags } };
      });

      const actionLabel =
        tagMode === 'add'
          ? 'Added tags to'
          : tagMode === 'remove'
            ? 'Removed tags from'
            : tagMode === 'replace'
              ? 'Replaced tags on'
              : 'Auto-tagged';

      await onApplyMetaBatch(
        patches,
        `${actionLabel} ${patches.length} image${patches.length === 1 ? '' : 's'}.`
      );
      onClose();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Batch tag update failed.');
    } finally {
      setRunning(false);
    }
  };

  // --- Execute Batch Captions ---
  const handleRunBatchCaptions = async () => {
    if (targetImages.length === 0) return;
    setErrorText(null);

    if (captionMode === 'template' && !templateText.trim()) {
      setErrorText('Enter a caption template or text to apply.');
      return;
    }
    if (captionMode === 'find_replace' && !findText) {
      setErrorText('Enter text to find in existing captions.');
      return;
    }

    setRunning(true);
    cancelRef.current = false;

    try {
      if (captionMode === 'ai') {
        const queue = aiSkipExisting
          ? targetImages.filter((i) => i.caption.trim().length === 0)
          : targetImages;

        if (queue.length === 0) {
          setErrorText(
            'All target images already have captions. Uncheck "Skip images with existing captions" to regenerate.'
          );
          setRunning(false);
          return;
        }

        let completed = 0;
        let failed = 0;

        for (let i = 0; i < queue.length; i++) {
          if (cancelRef.current) break;
          const img = queue[i];
          setProgress({ done: i, total: queue.length, currentName: img.fileName });

          const src = imageUrls[img.id] || img.seedUrl;
          if (!src) {
            failed += 1;
            continue;
          }

          const controller = new AbortController();
          abortControllerRef.current = controller;
          const timeoutId = setTimeout(() => controller.abort(), 45000);

          try {
            const { imageBase64, mimeType } = await prepareImageForAI(src, 768);
            const existingLabels = Array.from(
              new Set(
                img.annotations
                  .filter((a) => a.source !== 'ai_suggestion')
                  .map((a) => resolveTaxonomy(classes, a.classId, a.objectId).fullLabel)
              )
            );

            const res = await fetch('/api/ai/caption', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageBase64,
                mimeType,
                style: aiStyle,
                existingLabels,
              }),
              signal: controller.signal,
            });

            const rawBody = await res.text();
            let data: { caption?: string; shortCaption?: string; tags?: string[]; error?: string };
            try {
              data = JSON.parse(rawBody);
            } catch {
              throw new Error(`Unexpected response from AI backend (HTTP ${res.status}).`);
            }
            if (!res.ok) {
              throw new Error(data.error || `Caption request failed (${res.status}).`);
            }

            const mergedTags =
              aiMergeTags && Array.isArray(data.tags)
                ? Array.from(new Set([...img.tags, ...data.tags]))
                : img.tags;

            // Persist each finished image immediately so partial runs are preserved
            await onApplyMetaBatch([
              {
                imageId: img.id,
                patch: {
                  caption: data.caption ?? img.caption,
                  shortCaption: data.shortCaption || img.shortCaption,
                  tags: mergedTags,
                },
              },
            ]);
            completed += 1;
          } catch (err) {
            if (cancelRef.current) break;
            failed += 1;
            setErrorText(
              `Warning on ${img.fileName}: ${err instanceof Error ? err.message : 'Failed'}`
            );
          } finally {
            clearTimeout(timeoutId);
            if (abortControllerRef.current === controller) {
              abortControllerRef.current = null;
            }
          }
        }

        setProgress({ done: queue.length, total: queue.length, currentName: 'Done' });
        if (completed > 0) {
          await onApplyMetaBatch(
            [],
            `AI captioned ${completed} image${completed === 1 ? '' : 's'}${failed > 0 ? ` (${failed} failed)` : ''}.`
          );
          if (failed === 0 && !cancelRef.current) onClose();
        }
        return;
      }

      // Synchronous local caption transforms (template, find_replace, clear)
      const patches: BatchImageMetaPatch[] = targetImages.map((img) => {
        if (captionMode === 'clear') {
          return {
            imageId: img.id,
            patch: {
              caption: '',
              ...(clearShortCaption ? { shortCaption: '' } : {}),
            },
          };
        }

        if (captionMode === 'template') {
          const rendered = interpolateCaptionTemplate(templateText, img, classes);
          let nextCaption = rendered;
          if (templateApplyMode === 'prepend') {
            nextCaption = img.caption.trim()
              ? `${rendered}${templateSeparator}${img.caption.trim()}`
              : rendered;
          } else if (templateApplyMode === 'append') {
            nextCaption = img.caption.trim()
              ? `${img.caption.trim()}${templateSeparator}${rendered}`
              : rendered;
          }
          return {
            imageId: img.id,
            patch: {
              caption: nextCaption,
              ...(alsoUpdateShort ? { shortCaption: nextCaption.slice(0, 120) } : {}),
            },
          };
        }

        // find_replace
        const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
        const nextCaption = img.caption.replace(regex, replaceText);
        const nextShort = alsoUpdateShort
          ? img.shortCaption.replace(regex, replaceText)
          : img.shortCaption;
        return {
          imageId: img.id,
          patch: { caption: nextCaption, shortCaption: nextShort },
        };
      });

      const label =
        captionMode === 'clear'
          ? 'Cleared captions on'
          : captionMode === 'find_replace'
            ? 'Updated captions across'
            : 'Applied caption template to';

      await onApplyMetaBatch(
        patches,
        `${label} ${patches.length} image${patches.length === 1 ? '' : 's'}.`
      );
      onClose();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Batch caption update failed.');
    } finally {
      setRunning(false);
    }
  };

  // Preview slices (first 4 images)
  const previewImages = targetImages.slice(0, 4);

  return (
    <div
      onClick={() => {
        if (!running) onClose();
      }}
      className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[1060px] h-[min(86vh,760px)] bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#232834] flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-[#E8ECF2] tracking-tight">
              Batch Operations Studio
            </h2>
            <span className="text-[#323949]" aria-hidden="true">
              /
            </span>
            {/* Scope Switcher */}
            <div className="flex items-center gap-1 p-0.5 bg-[#0B0D10] border border-[#232834] rounded-md text-[11px]">
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setScope('selected')}
                  className={`px-2 py-1 rounded font-medium font-mono tabular-nums transition-colors ${
                    scope === 'selected'
                      ? 'bg-[#181C24] text-[#38BDF8]'
                      : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  Selected ({selectedIds.length})
                </button>
              )}
              {filteredIds.length > 0 && filteredIds.length < allImages.length && (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setScope('filtered')}
                  className={`px-2 py-1 rounded font-medium font-mono tabular-nums transition-colors ${
                    scope === 'filtered'
                      ? 'bg-[#181C24] text-[#38BDF8]'
                      : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  Filtered ({filteredIds.length})
                </button>
              )}
              <button
                type="button"
                disabled={running}
                onClick={() => setScope('all')}
                className={`px-2 py-1 rounded font-medium font-mono tabular-nums transition-colors ${
                  scope === 'all'
                    ? 'bg-[#181C24] text-[#38BDF8]'
                    : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                }`}
              >
                All Images ({allImages.length})
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={running}
            onClick={onClose}
            aria-label="Close Batch Studio"
            className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24] disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 4 Operation Tabs */}
        <div className="px-5 border-b border-[#232834] bg-[#0E1117] flex items-center gap-6 shrink-0">
          {(
            [
              { id: 'crop', label: 'Batch Crop', icon: Crop },
              { id: 'resize', label: 'Batch Resize', icon: Maximize },
              { id: 'tags', label: 'Batch Tags', icon: Tags },
              { id: 'captions', label: 'Batch Captions', icon: FileText },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={running}
                onClick={() => {
                  setTab(item.id);
                  setErrorText(null);
                }}
                className={`relative py-3 flex items-center gap-2 text-xs font-medium transition-colors ${
                  active ? 'text-white' : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#38BDF8]' : 'text-[#64748B]'}`} />
                <span>{item.label}</span>
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#38BDF8]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Main Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {targetImages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#8B95A5]">
              No images available in the selected scope.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
              {/* LEFT COLUMN: Controls */}
              <div className="space-y-5">
                {/* ==================== BATCH CROP ==================== */}
                {tab === 'crop' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-[#E8ECF2] block">
                        Crop Strategy
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            {
                              id: 'aspect',
                              title: 'Aspect Ratio',
                              sub: 'Uniform ratio + anchor',
                            },
                            {
                              id: 'fit_labels',
                              title: 'Fit All Labels',
                              sub: 'Smart crop around boxes',
                            },
                            {
                              id: 'inset',
                              title: 'Margin Trim %',
                              sub: 'Cut edges uniformly',
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setCropStrategy(opt.id)}
                            className={`text-left p-3 rounded-md border transition-colors ${
                              cropStrategy === opt.id
                                ? 'bg-[#181C24] border-[#38BDF8] text-[#E8ECF2]'
                                : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:border-[#323949]'
                            }`}
                          >
                            <div className="text-xs font-semibold text-[#E8ECF2]">{opt.title}</div>
                            <div className="text-[11px] text-[#8B95A5] mt-0.5">{opt.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {cropStrategy === 'aspect' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-4">
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-[#CBD5E1] block">
                            Target Aspect Ratio
                          </span>
                          <div className="grid grid-cols-7 gap-1.5">
                            {ASPECT_OPTIONS.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => setCropAspectId(a.id)}
                                className={`py-1.5 rounded text-xs font-mono transition-colors border ${
                                  cropAspectId === a.id
                                    ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                    : 'bg-[#12151B] border-[#232834] text-[#94A3B8] hover:text-white'
                                }`}
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-[#CBD5E1] block">
                            Crop Anchor Alignment
                          </span>
                          <div className="grid grid-cols-5 gap-1.5">
                            {(['center', 'top', 'bottom', 'left', 'right'] as const).map((pos) => (
                              <button
                                key={pos}
                                type="button"
                                onClick={() => setCropAnchor(pos)}
                                className={`py-1.5 rounded text-xs capitalize transition-colors border ${
                                  cropAnchor === pos
                                    ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                    : 'bg-[#12151B] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                                }`}
                              >
                                {pos}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {cropStrategy === 'fit_labels' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-4">
                        <div>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-[#CBD5E1]">Padding Margin Around Labels</span>
                            <span className="font-mono tabular-nums text-[#38BDF8]">
                              {labelPaddingPct}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={40}
                            value={labelPaddingPct}
                            onChange={(e) => setLabelPaddingPct(Number(e.target.value))}
                            className="w-full accent-[#38BDF8]"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#232834]">
                          <span className="text-xs text-[#CBD5E1]">Images with no labels</span>
                          <div className="flex items-center gap-1.5">
                            {(
                              [
                                { id: 'skip', label: 'Skip Image' },
                                { id: 'center_square', label: 'Center 1:1' },
                              ] as const
                            ).map((fb) => (
                              <button
                                key={fb.id}
                                type="button"
                                onClick={() => setUnlabeledFallback(fb.id)}
                                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                                  unlabeledFallback === fb.id
                                    ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                    : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                                }`}
                              >
                                {fb.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {cropStrategy === 'inset' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(
                          [
                            { label: 'Top %', value: insetTop, set: setInsetTop },
                            { label: 'Bottom %', value: insetBottom, set: setInsetBottom },
                            { label: 'Left %', value: insetLeft, set: setInsetLeft },
                            { label: 'Right %', value: insetRight, set: setInsetRight },
                          ] as const
                        ).map((edge) => (
                          <label key={edge.label} className="space-y-1">
                            <span className="text-[11px] text-[#8B95A5] block">{edge.label}</span>
                            <input
                              type="number"
                              min={0}
                              max={45}
                              value={edge.value}
                              onChange={(e) =>
                                edge.set(clamp(Number(e.target.value) || 0, 0, 45))
                              }
                              className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E8ECF2] outline-none"
                            />
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Output Resize + Format + Annotation Mode */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-3.5 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <span className="text-xs font-semibold text-[#E8ECF2] block">
                          Output Size & Format
                        </span>
                        <div className="grid grid-cols-5 gap-1">
                          {(['original', '512', '640', '768', '1024'] as const).map((sz) => (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => setCropResizeOut(sz)}
                              className={`py-1 rounded text-[11px] font-mono border transition-colors ${
                                cropResizeOut === sz
                                  ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {sz === 'original' ? 'Native' : sz}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          {(
                            [
                              { id: 'image/jpeg', label: 'JPG' },
                              { id: 'image/png', label: 'PNG' },
                              { id: 'image/webp', label: 'WEBP' },
                            ] as const
                          ).map((fmt) => (
                            <button
                              key={fmt.id}
                              type="button"
                              onClick={() => setCropFormat(fmt.id)}
                              className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors ${
                                cropFormat === fmt.id
                                  ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {fmt.label}
                            </button>
                          ))}
                        </div>
                        {cropFormat !== 'image/png' && (
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-[#8B95A5]">Quality</span>
                            <input
                              type="range"
                              min={60}
                              max={100}
                              value={cropQuality}
                              onChange={(e) => setCropQuality(Number(e.target.value))}
                              className="flex-1 accent-[#38BDF8]"
                            />
                            <span className="font-mono tabular-nums text-[#E8ECF2] w-8 text-right">
                              {cropQuality}%
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-3.5 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <span className="text-xs font-semibold text-[#E8ECF2] block">
                          Annotation Remapping & Save
                        </span>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              { id: 'clip', label: 'Clip & Fit' },
                              { id: 'strict', label: 'Inside Only' },
                              { id: 'drop', label: 'Drop All' },
                            ] as const
                          ).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setCropAnnMode(m.id)}
                              className={`py-1 rounded text-[11px] border transition-colors ${
                                cropAnnMode === m.id
                                  ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        {cropAnnMode === 'clip' && (
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cropMarkTruncated}
                              onChange={(e) => setCropMarkTruncated(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Flag clipped labels as truncated</span>
                          </label>
                        )}
                        <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[#232834]">
                          {(
                            [
                              { id: 'new', label: 'Save as New Copies' },
                              { id: 'replace', label: 'Replace Originals' },
                            ] as const
                          ).map((sm) => (
                            <button
                              key={sm.id}
                              type="button"
                              onClick={() => setCropSaveMode(sm.id)}
                              className={`py-1.5 rounded text-[11px] font-medium border transition-colors ${
                                cropSaveMode === sm.id
                                  ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {sm.label}
                            </button>
                          ))}
                        </div>
                        {cropSaveMode === 'new' && (
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cropCopyMeta}
                              onChange={(e) => setCropCopyMeta(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Copy captions, tags & split to new images</span>
                          </label>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* ==================== BATCH RESIZE ==================== */}
                {tab === 'resize' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-[#E8ECF2] block">
                        Resize & Aspect Mode
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {(
                          [
                            {
                              id: 'letterbox',
                              title: 'Letterbox Pad',
                              sub: 'Exact size, preserves ratio (YOLO)',
                            },
                            {
                              id: 'fit',
                              title: 'Fit Inside',
                              sub: 'Keep aspect, no padding',
                            },
                            {
                              id: 'fill',
                              title: 'Fill & Center Crop',
                              sub: 'Exact size, crops overflow',
                            },
                            {
                              id: 'exact',
                              title: 'Exact Stretch',
                              sub: 'Force exact W × H',
                            },
                            {
                              id: 'longest',
                              title: 'Max Longest Edge',
                              sub: 'Scale longest side to px',
                            },
                            {
                              id: 'scale',
                              title: 'Percentage Scale',
                              sub: 'Uniform % downsample/up',
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setResizeMode(opt.id)}
                            className={`text-left p-2.5 rounded-md border transition-colors ${
                              resizeMode === opt.id
                                ? 'bg-[#181C24] border-[#38BDF8] text-[#E8ECF2]'
                                : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:border-[#323949]'
                            }`}
                          >
                            <div className="text-xs font-semibold text-[#E8ECF2]">{opt.title}</div>
                            <div className="text-[11px] text-[#8B95A5] mt-0.5">{opt.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-4">
                      {resizeMode === 'scale' ? (
                        <div>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-[#CBD5E1]">Scale Percentage</span>
                            <span className="font-mono tabular-nums text-[#38BDF8]">
                              {resizeScalePct}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={200}
                            step={5}
                            value={resizeScalePct}
                            onChange={(e) => setResizeScalePct(Number(e.target.value))}
                            className="w-full accent-[#38BDF8]"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="space-y-1.5">
                            <span className="text-xs font-medium text-[#CBD5E1] block">
                              ML Training Size Presets
                            </span>
                            <div className="grid grid-cols-6 gap-1.5">
                              {RESIZE_PRESETS.map((sz) => (
                                <button
                                  key={sz}
                                  type="button"
                                  onClick={() => {
                                    setResizeW(sz);
                                    setResizeH(sz);
                                  }}
                                  className={`py-1.5 rounded text-xs font-mono tabular-nums border transition-colors ${
                                    resizeW === sz && (resizeMode === 'longest' || resizeH === sz)
                                      ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                      : 'bg-[#12151B] border-[#232834] text-[#94A3B8] hover:text-white'
                                  }`}
                                >
                                  {sz}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1">
                              <span className="text-[11px] text-[#8B95A5] block">
                                {resizeMode === 'longest' ? 'Target Longest Edge (px)' : 'Width (px)'}
                              </span>
                              <input
                                type="number"
                                min={32}
                                max={4096}
                                value={resizeW}
                                onChange={(e) =>
                                  setResizeW(clamp(Number(e.target.value) || 640, 32, 4096))
                                }
                                className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E8ECF2] outline-none"
                              />
                            </label>
                            {resizeMode !== 'longest' && (
                              <label className="space-y-1">
                                <span className="text-[11px] text-[#8B95A5] block">
                                  Height (px)
                                </span>
                                <input
                                  type="number"
                                  min={32}
                                  max={4096}
                                  value={resizeH}
                                  onChange={(e) =>
                                    setResizeH(clamp(Number(e.target.value) || 640, 32, 4096))
                                  }
                                  className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E8ECF2] outline-none"
                                />
                              </label>
                            )}
                          </div>
                        </>
                      )}

                      {resizeMode === 'letterbox' && (
                        <div className="pt-2 border-t border-[#232834] flex items-center justify-between gap-3">
                          <span className="text-xs text-[#CBD5E1]">Letterbox Pad Color</span>
                          <div className="flex items-center gap-2">
                            {PAD_COLORS.map((c) => (
                              <button
                                key={c.hex}
                                type="button"
                                onClick={() => setPadColor(c.hex)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors ${
                                  padColor === c.hex
                                    ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                    : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                                }`}
                              >
                                <span
                                  className="w-3 h-3 rounded-xs border border-white/20"
                                  style={{ backgroundColor: c.hex }}
                                />
                                <span>{c.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-3.5 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <span className="text-xs font-semibold text-[#E8ECF2] block">
                          Output Encoding
                        </span>
                        <div className="flex items-center gap-2">
                          {(
                            [
                              { id: 'image/jpeg', label: 'JPG' },
                              { id: 'image/png', label: 'PNG' },
                              { id: 'image/webp', label: 'WEBP' },
                            ] as const
                          ).map((fmt) => (
                            <button
                              key={fmt.id}
                              type="button"
                              onClick={() => setResizeFormat(fmt.id)}
                              className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors ${
                                resizeFormat === fmt.id
                                  ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {fmt.label}
                            </button>
                          ))}
                        </div>
                        {resizeFormat !== 'image/png' && (
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-[#8B95A5]">Quality</span>
                            <input
                              type="range"
                              min={60}
                              max={100}
                              value={resizeQuality}
                              onChange={(e) => setResizeQuality(Number(e.target.value))}
                              className="flex-1 accent-[#38BDF8]"
                            />
                            <span className="font-mono tabular-nums text-[#E8ECF2] w-8 text-right">
                              {resizeQuality}%
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-3.5 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <span className="text-xs font-semibold text-[#E8ECF2] block">
                          Labels & Save Behavior
                        </span>
                        <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={resizeKeepAnns}
                            onChange={(e) => setResizeKeepAnns(e.target.checked)}
                            className="accent-[#38BDF8]"
                          />
                          <span>Rescale & offset all annotations to match</span>
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[#232834]">
                          {(
                            [
                              { id: 'replace', label: 'Replace Originals' },
                              { id: 'new', label: 'Save as New Copies' },
                            ] as const
                          ).map((sm) => (
                            <button
                              key={sm.id}
                              type="button"
                              onClick={() => setResizeSaveMode(sm.id)}
                              className={`py-1.5 rounded text-[11px] font-medium border transition-colors ${
                                resizeSaveMode === sm.id
                                  ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {sm.label}
                            </button>
                          ))}
                        </div>
                        {resizeSaveMode === 'new' && (
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={resizeCopyMeta}
                              onChange={(e) => setResizeCopyMeta(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Copy captions, tags & split to copies</span>
                          </label>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* ==================== BATCH TAGS ==================== */}
                {tab === 'tags' && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          { id: 'add', title: 'Add Tags', sub: 'Merge new tags' },
                          { id: 'remove', title: 'Remove Tags', sub: 'Strip selected tags' },
                          { id: 'replace', title: 'Replace All', sub: 'Overwrite tag list' },
                          { id: 'from_labels', title: 'From Labels', sub: 'Derive from Class/Obj' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setTagMode(m.id);
                            setErrorText(null);
                          }}
                          className={`text-left p-2.5 rounded-md border transition-colors ${
                            tagMode === m.id
                              ? 'bg-[#181C24] border-[#38BDF8] text-[#E8ECF2]'
                              : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:border-[#323949]'
                          }`}
                        >
                          <div className="text-xs font-semibold text-[#E8ECF2]">{m.title}</div>
                          <div className="text-[11px] text-[#8B95A5] mt-0.5">{m.sub}</div>
                        </button>
                      ))}
                    </div>

                    {(tagMode === 'add' || tagMode === 'replace') && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-2.5">
                        <label className="text-xs font-medium text-[#CBD5E1] block">
                          {tagMode === 'add'
                            ? 'Tags to Add (comma or newline separated)'
                            : 'Replacement Tag List (comma or newline separated — leave empty to clear all)'}
                        </label>
                        <textarea
                          rows={3}
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          placeholder="e.g. studio, high_res, indoor, garment_v2"
                          className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded-md p-2.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none resize-none"
                        />
                        {parseTagInput(tagInput).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {parseTagInput(tagInput).map((t) => (
                              <span
                                key={t}
                                className="px-2 py-0.5 rounded bg-[#181C24] border border-[#232834] text-[11px] font-mono text-[#38BDF8]"
                              >
                                +{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {tagMode === 'remove' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <span className="text-xs font-medium text-[#CBD5E1] block">
                          Select Existing Tags Across Target Images
                        </span>
                        {existingTagCounts.length === 0 ? (
                          <p className="text-xs text-[#64748B]">
                            None of the target images currently have tags.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                            {existingTagCounts.map(([tag, count]) => {
                              const picked = tagsToRemove.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() =>
                                    setTagsToRemove((prev) =>
                                      prev.includes(tag)
                                        ? prev.filter((x) => x !== tag)
                                        : [...prev, tag]
                                    )
                                  }
                                  className={`px-2 py-1 rounded text-xs font-mono border transition-colors flex items-center gap-1.5 ${
                                    picked
                                      ? 'bg-[#EF4444]/15 border-[#EF4444] text-[#FCA5A5]'
                                      : 'bg-[#12151B] border-[#232834] text-[#CBD5E1] hover:border-[#323949]'
                                  }`}
                                >
                                  <span>{tag}</span>
                                  <span className="text-[10px] opacity-65 tabular-nums">
                                    ({count})
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div className="pt-2 border-t border-[#232834]">
                          <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder="Or type additional tags to strip (comma-separated)..."
                            className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {tagMode === 'from_labels' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <span className="text-xs font-medium text-[#CBD5E1] block">
                          Extract Image Tags From Annotated Taxonomy
                        </span>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { id: 'objects', label: 'Object Names (e.g. dress, hand)' },
                              { id: 'classes', label: 'Parent Classes (e.g. clothes, body)' },
                              { id: 'both', label: 'Both Classes & Objects' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setAutoTagSource(opt.id)}
                              className={`p-2 rounded text-left text-xs border transition-colors ${
                                autoTagSource === opt.id
                                  ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoTagLowercase}
                            onChange={(e) => setAutoTagLowercase(e.target.checked)}
                            className="accent-[#38BDF8]"
                          />
                          <span>Normalize derived tags to lowercase</span>
                        </label>
                      </div>
                    )}
                  </>
                )}

                {/* ==================== BATCH CAPTIONS ==================== */}
                {tab === 'captions' && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          { id: 'template', title: 'Template / Prefix', sub: 'Set, prepend or append' },
                          { id: 'find_replace', title: 'Find & Replace', sub: 'Bulk edit text' },
                          { id: 'ai', title: 'AI Auto-Caption', sub: 'Gemini Flash Lite' },
                          { id: 'clear', title: 'Clear Captions', sub: 'Reset caption fields' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setCaptionMode(m.id);
                            setErrorText(null);
                          }}
                          className={`text-left p-2.5 rounded-md border transition-colors ${
                            captionMode === m.id
                              ? 'bg-[#181C24] border-[#38BDF8] text-[#E8ECF2]'
                              : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:border-[#323949]'
                          }`}
                        >
                          <div className="text-xs font-semibold text-[#E8ECF2] flex items-center gap-1">
                            {m.id === 'ai' && <Sparkles className="w-3 h-3 text-[#38BDF8]" />}
                            <span>{m.title}</span>
                          </div>
                          <div className="text-[11px] text-[#8B95A5] mt-0.5">{m.sub}</div>
                        </button>
                      ))}
                    </div>

                    {captionMode === 'template' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[#CBD5E1]">Apply Mode</span>
                          <div className="flex items-center gap-1">
                            {(
                              [
                                { id: 'replace', label: 'Replace' },
                                { id: 'prepend', label: 'Prepend' },
                                { id: 'append', label: 'Append' },
                              ] as const
                            ).map((am) => (
                              <button
                                key={am.id}
                                type="button"
                                onClick={() => setTemplateApplyMode(am.id)}
                                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                                  templateApplyMode === am.id
                                    ? 'bg-[#181C24] border-[#38BDF8] text-white'
                                    : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                                }`}
                              >
                                {am.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <textarea
                          rows={3}
                          value={templateText}
                          onChange={(e) => setTemplateText(e.target.value)}
                          placeholder="Enter caption or template using tokens below..."
                          className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded-md p-2.5 text-xs text-[#E8ECF2] outline-none resize-none"
                        />

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-[#8B95A5] mr-1">Insert token:</span>
                          {['{objects}', '{classes}', '{labels}', '{tags}', '{filename}', '{count}'].map(
                            (tok) => (
                              <button
                                key={tok}
                                type="button"
                                onClick={() => setTemplateText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${tok}`)}
                                className="px-2 py-0.5 rounded bg-[#12151B] hover:bg-[#181C24] border border-[#232834] text-[11px] font-mono text-[#38BDF8] transition-colors flex items-center gap-1"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                <span>{tok}</span>
                              </button>
                            )
                          )}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#232834]">
                          {templateApplyMode !== 'replace' && (
                            <label className="flex items-center gap-2 text-xs text-[#8B95A5]">
                              <span>Separator:</span>
                              <input
                                type="text"
                                value={templateSeparator}
                                onChange={(e) => setTemplateSeparator(e.target.value)}
                                className="w-16 bg-[#12151B] border border-[#232834] rounded px-2 py-1 text-xs font-mono text-[#E8ECF2]"
                              />
                            </label>
                          )}
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={alsoUpdateShort}
                              onChange={(e) => setAlsoUpdateShort(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Also sync Short Caption</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {captionMode === 'find_replace' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="space-y-1">
                            <span className="text-[11px] text-[#8B95A5] block">Find Text</span>
                            <input
                              type="text"
                              value={findText}
                              onChange={(e) => setFindText(e.target.value)}
                              placeholder="Text to search for..."
                              className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] text-[#8B95A5] block">Replace With</span>
                            <input
                              type="text"
                              value={replaceText}
                              onChange={(e) => setReplaceText(e.target.value)}
                              placeholder="Replacement text (optional)"
                              className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-5 pt-1">
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={caseSensitive}
                              onChange={(e) => setCaseSensitive(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Match case</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={alsoUpdateShort}
                              onChange={(e) => setAlsoUpdateShort(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Include Short Caption</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {captionMode === 'ai' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3.5">
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-[#CBD5E1] block">
                            Caption Generation Style (Gemini Flash Lite)
                          </span>
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                { id: 'descriptive', label: 'Descriptive' },
                                { id: 'concise', label: 'Concise' },
                                { id: 'technical', label: 'Technical ML' },
                              ] as const
                            ).map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => setAiStyle(st.id)}
                                className={`py-1.5 rounded text-xs border transition-colors ${
                                  aiStyle === st.id
                                    ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                    : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                                }`}
                              >
                                {st.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-[#232834]">
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={aiSkipExisting}
                              onChange={(e) => setAiSkipExisting(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>
                              Skip images that already have a caption (
                              {targetImages.filter((i) => !i.caption.trim()).length} of{' '}
                              {targetImages.length} uncaptioned)
                            </span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={aiMergeTags}
                              onChange={(e) => setAiMergeTags(e.target.checked)}
                              className="accent-[#38BDF8]"
                            />
                            <span>Also merge AI-suggested tags onto each image</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {captionMode === 'clear' && (
                      <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-2.5">
                        <p className="text-xs text-[#CBD5E1]">
                          Clear full captions from all{' '}
                          <span className="font-mono tabular-nums text-white">
                            {targetImages.length}
                          </span>{' '}
                          target images. Annotations and tags are untouched.
                        </p>
                        <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={clearShortCaption}
                            onChange={(e) => setClearShortCaption(e.target.checked)}
                            className="accent-[#38BDF8]"
                          />
                          <span>Also clear Short Caption field</span>
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* RIGHT COLUMN: Live Preview Panel */}
              <div className="bg-[#0B0D10] border border-[#232834] rounded-md p-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#E8ECF2]">Live Preview</span>
                  <span className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
                    Showing {previewImages.length} of {targetImages.length}
                  </span>
                </div>

                {/* Crop Visual Preview */}
                {tab === 'crop' && (
                  <div className="grid grid-cols-2 gap-2.5">
                    {previewImages.map((img) => {
                      const src = imageUrls[img.id] || img.seedUrl;
                      const rect = computeCropForImage(img);
                      const outW =
                        rect && cropResizeOut !== 'original' ? Number(cropResizeOut) : rect?.width;
                      const outH =
                        rect && cropResizeOut !== 'original' ? Number(cropResizeOut) : rect?.height;

                      return (
                        <div
                          key={img.id}
                          className="bg-[#12151B] border border-[#232834] rounded overflow-hidden"
                        >
                          <div className="relative aspect-[4/3] bg-[#07090C] overflow-hidden">
                            {src && (
                              <img
                                src={src}
                                alt={img.fileName}
                                className="w-full h-full object-contain"
                              />
                            )}
                            {rect ? (
                              <svg
                                viewBox={`0 0 ${img.width} ${img.height}`}
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                preserveAspectRatio="xMidYMid meet"
                              >
                                <rect
                                  x={rect.x}
                                  y={rect.y}
                                  width={rect.width}
                                  height={rect.height}
                                  fill="rgba(56, 189, 248, 0.14)"
                                  stroke="#38BDF8"
                                  strokeWidth={Math.max(4, img.width * 0.01)}
                                />
                              </svg>
                            ) : (
                              <div className="absolute inset-0 bg-black/65 flex items-center justify-center text-[11px] text-[#F59E0B] font-medium">
                                Skipped (no labels)
                              </div>
                            )}
                          </div>
                          <div className="px-2 py-1.5 text-[10px] font-mono tabular-nums text-[#8B95A5] truncate">
                            {rect ? `${outW}×${outH}` : 'Skip'} · {img.fileName}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Resize Dimension Preview */}
                {tab === 'resize' && (
                  <div className="space-y-2">
                    {previewImages.map((img) => {
                      const plan = computeResizePlan(
                        img.width,
                        img.height,
                        resizeMode,
                        resizeW,
                        resizeH,
                        resizeScalePct
                      );
                      return (
                        <div
                          key={img.id}
                          className="p-2.5 rounded bg-[#12151B] border border-[#232834] text-xs space-y-1"
                        >
                          <div className="text-[#E8ECF2] font-medium truncate">{img.fileName}</div>
                          <div className="flex items-center justify-between font-mono tabular-nums text-[11px]">
                            <span className="text-[#8B95A5]">
                              {img.width}×{img.height}
                            </span>
                            <span className="text-[#38BDF8]">
                              → {plan.outWidth}×{plan.outHeight}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tags Preview */}
                {tab === 'tags' && (
                  <div className="space-y-2.5">
                    {previewImages.map((img) => {
                      const parsed = parseTagInput(tagInput);
                      let previewTags = [...img.tags];
                      if (tagMode === 'add') {
                        previewTags = Array.from(new Set([...previewTags, ...parsed]));
                      } else if (tagMode === 'remove') {
                        const rem = new Set([...tagsToRemove, ...parsed].map((x) => x.toLowerCase()));
                        previewTags = previewTags.filter((t) => !rem.has(t.toLowerCase()));
                      } else if (tagMode === 'replace') {
                        previewTags = parsed;
                      } else if (tagMode === 'from_labels') {
                        const extra: string[] = [];
                        for (const a of img.annotations) {
                          if (a.source === 'ai_suggestion') continue;
                          const tx = resolveTaxonomy(classes, a.classId, a.objectId);
                          const fmt = (s: string) => (autoTagLowercase ? s.toLowerCase() : s);
                          if (autoTagSource === 'objects' || autoTagSource === 'both')
                            extra.push(fmt(tx.objectName));
                          if (autoTagSource === 'classes' || autoTagSource === 'both')
                            extra.push(fmt(tx.className));
                        }
                        previewTags = Array.from(new Set([...previewTags, ...extra]));
                      }

                      return (
                        <div
                          key={img.id}
                          className="p-2.5 rounded bg-[#12151B] border border-[#232834] space-y-1.5"
                        >
                          <div className="text-xs font-medium text-[#E8ECF2] truncate">
                            {img.fileName}
                          </div>
                          <div className="text-[11px] font-mono text-[#8B95A5] leading-relaxed break-words">
                            {previewTags.length > 0 ? previewTags.join(', ') : '(no tags)'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Captions Preview */}
                {tab === 'captions' && (
                  <div className="space-y-2.5">
                    {previewImages.map((img) => {
                      let resultCaption = img.caption;
                      if (captionMode === 'clear') {
                        resultCaption = '(cleared)';
                      } else if (captionMode === 'ai') {
                        resultCaption =
                          aiSkipExisting && img.caption.trim()
                            ? '(skipped — already captioned)'
                            : 'Will be generated via Gemini Flash Lite...';
                      } else if (captionMode === 'template') {
                        const r = interpolateCaptionTemplate(templateText, img, classes);
                        if (templateApplyMode === 'replace') resultCaption = r;
                        else if (templateApplyMode === 'prepend')
                          resultCaption = img.caption.trim()
                            ? `${r}${templateSeparator}${img.caption.trim()}`
                            : r;
                        else
                          resultCaption = img.caption.trim()
                            ? `${img.caption.trim()}${templateSeparator}${r}`
                            : r;
                      } else if (captionMode === 'find_replace' && findText) {
                        const esc = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        resultCaption = img.caption.replace(
                          new RegExp(esc, caseSensitive ? 'g' : 'gi'),
                          replaceText
                        );
                      }

                      return (
                        <div
                          key={img.id}
                          className="p-2.5 rounded bg-[#12151B] border border-[#232834] space-y-1"
                        >
                          <div className="text-xs font-medium text-[#E8ECF2] truncate">
                            {img.fileName}
                          </div>
                          <p className="text-[11px] text-[#94A3B8] line-clamp-3 leading-relaxed">
                            {resultCaption || '(empty)'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Progress + Actions */}
        <div className="px-5 py-3.5 border-t border-[#232834] bg-[#0E1117] flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex-1 min-w-[200px]">
            {running ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#E8ECF2] flex items-center gap-2 truncate">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8] shrink-0" />
                    <span className="truncate">Processing {progress.currentName}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[#38BDF8] shrink-0 ml-2">
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="h-1.5 bg-[#181C24] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#38BDF8] transition-all duration-200"
                    style={{
                      width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ) : errorText ? (
              <div className="flex items-center gap-2 text-xs text-[#FCA5A5]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#EF4444]" />
                <span>{errorText}</span>
              </div>
            ) : (
              <span className="text-xs text-[#8B95A5] font-mono tabular-nums">
                Target: {targetImages.length} image{targetImages.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {running ? (
              <button
                type="button"
                onClick={handleCancelRun}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#EF4444]/40 text-xs font-medium text-[#FCA5A5] transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop Batch</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-xs font-medium text-[#8B95A5] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={targetImages.length === 0}
                  onClick={() => {
                    if (tab === 'crop') void handleRunBatchCrop();
                    else if (tab === 'resize') void handleRunBatchResize();
                    else if (tab === 'tags') void handleRunBatchTags();
                    else void handleRunBatchCaptions();
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] disabled:opacity-40 text-[#07090C] text-xs font-semibold transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {tab === 'crop'
                      ? `Crop ${targetImages.length} Image${targetImages.length === 1 ? '' : 's'}`
                      : tab === 'resize'
                        ? `Resize ${targetImages.length} Image${targetImages.length === 1 ? '' : 's'}`
                        : tab === 'tags'
                          ? `Update Tags (${targetImages.length})`
                          : captionMode === 'ai'
                            ? `AI Caption Batch`
                            : `Update Captions (${targetImages.length})`}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
