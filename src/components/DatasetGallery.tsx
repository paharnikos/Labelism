import { useMemo, useState } from 'react';
import {
  Search,
  Upload,
  Shuffle,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Clock,
  CircleDashed,
  Check,
  Crop,
  Maximize,
  Tags,
  FileText,
  HardDrive,
} from 'lucide-react';
import type { DatasetImage, LabelClass, ReviewStatus, SplitType } from '../types/annotation';
import type { BatchTab } from './BatchStudioModal';

interface DatasetGalleryProps {
  images: DatasetImage[];
  imageUrls: Record<string, string>;
  classes: LabelClass[];
  onOpenImage: (imageId: string) => void;
  onDeleteImage: (imageId: string) => void;
  onDeleteImagesBulk: (imageIds: string[]) => void;
  onUpdateImage: (imageId: string, patch: Partial<DatasetImage>) => void;
  onBulkUpdateSplit: (imageIds: string[], split: SplitType) => void;
  onAutoSplit: (trainPct: number, valPct: number, testPct: number) => void;
  onUploadFiles: (files: FileList) => void;
  onOpenBatchStudio: (tab: BatchTab, selectedIds: string[], filteredIds: string[]) => void;
  onOpenDriveImport: () => void;
}

const STATUS_NAMES: Record<ReviewStatus, string> = {
  unlabeled: 'Unlabeled',
  in_progress: 'In Progress',
  labeled: 'Labeled',
  verified: 'Verified',
};

