import type { DatasetImage } from '../types/annotation';
import { getImageBlob } from './db';

export interface ImageLuminanceMetrics {
  imageId: string;
  fileName: string;
  split: DatasetImage['split'];
  /** Mean Rec. 709 perceived luminance normalized to 0..100% */
  brightness: number;
  /** RMS luminance contrast (standard deviation / 127.5) normalized to 0..100% */
  contrast: number;
}

const metricsCache = new Map<string, { brightness: number; contrast: number }>();

const SAMPLE_MAX_EDGE = 96;

function measureImageElement(el: HTMLImageElement): { brightness: number; contrast: number } {
  const natW = el.naturalWidth || el.width || 1;
  const natH = el.naturalHeight || el.height || 1;
  const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(natW, natH));
  const w = Math.max(1, Math.round(natW * scale));
  const h = Math.max(1, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { brightness: 50, contrast: 0 };
  }

  ctx.drawImage(el, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    // Ignore fully transparent pixels so RGBA cutouts don't skew luminance
    if (data[i + 3] < 16) continue;
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    count += 1;
  }

  if (count === 0) {
    return { brightness: 0, contrast: 0 };
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const stdDev = Math.sqrt(variance);

  const brightness = Math.round((mean / 255) * 1000) / 10;
  const contrast = Math.min(100, Math.round((stdDev / 127.5) * 1000) / 10);

  return { brightness, contrast };
}

async function decodeAndMeasure(
  img: DatasetImage,
  imageUrls: Record<string, string>
): Promise<{ brightness: number; contrast: number } | null> {
  let src = imageUrls[img.id] || '';
  let tempBlobUrl: string | null = null;

  if (!src) {
    try {
      const blob = await getImageBlob(img.id);
      if (blob) {
        src = URL.createObjectURL(blob);
        tempBlobUrl = src;
      } else if (img.seedUrl) {
        src = img.seedUrl;
      }
    } catch {
      if (img.seedUrl) src = img.seedUrl;
    }
  }

  if (!src) return null;

  const cacheKey = `${img.id}::${img.updatedAt}::${tempBlobUrl ? 'blob' : src}`;
  const cached = metricsCache.get(cacheKey);
  if (cached) {
    if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl);
    return cached;
  }

  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode ${img.fileName}`));
      el.src = src;
    });

    const measured = measureImageElement(element);
    metricsCache.set(cacheKey, measured);
    return measured;
  } catch {
    return null;
  } finally {
    if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl);
  }
}

/**
 * Measures brightness & RMS contrast for all project images in lightweight batches,
 * caching measurements across renders and supporting clean cancellation.
 */
export async function analyzeProjectImageLighting(
  images: DatasetImage[],
  imageUrls: Record<string, string>,
  isCancelled: () => boolean
): Promise<ImageLuminanceMetrics[]> {
  const results: ImageLuminanceMetrics[] = [];
  const BATCH_SIZE = 6;

  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    if (isCancelled()) return results;
    const chunk = images.slice(i, i + BATCH_SIZE);
    const measured = await Promise.all(
      chunk.map(async (img) => {
        const stats = await decodeAndMeasure(img, imageUrls);
        if (!stats) return null;
        return {
          imageId: img.id,
          fileName: img.fileName,
          split: img.split,
          brightness: stats.brightness,
          contrast: stats.contrast,
        } satisfies ImageLuminanceMetrics;
      })
    );
    for (const item of measured) {
      if (item) results.push(item);
    }
  }

  return results;
}
