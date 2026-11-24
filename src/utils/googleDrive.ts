import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
] as const;

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// In-memory access token cache ONLY (never stored in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export class DriveAuthExpiredError extends Error {
  constructor(message = 'Your Google Drive session expired. Please sign in with Google again.') {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive access token from sign-in.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const clearCachedAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// ---------------- Google Drive API v3 Client ----------------

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  parents?: string[];
}

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new DriveAuthExpiredError();
  return token;
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await requireToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new DriveAuthExpiredError();
  }
  return res;
}

function escapeDriveQuery(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function listDriveFiles(options: {
  folderId: string;
  search?: string;
  filter?: 'all' | 'images' | 'json';
  pageSize?: number;
}): Promise<DriveFileItem[]> {
  const { folderId, search = '', filter = 'all', pageSize = 80 } = options;
  const clauses: string[] = ['trashed = false'];

  const trimmedSearch = search.trim();
  if (trimmedSearch) {
    clauses.push(`name contains '${escapeDriveQuery(trimmedSearch)}'`);
  } else {
    clauses.push(`'${escapeDriveQuery(folderId)}' in parents`);
  }

  if (filter === 'images') {
    clauses.push(`(mimeType = '${DRIVE_FOLDER_MIME}' or mimeType contains 'image/')`);
  } else if (filter === 'json') {
    clauses.push(
      `(mimeType = '${DRIVE_FOLDER_MIME}' or mimeType = 'application/json' or name contains '.json' or name contains '.jsonl' or name contains '.csv')`
    );
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents)',
    orderBy: 'folder,modifiedTime desc',
    pageSize: String(pageSize),
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive list failed (${res.status}): ${errText.slice(0, 180)}`);
  }
  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files ?? [];
}

export async function downloadDriveFileBlob(fileId: string): Promise<Blob> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
  );
  if (!res.ok) {
    throw new Error(`Failed to download Drive file (${res.status}).`);
  }
  return res.blob();
}

export async function downloadDriveTextFile(fileId: string): Promise<string> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
  );
  if (!res.ok) {
    throw new Error(`Failed to read Drive file (${res.status}).`);
  }
  return res.text();
}

export async function createDriveFolder(
  name: string,
  parentId = 'root'
): Promise<DriveFileItem> {
  const res = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        mimeType: DRIVE_FOLDER_MIME,
        parents: [parentId],
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create Drive folder (${res.status}): ${errText.slice(0, 160)}`);
  }
  return (await res.json()) as DriveFileItem;
}

export async function uploadDriveFile(params: {
  name: string;
  mimeType: string;
  content: Blob | string;
  parentId: string;
  existingFileId?: string;
}): Promise<DriveFileItem> {
  const { name, mimeType, content, parentId, existingFileId } = params;
  const blob =
    typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;

  const metadata = existingFileId
    ? { name, mimeType }
    : { name, mimeType, parents: [parentId] };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob, name);

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,mimeType,webViewLink&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink&supportsAllDrives=true';

  const res = await driveFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive upload failed for "${name}" (${res.status}): ${errText.slice(0, 160)}`);
  }
  return (await res.json()) as DriveFileItem;
}

export async function trashDriveFile(fileId: string): Promise<void> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to move file to Trash (${res.status}): ${errText.slice(0, 160)}`);
  }
}
