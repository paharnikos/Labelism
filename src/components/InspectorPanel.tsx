import { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Sparkles,
  Check,
  X,
  Plus,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
} from 'lucide-react';
import type {
  AICaptionResult,
  Annotation,
  CaptionStyle,
  DatasetImage,
  LabelClass,
  ReviewStatus,
  SplitType,
} from '../types/annotation';
import {
  CLASS_PALETTE,
  deriveObjectColor,
  generateId,
  getAnnotationArea,
  resolveTaxonomy,
} from '../utils/geometry';

type InspectorTab = 'annotations' | 'captions' | 'taxonomy';

interface InspectorPanelProps {
  image: DatasetImage | null;
  allImages: DatasetImage[];
  classes: LabelClass[];
  activeClassId: string;
  activeObjectId: string;
  selectedAnnotationId: string | null;
  collapsed: boolean;
  aiDetecting: boolean;
  aiCaptioning: boolean;
  aiError: string | null;
  aiCaptionDraft: AICaptionResult | null;
  onToggleCollapse: () => void;
  onSelectActiveTaxonomy: (classId: string, objectId: string) => void;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (annId: string, updater: (ann: Annotation) => Annotation) => void;
  onCommitAnnotations: (next: Annotation[]) => void;
  onDeleteAnnotation: (annId: string) => void;
  onAcceptAnnotationAI: (annId: string) => void;
  onUpdateImageMeta: (patch: Partial<DatasetImage>) => void;
  onUpdateClasses: (nextClasses: LabelClass[]) => void;
  onDeleteClassOrObject: (target: { kind: 'class'; classId: string } | { kind: 'object'; classId: string; objectId: string }) => void;
  onRunAIDetect: () => void;
  onCancelAIDetect: () => void;
  onRunAICaption: (style: CaptionStyle) => void;
  onCancelAICaption: () => void;
  onApplyAICaptionDraft: () => void;
  onDismissAICaptionDraft: () => void;
  onClearAIError: () => void;
}

const REVIEW_STATUSES: Array<{ id: ReviewStatus; label: string }> = [
  { id: 'unlabeled', label: 'Unlabeled' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'labeled', label: 'Labeled' },
  { id: 'verified', label: 'Verified' },
];

const SPLITS: Array<{ id: SplitType; label: string }> = [
  { id: 'train', label: 'Train' },
  { id: 'val', label: 'Val' },
  { id: 'test', label: 'Test' },
];

const GEOM_LABELS: Record<Annotation['type'], string> = {
  bbox: 'Box',
  polygon: 'Polygon',
  polyline: 'Line',
  keypoint: 'Point',
};

