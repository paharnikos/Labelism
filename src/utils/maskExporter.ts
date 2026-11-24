import JSZip from 'jszip';
import type {
  Annotation,
  BBoxAnnotation,
  DatasetImage,
  LabelClass,
  PolygonAnnotation,
  Project,
} from '../types/annotation';
import { clamp, computePointsBBox, computePolygonArea, resolveTaxonomy } from './geometry';
import { getImageBlob } from './db';
import { filterImagesForExport, type ExportOptions } from './exporters';

export type MaskOutputMode = 'binary_mask' | 'alpha_cutout' | 'paired_crop_and_mask';
export type MaskShapeFilter = 'both' | 'polygon' | 'bbox';
export type MaskFolderStructure = 'by_class' | 'by_image' | 'flat';

export interface MaskExportConfig {
  mode: MaskOutputMode;
  shapeFilter: MaskShapeFilter;
  paddingPx: number;
  folderStructure: MaskFolderStructure;
  includeManifest: boolean;
}

export type MaskableAnnotation = PolygonAnnotation | BBoxAnnotation;

export interface MaskExportItem {
  image: DatasetImage;
  annotation: MaskableAnnotation;
  indexInImage: number;
  className: string;
  objectName: string;
  color: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export interface MaskPreviewSample {
  id: string;
  fileName: string;
  className: string;
  objectName: string;
  color: string;
  annotationType: 'polygon' | 'bbox';
  width: number;
  height: number;
  primaryDataUrl: string;
  secondaryMaskDataUrl?: string;
}

export interface MaskZipProgress {
  phase: 'rendering' | 'compressing';
  processed: number;
  total: number;
  currentFile?: string;
}

export interface MaskZipResult {
  blob: Blob;
  exportedObjects: number;
  fileCount: number;
  skippedImages: number;
}

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  return cleaned || fallback;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || 'image';
}

export function isMaskableAnnotation(ann: Annotation): ann is MaskableAnnotation {
  if (ann.type === 'bbox') {
    return ann.width > 0 && ann.height > 0;
  }
  if (ann.type === 'polygon') {
    return ann.points.length >= 3;
  }
  return false;
}

