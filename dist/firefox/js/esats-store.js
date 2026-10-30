import { ESATS_APPLICATION_STORE, ESATS_MVO_STORE, ESATS_SYNC_STORE, openDatabase } from './db-schema.js';

const SYNC_KEY = 'daily-sync';

export async function loadEsatsSnapshot() {
  const db = await openDatabase();
  try {
    const tx = db.transaction([ESATS_APPLICATION_STORE, ESATS_MVO_STORE, ESATS_SYNC_STORE], 'readonly');
    const [applications, mvos, metadata] = await Promise.all([
      requestResult(tx.objectStore(ESATS_APPLICATION_STORE).getAll()),
      requestResult(tx.objectStore(ESATS_MVO_STORE).getAll()),
      requestResult(tx.objectStore(ESATS_SYNC_STORE).get(SYNC_KEY)),
    ]);
    await transactionComplete(tx);
    return { applications, mvos, metadata: metadata ?? null };
  } finally {
    db.close();
  }
}

export async function saveEsatsSnapshot({ applications, mvos, metadata }) {
  const db = await openDatabase();
  try {
    const tx = db.transaction([ESATS_APPLICATION_STORE, ESATS_MVO_STORE, ESATS_SYNC_STORE], 'readwrite');
    const applicationStore = tx.objectStore(ESATS_APPLICATION_STORE);
    const mvoStore = tx.objectStore(ESATS_MVO_STORE);
    applicationStore.clear();
    mvoStore.clear();
    for (const application of applications) applicationStore.put(application);
    for (const mvo of mvos) mvoStore.put(mvo);
    tx.objectStore(ESATS_SYNC_STORE).put({ id: SYNC_KEY, ...metadata });
    await transactionComplete(tx);
  } finally {
    db.close();
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}
