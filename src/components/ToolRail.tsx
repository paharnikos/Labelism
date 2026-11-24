import { useState, useRef, useEffect } from 'react';
import {
  MousePointer2,
  Square,
  Pentagon,
  Waypoints,
  Crosshair,
  Hand,
  Undo2,
  Redo2,
  Maximize2,
  SlidersHorizontal,
  Tag,
  Keyboard,
  RotateCcw,
  Plus,
  Crop,
} from 'lucide-react';
import type { ImageDisplaySettings, ToolMode } from '../types/annotation';

interface ToolRailProps {
  tool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFitView: () => void;
  displaySettings: ImageDisplaySettings;
  onChangeDisplaySettings: (next: Partial<ImageDisplaySettings>) => void;
  onResetDisplaySettings: () => void;
  onOpenShortcuts: () => void;
  canCrop: boolean;
  onOpenCrop: () => void;
}

const TOOLS: Array<{
  id: ToolMode;
  label: string;
  hotkey: string;
  icon: typeof MousePointer2;
}> = [
  { id: 'select', label: 'Select & Edit', hotkey: 'V', icon: MousePointer2 },
  { id: 'bbox', label: 'Bounding Box', hotkey: 'B', icon: Square },
  { id: 'polygon', label: 'Polygon Segmentation', hotkey: 'P', icon: Pentagon },
  { id: 'polyline', label: 'Polyline / Line', hotkey: 'L', icon: Waypoints },
  { id: 'keypoint', label: 'Keypoint Marker', hotkey: 'K', icon: Plus },
  { id: 'pan', label: 'Pan Viewport', hotkey: 'H', icon: Hand },
];

