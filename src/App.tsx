import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import type {
  AICaptionResult,
  AIDetectionResult,
  Annotation,
  CaptionStyle,
  DatasetImage,
  ImageDisplaySettings,
  LabelClass,
  Project,
  SplitType,
  ToastMessage,
  ToolMode,
  ViewTab,
} from './types/annotation';
import {
  deleteDatasetImage,
  deleteProjectCascade,
  getAllProjects,
  getImageBlob,
  getProjectImages,
  saveDatasetImage,
  saveDatasetImagesBulk,
  saveImageBlob,
  saveProject,
} from './utils/db';
import {
  CLASS_PALETTE,
  deriveObjectColor,
  generateId,
  prepareImageForAI,
  readImageDimensions,
  resolveTaxonomy,
} from './utils/geometry';
import { buildClassesFromPreset, createStarterProjectAndImages } from './utils/seedData';
import { importAnnotationsFromJSON } from './utils/exporters';
import TopBar from './components/TopBar';
import ToolRail from './components/ToolRail';
import ImageQueue from './components/ImageQueue';
import AnnotationCanvas from './components/AnnotationCanvas';
import InspectorPanel from './components/InspectorPanel';
import DatasetGallery from './components/DatasetGallery';
import AnalyticsView from './components/AnalyticsView';
import ExportView from './components/ExportView';
import ProjectModal from './components/ProjectModal';
import ShortcutsModal from './components/ShortcutsModal';
import DeleteTaxonomyModal, { type PendingTaxonomyDelete } from './components/DeleteTaxonomyModal';
import CropModal from './components/CropModal';
import BatchStudioModal, {
  type BatchImageMediaUpdate,
  type BatchImageMetaPatch,
  type BatchTab,
} from './components/BatchStudioModal';
import type { CropOutputFormat, CropSaveMode } from './utils/crop';

const DEFAULT_DISPLAY_SETTINGS: ImageDisplaySettings = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  maskOpacity: 0.22,
  showLabels: true,
  showClassPrefix: true,
  showCrosshair: true,
};

interface HistoryEntry {
  past: Annotation[][];
  future: Annotation[][];
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [images, setImages] = useState<DatasetImage[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const [activeTab, setActiveTab] = useState<ViewTab>('annotate');
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [activeClassId, setActiveClassId] = useState<string>('');
  const [activeObjectId, setActiveObjectId] = useState<string>('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>('select');
  const [fitSignal, setFitSignal] = useState(0);

  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [displaySettings, setDisplaySettings] =
    useState<ImageDisplaySettings>(DEFAULT_DISPLAY_SETTINGS);

  const [historyByImage, setHistoryByImage] = useState<Record<string, HistoryEntry>>({});

  // AI state (Gemini 3.1 Flash Lite)
  const [aiDetecting, setAiDetecting] = useState(false);
  const [aiCaptioning, setAiCaptioning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCaptionDraft, setAiCaptionDraft] = useState<AICaptionResult | null>(null);

  // Modals & hidden file input
  const [projectModalMode, setProjectModalMode] = useState<'create' | 'manage' | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [batchStudio, setBatchStudio] = useState<{
    open: boolean;
    tab: BatchTab;
    selectedIds: string[];
    filteredIds: string[];
  }>({ open: false, tab: 'crop', selectedIds: [], filteredIds: [] });
  const [pendingDeleteTax, setPendingDeleteTax] = useState<PendingTaxonomyDelete | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlCacheRef = useRef<Record<string, string>>({});
  const aiDetectAbortRef = useRef<AbortController | null>(null);
  const aiCaptionAbortRef = useRef<AbortController | null>(null);

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = generateId('toast');
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId]
  );

  const activeImageIndex = useMemo(
    () => images.findIndex((i) => i.id === activeImageId),
    [images, activeImageId]
  );

  const activeImage = activeImageIndex >= 0 ? images[activeImageIndex] : null;

  // Resolve blob URLs for current project's images
  const hydrateImageUrls = useCallback(async (imgList: DatasetImage[]) => {
    const nextUrls: Record<string, string> = {};
    for (const img of imgList) {
      if (objectUrlCacheRef.current[img.id]) {
        nextUrls[img.id] = objectUrlCacheRef.current[img.id];
        continue;
      }
      const blob = await getImageBlob(img.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrlCacheRef.current[img.id] = url;
        nextUrls[img.id] = url;
      } else if (img.seedUrl) {
        nextUrls[img.id] = img.seedUrl;
      }
    }
    setImageUrls(nextUrls);
  }, []);

  // Load project + images helper
  const loadProjectWorkspace = useCallback(
    async (project: Project) => {
      const projImages = await getProjectImages(project.id);
      setActiveProjectId(project.id);
      setImages(projImages);
      setSelectedAnnotationId(null);
      setAiCaptionDraft(null);
      setAiError(null);
      setHistoryByImage({});

      const firstClass = project.classes[0];
      const firstObj = firstClass?.objects[0];
      setActiveClassId(firstClass?.id ?? '');
      setActiveObjectId(firstObj?.id ?? '');

      const targetImgId =
        project.activeImageId && projImages.some((i) => i.id === project.activeImageId)
          ? project.activeImageId
          : projImages[0]?.id ?? null;
      setActiveImageId(targetImgId);
      await hydrateImageUrls(projImages);
    },
    [hydrateImageUrls]
  );

