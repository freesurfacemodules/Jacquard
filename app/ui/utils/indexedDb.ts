import type { PatchDocument } from "@graph/persistence";

const DB_NAME = "maxwasm";
const STORE_NAME = "patches";
const AUTOSAVE_KEY = "autosave";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export async function saveAutosavePatch(document: PatchDocument): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      const store = transaction.objectStore(STORE_NAME);
      store.put(document, AUTOSAVE_KEY);
    });
  } finally {
    db.close();
  }
}

export async function loadAutosavePatch(): Promise<PatchDocument | null> {
  const db = await openDatabase();
  try {
    return await new Promise<PatchDocument | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(AUTOSAVE_KEY);
      request.onsuccess = () => {
        resolve((request.result as PatchDocument | undefined) ?? null);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to read from IndexedDB"));
      };
    });
  } finally {
    db.close();
  }
}

export async function clearAutosavePatch(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      const store = transaction.objectStore(STORE_NAME);
      store.delete(AUTOSAVE_KEY);
    });
  } finally {
    db.close();
  }
}
