// What the phone remembers between launches.
// Secrets (GitHub token, vault keys) live in the OS keychain/keystore via
// SecureStore; harmless sync status lives in a plain file.

import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { base64ToBytes, bytesToBase64 } from '../core/bytes';
import { VaultKeys, keysFromBytes, keysToBytes } from '../core/crypto';

export type Connection = { token: string; owner: string; repo: string; branch: string };

export type Prefs = {
  autoBackup: boolean;
  wifiOnly: boolean;
  // Only photos taken at or after this time (ms) are backed up. 0 = everything.
  backupFrom: number;
};

export type SyncStatus = {
  lastRunAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  uploaded?: number;
  pending?: number;
};

const CONNECTION_KEY = 'pv.connection';
const KEYS_KEY = 'pv.keys';
const PREFS_KEY = 'pv.prefs';

// Background tasks may run while the phone is locked.
const secureOptions: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const DEFAULT_PREFS: Prefs = { autoBackup: true, wifiOnly: true, backupFrom: 0 };

export type StoredSession = { connection: Connection; keys: VaultKeys; prefs: Prefs };

export async function loadStoredSession(): Promise<StoredSession | null> {
  const [connection, keys, prefs] = await Promise.all([
    SecureStore.getItemAsync(CONNECTION_KEY, secureOptions),
    SecureStore.getItemAsync(KEYS_KEY, secureOptions),
    SecureStore.getItemAsync(PREFS_KEY, secureOptions),
  ]);
  if (!connection || !keys) return null;
  return {
    connection: JSON.parse(connection),
    keys: keysFromBytes(base64ToBytes(keys)),
    prefs: { ...DEFAULT_PREFS, ...(prefs ? JSON.parse(prefs) : {}) },
  };
}

export async function saveSession(session: StoredSession) {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(session.connection), secureOptions);
  await SecureStore.setItemAsync(KEYS_KEY, bytesToBase64(keysToBytes(session.keys)), secureOptions);
  await savePrefs(session.prefs);
}

export async function savePrefs(prefs: Prefs) {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs), secureOptions);
}

export async function clearSession() {
  await Promise.all([CONNECTION_KEY, KEYS_KEY, PREFS_KEY].map((k) => SecureStore.deleteItemAsync(k, secureOptions)));
  writeSyncStatus({});
}

const statusFile = () => new File(Paths.document, 'sync-status.json');

export function readSyncStatus(): SyncStatus {
  try {
    const file = statusFile();
    return file.exists ? JSON.parse(file.textSync()) : {};
  } catch {
    return {};
  }
}

export function writeSyncStatus(status: SyncStatus) {
  const file = statusFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(status));
}
