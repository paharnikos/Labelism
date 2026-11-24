import type { Annotation, Point } from '../types/annotation';
import { clamp, computePointsBBox, computePolygonArea, generateId } from './geometry';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropAnnotationMode = 'clip' | 'strict' | 'drop';
export type CropOutputFormat = 'image/jpeg' | 'image/png' | 'image/webp';
export type CropSaveMode = 'new' | 'replace';

export interface CropRemapResult {
  annotations: Annotation[];
  keptCount: number;
  truncatedCount: number;
  droppedCount: number;
}

/**
 * Sutherland-Hodgman polygon clipping against axis-aligned rectangle [minX..maxX, minY..maxY].
 * Keeps clipped polygons geometrically clean and valid along the crop boundary.
 */
function clipPolygonToRect(
  points: Point[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Point[] {
  const clipEdge = (
    input: Point[],
    inside: (p: Point) => boolean,
    intersect: (a: Point, b: Point) => Point
  ): Point[] => {
    if (input.length === 0) return [];
    const output: Point[] = [];
    for (let i = 0; i < input.length; i++) {
      const curr = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const currIn = inside(curr);
      const prevIn = inside(prev);
      if (currIn) {
        if (!prevIn) output.push(intersect(prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(intersect(prev, curr));
      }
    }
    return output;
  };

  let pts = points;
  // Left (x >= minX)
  pts = clipEdge(
    pts,
    (p) => p.x >= minX,
    (a, b) => {
      const t = (minX - a.x) / (b.x - a.x || 1e-9);
      return { x: minX, y: a.y + t * (b.y - a.y) };
    }
  );
  // Right (x <= maxX)
  pts = clipEdge(
    pts,
    (p) => p.x <= maxX,
    (a, b) => {
      const t = (maxX - a.x) / (b.x - a.x || 1e-9);
      return { x: maxX, y: a.y + t * (b.y - a.y) };
    }
  );
  // Top (y >= minY)
  pts = clipEdge(
    pts,
    (p) => p.y >= minY,
    (a, b) => {
      const t = (minY - a.y) / (b.y - a.y || 1e-9);
      return { x: a.x + t * (b.x - a.x), y: minY };
    }
  );
  // Bottom (y <= maxY)
  pts = clipEdge(
    pts,
    (p) => p.y <= maxY,
    (a, b) => {
      const t = (maxY - a.y) / (b.y - a.y || 1e-9);
      return { x: a.x + t * (b.x - a.x), y: maxY };
    }
  );

  // Deduplicate near-identical consecutive vertices
  const deduped: Point[] = [];
  for (const p of pts) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) {
      deduped.push(p);
    }
  }
  if (
    deduped.length > 2 &&
    Math.hypot(
      deduped[0].x - deduped[deduped.length - 1].x,
      deduped[0].y - deduped[deduped.length - 1].y
    ) <= 0.5
  ) {
    deduped.pop();
  }
  return deduped;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function remapAnnotationsForCrop(
  annotations: Annotation[],
  crop: CropRect,
  outWidth: number,
  outHeight: number,
  mode: CropAnnotationMode,
  markTruncated: boolean,
  generateFreshIds = false
): CropRemapResult {
  if (mode === 'drop') {
    return {
      annotations: [],
      keptCount: 0,
      truncatedCount: 0,
      droppedCount: annotations.length,
    };
  }

  const cropRight = crop.x + crop.width;
  const cropBottom = crop.y + crop.height;
  const scaleX = outWidth / Math.max(1, crop.width);
  const scaleY = outHeight / Math.max(1, crop.height);

  const mapPt = (p: Point): Point => ({
    x: r1(clamp((p.x - crop.x) * scaleX, 0, outWidth)),
    y: r1(clamp((p.y - crop.y) * scaleY, 0, outHeight)),
  });

  const next: Annotation[] = [];
  let truncatedCount = 0;
  let droppedCount = 0;

  for (const ann of annotations) {
    const id = generateFreshIds ? generateId('ann') : ann.id;

    if (ann.type === 'bbox') {
      const origLeft = ann.x;
      const origTop = ann.y;
      const origRight = ann.x + ann.width;
      const origBottom = ann.y + ann.height;

      const fullyInside =
        origLeft >= crop.x - 0.5 &&
        origTop >= crop.y - 0.5 &&
        origRight <= cropRight + 0.5 &&
        origBottom <= cropBottom + 0.5;

      if (mode === 'strict' && !fullyInside) {
        droppedCount += 1;
        continue;
      }

      const clippedLeft = Math.max(crop.x, origLeft);
      const clippedTop = Math.max(crop.y, origTop);
      const clippedRight = Math.min(cropRight, origRight);
      const clippedBottom = Math.min(cropBottom, origBottom);

      const clippedW = clippedRight - clippedLeft;
      const clippedH = clippedBottom - clippedTop;
      if (clippedW < 3 || clippedH < 3) {
        droppedCount += 1;
        continue;
      }

      const wasClipped = !fullyInside;
      if (wasClipped) truncatedCount += 1;

      next.push({
        ...ann,
        id,
        x: r1((clippedLeft - crop.x) * scaleX),
        y: r1((clippedTop - crop.y) * scaleY),
        width: r1(clippedW * scaleX),
        height: r1(clippedH * scaleY),
        attributes: {
          ...ann.attributes,
          truncated: ann.attributes.truncated || (markTruncated && wasClipped),
        },
      });
    } else if (ann.type === 'polygon') {
      const fullyInside = ann.points.every(
        (p) =>
          p.x >= crop.x - 0.5 &&
          p.y >= crop.y - 0.5 &&
          p.x <= cropRight + 0.5 &&
          p.y <= cropBottom + 0.5
      );

      if (mode === 'strict' && !fullyInside) {
        droppedCount += 1;
        continue;
      }

      const clipped = fullyInside
        ? ann.points
        : clipPolygonToRect(ann.points, crop.x, crop.y, cropRight, cropBottom);

      if (clipped.length < 3 || computePolygonArea(clipped) < 12) {
        droppedCount += 1;
        continue;
      }

      const wasClipped = !fullyInside;
      if (wasClipped) truncatedCount += 1;

      next.push({
        ...ann,
        id,
        points: clipped.map(mapPt),
        attributes: {
          ...ann.attributes,
          truncated: ann.attributes.truncated || (markTruncated && wasClipped),
        },
      });
    } else if (ann.type === 'polyline') {
      const fullyInside = ann.points.every(
        (p) =>
          p.x >= crop.x - 0.5 &&
          p.y >= crop.y - 0.5 &&
          p.x <= cropRight + 0.5 &&
          p.y <= cropBottom + 0.5
      );

      if (mode === 'strict' && !fullyInside) {
        droppedCount += 1;
        continue;
      }

      const anyInside = ann.points.some(
        (p) => p.x >= crop.x && p.y >= crop.y && p.x <= cropRight && p.y <= cropBottom
      );
      if (!anyInside) {
        droppedCount += 1;
        continue;
      }

      const wasClipped = !fullyInside;
      if (wasClipped) truncatedCount += 1;

      next.push({
        ...ann,
        id,
        points: ann.points.map(mapPt),
        attributes: {
          ...ann.attributes,
          truncated: ann.attributes.truncated || (markTruncated && wasClipped),
        },
      });
    } else if (ann.type === 'keypoint') {
      const inside =
        ann.x >= crop.x && ann.y >= crop.y && ann.x <= cropRight && ann.y <= cropBottom;
      if (!inside) {
        droppedCount += 1;
        continue;
      }
      const mapped = mapPt({ x: ann.x, y: ann.y });
      next.push({
        ...ann,
        id,
        x: mapped.x,
        y: mapped.y,
      });
    }
  }

  return {
    annotations: next,
    keptCount: next.length,
    truncatedCount,
    droppedCount,
  };
}

export function computeBoundingRectForAnnotations(
  annotations: Annotation[],
  imageWidth: number,
  imageHeight: number,
  paddingPct: number
): CropRect | null {
  if (annotations.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ann of annotations) {
    if (ann.type === 'bbox') {
      minX = Math.min(minX, ann.x);
      minY = Math.min(minY, ann.y);
      maxX = Math.max(maxX, ann.x + ann.width);
      maxY = Math.max(maxY, ann.y + ann.height);
    } else if (ann.type === 'polygon' || ann.type === 'polyline') {
      const box = computePointsBBox(ann.points);
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    } else if (ann.type === 'keypoint') {
      minX = Math.min(minX, ann.x - 16);
      minY = Math.min(minY, ann.y - 16);
      maxX = Math.max(maxX, ann.x + 16);
      maxY = Math.max(maxY, ann.y + 16);
    }
  }

  if (!Number.isFinite(minX)) return null;

  const baseW = Math.max(16, maxX - minX);
  const baseH = Math.max(16, maxY - minY);
  const padX = baseW * (paddingPct / 100);
  const padY = baseH * (paddingPct / 100);

  const left = Math.round(clamp(minX - padX, 0, imageWidth - 16));
  const top = Math.round(clamp(minY - padY, 0, imageHeight - 16));
  const right = Math.round(clamp(maxX + padX, left + 16, imageWidth));
  const bottom = Math.round(clamp(maxY + padY, top + 16, imageHeight));

  return {
    x: left,
    y: top,
    width: Math.max(16, right - left),
    height: Math.max(16, bottom - top),
  };
}

export async function renderCroppedImageBlob(
  imageUrl: string,
  crop: CropRect,
  outWidth: number,
  outHeight: number,
  mimeType: CropOutputFormat,
  quality: number
): Promise<{ blob: Blob; width: number; height: number; mimeType: CropOutputFormat }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const targetW = Math.max(1, Math.round(outWidth));
      const targetH = Math.max(1, Math.round(outHeight));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not initialize canvas context for cropping.'));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        img,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        targetW,
        targetH
      );
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to encode cropped image.'));
            return;
          }
          resolve({ blob, width: targetW, height: targetH, mimeType });
        },
        mimeType,
        mimeType === 'image/png' ? undefined : clamp(quality / 100, 0.5, 1)
      );
    };
    img.onerror = () => reject(new Error('Failed to load source image for cropping.'));
    img.src = imageUrl;
  });
}

