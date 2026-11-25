import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, FolderOpen, Upload, Settings2, HardDrive, Cpu } from 'lucide-react';
import type { AIProviderSelection, Project, ViewTab } from '../types/annotation';
import { AI_PROVIDER_LABELS } from './AIProviderModal';

interface TopBarProps {
  projects: Project[];
  activeProject: Project;
  activeTab: ViewTab;
  driveConnected: boolean;
  aiSelection: AIProviderSelection;
  onSelectTab: (tab: ViewTab) => void;
  onSelectProject: (projectId: string) => void;
  onOpenNewProject: () => void;
  onOpenManageProject: () => void;
  onTriggerImportImages: () => void;
  onOpenDrive: () => void;
  onOpenAIProvider: () => void;
}

const NAV_ITEMS: Array<{ id: ViewTab; label: string }> = [
  { id: 'annotate', label: 'Annotate' },
  { id: 'dataset', label: 'Dataset' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'export', label: 'Export' },
  { id: 'help', label: 'Help' },
];

export default function TopBar({
  projects,
  activeProject,
  activeTab,
  driveConnected,
  aiSelection,
  onSelectTab,
  onSelectProject,
  onOpenNewProject,
  onOpenManageProject,
  onTriggerImportImages,
  onOpenDrive,
  onOpenAIProvider,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="h-[52px] shrink-0 bg-[#12151B] border-b border-[#232834] px-5 flex items-center justify-between gap-8 z-30">
      {/* Zone 1: Brand Wordmark + Project Context Switcher */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => onSelectTab('annotate')}
          className="font-display text-[17px] font-bold tracking-tight text-[#E8ECF2] hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          Reticle
        </button>

        <span className="text-[#323949] select-none" aria-hidden="true">
          /
        </span>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium text-[#CBD5E1] hover:text-white hover:bg-[#181C24] transition-colors max-w-[240px]"
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
          >
            <span className="truncate">{activeProject.name}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[#8B95A5] shrink-0" />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-72 bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl py-1.5 z-50">
              <div className="px-3 py-1.5 text-[11px] font-medium text-[#8B95A5] flex items-center justify-between">
                <span>Projects ({projects.length})</span>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenManageProject();
                  }}
                  className="flex items-center gap-1 text-[#8B95A5] hover:text-[#E8ECF2] transition-colors"
                >
                  <Settings2 className="w-3 h-3" />
                  <span>Manage</span>
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {projects.map((p) => {
                  const isActive = p.id === activeProject.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectProject(p.id);
                        setMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-[#181C24] text-white font-medium'
                          : 'text-[#B8C2D1] hover:bg-[#181C24]/70 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-3.5 h-3.5 text-[#8B95A5] shrink-0" />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-[#8B95A5] shrink-0">
                        {p.classes.length} cls
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-[#232834] mt-1 pt-1 px-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenNewProject();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-[#38BDF8] hover:bg-[#181C24] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Project</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Zone 2: Clean Single-Line Navigation Links */}
      <nav className="flex items-center gap-7 h-full" aria-label="Workspace views">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative h-full flex items-center text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                isActive ? 'text-white' : 'text-[#8B95A5] hover:text-[#E8ECF2]'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#38BDF8]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: AI Provider, Google Drive & Local Import */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenAIProvider}
          title={`AI Vision Provider: ${AI_PROVIDER_LABELS[aiSelection.provider]} (${aiSelection.model})`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap shrink-0"
        >
          <Cpu className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>{AI_PROVIDER_LABELS[aiSelection.provider]}</span>
        </button>

        <button
          type="button"
          onClick={onOpenDrive}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap shrink-0"
        >
          <HardDrive
            className={`w-3.5 h-3.5 ${driveConnected ? 'text-[#22C55E]' : 'text-[#38BDF8]'}`}
          />
          <span>{driveConnected ? 'Google Drive' : 'Connect Drive'}</span>
        </button>

        <button
          type="button"
          onClick={onTriggerImportImages}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import Images</span>
        </button>
      </div>
    </header>
  );
}
