// Encryption for the vault.
//
// A passphrase is stretched with scrypt into 64 bytes:
//   - bytes 0..31  -> encryption key (XChaCha20-Poly1305)
//   - bytes 32..63 -> id key (HMAC-SHA256, used to name files without revealing anything)
//
// Every encrypted file ("sealed blob") has this layout:
//   "PVLT" | version (1 byte) | nonce (24 bytes) | ciphertext + 16-byte tag
// The plaintext inside is:
//   meta length (4 bytes, big endian) | meta JSON (utf8) | raw file bytes
// so the original filename, capture time and type are encrypted too.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hmac } from '@noble/hashes/hmac.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { bytesToHex, bytesToUtf8, concatBytes, utf8ToBytes } from './bytes';

const MAGIC = utf8ToBytes('PVLT');
const VERSION = 1;
const HEADER = concatBytes(MAGIC, new Uint8Array([VERSION]));
const NONCE_LENGTH = 24;

export type RandomSource = (length: number) => Uint8Array;

let randomSource: RandomSource = (length) => {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
};

// React Native has no WebCrypto by default; the app plugs in expo-crypto here.
export function setRandomSource(source: RandomSource) {
  randomSource = source;
}

export function randomBytes(length: number): Uint8Array {
  return randomSource(length);
}

export type KdfParams = { name: 'scrypt'; N: number; r: number; p: number };

export const DEFAULT_KDF: KdfParams = { name: 'scrypt', N: 2 ** 15, r: 8, p: 1 };

export type VaultKeys = { encKey: Uint8Array; idKey: Uint8Array };

export async function deriveKeys(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF,
  onProgress?: (fraction: number) => void,
): Promise<VaultKeys> {
  const raw = await scryptAsync(utf8ToBytes(passphrase.normalize('NFKC')), salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: 64,
    onProgress,
  });
  return keysFromBytes(raw);
}

export function keysToBytes(keys: VaultKeys): Uint8Array {
  return concatBytes(keys.encKey, keys.idKey);
}

export function keysFromBytes(raw: Uint8Array): VaultKeys {
  if (raw.length !== 64) throw new Error('Vault key must be 64 bytes');
  return { encKey: raw.slice(0, 32), idKey: raw.slice(32, 64) };
}

export type PhotoMeta = {
  name: string;
  mime: string;
  takenAt: number | null;
  width?: number;
  height?: number;
};

export function seal(encKey: Uint8Array, meta: object, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const metaBytes = utf8ToBytes(JSON.stringify(meta));
  const metaLength = new Uint8Array(4);
  new DataView(metaLength.buffer).setUint32(0, metaBytes.length);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = xchacha20poly1305(encKey, nonce, HEADER);
  const ciphertext = cipher.encrypt(concatBytes(metaLength, metaBytes, data));
  return concatBytes(HEADER, nonce, ciphertext);
}

export class DecryptError extends Error {}

export function open<M = PhotoMeta>(encKey: Uint8Array, sealed: Uint8Array): { meta: M; data: Uint8Array } {
  if (sealed.length < HEADER.length + NONCE_LENGTH + 16) throw new DecryptError('File is too short');
  for (let i = 0; i < MAGIC.length; i++) {
    if (sealed[i] !== MAGIC[i]) throw new DecryptError('Not a Photo Vault file');
  }
  if (sealed[MAGIC.length] !== VERSION) throw new DecryptError(`Unsupported file version ${sealed[MAGIC.length]}`);
  const nonce = sealed.subarray(HEADER.length, HEADER.length + NONCE_LENGTH);
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(encKey, nonce, HEADER).decrypt(sealed.subarray(HEADER.length + NONCE_LENGTH));
  } catch {
    throw new DecryptError('Wrong passphrase or corrupted file');
  }
  const metaLength = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(bytesToUtf8(plain.subarray(4, 4 + metaLength))) as M;
  return { meta, data: plain.subarray(4 + metaLength) };
}

// Stable, opaque id for a photo. The same photo always maps to the same id
// (so re-installs and multiple phones don't upload duplicates), but the id
// reveals nothing to someone without the passphrase.
export function photoId(idKey: Uint8Array, fingerprint: string): string {
  return bytesToHex(hmac(sha256, idKey, utf8ToBytes(fingerprint))).slice(0, 32);
}