export function buildCroppedFileName(
  originalName: string,
  mimeType: CropOutputFormat,
  suffix = 'crop'
): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = originalName.replace(/\.[^/.]+$/, '');
  return `${base}_${suffix}.${ext}`;
}

export type CropAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right';
export type BatchResizeMode =
  | 'fit'
  | 'letterbox'
  | 'fill'
  | 'exact'
  | 'longest'
  | 'scale';

export interface ResizeTransformPlan {
  /** Source rectangle taken from the original image */
  srcCrop: CropRect;
  /** Final output canvas dimensions */
  outWidth: number;
  outHeight: number;
  /** Destination rectangle inside the output canvas (non-zero offset for letterbox) */
  dstX: number;
  dstY: number;
  dstWidth: number;
  dstHeight: number;
}

/**
 * Computes the largest crop rectangle inside (imgW, imgH) with the given targetAspect (w/h),
 * positioned according to anchor.
 */
export function computeAspectCropRect(
  imgW: number,
  imgH: number,
  targetAspect: number,
  anchor: CropAnchor = 'center'
): CropRect {
  const currentAspect = imgW / Math.max(1, imgH);
  let width = imgW;
  let height = imgH;

  if (currentAspect > targetAspect) {
    height = imgH;
    width = Math.max(16, Math.round(imgH * targetAspect));
  } else {
    width = imgW;
    height = Math.max(16, Math.round(imgW / targetAspect));
  }

  let x = Math.round((imgW - width) / 2);
  let y = Math.round((imgH - height) / 2);

  if (anchor === 'top') y = 0;
  else if (anchor === 'bottom') y = imgH - height;
  else if (anchor === 'left') x = 0;
  else if (anchor === 'right') x = imgW - width;

  return {
    x: clamp(x, 0, Math.max(0, imgW - width)),
    y: clamp(y, 0, Math.max(0, imgH - height)),
    width: Math.min(imgW, width),
    height: Math.min(imgH, height),
  };
}