function computeCropRect(
  ann: MaskableAnnotation,
  imgWidth: number,
  imgHeight: number,
  paddingPx: number
): { x: number; y: number; width: number; height: number } {
  const pad = Math.max(0, Math.min(256, Math.round(paddingPx)));
  const raw =
    ann.type === 'bbox'
      ? { x: ann.x, y: ann.y, width: ann.width, height: ann.height }
      : computePointsBBox(ann.points);

  const x1 = clamp(Math.floor(raw.x - pad), 0, Math.max(0, imgWidth - 1));
  const y1 = clamp(Math.floor(raw.y - pad), 0, Math.max(0, imgHeight - 1));
  const x2 = clamp(Math.ceil(raw.x + raw.width + pad), x1 + 1, Math.max(1, imgWidth));
  const y2 = clamp(Math.ceil(raw.y + raw.height + pad), y1 + 1, Math.max(1, imgHeight));

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

export function collectMaskExportItems(
  images: DatasetImage[],
  classes: LabelClass[],
  exportOptions: ExportOptions,
  maskConfig: MaskExportConfig
): MaskExportItem[] {
  const matched = filterImagesForExport(images, exportOptions);
  const items: MaskExportItem[] = [];

  for (const img of matched) {
    let idx = 0;
    for (const ann of img.annotations) {
      if (!exportOptions.includeAiSuggestions && ann.source === 'ai_suggestion') continue;
      if (!isMaskableAnnotation(ann)) continue;
      if (maskConfig.shapeFilter === 'polygon' && ann.type !== 'polygon') continue;
      if (maskConfig.shapeFilter === 'bbox' && ann.type !== 'bbox') continue;

      idx += 1;
      const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
      const rect = computeCropRect(ann, img.width, img.height, maskConfig.paddingPx);

      items.push({
        image: img,
        annotation: ann,
        indexInImage: idx,
        className: tax.className,
        objectName: tax.objectName,
        color: tax.color,
        cropX: rect.x,
        cropY: rect.y,
        cropWidth: rect.width,
        cropHeight: rect.height,
      });
    }
  }

  return items;
}

function traceAnnotationPath(
  ctx: CanvasRenderingContext2D,
  ann: MaskableAnnotation,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number
) {
  ctx.beginPath();
  if (ann.type === 'polygon') {
    ann.points.forEach((pt, idx) => {
      const lx = (pt.x - offsetX) * scaleX;
      const ly = (pt.y - offsetY) * scaleY;
      if (idx === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    });
    ctx.closePath();
  } else {
    const lx = (ann.x - offsetX) * scaleX;
    const ly = (ann.y - offsetY) * scaleY;
    ctx.rect(lx, ly, ann.width * scaleX, ann.height * scaleY);
  }
}

function renderBinaryMaskCanvas(
  item: MaskExportItem,
  scaleX = 1,
  scaleY = 1
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(item.cropWidth * scaleX));
  const h = Math.max(1, Math.round(item.cropHeight * scaleY));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize 2D canvas for mask export.');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#FFFFFF';
  traceAnnotationPath(ctx, item.annotation, item.cropX, item.cropY, scaleX, scaleY);
  ctx.fill();
  return canvas;
}

function renderAlphaCutoutCanvas(
  item: MaskExportItem,
  sourceImg: HTMLImageElement
): HTMLCanvasElement {
  const scaleX = item.image.width > 0 ? sourceImg.naturalWidth / item.image.width : 1;
  const scaleY = item.image.height > 0 ? sourceImg.naturalHeight / item.image.height : 1;
  const sx = Math.round(item.cropX * scaleX);
  const sy = Math.round(item.cropY * scaleY);
  const sw = Math.max(1, Math.round(item.cropWidth * scaleX));
  const sh = Math.max(1, Math.round(item.cropHeight * scaleY));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize 2D canvas for cutout export.');

  ctx.clearRect(0, 0, sw, sh);
  ctx.save();
  traceAnnotationPath(ctx, item.annotation, item.cropX, item.cropY, scaleX, scaleY);
  ctx.clip();
  ctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
  return canvas;
}

function renderRgbCropCanvas(
  item: MaskExportItem,
  sourceImg: HTMLImageElement
): HTMLCanvasElement {
  const scaleX = item.image.width > 0 ? sourceImg.naturalWidth / item.image.width : 1;
  const scaleY = item.image.height > 0 ? sourceImg.naturalHeight / item.image.height : 1;
  const sx = Math.round(item.cropX * scaleX);
  const sy = Math.round(item.cropY * scaleY);
  const sw = Math.max(1, Math.round(item.cropWidth * scaleX));
  const sh = Math.max(1, Math.round(item.cropHeight * scaleY));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize 2D canvas for RGB crop.');

  ctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode PNG mask blob.'));
      },
      'image/png'
    );
  });
}

