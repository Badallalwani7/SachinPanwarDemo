// The vault: how photos are laid out in the repository and how a phone
// creates or unlocks it.
//
// Repository layout:
//   vault.json                                   public KDF params + a check value
//   photos/2026/10/20261013T141805Z_<id>.pv      encrypted original photo
//   thumbs/2026/10/20261013T141805Z_<id>.pv      encrypted small JPEG for the gallery
//
// The folder and filename reveal roughly when a photo was taken (so the
// gallery can sort without decrypting everything). Everything else, including
// the picture, original filename and exact metadata, is encrypted.

import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from './bytes';
import {
  DEFAULT_KDF,
  DecryptError,
  KdfParams,
  VaultKeys,
  deriveKeys,
  open,
  randomBytes,
  seal,
} from './crypto';
import { GitHub } from './github';

export const VAULT_FILE = 'vault.json';
export const PHOTOS_DIR = 'photos';
export const THUMBS_DIR = 'thumbs';

type VaultFile = {
  format: 'photo-vault';
  version: 1;
  kdf: KdfParams & { salt: string };
  check: string;
  createdAt: string;
};

const CHECK_TEXT = 'photo-vault-check';

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase for this vault');
  }
}

export type OpenVaultResult = { keys: VaultKeys; created: boolean };

// Unlocks the vault in the repository, or creates it if the repository has none.
export async function openOrCreateVault(
  github: GitHub,
  passphrase: string,
  options: { allowCreate: boolean; kdf?: KdfParams; onProgress?: (fraction: number) => void },
): Promise<OpenVaultResult> {
  const existing = await github.getFile(VAULT_FILE);
  if (existing) {
    const vault = JSON.parse(bytesToUtf8(base64ToBytes(existing.base64))) as VaultFile;
    if (vault.format !== 'photo-vault') throw new Error(`${VAULT_FILE} in this repository is not a Photo Vault`);
    const { salt, ...kdf } = vault.kdf;
    const keys = await deriveKeys(passphrase, base64ToBytes(salt), kdf, options.onProgress);
    try {
      open(keys.encKey, base64ToBytes(vault.check));
    } catch (e) {
      if (e instanceof DecryptError) throw new WrongPassphraseError();
      throw e;
    }
    return { keys, created: false };
  }

  if (!options.allowCreate) throw new Error('No vault found in this repository');
  const kdf = options.kdf ?? DEFAULT_KDF;
  const salt = randomBytes(16);
  const keys = await deriveKeys(passphrase, salt, kdf, options.onProgress);
  const vault: VaultFile = {
    format: 'photo-vault',
    version: 1,
    kdf: { ...kdf, salt: bytesToBase64(salt) },
    check: bytesToBase64(seal(keys.encKey, { check: CHECK_TEXT })),
    createdAt: new Date().toISOString(),
  };
  await github.putFile(VAULT_FILE, bytesToBase64(utf8ToBytes(JSON.stringify(vault, null, 2) + '\n')), 'Create photo vault');
  return { keys, created: true };
}

function stamp(takenAt: number | null) {
  if (takenAt === null) return { folder: 'undated', prefix: '00000000T000000Z' };
  const iso = new Date(takenAt).toISOString(); // 2026-10-13T14:18:05.123Z
  const prefix = iso.slice(0, 19).replace(/[-:]/g, '') + 'Z';
  return { folder: `${iso.slice(0, 4)}/${iso.slice(5, 7)}`, prefix };
}

export function photoPaths(id: string, takenAt: number | null) {
  const { folder, prefix } = stamp(takenAt);
  const name = `${folder}/${prefix}_${id}.pv`;
  return { photo: `${PHOTOS_DIR}/${name}`, thumb: `${THUMBS_DIR}/${name}` };
}

const NAME_PATTERN = /(?:^|\/)(\d{8}T\d{6}Z)_([0-9a-f]+)\.pv$/;

export function parsePhotoPath(path: string): { id: string; sortKey: string } | null {
  const match = NAME_PATTERN.exec(path);
  return match ? { sortKey: match[1], id: match[2] } : null;
}

export function thumbToPhotoPath(thumbPath: string) {
  return PHOTOS_DIR + thumbPath.slice(THUMBS_DIR.length);
}
