import { cloneDefaultConfig } from './default-config.js';

const DB_NAME = 'aca-compliance-dashboard';
const DB_VERSION = 1;
const STORE = 'configurations';
const ACTIVE_KEY = 'active-supported-rules';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function transact(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = operation(store);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadConfig() {
  const existing = await transact('readonly', (store) => store.get(ACTIVE_KEY));
  if (existing?.value) return validateConfig(existing.value);
  const config = cloneDefaultConfig();
  await saveConfig(config);
  return config;
}

export async function saveConfig(input) {
  const value = validateConfig(input);
  value.updatedAt = new Date().toISOString();
  await transact('readwrite', (store) => store.put({ id: ACTIVE_KEY, value }));
  return value;
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be a JSON object.');
  if (Number(input.schemaVersion) !== 1) throw new Error('Unsupported configuration schema version.');
  const config = {
    schemaVersion: 1,
    bemsId: String(input.bemsId || '1600103').trim(),
    includedOrganizations: cleanStringArray(input.includedOrganizations),
    restrictedOrganizations: {},
    managerExceptions: [],
    applicationExceptions: cleanStringArray(input.applicationExceptions),
  };
  if (!/^\d{4,12}$/.test(config.bemsId)) throw new Error('BEMS ID must contain 4 to 12 digits.');
  if (!config.includedOrganizations.length) throw new Error('At least one maintenance organization is required.');
  for (const [organization, applications] of Object.entries(input.restrictedOrganizations ?? {})) {
    const key = cleanString(organization);
    const values = cleanStringArray(applications);
    if (key && values.length) config.restrictedOrganizations[key] = values;
  }
  if (!Array.isArray(input.managerExceptions)) throw new Error('Manager exceptions must be an array.');
  for (const rule of input.managerExceptions) {
    const organization = cleanString(rule?.organization);
    const manager = cleanString(rule?.manager);
    if (organization && manager) config.managerExceptions.push({ organization, manager });
  }
  return config;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter(Boolean))];
}

function cleanString(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}