async function loadImageElement(
  img: DatasetImage,
  imageUrls: Record<string, string>
): Promise<{ element: HTMLImageElement; revokeUrl: string | null }> {
  let src = imageUrls[img.id] || '';
  let revokeUrl: string | null = null;

  if (!src) {
    const blob = await getImageBlob(img.id);
    if (blob) {
      src = URL.createObjectURL(blob);
      revokeUrl = src;
    } else if (img.seedUrl) {
      src = img.seedUrl;
    }
  }

  if (!src) {
    throw new Error(`Image data not available for ${img.fileName}`);
  }

  const element = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Unable to decode image ${img.fileName}`));
    el.src = src;
  });

  return { element, revokeUrl };
}

function buildItemRelativePath(
  item: MaskExportItem,
  folderStructure: MaskFolderStructure,
  suffix: string
): string {
  const imgSlug = sanitizeSegment(stripExtension(item.image.fileName), 'image');
  const clsSlug = sanitizeSegment(item.className, 'class');
  const objSlug = sanitizeSegment(item.objectName, 'object');
  const seq = String(item.indexInImage).padStart(3, '0');
  const typeTag = item.annotation.type === 'polygon' ? 'poly' : 'bbox';

  if (folderStructure === 'by_class') {
    return `${clsSlug}/${objSlug}/${imgSlug}_${seq}_${typeTag}${suffix}.png`;
  }
  if (folderStructure === 'by_image') {
    return `${imgSlug}/${clsSlug}_${objSlug}_${seq}_${typeTag}${suffix}.png`;
  }
  return `${imgSlug}__${clsSlug}__${objSlug}__${seq}_${typeTag}${suffix}.png`;
}

function ensureUniquePath(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf('.');
  const stem = dot >= 0 ? candidate.slice(0, dot) : candidate;
  const ext = dot >= 0 ? candidate.slice(dot) : '';
  let n = 2;
  while (used.has(`${stem}_${n}${ext}`)) {
    n += 1;
  }
  const unique = `${stem}_${n}${ext}`;
  used.add(unique);
  return unique;
}

/**
 * Generates up to `limit` small preview data URLs for live visual feedback in ExportView
 */
export async function renderMaskPreviewSamples(
  items: MaskExportItem[],
  imageUrls: Record<string, string>,
  mode: MaskOutputMode,
  limit = 6
): Promise<MaskPreviewSample[]> {
  const subset = items.slice(0, limit);
  const loadedCache = new Map<string, { element: HTMLImageElement; revokeUrl: string | null }>();
  const results: MaskPreviewSample[] = [];

  try {
    for (const item of subset) {
      let primaryDataUrl = '';
      let secondaryMaskDataUrl: string | undefined;

      if (mode === 'binary_mask') {
        const maskCanvas = renderBinaryMaskCanvas(item);
        primaryDataUrl = maskCanvas.toDataURL('image/png');
      } else {
        let loaded = loadedCache.get(item.image.id);
        if (!loaded) {
          try {
            loaded = await loadImageElement(item.image, imageUrls);
            loadedCache.set(item.image.id, loaded);
          } catch {
            continue;
          }
        }

        if (mode === 'alpha_cutout') {
          const cutoutCanvas = renderAlphaCutoutCanvas(item, loaded.element);
          primaryDataUrl = cutoutCanvas.toDataURL('image/png');
        } else {
          const rgbCanvas = renderRgbCropCanvas(item, loaded.element);
          const scaleX = item.image.width > 0 ? loaded.element.naturalWidth / item.image.width : 1;
          const scaleY =
            item.image.height > 0 ? loaded.element.naturalHeight / item.image.height : 1;
          const maskCanvas = renderBinaryMaskCanvas(item, scaleX, scaleY);
          primaryDataUrl = rgbCanvas.toDataURL('image/png');
          secondaryMaskDataUrl = maskCanvas.toDataURL('image/png');
        }
      }

      results.push({
        id: `${item.image.id}_${item.annotation.id}`,
        fileName: item.image.fileName,
        className: item.className,
        objectName: item.objectName,
        color: item.color,
        annotationType: item.annotation.type,
        width: item.cropWidth,
        height: item.cropHeight,
        primaryDataUrl,
        secondaryMaskDataUrl,
      });
    }
  } finally {
    for (const entry of loadedCache.values()) {
      if (entry.revokeUrl) URL.revokeObjectURL(entry.revokeUrl);
    }
  }

  return results;
}

/**
 * Generates a ZIP archive containing individual cropped PNG masks/cutouts for every
 * matched polygon or bounding box annotation, plus an optional manifest.json.
 */
export async function generateObjectMasksZip(params: {
  project: Project;
  items: MaskExportItem[];
  imageUrls: Record<string, string>;
  config: MaskExportConfig;
  onProgress?: (progress: MaskZipProgress) => void;
  signal?: AbortSignal;
}): Promise<MaskZipResult> {
  const { project, items, imageUrls, config, onProgress, signal } = params;
  if (items.length === 0) {
    throw new Error('No polygon or bounding box annotations match the current filters.');
  }

  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const manifestEntries: Array<Record<string, unknown>> = [];

  // Group items by source image so each image is decoded only once
  const byImage = new Map<string, MaskExportItem[]>();
  for (const item of items) {
    const group = byImage.get(item.image.id);
    if (group) group.push(item);
    else byImage.set(item.image.id, [item]);
  }

  let processed = 0;
  let exportedObjects = 0;
  let fileCount = 0;
  let skippedImages = 0;
  const needsPixels = config.mode !== 'binary_mask';

  for (const [, group] of byImage.entries()) {
    if (signal?.aborted) {
      throw new DOMException('Mask export cancelled.', 'AbortError');
    }

    const srcImageMeta = group[0].image;
    let loaded: { element: HTMLImageElement; revokeUrl: string | null } | null = null;

    if (needsPixels) {
      try {
        loaded = await loadImageElement(srcImageMeta, imageUrls);
      } catch {
        skippedImages += 1;
        processed += group.length;
        onProgress?.({
          phase: 'rendering',
          processed,
          total: items.length,
          currentFile: srcImageMeta.fileName,
        });
        continue;
      }
    }

    try {
      const scaleX =
        loaded && srcImageMeta.width > 0 ? loaded.element.naturalWidth / srcImageMeta.width : 1;
      const scaleY =
        loaded && srcImageMeta.height > 0 ? loaded.element.naturalHeight / srcImageMeta.height : 1;

      for (const item of group) {
        if (signal?.aborted) {
          throw new DOMException('Mask export cancelled.', 'AbortError');
        }

        const localPolygon =
          item.annotation.type === 'polygon'
            ? item.annotation.points.map((p) => [
                Math.round((p.x - item.cropX) * 100) / 100,
                Math.round((p.y - item.cropY) * 100) / 100,
              ])
            : undefined;

        const areaPx =
          item.annotation.type === 'polygon'
            ? Math.round(computePolygonArea(item.annotation.points))
            : Math.round(item.annotation.width * item.annotation.height);

        const baseManifest = {
          source_image: item.image.fileName,
          split: item.image.split,
          status: item.image.status,
          class_name: item.className,
          object_name: item.objectName,
          annotation_id: item.annotation.id,
          annotation_type: item.annotation.type,
          crop_bbox: [item.cropX, item.cropY, item.cropWidth, item.cropHeight],
          area_px: areaPx,
          attributes: item.annotation.attributes,
          ...(item.annotation.note ? { note: item.annotation.note } : {}),
          ...(localPolygon ? { local_polygon: localPolygon } : {}),
        };

        if (config.mode === 'binary_mask') {
          const canvas = renderBinaryMaskCanvas(item);
          const pngBlob = await canvasToPngBlob(canvas);
          const path = ensureUniquePath(
            buildItemRelativePath(item, config.folderStructure, '_mask'),
            usedPaths
          );
          zip.file(path, pngBlob);
          fileCount += 1;
          exportedObjects += 1;
          manifestEntries.push({
            ...baseManifest,
            mask_file: path,
            mask_size: [canvas.width, canvas.height],
          });
        } else if (config.mode === 'alpha_cutout' && loaded) {
          const canvas = renderAlphaCutoutCanvas(item, loaded.element);
          const pngBlob = await canvasToPngBlob(canvas);
          const path = ensureUniquePath(
            buildItemRelativePath(item, config.folderStructure, '_cutout'),
            usedPaths
          );
          zip.file(path, pngBlob);
          fileCount += 1;
          exportedObjects += 1;
          manifestEntries.push({
            ...baseManifest,
            cutout_file: path,
            cutout_size: [canvas.width, canvas.height],
          });
        } else if (config.mode === 'paired_crop_and_mask' && loaded) {
          const rgbCanvas = renderRgbCropCanvas(item, loaded.element);
          const maskCanvas = renderBinaryMaskCanvas(item, scaleX, scaleY);
          const [rgbBlob, maskBlob] = await Promise.all([
            canvasToPngBlob(rgbCanvas),
            canvasToPngBlob(maskCanvas),
          ]);

          const rgbPath = ensureUniquePath(
            `images/${buildItemRelativePath(item, config.folderStructure, '')}`,
            usedPaths
          );
          const maskPath = ensureUniquePath(
            `masks/${buildItemRelativePath(item, config.folderStructure, '_mask')}`,
            usedPaths
          );

          zip.file(rgbPath, rgbBlob);
          zip.file(maskPath, maskBlob);
          fileCount += 2;
          exportedObjects += 1;
          manifestEntries.push({
            ...baseManifest,
            image_file: rgbPath,
            mask_file: maskPath,
            size: [rgbCanvas.width, rgbCanvas.height],
          });
        }

        processed += 1;
        onProgress?.({
          phase: 'rendering',
          processed,
          total: items.length,
          currentFile: item.image.fileName,
        });
      }
    } finally {
      if (loaded?.revokeUrl) {
        URL.revokeObjectURL(loaded.revokeUrl);
      }
    }
  }

  if (exportedObjects === 0) {
    throw new Error(
      'Unable to render any object masks. Ensure source images are loaded and try again.'
    );
  }

  if (config.includeManifest) {
    const manifestPayload = {
      format: 'reticle-cropped-masks-v1',
      project: project.name,
      exported_at: new Date().toISOString(),
      mode: config.mode,
      shape_filter: config.shapeFilter,
      padding_px: config.paddingPx,
      folder_structure: config.folderStructure,
      total_objects: exportedObjects,
      items: manifestEntries,
    };
    zip.file('manifest.json', JSON.stringify(manifestPayload, null, 2));
    fileCount += 1;
  }

  onProgress?.({
    phase: 'compressing',
    processed: items.length,
    total: items.length,
  });

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { blob, exportedObjects, fileCount, skippedImages };
}
