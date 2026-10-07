import { validateDocument } from './core.ts';
import type { Document, Revision, SavedDocument } from './core.ts';

export class SaveConflict extends Error {}
export interface WorkspaceStore {
  get(revision?: number): Promise<SavedDocument | null>;
  history(): Promise<Revision[]>;
  save(document: Document, expectedRevision: number): Promise<SavedDocument>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 409) throw new SaveConflict(result.error);
    throw new Error(result.error || 'The local server could not complete this request.');
  }
  return result;
}

export function apiStore(): WorkspaceStore {
  return {
    get: (revision) => request(revision ? `/api/revisions/${revision}` : '/api/document'),
    history: () => request('/api/revisions'),
    save: (document, expectedRevision) =>
      request('/api/document', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, expectedRevision }),
      }),
  };
}

export async function browserStore(): Promise<WorkspaceStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cuework-workspace', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('revisions', { keyPath: 'revision' });
    request.onerror = () =>
      reject(
        new Error('Browser storage is unavailable. Enable site storage or run the local server.'),
      );
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () =>
      reject(new Error('Close other Cuework tabs to finish opening browser storage.'));
  });
  function read(revision?: number): Promise<SavedDocument | null> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('revisions', 'readonly');
      const store = transaction.objectStore('revisions');
      let value: SavedDocument | null = null;
      if (revision) {
        const request = store.get(revision);
        request.onsuccess = () => {
          value = request.result || null;
        };
      } else {
        const request = store.openCursor(null, 'prev');
        request.onsuccess = () => {
          value = request.result?.value || null;
        };
      }
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(new Error('Could not read the saved workspace.'));
    });
  }
  return {
    get: read,
    history: () =>
      new Promise((resolve, reject) => {
        const result: Revision[] = [];
        const transaction = db.transaction('revisions', 'readonly');
        const request = transaction.objectStore('revisions').openCursor(null, 'prev');
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || result.length >= 50) return;
          const value = cursor.value as SavedDocument;
          result.push({
            revision: value.revision,
            name: value.name,
            savedAt: value.savedAt,
            cueCount: value.cues.length,
          });
          cursor.continue();
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(new Error('Could not load revision history.'));
      }),
    save: (document, expectedRevision) =>
      new Promise((resolve, reject) => {
        validateDocument(document);
        // IndexedDB serializes readwrite transactions across tabs: compare + insert is atomic.
        const transaction = db.transaction('revisions', 'readwrite');
        const store = transaction.objectStore('revisions');
        const request = store.openCursor(null, 'prev');
        let saved: SavedDocument;
        let conflict = false;
        request.onsuccess = () => {
          const current = request.result?.value?.revision || 0;
          if (current !== expectedRevision) {
            conflict = true;
            transaction.abort();
            return;
          }
          saved = {
            name: document.name.trim(),
            cues: structuredClone(document.cues),
            revision: current + 1,
            savedAt: new Date().toISOString(),
          };
          store.add(saved);
        };
        transaction.oncomplete = () => resolve(saved);
        transaction.onabort = () =>
          reject(
            conflict
              ? new SaveConflict(
                  'A newer version was saved in another tab. Reload the saved version before saving again.',
                )
              : new Error(
                  'Could not save. Browser storage may be full; export your subtitles to keep a copy.',
                ),
          );
        transaction.onerror = () => {}; // onabort reports one actionable error
      }),
  };
}