  // Initial IndexedDB bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let savedProjects = await getAllProjects();
        if (savedProjects.length === 0) {
          const { project, images: seedImages } = await createStarterProjectAndImages();
          await saveProject(project);
          await saveDatasetImagesBulk(seedImages);
          savedProjects = [project];
        }
        if (cancelled) return;
        setProjects(savedProjects);
        await loadProjectWorkspace(savedProjects[0]);
      } catch (err) {
        console.error('Bootstrap error:', err);
        pushToast('Failed to initialize local IndexedDB storage.', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of Object.values(objectUrlCacheRef.current)) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
    };
  }, [loadProjectWorkspace, pushToast]);

  // Persist project update helper
  const persistProject = useCallback(async (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    await saveProject(updated);
  }, []);

  // Persist single image update helper
  const persistImage = useCallback(async (updated: DatasetImage) => {
    setImages((prev) => prev.map((img) => (img.id === updated.id ? updated : img)));
    await saveDatasetImage(updated);
  }, []);

  // Commit annotations with Undo/Redo history tracking
  const handleCommitAnnotations = useCallback(
    (nextAnnotations: Annotation[]) => {
      if (!activeImage) return;
      const imageId = activeImage.id;
      const prevSnapshot = activeImage.annotations;

      setHistoryByImage((prev) => {
        const entry = prev[imageId] ?? { past: [], future: [] };
        return {
          ...prev,
          [imageId]: {
            past: [...entry.past.slice(-49), prevSnapshot],
            future: [],
          },
        };
      });

      const autoStatus =
        activeImage.status === 'unlabeled' && nextAnnotations.length > 0
          ? 'in_progress'
          : activeImage.status;

      const updated: DatasetImage = {
        ...activeImage,
        annotations: nextAnnotations,
        status: autoStatus,
        updatedAt: Date.now(),
      };
      void persistImage(updated);
    },
    [activeImage, persistImage]
  );

  const currentHistory = activeImage ? historyByImage[activeImage.id] : undefined;
  const canUndo = Boolean(currentHistory && currentHistory.past.length > 0);
  const canRedo = Boolean(currentHistory && currentHistory.future.length > 0);

  const handleUndo = useCallback(() => {
    if (!activeImage || !currentHistory || currentHistory.past.length === 0) return;
    const previous = currentHistory.past[currentHistory.past.length - 1];
    const nextPast = currentHistory.past.slice(0, -1);
    setHistoryByImage((prev) => ({
      ...prev,
      [activeImage.id]: {
        past: nextPast,
        future: [activeImage.annotations, ...currentHistory.future.slice(0, 49)],
      },
    }));
    void persistImage({ ...activeImage, annotations: previous, updatedAt: Date.now() });
    setSelectedAnnotationId(null);
  }, [activeImage, currentHistory, persistImage]);

  const handleRedo = useCallback(() => {
    if (!activeImage || !currentHistory || currentHistory.future.length === 0) return;
    const nextState = currentHistory.future[0];
    const remainingFuture = currentHistory.future.slice(1);
    setHistoryByImage((prev) => ({
      ...prev,
      [activeImage.id]: {
        past: [...currentHistory.past, activeImage.annotations],
        future: remainingFuture,
      },
    }));
    void persistImage({ ...activeImage, annotations: nextState, updatedAt: Date.now() });
    setSelectedAnnotationId(null);
  }, [activeImage, currentHistory, persistImage]);

  const handleUpdateAnnotation = useCallback(
    (annId: string, updater: (ann: Annotation) => Annotation) => {
      if (!activeImage) return;
      handleCommitAnnotations(activeImage.annotations.map((a) => (a.id === annId ? updater(a) : a)));
    },
    [activeImage, handleCommitAnnotations]
  );

  const handleDeleteAnnotation = useCallback(
    (annId: string) => {
      if (!activeImage) return;
      handleCommitAnnotations(activeImage.annotations.filter((a) => a.id !== annId));
      if (selectedAnnotationId === annId) setSelectedAnnotationId(null);
    },
    [activeImage, handleCommitAnnotations, selectedAnnotationId]
  );

  const handleAcceptAnnotationAI = useCallback(
    (annId: string) => {
      if (!activeImage) return;
      handleCommitAnnotations(
        activeImage.annotations.map((a) =>
          a.id === annId ? { ...a, source: 'manual', confidence: undefined } : a
        )
      );
    },
    [activeImage, handleCommitAnnotations]
  );

  const handleAcceptAllAI = useCallback(() => {
    if (!activeImage) return;
    const count = activeImage.annotations.filter((a) => a.source === 'ai_suggestion').length;
    if (count === 0) return;
    handleCommitAnnotations(
      activeImage.annotations.map((a) =>
        a.source === 'ai_suggestion' ? { ...a, source: 'manual', confidence: undefined } : a
      )
    );
    pushToast(`Accepted ${count} AI bounding box suggestion${count === 1 ? '' : 's'}.`, 'success');
  }, [activeImage, handleCommitAnnotations, pushToast]);

  const handleDismissAllAI = useCallback(() => {
    if (!activeImage) return;
    handleCommitAnnotations(activeImage.annotations.filter((a) => a.source !== 'ai_suggestion'));
    setSelectedAnnotationId(null);
  }, [activeImage, handleCommitAnnotations]);

  const handleUpdateImageMeta = useCallback(
    (patch: Partial<DatasetImage>) => {
      if (!activeImage) return;
      void persistImage({ ...activeImage, ...patch, updatedAt: Date.now() });
    },
    [activeImage, persistImage]
  );

  const handleUpdateAnyImage = useCallback(
    (imageId: string, patch: Partial<DatasetImage>) => {
      const target = images.find((i) => i.id === imageId);
      if (!target) return;
      void persistImage({ ...target, ...patch, updatedAt: Date.now() });
    },
    [images, persistImage]
  );

  const handleSelectImage = useCallback(
    (imageId: string) => {
      setActiveImageId(imageId);
      setSelectedAnnotationId(null);
      setAiCaptionDraft(null);
      setAiError(null);
      if (activeProject) {
        void persistProject({ ...activeProject, activeImageId: imageId, updatedAt: Date.now() });
      }
    },
    [activeProject, persistProject]
  );

  // Local image file batch uploader -> IndexedDB blobs
  const handleUploadFiles = useCallback(
    async (fileList: FileList) => {
      if (!activeProject) return;
      const validFiles = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (validFiles.length === 0) {
        pushToast('No supported image files found (PNG, JPG, WEBP).', 'error');
        return;
      }

      const added: DatasetImage[] = [];
      const newUrls: Record<string, string> = {};

      for (const file of validFiles) {
        const id = generateId('img');
        const url = URL.createObjectURL(file);
        try {
          const dims = await readImageDimensions(url);
          await saveImageBlob(id, file);
          objectUrlCacheRef.current[id] = url;
          newUrls[id] = url;
          const now = Date.now();
          const record: DatasetImage = {
            id,
            projectId: activeProject.id,
            fileName: file.name,
            mimeType: file.type || 'image/jpeg',
            width: dims.width,
            height: dims.height,
            split: 'train',
            status: 'unlabeled',
            caption: '',
            shortCaption: '',
            tags: [],
            annotations: [],
            createdAt: now + added.length,
            updatedAt: now + added.length,
          };
          added.push(record);
        } catch {
          URL.revokeObjectURL(url);
        }
      }

      if (added.length > 0) {
        await saveDatasetImagesBulk(added);
        setImages((prev) => [...prev, ...added]);
        setImageUrls((prev) => ({ ...prev, ...newUrls }));
        setActiveImageId(added[0].id);
        setActiveTab('annotate');
        pushToast(
          `Imported ${added.length} image${added.length === 1 ? '' : 's'} into IndexedDB.`,
          'success'
        );
      }
    },
    [activeProject, pushToast]
  );

  const handleDeleteImage = useCallback(
    async (imageId: string) => {
      await deleteDatasetImage(imageId);
      const cachedUrl = objectUrlCacheRef.current[imageId];
      if (cachedUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(cachedUrl);
        delete objectUrlCacheRef.current[imageId];
      }
      setImages((prev) => {
        const remaining = prev.filter((i) => i.id !== imageId);
        if (activeImageId === imageId) {
          setActiveImageId(remaining[0]?.id ?? null);
          setSelectedAnnotationId(null);
        }
        return remaining;
      });
      pushToast('Removed image from dataset.', 'info');
    },
    [activeImageId, pushToast]
  );

  // Apply crop from Crop Studio (Save as New Image or Replace Current Image)
  const handleApplyCrop = useCallback(
    async (payload: {
      blob: Blob;
      width: number;
      height: number;
      mimeType: CropOutputFormat;
      fileName: string;
      annotations: Annotation[];
      saveMode: CropSaveMode;
      copyMetadata: boolean;
    }) => {
      if (!activeProject || !activeImage) return;
      const now = Date.now();

      if (payload.saveMode === 'new') {
        const id = generateId('img');
        await saveImageBlob(id, payload.blob);
        const url = URL.createObjectURL(payload.blob);
        objectUrlCacheRef.current[id] = url;
        setImageUrls((prev) => ({ ...prev, [id]: url }));

        const newRecord: DatasetImage = {
          id,
          projectId: activeProject.id,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          width: payload.width,
          height: payload.height,
          split: payload.copyMetadata ? activeImage.split : 'train',
          status: payload.annotations.length > 0 ? 'in_progress' : 'unlabeled',
          caption: payload.copyMetadata ? activeImage.caption : '',
          shortCaption: payload.copyMetadata ? activeImage.shortCaption : '',
          tags: payload.copyMetadata ? [...activeImage.tags] : [],
          annotations: payload.annotations,
          createdAt: now,
          updatedAt: now,
        };

        await saveDatasetImage(newRecord);
        setImages((prev) => [...prev, newRecord]);
        handleSelectImage(id);
        pushToast(
          `Saved cropped image (${payload.width}×${payload.height}) with ${payload.annotations.length} label${payload.annotations.length === 1 ? '' : 's'}.`,
          'success'
        );
      } else {
        await saveImageBlob(activeImage.id, payload.blob);
        const prevUrl = objectUrlCacheRef.current[activeImage.id];
        if (prevUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(prevUrl);
        }
        const url = URL.createObjectURL(payload.blob);
        objectUrlCacheRef.current[activeImage.id] = url;
        setImageUrls((prev) => ({ ...prev, [activeImage.id]: url }));

        const updated: DatasetImage = {
          ...activeImage,
          width: payload.width,
          height: payload.height,
          mimeType: payload.mimeType,
          annotations: payload.annotations,
          seedUrl: undefined,
          updatedAt: now,
        };

        await persistImage(updated);
        setHistoryByImage((prev) => {
          const next = { ...prev };
          delete next[activeImage.id];
          return next;
        });
        setSelectedAnnotationId(null);
        setFitSignal((s) => s + 1);
        pushToast(
          `Replaced image with ${payload.width}×${payload.height} crop (${payload.annotations.length} label${payload.annotations.length === 1 ? '' : 's'} remapped).`,
          'success'
        );
      }
    },
    [activeProject, activeImage, handleSelectImage, persistImage, pushToast]
  );

  const handleAutoSplit = useCallback(
    async (trainPct: number, valPct: number, _testPct: number) => {
      if (images.length === 0) return;
      const shuffled = [...images].sort(() => Math.random() - 0.5);
      const trainCut = Math.round((trainPct / 100) * shuffled.length);
      const valCut = trainCut + Math.round((valPct / 100) * shuffled.length);

      const splitMap = new Map<string, 'train' | 'val' | 'test'>();
      shuffled.forEach((img, idx) => {
        const sp = idx < trainCut ? 'train' : idx < valCut ? 'val' : 'test';
        splitMap.set(img.id, sp);
      });

      const updated = images.map((img) => ({
        ...img,
        split: splitMap.get(img.id) ?? 'train',
        updatedAt: Date.now(),
      }));
      await saveDatasetImagesBulk(updated);
      setImages(updated);
      pushToast(`Applied ${trainPct}/${valPct}/${Math.max(0, 100 - trainPct - valPct)} split.`, 'success');
    },
    [images, pushToast]
  );

  // Bulk delete selected images from Dataset Gallery
  const handleDeleteImagesBulk = useCallback(
    async (imageIds: string[]) => {
      if (imageIds.length === 0) return;
      const removeSet = new Set(imageIds);
      for (const id of imageIds) {
        await deleteDatasetImage(id);
        const cachedUrl = objectUrlCacheRef.current[id];
        if (cachedUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(cachedUrl);
          delete objectUrlCacheRef.current[id];
        }
      }
      setImages((prev) => {
        const remaining = prev.filter((i) => !removeSet.has(i.id));
        if (activeImageId && removeSet.has(activeImageId)) {
          setActiveImageId(remaining[0]?.id ?? null);
          setSelectedAnnotationId(null);
        }
        return remaining;
      });
      pushToast(
        `Deleted ${imageIds.length} image${imageIds.length === 1 ? '' : 's'} from dataset.`,
        'info'
      );
    },
    [activeImageId, pushToast]
  );

  // Bulk split update from Dataset Gallery
  const handleBulkUpdateSplit = useCallback(
    async (imageIds: string[], split: SplitType) => {
      if (imageIds.length === 0) return;
      const targetSet = new Set(imageIds);
      const now = Date.now();
      const updated = images.map((img) =>
        targetSet.has(img.id) ? { ...img, split, updatedAt: now } : img
      );
      await saveDatasetImagesBulk(updated.filter((img) => targetSet.has(img.id)));
      setImages(updated);
      pushToast(
        `Moved ${imageIds.length} image${imageIds.length === 1 ? '' : 's'} to ${split}.`,
        'success'
      );
    },
    [images, pushToast]
  );

  // Batch Crop / Batch Resize commit handler (persists blobs + updated/new DatasetImage records)
  const handleApplyMediaBatch = useCallback(
    async (items: BatchImageMediaUpdate[], summaryMessage: string) => {
      if (!activeProject || items.length === 0) return;
      const now = Date.now();
      const imageById = new Map(images.map((i) => [i.id, i]));
      const urlUpdates: Record<string, string> = {};
      const replacedRecords = new Map<string, DatasetImage>();
      const newRecords: DatasetImage[] = [];
      let activeReplaced = false;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const orig = imageById.get(item.imageId);
        if (!orig) continue;

        if (item.saveMode === 'new') {
          const newId = generateId('img');
          await saveImageBlob(newId, item.blob);
          const url = URL.createObjectURL(item.blob);
          objectUrlCacheRef.current[newId] = url;
          urlUpdates[newId] = url;

          newRecords.push({
            id: newId,
            projectId: activeProject.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            width: item.width,
            height: item.height,
            split: item.copyMetadata ? orig.split : 'train',
            status: item.annotations.length > 0 ? 'in_progress' : 'unlabeled',
            caption: item.copyMetadata ? orig.caption : '',
            shortCaption: item.copyMetadata ? orig.shortCaption : '',
            tags: item.copyMetadata ? [...orig.tags] : [],
            annotations: item.annotations,
            createdAt: now + i,
            updatedAt: now + i,
          });
        } else {
          await saveImageBlob(orig.id, item.blob);
          const prevUrl = objectUrlCacheRef.current[orig.id];
          if (prevUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(prevUrl);
          }
          const url = URL.createObjectURL(item.blob);
          objectUrlCacheRef.current[orig.id] = url;
          urlUpdates[orig.id] = url;

          replacedRecords.set(orig.id, {
            ...orig,
            width: item.width,
            height: item.height,
            mimeType: item.mimeType,
            annotations: item.annotations,
            seedUrl: undefined,
            updatedAt: now + i,
          });
          if (orig.id === activeImageId) activeReplaced = true;
        }
      }

      const toPersist = [...Array.from(replacedRecords.values()), ...newRecords];
      if (toPersist.length > 0) {
        await saveDatasetImagesBulk(toPersist);
      }

      setImageUrls((prev) => ({ ...prev, ...urlUpdates }));
      setImages((prev) => [
        ...prev.map((img) => replacedRecords.get(img.id) ?? img),
        ...newRecords,
      ]);

      if (replacedRecords.size > 0) {
        setHistoryByImage((prev) => {
          const next = { ...prev };
          for (const id of replacedRecords.keys()) {
            delete next[id];
          }
          return next;
        });
      }

      if (activeReplaced) {
        setSelectedAnnotationId(null);
        setFitSignal((s) => s + 1);
      }

      pushToast(summaryMessage, 'success');
    },
    [activeProject, images, activeImageId, pushToast]
  );

  // Batch Tags / Batch Captions commit handler
  const handleApplyMetaBatch = useCallback(
    async (patches: BatchImageMetaPatch[], summaryMessage?: string) => {
      if (patches.length > 0) {
        const patchMap = new Map(patches.map((p) => [p.imageId, p.patch]));
        const now = Date.now();
        const toSave: DatasetImage[] = [];

        setImages((prev) =>
          prev.map((img) => {
            const p = patchMap.get(img.id);
            if (!p) return img;
            const nextImg: DatasetImage = { ...img, ...p, updatedAt: now };
            toSave.push(nextImg);
            return nextImg;
          })
        );

        // Fallback if React batches state updater asynchronously before await
        if (toSave.length === 0) {
          for (const img of images) {
            const p = patchMap.get(img.id);
            if (p) toSave.push({ ...img, ...p, updatedAt: now });
          }
        }
        if (toSave.length > 0) {
          await saveDatasetImagesBulk(toSave);
        }
      }

      if (summaryMessage) {
        pushToast(summaryMessage, 'success');
      }
    },
    [images, pushToast]
  );

  // Taxonomy Updates & Safe Deletion
  const handleUpdateClasses = useCallback(
    (nextClasses: LabelClass[]) => {
      if (!activeProject) return;
      void persistProject({ ...activeProject, classes: nextClasses, updatedAt: Date.now() });
    },
    [activeProject, persistProject]
  );

  const affectedDeleteCount = useMemo(() => {
    if (!pendingDeleteTax) return 0;
    let count = 0;
    for (const img of images) {
      for (const a of img.annotations) {
        if (pendingDeleteTax.kind === 'class' && a.classId === pendingDeleteTax.classId) count++;
        if (
          pendingDeleteTax.kind === 'object' &&
          a.classId === pendingDeleteTax.classId &&
          a.objectId === pendingDeleteTax.objectId
        ) {
          count++;
        }
      }
    }
    return count;
  }, [images, pendingDeleteTax]);

  const handleConfirmDeleteTaxonomy = useCallback(
    async (
      resolution:
        | { action: 'reassign'; classId: string; objectId: string }
        | { action: 'delete_annotations' }
    ) => {
      if (!activeProject || !pendingDeleteTax) return;

      const nextClasses =
        pendingDeleteTax.kind === 'class'
          ? activeProject.classes.filter((c) => c.id !== pendingDeleteTax.classId)
          : activeProject.classes.map((c) =>
              c.id === pendingDeleteTax.classId
                ? { ...c, objects: c.objects.filter((o) => o.id !== pendingDeleteTax.objectId) }
                : c
            );

      const matchesTarget = (a: Annotation) =>
        pendingDeleteTax.kind === 'class'
          ? a.classId === pendingDeleteTax.classId
          : a.classId === pendingDeleteTax.classId && a.objectId === pendingDeleteTax.objectId;

      const nextImages = images.map((img) => {
        const hasMatch = img.annotations.some(matchesTarget);
        if (!hasMatch) return img;
        const nextAnns =
          resolution.action === 'reassign'
            ? img.annotations.map((a) =>
                matchesTarget(a)
                  ? { ...a, classId: resolution.classId, objectId: resolution.objectId }
                  : a
              )
            : img.annotations.filter((a) => !matchesTarget(a));
        return { ...img, annotations: nextAnns, updatedAt: Date.now() };
      });

      await persistProject({ ...activeProject, classes: nextClasses, updatedAt: Date.now() });
      await saveDatasetImagesBulk(nextImages);
      setImages(nextImages);

      // Ensure active Class/Object remains valid
      const stillValid = nextClasses.some(
        (c) => c.id === activeClassId && c.objects.some((o) => o.id === activeObjectId)
      );
      if (!stillValid && nextClasses[0]?.objects[0]) {
        setActiveClassId(nextClasses[0].id);
        setActiveObjectId(nextClasses[0].objects[0].id);
      }

      pushToast('Updated Class → Object taxonomy.', 'info');
    },
    [activeProject, pendingDeleteTax, images, persistProject, activeClassId, activeObjectId, pushToast]
  );

  // Project CRUD
  const handleCreateProject = useCallback(
    async (name: string, description: string, presetId: string) => {
      const now = Date.now();
      const project: Project = {
        id: generateId('proj'),
        name,
        description,
        classes: buildClassesFromPreset(presetId),
        activeImageId: null,
        createdAt: now,
        updatedAt: now,
      };
      await saveProject(project);
      setProjects((prev) => [project, ...prev]);
      await loadProjectWorkspace(project);
      setActiveTab('annotate');
      pushToast(`Created project "${name}".`, 'success');
    },
    [loadProjectWorkspace, pushToast]
  );

  const handleUpdateProjectInfo = useCallback(
    async (name: string, description: string) => {
      if (!activeProject) return;
      await persistProject({ ...activeProject, name, description, updatedAt: Date.now() });
      pushToast('Saved project details.', 'success');
    },
    [activeProject, persistProject, pushToast]
  );

  const handleDeleteActiveProject = useCallback(async () => {
    if (!activeProject || projects.length <= 1) return;
    await deleteProjectCascade(activeProject.id);
    const remaining = projects.filter((p) => p.id !== activeProject.id);
    setProjects(remaining);
    await loadProjectWorkspace(remaining[0]);
    pushToast(`Deleted project "${activeProject.name}".`, 'info');
  }, [activeProject, projects, loadProjectWorkspace, pushToast]);

  // AI Object Box Suggestions (Gemini 3.1 Flash Lite with resilient fallback)
  const handleCancelAIDetect = useCallback(() => {
    aiDetectAbortRef.current?.abort();
    aiDetectAbortRef.current = null;
    setAiDetecting(false);
  }, []);

  const handleRunAIDetect = useCallback(async () => {
    if (!activeProject || !activeImage) return;
    const src = imageUrls[activeImage.id] || activeImage.seedUrl;
    if (!src) return;

    aiDetectAbortRef.current?.abort();
    const controller = new AbortController();
    aiDetectAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    setAiDetecting(true);
    setAiError(null);
    try {
      const { imageBase64, mimeType } = await prepareImageForAI(src, 768);
      const taxonomy = activeProject.classes.map((c) => ({
        className: c.name,
        objects: c.objects.map((o) => o.name),
      }));

      const res = await fetch('/api/ai/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType, taxonomy }),
        signal: controller.signal,
      });

      const rawBody = await res.text();
      let data: {
        detections?: AIDetectionResult[];
        model?: string;
        usedFallback?: boolean;
        error?: string;
      };
      try {
        data = JSON.parse(rawBody);
      } catch {
        if (rawBody.trimStart().startsWith('<')) {
          throw new Error(
            `The AI backend returned an HTML page (HTTP ${res.status}) instead of JSON. Please refresh the preview or wait a moment for the server to finish restarting, then try again.`
          );
        }
        throw new Error(`Invalid response from AI detection server (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        throw new Error(data.error || `Detection request failed (${res.status}).`);
      }

      const detections = data.detections ?? [];
      if (detections.length === 0) {
        pushToast('No additional objects detected above confidence threshold.', 'info');
        return;
      }

      // Map returned { className, objectName } onto project's Class -> Object tree
      let classesMutated = false;
      const classesDraft: LabelClass[] = activeProject.classes.map((c) => ({
        ...c,
        objects: [...c.objects],
      }));

      const resolveOrAddPair = (className: string, objectName: string) => {
        const cNorm = className.trim().toLowerCase();
        const oNorm = objectName.trim().toLowerCase();

        // First try exact object name match anywhere in taxonomy
        for (const c of classesDraft) {
          const exactObj = c.objects.find((o) => o.name.toLowerCase() === oNorm);
          if (exactObj) return { classId: c.id, objectId: exactObj.id };
        }

        // Next try matching parent Class
        let targetClass = classesDraft.find((c) => c.name.toLowerCase() === cNorm);
        if (!targetClass) {
          const color = CLASS_PALETTE[classesDraft.length % CLASS_PALETTE.length];
          targetClass = {
            id: generateId('cls'),
            name: className.trim() || 'Detected',
            color,
            visible: true,
            objects: [],
          };
          classesDraft.push(targetClass);
          classesMutated = true;
        }

        const newObj = {
          id: generateId('obj'),
          classId: targetClass.id,
          name: objectName.trim() || 'Object',
          color: deriveObjectColor(targetClass.color, targetClass.objects.length),
          visible: true,
        };
        targetClass.objects.push(newObj);
        classesMutated = true;
        return { classId: targetClass.id, objectId: newObj.id };
      };

      const staged: Annotation[] = detections.map((det) => {
        const [ymin, xmin, ymax, xmax] = det.box_2d;
        const x = Math.round((xmin / 1000) * activeImage.width);
        const y = Math.round((ymin / 1000) * activeImage.height);
        const width = Math.max(4, Math.round(((xmax - xmin) / 1000) * activeImage.width));
        const height = Math.max(4, Math.round(((ymax - ymin) / 1000) * activeImage.height));
        const ids = resolveOrAddPair(det.className, det.objectName);
        return {
          id: generateId('ann'),
          type: 'bbox',
          classId: ids.classId,
          objectId: ids.objectId,
          x,
          y,
          width,
          height,
          visible: true,
          locked: false,
          attributes: { occluded: false, truncated: false, crowd: false },
          source: 'ai_suggestion',
          confidence: det.confidence,
        };
      });

      if (classesMutated) {
        await persistProject({
          ...activeProject,
          classes: classesDraft,
          updatedAt: Date.now(),
        });
      }

      const existingManual = activeImage.annotations.filter((a) => a.source !== 'ai_suggestion');
      handleCommitAnnotations([...existingManual, ...staged]);
      setTool('select');
      pushToast(
        `Staged ${staged.length} AI box suggestions${data.usedFallback ? ' (via Flash fallback)' : ''}.`,
        'success'
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (aiDetectAbortRef.current === controller) {
          setAiError('AI box detection timed out or was cancelled. Please try again.');
        }
      } else {
        const message = err instanceof Error ? err.message : 'AI box detection failed.';
        setAiError(message);
      }
    } finally {
      clearTimeout(timeoutId);
      if (aiDetectAbortRef.current === controller) {
        aiDetectAbortRef.current = null;
        setAiDetecting(false);
      }
    }
  }, [activeProject, activeImage, imageUrls, persistProject, handleCommitAnnotations, pushToast]);

  // AI Auto-Captioning (Gemini 3.1 Flash Lite with resilient fallback)
  const handleCancelAICaption = useCallback(() => {
    aiCaptionAbortRef.current?.abort();
    aiCaptionAbortRef.current = null;
    setAiCaptioning(false);
  }, []);

  const handleRunAICaption = useCallback(
    async (style: CaptionStyle) => {
      if (!activeProject || !activeImage) return;
      const src = imageUrls[activeImage.id] || activeImage.seedUrl;
      if (!src) return;

      aiCaptionAbortRef.current?.abort();
      const controller = new AbortController();
      aiCaptionAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      setAiCaptioning(true);
      setAiError(null);
      try {
        const { imageBase64, mimeType } = await prepareImageForAI(src, 768);
        const existingLabels = Array.from(
          new Set(
            activeImage.annotations
              .filter((a) => a.source !== 'ai_suggestion')
              .map((a) => resolveTaxonomy(activeProject.classes, a.classId, a.objectId).fullLabel)
          )
        );

        const res = await fetch('/api/ai/caption', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, mimeType, style, existingLabels }),
          signal: controller.signal,
        });

        const rawBody = await res.text();
        let data: Partial<AICaptionResult> & {
          usedFallback?: boolean;
          error?: string;
        };
        try {
          data = JSON.parse(rawBody);
        } catch {
          if (rawBody.trimStart().startsWith('<')) {
            throw new Error(
              `The AI backend returned an HTML page (HTTP ${res.status}) instead of JSON. Please refresh the preview or wait a moment for the server to finish restarting, then try again.`
            );
          }
          throw new Error(`Invalid response from AI caption server (HTTP ${res.status}).`);
        }
        if (!res.ok) {
          throw new Error(data.error || `Caption request failed (${res.status}).`);
        }

        setAiCaptionDraft({
          caption: data.caption ?? '',
          shortCaption: data.shortCaption ?? '',
          tags: data.tags ?? [],
        });
        if (data.usedFallback) {
          pushToast('Generated caption using Flash fallback while Flash Lite was busy.', 'info');
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (aiCaptionAbortRef.current === controller) {
            setAiError('AI caption generation timed out or was cancelled. Please try again.');
          }
        } else {
          const message = err instanceof Error ? err.message : 'AI captioning failed.';
          setAiError(message);
        }
      } finally {
        clearTimeout(timeoutId);
        if (aiCaptionAbortRef.current === controller) {
          aiCaptionAbortRef.current = null;
          setAiCaptioning(false);
        }
      }
    },
    [activeProject, activeImage, imageUrls, pushToast]
  );

  const handleApplyAICaptionDraft = useCallback(() => {
    if (!activeImage || !aiCaptionDraft) return;
    const mergedTags = Array.from(new Set([...activeImage.tags, ...aiCaptionDraft.tags]));
    handleUpdateImageMeta({
      caption: aiCaptionDraft.caption,
      shortCaption: aiCaptionDraft.shortCaption || activeImage.shortCaption,
      tags: mergedTags,
    });
    setAiCaptionDraft(null);
    pushToast('Applied AI caption draft and tags.', 'success');
  }, [activeImage, aiCaptionDraft, handleUpdateImageMeta, pushToast]);

  // Import COCO JSON or Reticle Backup JSON
  const handleImportAnnotationsJson = useCallback(
    async (rawJson: string) => {
      if (!activeProject) return;
      try {
        const result = importAnnotationsFromJSON(rawJson, activeProject, images);
        await persistProject({
          ...activeProject,
          classes: result.updatedClasses,
          updatedAt: Date.now(),
        });
        await saveDatasetImagesBulk(result.updatedImages);
        setImages(result.updatedImages);
        pushToast(
          `Imported ${result.importedAnnotationCount} annotations across ${result.matchedImageCount} matched image${result.matchedImageCount === 1 ? '' : 's'}.`,
          'success'
        );
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Failed to parse JSON file.', 'error');
      }
    },
    [activeProject, images, persistProject, pushToast]
  );

  // Global Keyboard Shortcuts (Annotate workspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        activeTab !== 'annotate' ||
        projectModalMode ||
        pendingDeleteTax ||
        cropModalOpen ||
        batchStudio.open
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inInput) return;

      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (key === 'v') {
        setTool('select');
      } else if (key === 'b') {
        setTool('bbox');
      } else if (key === 'p') {
        setTool('polygon');
      } else if (key === 'l') {
        setTool('polyline');
      } else if (key === 'k') {
        setTool('keypoint');
      } else if (key === 'h') {
        setTool('pan');
      } else if (key === 'f') {
        setFitSignal((s) => s + 1);
      } else if (key === 'c') {
        setDisplaySettings((d) => ({ ...d, showCrosshair: !d.showCrosshair }));
      } else if (key === 't') {
        setDisplaySettings((d) => ({ ...d, showLabels: !d.showLabels }));
      } else if (key === 'x' && activeImage) {
        e.preventDefault();
        setCropModalOpen(true);
      } else if (key === 'a' || e.key === 'ArrowLeft') {
        if (activeImageIndex > 0) handleSelectImage(images[activeImageIndex - 1].id);
      } else if (key === 'd' || e.key === 'ArrowRight') {
        if (activeImageIndex >= 0 && activeImageIndex < images.length - 1) {
          handleSelectImage(images[activeImageIndex + 1].id);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        // Only delete selected annotation when not actively placing polygon/polyline points
        if (tool === 'select') {
          e.preventDefault();
          handleDeleteAnnotation(selectedAnnotationId);
        }
      } else if (/^[1-9]$/.test(e.key) && activeProject) {
        // Quick hotkey jump to matching Class -> Object
        for (const cls of activeProject.classes) {
          const obj = cls.objects.find((o) => o.hotkey === e.key);
          if (obj) {
            setActiveClassId(cls.id);
            setActiveObjectId(obj.id);
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTab,
    projectModalMode,
    pendingDeleteTax,
    cropModalOpen,
    batchStudio.open,
    activeProject,
    activeImage,
    activeImageIndex,
    images,
    selectedAnnotationId,
    tool,
    handleUndo,
    handleRedo,
    handleSelectImage,
    handleDeleteAnnotation,
  ]);

  if (loading || !activeProject) {
    return (
      <div className="h-screen w-screen bg-[#0B0D10] flex flex-col items-center justify-center gap-3 text-[#8B95A5]">
        <Loader2 className="w-6 h-6 animate-spin text-[#38BDF8]" />
        <p className="text-xs font-medium">Opening Reticle Studio...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0D10] text-[#E8ECF2]">
      {/* Hidden multi-file uploader triggered by TopBar & Queue buttons */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleUploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <TopBar
        projects={projects}
        activeProject={activeProject}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onSelectProject={(projectId) => {
          const found = projects.find((p) => p.id === projectId);
          if (found) void loadProjectWorkspace(found);
        }}
        onOpenNewProject={() => setProjectModalMode('create')}
        onOpenManageProject={() => setProjectModalMode('manage')}
        onTriggerImportImages={() => fileInputRef.current?.click()}
      />

      {/* Active Workspace View */}
      {activeTab === 'annotate' && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <ToolRail
            tool={tool}
            onSelectTool={setTool}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onFitView={() => setFitSignal((s) => s + 1)}
            displaySettings={displaySettings}
            onChangeDisplaySettings={(patch) =>
              setDisplaySettings((prev) => ({ ...prev, ...patch }))
            }
            onResetDisplaySettings={() => setDisplaySettings(DEFAULT_DISPLAY_SETTINGS)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            canCrop={Boolean(activeImage)}
            onOpenCrop={() => setCropModalOpen(true)}
          />

          <ImageQueue
            images={images}
            imageUrls={imageUrls}
            activeImageId={activeImageId}
            collapsed={queueCollapsed}
            onToggleCollapse={() => setQueueCollapsed((v) => !v)}
            onSelectImage={handleSelectImage}
            onTriggerUpload={() => fileInputRef.current?.click()}
            onOpenBatchStudio={() =>
              setBatchStudio({
                open: true,
                tab: 'crop',
                selectedIds: [],
                filteredIds: images.map((i) => i.id),
              })
            }
          />

          <AnnotationCanvas
            image={activeImage}
            imageUrl={activeImage ? imageUrls[activeImage.id] || activeImage.seedUrl || null : null}
            imageIndex={activeImageIndex}
            totalImages={images.length}
            classes={activeProject.classes}
            activeClassId={activeClassId}
            activeObjectId={activeObjectId}
            tool={tool}
            selectedAnnotationId={selectedAnnotationId}
            displaySettings={displaySettings}
            fitSignal={fitSignal}
            onSelectAnnotation={setSelectedAnnotationId}
            onChangeTool={setTool}
            onCommitAnnotations={handleCommitAnnotations}
            onAcceptAllAI={handleAcceptAllAI}
            onAcceptSelectedAI={handleAcceptAnnotationAI}
            onDismissAllAI={handleDismissAllAI}
            onPrevImage={() => {
              if (activeImageIndex > 0) handleSelectImage(images[activeImageIndex - 1].id);
            }}
            onNextImage={() => {
              if (activeImageIndex >= 0 && activeImageIndex < images.length - 1) {
                handleSelectImage(images[activeImageIndex + 1].id);
              }
            }}
            onUploadFiles={handleUploadFiles}
          />

          <InspectorPanel
            image={activeImage}
            allImages={images}
            classes={activeProject.classes}
            activeClassId={activeClassId}
            activeObjectId={activeObjectId}
            selectedAnnotationId={selectedAnnotationId}
            collapsed={inspectorCollapsed}
            aiDetecting={aiDetecting}
            aiCaptioning={aiCaptioning}
            aiError={aiError}
            aiCaptionDraft={aiCaptionDraft}
            onToggleCollapse={() => setInspectorCollapsed((v) => !v)}
            onSelectActiveTaxonomy={(classId, objectId) => {
              setActiveClassId(classId);
              setActiveObjectId(objectId);
            }}
            onSelectAnnotation={setSelectedAnnotationId}
            onUpdateAnnotation={handleUpdateAnnotation}
            onCommitAnnotations={handleCommitAnnotations}
            onDeleteAnnotation={handleDeleteAnnotation}
            onAcceptAnnotationAI={handleAcceptAnnotationAI}
            onUpdateImageMeta={handleUpdateImageMeta}
            onUpdateClasses={handleUpdateClasses}
            onDeleteClassOrObject={setPendingDeleteTax}
            onRunAIDetect={() => void handleRunAIDetect()}
            onCancelAIDetect={handleCancelAIDetect}
            onRunAICaption={(style) => void handleRunAICaption(style)}
            onCancelAICaption={handleCancelAICaption}
            onApplyAICaptionDraft={handleApplyAICaptionDraft}
            onDismissAICaptionDraft={() => setAiCaptionDraft(null)}
            onClearAIError={() => setAiError(null)}
          />
        </div>
      )}

      {activeTab === 'dataset' && (
        <DatasetGallery
          images={images}
          imageUrls={imageUrls}
          classes={activeProject.classes}
          onOpenImage={(id) => {
            handleSelectImage(id);
            setActiveTab('annotate');
          }}
          onDeleteImage={(id) => void handleDeleteImage(id)}
          onDeleteImagesBulk={(ids) => void handleDeleteImagesBulk(ids)}
          onUpdateImage={handleUpdateAnyImage}
          onBulkUpdateSplit={(ids, split) => void handleBulkUpdateSplit(ids, split)}
          onAutoSplit={(t, v, te) => void handleAutoSplit(t, v, te)}
          onUploadFiles={(files) => void handleUploadFiles(files)}
          onOpenBatchStudio={(tab, selectedIds, filteredIds) =>
            setBatchStudio({ open: true, tab, selectedIds, filteredIds })
          }
        />
      )}

      {activeTab === 'analytics' && (
        <AnalyticsView
          projectName={activeProject.name}
          images={images}
          classes={activeProject.classes}
        />
      )}

      {activeTab === 'export' && (
        <ExportView
          project={activeProject}
          images={images}
          onImportAnnotationsJson={(raw) => void handleImportAnnotationsJson(raw)}
        />
      )}

      {/* Modals */}
      {projectModalMode && (
        <ProjectModal
          mode={projectModalMode}
          activeProject={activeProject}
          canDelete={projects.length > 1}
          onClose={() => setProjectModalMode(null)}
          onCreateProject={(name, desc, preset) => void handleCreateProject(name, desc, preset)}
          onUpdateProject={(name, desc) => void handleUpdateProjectInfo(name, desc)}
          onDeleteProject={() => void handleDeleteActiveProject()}
        />
      )}

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {pendingDeleteTax && (
        <DeleteTaxonomyModal
          target={pendingDeleteTax}
          classes={activeProject.classes}
          affectedCount={affectedDeleteCount}
          onClose={() => setPendingDeleteTax(null)}
          onConfirm={(res) => void handleConfirmDeleteTaxonomy(res)}
        />
      )}

      {cropModalOpen && activeImage && (imageUrls[activeImage.id] || activeImage.seedUrl) && (
        <CropModal
          image={activeImage}
          imageUrl={imageUrls[activeImage.id] || activeImage.seedUrl || ''}
          classes={activeProject.classes}
          selectedAnnotationId={selectedAnnotationId}
          onClose={() => setCropModalOpen(false)}
          onApplyCrop={handleApplyCrop}
        />
      )}

      {batchStudio.open && (
        <BatchStudioModal
          initialTab={batchStudio.tab}
          allImages={images}
          selectedIds={batchStudio.selectedIds}
          filteredIds={batchStudio.filteredIds}
          imageUrls={imageUrls}
          classes={activeProject.classes}
          onClose={() => setBatchStudio((prev) => ({ ...prev, open: false }))}
          onApplyMediaBatch={handleApplyMediaBatch}
          onApplyMetaBatch={handleApplyMetaBatch}
        />
      )}

      {/* Non-blocking Toast Stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2 px-3.5 py-2.5 rounded-md bg-[#12151B] border border-[#232834] shadow-2xl text-xs text-[#E8ECF2]"
            >
              {t.tone === 'success' && <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />}
              {t.tone === 'error' && <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />}
              {t.tone === 'info' && <Info className="w-4 h-4 text-[#38BDF8] shrink-0" />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
