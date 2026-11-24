import type { Annotation, LabelClass, LabelObject, Point } from '../types/annotation';

export const CLASS_PALETTE = [
  '#38BDF8', // Sky Cyan
  '#F472B6', // Rose Pink
  '#34D399', // Emerald
  '#FBBF24', // Amber
  '#A78BFA', // Violet
  '#FB7185', // Coral Red
  '#2DD4BF', // Teal
  '#FB923C', // Orange
  '#818CF8', // Indigo
  '#A3E635', // Lime
  '#E879F9', // Fuchsia
  '#60A5FA', // Cobalt Blue
];

/** Shift hex luminance slightly so child objects inherit parent class hue cohesively */
export function deriveObjectColor(parentHex: string, siblingIndex: number): string {
  const clean = parentHex.replace('#', '');
  if (clean.length !== 6) return parentHex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  // Alternate subtle lighten/darken offsets around the parent hue
  const shifts = [0, 26, -24, 44, -40, 16, -14];
  const delta = shifts[siblingIndex % shifts.length];

  const clampByte = (v: number) => Math.max(30, Math.min(248, Math.round(v + delta)));
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.round(clamp(point.x, 0, width) * 10) / 10,
    y: Math.round(clamp(point.y, 0, height) * 10) / 10,
  };
}

/** Shoelace formula for polygon pixel area */
export function computePolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    sum += curr.x * next.y - next.x * curr.y;
  }
  return Math.abs(sum) / 2;
}

/** Compute Euclidean total length of a polyline in pixels */
export function computePolylineLength(points: Point[]): number {
  if (points.length < 2) return 0;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    length += Math.hypot(dx, dy);
  }
  return length;
}

/** Bounding box enclosing an array of points */
export function computePointsBBox(points: Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function getAnnotationAnchor(ann: Annotation): Point {
  switch (ann.type) {
    case 'bbox':
      return { x: ann.x, y: ann.y };
    case 'polygon':
    case 'polyline': {
      const box = computePointsBBox(ann.points);
      return { x: box.x, y: box.y };
    }
    case 'keypoint':
      return { x: ann.x, y: ann.y };
  }
}

export function getAnnotationArea(ann: Annotation): number {
  switch (ann.type) {
    case 'bbox':
      return Math.round(ann.width * ann.height);
    case 'polygon':
      return Math.round(computePolygonArea(ann.points));
    case 'polyline':
      return Math.round(computePolylineLength(ann.points));
    case 'keypoint':
      return 0;
  }
}

export interface ResolvedTaxonomy {
  labelClass: LabelClass | undefined;
  labelObject: LabelObject | undefined;
  color: string;
  className: string;
  objectName: string;
  fullLabel: string;
  visible: boolean;
}

export function resolveTaxonomy(
  classes: LabelClass[],
  classId: string,
  objectId: string
): ResolvedTaxonomy {
  const labelClass = classes.find((c) => c.id === classId);
  const labelObject = labelClass?.objects.find((o) => o.id === objectId);
  const className = labelClass?.name ?? 'Unassigned';
  const objectName = labelObject?.name ?? 'Object';
  const color = labelObject?.color ?? labelClass?.color ?? '#38BDF8';
  const visible = (labelClass?.visible ?? true) && (labelObject?.visible ?? true);
  return {
    labelClass,
    labelObject,
    color,
    className,
    objectName,
    fullLabel: `${className} / ${objectName}`,
    visible,
  };
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Downscale an image URL (blob URL or static path) to max 1024px edge JPEG
 * for fast Gemini inference, with safe error handling and timeout protection.
 */
export async function prepareImageForAI(
  imageUrl: string,
  maxDimension = 1024
): Promise<{ imageBase64: string; mimeType: string }> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to read image data (${res.status}).`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out while preparing image for AI inference.'));
      }, 10000);

      const img = new Image();
      img.onload = () => {
        clearTimeout(timer);
        try {
          const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
          const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
          const targetH = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not initialize canvas context for AI preparation.'));
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const commaIdx = dataUrl.indexOf(',');
          resolve({
            imageBase64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
            mimeType: 'image/jpeg',
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Failed to encode image for AI.'));
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Failed to decode image for AI inference.'));
      };
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Unable to read image dimensions for ${url}`));
    img.src = url;
  });
}
