# Reticle

**Reticle** is a precision machine learning image annotation, segmentation, captioning, and dataset management studio built with React, TypeScript, Tailwind CSS, Express, and IndexedDB.

It supports hierarchical `Class → Object` taxonomies, multi-geometry labeling, batch image transformations, dataset analytics, Google Drive import/export, and pluggable AI vision providers (Gemini, OpenRouter, NanoGPT, and any OpenAI-compatible vision endpoint).

---

## Features

### Annotation Workspace
- **Geometry Tools**: Bounding boxes (`B`), polygons (`P`), polylines (`L`), keypoints (`K`), selection & vertex editing (`V`), and viewport pan/zoom (`H` or `Space + Drag`).
- **Vertex Editing**: Drag vertices, insert new vertices along edge midpoints, or remove vertices (`Right-click` / `Alt+Click`).
- **Hierarchical Taxonomy**: Organize labels under `Class → Object` pairs with hotkeys (`1–9`), color inheritance, and safe reassignment or cascading deletion.
- **Image-Level Metadata**: Captions, tags, dataset split (`train` / `val` / `test`), and review workflow status (`unlabeled`, `in_progress`, `labeled`, `verified`).
- **Crop Studio (`X`)**: Non-destructive aspect-ratio cropping with automatic coordinate remapping for existing annotations.
- **Undo / Redo**: Full annotation history per image (`Ctrl/Cmd + Z` and `Ctrl/Cmd + Shift + Z`).

### AI-Assisted Labeling
- **Auto-Detect & Auto-Caption**: Generate candidate bounding boxes and descriptive captions via a server-side proxy so API keys stay off the client.
- **Multi-Provider Support**:
  - **Google Gemini** (`GEMINI_API_KEY`)
  - **OpenRouter** (`OPENROUTER_API_KEY`)
  - **NanoGPT** (`NANOGPT_API_KEY`)
  - **Custom OpenAI-Compatible Endpoint** (`OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL`)
- **Review Workflow**: AI detections arrive as reviewable suggestions that can be accepted or dismissed individually or in bulk.

### Dataset Gallery & Batch Studio
- **Multi-Facet Filtering**: Filter by search query (filename, caption, tag), dataset split, review status, parent class, or annotation geometry type (`Bounding Box`, `Polygon`, `Polyline`, `Keypoint`, or `No Annotations`).
- **Batch Operations**: Multi-select cards (including `Shift+Click` range select) to run **Batch Crop**, **Batch Resize**, **Batch Tags**, **Batch Captions**, bulk split assignment, or bulk delete.
- **Proportional Auto-Split**: Shuffle and split a project into custom `train` / `val` / `test` percentages.
- **Local-First Storage**: Projects, images, and annotations persist locally in browser IndexedDB.

### Analytics & Quality Insights
- **Dataset Summary**: Total annotated objects, `train` / `val` / `test` distribution percentages, and top 5 most frequently annotated classes.
- **Labeling Density & Object Distribution**: Stacked bar chart per image switchable between object class and geometry type, with sorting and dataset average baseline.
- **Image Brightness & Contrast**: Rec. 709 luminance and RMS contrast analysis highlighting images significantly darker or lighter than the project average, with one-click navigation into the annotator.

### Export, Import & Google Drive
- **Standard ML Formats**: Export **COCO JSON**, **JSONL**, **CSV**, and full **Project Backup JSON** with split and verification filters.
- **Cropped Object Masks (ZIP)**: Generate downloadable ZIP archives of individual cropped object masks (Binary Masks, Transparent RGBA Cutouts, or Paired RGB + Mask) with configurable padding, geometry filters, folder structure, and `manifest.json`.
- **Import**: Import existing annotations from COCO or Reticle JSON backups.
- **Google Drive Sync**: Sign in with Google to import images directly from Drive or upload exports and backups back to Drive.
- **Built-In Help Center**: Searchable in-app documentation covering tools, buttons, shortcuts, and end-to-end workflows.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, Motion, JSZip
- **Backend**: Express 4 (`server.ts`) serving Vite middleware in development, static assets in production, and `/api/ai/*` server-side provider routes
- **Persistence**: IndexedDB (`src/utils/db.ts`)
- **Cloud Integration**: Firebase Auth + Google Drive REST API (`src/utils/googleDrive.ts`)

---

## Getting Started

### Prerequisites

- **Node.js** `20+` (or **Bun**)
- **npm** (or `bun`)

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd <your-repo-directory>
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the API keys for the AI providers you plan to use:

```bash
cp .env.example .env
```

