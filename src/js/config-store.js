import { cloneDefaultConfig } from './default-config.js';
import { CONFIG_STORE as STORE, openDatabase } from './db-schema.js';

const ACTIVE_KEY = 'active-supported-rules';
const ESATS_KEY = 'esats-supported-rules';

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

export async function loadEsatsConfig() {
  const existing = await transact('readonly', (store) => store.get(ESATS_KEY));
  if (existing?.value) return validateConfig(existing.value);
  const complianceConfig = await loadConfig();
  return saveEsatsConfig(complianceConfig);
}

export async function saveEsatsConfig(input) {
  const value = validateConfig(input);
  value.updatedAt = new Date().toISOString();
  await transact('readwrite', (store) => store.put({ id: ESATS_KEY, value }));
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
    asaExceptions: [],
    excludeBlankAsaFromScmp: Boolean(input.excludeBlankAsaFromScmp ?? input.excludeBlankAsa),
    applicationExceptions: cleanStringArray(input.applicationExceptions),
  };
  if (input.updatedAt && !Number.isNaN(Date.parse(input.updatedAt))) config.updatedAt = new Date(input.updatedAt).toISOString();
  if (!/^\d{4,12}$/.test(config.bemsId)) throw new Error('BEMS ID must contain 4 to 12 digits.');
  if (!config.includedOrganizations.length) throw new Error('At least one maintenance organization is required.');
  for (const [organization, applications] of Object.entries(input.restrictedOrganizations ?? {})) {
    const key = cleanString(organization);
    const values = cleanStringArray(applications);
    if (key && values.length) config.restrictedOrganizations[key] = values;
  }
  if (!Array.isArray(input.managerExceptions)) throw new Error('Manager exceptions must be an array.');
  for (const rule of input.managerExceptions) {
    const manager = cleanString(typeof rule === 'string' ? rule : rule?.manager);
    if (manager && !config.managerExceptions.includes(manager)) config.managerExceptions.push(manager);
  }
  if (input.asaExceptions != null && !Array.isArray(input.asaExceptions)) throw new Error('ASA exceptions must be an array.');
  for (const rule of input.asaExceptions ?? []) {
    const asa = cleanString(typeof rule === 'string' ? rule : rule?.asa);
    if (asa && !config.asaExceptions.includes(asa)) config.asaExceptions.push(asa);
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