/**
 * Computes a crop rectangle by trimming percentage margins from each edge.
 */
export function computePercentageInsetCrop(
  imgW: number,
  imgH: number,
  topPct: number,
  rightPct: number,
  bottomPct: number,
  leftPct: number
): CropRect {
  const left = Math.round((clamp(leftPct, 0, 45) / 100) * imgW);
  const right = Math.round((clamp(rightPct, 0, 45) / 100) * imgW);
  const top = Math.round((clamp(topPct, 0, 45) / 100) * imgH);
  const bottom = Math.round((clamp(bottomPct, 0, 45) / 100) * imgH);

  const width = Math.max(16, imgW - left - right);
  const height = Math.max(16, imgH - top - bottom);

  return {
    x: clamp(left, 0, Math.max(0, imgW - width)),
    y: clamp(top, 0, Math.max(0, imgH - height)),
    width,
    height,
  };
}

/**
 * Computes source crop, destination draw rect, and output canvas size for batch resizing.
 */
export function computeResizePlan(
  srcW: number,
  srcH: number,
  mode: BatchResizeMode,
  targetW: number,
  targetH: number,
  scalePct = 100
): ResizeTransformPlan {
  const safeW = Math.max(16, Math.round(targetW));
  const safeH = Math.max(16, Math.round(targetH));

  if (mode === 'exact') {
    return {
      srcCrop: { x: 0, y: 0, width: srcW, height: srcH },
      outWidth: safeW,
      outHeight: safeH,
      dstX: 0,
      dstY: 0,
      dstWidth: safeW,
      dstHeight: safeH,
    };
  }

  if (mode === 'fit') {
    const scale = Math.min(safeW / Math.max(1, srcW), safeH / Math.max(1, srcH));
    const outWidth = Math.max(16, Math.round(srcW * scale));
    const outHeight = Math.max(16, Math.round(srcH * scale));
    return {
      srcCrop: { x: 0, y: 0, width: srcW, height: srcH },
      outWidth,
      outHeight,
      dstX: 0,
      dstY: 0,
      dstWidth: outWidth,
      dstHeight: outHeight,
    };
  }

  if (mode === 'letterbox') {
    const scale = Math.min(safeW / Math.max(1, srcW), safeH / Math.max(1, srcH));
    const dstWidth = Math.max(16, Math.round(srcW * scale));
    const dstHeight = Math.max(16, Math.round(srcH * scale));
    const dstX = Math.round((safeW - dstWidth) / 2);
    const dstY = Math.round((safeH - dstHeight) / 2);
    return {
      srcCrop: { x: 0, y: 0, width: srcW, height: srcH },
      outWidth: safeW,
      outHeight: safeH,
      dstX,
      dstY,
      dstWidth,
      dstHeight,
    };
  }

  if (mode === 'fill') {
    const crop = computeAspectCropRect(srcW, srcH, safeW / safeH, 'center');
    return {
      srcCrop: crop,
      outWidth: safeW,
      outHeight: safeH,
      dstX: 0,
      dstY: 0,
      dstWidth: safeW,
      dstHeight: safeH,
    };
  }

  if (mode === 'longest') {
    const maxEdge = Math.max(srcW, srcH, 1);
    const scale = safeW / maxEdge;
    const outWidth = Math.max(16, Math.round(srcW * scale));
    const outHeight = Math.max(16, Math.round(srcH * scale));
    return {
      srcCrop: { x: 0, y: 0, width: srcW, height: srcH },
      outWidth,
      outHeight,
      dstX: 0,
      dstY: 0,
      dstWidth: outWidth,
      dstHeight: outHeight,
    };
  }

  // 'scale'
  const factor = clamp(scalePct, 10, 400) / 100;
  const outWidth = Math.max(16, Math.round(srcW * factor));
  const outHeight = Math.max(16, Math.round(srcH * factor));
  return {
    srcCrop: { x: 0, y: 0, width: srcW, height: srcH },
    outWidth,
    outHeight,
    dstX: 0,
    dstY: 0,
    dstWidth: outWidth,
    dstHeight: outHeight,
  };
}

