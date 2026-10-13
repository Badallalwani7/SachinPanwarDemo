// Fetches and decrypts photos from the vault for the gallery.
// Decrypted copies are cached in the app's private cache folder so scrolling
// doesn't re-download everything; "Clear cache" in Settings removes them.

import { Directory, File, Paths } from 'expo-file-system';

import { PhotoMeta, VaultKeys, open } from '../core/crypto';
import { GitHub } from '../core/github';
import { THUMBS_DIR, parsePhotoPath, thumbToPhotoPath } from '../core/vault';

export type GalleryItem = { id: string; sortKey: string; thumbSha: string; photoPath: string };

export async function listGallery(github: GitHub): Promise<GalleryItem[]> {
  const items: GalleryItem[] = [];
  for (const entry of await github.listTree(THUMBS_DIR)) {
    const parsed = parsePhotoPath(entry.path);
    if (parsed) items.push({ ...parsed, thumbSha: entry.sha, photoPath: thumbToPhotoPath(entry.path) });
  }
  return items.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}

function cacheDir(name: string) {
  const dir = new Directory(Paths.cache, name);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

// Only a few downloads at a time, so a fast scroll doesn't hit GitHub's
// rate limits or flood the network.
const MAX_CONCURRENT = 6;
let active = 0;
const queue: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    queue.shift()?.();
  }
}

const inFlight = new Map<string, Promise<string>>();

export function loadThumbnail(github: GitHub, keys: VaultKeys, item: GalleryItem): Promise<string> {
  const file = new File(cacheDir('thumbs'), `${item.id}.jpg`);
  if (file.exists) return Promise.resolve(file.uri);
  let pending = inFlight.get(item.id);
  if (!pending) {
    pending = limited(async () => {
      const { data } = open(keys.encKey, await github.getBlobBytes(item.thumbSha));
      writeFile(file, data);
      return file.uri;
    }).finally(() => inFlight.delete(item.id));
    inFlight.set(item.id, pending);
  }
  return pending;
}

export async function loadFullPhoto(github: GitHub, keys: VaultKeys, item: GalleryItem): Promise<{ uri: string; meta: PhotoMeta }> {
  const metaFile = new File(cacheDir('full'), `${item.id}.json`);
  if (metaFile.exists) {
    const meta = JSON.parse(await metaFile.text()) as PhotoMeta;
    const photo = new File(cacheDir('full'), `${item.id}.${extensionFor(meta)}`);
    if (photo.exists) return { uri: photo.uri, meta };
  }
  const { meta, data } = open(keys.encKey, await github.getFileBytes(item.photoPath));
  const photo = new File(cacheDir('full'), `${item.id}.${extensionFor(meta)}`);
  writeFile(photo, data);
  writeFile(metaFile, JSON.stringify(meta));
  return { uri: photo.uri, meta };
}

export function clearCache() {
  for (const name of ['thumbs', 'full']) {
    const dir = new Directory(Paths.cache, name);
    if (dir.exists) dir.delete();
  }
}

function writeFile(file: File, content: Uint8Array | string) {
  if (!file.exists) file.create();
  file.write(content);
}

export function extensionFor(meta: PhotoMeta) {
  const ext = meta.name.split('.').pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : 'jpg';
}

// The most recently loaded gallery, shared with the full-screen viewer so it
// can swipe between photos without listing the repository again.
let currentGallery: GalleryItem[] = [];

export function setCurrentGallery(items: GalleryItem[]) {
  currentGallery = items;
}

export function getCurrentGallery() {
  return currentGallery;
}
