export const DB_NAME = 'aca-compliance-dashboard';
export const DB_VERSION = 2;
export const CONFIG_STORE = 'configurations';
export const ESATS_APPLICATION_STORE = 'esats-applications';
export const ESATS_MVO_STORE = 'esats-mvos';
export const ESATS_SYNC_STORE = 'esats-sync';

export function upgradeDatabase(db) {
  if (!db.objectStoreNames.contains(CONFIG_STORE)) db.createObjectStore(CONFIG_STORE, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(ESATS_APPLICATION_STORE)) {
    const applications = db.createObjectStore(ESATS_APPLICATION_STORE, { keyPath: 'esatsId' });
    applications.createIndex('mvoId', 'mvoId', { unique: false });
    applications.createIndex('mvoName', 'mvoName', { unique: false });
    applications.createIndex('lifecyclePhase', 'lifecyclePhase', { unique: false });
    applications.createIndex('isRetired', 'isRetired', { unique: false });
    applications.createIndex('isMarkedForDeletion', 'isMarkedForDeletion', { unique: false });
    applications.createIndex('lifecycleChangeTimestamp', 'lifecycleChangeTimestamp', { unique: false });
  }
  if (!db.objectStoreNames.contains(ESATS_MVO_STORE)) db.createObjectStore(ESATS_MVO_STORE, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(ESATS_SYNC_STORE)) db.createObjectStore(ESATS_SYNC_STORE, { keyPath: 'id' });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => upgradeDatabase(request.result);
    request.onsuccess = () => resolve(request.result);
  });
}
