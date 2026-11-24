import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { Project } from '../types/annotation';
import { TAXONOMY_PRESETS } from '../utils/seedData';

interface ProjectModalProps {
  mode: 'create' | 'manage';
  activeProject: Project;
  canDelete: boolean;
  onClose: () => void;
  onCreateProject: (name: string, description: string, presetId: string) => void;
  onUpdateProject: (name: string, description: string) => void;
  onDeleteProject: () => void;
}

export default function ProjectModal({
  mode,
  activeProject,
  canDelete,
  onClose,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
}: ProjectModalProps) {
  const [name, setName] = useState(mode === 'manage' ? activeProject.name : '');
  const [description, setDescription] = useState(
    mode === 'manage' ? activeProject.description : ''
  );
  const [presetId, setPresetId] = useState(TAXONOMY_PRESETS[0].id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    if (mode === 'create') {
      onCreateProject(cleanName, description.trim(), presetId);
    } else {
      onUpdateProject(cleanName, description.trim());
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
        className="w-full max-w-lg bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#232834] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#E8ECF2]">
            {mode === 'create' ? 'Create New Dataset Project' : 'Project Settings'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="project-name-input"
              className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
            >
              Project Name
            </label>
            <input
              id="project-name-input"
              type="text"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Streetwear Fine-Grained Parsing v1"
              className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-3 py-2 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="project-desc-input"
              className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
            >
              Description (Optional)
            </label>
            <textarea
              id="project-desc-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes on labeling guidelines, camera source, or target model..."
              className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-3 py-2 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none resize-none"
            />
          </div>

          {mode === 'create' && (
            <div>
              <span className="block text-xs font-medium text-[#CBD5E1] mb-2">
                Starter Class → Object Taxonomy
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TAXONOMY_PRESETS.map((preset) => {
                  const selected = preset.id === presetId;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setPresetId(preset.id)}
                      className={`text-left p-3 rounded-md border transition-colors ${
                        selected
                          ? 'bg-[#181C24] border-[#38BDF8]'
                          : 'bg-[#0B0D10] border-[#232834] hover:border-[#323949]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[#E8ECF2]">{preset.name}</div>
                      <div className="mt-1 text-[11px] text-[#8B95A5] leading-snug">
                        {preset.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mode === 'manage' && canDelete && (
            <div className="pt-3 border-t border-[#232834]">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-[#EF4444] hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete this project and its stored images</span>
                </button>
              ) : (
                <div className="p-3 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/35 flex items-center justify-between gap-3">
                  <span className="text-xs text-[#FCA5A5]">
                    Permanently delete &ldquo;{activeProject.name}&rdquo;?
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteProject();
                        onClose();
                      }}
                      className="px-2.5 py-1 rounded bg-[#EF4444] text-white text-xs font-semibold"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2 py-1 rounded text-xs text-[#CBD5E1] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
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
              type="submit"
              className="px-4 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold transition-colors"
            >
              {mode === 'create' ? 'Create Project' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
