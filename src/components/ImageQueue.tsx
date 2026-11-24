import { useMemo, useState } from 'react';
import {
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ImagePlus,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Layers,
} from 'lucide-react';
import type { DatasetImage, ReviewStatus } from '../types/annotation';

interface ImageQueueProps {
  images: DatasetImage[];
  imageUrls: Record<string, string>;
  activeImageId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectImage: (imageId: string) => void;
  onTriggerUpload: () => void;
  onOpenBatchStudio: () => void;
}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  unlabeled: 'Unlabeled',
  in_progress: 'In Progress',
  labeled: 'Labeled',
  verified: 'Verified',
};

function StatusIcon({ status }: { status: ReviewStatus }) {
  switch (status) {
    case 'verified':
      return <CheckCircle2 className="w-3 h-3 text-[#22C55E] shrink-0" />;
    case 'labeled':
      return <CheckCircle2 className="w-3 h-3 text-[#38BDF8] shrink-0" />;
    case 'in_progress':
      return <Clock className="w-3 h-3 text-[#F59E0B] shrink-0" />;
    default:
      return <CircleDashed className="w-3 h-3 text-[#64748B] shrink-0" />;
  }
}

export default function ImageQueue({
  images,
  imageUrls,
  activeImageId,
  collapsed,
  onToggleCollapse,
  onSelectImage,
  onTriggerUpload,
  onOpenBatchStudio,
}: ImageQueueProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((img) => {
      if (statusFilter !== 'all' && img.status !== statusFilter) return false;
      if (q && !img.fileName.toLowerCase().includes(q) && !img.caption.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [images, search, statusFilter]);

  if (collapsed) {
    return (
      <div className="w-9 shrink-0 bg-[#12151B] border-r border-[#232834] flex flex-col items-center py-2.5 gap-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Image Queue"
          aria-label="Expand Image Queue"
          className="w-7 h-7 rounded flex items-center justify-center text-[#8B95A5] hover:text-white hover:bg-[#181C24] transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono tabular-nums text-[#8B95A5] [writing-mode:vertical-rl]">
          {images.length} images
        </span>
      </div>
    );
  }

  return (
    <aside className="w-[232px] shrink-0 bg-[#12151B] border-r border-[#232834] flex flex-col min-h-0">
      <div className="px-3 py-2.5 border-b border-[#232834] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-[#E8ECF2] truncate">Image Queue</h2>
          <span className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
            {filtered.length}/{images.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse Queue"
          aria-label="Collapse Image Queue"
          className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24] transition-colors"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter Controls */}
      <div className="p-2.5 border-b border-[#232834] space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter filename or caption"
            className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md pl-8 pr-2.5 py-1.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | ReviewStatus)}
          aria-label="Filter queue by review status"
          className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-1.5 text-xs text-[#CBD5E1] outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="unlabeled">Unlabeled</option>
          <option value="in_progress">In Progress</option>
          <option value="labeled">Labeled</option>
          <option value="verified">Verified</option>
        </select>
      </div>

      {/* Filmstrip Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="py-10 px-3 text-center">
            <p className="text-xs text-[#8B95A5] mb-3">
              {images.length === 0
                ? 'No images in this project yet.'
                : 'No images match the active filter.'}
            </p>
            {images.length === 0 && (
              <button
                type="button"
                onClick={onTriggerUpload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors"
              >
                <ImagePlus className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Add Images</span>
              </button>
            )}
          </div>
        ) : (
          filtered.map((img, idx) => {
            const active = img.id === activeImageId;
            const src = imageUrls[img.id] || img.seedUrl;
            const manualCount = img.annotations.filter((a) => a.source !== 'ai_suggestion').length;
            const aiCount = img.annotations.filter((a) => a.source === 'ai_suggestion').length;

            return (
              <button
                key={img.id}
                type="button"
                onClick={() => onSelectImage(img.id)}
                className={`w-full text-left rounded-md p-1.5 transition-colors border ${
                  active
                    ? 'bg-[#181C24] border-[#38BDF8]'
                    : 'bg-transparent border-transparent hover:bg-[#181C24]/60 hover:border-[#232834]'
                }`}
              >
                <div className="relative aspect-[4/3] w-full rounded overflow-hidden bg-[#07090C] mb-1.5">
                  {src ? (
                    <img
                      src={src}
                      alt={img.fileName}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-[#64748B]">
                      No Preview
                    </div>
                  )}
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#07090C]/85 text-[10px] font-mono tabular-nums text-[#E8ECF2]">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-[#07090C]/85 text-[10px] font-mono uppercase text-[#CBD5E1]">
                    {img.split}
                  </span>
                </div>

                <div className="px-0.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium text-[#E8ECF2] truncate">
                      {img.fileName}
                    </span>
                    {img.caption.trim().length > 0 && (
                      <FileText
                        className="w-3 h-3 text-[#8B95A5] shrink-0"
                        aria-label="Has caption"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#8B95A5] tabular-nums">
                    <StatusIcon status={img.status} />
                    <span>{STATUS_LABELS[img.status]}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      {manualCount}
                      {aiCount > 0 ? `+${aiCount} AI` : ''}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer Upload & Batch Actions */}
      <div className="p-2.5 border-t border-[#232834] space-y-1.5">
        <button
          type="button"
          disabled={images.length === 0}
          onClick={onOpenBatchStudio}
          className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-md bg-[#0B0D10] hover:bg-[#181C24] disabled:opacity-40 border border-[#232834] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
        >
          <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>Batch Crop / Tags / Captions</span>
        </button>
        <button
          type="button"
          onClick={onTriggerUpload}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors"
        >
          <ImagePlus className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>Add Local Images</span>
        </button>
      </div>
    </aside>
  );
}
