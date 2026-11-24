import { useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import type { LabelClass } from '../types/annotation';

export type PendingTaxonomyDelete =
  | { kind: 'class'; classId: string }
  | { kind: 'object'; classId: string; objectId: string };

interface DeleteTaxonomyModalProps {
  target: PendingTaxonomyDelete;
  classes: LabelClass[];
  affectedCount: number;
  onClose: () => void;
  onConfirm: (resolution: { action: 'reassign'; classId: string; objectId: string } | { action: 'delete_annotations' }) => void;
}

export default function DeleteTaxonomyModal({
  target,
  classes,
  affectedCount,
  onClose,
  onConfirm,
}: DeleteTaxonomyModalProps) {
  const targetLabel = useMemo(() => {
    const cls = classes.find((c) => c.id === target.classId);
    if (!cls) return 'Item';
    if (target.kind === 'class') return `Class "${cls.name}"`;
    const obj = cls.objects.find((o) => o.id === target.objectId);
    return `Object "${cls.name} / ${obj?.name ?? ''}"`;
  }, [classes, target]);

  const fallbackOptions = useMemo(() => {
    const pairs: Array<{ classId: string; objectId: string; label: string }> = [];
    for (const c of classes) {
      if (target.kind === 'class' && c.id === target.classId) continue;
      for (const o of c.objects) {
        if (target.kind === 'object' && c.id === target.classId && o.id === target.objectId) {
          continue;
        }
        pairs.push({ classId: c.id, objectId: o.id, label: `${c.name} / ${o.name}` });
      }
    }
    return pairs;
  }, [classes, target]);

  const [resolutionMode, setResolutionMode] = useState<'reassign' | 'delete'>('reassign');
  const [fallbackKey, setFallbackKey] = useState(
    fallbackOptions[0] ? `${fallbackOptions[0].classId}::${fallbackOptions[0].objectId}` : ''
  );

  const handleConfirm = () => {
    if (affectedCount > 0 && resolutionMode === 'reassign' && fallbackKey) {
      const [classId, objectId] = fallbackKey.split('::');
      onConfirm({ action: 'reassign', classId, objectId });
    } else {
      onConfirm({ action: 'delete_annotations' });
    }
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#232834] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
            <h2 className="text-sm font-semibold text-[#E8ECF2]">Delete {targetLabel}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {affectedCount === 0 ? (
            <p className="text-xs text-[#CBD5E1] leading-relaxed">
              No existing annotations use {targetLabel}. It can be removed safely.
            </p>
          ) : (
            <>
              <p className="text-xs text-[#CBD5E1] leading-relaxed">
                <strong className="font-mono text-white">{affectedCount}</strong> annotation
                {affectedCount === 1 ? '' : 's'} across this project currently reference{' '}
                {targetLabel}. Choose how to handle them:
              </p>

              <div className="space-y-2.5">
                {fallbackOptions.length > 0 && (
                  <label className="block p-3 rounded-md bg-[#0B0D10] border border-[#232834] cursor-pointer space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#E8ECF2]">
                      <input
                        type="radio"
                        checked={resolutionMode === 'reassign'}
                        onChange={() => setResolutionMode('reassign')}
                        className="accent-[#38BDF8]"
                      />
                      <span>Reassign annotations to another Class / Object</span>
                    </div>
                    {resolutionMode === 'reassign' && (
                      <select
                        value={fallbackKey}
                        onChange={(e) => setFallbackKey(e.target.value)}
                        className="w-full bg-[#12151B] border border-[#232834] rounded px-2.5 py-1.5 text-xs text-[#E8ECF2] outline-none"
                      >
                        {fallbackOptions.map((opt) => (
                          <option key={`${opt.classId}::${opt.objectId}`} value={`${opt.classId}::${opt.objectId}`}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                )}

                <label className="flex items-center gap-2 p-3 rounded-md bg-[#0B0D10] border border-[#232834] cursor-pointer text-xs text-[#FCA5A5]">
                  <input
                    type="radio"
                    checked={resolutionMode === 'delete'}
                    onChange={() => setResolutionMode('delete')}
                    className="accent-[#EF4444]"
                  />
                  <span>Delete all {affectedCount} referencing annotations</span>
                </label>
              </div>
            </>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-xs font-medium text-[#8B95A5] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-2 rounded-md bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-semibold transition-colors"
            >
              Confirm Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
