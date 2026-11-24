import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  X,
  HardDrive,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  FileJson,
  FileText,
  Search,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  ChevronRight,
  Check,
  Loader2,
  AlertCircle,
  AlertTriangle,
  LogOut,
} from 'lucide-react';
import type { DatasetImage, Project, SplitType } from '../types/annotation';
import {
  DRIVE_FOLDER_MIME,
  DriveAuthExpiredError,
  createDriveFolder,
  downloadDriveFileBlob,
  downloadDriveTextFile,
  listDriveFiles,
  trashDriveFile,
  uploadDriveFile,
  type DriveFileItem,
} from '../utils/googleDrive';
import {
  exportProjectBackup,
  exportToCOCO,
  exportToCSV,
  exportToJSONL,
  filterImagesForExport,
} from '../utils/exporters';
import { getImageBlob } from '../utils/db';
import GoogleSignInButton from './GoogleSignInButton';

export type DriveModalTab = 'browse' | 'upload';

interface GoogleDriveModalProps {
  initialTab: DriveModalTab;
  user: User | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  project: Project;
  images: DatasetImage[];
  imageUrls: Record<string, string>;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onAuthExpired: () => void;
  onImportDriveBlobs: (
    files: Array<{ name: string; mimeType: string; blob: Blob }>,
    split: SplitType
  ) => Promise<void>;
  onImportAnnotationsJson: (rawJson: string) => Promise<void>;
  onNotify: (text: string, tone?: 'info' | 'success' | 'error') => void;
  onClose: () => void;
}

interface Crumb {
  id: string;
  name: string;
}

interface PendingConfirmAction {
  kind: 'trash' | 'upload';
  title: string;
  description: string;
  affectedItems: string[];
  overwriteCount?: number;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}