/**
 * Renders a resized (or letterbox-padded / center-fill cropped) image blob via Canvas.
 */
export async function renderResizedImageBlob(
  imageUrl: string,
  plan: ResizeTransformPlan,
  mimeType: CropOutputFormat,
  quality: number,
  padColor = '#000000'
): Promise<{ blob: Blob; width: number; height: number; mimeType: CropOutputFormat }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = plan.outWidth;
      canvas.height = plan.outHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not initialize canvas context for resizing.'));
        return;
      }

      if (plan.dstX > 0 || plan.dstY > 0 || plan.dstWidth < plan.outWidth || plan.dstHeight < plan.outHeight) {
        ctx.fillStyle = padColor;
        ctx.fillRect(0, 0, plan.outWidth, plan.outHeight);
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        img,
        plan.srcCrop.x,
        plan.srcCrop.y,
        plan.srcCrop.width,
        plan.srcCrop.height,
        plan.dstX,
        plan.dstY,
        plan.dstWidth,
        plan.dstHeight
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to encode resized image.'));
            return;
          }
          resolve({ blob, width: plan.outWidth, height: plan.outHeight, mimeType });
        },
        mimeType,
        mimeType === 'image/png' ? undefined : clamp(quality / 100, 0.5, 1)
      );
    };
    img.onerror = () => reject(new Error('Failed to load source image for resizing.'));
    img.src = imageUrl;
  });
}

/**
 * Remaps all annotation geometry through a ResizeTransformPlan (handles crop, scale, and letterbox offset).
 */
export function remapAnnotationsForResize(
  annotations: Annotation[],
  plan: ResizeTransformPlan,
  mode: CropAnnotationMode,
  markTruncated: boolean,
  generateFreshIds = false
): CropRemapResult {
  // First clip/scale into the destination draw box (dstWidth x dstHeight)
  const base = remapAnnotationsForCrop(
    annotations,
    plan.srcCrop,
    plan.dstWidth,
    plan.dstHeight,
    mode,
    markTruncated,
    generateFreshIds
  );

  if (plan.dstX === 0 && plan.dstY === 0) {
    return base;
  }

  // Offset coordinates by letterbox padding (dstX, dstY)
  const offsetAnns = base.annotations.map((ann) => {
    if (ann.type === 'bbox') {
      return {
        ...ann,
        x: r1(ann.x + plan.dstX),
        y: r1(ann.y + plan.dstY),
      };
    }
    if (ann.type === 'polygon' || ann.type === 'polyline') {
      return {
        ...ann,
        points: ann.points.map((p) => ({ x: r1(p.x + plan.dstX), y: r1(p.y + plan.dstY) })),
      };
    }
    return {
      ...ann,
      x: r1(ann.x + plan.dstX),
      y: r1(ann.y + plan.dstY),
    };
  });

  return {
    ...base,
    annotations: offsetAnns,
  };
}

