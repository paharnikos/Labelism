import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  Crop,
  Download,
  RotateCcw,
  ArrowLeftRight,
  Grid3X3,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  Scan,
  Square,
} from 'lucide-react';
import type { Annotation, DatasetImage, LabelClass } from '../types/annotation';
import { clamp, resolveTaxonomy } from '../utils/geometry';
import {
  buildCroppedFileName,
  computeBoundingRectForAnnotations,
  remapAnnotationsForCrop,
  renderCroppedImageBlob,
  type CropAnnotationMode,
  type CropOutputFormat,
  type CropRect,
  type CropSaveMode,
} from '../utils/crop';

interface CropModalProps {
  image: DatasetImage;
  imageUrl: string;
  classes: LabelClass[];
  selectedAnnotationId: string | null;
  onClose: () => void;
  onApplyCrop: (payload: {
    blob: Blob;
    width: number;
    height: number;
    mimeType: CropOutputFormat;
    fileName: string;
    annotations: Annotation[];
    saveMode: CropSaveMode;
    copyMetadata: boolean;
  }) => Promise<void>;
}

type AspectPresetId = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3';
type ResizePresetId = 'original' | '224' | '384' | '512' | '640' | '768' | '1024' | 'custom';
type GridMode = 'thirds' | 'center' | 'off';
type CropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ASPECT_PRESETS: Array<{ id: AspectPresetId; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
];

const MIN_CROP_PX = 24;