export default function InspectorPanel({
  image,
  allImages,
  classes,
  activeClassId,
  activeObjectId,
  selectedAnnotationId,
  collapsed,
  aiDetecting,
  aiCaptioning,
  aiError,
  aiCaptionDraft,
  onToggleCollapse,
  onSelectActiveTaxonomy,
  onSelectAnnotation,
  onUpdateAnnotation,
  onCommitAnnotations,
  onDeleteAnnotation,
  onAcceptAnnotationAI,
  onUpdateImageMeta,
  onUpdateClasses,
  onDeleteClassOrObject,
  onRunAIDetect,
  onCancelAIDetect,
  onRunAICaption,
  onCancelAICaption,
  onApplyAICaptionDraft,
  onDismissAICaptionDraft,
  onClearAIError,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>('annotations');
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('descriptive');
  const [tagInput, setTagInput] = useState('');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);

  // Taxonomy Tree local UI state
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
  const [newClassName, setNewClassName] = useState('');
  const [newClassColor, setNewClassColor] = useState(CLASS_PALETTE[4]);
  const [addingObjForClass, setAddingObjForClass] = useState<string | null>(null);
  const [newObjName, setNewObjName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Clear multi-select when switching images
  useEffect(() => {
    setCheckedIds([]);
  }, [image?.id]);

  const validCheckedIds = useMemo(() => {
    if (!image) return [];
    const present = new Set(image.annotations.map((a) => a.id));
    return checkedIds.filter((id) => present.has(id));
  }, [image, checkedIds]);

  const checkedSet = useMemo(() => new Set(validCheckedIds), [validCheckedIds]);

  const selectedAnn = useMemo(
    () => image?.annotations.find((a) => a.id === selectedAnnotationId) ?? null,
    [image, selectedAnnotationId]
  );

  // Project-wide counts per class & object for the taxonomy tree
  const taxonomyCounts = useMemo(() => {
    const classCounts = new Map<string, number>();
    const objCounts = new Map<string, number>();
    for (const img of allImages) {
      for (const ann of img.annotations) {
        if (ann.source === 'ai_suggestion') continue;
        classCounts.set(ann.classId, (classCounts.get(ann.classId) ?? 0) + 1);
        objCounts.set(ann.objectId, (objCounts.get(ann.objectId) ?? 0) + 1);
      }
    }
    return { classCounts, objCounts };
  }, [allImages]);

  const activeTax = useMemo(
    () => resolveTaxonomy(classes, activeClassId, activeObjectId),
    [classes, activeClassId, activeObjectId]
  );

  if (collapsed) {
    return (
      <div className="w-9 shrink-0 bg-[#12151B] border-l border-[#232834] flex flex-col items-center py-2.5 gap-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Inspector"
          aria-label="Expand Inspector"
          className="w-7 h-7 rounded flex items-center justify-center text-[#8B95A5] hover:text-white hover:bg-[#181C24] transition-colors"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono tabular-nums text-[#8B95A5] [writing-mode:vertical-rl]">
          Inspector
        </span>
      </div>
    );
  }

  const handleAddTag = (raw: string) => {
    if (!image) return;
    const cleaned = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (cleaned.length === 0) return;
    const merged = Array.from(new Set([...image.tags, ...cleaned]));
    onUpdateImageMeta({ tags: merged });
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    if (!image) return;
    onUpdateImageMeta({ tags: image.tags.filter((t) => t !== tag) });
  };

  const handleAddClass = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newClassName.trim();
    if (!name) return;
    const classId = generateId('cls');
    const objId = generateId('obj');
    const nextClass: LabelClass = {
      id: classId,
      name,
      color: newClassColor,
      visible: true,
      objects: [
        {
          id: objId,
          classId,
          name: 'Default',
          color: deriveObjectColor(newClassColor, 0),
          visible: true,
        },
      ],
    };
    onUpdateClasses([...classes, nextClass]);
    onSelectActiveTaxonomy(classId, objId);
    setNewClassName('');
    setNewClassColor(CLASS_PALETTE[(classes.length + 1) % CLASS_PALETTE.length]);
  };

  const handleAddObject = (classId: string) => {
    const name = newObjName.trim();
    if (!name) return;
    let createdObjId = '';
    const next = classes.map((c) => {
      if (c.id !== classId) return c;
      createdObjId = generateId('obj');
      return {
        ...c,
        objects: [
          ...c.objects,
          {
            id: createdObjId,
            classId: c.id,
            name,
            color: deriveObjectColor(c.color, c.objects.length),
            visible: true,
          },
        ],
      };
    });
    onUpdateClasses(next);
    if (createdObjId) onSelectActiveTaxonomy(classId, createdObjId);
    setNewObjName('');
    setAddingObjForClass(null);
  };

  const handleAssignHotkey = (classId: string, objectId: string, hotkey: string) => {
    const next = classes.map((c) => ({
      ...c,
      objects: c.objects.map((o) => {
        if (c.id === classId && o.id === objectId) {
          return { ...o, hotkey: hotkey || undefined };
        }
        // Clear duplicate hotkey from other objects
        if (hotkey && o.hotkey === hotkey) {
          return { ...o, hotkey: undefined };
        }
        return o;
      }),
    }));
    onUpdateClasses(next);
  };

  const handleCommitRename = (kind: 'class' | 'object', classId: string, objectId?: string) => {
    const clean = editingText.trim();
    if (clean) {
      if (kind === 'class') {
        onUpdateClasses(classes.map((c) => (c.id === classId ? { ...c, name: clean } : c)));
      } else if (objectId) {
        onUpdateClasses(
          classes.map((c) =>
            c.id === classId
              ? {
                  ...c,
                  objects: c.objects.map((o) => (o.id === objectId ? { ...o, name: clean } : o)),
                }
              : c
          )
        );
      }
    }
    setEditingId(null);
    setEditingText('');
  };

  return (
    <aside className="w-[324px] shrink-0 bg-[#12151B] border-l border-[#232834] flex flex-col min-h-0">
      {/* Header with Segmented Tabs */}
      <div className="px-2.5 py-2 border-b border-[#232834] flex items-center justify-between gap-2">
        <div className="flex-1 grid grid-cols-3 gap-1 p-0.5 bg-[#0B0D10] rounded-md border border-[#232834]">
          {(
            [
              ['annotations', 'Labels'],
              ['captions', 'Captions'],
              ['taxonomy', 'Taxonomy'],
            ] as Array<[InspectorTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`py-1 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                tab === id
                  ? 'bg-[#181C24] text-white'
                  : 'text-[#8B95A5] hover:text-[#E8ECF2]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse Inspector"
          aria-label="Collapse Inspector"
          className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24] transition-colors shrink-0"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Inline AI Error Banner */}
      {aiError && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/35 text-[11px] text-[#FCA5A5] flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] shrink-0 mt-0.5" />
          <p className="flex-1 leading-relaxed">{aiError}</p>
          <button
            type="button"
            onClick={onClearAIError}
            aria-label="Dismiss error"
            className="text-[#FCA5A5] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* TAB 1: ANNOTATIONS */}
      {tab === 'annotations' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Active Drawing Class -> Object Selector */}
          <div className="p-3 border-b border-[#232834] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#8B95A5]">
                Active Class / Object
              </span>
              <button
                type="button"
                onClick={() => setTab('taxonomy')}
                className="text-[11px] text-[#38BDF8] hover:underline"
              >
                Edit Taxonomy
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                style={{ backgroundColor: activeTax.color }}
              />
              <select
                value={`${activeClassId}::${activeObjectId}`}
                onChange={(e) => {
                  const [cId, oId] = e.target.value.split('::');
                  if (cId && oId) onSelectActiveTaxonomy(cId, oId);
                }}
                aria-label="Active drawing Class and Object"
                className="flex-1 bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
              >
                {classes.map((cls) => (
                  <optgroup key={cls.id} label={cls.name}>
                    {cls.objects.map((obj) => (
                      <option key={obj.id} value={`${cls.id}::${obj.id}`}>
                        {cls.name} / {obj.name}
                        {obj.hotkey ? `  [${obj.hotkey}]` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* AI Assist Controls (Gemini 3.1 Flash Lite) */}
            <div className="pt-1 flex items-center gap-2">
              {aiDetecting ? (
                <button
                  type="button"
                  onClick={onCancelAIDetect}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#38BDF8]/40 text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                  <span>Detecting… Cancel</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!image}
                  onClick={onRunAIDetect}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] disabled:opacity-45 transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Suggest Boxes</span>
                </button>
              )}

              <button
                type="button"
                disabled={!image || aiCaptioning}
                onClick={() => {
                  setTab('captions');
                  onRunAICaption(captionStyle);
                }}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#CBD5E1] disabled:opacity-45 transition-colors whitespace-nowrap"
              >
                {aiCaptioning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                ) : (
                  <span>Auto-Caption</span>
                )}
              </button>
            </div>
          </div>

          {/* Selected Annotation Property Editor */}
          {selectedAnn && (
            <div className="p-3 border-b border-[#232834] bg-[#0F1218] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#E8ECF2]">
                  Selected {selectedAnn.type.toUpperCase()}
                </span>
                <div className="flex items-center gap-1.5">
                  {selectedAnn.source === 'ai_suggestion' && (
                    <button
                      type="button"
                      onClick={() => onAcceptAnnotationAI(selectedAnn.id)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] hover:bg-[#22C55E]/25 text-[11px] font-medium transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      <span>Accept</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteAnnotation(selectedAnn.id)}
                    title="Delete Annotation (Del)"
                    className="p-1 rounded text-[#8B95A5] hover:text-[#EF4444] hover:bg-[#181C24] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Reassign Class -> Object */}
              <select
                value={`${selectedAnn.classId}::${selectedAnn.objectId}`}
                onChange={(e) => {
                  const [cId, oId] = e.target.value.split('::');
                  if (cId && oId) {
                    onUpdateAnnotation(selectedAnn.id, (a) => ({
                      ...a,
                      classId: cId,
                      objectId: oId,
                    }));
                  }
                }}
                aria-label="Reassign selected annotation Class and Object"
                className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2 py-1.5 text-xs text-[#E8ECF2] outline-none"
              >
                {classes.map((cls) => (
                  <optgroup key={cls.id} label={cls.name}>
                    {cls.objects.map((obj) => (
                      <option key={obj.id} value={`${cls.id}::${obj.id}`}>
                        {cls.name} / {obj.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Geometry Readout */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono tabular-nums text-[#8B95A5]">
                {selectedAnn.type === 'bbox' && (
                  <>
                    <div>
                      Origin:{' '}
                      <span className="text-[#E8ECF2]">
                        {Math.round(selectedAnn.x)},{Math.round(selectedAnn.y)}
                      </span>
                    </div>
                    <div>
                      Size:{' '}
                      <span className="text-[#E8ECF2]">
                        {Math.round(selectedAnn.width)}×{Math.round(selectedAnn.height)}
                      </span>
                    </div>
                    <div className="col-span-2">
                      Area:{' '}
                      <span className="text-[#E8ECF2]">
                        {getAnnotationArea(selectedAnn).toLocaleString()} px²
                      </span>
                    </div>
                  </>
                )}
                {selectedAnn.type === 'polygon' && (
                  <>
                    <div>
                      Vertices:{' '}
                      <span className="text-[#E8ECF2]">{selectedAnn.points.length}</span>
                    </div>
                    <div>
                      Area:{' '}
                      <span className="text-[#E8ECF2]">
                        {getAnnotationArea(selectedAnn).toLocaleString()} px²
                      </span>
                    </div>
                  </>
                )}
                {selectedAnn.type === 'polyline' && (
                  <>
                    <div>
                      Points:{' '}
                      <span className="text-[#E8ECF2]">{selectedAnn.points.length}</span>
                    </div>
                    <div>
                      Length:{' '}
                      <span className="text-[#E8ECF2]">
                        {getAnnotationArea(selectedAnn).toLocaleString()} px
                      </span>
                    </div>
                  </>
                )}
                {selectedAnn.type === 'keypoint' && (
                  <div className="col-span-2">
                    Position:{' '}
                    <span className="text-[#E8ECF2]">
                      X {Math.round(selectedAnn.x)} · Y {Math.round(selectedAnn.y)}
                    </span>
                  </div>
                )}
              </div>

              {/* ML Attribute Toggles */}
              <div className="flex items-center gap-1.5">
                {(
                  [
                    ['occluded', 'Occluded'],
                    ['truncated', 'Truncated'],
                    ['crowd', 'Crowd'],
                  ] as const
                ).map(([key, label]) => {
                  const active = selectedAnn.attributes[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        onUpdateAnnotation(selectedAnn.id, (a) => ({
                          ...a,
                          attributes: { ...a.attributes, [key]: !a.attributes[key] },
                        }))
                      }
                      className={`flex-1 py-1 px-1.5 rounded text-[11px] font-medium border transition-colors ${
                        active
                          ? 'bg-[#38BDF8]/15 border-[#38BDF8]/50 text-[#38BDF8]'
                          : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                value={selectedAnn.note ?? ''}
                onChange={(e) =>
                  onUpdateAnnotation(selectedAnn.id, (a) => ({ ...a, note: e.target.value }))
                }
                placeholder="Annotation note (optional)"
                className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded px-2 py-1 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
              />
            </div>
          )}

          {/* Annotations List Header with Select All */}
          <div className="px-3 py-2 flex items-center justify-between text-[11px] text-[#8B95A5] border-b border-[#232834]">
            <div className="flex items-center gap-2">
              {image && image.annotations.length > 0 && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={
                    validCheckedIds.length > 0 &&
                    validCheckedIds.length === image.annotations.length
                  }
                  aria-label="Select all annotations"
                  title={
                    validCheckedIds.length === image.annotations.length
                      ? 'Deselect all'
                      : 'Select all'
                  }
                  onClick={() => {
                    if (validCheckedIds.length === image.annotations.length) {
                      setCheckedIds([]);
                      onSelectAnnotation(null);
                    } else {
                      const allIds = image.annotations.map((a) => a.id);
                      setCheckedIds(allIds);
                      if (!selectedAnnotationId && allIds[0]) onSelectAnnotation(allIds[0]);
                    }
                  }}
                  className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors shrink-0 ${
                    validCheckedIds.length > 0 &&
                    validCheckedIds.length === image.annotations.length
                      ? 'bg-[#38BDF8] border-[#38BDF8] text-[#07090C]'
                      : validCheckedIds.length > 0
                        ? 'bg-[#38BDF8]/25 border-[#38BDF8] text-[#38BDF8]'
                        : 'bg-[#0B0D10] border-[#475569] hover:border-[#38BDF8]'
                  }`}
                >
                  {validCheckedIds.length > 0 && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </button>
              )}
              <span>Image Annotations</span>
            </div>
            <span className="font-mono tabular-nums">{image?.annotations.length ?? 0}</span>
          </div>

          {/* Batch Actions Bar when annotations are checked */}
          {image && validCheckedIds.length > 0 && (
            <div className="px-3 py-1.5 bg-[#0F1218] border-b border-[#232834] flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono tabular-nums text-[#38BDF8]">
                {validCheckedIds.length} selected
              </span>
              <div className="flex items-center gap-1">
                {image.annotations.some(
                  (a) => checkedSet.has(a.id) && a.source === 'ai_suggestion'
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      onCommitAnnotations(
                        image.annotations.map((a) =>
                          checkedSet.has(a.id) && a.source === 'ai_suggestion'
                            ? { ...a, source: 'manual', confidence: undefined }
                            : a
                        )
                      );
                    }}
                    className="px-1.5 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] hover:bg-[#22C55E]/25 font-medium transition-colors"
                  >
                    Accept AI
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const anyVisible = image.annotations.some(
                      (a) => checkedSet.has(a.id) && a.visible
                    );
                    onCommitAnnotations(
                      image.annotations.map((a) =>
                        checkedSet.has(a.id) ? { ...a, visible: !anyVisible } : a
                      )
                    );
                  }}
                  className="px-1.5 py-0.5 rounded bg-[#181C24] hover:bg-[#232834] text-[#CBD5E1] transition-colors"
                >
                  {image.annotations.some((a) => checkedSet.has(a.id) && a.visible)
                    ? 'Hide'
                    : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCommitAnnotations(image.annotations.filter((a) => !checkedSet.has(a.id)));
                    if (selectedAnnotationId && checkedSet.has(selectedAnnotationId)) {
                      onSelectAnnotation(null);
                    }
                    setCheckedIds([]);
                  }}
                  className="px-1.5 py-0.5 rounded bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#FCA5A5] font-medium transition-colors"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedIds([])}
                  title="Clear selection"
                  className="p-0.5 rounded text-[#8B95A5] hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto divide-y divide-[#232834]/60">
            {!image || image.annotations.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#8B95A5] leading-relaxed">
                No annotations on this image yet. Choose a tool (`B`, `P`, `L`, `K`) or click{' '}
                <strong className="text-[#E8ECF2]">Suggest Boxes</strong>.
              </div>
            ) : (
              image.annotations.map((ann, index) => {
                const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
                const selected = ann.id === selectedAnnotationId;
                const isChecked = checkedSet.has(ann.id);
                const isAI = ann.source === 'ai_suggestion';

                return (
                  <div
                    key={ann.id}
                    onClick={() => onSelectAnnotation(ann.id)}
                    className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#181C24]'
                        : isChecked
                          ? 'bg-[#38BDF8]/8'
                          : 'hover:bg-[#181C24]/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        aria-label={`Select ${tax.className} / ${tax.objectName} #${index + 1}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isChecked) {
                            const next = validCheckedIds.filter((id) => id !== ann.id);
                            setCheckedIds(next);
                            if (selectedAnnotationId === ann.id) {
                              onSelectAnnotation(next[next.length - 1] ?? null);
                            }
                          } else {
                            setCheckedIds([...validCheckedIds, ann.id]);
                            onSelectAnnotation(ann.id);
                          }
                        }}
                        className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors shrink-0 ${
                          isChecked
                            ? 'bg-[#38BDF8] border-[#38BDF8] text-[#07090C]'
                            : 'bg-[#0B0D10] border-[#475569] hover:border-[#38BDF8]'
                        }`}
                      >
                        {isChecked && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                      </button>
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: tax.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#E8ECF2] truncate flex items-center gap-1.5">
                          <span className="truncate">{tax.objectName}</span>
                          {isAI && (
                            <span className="text-[10px] font-mono text-[#38BDF8]">
                              AI {ann.confidence ? `${Math.round(ann.confidence * 100)}%` : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#8B95A5] truncate">
                          {tax.className} · {GEOM_LABELS[ann.type]} · #{index + 1}
                        </div>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAI && (
                        <button
                          type="button"
                          onClick={() => onAcceptAnnotationAI(ann.id)}
                          title="Accept AI Suggestion"
                          className="p-1 rounded text-[#22C55E] hover:bg-[#232834]"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateAnnotation(ann.id, (a) => ({ ...a, visible: !a.visible }))
                        }
                        title={ann.visible ? 'Hide' : 'Show'}
                        className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#232834]"
                      >
                        {ann.visible ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-[#64748B]" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateAnnotation(ann.id, (a) => ({ ...a, locked: !a.locked }))
                        }
                        title={ann.locked ? 'Unlock' : 'Lock'}
                        className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#232834]"
                      >
                        {ann.locked ? (
                          <Lock className="w-3.5 h-3.5 text-[#F59E0B]" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAnnotation(ann.id)}
                        title="Delete"
                        className="p-1 rounded text-[#8B95A5] hover:text-[#EF4444] hover:bg-[#232834]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CAPTIONS & TAGS */}
      {tab === 'captions' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {!image ? (
            <p className="text-xs text-[#8B95A5] text-center py-8">
              Select or upload an image to edit captions and metadata.
            </p>
          ) : (
            <>
              {/* Split & Status */}
              <div className="space-y-3 pb-3 border-b border-[#232834]">
                <div>
                  <label className="block text-[11px] font-medium text-[#8B95A5] mb-1.5">
                    Review Status
                  </label>
                  <div className="grid grid-cols-2 gap-1">
                    {REVIEW_STATUSES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onUpdateImageMeta({ status: s.id })}
                        className={`py-1.5 px-2 rounded text-xs font-medium border transition-colors ${
                          image.status === s.id
                            ? 'bg-[#38BDF8]/15 border-[#38BDF8]/50 text-[#38BDF8]'
                            : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#8B95A5] mb-1.5">
                    Dataset Split
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {SPLITS.map((sp) => (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => onUpdateImageMeta({ split: sp.id })}
                        className={`py-1.5 px-2 rounded text-xs font-medium border transition-colors ${
                          image.split === sp.id
                            ? 'bg-[#181C24] border-[#38BDF8] text-white'
                            : 'bg-[#0B0D10] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2]'
                        }`}
                      >
                        {sp.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Auto-Caption Control */}
              <div className="space-y-2 pb-3 border-b border-[#232834]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#8B95A5]">
                    AI Caption Assist (Flash Lite)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={captionStyle}
                    onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)}
                    aria-label="Caption generation style"
                    className="bg-[#0B0D10] border border-[#232834] rounded-md px-2 py-1.5 text-xs text-[#CBD5E1] outline-none"
                  >
                    <option value="descriptive">Descriptive</option>
                    <option value="concise">Concise</option>
                    <option value="technical">Technical CV</option>
                  </select>
                  {aiCaptioning ? (
                    <button
                      type="button"
                      onClick={onCancelAICaption}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#38BDF8]/40 text-xs font-medium text-[#E8ECF2] transition-colors"
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                      <span>Generating… Cancel</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRunAICaption(captionStyle)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#38BDF8]" />
                      <span>Generate Draft</span>
                    </button>
                  )}
                </div>

                {aiCaptionDraft && (
                  <div className="p-2.5 rounded-md bg-[#0F1722] border border-[#38BDF8]/40 space-y-2">
                    <div className="text-[11px] font-medium text-[#38BDF8]">
                      AI Draft Preview
                    </div>
                    <p className="text-xs text-[#E8ECF2] leading-relaxed">
                      {aiCaptionDraft.caption}
                    </p>
                    {aiCaptionDraft.tags.length > 0 && (
                      <div className="text-[11px] text-[#8B95A5]">
                        Tags: {aiCaptionDraft.tags.join(' · ')}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={onApplyAICaptionDraft}
                        className="flex-1 py-1.5 px-2 rounded bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold transition-colors"
                      >
                        Apply Draft
                      </button>
                      <button
                        type="button"
                        onClick={onDismissAICaptionDraft}
                        className="py-1.5 px-2.5 rounded bg-[#181C24] hover:bg-[#232834] text-xs text-[#8B95A5] hover:text-white transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Primary Dense Caption */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="primary-caption-input"
                    className="text-[11px] font-medium text-[#8B95A5]"
                  >
                    Primary Caption
                  </label>
                  <span className="text-[11px] font-mono tabular-nums text-[#64748B]">
                    {image.caption.trim() ? image.caption.trim().split(/\s+/).length : 0} words
                  </span>
                </div>
                <textarea
                  id="primary-caption-input"
                  rows={5}
                  value={image.caption}
                  onChange={(e) => onUpdateImageMeta({ caption: e.target.value })}
                  placeholder="Write a dense, accurate training caption describing subjects, clothing, pose, objects, and setting..."
                  className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md p-2.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] leading-relaxed outline-none resize-y"
                />
              </div>

              {/* Short Caption */}
              <div>
                <label
                  htmlFor="short-caption-input"
                  className="block text-[11px] font-medium text-[#8B95A5] mb-1.5"
                >
                  Short / Prompt Caption
                </label>
                <input
                  id="short-caption-input"
                  type="text"
                  value={image.shortCaption}
                  onChange={(e) => onUpdateImageMeta({ shortCaption: e.target.value })}
                  placeholder="Concise 8–14 word summary"
                  className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-2 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
                />
              </div>

              {/* Image-Level Tags */}
              <div>
                <label
                  htmlFor="image-tags-input"
                  className="block text-[11px] font-medium text-[#8B95A5] mb-1.5"
                >
                  Image Classification Tags
                </label>
                <div className="flex gap-1.5 mb-2">
                  <input
                    id="image-tags-input"
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        handleAddTag(tagInput);
                      }
                    }}
                    placeholder="Add tag + Enter (e.g. studio, full-body)"
                    className="flex-1 bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-1.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddTag(tagInput)}
                    className="px-2.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2]"
                  >
                    Add
                  </button>
                </div>
                {image.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {image.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        title={`Remove tag "${tag}"`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-[11px] text-[#CBD5E1] transition-colors"
                      >
                        <span>{tag}</span>
                        <X className="w-3 h-3 text-[#8B95A5]" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#64748B]">No image tags assigned.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: HIERARCHICAL CLASS -> OBJECT TAXONOMY */}
      {tab === 'taxonomy' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b border-[#232834]">
            <p className="text-[11px] text-[#8B95A5] leading-relaxed mb-2.5">
              Organize labels as parent <strong className="text-[#E8ECF2]">Classes</strong> (e.g.{' '}
              Body, Clothes) with child <strong className="text-[#E8ECF2]">Objects</strong> (e.g.{' '}
              Hand, Dress). Maps natively to COCO supercategory / category.
            </p>
            <form onSubmit={handleAddClass} className="flex items-center gap-1.5">
              <input
                type="color"
                value={newClassColor}
                onChange={(e) => setNewClassColor(e.target.value)}
                aria-label="New class color"
                className="w-7 h-7 rounded bg-transparent border border-[#232834] cursor-pointer shrink-0 p-0.5"
              />
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="New parent class (e.g. Body)"
                className="flex-1 bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-1.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold shrink-0"
              >
                Add
              </button>
            </form>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#232834]">
            {classes.map((cls) => {
              const isExpanded = expandedClasses[cls.id] ?? true;
              const clsCount = taxonomyCounts.classCounts.get(cls.id) ?? 0;

              return (
                <div key={cls.id} className="py-1.5">
                  {/* Parent Class Row */}
                  <div className="px-2.5 py-1.5 flex items-center justify-between gap-1.5 hover:bg-[#181C24]/50">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedClasses((prev) => ({ ...prev, [cls.id]: !isExpanded }))
                        }
                        aria-label={isExpanded ? 'Collapse class' : 'Expand class'}
                        className="p-0.5 text-[#8B95A5] hover:text-white"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <input
                        type="color"
                        value={cls.color}
                        onChange={(e) => {
                          const nextColor = e.target.value;
                          onUpdateClasses(
                            classes.map((c) =>
                              c.id === cls.id
                                ? {
                                    ...c,
                                    color: nextColor,
                                    objects: c.objects.map((o, idx) => ({
                                      ...o,
                                      color: deriveObjectColor(nextColor, idx),
                                    })),
                                  }
                                : c
                            )
                          );
                        }}
                        aria-label={`Change color for class ${cls.name}`}
                        className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer shrink-0 p-0"
                      />

                      {editingId === cls.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onBlur={() => handleCommitRename('class', cls.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommitRename('class', cls.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 bg-[#0B0D10] border border-[#38BDF8] rounded px-1.5 py-0.5 text-xs text-white outline-none"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-[#E8ECF2] truncate">
                          {cls.name}
                        </span>
                      )}

                      <span className="text-[11px] font-mono tabular-nums text-[#64748B] shrink-0">
                        {clsCount}
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedClasses((prev) => ({ ...prev, [cls.id]: true }));
                          setAddingObjForClass(addingObjForClass === cls.id ? null : cls.id);
                          setNewObjName('');
                        }}
                        title={`Add child object under ${cls.name}`}
                        className="p-1 rounded text-[#38BDF8] hover:bg-[#232834]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(cls.id);
                          setEditingText(cls.name);
                        }}
                        title="Rename class"
                        className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#232834]"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateClasses(
                            classes.map((c) =>
                              c.id === cls.id ? { ...c, visible: !c.visible } : c
                            )
                          )
                        }
                        title={cls.visible ? 'Hide entire class' : 'Show entire class'}
                        className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#232834]"
                      >
                        {cls.visible ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-[#64748B]" />
                        )}
                      </button>
                      {classes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteClassOrObject({ kind: 'class', classId: cls.id })}
                          title="Delete class"
                          className="p-1 rounded text-[#8B95A5] hover:text-[#EF4444] hover:bg-[#232834]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Child Objects List */}
                  {isExpanded && (
                    <div className="pl-7 pr-2.5 pb-1 space-y-0.5">
                      {cls.objects.map((obj) => {
                        const isActiveTarget =
                          cls.id === activeClassId && obj.id === activeObjectId;
                        const count = taxonomyCounts.objCounts.get(obj.id) ?? 0;

                        return (
                          <div
                            key={obj.id}
                            onClick={() => onSelectActiveTaxonomy(cls.id, obj.id)}
                            className={`px-2 py-1.5 rounded flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                              isActiveTarget
                                ? 'bg-[#38BDF8]/12 ring-1 ring-inset ring-[#38BDF8]/40'
                                : 'hover:bg-[#181C24]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <input
                                type="color"
                                value={obj.color}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  onUpdateClasses(
                                    classes.map((c) =>
                                      c.id === cls.id
                                        ? {
                                            ...c,
                                            objects: c.objects.map((o) =>
                                              o.id === obj.id
                                                ? { ...o, color: e.target.value }
                                                : o
                                            ),
                                          }
                                        : c
                                    )
                                  )
                                }
                                aria-label={`Color for object ${obj.name}`}
                                className="w-3.5 h-3.5 rounded bg-transparent border-0 cursor-pointer shrink-0 p-0"
                              />

                              {editingId === obj.id ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingText}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  onBlur={() => handleCommitRename('object', cls.id, obj.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter')
                                      handleCommitRename('object', cls.id, obj.id);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  className="flex-1 bg-[#0B0D10] border border-[#38BDF8] rounded px-1.5 py-0.5 text-xs text-white outline-none"
                                />
                              ) : (
                                <span
                                  className={`text-xs truncate ${
                                    isActiveTarget
                                      ? 'font-medium text-white'
                                      : 'text-[#CBD5E1]'
                                  }`}
                                >
                                  {obj.name}
                                </span>
                              )}

                              <span className="text-[11px] font-mono tabular-nums text-[#64748B] shrink-0">
                                {count}
                              </span>
                            </div>

                            <div
                              className="flex items-center gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                value={obj.hotkey ?? ''}
                                onChange={(e) =>
                                  handleAssignHotkey(cls.id, obj.id, e.target.value)
                                }
                                title="Assign quick hotkey 1–9"
                                aria-label={`Hotkey for ${obj.name}`}
                                className="bg-[#0B0D10] border border-[#232834] rounded px-1 py-0.5 text-[10px] font-mono text-[#8B95A5] outline-none"
                              >
                                <option value="">-</option>
                                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(obj.id);
                                  setEditingText(obj.name);
                                }}
                                title="Rename object"
                                className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#232834]"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateClasses(
                                    classes.map((c) =>
                                      c.id === cls.id
                                        ? {
                                            ...c,
                                            objects: c.objects.map((o) =>
                                              o.id === obj.id
                                                ? { ...o, visible: !o.visible }
                                                : o
                                            ),
                                          }
                                        : c
                                    )
                                  )
                                }
                                title={obj.visible ? 'Hide object' : 'Show object'}
                                className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#232834]"
                              >
                                {obj.visible ? (
                                  <Eye className="w-3 h-3" />
                                ) : (
                                  <EyeOff className="w-3 h-3 text-[#64748B]" />
                                )}
                              </button>

                              {cls.objects.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteClassOrObject({
                                      kind: 'object',
                                      classId: cls.id,
                                      objectId: obj.id,
                                    })
                                  }
                                  title="Delete object"
                                  className="p-1 rounded text-[#8B95A5] hover:text-[#EF4444] hover:bg-[#232834]"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {addingObjForClass === cls.id && (
                        <div className="pt-1.5 flex items-center gap-1.5">
                          <input
                            type="text"
                            autoFocus
                            value={newObjName}
                            onChange={(e) => setNewObjName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddObject(cls.id);
                              }
                              if (e.key === 'Escape') setAddingObjForClass(null);
                            }}
                            placeholder={`New object in ${cls.name}`}
                            className="flex-1 bg-[#0B0D10] border border-[#38BDF8] rounded px-2 py-1 text-xs text-white placeholder:text-[#64748B] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddObject(cls.id)}
                            className="px-2 py-1 rounded bg-[#38BDF8] text-[#07090C] text-[11px] font-semibold"
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