```env
# Required for Gemini AI detection & captioning
GEMINI_API_KEY="your_gemini_api_key"

# Base URL where the app is running
APP_URL="http://localhost:3000"

# Optional OpenAI-compatible vision providers
OPENROUTER_API_KEY=""
NANOGPT_API_KEY=""
OPENAI_COMPATIBLE_BASE_URL=""
OPENAI_COMPATIBLE_API_KEY=""
OPENAI_COMPATIBLE_MODEL=""
```

> All AI calls are proxied through the Express server in `server.ts`. Never commit `.env` to version control.

### 3. Run Locally (Development)

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build & Run in Production

```bash
npm run build
NODE_ENV=production npm start
```

> **Note on `npm start`**: `package.json` runs `node server.ts` (supported natively on Node.js 22.6+ with TypeScript type stripping) or you can run `NODE_ENV=production npx tsx server.ts` on earlier Node.js 20/22 versions.

---

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the Express + Vite development server on port `3000` |
| `npm run build` | Builds the frontend production bundle into `dist/` |
| `npm start` | Starts the production server (`node server.ts`) |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |
| `npm run clean` | Removes `dist/` build output |

---

## Google Drive Setup (Optional)

Google Drive sign-in uses Firebase Authentication (`firebase-applet-config.json`). When running locally from a cloned repository:

1. Ensure `localhost` is listed under **Authentication → Settings → Authorized domains** in your Firebase console.
2. Enable the **Google** sign-in provider in Firebase Authentication.
3. Enable the **Google Drive API** in the linked Google Cloud project.

If you do not need Google Drive integration, all local dataset management, annotation, analytics, AI detection, and export features work without signing in.

---

## Server API Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/ai/providers` | Lists configured AI providers and default models |
| `POST` | `/api/ai/models` | Fetches available vision models from an OpenAI-compatible provider |
| `POST` | `/api/ai/test` | Tests connectivity and credentials for a selected provider |
| `POST` | `/api/ai/detect` | Runs object detection against an image using the selected provider |
| `POST` | `/api/ai/caption` | Generates an image caption and suggested tags |

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` | Select, move, and edit vertices |
| `B` | Bounding Box tool |
| `P` | Polygon segmentation tool |
| `L` | Polyline tool |
| `K` | Keypoint tool |
| `H` / `Space + Drag` | Pan viewport |
| `X` | Open Crop Studio |
| `1–9` | Switch active Class / Object |
| `Enter` / `Double-click` | Close polygon or finish polyline |
| `Backspace` | Undo last vertex while drawing |
| `Delete` / `Backspace` | Delete selected annotation |
| `Esc` | Cancel draft or deselect shape |
| `A` / `Left Arrow` | Previous image |
| `D` / `Right Arrow` | Next image |
| `F` / `C` / `T` | Fit view / Toggle crosshairs / Toggle labels |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |

---

## Project Structure

```text
├── server.ts                     # Express server, Vite middleware, and /api/ai/* proxy routes
├── index.html                    # HTML entry point
├── firebase-applet-config.json   # Firebase web config for Google Drive OAuth
├── .env.example                  # Environment variable template
└── src/
    ├── App.tsx                   # Top-level application state and workspace router
    ├── types/                    # TypeScript models for projects, images, annotations, and AI
    ├── components/
    │   ├── AnnotationCanvas.tsx  # Interactive SVG/Canvas annotation editor
    │   ├── ToolRail.tsx          # Left vertical tool and shortcut rail
    │   ├── InspectorPanel.tsx    # Taxonomy, objects, AI assist, caption, and metadata sidebar
    │   ├── ImageQueue.tsx        # Bottom filmstrip queue
    │   ├── DatasetGallery.tsx    # Filterable image grid and batch toolbar
    │   ├── BatchStudioModal.tsx  # Batch crop, resize, tagging, and captioning
    │   ├── CropModal.tsx         # Single-image crop studio
    │   ├── AnalyticsView.tsx     # Summary, labeling density, and brightness/contrast analytics
    │   ├── ExportView.tsx        # COCO/JSONL/CSV, backup, and cropped mask ZIP exporter
    │   ├── AIProviderModal.tsx   # Multi-provider AI configuration and testing
    │   ├── GoogleDriveModal.tsx  # Google Drive browser, importer, and uploader
    │   └── HelpView.tsx          # In-app reference guide and workflows
    └── utils/
        ├── db.ts                 # IndexedDB persistence layer
        ├── exporters.ts          # COCO, JSONL, CSV, and JSON backup import/export
        ├── maskExporter.ts       # Per-object cropped mask and ZIP generator
        ├── imageMetrics.ts       # Brightness (Rec. 709) and RMS contrast computation
        ├── geometry.ts           # Polygon area, bbox, polyline length, and taxonomy helpers
        ├── crop.ts               # Image cropping and annotation remapping
        └── googleDrive.ts        # Firebase Google OAuth and Drive API client
```