export default function CropModal({
  image,
  imageUrl,
  classes,
  selectedAnnotationId,
  onClose,
  onApplyCrop,
}: CropModalProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Initial crop: 80% centered frame so user immediately sees the active crop handles
  const [crop, setCrop] = useState<CropRect>(() => {
    const w = Math.round(image.width * 0.8);
    const h = Math.round(image.height * 0.8);
    return {
      x: Math.round((image.width - w) / 2),
      y: Math.round((image.height - h) / 2),
      width: Math.max(MIN_CROP_PX, w),
      height: Math.max(MIN_CROP_PX, h),
    };
  });

  const [aspectId, setAspectId] = useState<AspectPresetId>('free');
  const [gridMode, setGridMode] = useState<GridMode>('thirds');
  const [showOverlayLabels, setShowOverlayLabels] = useState(true);
  const [snapPaddingPct, setSnapPaddingPct] = useState(10);

  const [resizePreset, setResizePreset] = useState<ResizePresetId>('original');
  const [customOutW, setCustomOutW] = useState(512);
  const [customOutH, setCustomOutH] = useState(512);
  const [format, setFormat] = useState<CropOutputFormat>('image/jpeg');
  const [quality, setQuality] = useState(92);

  const [annotationMode, setAnnotationMode] = useState<CropAnnotationMode>('clip');
  const [markTruncated, setMarkTruncated] = useState(true);
  const [saveMode, setSaveMode] = useState<CropSaveMode>('new');
  const [copyMetadata, setCopyMetadata] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [dragState, setDragState] = useState<{
    handle: CropHandle;
    startImgX: number;
    startImgY: number;
    orig: CropRect;
  } | null>(null);

  const activeAspectRatio =
    ASPECT_PRESETS.find((p) => p.id === aspectId)?.ratio ?? null;

  const selectedAnn = useMemo(
    () => image.annotations.find((a) => a.id === selectedAnnotationId) ?? null,
    [image.annotations, selectedAnnotationId]
  );

  // Compute output pixel dimensions
  const outputDims = useMemo(() => {
    if (resizePreset === 'original') {
      return { width: Math.round(crop.width), height: Math.round(crop.height) };
    }
    if (resizePreset === 'custom') {
      return {
        width: Math.max(16, Math.min(4096, Math.round(customOutW) || 512)),
        height: Math.max(16, Math.min(4096, Math.round(customOutH) || 512)),
      };
    }
    const target = Number(resizePreset);
    return { width: target, height: target };
  }, [resizePreset, crop.width, crop.height, customOutW, customOutH]);

  // Live preview of how annotations remap under the current crop & mode
  const remapPreview = useMemo(
    () =>
      remapAnnotationsForCrop(
        image.annotations,
        crop,
        outputDims.width,
        outputDims.height,
        annotationMode,
        markTruncated,
        false
      ),
    [image.annotations, crop, outputDims.width, outputDims.height, annotationMode, markTruncated]
  );

  // Fit an aspect ratio cleanly centered inside the current crop center
  const applyAspectRatio = (nextId: AspectPresetId) => {
    setAspectId(nextId);
    const ratio = ASPECT_PRESETS.find((p) => p.id === nextId)?.ratio ?? null;
    if (!ratio) return;

    const cx = crop.x + crop.width / 2;
    const cy = crop.y + crop.height / 2;

    let nextW = crop.width;
    let nextH = nextW / ratio;
    if (nextH > image.height) {
      nextH = image.height;
      nextW = nextH * ratio;
    }
    if (nextW > image.width) {
      nextW = image.width;
      nextH = nextW / ratio;
    }
    nextW = Math.max(MIN_CROP_PX, Math.round(nextW));
    nextH = Math.max(MIN_CROP_PX, Math.round(nextH));

    const nextX = Math.round(clamp(cx - nextW / 2, 0, image.width - nextW));
    const nextY = Math.round(clamp(cy - nextH / 2, 0, image.height - nextH));
    setCrop({ x: nextX, y: nextY, width: nextW, height: nextH });
  };

  const handleSwapOrientation = () => {
    const swapMap: Partial<Record<AspectPresetId, AspectPresetId>> = {
      '4:3': '3:4',
      '3:4': '4:3',
      '16:9': '9:16',
      '9:16': '16:9',
      '3:2': '2:3',
      '2:3': '3:2',
    };
    const swappedAspect = swapMap[aspectId];
    if (swappedAspect) {
      applyAspectRatio(swappedAspect);
      return;
    }
    // Free ratio: swap width and height around center
    const cx = crop.x + crop.width / 2;
    const cy = crop.y + crop.height / 2;
    const nextW = Math.round(clamp(crop.height, MIN_CROP_PX, image.width));
    const nextH = Math.round(clamp(crop.width, MIN_CROP_PX, image.height));
    setCrop({
      x: Math.round(clamp(cx - nextW / 2, 0, image.width - nextW)),
      y: Math.round(clamp(cy - nextH / 2, 0, image.height - nextH)),
      width: nextW,
      height: nextH,
    });
  };

  const handleSnapCenterSquare = () => {
    const side = Math.min(image.width, image.height);
    setAspectId('1:1');
    setCrop({
      x: Math.round((image.width - side) / 2),
      y: Math.round((image.height - side) / 2),
      width: side,
      height: side,
    });
  };

  const handleSnapToAnnotations = (subset: Annotation[]) => {
    const rect = computeBoundingRectForAnnotations(
      subset,
      image.width,
      image.height,
      snapPaddingPct
    );
    if (!rect) return;
    setAspectId('free');
    setCrop(rect);
  };

  const handleResetFull = () => {
    setAspectId('free');
    setCrop({ x: 0, y: 0, width: image.width, height: image.height });
  };

  const screenToImageCoords = (clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * image.width;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * image.height;
    return { x, y };
  };

  const beginDrag = (e: React.PointerEvent, handle: CropHandle) => {
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    const pt = screenToImageCoords(e.clientX, e.clientY);
    setDragState({ handle, startImgX: pt.x, startImgY: pt.y, orig: crop });
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const pt = screenToImageCoords(e.clientX, e.clientY);
    const dx = pt.x - dragState.startImgX;
    const dy = pt.y - dragState.startImgY;
    const { orig, handle } = dragState;

    if (handle === 'move') {
      setCrop({
        ...orig,
        x: Math.round(clamp(orig.x + dx, 0, image.width - orig.width)),
        y: Math.round(clamp(orig.y + dy, 0, image.height - orig.height)),
      });
      return;
    }

    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.width;
    let bottom = orig.y + orig.height;

    if (handle.includes('w')) left = clamp(orig.x + dx, 0, right - MIN_CROP_PX);
    if (handle.includes('e')) right = clamp(orig.x + orig.width + dx, left + MIN_CROP_PX, image.width);
    if (handle.includes('n')) top = clamp(orig.y + dy, 0, bottom - MIN_CROP_PX);
    if (handle.includes('s')) bottom = clamp(orig.y + orig.height + dy, top + MIN_CROP_PX, image.height);

    let nextW = right - left;
    let nextH = bottom - top;

    if (activeAspectRatio) {
      if (handle === 'n' || handle === 's') {
        const cx = (left + right) / 2;
        nextW = nextH * activeAspectRatio;
        if (nextW > image.width) {
          nextW = image.width;
          nextH = nextW / activeAspectRatio;
        }
        left = clamp(cx - nextW / 2, 0, image.width - nextW);
        if (handle === 'n') top = bottom - nextH;
        else bottom = top + nextH;
      } else {
        nextH = nextW / activeAspectRatio;
        if (handle.includes('n')) {
          top = bottom - nextH;
          if (top < 0) {
            top = 0;
            nextH = bottom;
            nextW = nextH * activeAspectRatio;
            if (handle.includes('w')) left = right - nextW;
            else right = left + nextW;
          }
        } else {
          bottom = top + nextH;
          if (bottom > image.height) {
            bottom = image.height;
            nextH = bottom - top;
            nextW = nextH * activeAspectRatio;
            if (handle.includes('w')) left = right - nextW;
            else right = left + nextW;
          }
        }
      }
    }

    const finalX = Math.round(clamp(left, 0, image.width - MIN_CROP_PX));
    const finalY = Math.round(clamp(top, 0, image.height - MIN_CROP_PX));
    const finalW = Math.round(clamp(nextW, MIN_CROP_PX, image.width - finalX));
    const finalH = Math.round(clamp(nextH, MIN_CROP_PX, image.height - finalY));

    setCrop({ x: finalX, y: finalY, width: finalW, height: finalH });
  };

  const handleSvgPointerUp = () => {
    setDragState(null);
  };

  const updateNumericField = (field: keyof CropRect, rawVal: number) => {
    const val = Number.isFinite(rawVal) ? Math.round(rawVal) : 0;
    if (field === 'x') {
      const nextX = clamp(val, 0, image.width - crop.width);
      setCrop((c) => ({ ...c, x: nextX }));
    } else if (field === 'y') {
      const nextY = clamp(val, 0, image.height - crop.height);
      setCrop((c) => ({ ...c, y: nextY }));
    } else if (field === 'width') {
      const nextW = clamp(val, MIN_CROP_PX, image.width - crop.x);
      if (activeAspectRatio) {
        const nextH = clamp(Math.round(nextW / activeAspectRatio), MIN_CROP_PX, image.height - crop.y);
        setCrop((c) => ({ ...c, width: Math.round(nextH * activeAspectRatio), height: nextH }));
      } else {
        setCrop((c) => ({ ...c, width: nextW }));
      }
    } else if (field === 'height') {
      const nextH = clamp(val, MIN_CROP_PX, image.height - crop.y);
      if (activeAspectRatio) {
        const nextW = clamp(Math.round(nextH * activeAspectRatio), MIN_CROP_PX, image.width - crop.x);
        setCrop((c) => ({ ...c, width: nextW, height: Math.round(nextW / activeAspectRatio) }));
      } else {
        setCrop((c) => ({ ...c, height: nextH }));
      }
    }
  };

  const handleDownloadOnly = async () => {
    setSubmitting(true);
    setErrorText(null);
    try {
      const rendered = await renderCroppedImageBlob(
        imageUrl,
        crop,
        outputDims.width,
        outputDims.height,
        format,
        quality
      );
      const url = URL.createObjectURL(rendered.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildCroppedFileName(image.fileName, format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Failed to export cropped image.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmApply = async () => {
    setSubmitting(true);
    setErrorText(null);
    try {
      const rendered = await renderCroppedImageBlob(
        imageUrl,
        crop,
        outputDims.width,
        outputDims.height,
        format,
        quality
      );
      const remapped = remapAnnotationsForCrop(
        image.annotations,
        crop,
        rendered.width,
        rendered.height,
        annotationMode,
        markTruncated,
        saveMode === 'new'
      );
      await onApplyCrop({
        blob: rendered.blob,
        width: rendered.width,
        height: rendered.height,
        mimeType: rendered.mimeType,
        fileName:
          saveMode === 'new'
            ? buildCroppedFileName(image.fileName, rendered.mimeType)
            : image.fileName,
        annotations: remapped.annotations,
        saveMode,
        copyMetadata,
      });
      onClose();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Crop failed unexpectedly.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSize = Math.max(8, Math.round(Math.min(image.width, image.height) * 0.014));
  const maskPath = `M 0 0 H ${image.width} V ${image.height} H 0 Z M ${crop.x} ${crop.y} H ${
    crop.x + crop.width
  } V ${crop.y + crop.height} H ${crop.x} Z`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[1160px] max-h-[90vh] bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[#232834] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Crop className="w-4 h-4 text-[#38BDF8] shrink-0" />
            <h2 className="text-sm font-semibold text-[#E8ECF2] truncate">
              Crop Image — {image.fileName}
            </h2>
            <span className="text-[11px] font-mono tabular-nums text-[#8B95A5] shrink-0">
              Source {image.width}×{image.height} px
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close crop studio"
            className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main 2-Column Body */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left: Interactive Crop Viewport */}
          <div className="flex-1 min-h-[320px] bg-[#07090C] flex flex-col overflow-hidden">
            {/* Viewport Mini-Toolbar */}
            <div className="px-4 py-2 border-b border-[#232834] bg-[#0B0D10] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setGridMode((m) => (m === 'thirds' ? 'center' : m === 'center' ? 'off' : 'thirds'))
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#12151B] hover:bg-[#181C24] border border-[#232834] text-[11px] text-[#CBD5E1] transition-colors"
                >
                  {gridMode === 'center' ? (
                    <Crosshair className="w-3.5 h-3.5 text-[#38BDF8]" />
                  ) : (
                    <Grid3X3 className="w-3.5 h-3.5 text-[#38BDF8]" />
                  )}
                  <span>
                    Grid: {gridMode === 'thirds' ? 'Thirds' : gridMode === 'center' ? 'Crosshair' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowOverlayLabels((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#12151B] hover:bg-[#181C24] border border-[#232834] text-[11px] text-[#CBD5E1] transition-colors"
                >
                  {showOverlayLabels ? (
                    <Eye className="w-3.5 h-3.5 text-[#38BDF8]" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-[#64748B]" />
                  )}
                  <span>Labels</span>
                </button>

                <button
                  type="button"
                  onClick={handleSwapOrientation}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#12151B] hover:bg-[#181C24] border border-[#232834] text-[11px] text-[#CBD5E1] transition-colors"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-[#8B95A5]" />
                  <span>Swap W↔H</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetFull}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#8B95A5] hover:text-white transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Full Frame</span>
              </button>
            </div>

            {/* Interactive SVG Canvas */}
            <div className="flex-1 p-5 flex items-center justify-center overflow-hidden select-none">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${image.width} ${image.height}`}
                onPointerMove={handleSvgPointerMove}
                onPointerUp={handleSvgPointerUp}
                onPointerLeave={handleSvgPointerUp}
                className="max-w-full max-h-full w-auto h-auto shadow-[0_0_0_1px_rgba(255,255,255,0.08)] touch-none"
                style={{ aspectRatio: `${image.width} / ${image.height}` }}
              >
                <image
                  href={imageUrl}
                  x={0}
                  y={0}
                  width={image.width}
                  height={image.height}
                  preserveAspectRatio="none"
                />

                {/* Existing Annotations Preview */}
                {showOverlayLabels &&
                  image.annotations.map((ann) => {
                    const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
                    if (!ann.visible || !tax.visible) return null;
                    if (ann.type === 'bbox') {
                      return (
                        <rect
                          key={ann.id}
                          x={ann.x}
                          y={ann.y}
                          width={ann.width}
                          height={ann.height}
                          fill={tax.color}
                          fillOpacity={0.1}
                          stroke={tax.color}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      );
                    }
                    if (ann.type === 'polygon') {
                      return (
                        <polygon
                          key={ann.id}
                          points={ann.points.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill={tax.color}
                          fillOpacity={0.12}
                          stroke={tax.color}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      );
                    }
                    if (ann.type === 'polyline') {
                      return (
                        <polyline
                          key={ann.id}
                          points={ann.points.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={tax.color}
                          strokeWidth={1.75}
                          strokeDasharray="4 3"
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      );
                    }
                    return (
                      <circle
                        key={ann.id}
                        cx={ann.x}
                        cy={ann.y}
                        r={handleSize * 0.55}
                        fill={tax.color}
                        pointerEvents="none"
                      />
                    );
                  })}

                {/* Dimmed Outside Mask */}
                <path
                  d={maskPath}
                  fill="#07090C"
                  fillOpacity={0.74}
                  fillRule="evenodd"
                  pointerEvents="none"
                />

                {/* Draggable Crop Interior */}
                <rect
                  x={crop.x}
                  y={crop.y}
                  width={crop.width}
                  height={crop.height}
                  fill="transparent"
                  stroke="#38BDF8"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-move"
                  onPointerDown={(e) => beginDrag(e, 'move')}
                />

                {/* Grid Guides */}
                {gridMode === 'thirds' && (
                  <g pointerEvents="none" stroke="#E8ECF2" strokeOpacity={0.3} strokeWidth={1}>
                    <line
                      x1={crop.x + crop.width / 3}
                      y1={crop.y}
                      x2={crop.x + crop.width / 3}
                      y2={crop.y + crop.height}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={crop.x + (crop.width * 2) / 3}
                      y1={crop.y}
                      x2={crop.x + (crop.width * 2) / 3}
                      y2={crop.y + crop.height}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={crop.x}
                      y1={crop.y + crop.height / 3}
                      x2={crop.x + crop.width}
                      y2={crop.y + crop.height / 3}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={crop.x}
                      y1={crop.y + (crop.height * 2) / 3}
                      x2={crop.x + crop.width}
                      y2={crop.y + (crop.height * 2) / 3}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )}

                {gridMode === 'center' && (
                  <g
                    pointerEvents="none"
                    stroke="#38BDF8"
                    strokeOpacity={0.45}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  >
                    <line
                      x1={crop.x + crop.width / 2}
                      y1={crop.y}
                      x2={crop.x + crop.width / 2}
                      y2={crop.y + crop.height}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={crop.x}
                      y1={crop.y + crop.height / 2}
                      x2={crop.x + crop.width}
                      y2={crop.y + crop.height / 2}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )}

                {/* 8 Resize Handles */}
                {(
                  [
                    ['nw', crop.x, crop.y, 'nwse-resize'],
                    ['n', crop.x + crop.width / 2, crop.y, 'ns-resize'],
                    ['ne', crop.x + crop.width, crop.y, 'nesw-resize'],
                    ['e', crop.x + crop.width, crop.y + crop.height / 2, 'ew-resize'],
                    ['se', crop.x + crop.width, crop.y + crop.height, 'nwse-resize'],
                    ['s', crop.x + crop.width / 2, crop.y + crop.height, 'ns-resize'],
                    ['sw', crop.x, crop.y + crop.height, 'nesw-resize'],
                    ['w', crop.x, crop.y + crop.height / 2, 'ew-resize'],
                  ] as Array<[CropHandle, number, number, string]>
                ).map(([handle, hx, hy, cursor]) => (
                  <rect
                    key={handle}
                    x={hx - handleSize / 2}
                    y={hy - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    fill="#0B0D10"
                    stroke="#38BDF8"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor }}
                    onPointerDown={(e) => beginDrag(e, handle)}
                  />
                ))}
              </svg>
            </div>

            {/* Bottom Live Telemetry Strip */}
            <div className="px-4 py-2 border-t border-[#232834] bg-[#0B0D10] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#8B95A5]">
              <span>
                Region: <strong className="text-[#E8ECF2]">{Math.round(crop.width)}×{Math.round(crop.height)}</strong> px at ({Math.round(crop.x)}, {Math.round(crop.y)})
              </span>
              <span>
                Output: <strong className="text-[#38BDF8]">{outputDims.width}×{outputDims.height}</strong> px ·{' '}
                {format === 'image/png'
                  ? 'PNG'
                  : `${format === 'image/webp' ? 'WEBP' : 'JPEG'} ${quality}%`}
              </span>
            </div>
          </div>

          {/* Right: Settings & ML Options Rail */}
          <div className="w-full lg:w-[344px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#232834] bg-[#12151B] overflow-y-auto p-4 space-y-5">
            {errorText && (
              <div className="p-2.5 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/35 text-xs text-[#FCA5A5]">
                {errorText}
              </div>
            )}

            {/* Aspect Ratio Presets */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#E8ECF2]">Aspect Ratio</span>
                <span className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
                  {(crop.width / Math.max(1, crop.height)).toFixed(2)}:1
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {ASPECT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyAspectRatio(p.id)}
                    className={`py-1.5 rounded text-[11px] font-mono border transition-colors ${
                      aspectId === p.id
                        ? 'bg-[#38BDF8]/15 border-[#38BDF8]/50 text-[#38BDF8] font-medium'
                        : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </section>

            {/* ML Quick Snap Presets */}
            <section className="space-y-2.5 pt-3 border-t border-[#232834]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#E8ECF2]">Quick Snap</span>
                <span className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
                  Margin {snapPaddingPct}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={handleSnapCenterSquare}
                  className="flex flex-col items-center gap-1 py-2 px-1.5 rounded bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-[11px] text-[#CBD5E1] transition-colors"
                >
                  <Square className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Center 1:1</span>
                </button>
                <button
                  type="button"
                  disabled={image.annotations.length === 0}
                  onClick={() => handleSnapToAnnotations(image.annotations)}
                  className="flex flex-col items-center gap-1 py-2 px-1.5 rounded bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-[11px] text-[#CBD5E1] disabled:opacity-40 transition-colors"
                >
                  <Scan className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>All Labels</span>
                </button>
                <button
                  type="button"
                  disabled={!selectedAnn}
                  onClick={() => selectedAnn && handleSnapToAnnotations([selectedAnn])}
                  className="flex flex-col items-center gap-1 py-2 px-1.5 rounded bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-[11px] text-[#CBD5E1] disabled:opacity-40 transition-colors"
                >
                  <Crop className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Selected</span>
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={35}
                value={snapPaddingPct}
                onChange={(e) => setSnapPaddingPct(Number(e.target.value))}
                aria-label="Snap margin percentage"
                className="w-full accent-[#38BDF8] h-1 bg-[#232834] rounded-lg"
              />
            </section>

            {/* Exact Pixel Coordinates */}
            <section className="space-y-2 pt-3 border-t border-[#232834]">
              <span className="block text-[11px] font-semibold text-[#E8ECF2]">
                Crop Coordinates (px)
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['x', 'X', crop.x],
                    ['y', 'Y', crop.y],
                    ['width', 'Width', crop.width],
                    ['height', 'Height', crop.height],
                  ] as Array<[keyof CropRect, string, number]>
                ).map(([field, label, val]) => (
                  <label key={field} className="block">
                    <span className="block text-[10px] text-[#8B95A5] mb-1">{label}</span>
                    <input
                      type="number"
                      value={Math.round(val)}
                      onChange={(e) => updateNumericField(field, Number(e.target.value))}
                      className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E8ECF2] outline-none"
                    />
                  </label>
                ))}
              </div>
            </section>

            {/* Output Resolution & Format */}
            <section className="space-y-2.5 pt-3 border-t border-[#232834]">
              <span className="block text-[11px] font-semibold text-[#E8ECF2]">
                Output Resize &amp; Format
              </span>

              <select
                value={resizePreset}
                onChange={(e) => setResizePreset(e.target.value as ResizePresetId)}
                aria-label="Output resolution preset"
                className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
              >
                <option value="original">Original Crop Pixels ({Math.round(crop.width)}×{Math.round(crop.height)})</option>
                <option value="224">224 × 224 (ViT / ResNet)</option>
                <option value="384">384 × 384 (SigLIP / Vision)</option>
                <option value="512">512 × 512 (Diffusion / VLM)</option>
                <option value="640">640 × 640 (YOLO / RT-DETR)</option>
                <option value="768">768 × 768 (High-Res Detection)</option>
                <option value="1024">1024 × 1024 (SDXL / High-Res)</option>
                <option value="custom">Custom Dimensions…</option>
              </select>

              {resizePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[10px] text-[#8B95A5] mb-1">Target W</span>
                    <input
                      type="number"
                      min={16}
                      max={4096}
                      value={customOutW}
                      onChange={(e) => setCustomOutW(Number(e.target.value))}
                      className="w-full bg-[#0B0D10] border border-[#232834] rounded px-2.5 py-1 text-xs font-mono tabular-nums text-[#E8ECF2] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-[#8B95A5] mb-1">Target H</span>
                    <input
                      type="number"
                      min={16}
                      max={4096}
                      value={customOutH}
                      onChange={(e) => setCustomOutH(Number(e.target.value))}
                      className="w-full bg-[#0B0D10] border border-[#232834] rounded px-2.5 py-1 text-xs font-mono tabular-nums text-[#E8ECF2] outline-none"
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['image/jpeg', 'JPEG'],
                    ['image/png', 'PNG'],
                    ['image/webp', 'WEBP'],
                  ] as Array<[CropOutputFormat, string]>
                ).map(([mime, label]) => (
                  <button
                    key={mime}
                    type="button"
                    onClick={() => setFormat(mime)}
                    className={`py-1.5 rounded text-xs font-mono border transition-colors ${
                      format === mime
                        ? 'bg-[#181C24] border-[#38BDF8] text-white'
                        : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {format !== 'image/png' && (
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[#8B95A5]">Compression Quality</span>
                    <span className="font-mono tabular-nums text-[#E8ECF2]">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full accent-[#38BDF8] h-1 bg-[#232834] rounded-lg"
                  />
                </div>
              )}
            </section>

            {/* Annotation Handling */}
            <section className="space-y-2.5 pt-3 border-t border-[#232834]">
              <span className="block text-[11px] font-semibold text-[#E8ECF2]">
                Annotation Remapping
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ['clip', 'Clip & Fit'],
                    ['strict', 'Inside Only'],
                    ['drop', 'Drop All'],
                  ] as Array<[CropAnnotationMode, string]>
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAnnotationMode(mode)}
                    className={`py-1.5 px-1.5 rounded text-[11px] font-medium border transition-colors ${
                      annotationMode === mode
                        ? 'bg-[#38BDF8]/15 border-[#38BDF8]/50 text-[#38BDF8]'
                        : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
                <span className="text-[#22C55E]">{remapPreview.keptCount} kept</span>
                <span aria-hidden="true"> · </span>
                <span className="text-[#F59E0B]">{remapPreview.truncatedCount} clipped</span>
                <span aria-hidden="true"> · </span>
                <span>{remapPreview.droppedCount} outside</span>
              </div>

              {annotationMode === 'clip' && (
                <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={markTruncated}
                    onChange={(e) => setMarkTruncated(e.target.checked)}
                    className="accent-[#38BDF8]"
                  />
                  <span>Auto-flag clipped labels as truncated</span>
                </label>
              )}
            </section>

            {/* Save Mode */}
            <section className="space-y-2 pt-3 border-t border-[#232834]">
              <span className="block text-[11px] font-semibold text-[#E8ECF2]">Save Mode</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setSaveMode('new')}
                  className={`py-1.5 px-2 rounded text-xs font-medium border transition-colors ${
                    saveMode === 'new'
                      ? 'bg-[#181C24] border-[#38BDF8] text-white'
                      : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  Save as New Image
                </button>
                <button
                  type="button"
                  onClick={() => setSaveMode('replace')}
                  className={`py-1.5 px-2 rounded text-xs font-medium border transition-colors ${
                    saveMode === 'replace'
                      ? 'bg-[#181C24] border-[#38BDF8] text-white'
                      : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  Replace Current
                </button>
              </div>
              {saveMode === 'new' && (
                <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={copyMetadata}
                    onChange={(e) => setCopyMetadata(e.target.checked)}
                    className="accent-[#38BDF8]"
                  />
                  <span>Copy captions, tags &amp; dataset split</span>
                </label>
              )}
            </section>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="px-5 py-3 border-t border-[#232834] bg-[#0B0D10] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleDownloadOnly()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] disabled:opacity-45 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>Download Crop</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-xs font-medium text-[#8B95A5] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleConfirmApply()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crop className="w-3.5 h-3.5" />
              )}
              <span>
                {saveMode === 'new' ? 'Save Cropped Image' : 'Replace Current Image'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
