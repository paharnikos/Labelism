import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Check,
  X,
  Upload,
  Sparkles,
} from 'lucide-react';
import type {
  Annotation,
  BBoxAnnotation,
  DatasetImage,
  ImageDisplaySettings,
  LabelClass,
  Point,
  ToolMode,
} from '../types/annotation';
import {
  clamp,
  clampPoint,
  generateId,
  getAnnotationAnchor,
  resolveTaxonomy,
} from '../utils/geometry';

interface AnnotationCanvasProps {
  image: DatasetImage | null;
  imageUrl: string | null;
  imageIndex: number;
  totalImages: number;
  classes: LabelClass[];
  activeClassId: string;
  activeObjectId: string;
  tool: ToolMode;
  selectedAnnotationId: string | null;
  displaySettings: ImageDisplaySettings;
  fitSignal: number;
  onSelectAnnotation: (id: string | null) => void;
  onChangeTool: (tool: ToolMode) => void;
  onCommitAnnotations: (next: Annotation[]) => void;
  onAcceptAllAI: () => void;
  onAcceptSelectedAI: (id: string) => void;
  onDismissAllAI: () => void;
  onPrevImage: () => void;
  onNextImage: () => void;
  onUploadFiles: (files: FileList) => void;
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragInteraction =
  | { kind: 'pan'; startScreenX: number; startScreenY: number; startPanX: number; startPanY: number }
  | { kind: 'draw_bbox'; start: Point; current: Point }
  | {
      kind: 'move_bbox';
      annId: string;
      startImg: Point;
      origX: number;
      origY: number;
      width: number;
      height: number;
    }
  | {
      kind: 'resize_bbox';
      annId: string;
      handle: ResizeHandle;
      orig: { x: number; y: number; width: number; height: number };
    }
  | { kind: 'move_vertex'; annId: string; vertexIndex: number }
  | { kind: 'move_poly'; annId: string; startImg: Point; origPoints: Point[] }
  | { kind: 'move_keypoint'; annId: string };

const TOOL_HINTS: Record<ToolMode, string> = {
  select: 'Click shape to select · Drag vertices or handles · Right-click vertex to remove',
  bbox: 'Click and drag to draw bounding box',
  polygon: 'Click to place vertices · Click start ring or press Enter to close · Esc to cancel',
  polyline: 'Click to add line points · Double-click or press Enter to finish · Esc to cancel',
  keypoint: 'Click anywhere on image to place keypoint marker',
  pan: 'Drag to pan canvas · Scroll wheel to zoom',
};

export default function AnnotationCanvas({
  image,
  imageUrl,
  imageIndex,
  totalImages,
  classes,
  activeClassId,
  activeObjectId,
  tool,
  selectedAnnotationId,
  displaySettings,
  fitSignal,
  onSelectAnnotation,
  onChangeTool,
  onCommitAnnotations,
  onAcceptAllAI,
  onAcceptSelectedAI,
  onDismissAllAI,
  onPrevImage,
  onNextImage,
  onUploadFiles,
}: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [cursorImg, setCursorImg] = useState<Point | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Live local draft annotations while dragging (committed on pointerUp for clean Undo steps)
  const [draftAnnotations, setDraftAnnotations] = useState<Annotation[] | null>(null);
  const [interaction, setInteraction] = useState<DragInteraction | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);

  const displayedAnnotations = draftAnnotations ?? image?.annotations ?? [];

  const aiSuggestions = useMemo(
    () => displayedAnnotations.filter((a) => a.source === 'ai_suggestion'),
    [displayedAnnotations]
  );

  const selectedIsAI = useMemo(
    () =>
      Boolean(
        selectedAnnotationId &&
          aiSuggestions.some((a) => a.id === selectedAnnotationId)
      ),
    [aiSuggestions, selectedAnnotationId]
  );

  const activeTax = useMemo(
    () => resolveTaxonomy(classes, activeClassId, activeObjectId),
    [classes, activeClassId, activeObjectId]
  );

  const imageId = image?.id ?? null;
  const imageWidth = image?.width ?? 0;
  const imageHeight = image?.height ?? 0;