export default function ToolRail({
  tool,
  onSelectTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFitView,
  displaySettings,
  onChangeDisplaySettings,
  onResetDisplaySettings,
  onOpenShortcuts,
  canCrop,
  onOpenCrop,
}: ToolRailProps) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!adjustOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setAdjustOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [adjustOpen]);

  return (
    <aside className="w-[52px] shrink-0 bg-[#12151B] border-r border-[#232834] flex flex-col items-center py-2.5 justify-between select-none z-20">
      <div className="flex flex-col items-center gap-1">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectTool(t.id)}
              title={`${t.label} (${t.hotkey})`}
              aria-label={`${t.label} (${t.hotkey})`}
              aria-pressed={active}
              className={`relative w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
                active
                  ? 'bg-[#38BDF8]/15 text-[#38BDF8] ring-1 ring-inset ring-[#38BDF8]/40'
                  : 'text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24]'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
              <span className="absolute bottom-0.5 right-1 text-[8px] font-mono text-current opacity-65">
                {t.hotkey}
              </span>
            </button>
          );
        })}

        <div className="w-6 h-px bg-[#232834] my-2" />

        <button
          type="button"
          onClick={onOpenCrop}
          disabled={!canCrop}
          title="Crop Image Studio (X)"
          aria-label="Crop Image Studio (X)"
          className="relative w-9 h-9 rounded-md flex items-center justify-center text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Crop className="w-[17px] h-[17px]" strokeWidth={1.75} />
          <span className="absolute bottom-0.5 right-1 text-[8px] font-mono text-current opacity-65">
            X
          </span>
        </button>

        <div className="w-6 h-px bg-[#232834] my-2" />

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          className="w-9 h-9 rounded-md flex items-center justify-center text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Undo2 className="w-[17px] h-[17px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          className="w-9 h-9 rounded-md flex items-center justify-center text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Redo2 className="w-[17px] h-[17px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onFitView}
          title="Fit Image to Viewport (F)"
          aria-label="Fit Image to Viewport"
          className="w-9 h-9 rounded-md flex items-center justify-center text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24] transition-colors"
        >
          <Maximize2 className="w-[16px] h-[16px]" strokeWidth={1.75} />
        </button>
      </div>

      {/* Bottom Viewport Preferences */}
      <div className="flex flex-col items-center gap-1 relative" ref={popRef}>
        <button
          type="button"
          onClick={() =>
            onChangeDisplaySettings({ showCrosshair: !displaySettings.showCrosshair })
          }
          title="Toggle Crosshair Alignment Guides (C)"
          aria-label="Toggle Crosshair Guides"
          aria-pressed={displaySettings.showCrosshair}
          className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
            displaySettings.showCrosshair
              ? 'text-[#38BDF8] bg-[#38BDF8]/10'
              : 'text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24]'
          }`}
        >
          <Crosshair className="w-[17px] h-[17px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={() => onChangeDisplaySettings({ showLabels: !displaySettings.showLabels })}
          title="Toggle Canvas Labels (T)"
          aria-label="Toggle Canvas Labels"
          aria-pressed={displaySettings.showLabels}
          className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
            displaySettings.showLabels
              ? 'text-[#38BDF8] bg-[#38BDF8]/10'
              : 'text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24]'
          }`}
        >
          <Tag className="w-[16px] h-[16px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={() => setAdjustOpen((v) => !v)}
          title="Image & Overlay Display Adjustments"
          aria-label="Image Display Adjustments"
          aria-expanded={adjustOpen}
          className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
            adjustOpen
              ? 'text-[#38BDF8] bg-[#38BDF8]/15'
              : 'text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24]'
          }`}
        >
          <SlidersHorizontal className="w-[16px] h-[16px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts (?)"
          aria-label="Keyboard Shortcuts"
          className="w-9 h-9 rounded-md flex items-center justify-center text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24] transition-colors"
        >
          <Keyboard className="w-[17px] h-[17px]" strokeWidth={1.75} />
        </button>

        {adjustOpen && (
          <div className="absolute left-full bottom-10 ml-2.5 w-64 bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl p-4 z-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-[#E8ECF2]">Display Calibration</h3>
              <button
                type="button"
                onClick={onResetDisplaySettings}
                className="flex items-center gap-1 text-[11px] text-[#8B95A5] hover:text-[#E8ECF2] transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#8B95A5]">Brightness</span>
                  <span className="font-mono tabular-nums text-[#E8ECF2]">
                    {displaySettings.brightness}%
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={displaySettings.brightness}
                  onChange={(e) =>
                    onChangeDisplaySettings({ brightness: Number(e.target.value) })
                  }
                  className="w-full accent-[#38BDF8] h-1 bg-[#232834] rounded-lg"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#8B95A5]">Contrast</span>
                  <span className="font-mono tabular-nums text-[#E8ECF2]">
                    {displaySettings.contrast}%
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={displaySettings.contrast}
                  onChange={(e) =>
                    onChangeDisplaySettings({ contrast: Number(e.target.value) })
                  }
                  className="w-full accent-[#38BDF8] h-1 bg-[#232834] rounded-lg"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#8B95A5]">Saturation</span>
                  <span className="font-mono tabular-nums text-[#E8ECF2]">
                    {displaySettings.saturation}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={displaySettings.saturation}
                  onChange={(e) =>
                    onChangeDisplaySettings({ saturation: Number(e.target.value) })
                  }
                  className="w-full accent-[#38BDF8] h-1 bg-[#232834] rounded-lg"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#8B95A5]">Mask Fill Opacity</span>
                  <span className="font-mono tabular-nums text-[#E8ECF2]">
                    {Math.round(displaySettings.maskOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={65}
                  value={Math.round(displaySettings.maskOpacity * 100)}
                  onChange={(e) =>
                    onChangeDisplaySettings({ maskOpacity: Number(e.target.value) / 100 })
                  }
                  className="w-full accent-[#38BDF8] h-1 bg-[#232834] rounded-lg"
                />
              </div>

              <div className="pt-2 border-t border-[#232834] flex items-center justify-between">
                <span className="text-xs text-[#CBD5E1]">Show Class / Object</span>
                <button
                  type="button"
                  onClick={() =>
                    onChangeDisplaySettings({
                      showClassPrefix: !displaySettings.showClassPrefix,
                    })
                  }
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    displaySettings.showClassPrefix
                      ? 'bg-[#38BDF8]/15 text-[#38BDF8]'
                      : 'bg-[#181C24] text-[#8B95A5]'
                  }`}
                >
                  {displaySettings.showClassPrefix ? 'Full Path' : 'Object Only'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
