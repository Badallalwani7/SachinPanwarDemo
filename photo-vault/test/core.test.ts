import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64, utf8ToBytes } from '../src/core/bytes';
import { DecryptError, KdfParams, keysFromBytes, keysToBytes, open, photoId, seal } from '../src/core/crypto';
import { createFakeGitHub } from './fakeGitHub';
import { GitHub } from '../src/core/github';
import { WrongPassphraseError, openOrCreateVault, parsePhotoPath, photoPaths, thumbToPhotoPath } from '../src/core/vault';

// Cheap KDF so tests run fast; the app uses DEFAULT_KDF.
const FAST_KDF: KdfParams = { name: 'scrypt', N: 1024, r: 8, p: 1 };

const key = new Uint8Array(32).fill(7);

describe('bytes', () => {
  it('round-trips base64 for large binary data', () => {
    const data = new Uint8Array(200_001).map((_, i) => (i * 31) & 0xff);
    const encoded = bytesToBase64(data);
    expect(encoded).toBe(Buffer.from(data).toString('base64'));
    expect(base64ToBytes(encoded)).toEqual(data);
  });
});

describe('crypto', () => {
  it('seals and opens a photo with its metadata', () => {
    const photo = new Uint8Array(5000).map((_, i) => i & 0xff);
    const meta = { name: 'IMG_0001.JPG', mime: 'image/jpeg', takenAt: 1760364000000 };
    const sealed = seal(key, meta, photo);
    expect(Buffer.from(sealed).includes(Buffer.from('IMG_0001'))).toBe(false);
    const result = open(key, sealed);
    expect(result.meta).toEqual(meta);
    expect(result.data).toEqual(photo);
  });

  it('uses a fresh nonce every time', () => {
    expect(seal(key, {}, utf8ToBytes('same'))).not.toEqual(seal(key, {}, utf8ToBytes('same')));
  });

  it('rejects the wrong key and tampered files', () => {
    const sealed = seal(key, { name: 'a' }, utf8ToBytes('hello'));
    expect(() => open(new Uint8Array(32).fill(8), sealed)).toThrow(DecryptError);
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(() => open(key, tampered)).toThrow(DecryptError);
    expect(() => open(key, utf8ToBytes('not a vault file at all, definitely not'))).toThrow(DecryptError);
  });

  it('derives stable, opaque photo ids', () => {
    const idKey = new Uint8Array(32).fill(1);
    const id = photoId(idKey, '1760364000000|IMG_0001.JPG|4032x3024');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(photoId(idKey, '1760364000000|IMG_0001.JPG|4032x3024')).toBe(id);
    expect(photoId(new Uint8Array(32).fill(2), '1760364000000|IMG_0001.JPG|4032x3024')).not.toBe(id);
  });

  it('serialises keys for secure storage', () => {
    const keys = keysFromBytes(new Uint8Array(64).map((_, i) => i));
    expect(keysFromBytes(keysToBytes(keys))).toEqual(keys);
  });
});

describe('paths', () => {
  it('builds sortable paths and parses them back', () => {
    const paths = photoPaths('abc123', Date.UTC(2026, 9, 13, 14, 18, 5));
    expect(paths.photo).toBe('photos/2026/10/20261013T141805Z_abc123.pv');
    expect(paths.thumb).toBe('thumbs/2026/10/20261013T141805Z_abc123.pv');
    expect(thumbToPhotoPath(paths.thumb)).toBe(paths.photo);
    expect(parsePhotoPath(paths.thumb)).toEqual({ id: 'abc123', sortKey: '20261013T141805Z' });
    expect(photoPaths('abc123', null).photo).toBe('photos/undated/00000000T000000Z_abc123.pv');
  });
});

describe('vault on GitHub', () => {
  const client = (fake: ReturnType<typeof createFakeGitHub>) =>
    new GitHub({ token: 't', owner: 'me', repo: 'vault', fetch: fake.fetch, sleep: async () => {} });

  it('creates a vault in an empty repo, then a second phone unlocks it', async () => {
    const fake = createFakeGitHub();
    const created = await openOrCreateVault(client(fake), 'correct horse', { allowCreate: true, kdf: FAST_KDF });
    expect(created.created).toBe(true);

    const unlocked = await openOrCreateVault(client(fake), 'correct horse', { allowCreate: false });
    expect(unlocked.created).toBe(false);
    expect(unlocked.keys).toEqual(created.keys);

    await expect(openOrCreateVault(client(fake), 'wrong', { allowCreate: false })).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('uploads a batch in one commit and reads it back', async () => {
    const fake = createFakeGitHub();
    const github = client(fake);
    const { keys } = await openOrCreateVault(github, 'pw', { allowCreate: true, kdf: FAST_KDF });

    const files = [1, 2, 3].flatMap((n) => {
      const paths = photoPaths(`id${n}`, Date.UTC(2026, 0, n));
      const meta = { name: `IMG_${n}.JPG`, mime: 'image/jpeg', takenAt: Date.UTC(2026, 0, n) };
      return [
        { path: paths.photo, base64: bytesToBase64(seal(keys.encKey, meta, utf8ToBytes(`full ${n}`))) },
        { path: paths.thumb, base64: bytesToBase64(seal(keys.encKey, meta, utf8ToBytes(`thumb ${n}`))) },
      ];
    });
    const commitsBefore = fake.commitCount();
    await github.commitFiles(files, 'Back up 3 photos');
    expect(fake.commitCount()).toBe(commitsBefore + 1);

    const thumbs = await github.listTree('thumbs');
    expect(thumbs.map((t) => t.path).sort()).toEqual(files.filter((f) => f.path.startsWith('thumbs')).map((f) => f.path).sort());

    const thumb = open(keys.encKey, await github.getBlobBytes(thumbs[0].sha));
    expect(new TextDecoder().decode(thumb.data)).toMatch(/^thumb \d$/);

    const full = open(keys.encKey, await github.getFileBytes(thumbToPhotoPath(thumbs[0].path)));
    expect(new TextDecoder().decode(full.data)).toMatch(/^full \d$/);
    expect(full.meta.name).toMatch(/^IMG_\d\.JPG$/);
  });

  it('retries the commit when another phone pushed in between', async () => {
    const fake = createFakeGitHub();
    const github = client(fake);
    await openOrCreateVault(github, 'pw', { allowCreate: true, kdf: FAST_KDF });
    fake.onNextRefUpdate(() => fake.externalPush('photos/2026/01/other.pv', 'from another phone'));

    await github.commitFiles([{ path: 'photos/2026/01/mine.pv', base64: bytesToBase64(utf8ToBytes('mine')) }], 'mine');

    const names = (await github.listTree('photos')).map((e) => e.path).sort();
    expect(names).toEqual(['photos/2026/01/mine.pv', 'photos/2026/01/other.pv']);
    expect(fake.calls.filter((c) => c.startsWith('PATCH')).length).toBe(2);
  });

  it('lists nothing for an empty repository', async () => {
    expect(await client(createFakeGitHub()).listTree('thumbs')).toEqual([]);
  });
});
