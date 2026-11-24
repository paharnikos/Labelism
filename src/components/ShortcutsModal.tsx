import { X } from 'lucide-react';

interface ShortcutsModalProps {
  onClose: () => void;
}

const GROUPS = [
  {
    title: 'Annotation Tools',
    items: [
      ['V', 'Select, move & edit vertices'],
      ['B', 'Bounding Box tool'],
      ['P', 'Polygon segmentation tool'],
      ['L', 'Polyline / line tool'],
      ['K', 'Keypoint marker tool'],
      ['H / Space + Drag', 'Pan viewport'],
      ['X', 'Open Crop Studio for current image'],
    ],
  },
  {
    title: 'Drawing & Geometry Editing',
    items: [
      ['Enter / Double-click', 'Close polygon or finish polyline'],
      ['Backspace', 'Undo last placed vertex while drawing'],
      ['Esc', 'Cancel active draft or deselect shape'],
      ['Delete / Backspace', 'Delete selected annotation'],
      ['Right-click / Alt+Click', 'Remove vertex from selected polygon/line'],
      ['Click dashed midpoint', 'Insert vertex along edge'],
    ],
  },
  {
    title: 'Navigation & Taxonomy',
    items: [
      ['1 – 9', 'Switch active Class / Object hotkey'],
      ['A / Left Arrow', 'Previous image in queue'],
      ['D / Right Arrow', 'Next image in queue'],
      ['Ctrl/Cmd + Z', 'Undo annotation change'],
      ['Ctrl/Cmd + Shift + Z', 'Redo annotation change'],
      ['F / C / T', 'Fit view · Toggle crosshairs · Toggle labels'],
    ],
  },
];

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#232834] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#E8ECF2]">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[75vh] overflow-y-auto">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-2.5">
              <h3 className="text-xs font-semibold text-[#38BDF8]">{g.title}</h3>
              <div className="space-y-1.5">
                {g.items.map(([key, desc]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 py-1 border-b border-[#232834]/60 last:border-0 text-xs"
                  >
                    <span className="text-[#CBD5E1]">{desc}</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[#0B0D10] border border-[#232834] font-mono text-[11px] text-[#E8ECF2] whitespace-nowrap shrink-0">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
