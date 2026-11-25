import { useMemo, useState } from 'react';
import {
  Search,
  X,
  ArrowRight,
  MousePointer2,
  Square,
  Pentagon,
  Waypoints,
  Plus,
  Hand,
  Crop,
  Undo2,
  Maximize2,
  Crosshair,
  Tag,
  SlidersHorizontal,
  Keyboard,
  HelpCircle,
  Cpu,
  HardDrive,
  Upload,
  FolderOpen,
  Settings2,
  Sparkles,
  Eye,
  Layers,
  Shuffle,
  Archive,
  BarChart3,
  FileJson,
  Scissors,
  BookOpen,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';
import type { ViewTab } from '../types/annotation';

interface HelpViewProps {
  onNavigateTab: (tab: ViewTab) => void;
  onOpenAIProvider: () => void;
  onOpenDrive: () => void;
  onOpenShortcuts: () => void;
}

interface ControlDocItem {
  name: string;
  location: string;
  hotkey?: string;
  icon?: LucideIcon;
  description: string;
}

interface WorkflowStep {
  number: string;
  title: string;
  summary: string;
  steps: string[];
  actionLabel?: string;
  actionType?: 'annotate' | 'dataset' | 'analytics' | 'export' | 'ai' | 'drive';
}

interface HelpSectionMeta {
  id: string;
  label: string;
  category: string;
}

const SECTIONS: HelpSectionMeta[] = [
  { id: 'workflows', label: 'Core Workflows', category: 'Flows' },
  { id: 'topbar', label: 'Top Navigation Bar', category: 'Controls' },
  { id: 'toolrail', label: 'Tool Rail & Canvas', category: 'Controls' },
  { id: 'queue-inspector', label: 'Queue & Inspector', category: 'Controls' },
  { id: 'dataset-batch', label: 'Dataset & Batch Studio', category: 'Modules' },
  { id: 'crop-studio', label: 'Crop Studio', category: 'Modules' },
  { id: 'ai-providers', label: 'AI Vision Providers', category: 'Modules' },
  { id: 'analytics-export', label: 'Analytics, Export & Drive', category: 'Modules' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', category: 'Reference' },
];

const WORKFLOWS: WorkflowStep[] = [
  {
    number: '01',
    title: 'Project Setup & Image Ingestion',
    summary:
      'Create an isolated project with a preset or custom Class / Object taxonomy and load your images offline into browser IndexedDB storage.',
    steps: [
      'Open the Project Switcher next to Reticle in the top bar and select New Project (or Manage to rename or delete an existing project).',
      'Import images via Import Images in the top bar, drag-and-drop directly onto the Annotate canvas or Dataset gallery, or pull folders from Connect Drive.',
      'Open the Inspector Taxonomy tab to customize parent Classes, nested Objects, colors, and 1–9 quick hotkeys.',
    ],
    actionLabel: 'Open Annotate Workspace',
    actionType: 'annotate',
  },
  {
    number: '02',
    title: 'Precision Labeling & Geometry Editing',
    summary:
      'Draw bounding boxes, pixel-accurate polygons, polylines, and keypoints while maintaining camera zoom and pan stability.',
    steps: [
      'Pick the target Class / Object in the Inspector (or press keys 1–9), then select a tool: Box (B), Polygon (P), Polyline (L), or Keypoint (K).',
      'For polygons and polylines, click to place vertices, press Backspace to undo the last point, and press Enter or double-click to finish.',
      'Switch to Select & Edit (V) to drag shapes or individual vertices, click dashed edge midpoints to insert vertices, or Right-click / Alt+Click a vertex to remove it.',
      'Use Display Calibration on the Tool Rail to tweak Brightness, Contrast, Saturation, or Mask Opacity on low-contrast images without modifying the original pixels.',
    ],
    actionLabel: 'Open Annotate Workspace',
    actionType: 'annotate',
  },
  {
    number: '03',
    title: 'AI-Assisted Detection & Captioning',
    summary:
      'Accelerate labeling with staged AI box suggestions and vision-generated captions routed through Gemini, OpenRouter, NanoGPT, or a custom OpenAI-compatible server endpoint.',
    steps: [
      'Click the AI Provider button in the top bar (or Switch inside the Inspector / Batch Studio) to pick Gemini, OpenRouter, NanoGPT, or Custom AI.',
      'Configure any external API key in Settings -> Secrets on the server, pick or fetch a vision model slug, and click Test Connection.',
      'Click Suggest Boxes in the Inspector to stage AI detections mapped to your taxonomy. Review them on the canvas and click Accept All, Accept Selected, or Dismiss All.',
      'Click Auto-Caption (or open the Captions tab) to generate a full caption, short caption, and tags draft, then review and click Apply Draft.',
    ],
    actionLabel: 'Configure AI Provider',
    actionType: 'ai',
  },
  {
    number: '04',
    title: 'Cropping & Bulk Dataset Processing',
    summary:
      'Standardize image dimensions, crop tightly around labeled objects, and apply metadata edits across dozens of images in one pass.',
    steps: [
      'For a single image, press X (or click Crop on the Tool Rail) to open Crop Studio. Lock aspect ratios, snap tightly to labels, remap annotations automatically, and save as a new copy or overwrite.',
      'For multiple images, switch to Dataset, select cards with Click or Shift+Click, and launch Batch Studio (or click Batch Ops in the Image Queue).',
      'Run Batch Crop, Batch Resize (including YOLO letterbox padding), Batch Tags (add, remove, replace, or derive from labels), or Batch Captions (templates, find/replace, or AI Auto-Caption).',
    ],
    actionLabel: 'Open Dataset Gallery',
    actionType: 'dataset',
  },
  {
    number: '05',
    title: 'Quality Review, Analytics, Drive Sync & ML Export',
    summary:
      'Audit class balance and dataset splits before exporting training-ready annotations, cropped PNG object masks, or cloud backups.',
    steps: [
      'Mark completed images as Labeled or Verified in the Inspector Captions tab and assign Train, Val, or Test splits (or run Auto-Split in Dataset).',
      'Open Analytics to inspect the Dataset Summary card (total annotated objects, train/val/test percentages, top 5 annotated classes), Taxonomy Balance, and Review Pipeline.',
      'Open Export to download COCO JSON, VLM JSONL, CSV Table, Cropped Object Masks (ZIP), or a full Reticle Backup—or click Save to Drive to upload exports directly to Google Drive.',
    ],
    actionLabel: 'Open Export View',
    actionType: 'export',
  },
];

const TOPBAR_CONTROLS: ControlDocItem[] = [
  {
    name: 'Reticle Wordmark',
    location: 'Top Bar · Left',
    description: 'Returns immediately to the primary Annotate workspace from any view.',
  },
  {
    name: 'Project Switcher Dropdown',
    location: 'Top Bar · Left',
    icon: FolderOpen,
    description:
      'Lists all locally stored IndexedDB projects with class counts. Click any project to switch workspaces cleanly.',
  },
  {
    name: 'Manage / New Project',
    location: 'Project Switcher Menu',
    icon: Settings2,
    description:
      'Manage edits the active project name/description or deletes the project. New Project creates a new dataset with a starter taxonomy preset (Fashion, Street/Autonomous, Retail, or Blank).',
  },
  {
    name: 'Workspace Tabs (Annotate · Dataset · Analytics · Export · Help)',
    location: 'Top Bar · Center',
    description:
      'Switches between the canvas editor, multi-select image gallery, dataset health metrics, export/import builder, and this Help guide.',
  },
  {
    name: 'AI Provider Button',
    location: 'Top Bar · Right',
    icon: Cpu,
    description:
      'Displays the active vision provider (Gemini, OpenRouter, NanoGPT, or Custom AI). Opens the AI Vision Provider modal to pick models, fetch live catalogs, and test connectivity.',
  },
  {
    name: 'Connect Drive / Google Drive',
    location: 'Top Bar · Right',
    icon: HardDrive,
    description:
      'Opens the Google Drive integration modal to authenticate with Google, browse folders, import images or COCO JSON into your project, or upload dataset exports.',
  },
  {
    name: 'Import Images',
    location: 'Top Bar · Right',
    icon: Upload,
    description:
      'Opens your system file picker to import one or multiple local image files (JPEG, PNG, WebP, etc.) directly into the active project.',
  },
];

const TOOLRAIL_CONTROLS: ControlDocItem[] = [
  {
    name: 'Select & Edit',
    location: 'Tool Rail · Drawing',
    hotkey: 'V',
    icon: MousePointer2,
    description:
      'Select annotations on the canvas, drag shapes to reposition them, drag bounding-box corners or polygon vertices, click dashed edge midpoints to insert vertices, or Right-click / Alt+Click vertices to delete them. Moving labels never resets your camera zoom or pan.',
  },
  {
    name: 'Bounding Box',
    location: 'Tool Rail · Drawing',
    hotkey: 'B',
    icon: Square,
    description:
      'Click and drag diagonally across an object to create an axis-aligned rectangular bounding box tagged with the active Class / Object.',
  },
  {
    name: 'Polygon Segmentation',
    location: 'Tool Rail · Drawing',
    hotkey: 'P',
    icon: Pentagon,
    description:
      'Click to place polygon vertices around irregular contours. Click the starting vertex, double-click, or press Enter to close the shape. Press Backspace to step back one vertex or Esc to cancel.',
  },
  {
    name: 'Polyline / Line',
    location: 'Tool Rail · Drawing',
    hotkey: 'L',
    icon: Waypoints,
    description:
      'Click to trace open multi-segment paths (lanes, seams, wires, edges). Double-click or press Enter to finish the line.',
  },
  {
    name: 'Keypoint Marker',
    location: 'Tool Rail · Drawing',
    hotkey: 'K',
    icon: Plus,
    description:
      'Single-click to drop a precise (x, y) landmark point for pose joints, corners, or alignment anchors.',
  },
  {
    name: 'Pan Viewport',
    location: 'Tool Rail · Navigation',
    hotkey: 'H / Space+Drag',
    icon: Hand,
    description:
      'Drag anywhere on the canvas to pan the image. Use your mouse scroll wheel to zoom smoothly toward the cursor.',
  },
  {
    name: 'Crop Image Studio',
    location: 'Tool Rail · Transform',
    hotkey: 'X',
    icon: Crop,
    description:
      'Opens the interactive Crop Studio modal for the current image with aspect presets, snap-to-labels, automatic annotation remapping, and output resizing.',
  },
  {
    name: 'Undo / Redo',
    location: 'Tool Rail · History',
    hotkey: 'Ctrl+Z / Ctrl+Shift+Z',
    icon: Undo2,
    description:
      'Steps backward or forward through per-image annotation edits (creation, vertex tweaks, deletions, and AI suggestion commits).',
  },
  {
    name: 'Fit Image to Viewport',
    location: 'Tool Rail · History',
    hotkey: 'F',
    icon: Maximize2,
    description: 'Resets camera zoom and centers the active image neatly inside the canvas frame.',
  },
  {
    name: 'Toggle Crosshair Guides',
    location: 'Tool Rail · Preferences',
    hotkey: 'C',
    icon: Crosshair,
    description:
      'Shows or hides full-canvas horizontal and vertical alignment crosshairs that follow your pointer for pixel-accurate box edges.',
  },
  {
    name: 'Toggle Canvas Labels',
    location: 'Tool Rail · Preferences',
    hotkey: 'T',
    icon: Tag,
    description:
      'Shows or hides floating Class / Object text tags anchored to each annotation on the canvas.',
  },
  {
    name: 'Display Calibration Popover',
    location: 'Tool Rail · Preferences',
    icon: SlidersHorizontal,
    description:
      'Adjusts non-destructive viewport Brightness (50–200%), Contrast (50–200%), Saturation (0–200%), Mask Fill Opacity (5–65%), and Label Display (Full Path "Class / Object" vs Object Only), with a one-click Reset.',
  },
  {
    name: 'Keyboard Shortcuts & Help Guide',
    location: 'Tool Rail · Bottom',
    hotkey: '?',
    icon: Keyboard,
    description:
      'Opens the quick Keyboard Shortcuts overlay (?) or jumps straight to this complete Help documentation view.',
  },
];

const QUEUE_INSPECTOR_CONTROLS: ControlDocItem[] = [
  {
    name: 'Image Queue Panel (Left Sidebar)',
    location: 'Annotate · Left',
    icon: Layers,
    description:
      'Browse thumbnails with review status icons (Unlabeled, In Progress, Labeled, Verified), annotation counts, and caption indicators. Filter by filename/caption or review status, collapse the rail for maximum canvas width, upload images, or launch Batch Ops.',
  },
  {
    name: 'Canvas Floating Action Bar & AI Review Strip',
    location: 'Annotate · Canvas Overlay',
    icon: Sparkles,
    description:
      'Navigate Prev / Next images (A / D or Arrow keys), see live zoom percentage and cursor pixel coordinates, and review staged AI suggestions with Accept All, Accept Selected, or Dismiss All.',
  },
  {
    name: 'Active Label Selector & AI Assist Buttons',
    location: 'Inspector · Annotations Tab',
    icon: Sparkles,
    description:
      'Choose the active Class / Object before drawing. Run Suggest Boxes to detect objects with AI, Auto-Caption to draft an image caption, or click Switch to change AI providers.',
  },
  {
    name: 'Selected Annotation Editor',
    location: 'Inspector · Annotations Tab',
    icon: Settings2,
    description:
      'Appears when a shape is selected. Reassign its Class / Object, toggle ML attributes (Occluded, Truncated, Crowd), attach an annotation note, accept an AI suggestion, or delete the shape.',
  },
  {
    name: 'Multi-Select Layer List & Per-Row Controls',
    location: 'Inspector · Annotations Tab',
    icon: Eye,
    description:
      'Use checkboxes beside annotations to select multiple shapes and bulk hide/show, lock/unlock, reassign taxonomy, or delete. Individual rows also provide Visibility (Eye), Lock (prevents accidental dragging), and Delete buttons.',
  },
  {
    name: 'Captions, Metadata & Review Status',
    location: 'Inspector · Captions Tab',
    icon: FileJson,
    description:
      'Set Review Status (Unlabeled, In Progress, Labeled, Verified) and Dataset Split (Train, Val, Test). Generate AI Caption drafts in Descriptive, Concise, or Technical CV style, then edit Full Caption, Short Caption, and comma-separated Tags.',
  },
  {
    name: 'Taxonomy Manager',
    location: 'Inspector · Taxonomy Tab',
    icon: Tag,
    description:
      'Create, rename, and recolor top-level Classes and child Objects, assign 1–9 keyboard hotkeys, toggle class visibility on the canvas, and safely delete classes with automatic annotation reassignment or removal.',
  },
];

const DATASET_BATCH_CONTROLS: ControlDocItem[] = [
  {
    name: 'Gallery Search & Facet Filters',
    location: 'Dataset View · Toolbar',
    icon: Search,
    description:
      'Filter the image grid by filename, caption, or tag text alongside dropdown filters for Split (Train / Val / Test), Review Status, and Annotated Class.',
  },
  {
    name: 'Auto-Split Tool',
    location: 'Dataset View · Toolbar',
    icon: Shuffle,
    description:
      'Randomly partitions all project images into Train %, Val %, and Test % splits in one click (default 70 / 20 / 10).',
  },
  {
    name: 'Multi-Select & Bulk Action Bar',
    location: 'Dataset View · Cards',
    icon: Layers,
    description:
      'Click card checkboxes (or Shift+Click to select a range, or Select All Filtered) to bulk-assign splits, bulk-delete images, or open Batch Studio scoped to your selection.',
  },
  {
    name: 'Batch Studio — Batch Crop',
    location: 'Batch Studio · Crop Tab',
    icon: Crop,
    description:
      'Crop selected, filtered, or all images by Aspect Ratio + Anchor, Fit to Labels (with padding %), or Percentage Edge Inset. Remaps or clips annotations automatically and supports Save as New Copy or Overwrite.',
  },
  {
    name: 'Batch Studio — Batch Resize',
    location: 'Batch Studio · Resize Tab',
    icon: Maximize2,
    description:
      'Resize datasets to standard ML targets (224, 384, 512, 640, 768, 1024, or custom W×H) using Fit Inside, Fill & Center Crop, Stretch, or Letterbox Pad (Black, YOLO Gray, or White) with accurate annotation coordinate scaling.',
  },
  {
    name: 'Batch Studio — Batch Tags',
    location: 'Batch Studio · Tags Tab',
    icon: Tag,
    description:
      'Add tags, remove specific tags, replace all tags, or auto-generate tags directly from each image’s confirmed Class and Object labels.',
  },
  {
    name: 'Batch Studio — Batch Captions',
    location: 'Batch Studio · Captions Tab',
    icon: Sparkles,
    description:
      'Apply caption templates with dynamic tokens ({objects}, {classes}, {labels}, {tags}, {filename}, {count}), run bulk Find & Replace, clear captions, or run sequential AI Auto-Caption using your active AI provider (with Skip Existing and Merge Tags options).',
  },
];

const CROP_STUDIO_CONTROLS: ControlDocItem[] = [
  {
    name: 'Interactive Crop Frame & Drag Handles',
    location: 'Crop Studio · Canvas',
    icon: Crop,
    description:
      'Drag the crop box interior to reposition or drag any of the 8 edge/corner handles to resize. Toggle Rule-of-Thirds, Center Crosshair, or Off grid guides and overlay label visibility.',
  },
  {
    name: 'Aspect Ratio Presets & Swap',
    location: 'Crop Studio · Sidebar',
    icon: Square,
    description:
      'Choose Free, 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, or 2:3 aspect lock, swap orientation, or type exact pixel X, Y, Width, and Height coordinates.',
  },
  {
    name: 'Snap to Labels',
    location: 'Crop Studio · Sidebar',
    icon: Crosshair,
    description:
      'Automatically frames the crop rectangle around all annotations (or the currently selected annotation) with configurable percentage padding.',
  },
  {
    name: 'Annotation Remapping & Output Options',
    location: 'Crop Studio · Sidebar',
    icon: Settings2,
    description:
      'Choose Clip to Crop (with optional auto-flagging of Truncated attributes), Keep Only Fully Inside, or Drop Annotations. Pick output resize preset, JPEG/PNG/WebP format, quality %, Save as New Image vs Overwrite Original, or Download Cropped File directly.',
  },
];

const AI_PROVIDER_CONTROLS: ControlDocItem[] = [
  {
    name: 'Built-in Gemini Provider',
    location: 'AI Vision Provider Modal',
    icon: Sparkles,
    description:
      'Uses gemini-3.1-flash-lite with automatic retry and resilient fallback to gemini-4-hydrogen when busy. Configured via server GEMINI_API_KEY.',
  },
  {
    name: 'OpenRouter & NanoGPT Presets',
    location: 'AI Vision Provider Modal',
    icon: Cpu,
    description:
      'Connects to OpenRouter (https://openrouter.ai/api/v1) or NanoGPT (https://nano-gpt.com/api/v1) using server-side Secrets (OPENROUTER_API_KEY or NANOGPT_API_KEY). Includes recommended vision models and Fetch Live Models search.',
  },
  {
    name: 'Custom OpenAI-Compatible Endpoint',
    location: 'AI Vision Provider Modal',
    icon: Settings2,
    description:
      'Routes requests to your own HTTPS OpenAI-compatible endpoint configured in server Secrets via OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_API_KEY, and optional OPENAI_COMPATIBLE_MODEL.',
  },
  {
    name: 'Fetch Live Models & Test Connection',
    location: 'AI Vision Provider Modal',
    icon: Cpu,
    description:
      'Queries the provider’s /models endpoint to filter available vision models, and runs a quick live ping showing response latency (ms) before you click Use Provider.',
  },
];

const ANALYTICS_EXPORT_CONTROLS: ControlDocItem[] = [
  {
    name: 'Analytics — Dataset Summary & Balance Charts',
    location: 'Analytics View',
    icon: BarChart3,
    description:
      'Displays the top Dataset Summary card (total annotated objects, train/val/test split percentages, top 5 annotated classes), 4 KPI cards, Taxonomy Balance (toggle By Class or By Object), Geometry Breakdown, Dataset Splits, and Review Pipeline.',
  },
  {
    name: 'Export Formats (COCO JSON · JSONL · CSV · Backup)',
    location: 'Export View',
    icon: FileJson,
    description:
      'Filter by Train/Val/Test split, Verified Only, and AI Suggestions toggle. Inspect the live payload preview, Copy to clipboard, Download locally, or Save to Drive.',
  },
  {
    name: 'Cropped Object Masks (ZIP)',
    location: 'Export View · Masks ZIP',
    icon: Archive,
    description:
      'Generates a downloadable .zip archive with individual cropped PNGs for every polygon and bounding box: Binary Masks (white silhouette on black), Transparent RGBA Cutouts, or Paired RGB Crop + Mask. Supports geometry filter, crop padding (0–32px), folder layout (By Class, By Image, Flat), live crop preview, and manifest.json.',
  },
  {
    name: 'Import COCO JSON or Backup',
    location: 'Export View · Left Panel',
    icon: Upload,
    description:
      'Upload a local COCO JSON or Reticle Backup file (or pick one from Google Drive) to reconstruct Class / Object taxonomies and merge annotations and captions onto matching filenames.',
  },
  {
    name: 'Google Drive Sync (Browse, Import & Upload)',
    location: 'Google Drive Modal',
    icon: HardDrive,
    description:
      'Sign in with Google to browse your Drive folders, import images or COCO JSON directly into the current project, or upload COCO/JSONL/CSV/Backup files to a chosen Drive folder (with confirmation prompts before writing files).',
  },
];

const SHORTCUT_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Annotation Tools',
    items: [
      ['V', 'Select, move & edit vertices'],
      ['B', 'Bounding Box tool'],
      ['P', 'Polygon segmentation tool'],
      ['L', 'Polyline / line tool'],
      ['K', 'Keypoint marker tool'],
      ['H / Space + Drag', 'Pan viewport'],
      ['X', 'Open Crop Studio for active image'],
    ],
  },
  {
    title: 'Drawing & Geometry Editing',
    items: [
      ['Enter / Double-click', 'Close polygon or finish polyline'],
      ['Backspace', 'Undo last placed vertex while drawing'],
      ['Esc', 'Cancel active draft or deselect shape'],
      ['Delete / Backspace', 'Delete selected annotation (in Select mode)'],
      ['Right-click / Alt+Click', 'Remove vertex from selected polygon/polyline'],
      ['Click dashed midpoint', 'Insert a new vertex along an edge'],
    ],
  },
  {
    title: 'Navigation, History & Display',
    items: [
      ['1 – 9', 'Switch active Class / Object hotkey'],
      ['A / Left Arrow', 'Previous image in queue'],
      ['D / Right Arrow', 'Next image in queue'],
      ['Ctrl/Cmd + Z', 'Undo annotation change'],
      ['Ctrl/Cmd + Shift + Z', 'Redo annotation change'],
      ['F', 'Fit image to viewport'],
      ['C', 'Toggle crosshair alignment guides'],
      ['T', 'Toggle canvas labels'],
      ['?', 'Toggle Keyboard Shortcuts overlay'],
    ],
  },
];