function formatBytes(raw?: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function isJsonLike(file: DriveFileItem): boolean {
  return (
    file.mimeType === 'application/json' ||
    file.name.toLowerCase().endsWith('.json')
  );
}

export default function GoogleDriveModal({
  initialTab,
  user,
  needsAuth,
  isLoggingIn,
  project,
  images,
  imageUrls,
  onSignIn,
  onSignOut,
  onAuthExpired,
  onImportDriveBlobs,
  onImportAnnotationsJson,
  onNotify,
  onClose,
}: GoogleDriveModalProps) {
  const [tab, setTab] = useState<DriveModalTab>(initialTab);
  const [breadcrumbs, setBreadcrumbs] = useState<Crumb[]>([{ id: 'root', name: 'My Drive' }]);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [search, setSearch] = useState('');
  const [fileFilter, setFileFilter] = useState<'all' | 'images' | 'json'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importSplit, setImportSplit] = useState<SplitType>('train');

  // New folder creation UI
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Upload to Drive tab options
  const [includeCoco, setIncludeCoco] = useState(true);
  const [includeJsonl, setIncludeJsonl] = useState(false);
  const [includeCsv, setIncludeCsv] = useState(false);
  const [includeBackup, setIncludeBackup] = useState(true);
  const [includeImages, setIncludeImages] = useState(false);
  const [exportSplits, setExportSplits] = useState<SplitType[]>(['train', 'val', 'test']);
  const [overwriteExisting, setOverwriteExisting] = useState(true);

  // Busy / progress / error / mandatory confirmation dialog
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null
  );
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1];

  const loadFolder = useCallback(async () => {
    if (needsAuth || !user) return;
    setLoadingFiles(true);
    setErrorText(null);
    try {
      const list = await listDriveFiles({
        folderId: currentFolder.id,
        search,
        filter: fileFilter,
      });
      setFiles(list);
      setSelectedIds([]);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onAuthExpired();
      } else {
        setErrorText(err instanceof Error ? err.message : 'Failed to list Google Drive files.');
      }
    } finally {
      setLoadingFiles(false);
    }
  }, [needsAuth, user, currentFolder.id, search, fileFilter, onAuthExpired]);

  useEffect(() => {
    if (!needsAuth && user) {
      void loadFolder();
    }
  }, [needsAuth, user, loadFolder]);

  const selectedFiles = useMemo(() => {
    const set = new Set(selectedIds);
    return files.filter((f) => set.has(f.id));
  }, [files, selectedIds]);

  const selectedImageFiles = useMemo(
    () => selectedFiles.filter((f) => isImageMime(f.mimeType)),
    [selectedFiles]
  );

  const projectSlug = useMemo(() => {
    return (
      project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || 'reticle'
    );
  }, [project.name]);

  const matchedExportImages = useMemo(
    () =>
      filterImagesForExport(images, {
        splits: exportSplits,
        verifiedOnly: false,
        includeAiSuggestions: false,
      }),
    [images, exportSplits]
  );

  const toggleSelectFile = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleOpenFolder = (folder: DriveFileItem) => {
    setSearch('');
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleCreateFolder = async () => {
    const clean = newFolderName.trim();
    if (!clean) return;
    setBusy(true);
    setErrorText(null);
    try {
      const created = await createDriveFolder(clean, currentFolder.id);
      setNewFolderName('');
      setCreatingFolder(false);
      setBreadcrumbs((prev) => [...prev, { id: created.id, name: created.name }]);
      onNotify(`Created folder "${created.name}" in Google Drive.`, 'success');
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onAuthExpired();
      } else {
        setErrorText(err instanceof Error ? err.message : 'Could not create Drive folder.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Import selected Drive images into local IndexedDB dataset (read-only on Drive)
  const handleImportSelectedImages = async () => {
    if (selectedImageFiles.length === 0) return;
    setBusy(true);
    setErrorText(null);
    try {
      const downloaded: Array<{ name: string; mimeType: string; blob: Blob }> = [];
      for (let i = 0; i < selectedImageFiles.length; i++) {
        const f = selectedImageFiles[i];
        setProgress({ done: i, total: selectedImageFiles.length, label: `Downloading ${f.name}` });
        const blob = await downloadDriveFileBlob(f.id);
        downloaded.push({ name: f.name, mimeType: f.mimeType, blob });
      }
      setProgress({
        done: selectedImageFiles.length,
        total: selectedImageFiles.length,
        label: 'Saving to local dataset...',
      });
      await onImportDriveBlobs(downloaded, importSplit);
      setSelectedIds([]);
      onClose();
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onAuthExpired();
      } else {
        setErrorText(err instanceof Error ? err.message : 'Failed to import images from Drive.');
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Import a JSON annotation/backup file from Drive (read-only on Drive)
  const handleImportJsonFromDrive = async (file: DriveFileItem) => {
    setBusy(true);
    setErrorText(null);
    setProgress({ done: 0, total: 1, label: `Reading ${file.name}` });
    try {
      const rawText = await downloadDriveTextFile(file.id);
      await onImportAnnotationsJson(rawText);
      onClose();
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onAuthExpired();
      } else {
        setErrorText(err instanceof Error ? err.message : 'Failed to import JSON from Drive.');
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Request explicit confirmation before moving Drive files to Trash
  const requestTrashSelected = () => {
    if (selectedFiles.length === 0) return;
    setPendingConfirm({
      kind: 'trash',
      title: `Move ${selectedFiles.length} item${selectedFiles.length === 1 ? '' : 's'} to Google Drive Trash?`,
      description:
        'The selected files or folders in your Google Drive will be moved to Trash. You can restore them later from Google Drive Trash if needed.',
      affectedItems: selectedFiles.map((f) => f.name),
      confirmLabel: `Move ${selectedFiles.length} to Trash`,
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        setErrorText(null);
        try {
          for (let i = 0; i < selectedFiles.length; i++) {
            const f = selectedFiles[i];
            setProgress({ done: i, total: selectedFiles.length, label: `Trashing ${f.name}` });
            await trashDriveFile(f.id);
          }
          onNotify(
            `Moved ${selectedFiles.length} item${selectedFiles.length === 1 ? '' : 's'} to Google Drive Trash.`,
            'info'
          );
          await loadFolder();
        } catch (err) {
          if (err instanceof DriveAuthExpiredError) {
            onAuthExpired();
          } else {
            setErrorText(err instanceof Error ? err.message : 'Failed to move files to Trash.');
          }
        } finally {
          setBusy(false);
          setProgress(null);
        }
      },
    });
  };

  // Prepare upload plan and show mandatory confirmation dialog before writing/overwriting in Drive
  const requestUploadToDrive = () => {
    const plannedNames: string[] = [];
    if (includeCoco) plannedNames.push(`${projectSlug}_coco.json`);
    if (includeJsonl) plannedNames.push(`${projectSlug}_dataset.jsonl`);
    if (includeCsv) plannedNames.push(`${projectSlug}_captions.csv`);
    if (includeBackup) plannedNames.push(`${projectSlug}_reticle-backup.json`);
    if (includeImages) {
      for (const img of matchedExportImages) {
        plannedNames.push(img.fileName);
      }
    }

    if (plannedNames.length === 0) {
      setErrorText('Select at least one export format or dataset images to upload.');
      return;
    }

    const existingByName = new Map(
      files.filter((f) => f.mimeType !== DRIVE_FOLDER_MIME).map((f) => [f.name, f])
    );
    const overwriteNames = overwriteExisting
      ? plannedNames.filter((name) => existingByName.has(name))
      : [];

    setPendingConfirm({
      kind: 'upload',
      title: `Upload ${plannedNames.length} file${plannedNames.length === 1 ? '' : 's'} to "${currentFolder.name}"?`,
      description:
        overwriteNames.length > 0
          ? `This will upload ${plannedNames.length} file(s) to Google Drive folder "${currentFolder.name}", overwriting ${overwriteNames.length} existing file(s) with matching names.`
          : `This will create ${plannedNames.length} file(s) inside your Google Drive folder "${currentFolder.name}".`,
      affectedItems: plannedNames.map((n) =>
        overwriteExisting && existingByName.has(n) ? `${n} (will overwrite existing)` : n
      ),
      overwriteCount: overwriteNames.length,
      confirmLabel:
        overwriteNames.length > 0
          ? `Confirm Upload & Overwrite (${plannedNames.length})`
          : `Confirm Upload (${plannedNames.length})`,
      destructive: false,
      onConfirm: async () => {
        setBusy(true);
        setErrorText(null);
        try {
          const exportOpts = {
            splits: exportSplits,
            verifiedOnly: false,
            includeAiSuggestions: false,
          };

          const jobs: Array<{
            name: string;
            mimeType: string;
            getContent: () => Promise<Blob | string>;
          }> = [];

          if (includeCoco) {
            jobs.push({
              name: `${projectSlug}_coco.json`,
              mimeType: 'application/json',
              getContent: async () => exportToCOCO(project, images, exportOpts),
            });
          }
          if (includeJsonl) {
            jobs.push({
              name: `${projectSlug}_dataset.jsonl`,
              mimeType: 'application/x-ndjson',
              getContent: async () => exportToJSONL(project, images, exportOpts),
            });
          }
          if (includeCsv) {
            jobs.push({
              name: `${projectSlug}_captions.csv`,
              mimeType: 'text/csv',
              getContent: async () => exportToCSV(project, images, exportOpts),
            });
          }
          if (includeBackup) {
            jobs.push({
              name: `${projectSlug}_reticle-backup.json`,
              mimeType: 'application/json',
              getContent: async () => exportProjectBackup(project, images),
            });
          }
          if (includeImages) {
            for (const img of matchedExportImages) {
              jobs.push({
                name: img.fileName,
                mimeType: img.mimeType || 'image/jpeg',
                getContent: async () => {
                  const stored = await getImageBlob(img.id);
                  if (stored) return stored;
                  const src = imageUrls[img.id] || img.seedUrl;
                  if (!src) throw new Error(`Image data unavailable for ${img.fileName}`);
                  const resp = await fetch(src);
                  return resp.blob();
                },
              });
            }
          }

          for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            setProgress({ done: i, total: jobs.length, label: `Uploading ${job.name}` });
            const content = await job.getContent();
            const existing = overwriteExisting ? existingByName.get(job.name) : undefined;
            await uploadDriveFile({
              name: job.name,
              mimeType: job.mimeType,
              content,
              parentId: currentFolder.id,
              existingFileId: existing?.id,
            });
          }

          setProgress({ done: jobs.length, total: jobs.length, label: 'Completed' });
          onNotify(
            `Uploaded ${jobs.length} file${jobs.length === 1 ? '' : 's'} to Google Drive ("${currentFolder.name}").`,
            'success'
          );
          await loadFolder();
          setTab('browse');
        } catch (err) {
          if (err instanceof DriveAuthExpiredError) {
            onAuthExpired();
          } else {
            setErrorText(err instanceof Error ? err.message : 'Upload to Google Drive failed.');
          }
        } finally {
          setBusy(false);
          setProgress(null);
        }
      },
    });
  };

  const toggleExportSplit = (sp: SplitType) => {
    setExportSplits((prev) =>
      prev.includes(sp)
        ? prev.length > 1
          ? prev.filter((x) => x !== sp)
          : prev
        : [...prev, sp]
    );
  };

  return (
    <div
      onClick={() => {
        if (!busy && !pendingConfirm) onClose();
      }}
      className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[980px] h-[min(85vh,720px)] bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#232834] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <HardDrive className="w-4 h-4 text-[#38BDF8] shrink-0" />
            <h2 className="text-sm font-semibold text-[#E8ECF2] tracking-tight truncate">
              Google Drive Sync
            </h2>
            {user && !needsAuth && (
              <span className="text-xs text-[#8B95A5] truncate hidden sm:inline">
                · {user.email || user.displayName}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {user && !needsAuth && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSignOut()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-xs text-[#8B95A5] hover:text-white transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              aria-label="Close Google Drive Sync"
              className="p-1 rounded text-[#8B95A5] hover:text-white hover:bg-[#181C24] disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Auth Gate */}
        {needsAuth || !user ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#0B0D10] border border-[#232834] flex items-center justify-center mb-4">
              <HardDrive className="w-6 h-6 text-[#38BDF8]" />
            </div>
            <h3 className="text-base font-semibold text-[#E8ECF2]">
              Connect Google Drive to Reticle
            </h3>
            <p className="text-xs text-[#8B95A5] max-w-md mt-2 leading-relaxed mb-6">
              Sign in with your Google account to browse folders, import image datasets and COCO
              annotations directly from Google Drive, and upload your labeled exports back to Drive.
            </p>
            <GoogleSignInButton onClick={() => void onSignIn()} loading={isLoggingIn} />
            {errorText && (
              <p className="mt-4 text-xs text-[#FCA5A5] max-w-md">{errorText}</p>
            )}
          </div>
        ) : (
          <>
            {/* Mode Tabs + Breadcrumbs */}
            <div className="px-5 border-b border-[#232834] bg-[#0E1117] flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-6">
                {(
                  [
                    { id: 'browse', label: 'Browse & Import', icon: Download },
                    { id: 'upload', label: 'Export & Upload to Drive', icon: Upload },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setTab(item.id);
                        setErrorText(null);
                      }}
                      className={`relative py-3 flex items-center gap-2 text-xs font-medium transition-colors ${
                        active ? 'text-white' : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 ${active ? 'text-[#38BDF8]' : 'text-[#64748B]'}`}
                      />
                      <span>{item.label}</span>
                      {active && (
                        <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#38BDF8]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Breadcrumb path */}
              <div className="flex items-center gap-1 text-xs overflow-x-auto py-1.5">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={crumb.id} className="flex items-center gap-1 shrink-0">
                    {idx > 0 && <ChevronRight className="w-3 h-3 text-[#64748B]" />}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setBreadcrumbs((prev) => prev.slice(0, idx + 1))}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        idx === breadcrumbs.length - 1
                          ? 'text-[#E8ECF2] font-medium'
                          : 'text-[#8B95A5] hover:text-white hover:bg-[#181C24]'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* ==================== TAB 1: BROWSE & IMPORT ==================== */}
            {tab === 'browse' && (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Toolbar */}
                <div className="px-5 py-3 border-b border-[#232834] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search Google Drive files..."
                        className="w-full bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#E8ECF2] placeholder:text-[#64748B] outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-1 p-0.5 bg-[#0B0D10] border border-[#232834] rounded-md">
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: 'images', label: 'Images' },
                          { id: 'json', label: 'JSON' },
                        ] as const
                      ).map((flt) => (
                        <button
                          key={flt.id}
                          type="button"
                          onClick={() => setFileFilter(flt.id)}
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            fileFilter === flt.id
                              ? 'bg-[#181C24] text-white'
                              : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                          }`}
                        >
                          {flt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCreatingFolder((v) => !v)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-xs text-[#CBD5E1] hover:text-white transition-colors"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-[#38BDF8]" />
                      <span>New Folder</span>
                    </button>
                    <button
                      type="button"
                      disabled={loadingFiles || busy}
                      onClick={() => void loadFolder()}
                      title="Refresh folder"
                      aria-label="Refresh folder"
                      className="p-1.5 rounded-md bg-[#0B0D10] hover:bg-[#181C24] border border-[#232834] text-[#8B95A5] hover:text-white transition-colors"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin text-[#38BDF8]' : ''}`}
                      />
                    </button>
                  </div>
                </div>

                {/* Inline New Folder Creator */}
                {creatingFolder && (
                  <div className="px-5 py-2.5 bg-[#0E1117] border-b border-[#232834] flex items-center gap-2 shrink-0">
                    <Folder className="w-4 h-4 text-[#38BDF8] shrink-0" />
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateFolder();
                      }}
                      placeholder={`New folder inside "${currentFolder.name}"...`}
                      className="flex-1 bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded px-2.5 py-1 text-xs text-[#E8ECF2] outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={!newFolderName.trim() || busy}
                      onClick={() => void handleCreateFolder()}
                      className="px-3 py-1 rounded bg-[#38BDF8] hover:bg-[#56C8FA] disabled:opacity-40 text-[#07090C] text-xs font-semibold"
                    >
                      Create Folder
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingFolder(false);
                        setNewFolderName('');
                      }}
                      className="px-2 py-1 text-xs text-[#8B95A5] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* File List */}
                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
                  {loadingFiles ? (
                    <div className="h-full flex items-center justify-center gap-2 text-xs text-[#8B95A5]">
                      <Loader2 className="w-4 h-4 animate-spin text-[#38BDF8]" />
                      <span>Loading Google Drive...</span>
                    </div>
                  ) : files.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-xs text-[#8B95A5]">
                      <p>No files found in "{currentFolder.name}".</p>
                      <p className="text-[11px] text-[#64748B] mt-1">
                        Try clearing the search filter or uploading exports from the Export tab.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#232834]/70 border border-[#232834] rounded-md bg-[#0B0D10]">
                      {files.map((file) => {
                        const isFolder = file.mimeType === DRIVE_FOLDER_MIME;
                        const isImg = isImageMime(file.mimeType);
                        const isJson = isJsonLike(file);
                        const checked = selectedIds.includes(file.id);

                        return (
                          <div
                            key={file.id}
                            className={`px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                              checked ? 'bg-[#38BDF8]/10' : 'hover:bg-[#12151B]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                aria-label={`Select ${file.name}`}
                                onClick={() => toggleSelectFile(file.id)}
                                className={`w-4 h-4 rounded-xs border flex items-center justify-center shrink-0 transition-colors ${
                                  checked
                                    ? 'bg-[#38BDF8] border-[#38BDF8] text-[#07090C]'
                                    : 'bg-[#12151B] border-[#323949] hover:border-[#38BDF8]'
                                }`}
                              >
                                {checked && <Check className="w-3 h-3" strokeWidth={2.75} />}
                              </button>

                              {isFolder ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenFolder(file)}
                                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                                >
                                  <Folder className="w-4 h-4 text-[#38BDF8] shrink-0" />
                                  <span className="text-xs font-medium text-[#E8ECF2] group-hover:text-[#38BDF8] truncate">
                                    {file.name}
                                  </span>
                                </button>
                              ) : (
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  {isImg ? (
                                    file.thumbnailLink ? (
                                      <img
                                        src={file.thumbnailLink}
                                        alt=""
                                        referrerPolicy="no-referrer"
                                        className="w-6 h-6 rounded object-cover bg-[#181C24] shrink-0"
                                      />
                                    ) : (
                                      <ImageIcon className="w-4 h-4 text-[#22C55E] shrink-0" />
                                    )
                                  ) : isJson ? (
                                    <FileJson className="w-4 h-4 text-[#F59E0B] shrink-0" />
                                  ) : (
                                    <FileText className="w-4 h-4 text-[#8B95A5] shrink-0" />
                                  )}
                                  <span className="text-xs text-[#E8ECF2] truncate">
                                    {file.name}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-[11px] font-mono tabular-nums text-[#64748B] hidden sm:inline">
                                {isFolder ? 'Folder' : formatBytes(file.size)}
                              </span>
                              {isJson && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleImportJsonFromDrive(file)}
                                  className="px-2 py-1 rounded bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-[11px] font-medium text-[#38BDF8] transition-colors"
                                >
                                  Import JSON
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Browse Footer Actions */}
                <div className="px-5 py-3 border-t border-[#232834] bg-[#0E1117] flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3">
                    {selectedFiles.length > 0 ? (
                      <>
                        <span className="text-xs font-mono tabular-nums text-[#CBD5E1]">
                          {selectedFiles.length} selected ({selectedImageFiles.length} image
                          {selectedImageFiles.length === 1 ? '' : 's'})
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={requestTrashSelected}
                          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-[#FCA5A5] hover:bg-[#EF4444]/15 border border-[#EF4444]/30 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Move to Trash</span>
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-[#8B95A5]">
                        Select image files to import into "{project.name}", or click a folder to
                        browse.
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={importSplit}
                      onChange={(e) => setImportSplit(e.target.value as SplitType)}
                      aria-label="Target dataset split for imported images"
                      className="bg-[#0B0D10] border border-[#232834] rounded px-2 py-1.5 text-xs font-mono text-[#CBD5E1] outline-none"
                    >
                      <option value="train">Split: train</option>
                      <option value="val">Split: val</option>
                      <option value="test">Split: test</option>
                    </select>
                    <button
                      type="button"
                      disabled={selectedImageFiles.length === 0 || busy}
                      onClick={() => void handleImportSelectedImages()}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] disabled:opacity-40 text-[#07090C] text-xs font-semibold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        Import {selectedImageFiles.length > 0 ? selectedImageFiles.length : ''}{' '}
                        Image{selectedImageFiles.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== TAB 2: EXPORT & UPLOAD ==================== */}
            {tab === 'upload' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
                  <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-[#E8ECF2]">
                        Destination Google Drive Folder
                      </div>
                      <div className="text-xs text-[#8B95A5] mt-0.5 font-mono">
                        {breadcrumbs.map((b) => b.name).join(' / ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('browse')}
                      className="px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs text-[#CBD5E1] transition-colors"
                    >
                      Change Folder
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3">
                      <span className="text-xs font-semibold text-[#E8ECF2] block">
                        Annotation &amp; Metadata Exports
                      </span>
                      {(
                        [
                          {
                            checked: includeCoco,
                            set: setIncludeCoco,
                            name: `${projectSlug}_coco.json`,
                            desc: 'COCO JSON (boxes, polygons, captions)',
                          },
                          {
                            checked: includeJsonl,
                            set: setIncludeJsonl,
                            name: `${projectSlug}_dataset.jsonl`,
                            desc: 'VLM JSONL (captions, tags, splits)',
                          },
                          {
                            checked: includeCsv,
                            set: setIncludeCsv,
                            name: `${projectSlug}_captions.csv`,
                            desc: 'CSV table (captions, tags, counts)',
                          },
                          {
                            checked: includeBackup,
                            set: setIncludeBackup,
                            name: `${projectSlug}_reticle-backup.json`,
                            desc: 'Full Reticle project schema & taxonomy',
                          },
                        ] as const
                      ).map((opt) => (
                        <label
                          key={opt.name}
                          className="flex items-start gap-2.5 text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={opt.checked}
                            onChange={(e) => opt.set(e.target.checked)}
                            className="mt-0.5 accent-[#38BDF8]"
                          />
                          <div>
                            <div className="font-mono text-[#E8ECF2]">{opt.name}</div>
                            <div className="text-[11px] text-[#8B95A5]">{opt.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>

                    <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-4">
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-[#E8ECF2] block">
                          Splits Included
                        </span>
                        <div className="flex items-center gap-2">
                          {(['train', 'val', 'test'] as const).map((sp) => (
                            <button
                              key={sp}
                              type="button"
                              onClick={() => toggleExportSplit(sp)}
                              className={`px-3 py-1 rounded text-xs font-mono uppercase border transition-colors ${
                                exportSplits.includes(sp)
                                  ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                                  : 'bg-[#12151B] border-[#232834] text-[#8B95A5]'
                              }`}
                            >
                              {sp}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-[#232834] space-y-2.5">
                        <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={includeImages}
                            onChange={(e) => setIncludeImages(e.target.checked)}
                            className="mt-0.5 accent-[#38BDF8]"
                          />
                          <div>
                            <div className="font-medium text-[#E8ECF2]">
                              Also upload dataset images ({matchedExportImages.length})
                            </div>
                            <div className="text-[11px] text-[#8B95A5]">
                              Uploads the image files matching the selected splits into the folder.
                            </div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={overwriteExisting}
                            onChange={(e) => setOverwriteExisting(e.target.checked)}
                            className="mt-0.5 accent-[#38BDF8]"
                          />
                          <div>
                            <div className="font-medium text-[#E8ECF2]">
                              Update existing files with matching names
                            </div>
                            <div className="text-[11px] text-[#8B95A5]">
                              Prevents duplicate export copies in Drive (always asks confirmation
                              first).
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Upload Footer */}
                <div className="px-5 py-3 border-t border-[#232834] bg-[#0E1117] flex items-center justify-between gap-3 shrink-0">
                  <span className="text-xs text-[#8B95A5] font-mono tabular-nums">
                    {matchedExportImages.length} dataset image
                    {matchedExportImages.length === 1 ? '' : 's'} in selected splits
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={requestUploadToDrive}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] disabled:opacity-40 text-[#07090C] text-xs font-semibold transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Review &amp; Upload to Drive</span>
                  </button>
                </div>
              </div>
            )}

            {/* Progress / Error Strip */}
            {(progress || errorText) && (
              <div className="px-5 py-2.5 border-t border-[#232834] bg-[#0B0D10] shrink-0">
                {progress ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#E8ECF2] flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                        <span>{progress.label}</span>
                      </span>
                      <span className="font-mono tabular-nums text-[#38BDF8]">
                        {progress.done} / {progress.total}
                      </span>
                    </div>
                    <div className="h-1 bg-[#181C24] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#38BDF8] transition-all"
                        style={{
                          width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-[#FCA5A5]">
                    <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
                    <span>{errorText}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Mandatory Explicit Confirmation Dialog for Mutating / Destructive Drive Operations */}
        {pendingConfirm && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-5 z-20">
            <div className="w-full max-w-md bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#232834] flex items-center gap-2.5">
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 ${
                    pendingConfirm.destructive ? 'text-[#EF4444]' : 'text-[#F59E0B]'
                  }`}
                />
                <h3 className="text-sm font-semibold text-[#E8ECF2]">{pendingConfirm.title}</h3>
              </div>

              <div className="p-5 space-y-3">
                <p className="text-xs text-[#CBD5E1] leading-relaxed">
                  {pendingConfirm.description}
                </p>

                <div className="max-h-40 overflow-y-auto rounded bg-[#0B0D10] border border-[#232834] p-2.5 space-y-1">
                  {pendingConfirm.affectedItems.slice(0, 25).map((item, i) => (
                    <div key={`${item}-${i}`} className="text-[11px] font-mono text-[#94A3B8] truncate">
                      • {item}
                    </div>
                  ))}
                  {pendingConfirm.affectedItems.length > 25 && (
                    <div className="text-[11px] font-mono text-[#64748B]">
                      ...and {pendingConfirm.affectedItems.length - 25} more item(s)
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-[#232834] bg-[#0E1117] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="px-3.5 py-1.5 rounded-md text-xs font-medium text-[#8B95A5] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const run = pendingConfirm.onConfirm;
                    setPendingConfirm(null);
                    void run();
                  }}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    pendingConfirm.destructive
                      ? 'bg-[#EF4444] hover:bg-[#F87171] text-white'
                      : 'bg-[#38BDF8] hover:bg-[#56C8FA] text-[#07090C]'
                  }`}
                >
                  {pendingConfirm.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
