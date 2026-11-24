import type {
  Annotation,
  DatasetImage,
  LabelClass,
  Project,
  ReviewStatus,
  SplitType,
} from '../types/annotation';
import {
  computePointsBBox,
  computePolygonArea,
  computePolylineLength,
  deriveObjectColor,
  generateId,
  resolveTaxonomy,
  CLASS_PALETTE,
} from './geometry';

export interface ExportOptions {
  splits: SplitType[];
  verifiedOnly: boolean;
  includeAiSuggestions: boolean;
}

export function filterImagesForExport(
  images: DatasetImage[],
  options: ExportOptions
): DatasetImage[] {
  return images.filter((img) => {
    if (!options.splits.includes(img.split)) return false;
    if (options.verifiedOnly && img.status !== 'verified') return false;
    return true;
  });
}

function filterAnnotations(annotations: Annotation[], includeAi: boolean): Annotation[] {
  return annotations.filter((a) => includeAi || a.source !== 'ai_suggestion');
}

/**
 * Standard COCO JSON exporter:
 * - Maps every Object to a COCO `category` with `supercategory: Class.name` and `name: Object.name`
 * - Emits standard `bbox: [x,y,w,h]`, `segmentation: [[x1,y1,...]]`, `area`, `iscrowd`
 * - Emits `captions` list and preserves `polylines` & `keypoints` cleanly
 */