export default function HelpView({
  onNavigateTab,
  onOpenAIProvider,
  onOpenDrive,
  onOpenShortcuts,
}: HelpViewProps) {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string>('workflows');

  const q = query.trim().toLowerCase();

  const matchesText = (...fields: Array<string | undefined>) => {
    if (!q) return true;
    return fields.some((f) => f && f.toLowerCase().includes(q));
  };

  const filteredWorkflows = useMemo(
    () =>
      WORKFLOWS.filter((w) =>
        matchesText(w.title, w.summary, ...w.steps)
      ),
    [q]
  );

  const filteredTopbar = useMemo(
    () =>
      TOPBAR_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredToolRail = useMemo(
    () =>
      TOOLRAIL_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredQueueInspector = useMemo(
    () =>
      QUEUE_INSPECTOR_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredDatasetBatch = useMemo(
    () =>
      DATASET_BATCH_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredCropStudio = useMemo(
    () =>
      CROP_STUDIO_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredAIProviders = useMemo(
    () =>
      AI_PROVIDER_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredAnalyticsExport = useMemo(
    () =>
      ANALYTICS_EXPORT_CONTROLS.filter((c) =>
        matchesText(c.name, c.location, c.hotkey, c.description)
      ),
    [q]
  );

  const filteredShortcuts = useMemo(
    () =>
      SHORTCUT_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter(([k, d]) => matchesText(g.title, k, d)),
      })).filter((g) => g.items.length > 0),
    [q]
  );

  const totalMatches =
    filteredWorkflows.length +
    filteredTopbar.length +
    filteredToolRail.length +
    filteredQueueInspector.length +
    filteredDatasetBatch.length +
    filteredCropStudio.length +
    filteredAIProviders.length +
    filteredAnalyticsExport.length +
    filteredShortcuts.reduce((acc, g) => acc + g.items.length, 0);

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(`help-sec-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleWorkflowAction = (actionType?: WorkflowStep['actionType']) => {
    if (!actionType) return;
    if (actionType === 'ai') {
      onOpenAIProvider();
    } else if (actionType === 'drive') {
      onOpenDrive();
    } else {
      onNavigateTab(actionType);
    }
  };

  const renderControlTable = (items: ControlDocItem[]) => (
    <div className="bg-[#12151B] border border-[#232834] rounded-lg divide-y divide-[#232834]">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.name}
            className="p-4 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5 hover:bg-[#181C24]/50 transition-colors"
          >
            <div className="sm:w-64 shrink-0 space-y-1">
              <div className="flex items-center gap-2">
                {Icon && <Icon className="w-4 h-4 text-[#38BDF8] shrink-0" strokeWidth={1.75} />}
                <span className="text-[13px] font-semibold text-[#E8ECF2]">{item.name}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[#8B95A5]">
                <span>{item.location}</span>
                {item.hotkey && (
                  <>
                    <span aria-hidden="true">·</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[#07090C] border border-[#232834] font-mono text-[10px] text-[#CBD5E1] whitespace-nowrap">
                      {item.hotkey}
                    </kbd>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-[#CBD5E1] leading-relaxed flex-1">{item.description}</p>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#0B0D10]">
      {/* Left Sticky Documentation Navigation Sidebar */}
      <aside className="hidden md:flex w-[248px] shrink-0 bg-[#12151B] border-r border-[#232834] flex-col min-h-0">
        <div className="px-4 py-3.5 border-b border-[#232834]">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#E8ECF2]">
            <BookOpen className="w-4 h-4 text-[#38BDF8]" />
            <span>Studio Guide</span>
          </div>
          <p className="text-[11px] text-[#8B95A5] mt-1">
            Buttons, functions &amp; labeling flows
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5 space-y-4" aria-label="Help sections">
          {(['Flows', 'Controls', 'Modules', 'Reference'] as const).map((cat) => (
            <div key={cat} className="space-y-0.5">
              <div className="px-2.5 py-1 text-[11px] font-medium text-[#64748B]">{cat}</div>
              {SECTIONS.filter((s) => s.category === cat).map((sec) => {
                const isActive = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => scrollToSection(sec.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap truncate ${
                      isActive
                        ? 'bg-[#181C24] text-[#38BDF8]'
                        : 'text-[#8B95A5] hover:text-[#E8ECF2] hover:bg-[#181C24]/60'
                    }`}
                  >
                    {sec.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-[#232834] space-y-1.5">
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
          >
            <span className="flex items-center gap-2">
              <Keyboard className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Shortcut Overlay</span>
            </span>
            <kbd className="px-1.5 py-0.5 rounded bg-[#12151B] border border-[#232834] font-mono text-[10px] text-[#8B95A5]">
              ?
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('annotate')}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C] text-xs font-semibold transition-colors"
          >
            <span>Return to Annotate</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* Main Scrollable Help Content */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-[960px] mx-auto space-y-10 pb-12">
          {/* Header & Live Search */}
          <div className="border-b border-[#232834] pb-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-[#E8ECF2] tracking-tight">
                  Reticle Studio Help &amp; Reference
                </h1>
                <p className="text-xs text-[#8B95A5] mt-1 max-w-2xl leading-relaxed">
                  Complete reference for every workspace button, annotation tool, AI provider,
                  batch processor, mask exporter, and end-to-end labeling workflow.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-[#8B95A5] shrink-0">
                <span>5 Core Flows</span>
                <span aria-hidden="true">·</span>
                <span>9 Reference Sections</span>
              </div>
            </div>

            <div className="relative max-w-xl">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search any button, shortcut, tool, export format, or flow (e.g. polygon, OpenRouter, ZIP, crop)..."
                aria-label="Search help documentation"
                className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded-md pl-9 pr-9 py-2 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear help search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-[#8B95A5] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {q && (
              <div className="text-[11px] text-[#8B95A5] font-mono tabular-nums">
                Showing {totalMatches} matching {totalMatches === 1 ? 'entry' : 'entries'} for “{query}”
              </div>
            )}
          </div>

          {/* Empty Search State */}
          {totalMatches === 0 && (
            <div className="p-10 rounded-lg bg-[#12151B] border border-[#232834] text-center space-y-3">
              <p className="text-sm font-medium text-[#E8ECF2]">
                No documentation entries match “{query}”.
              </p>
              <p className="text-xs text-[#8B95A5]">
                Try searching for a tool name like “polygon”, “crop”, “batch”, “mask”, “Drive”, or a shortcut key.
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="px-3.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors"
              >
                Clear Search Filter
              </button>
            </div>
          )}

          {/* 1. Core End-to-End Workflows */}
          {filteredWorkflows.length > 0 && (
            <section id="help-sec-workflows" className="scroll-mt-6 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2] flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#38BDF8]" />
                  <span>End-to-End Workflows</span>
                </h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Follow these five standard flows from raw image ingestion to verified ML exports.
                </p>
              </div>

              <div className="space-y-3">
                {filteredWorkflows.map((flow) => (
                  <article
                    key={flow.number}
                    className="bg-[#12151B] border border-[#232834] rounded-lg p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-[#E8ECF2]">
                          <span className="font-mono tabular-nums text-[#38BDF8] mr-2">
                            {flow.number}.
                          </span>
                          {flow.title}
                        </h3>
                        <p className="text-xs text-[#8B95A5] leading-relaxed">{flow.summary}</p>
                      </div>
                      {flow.actionLabel && flow.actionType && (
                        <button
                          type="button"
                          onClick={() => handleWorkflowAction(flow.actionType)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap shrink-0"
                        >
                          <span>{flow.actionLabel}</span>
                          <ArrowRight className="w-3 h-3 text-[#38BDF8]" />
                        </button>
                      )}
                    </div>

                    <ol className="space-y-1.5 pt-2 border-t border-[#232834]/70">
                      {flow.steps.map((step, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2.5 text-xs text-[#CBD5E1] leading-relaxed"
                        >
                          <span className="font-mono tabular-nums text-[11px] text-[#64748B] mt-0.5 shrink-0">
                            {idx + 1}.
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* 2. Top Navigation Bar */}
          {filteredTopbar.length > 0 && (
            <section id="help-sec-topbar" className="scroll-mt-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2]">Top Navigation Bar</h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Global project switching, view tabs, AI endpoint selection, Google Drive access, and image import.
                </p>
              </div>
              {renderControlTable(filteredTopbar)}
            </section>
          )}

          {/* 3. Tool Rail & Canvas Controls */}
          {filteredToolRail.length > 0 && (
            <section id="help-sec-toolrail" className="scroll-mt-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2]">
                  Tool Rail &amp; Canvas Controls
                </h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Every drawing, editing, cropping, history, and display calibration button on the left vertical rail.
                </p>
              </div>
              {renderControlTable(filteredToolRail)}
            </section>
          )}

          {/* 4. Image Queue & Inspector Panel */}
          {filteredQueueInspector.length > 0 && (
            <section id="help-sec-queue-inspector" className="scroll-mt-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2]">
                  Image Queue &amp; Right Inspector Panel
                </h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Image navigation, layer multi-select, AI suggestion review, caption drafting, and hierarchical Class / Object management.
                </p>
              </div>
              {renderControlTable(filteredQueueInspector)}
            </section>
          )}

          {/* 5. Dataset Gallery & Batch Studio */}
          {filteredDatasetBatch.length > 0 && (
            <section id="help-sec-dataset-batch" className="scroll-mt-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#E8ECF2]">
                    Dataset Gallery &amp; Batch Operations Studio
                  </h2>
                  <p className="text-xs text-[#8B95A5] mt-0.5">
                    Filter, split, multi-select, and transform entire subsets of your dataset at once.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('dataset')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                >
                  <span>Open Dataset</span>
                  <ArrowRight className="w-3 h-3 text-[#38BDF8]" />
                </button>
              </div>
              {renderControlTable(filteredDatasetBatch)}
            </section>
          )}

          {/* 6. Crop Studio */}
          {filteredCropStudio.length > 0 && (
            <section id="help-sec-crop-studio" className="scroll-mt-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2] flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-[#38BDF8]" />
                  <span>Crop Image Studio</span>
                </h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Non-destructive or in-place cropping with automatic bounding-box, polygon, polyline, and keypoint coordinate remapping.
                </p>
              </div>
              {renderControlTable(filteredCropStudio)}
            </section>
          )}

          {/* 7. AI Vision Providers */}
          {filteredAIProviders.length > 0 && (
            <section id="help-sec-ai-providers" className="scroll-mt-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#E8ECF2]">
                    AI Vision Providers &amp; Server Secrets
                  </h2>
                  <p className="text-xs text-[#8B95A5] mt-0.5">
                    All AI API keys stay strictly on the server via Settings &rarr; Secrets and are never entered in the browser.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenAIProvider}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                >
                  <Cpu className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Open AI Provider Settings</span>
                </button>
              </div>
              {renderControlTable(filteredAIProviders)}
            </section>
          )}

          {/* 8. Analytics, Export & Google Drive */}
          {filteredAnalyticsExport.length > 0 && (
            <section id="help-sec-analytics-export" className="scroll-mt-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#E8ECF2]">
                    Analytics, Export, Cropped Masks ZIP &amp; Google Drive
                  </h2>
                  <p className="text-xs text-[#8B95A5] mt-0.5">
                    Audit class distributions, export ML datasets and per-object PNG masks, and sync with Google Drive.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('analytics')}
                    className="px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                  >
                    Analytics
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('export')}
                    className="px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={onOpenDrive}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] transition-colors whitespace-nowrap"
                  >
                    <HardDrive className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>Google Drive</span>
                  </button>
                </div>
              </div>
              {renderControlTable(filteredAnalyticsExport)}
            </section>
          )}

          {/* 9. Keyboard Shortcuts Reference */}
          {filteredShortcuts.length > 0 && (
            <section id="help-sec-shortcuts" className="scroll-mt-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2] flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-[#38BDF8]" />
                  <span>Keyboard Shortcuts</span>
                </h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Active in the Annotate workspace whenever no text input or modal dialog is open.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {filteredShortcuts.map((group) => (
                  <div
                    key={group.title}
                    className="bg-[#12151B] border border-[#232834] rounded-lg p-4 space-y-2.5"
                  >
                    <h3 className="text-xs font-semibold text-[#38BDF8]">{group.title}</h3>
                    <div className="divide-y divide-[#232834]/60">
                      {group.items.map(([key, desc]) => (
                        <div
                          key={key}
                          className="py-1.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-[#CBD5E1]">{desc}</span>
                          <kbd className="px-1.5 py-0.5 rounded bg-[#07090C] border border-[#232834] font-mono text-[10px] text-[#E8ECF2] whitespace-nowrap shrink-0">
                            {key}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Footer Quick Note */}
          <footer className="pt-4 border-t border-[#232834] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#64748B]">
            <span className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-[#8B95A5]" />
              <span>
                All projects, images, and annotations are stored locally in your browser’s IndexedDB
                and persist automatically across reloads.
              </span>
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('annotate')}
              className="text-[#38BDF8] hover:underline font-medium"
            >
              Back to Workspace
            </button>
          </footer>
        </div>
      </main>
    </div>
  );
}