  const fitImageToViewport = useCallback(() => {
    if (!containerRef.current || imageWidth <= 0 || imageHeight <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const padX = 56;
    const padY = 88;
    const availW = Math.max(120, rect.width - padX);
    const availH = Math.max(120, rect.height - padY);
    const nextZoom = Math.min(availW / imageWidth, availH / imageHeight, 2.5);
    const clampedZoom = clamp(nextZoom, 0.1, 6);
    setZoom(clampedZoom);
    setPan({
      x: (rect.width - imageWidth * clampedZoom) / 2,
      y: (rect.height - imageHeight * clampedZoom) / 2 - 12,
    });
  }, [imageWidth, imageHeight]);

  // Fit viewport only when switching images or pressing Fit (never when editing annotations)
  useEffect(() => {
    fitImageToViewport();
  }, [imageId, fitSignal, fitImageToViewport]);

  // Clear in-progress drawing/drag state only when switching to a different image
  useEffect(() => {
    setDrawingPoints([]);
    setInteraction(null);
    setDraftAnnotations(null);
  }, [imageId]);

  // Spacebar temporary pan & Enter/Esc/Backspace for active polygon/polyline drawing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inInput) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      } else if (e.key === 'Escape') {
        if (drawingPoints.length > 0) {
          e.preventDefault();
          setDrawingPoints([]);
        } else if (selectedAnnotationId) {
          onSelectAnnotation(null);
        }
      } else if (e.key === 'Enter' && drawingPoints.length > 0 && image) {
        e.preventDefault();
        if (tool === 'polygon' && drawingPoints.length >= 3) {
          const next: Annotation = {
            id: generateId('ann'),
            type: 'polygon',
            classId: activeClassId,
            objectId: activeObjectId,
            points: drawingPoints,
            visible: true,
            locked: false,
            attributes: { occluded: false, truncated: false, crowd: false },
            source: 'manual',
          };
          onCommitAnnotations([...image.annotations, next]);
          onSelectAnnotation(next.id);
          setDrawingPoints([]);
        } else if (tool === 'polyline' && drawingPoints.length >= 2) {
          const next: Annotation = {
            id: generateId('ann'),
            type: 'polyline',
            classId: activeClassId,
            objectId: activeObjectId,
            points: drawingPoints,
            visible: true,
            locked: false,
            attributes: { occluded: false, truncated: false, crowd: false },
            source: 'manual',
          };
          onCommitAnnotations([...image.annotations, next]);
          onSelectAnnotation(next.id);
          setDrawingPoints([]);
        }
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && drawingPoints.length > 0) {
        e.preventDefault();
        setDrawingPoints((pts) => pts.slice(0, -1));
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    drawingPoints,
    tool,
    image,
    activeClassId,
    activeObjectId,
    selectedAnnotationId,
    onCommitAnnotations,
    onSelectAnnotation,
  ]);

  // Clear in-progress polygon/polyline points if user switches tools
  useEffect(() => {
    setDrawingPoints([]);
  }, [tool]);

  const screenToImage = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!image || !containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
    const nextZoom = clamp(zoom * zoomFactor, 0.1, 10);
    const scaleRatio = nextZoom / zoom;

    setPan({
      x: mouseX - (mouseX - pan.x) * scaleRatio,
      y: mouseY - (mouseY - pan.y) * scaleRatio,
    });
    setZoom(nextZoom);
  };

  const zoomCentered = (factor: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const nextZoom = clamp(zoom * factor, 0.1, 10);
    const ratio = nextZoom / zoom;
    setPan({
      x: cx - (cx - pan.x) * ratio,
      y: cy - (cy - pan.y) * ratio,
    });
    setZoom(nextZoom);
  };

  const isNearFirstPoint = useMemo(() => {
    if (tool !== 'polygon' || drawingPoints.length < 3 || !cursorImg) return false;
    const first = drawingPoints[0];
    return Math.hypot(cursorImg.x - first.x, cursorImg.y - first.y) <= 13 / zoom;
  }, [tool, drawingPoints, cursorImg, zoom]);

  const commitDrawingPolygonOrLine = useCallback(
    (pts: Point[], mode: 'polygon' | 'polyline') => {
      if (!image) return;
      if (mode === 'polygon' && pts.length < 3) return;
      if (mode === 'polyline' && pts.length < 2) return;
      const next: Annotation = {
        id: generateId('ann'),
        type: mode,
        classId: activeClassId,
        objectId: activeObjectId,
        points: pts,
        visible: true,
        locked: false,
        attributes: { occluded: false, truncated: false, crowd: false },
        source: 'manual',
      };
      onCommitAnnotations([...image.annotations, next]);
      onSelectAnnotation(next.id);
      setDrawingPoints([]);
    },
    [image, activeClassId, activeObjectId, onCommitAnnotations, onSelectAnnotation]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return;

    // Middle mouse button or Space+drag or Pan tool -> Pan
    if (e.button === 1 || spacePressed || tool === 'pan') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setInteraction({
        kind: 'pan',
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      });
      return;
    }

    if (e.button !== 0) return;

    const rawPt = screenToImage(e.clientX, e.clientY);
    const pt = clampPoint(rawPt, image.width, image.height);

    if (tool === 'select') {
      onSelectAnnotation(null);
      return;
    }

    if (tool === 'bbox') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setInteraction({ kind: 'draw_bbox', start: pt, current: pt });
      return;
    }

    if (tool === 'polygon') {
      if (drawingPoints.length >= 3) {
        const first = drawingPoints[0];
        if (Math.hypot(pt.x - first.x, pt.y - first.y) <= 13 / zoom) {
          commitDrawingPolygonOrLine(drawingPoints, 'polygon');
          return;
        }
      }
      setDrawingPoints((prev) => [...prev, pt]);
      return;
    }

    if (tool === 'polyline') {
      setDrawingPoints((prev) => [...prev, pt]);
      return;
    }

    if (tool === 'keypoint') {
      const next: Annotation = {
        id: generateId('ann'),
        type: 'keypoint',
        classId: activeClassId,
        objectId: activeObjectId,
        x: pt.x,
        y: pt.y,
        visible: true,
        locked: false,
        attributes: { occluded: false, truncated: false, crowd: false },
        source: 'manual',
      };
      onCommitAnnotations([...image.annotations, next]);
      onSelectAnnotation(next.id);
    }
  };

  const handleCanvasDoubleClick = () => {
    if (!image) return;
    if (tool === 'polygon' && drawingPoints.length >= 3) {
      // Remove duplicate point added by second click if identical/close
      const cleaned =
        drawingPoints.length > 3 &&
        Math.hypot(
          drawingPoints[drawingPoints.length - 1].x - drawingPoints[drawingPoints.length - 2].x,
          drawingPoints[drawingPoints.length - 1].y - drawingPoints[drawingPoints.length - 2].y
        ) <
          6 / zoom
          ? drawingPoints.slice(0, -1)
          : drawingPoints;
      commitDrawingPolygonOrLine(cleaned, 'polygon');
    } else if (tool === 'polyline' && drawingPoints.length >= 2) {
      const cleaned =
        drawingPoints.length > 2 &&
        Math.hypot(
          drawingPoints[drawingPoints.length - 1].x - drawingPoints[drawingPoints.length - 2].x,
          drawingPoints[drawingPoints.length - 1].y - drawingPoints[drawingPoints.length - 2].y
        ) <
          6 / zoom
          ? drawingPoints.slice(0, -1)
          : drawingPoints;
      commitDrawingPolygonOrLine(cleaned, 'polyline');
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return;
    const rawPt = screenToImage(e.clientX, e.clientY);
    const clamped = clampPoint(rawPt, image.width, image.height);
    setCursorImg(clamped);

    if (!interaction) return;

    if (interaction.kind === 'pan') {
      setPan({
        x: interaction.startPanX + (e.clientX - interaction.startScreenX),
        y: interaction.startPanY + (e.clientY - interaction.startScreenY),
      });
      return;
    }

    if (interaction.kind === 'draw_bbox') {
      setInteraction({ ...interaction, current: clamped });
      return;
    }

    if (interaction.kind === 'move_bbox') {
      const dx = rawPt.x - interaction.startImg.x;
      const dy = rawPt.y - interaction.startImg.y;
      const nextX = clamp(interaction.origX + dx, 0, image.width - interaction.width);
      const nextY = clamp(interaction.origY + dy, 0, image.height - interaction.height);
      setDraftAnnotations(
        image.annotations.map((a) =>
          a.id === interaction.annId && a.type === 'bbox'
            ? { ...a, x: Math.round(nextX * 10) / 10, y: Math.round(nextY * 10) / 10 }
            : a
        )
      );
      return;
    }

    if (interaction.kind === 'resize_bbox') {
      const { orig, handle } = interaction;
      let left = orig.x;
      let top = orig.y;
      let right = orig.x + orig.width;
      let bottom = orig.y + orig.height;

      if (handle.includes('w')) left = clamp(clamped.x, 0, right - 4);
      if (handle.includes('e')) right = clamp(clamped.x, left + 4, image.width);
      if (handle.includes('n')) top = clamp(clamped.y, 0, bottom - 4);
      if (handle.includes('s')) bottom = clamp(clamped.y, top + 4, image.height);

      setDraftAnnotations(
        image.annotations.map((a) =>
          a.id === interaction.annId && a.type === 'bbox'
            ? {
                ...a,
                x: Math.round(left * 10) / 10,
                y: Math.round(top * 10) / 10,
                width: Math.round((right - left) * 10) / 10,
                height: Math.round((bottom - top) * 10) / 10,
              }
            : a
        )
      );
      return;
    }

    if (interaction.kind === 'move_vertex') {
      setDraftAnnotations(
        image.annotations.map((a) => {
          if (a.id !== interaction.annId || (a.type !== 'polygon' && a.type !== 'polyline')) {
            return a;
          }
          const nextPts = a.points.map((p, idx) => (idx === interaction.vertexIndex ? clamped : p));
          return { ...a, points: nextPts };
        })
      );
      return;
    }

    if (interaction.kind === 'move_poly') {
      const dx = rawPt.x - interaction.startImg.x;
      const dy = rawPt.y - interaction.startImg.y;
      setDraftAnnotations(
        image.annotations.map((a) => {
          if (a.id !== interaction.annId || (a.type !== 'polygon' && a.type !== 'polyline')) {
            return a;
          }
          const nextPts = interaction.origPoints.map((p) =>
            clampPoint({ x: p.x + dx, y: p.y + dy }, image.width, image.height)
          );
          return { ...a, points: nextPts };
        })
      );
      return;
    }

    if (interaction.kind === 'move_keypoint') {
      setDraftAnnotations(
        image.annotations.map((a) =>
          a.id === interaction.annId && a.type === 'keypoint'
            ? { ...a, x: clamped.x, y: clamped.y }
            : a
        )
      );
    }
  };

  const handlePointerUp = () => {
    if (!image || !interaction) return;

    if (interaction.kind === 'draw_bbox') {
      const x = Math.min(interaction.start.x, interaction.current.x);
      const y = Math.min(interaction.start.y, interaction.current.y);
      const width = Math.abs(interaction.current.x - interaction.start.x);
      const height = Math.abs(interaction.current.y - interaction.start.y);
      if (width >= 5 && height >= 5) {
        const next: BBoxAnnotation = {
          id: generateId('ann'),
          type: 'bbox',
          classId: activeClassId,
          objectId: activeObjectId,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          width: Math.round(width * 10) / 10,
          height: Math.round(height * 10) / 10,
          visible: true,
          locked: false,
          attributes: { occluded: false, truncated: false, crowd: false },
          source: 'manual',
        };
        onCommitAnnotations([...image.annotations, next]);
        onSelectAnnotation(next.id);
      }
    } else if (draftAnnotations) {
      onCommitAnnotations(draftAnnotations);
    }

    setInteraction(null);
    setDraftAnnotations(null);
  };

  const handleInsertVertex = (
    e: React.PointerEvent,
    ann: Annotation,
    edgeIndex: number,
    midPoint: Point
  ) => {
    e.stopPropagation();
    if (!image || ann.locked || (ann.type !== 'polygon' && ann.type !== 'polyline')) return;
    const nextPts = [
      ...ann.points.slice(0, edgeIndex + 1),
      clampPoint(midPoint, image.width, image.height),
      ...ann.points.slice(edgeIndex + 1),
    ];
    onCommitAnnotations(
      image.annotations.map((a) => (a.id === ann.id ? { ...a, points: nextPts } : a))
    );
  };

  const handleDeleteVertex = (e: React.MouseEvent, ann: Annotation, vertexIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!image || ann.locked || (ann.type !== 'polygon' && ann.type !== 'polyline')) return;
    const minPts = ann.type === 'polygon' ? 3 : 2;
    if (ann.points.length <= minPts) return;
    const nextPts = ann.points.filter((_, idx) => idx !== vertexIndex);
    onCommitAnnotations(
      image.annotations.map((a) => (a.id === ann.id ? { ...a, points: nextPts } : a))
    );
  };

  const cursorClass =
    spacePressed || tool === 'pan' || interaction?.kind === 'pan'
      ? interaction?.kind === 'pan'
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : tool === 'select'
        ? 'cursor-default'
        : 'cursor-crosshair';

  const handleRadius = 4.5 / zoom;
  const labelFontSize = 11 / zoom;
  const labelPadX = 6 / zoom;
  const labelHeight = 18 / zoom;

  if (!image) {
    return (
      <main
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files?.length) onUploadFiles(e.dataTransfer.files);
        }}
        className={`flex-1 bg-[#07090C] flex flex-col items-center justify-center p-8 transition-colors ${
          isDragOver ? 'ring-2 ring-inset ring-[#38BDF8] bg-[#0B1219]' : ''
        }`}
      >
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-lg bg-[#12151B] border border-[#232834] flex items-center justify-center mx-auto mb-4">
            <Upload className="w-5 h-5 text-[#38BDF8]" />
          </div>
          <h2 className="text-base font-semibold text-[#E8ECF2] mb-1.5">
            Drop dataset images to start labeling
          </h2>
          <p className="text-xs text-[#8B95A5] leading-relaxed mb-5">
            Supports PNG, JPG, and WEBP stored locally in IndexedDB. Draw bounding boxes, polygons,
            polylines, keypoints, and captions offline.
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            <span>Select Images</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onUploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </main>
    );
  }

  const imageFilterCss = `brightness(${displaySettings.brightness}%) contrast(${displaySettings.contrast}%) saturate(${displaySettings.saturation}%)`;

  return (
    <main
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setCursorImg(null)}
      onDoubleClick={handleCanvasDoubleClick}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files?.length) onUploadFiles(e.dataTransfer.files);
      }}
      className={`relative flex-1 overflow-hidden canvas-checker select-none ${cursorClass}`}
    >
      {/* Drag-and-drop visual frame */}
      {isDragOver && (
        <div className="absolute inset-3 rounded-lg border-2 border-dashed border-[#38BDF8] bg-[#07090C]/75 flex items-center justify-center z-40 pointer-events-none">
          <div className="text-sm font-medium text-[#38BDF8]">
            Drop images to add to this project
          </div>
        </div>
      )}

      {/* Floating AI Suggestion Review Bar */}
      {aiSuggestions.length > 0 && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-3.5 py-2 rounded-lg bg-[#12151B]/95 border border-[#38BDF8]/40 shadow-2xl backdrop-blur-sm"
        >
          <div className="flex items-center gap-1.5 text-xs text-[#E8ECF2] whitespace-nowrap">
            <Sparkles className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span className="font-medium font-mono tabular-nums">
              {aiSuggestions.length} AI box{aiSuggestions.length === 1 ? '' : 'es'} staged
            </span>
          </div>
          <div className="w-px h-4 bg-[#232834]" />
          <div className="flex items-center gap-1.5">
            {selectedIsAI && selectedAnnotationId && (
              <button
                type="button"
                onClick={() => onAcceptSelectedAI(selectedAnnotationId)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#181C24] hover:bg-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
              >
                <Check className="w-3 h-3 text-[#22C55E]" />
                <span>Accept Selected</span>
              </button>
            )}
            <button
              type="button"
              onClick={onAcceptAllAI}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Accept All</span>
            </button>
            <button
              type="button"
              onClick={onDismissAllAI}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[#232834] text-xs text-[#8B95A5] hover:text-[#EF4444] transition-colors whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Transformed Image + Resolution-Independent SVG Layer */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: image.width,
          height: image.height,
        }}
        className="absolute top-0 left-0 will-change-transform shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={image.fileName}
            referrerPolicy="no-referrer"
            draggable={false}
            style={{ filter: imageFilterCss }}
            className="w-full h-full block pointer-events-none select-none"
          />
        ) : (
          <div className="w-full h-full bg-[#12151B] flex items-center justify-center text-sm text-[#8B95A5]">
            Loading image asset...
          </div>
        )}

        <svg
          width={image.width}
          height={image.height}
          viewBox={`0 0 ${image.width} ${image.height}`}
          className="absolute inset-0 overflow-visible"
        >
          {/* Rendered Annotations */}
          {displayedAnnotations.map((ann) => {
            const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
            if (!ann.visible || !tax.visible) return null;

            const isSelected = ann.id === selectedAnnotationId;
            const isAI = ann.source === 'ai_suggestion';
            const color = tax.color;
            const fillOpacity = isSelected
              ? Math.min(0.65, displaySettings.maskOpacity + 0.14)
              : isAI
                ? displaySettings.maskOpacity * 0.65
                : displaySettings.maskOpacity;

            const anchor = getAnnotationAnchor(ann);
            const labelText = displaySettings.showClassPrefix
              ? `${tax.className} / ${tax.objectName}`
              : tax.objectName;
            const fullTag =
              isAI && ann.confidence
                ? `${labelText} ${Math.round(ann.confidence * 100)}%`
                : labelText;
            const estLabelWidth = fullTag.length * (6.7 / zoom) + labelPadX * 2;
            const labelY = anchor.y - labelHeight > 0 ? anchor.y - labelHeight : anchor.y;

            const onSelectShape = (e: React.PointerEvent) => {
              if (spacePressed || tool === 'pan') return;
              if (tool !== 'select') return;
              e.stopPropagation();
              onSelectAnnotation(ann.id);
              if (ann.locked) return;

              const startImg = screenToImage(e.clientX, e.clientY);
              if (ann.type === 'bbox') {
                setInteraction({
                  kind: 'move_bbox',
                  annId: ann.id,
                  startImg,
                  origX: ann.x,
                  origY: ann.y,
                  width: ann.width,
                  height: ann.height,
                });
              } else if (ann.type === 'polygon' || ann.type === 'polyline') {
                setInteraction({
                  kind: 'move_poly',
                  annId: ann.id,
                  startImg,
                  origPoints: ann.points,
                });
              } else if (ann.type === 'keypoint') {
                setInteraction({ kind: 'move_keypoint', annId: ann.id });
              }
            };

            return (
              <g key={ann.id}>
                {/* BBOX */}
                {ann.type === 'bbox' && (
                  <>
                    <rect
                      x={ann.x}
                      y={ann.y}
                      width={ann.width}
                      height={ann.height}
                      fill={color}
                      fillOpacity={fillOpacity}
                      stroke={color}
                      strokeWidth={isSelected ? 2.5 : 1.75}
                      strokeDasharray={isAI ? '6 4' : undefined}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={onSelectShape}
                      className={tool === 'select' && !ann.locked ? 'cursor-move' : ''}
                    />

                    {/* 8 Resize Handles when selected */}
                    {isSelected && !ann.locked && tool === 'select' && (
                      <>
                        {(
                          [
                            ['nw', ann.x, ann.y, 'nwse-resize'],
                            ['n', ann.x + ann.width / 2, ann.y, 'ns-resize'],
                            ['ne', ann.x + ann.width, ann.y, 'nesw-resize'],
                            ['e', ann.x + ann.width, ann.y + ann.height / 2, 'ew-resize'],
                            ['se', ann.x + ann.width, ann.y + ann.height, 'nwse-resize'],
                            ['s', ann.x + ann.width / 2, ann.y + ann.height, 'ns-resize'],
                            ['sw', ann.x, ann.y + ann.height, 'nesw-resize'],
                            ['w', ann.x, ann.y + ann.height / 2, 'ew-resize'],
                          ] as Array<[ResizeHandle, number, number, string]>
                        ).map(([handle, hx, hy, cursor]) => (
                          <rect
                            key={handle}
                            x={hx - handleRadius}
                            y={hy - handleRadius}
                            width={handleRadius * 2}
                            height={handleRadius * 2}
                            fill="#0B0D10"
                            stroke={color}
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            style={{ cursor }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setInteraction({
                                kind: 'resize_bbox',
                                annId: ann.id,
                                handle,
                                orig: {
                                  x: ann.x,
                                  y: ann.y,
                                  width: ann.width,
                                  height: ann.height,
                                },
                              });
                            }}
                          />
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* POLYGON */}
                {ann.type === 'polygon' && (
                  <>
                    <polygon
                      points={ann.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill={color}
                      fillOpacity={fillOpacity}
                      stroke={color}
                      strokeWidth={isSelected ? 2.5 : 1.75}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={onSelectShape}
                      className={tool === 'select' && !ann.locked ? 'cursor-move' : ''}
                    />

                    {/* Midpoint Insertion Ghosts + Draggable Vertices */}
                    {isSelected && !ann.locked && tool === 'select' && (
                      <>
                        {ann.points.map((pt, idx) => {
                          const nextPt = ann.points[(idx + 1) % ann.points.length];
                          const mid = { x: (pt.x + nextPt.x) / 2, y: (pt.y + nextPt.y) / 2 };
                          return (
                            <circle
                              key={`mid-${idx}`}
                              cx={mid.x}
                              cy={mid.y}
                              r={handleRadius * 0.72}
                              fill="#0B0D10"
                              fillOpacity={0.75}
                              stroke={color}
                              strokeWidth={1.25}
                              strokeDasharray="2 2"
                              vectorEffect="non-scaling-stroke"
                              className="cursor-copy hover:fill-[#38BDF8]"
                              onPointerDown={(e) => handleInsertVertex(e, ann, idx, mid)}
                            />
                          );
                        })}

                        {ann.points.map((pt, idx) => (
                          <circle
                            key={`v-${idx}`}
                            cx={pt.x}
                            cy={pt.y}
                            r={handleRadius}
                            fill="#0B0D10"
                            stroke={color}
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            className="cursor-grab"
                            onPointerDown={(e) => {
                              if (e.button === 0 && !e.altKey) {
                                e.stopPropagation();
                                setInteraction({
                                  kind: 'move_vertex',
                                  annId: ann.id,
                                  vertexIndex: idx,
                                });
                              } else if (e.altKey) {
                                handleDeleteVertex(e, ann, idx);
                              }
                            }}
                            onContextMenu={(e) => handleDeleteVertex(e, ann, idx)}
                          />
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* POLYLINE */}
                {ann.type === 'polyline' && (
                  <>
                    {/* Wider transparent hit target for easier selection */}
                    <polyline
                      points={ann.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={onSelectShape}
                      className={tool === 'select' && !ann.locked ? 'cursor-move' : ''}
                    />
                    <polyline
                      points={ann.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke={color}
                      strokeWidth={isSelected ? 3 : 2.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    {/* Endpoint dots */}
                    {ann.points.map((pt, idx) => {
                      const isEnd = idx === 0 || idx === ann.points.length - 1;
                      if (!isSelected && !isEnd) return null;
                      return (
                        <circle
                          key={`lv-${idx}`}
                          cx={pt.x}
                          cy={pt.y}
                          r={isSelected ? handleRadius : handleRadius * 0.7}
                          fill={isSelected ? '#0B0D10' : color}
                          stroke={color}
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                          className={isSelected && !ann.locked ? 'cursor-grab' : ''}
                          onPointerDown={(e) => {
                            if (tool !== 'select' || ann.locked) return;
                            if (e.button === 0 && !e.altKey) {
                              e.stopPropagation();
                              onSelectAnnotation(ann.id);
                              setInteraction({
                                kind: 'move_vertex',
                                annId: ann.id,
                                vertexIndex: idx,
                              });
                            } else if (e.altKey) {
                              handleDeleteVertex(e, ann, idx);
                            }
                          }}
                          onContextMenu={(e) => handleDeleteVertex(e, ann, idx)}
                        />
                      );
                    })}

                    {/* Midpoint insertion handles for polyline */}
                    {isSelected &&
                      !ann.locked &&
                      tool === 'select' &&
                      ann.points.slice(0, -1).map((pt, idx) => {
                        const nextPt = ann.points[idx + 1];
                        const mid = { x: (pt.x + nextPt.x) / 2, y: (pt.y + nextPt.y) / 2 };
                        return (
                          <circle
                            key={`lmid-${idx}`}
                            cx={mid.x}
                            cy={mid.y}
                            r={handleRadius * 0.68}
                            fill="#0B0D10"
                            fillOpacity={0.75}
                            stroke={color}
                            strokeWidth={1.25}
                            strokeDasharray="2 2"
                            vectorEffect="non-scaling-stroke"
                            className="cursor-copy"
                            onPointerDown={(e) => handleInsertVertex(e, ann, idx, mid)}
                          />
                        );
                      })}
                  </>
                )}

                {/* KEYPOINT */}
                {ann.type === 'keypoint' && (
                  <g
                    onPointerDown={onSelectShape}
                    className={tool === 'select' && !ann.locked ? 'cursor-move' : ''}
                  >
                    <circle
                      cx={ann.x}
                      cy={ann.y}
                      r={handleRadius * 1.45}
                      fill={color}
                      fillOpacity={0.28}
                      stroke={color}
                      strokeWidth={isSelected ? 2.5 : 1.75}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={ann.x}
                      cy={ann.y}
                      r={handleRadius * 0.55}
                      fill={color}
                    />
                  </g>
                )}

                {/* Floating Hierarchical Label Tag */}
                {displaySettings.showLabels && (
                  <g pointerEvents="none">
                    <rect
                      x={anchor.x}
                      y={labelY}
                      width={estLabelWidth}
                      height={labelHeight}
                      rx={2 / zoom}
                      fill={isSelected ? color : '#0B0D10'}
                      fillOpacity={isSelected ? 0.96 : 0.86}
                      stroke={color}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={anchor.x + labelPadX}
                      y={labelY + labelHeight * 0.72}
                      fill={isSelected ? '#07090C' : '#E8ECF2'}
                      fontSize={labelFontSize}
                      fontWeight={isSelected ? 600 : 500}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {fullTag}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Active Rubber-Band Bounding Box Preview */}
          {interaction?.kind === 'draw_bbox' && (
            <g pointerEvents="none">
              <rect
                x={Math.min(interaction.start.x, interaction.current.x)}
                y={Math.min(interaction.start.y, interaction.current.y)}
                width={Math.abs(interaction.current.x - interaction.start.x)}
                height={Math.abs(interaction.current.y - interaction.start.y)}
                fill={activeTax.color}
                fillOpacity={0.18}
                stroke={activeTax.color}
                strokeWidth={2}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          {/* Active Polygon / Polyline Drawing Preview */}
          {drawingPoints.length > 0 && (
            <g pointerEvents="none">
              {tool === 'polygon' && drawingPoints.length >= 2 && (
                <polygon
                  points={[
                    ...drawingPoints,
                    ...(cursorImg ? [isNearFirstPoint ? drawingPoints[0] : cursorImg] : []),
                  ]
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill={activeTax.color}
                  fillOpacity={0.14}
                  stroke="none"
                />
              )}
              <polyline
                points={[
                  ...drawingPoints,
                  ...(cursorImg ? [isNearFirstPoint ? drawingPoints[0] : cursorImg] : []),
                ]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke={activeTax.color}
                strokeWidth={2}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
              />
              {drawingPoints.map((pt, idx) => (
                <circle
                  key={`draft-${idx}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={idx === 0 && isNearFirstPoint ? handleRadius * 1.9 : handleRadius}
                  fill={idx === 0 && isNearFirstPoint ? activeTax.color : '#0B0D10'}
                  stroke={activeTax.color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}

          {/* Full-Image Crosshair Alignment Guides */}
          {displaySettings.showCrosshair && cursorImg && tool !== 'pan' && !spacePressed && (
            <g pointerEvents="none">
              <line
                x1={cursorImg.x}
                y1={0}
                x2={cursorImg.x}
                y2={image.height}
                stroke="#38BDF8"
                strokeOpacity={0.4}
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={0}
                y1={cursorImg.y}
                x2={image.width}
                y2={cursorImg.y}
                stroke="#38BDF8"
                strokeOpacity={0.4}
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Bottom Floating Precision Viewport Bar */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-4 pointer-events-none z-20"
      >
        {/* Left: Coordinates & Tool Guidance */}
        <div className="pointer-events-auto flex items-center gap-3 px-3 py-1.5 rounded-md bg-[#12151B]/92 border border-[#232834] text-[11px] text-[#8B95A5] backdrop-blur-sm max-w-[55%]">
          <span className="font-mono tabular-nums text-[#E8ECF2] shrink-0">
            {cursorImg
              ? `X ${Math.round(cursorImg.x).toString().padStart(4, ' ')}  Y ${Math.round(cursorImg.y).toString().padStart(4, ' ')}`
              : `${image.width} × ${image.height} px`}
          </span>
          <span className="text-[#323949]" aria-hidden="true">
            |
          </span>
          <span className="truncate">{TOOL_HINTS[tool]}</span>
          {drawingPoints.length > 0 && (
            <button
              type="button"
              onClick={() => setDrawingPoints([])}
              className="text-[#EF4444] hover:underline shrink-0 ml-1"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Right: Image Navigation + Zoom Controls */}
        <div className="pointer-events-auto flex items-center gap-2 px-2 py-1 rounded-md bg-[#12151B]/92 border border-[#232834] backdrop-blur-sm">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onPrevImage}
              disabled={imageIndex <= 0}
              title="Previous Image (A / Left)"
              aria-label="Previous Image"
              className="p-1 rounded text-[#CBD5E1] hover:bg-[#181C24] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-1.5 text-[11px] font-mono tabular-nums text-[#E8ECF2]">
              {imageIndex + 1} / {totalImages}
            </span>
            <button
              type="button"
              onClick={onNextImage}
              disabled={imageIndex >= totalImages - 1}
              title="Next Image (D / Right)"
              aria-label="Next Image"
              className="p-1 rounded text-[#CBD5E1] hover:bg-[#181C24] disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="w-px h-4 bg-[#232834]" />

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => zoomCentered(1 / 1.25)}
              title="Zoom Out (-)"
              aria-label="Zoom Out"
              className="p-1 rounded text-[#CBD5E1] hover:bg-[#181C24] transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Reset to 100%"
              className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums text-[#E8ECF2] hover:bg-[#181C24] min-w-[44px] text-center"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomCentered(1.25)}
              title="Zoom In (+)"
              aria-label="Zoom In"
              className="p-1 rounded text-[#CBD5E1] hover:bg-[#181C24] transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={fitImageToViewport}
              title="Fit to Viewport (F)"
              aria-label="Fit to Viewport"
              className="p-1 rounded text-[#CBD5E1] hover:bg-[#181C24] transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {tool !== 'select' && (
            <>
              <div className="w-px h-4 bg-[#232834]" />
              <button
                type="button"
                onClick={() => onChangeTool('select')}
                className="px-2 py-0.5 rounded text-[11px] text-[#8B95A5] hover:text-white hover:bg-[#181C24] transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
