import type { DatasetImage, Project } from '../types/annotation';

const DB_NAME = 'reticle_ml_studio_v1';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_IMAGES = 'images';
const STORE_BLOBS = 'imageBlobs';

interface ImageBlobRecord {
  imageId: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        const imgStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        imgStore.createIndex('by_project', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'imageId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request error'));
  });
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_PROJECTS, 'readonly');
  const rows = await reqDone<Project[]>(tx.objectStore(STORE_PROJECTS).getAll());
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  tx.objectStore(STORE_PROJECTS).put(project);
  await txDone(tx);
}

export async function deleteProjectCascade(projectId: string): Promise<void> {
  const images = await getProjectImages(projectId);
  const db = await openDB();
  const tx = db.transaction([STORE_PROJECTS, STORE_IMAGES, STORE_BLOBS], 'readwrite');
  tx.objectStore(STORE_PROJECTS).delete(projectId);
  const imgStore = tx.objectStore(STORE_IMAGES);
  const blobStore = tx.objectStore(STORE_BLOBS);
  for (const img of images) {
    imgStore.delete(img.id);
    blobStore.delete(img.id);
  }
  await txDone(tx);
}

export async function getProjectImages(projectId: string): Promise<DatasetImage[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_IMAGES, 'readonly');
  const index = tx.objectStore(STORE_IMAGES).index('by_project');
  const rows = await reqDone<DatasetImage[]>(index.getAll(projectId));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveDatasetImage(image: DatasetImage): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_IMAGES, 'readwrite');
  tx.objectStore(STORE_IMAGES).put(image);
  await txDone(tx);
}

export async function saveDatasetImagesBulk(images: DatasetImage[]): Promise<void> {
  if (images.length === 0) return;
  const db = await openDB();
  const tx = db.transaction(STORE_IMAGES, 'readwrite');
  const store = tx.objectStore(STORE_IMAGES);
  for (const img of images) {
    store.put(img);
  }
  await txDone(tx);
}

export async function deleteDatasetImage(imageId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_IMAGES, STORE_BLOBS], 'readwrite');
  tx.objectStore(STORE_IMAGES).delete(imageId);
  tx.objectStore(STORE_BLOBS).delete(imageId);
  await txDone(tx);
}

export async function saveImageBlob(imageId: string, blob: Blob): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  const record: ImageBlobRecord = { imageId, blob };
  tx.objectStore(STORE_BLOBS).put(record);
  await txDone(tx);
}

export async function getImageBlob(imageId: string): Promise<Blob | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  const record = await reqDone<ImageBlobRecord | undefined>(
    tx.objectStore(STORE_BLOBS).get(imageId)
  );
  return record?.blob ?? null;
}