export function exportToCOCO(
  project: Project,
  allImages: DatasetImage[],
  options: ExportOptions
): string {
  const images = filterImagesForExport(allImages, options);

  // Build deterministic category table (1-indexed per COCO convention)
  const categoryIndex = new Map<string, number>();
  const categories: Array<{
    id: number;
    name: string;
    supercategory: string;
    color: string;
  }> = [];

  let nextCatId = 1;
  for (const cls of project.classes) {
    for (const obj of cls.objects) {
      const key = `${cls.id}::${obj.id}`;
      categoryIndex.set(key, nextCatId);
      categories.push({
        id: nextCatId,
        name: obj.name,
        supercategory: cls.name,
        color: obj.color,
      });
      nextCatId += 1;
    }
  }

  const cocoImages = images.map((img, idx) => ({
    id: idx + 1,
    file_name: img.fileName,
    width: img.width,
    height: img.height,
    split: img.split,
    status: img.status,
    tags: img.tags,
    caption: img.caption,
    short_caption: img.shortCaption,
  }));

  const cocoAnnotations: Array<Record<string, unknown>> = [];
  const cocoCaptions: Array<{ id: number; image_id: number; caption: string; short_caption: string }> =
    [];

  let nextAnnId = 1;
  let nextCapId = 1;

  images.forEach((img, idx) => {
    const imageId = idx + 1;
    if (img.caption.trim() || img.shortCaption.trim()) {
      cocoCaptions.push({
        id: nextCapId++,
        image_id: imageId,
        caption: img.caption.trim(),
        short_caption: img.shortCaption.trim(),
      });
    }

    const anns = filterAnnotations(img.annotations, options.includeAiSuggestions);
    for (const ann of anns) {
      const catId = categoryIndex.get(`${ann.classId}::${ann.objectId}`) ?? 1;
      const tax = resolveTaxonomy(project.classes, ann.classId, ann.objectId);
      const baseMeta = {
        id: nextAnnId++,
        image_id: imageId,
        category_id: catId,
        supercategory: tax.className,
        category_name: tax.objectName,
        iscrowd: ann.attributes.crowd ? 1 : 0,
        attributes: {
          occluded: ann.attributes.occluded,
          truncated: ann.attributes.truncated,
        },
        ...(ann.note ? { note: ann.note } : {}),
        ...(ann.source === 'ai_suggestion' ? { source: 'ai_suggestion', score: ann.confidence } : {}),
      };

      if (ann.type === 'bbox') {
        cocoAnnotations.push({
          ...baseMeta,
          annotation_type: 'bbox',
          bbox: [
            round2(ann.x),
            round2(ann.y),
            round2(ann.width),
            round2(ann.height),
          ],
          area: round2(ann.width * ann.height),
          segmentation: [],
        });
      } else if (ann.type === 'polygon') {
        const box = computePointsBBox(ann.points);
        const flat = ann.points.flatMap((p) => [round2(p.x), round2(p.y)]);
        cocoAnnotations.push({
          ...baseMeta,
          annotation_type: 'polygon',
          bbox: [round2(box.x), round2(box.y), round2(box.width), round2(box.height)],
          area: round2(computePolygonArea(ann.points)),
          segmentation: [flat],
        });
      } else if (ann.type === 'polyline') {
        const box = computePointsBBox(ann.points);
        const flat = ann.points.flatMap((p) => [round2(p.x), round2(p.y)]);
        cocoAnnotations.push({
          ...baseMeta,
          annotation_type: 'polyline',
          bbox: [round2(box.x), round2(box.y), round2(box.width), round2(box.height)],
          area: 0,
          length_px: round2(computePolylineLength(ann.points)),
          polyline: flat,
          segmentation: [],
        });
      } else if (ann.type === 'keypoint') {
        cocoAnnotations.push({
          ...baseMeta,
          annotation_type: 'keypoint',
          bbox: [round2(ann.x), round2(ann.y), 0, 0],
          area: 0,
          keypoints: [round2(ann.x), round2(ann.y), 2],
          num_keypoints: 1,
          segmentation: [],
        });
      }
    }
  });

  const payload = {
    info: {
      description: project.name,
      notes: project.description,
      version: '1.0',
      year: new Date().getFullYear(),
      contributor: 'Reticle Studio',
      date_created: new Date().toISOString(),
    },
    licenses: [{ id: 1, name: 'Local Dataset', url: '' }],
    categories,
    images: cocoImages,
    annotations: cocoAnnotations,
    captions: cocoCaptions,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * JSONL exporter tailored for VLM / Multimodal fine-tuning & object detection pipelines
 */
export function exportToJSONL(
  project: Project,
  allImages: DatasetImage[],
  options: ExportOptions
): string {
  const images = filterImagesForExport(allImages, options);
  const lines = images.map((img) => {
    const anns = filterAnnotations(img.annotations, options.includeAiSuggestions).map((ann) => {
      const tax = resolveTaxonomy(project.classes, ann.classId, ann.objectId);
      const common = {
        type: ann.type,
        class: tax.className,
        object: tax.objectName,
        label: `${tax.className}/${tax.objectName}`,
        attributes: ann.attributes,
        ...(ann.note ? { note: ann.note } : {}),
      };
      if (ann.type === 'bbox') {
        return {
          ...common,
          bbox: [round2(ann.x), round2(ann.y), round2(ann.width), round2(ann.height)],
          bbox_norm: [
            round4(ann.x / img.width),
            round4(ann.y / img.height),
            round4(ann.width / img.width),
            round4(ann.height / img.height),
          ],
        };
      }
      if (ann.type === 'polygon') {
        return {
          ...common,
          points: ann.points.map((p) => [round2(p.x), round2(p.y)]),
          area: round2(computePolygonArea(ann.points)),
        };
      }
      if (ann.type === 'polyline') {
        return {
          ...common,
          points: ann.points.map((p) => [round2(p.x), round2(p.y)]),
          length_px: round2(computePolylineLength(ann.points)),
        };
      }
      return {
        ...common,
        point: [round2(ann.x), round2(ann.y)],
      };
    });

    return JSON.stringify({
      file_name: img.fileName,
      width: img.width,
      height: img.height,
      split: img.split,
      status: img.status,
      caption: img.caption,
      short_caption: img.shortCaption,
      tags: img.tags,
      annotations: anns,
    });
  });

  return lines.join('\n');
}

function csvEscape(val: string | number): string {
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * RFC-4180 CSV exporter for captions, tags, splits, and class/object summary counts
 */
export function exportToCSV(
  project: Project,
  allImages: DatasetImage[],
  options: ExportOptions
): string {
  const images = filterImagesForExport(allImages, options);
  const headers = [
    'file_name',
    'width',
    'height',
    'split',
    'status',
    'caption',
    'short_caption',
    'tags',
    'total_annotations',
    'bboxes',
    'polygons',
    'polylines',
    'keypoints',
    'class_object_summary',
  ];

  const rows = images.map((img) => {
    const anns = filterAnnotations(img.annotations, options.includeAiSuggestions);
    const counts = { bbox: 0, polygon: 0, polyline: 0, keypoint: 0 };
    const pairCounts = new Map<string, number>();

    for (const ann of anns) {
      counts[ann.type] += 1;
      const tax = resolveTaxonomy(project.classes, ann.classId, ann.objectId);
      const key = `${tax.className}:${tax.objectName}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    const summary = Array.from(pairCounts.entries())
      .map(([k, v]) => `${k}(${v})`)
      .join('; ');

    return [
      img.fileName,
      img.width,
      img.height,
      img.split,
      img.status,
      img.caption,
      img.shortCaption,
      img.tags.join('; '),
      anns.length,
      counts.bbox,
      counts.polygon,
      counts.polyline,
      counts.keypoint,
      summary,
    ]
      .map(csvEscape)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function exportProjectBackup(project: Project, images: DatasetImage[]): string {
  return JSON.stringify(
    {
      format: 'reticle-project-backup-v1',
      exportedAt: new Date().toISOString(),
      project,
      images: images.map(({ seedUrl: _s, ...rest }) => rest),
    },
    null,
    2
  );
}

export interface ImportSummary {
  updatedClasses: LabelClass[];
  updatedImages: DatasetImage[];
  matchedImageCount: number;
  importedAnnotationCount: number;
  importedCaptionCount: number;
}

/**
 * Import either COCO JSON (reconstructing Class -> Object from supercategory & name)
 * or a Reticle Project Backup JSON, merging onto matching project images by fileName.
 */
export function importAnnotationsFromJSON(
  rawJson: string,
  project: Project,
  existingImages: DatasetImage[]
): ImportSummary {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const classesCopy: LabelClass[] = project.classes.map((c) => ({
    ...c,
    objects: c.objects.map((o) => ({ ...o })),
  }));

  const ensureTaxonomyPair = (
    className: string,
    objectName: string
  ): { classId: string; objectId: string } => {
    const cleanClass = className.trim() || 'Imported';
    const cleanObj = objectName.trim() || 'Object';

    let cls = classesCopy.find((c) => c.name.toLowerCase() === cleanClass.toLowerCase());
    if (!cls) {
      const color = CLASS_PALETTE[classesCopy.length % CLASS_PALETTE.length];
      cls = {
        id: generateId('cls'),
        name: cleanClass,
        color,
        visible: true,
        objects: [],
      };
      classesCopy.push(cls);
    }

    let obj = cls.objects.find((o) => o.name.toLowerCase() === cleanObj.toLowerCase());
    if (!obj) {
      obj = {
        id: generateId('obj'),
        classId: cls.id,
        name: cleanObj,
        color: deriveObjectColor(cls.color, cls.objects.length),
        visible: true,
      };
      cls.objects.push(obj);
    }

    return { classId: cls.id, objectId: obj.id };
  };

  let matchedImageCount = 0;
  let importedAnnotationCount = 0;
  let importedCaptionCount = 0;

  // Case 1: Reticle Backup JSON
  if (parsed.format === 'reticle-project-backup-v1' && Array.isArray(parsed.images)) {
    const incomingImages = parsed.images as DatasetImage[];
    const incomingClasses = (parsed.project as Project | undefined)?.classes ?? [];

    const incomingClassLookup = new Map<string, { className: string; objectName: string }>();
    for (const c of incomingClasses) {
      for (const o of c.objects) {
        incomingClassLookup.set(`${c.id}::${o.id}`, { className: c.name, objectName: o.name });
      }
    }

    const updatedImages = existingImages.map((img) => {
      const match = incomingImages.find(
        (inc) => inc.fileName.toLowerCase() === img.fileName.toLowerCase()
      );
      if (!match) return img;
      matchedImageCount += 1;
      if (match.caption) importedCaptionCount += 1;

      const remappedAnns: Annotation[] = (match.annotations ?? []).map((a) => {
        const pair = incomingClassLookup.get(`${a.classId}::${a.objectId}`);
        const ids = pair
          ? ensureTaxonomyPair(pair.className, pair.objectName)
          : { classId: classesCopy[0].id, objectId: classesCopy[0].objects[0].id };
        importedAnnotationCount += 1;
        return { ...a, id: generateId('ann'), classId: ids.classId, objectId: ids.objectId };
      });

      return {
        ...img,
        caption: match.caption ?? img.caption,
        shortCaption: match.shortCaption ?? img.shortCaption,
        tags: Array.isArray(match.tags) ? match.tags : img.tags,
        split: (match.split as SplitType) || img.split,
        status: (match.status as ReviewStatus) || img.status,
        annotations: remappedAnns,
        updatedAt: Date.now(),
      };
    });

    return {
      updatedClasses: classesCopy,
      updatedImages,
      matchedImageCount,
      importedAnnotationCount,
      importedCaptionCount,
    };
  }

  // Case 2: Standard COCO JSON
  if (Array.isArray(parsed.images) && Array.isArray(parsed.annotations)) {
    const cocoCategories = Array.isArray(parsed.categories)
      ? (parsed.categories as Array<{ id: number; name: string; supercategory?: string }>)
      : [];
    const catMap = new Map<number, { classId: string; objectId: string }>();
    for (const cat of cocoCategories) {
      const ids = ensureTaxonomyPair(cat.supercategory || 'Imported', cat.name || 'Object');
      catMap.set(cat.id, ids);
    }

    const cocoImages = parsed.images as Array<{
      id: number;
      file_name: string;
      caption?: string;
      short_caption?: string;
      tags?: string[];
    }>;
    const cocoCaptions = Array.isArray(parsed.captions)
      ? (parsed.captions as Array<{ image_id: number; caption?: string; short_caption?: string }>)
      : [];

    const cocoAnns = parsed.annotations as Array<{
      image_id: number;
      category_id: number;
      bbox?: number[];
      segmentation?: number[][];
      polyline?: number[];
      keypoints?: number[];
      iscrowd?: number;
      attributes?: { occluded?: boolean; truncated?: boolean };
      note?: string;
    }>;

    const updatedImages = existingImages.map((img) => {
      const cocoImg = cocoImages.find(
        (ci) => ci.file_name?.toLowerCase() === img.fileName.toLowerCase()
      );
      if (!cocoImg) return img;

      matchedImageCount += 1;
      const capEntry = cocoCaptions.find((c) => c.image_id === cocoImg.id);
      const nextCaption = capEntry?.caption ?? cocoImg.caption ?? img.caption;
      const nextShort = capEntry?.short_caption ?? cocoImg.short_caption ?? img.shortCaption;
      if (nextCaption && nextCaption !== img.caption) importedCaptionCount += 1;

      const matchingAnns = cocoAnns.filter((a) => a.image_id === cocoImg.id);
      const converted: Annotation[] = [];

      for (const a of matchingAnns) {
        const ids =
          catMap.get(a.category_id) ?? ensureTaxonomyPair('Imported', `Category ${a.category_id}`);
        const base = {
          id: generateId('ann'),
          classId: ids.classId,
          objectId: ids.objectId,
          visible: true,
          locked: false,
          attributes: {
            occluded: Boolean(a.attributes?.occluded),
            truncated: Boolean(a.attributes?.truncated),
            crowd: Boolean(a.iscrowd),
          },
          note: a.note,
          source: 'manual' as const,
        };

        if (Array.isArray(a.polyline) && a.polyline.length >= 4) {
          const pts = [];
          for (let i = 0; i < a.polyline.length - 1; i += 2) {
            pts.push({ x: a.polyline[i], y: a.polyline[i + 1] });
          }
          converted.push({ ...base, type: 'polyline', points: pts });
          importedAnnotationCount += 1;
        } else if (Array.isArray(a.segmentation) && Array.isArray(a.segmentation[0]) && a.segmentation[0].length >= 6) {
          const seg = a.segmentation[0];
          const pts = [];
          for (let i = 0; i < seg.length - 1; i += 2) {
            pts.push({ x: seg[i], y: seg[i + 1] });
          }
          converted.push({ ...base, type: 'polygon', points: pts });
          importedAnnotationCount += 1;
        } else if (Array.isArray(a.keypoints) && a.keypoints.length >= 2) {
          converted.push({ ...base, type: 'keypoint', x: a.keypoints[0], y: a.keypoints[1] });
          importedAnnotationCount += 1;
        } else if (Array.isArray(a.bbox) && a.bbox.length === 4) {
          converted.push({
            ...base,
            type: 'bbox',
            x: a.bbox[0],
            y: a.bbox[1],
            width: a.bbox[2],
            height: a.bbox[3],
          });
          importedAnnotationCount += 1;
        }
      }

      return {
        ...img,
        caption: nextCaption,
        shortCaption: nextShort,
        tags: Array.isArray(cocoImg.tags) ? cocoImg.tags : img.tags,
        annotations: converted.length > 0 ? converted : img.annotations,
        updatedAt: Date.now(),
      };
    });

    return {
      updatedClasses: classesCopy,
      updatedImages,
      matchedImageCount,
      importedAnnotationCount,
      importedCaptionCount,
    };
  }

  throw new Error(
    'Unrecognized JSON schema. Expected a standard COCO JSON file or Reticle Project Backup JSON.'
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