export default function DatasetGallery({
  images,
  imageUrls,
  classes,
  onOpenImage,
  onDeleteImage,
  onDeleteImagesBulk,
  onUpdateImage,
  onBulkUpdateSplit,
  onAutoSplit,
  onUploadFiles,
  onOpenBatchStudio,
  onOpenDriveImport,
}: DatasetGalleryProps) {
  const [search, setSearch] = useState('');
  const [splitFilter, setSplitFilter] = useState<'all' | SplitType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [splitPanelOpen, setSplitPanelOpen] = useState(false);
  const [trainPct, setTrainPct] = useState(70);
  const [valPct, setValPct] = useState(20);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);

  const testPct = Math.max(0, 100 - trainPct - valPct);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((img) => {
      if (splitFilter !== 'all' && img.split !== splitFilter) return false;
      if (statusFilter !== 'all' && img.status !== statusFilter) return false;
      if (
        classFilter !== 'all' &&
        !img.annotations.some((a) => a.classId === classFilter && a.source !== 'ai_suggestion')
      ) {
        return false;
      }
      if (
        q &&
        !img.fileName.toLowerCase().includes(q) &&
        !img.caption.toLowerCase().includes(q) &&
        !img.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [images, search, splitFilter, statusFilter, classFilter]);

  const filteredIds = useMemo(() => filtered.map((i) => i.id), [filtered]);
  const validSelectedIds = useMemo(() => {
    const idSet = new Set(images.map((i) => i.id));
    return selectedIds.filter((id) => idSet.has(id));
  }, [images, selectedIds]);

  const selectedSet = useMemo(() => new Set(validSelectedIds), [validSelectedIds]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((img) => selectedSet.has(img.id));

  const toggleSelectCard = (imgId: string, idx: number, shiftKey: boolean) => {
    if (shiftKey && lastSelectedIdx !== null && lastSelectedIdx < filtered.length) {
      const start = Math.min(lastSelectedIdx, idx);
      const end = Math.max(lastSelectedIdx, idx);
      const rangeIds = filtered.slice(start, end + 1).map((i) => i.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
    } else {
      setSelectedIds((prev) =>
        prev.includes(imgId) ? prev.filter((id) => id !== imgId) : [...prev, imgId]
      );
    }
    setLastSelectedIdx(idx);
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const fSet = new Set(filteredIds);
      setSelectedIds((prev) => prev.filter((id) => !fSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  return (
    <div
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
      className={`flex-1 overflow-y-auto bg-[#0B0D10] p-6 transition-colors ${
        isDragOver ? 'ring-2 ring-inset ring-[#38BDF8]' : ''
      }`}
    >
      <div className="max-w-[1360px] mx-auto space-y-6">
        {/* Header Row */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#232834] pb-5">
          <div>
            <h1 className="text-xl font-semibold text-[#E8ECF2] tracking-tight">
              Dataset Gallery
            </h1>
            <p className="text-xs text-[#8B95A5] mt-1 font-mono tabular-nums">
              {filtered.length} of {images.length} images shown · Stored locally in IndexedDB
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenDriveImport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#12151B] hover:bg-[#181C24] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
            >
              <HardDrive className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Google Drive</span>
            </button>

            <button
              type="button"
              onClick={() => setSplitPanelOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#12151B] hover:bg-[#181C24] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
            >
              <Shuffle className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Auto-Split Dataset</span>
            </button>

            <label className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Batch</span>
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
        </div>

        {/* Auto-Split Bar */}
        {splitPanelOpen && (
          <div className="p-4 rounded-lg bg-[#12151B] border border-[#232834] flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <span className="font-medium text-[#E8ECF2]">Proportional Split</span>
              <label className="flex items-center gap-2 text-[#8B95A5]">
                <span>Train</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={trainPct}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    setTrainPct(v);
                    if (v + valPct > 100) setValPct(100 - v);
                  }}
                  className="w-16 bg-[#0B0D10] border border-[#232834] rounded px-2 py-1 text-right font-mono tabular-nums text-[#E8ECF2]"
                />
                <span>%</span>
              </label>
              <label className="flex items-center gap-2 text-[#8B95A5]">
                <span>Val</span>
                <input
                  type="number"
                  min={0}
                  max={100 - trainPct}
                  value={valPct}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100 - trainPct, Number(e.target.value) || 0));
                    setValPct(v);
                  }}
                  className="w-16 bg-[#0B0D10] border border-[#232834] rounded px-2 py-1 text-right font-mono tabular-nums text-[#E8ECF2]"
                />
                <span>%</span>
              </label>
              <div className="text-[#8B95A5] font-mono tabular-nums">
                Test: <span className="text-[#E8ECF2]">{testPct}%</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onAutoSplit(trainPct, valPct, testPct);
                  setSplitPanelOpen(false);
                }}
                className="px-3 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold"
              >
                Apply to {images.length} Images
              </button>
              <button
                type="button"
                onClick={() => setSplitPanelOpen(false)}
                className="px-2.5 py-1.5 rounded-md text-xs text-[#8B95A5] hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename, caption, or tag..."
              className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded-md pl-9 pr-3 py-2 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#12151B] border border-[#232834] rounded-md">
            {(['all', 'train', 'val', 'test'] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSplitFilter(sp)}
                className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${
                  splitFilter === sp
                    ? 'bg-[#181C24] text-white'
                    : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                }`}
              >
                {sp === 'all' ? 'All Splits' : sp}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ReviewStatus)}
            aria-label="Filter by status"
            className="bg-[#12151B] border border-[#232834] rounded-md px-3 py-2 text-xs text-[#CBD5E1] outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="unlabeled">Unlabeled</option>
            <option value="in_progress">In Progress</option>
            <option value="labeled">Labeled</option>
            <option value="verified">Verified</option>
          </select>

          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            aria-label="Filter by parent class"
            className="bg-[#12151B] border border-[#232834] rounded-md px-3 py-2 text-xs text-[#CBD5E1] outline-none"
          >
            <option value="all">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                Contains: {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Batch Operations Toolbar */}
        <div className="px-3.5 py-2.5 rounded-lg bg-[#12151B] border border-[#232834] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={allFilteredSelected}
              onClick={toggleSelectAllFiltered}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 text-xs text-[#CBD5E1] hover:text-white disabled:opacity-40 transition-colors"
            >
              <span
                className={`w-4 h-4 rounded-xs border flex items-center justify-center transition-colors ${
                  allFilteredSelected
                    ? 'bg-[#38BDF8] border-[#38BDF8] text-[#07090C]'
                    : validSelectedIds.length > 0
                      ? 'bg-[#38BDF8]/25 border-[#38BDF8] text-[#38BDF8]'
                      : 'bg-[#0B0D10] border-[#323949]'
                }`}
              >
                {(allFilteredSelected || validSelectedIds.length > 0) && (
                  <Check className="w-3 h-3" strokeWidth={2.5} />
                )}
              </span>
              <span className="font-mono tabular-nums">
                {validSelectedIds.length > 0
                  ? `${validSelectedIds.length} selected`
                  : `Select all (${filtered.length})`}
              </span>
            </button>

            {validSelectedIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-[11px] text-[#8B95A5] hover:text-white transition-colors"
                >
                  Clear
                </button>
                <span className="text-[#232834]" aria-hidden="true">
                  |
                </span>
                <select
                  defaultValue=""
                  aria-label="Set split for selected images"
                  onChange={(e) => {
                    const val = e.target.value as SplitType | '';
                    if (val) {
                      onBulkUpdateSplit(validSelectedIds, val);
                      e.target.value = '';
                    }
                  }}
                  className="bg-[#0B0D10] border border-[#232834] rounded px-2 py-1 text-[11px] text-[#CBD5E1] outline-none"
                >
                  <option value="" disabled>
                    Set Split...
                  </option>
                  <option value="train">Move to train</option>
                  <option value="val">Move to val</option>
                  <option value="test">Move to test</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteImagesBulk(validSelectedIds);
                    setSelectedIds([]);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#FCA5A5] hover:bg-[#EF4444]/15 border border-transparent hover:border-[#EF4444]/30 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'crop', label: 'Batch Crop', icon: Crop },
                { id: 'resize', label: 'Batch Resize', icon: Maximize },
                { id: 'tags', label: 'Batch Tags', icon: Tags },
                { id: 'captions', label: 'Batch Captions', icon: FileText },
              ] as const
            ).map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={images.length === 0}
                  onClick={() => onOpenBatchStudio(action.id, validSelectedIds, filteredIds)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] disabled:opacity-40 border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                >
                  <Icon className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-[#232834] rounded-lg">
            <p className="text-sm text-[#8B95A5] mb-3">
              {images.length === 0
                ? 'This project has no images yet. Drag and drop images anywhere here to upload.'
                : 'No images match the current filter criteria.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((img, idx) => {
              const src = imageUrls[img.id] || img.seedUrl;
              const manualCount = img.annotations.filter((a) => a.source !== 'ai_suggestion').length;
              const isSelected = selectedSet.has(img.id);

              return (
                <article
                  key={img.id}
                  className={`bg-[#12151B] border rounded-lg overflow-hidden flex flex-col transition-colors group ${
                    isSelected
                      ? 'border-[#38BDF8] ring-1 ring-[#38BDF8]/40'
                      : 'border-[#232834] hover:border-[#323949]'
                  }`}
                >
                  <div
                    onClick={() => onOpenImage(img.id)}
                    className="relative aspect-[4/3] bg-[#07090C] overflow-hidden cursor-pointer"
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={img.fileName}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-[#64748B]">
                        Preview unavailable
                      </div>
                    )}

                    {/* Multi-select checkbox */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Select ${img.fileName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectCard(img.id, idx, e.shiftKey);
                      }}
                      className={`absolute top-2.5 left-2.5 w-5 h-5 rounded border flex items-center justify-center transition-all z-10 ${
                        isSelected
                          ? 'bg-[#38BDF8] border-[#38BDF8] text-[#07090C] opacity-100'
                          : 'bg-[#07090C]/75 border-white/35 text-transparent opacity-85 group-hover:opacity-100 hover:border-[#38BDF8]'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={2.75} />
                    </button>

                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0B0D10]/90 text-xs font-medium text-white">
                        <ExternalLink className="w-3 h-3 text-[#38BDF8]" />
                        <span>Annotate</span>
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-[#E8ECF2] truncate">
                          {img.fileName}
                        </h3>
                        <button
                          type="button"
                          onClick={() => onDeleteImage(img.id)}
                          title="Delete image"
                          aria-label={`Delete ${img.fileName}`}
                          className="p-1 rounded text-[#64748B] hover:text-[#EF4444] hover:bg-[#181C24] transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8B95A5] font-mono tabular-nums">
                        <span>
                          {img.width}×{img.height}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{manualCount} labels</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-sans">
                          {img.status === 'verified' ? (
                            <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
                          ) : img.status === 'in_progress' ? (
                            <Clock className="w-3 h-3 text-[#F59E0B]" />
                          ) : (
                            <CircleDashed className="w-3 h-3 text-[#64748B]" />
                          )}
                          {STATUS_NAMES[img.status]}
                        </span>
                      </div>

                      {img.caption && (
                        <p className="mt-2 text-xs text-[#94A3B8] line-clamp-2 leading-relaxed">
                          {img.caption}
                        </p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-[#232834] flex items-center justify-between gap-2">
                      <select
                        value={img.split}
                        onChange={(e) =>
                          onUpdateImage(img.id, { split: e.target.value as SplitType })
                        }
                        aria-label={`Dataset split for ${img.fileName}`}
                        className="bg-[#0B0D10] border border-[#232834] rounded px-2 py-1 text-[11px] font-mono uppercase text-[#CBD5E1] outline-none"
                      >
                        <option value="train">train</option>
                        <option value="val">val</option>
                        <option value="test">test</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => onOpenImage(img.id)}
                        className="text-xs font-medium text-[#38BDF8] hover:underline"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
