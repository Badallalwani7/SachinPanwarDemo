// Backs up photos from the phone's library to the vault repository.
//
// For each photo not yet in the repo: read the original bytes, make a small
// JPEG thumbnail, encrypt both, and add them to a batch. Each batch becomes
// one commit on GitHub.

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, AssetField, AssetMetadata, MediaType, Query, getPermissionsAsync } from 'expo-media-library';
import * as Network from 'expo-network';

import { bytesToBase64 } from '../core/bytes';
import { PhotoMeta, photoId, seal } from '../core/crypto';
import { GitHub, NewFile } from '../core/github';
import { PHOTOS_DIR, parsePhotoPath, photoPaths } from '../core/vault';
import { createGitHub } from './github';
import { StoredSession, readSyncStatus, writeSyncStatus } from './storage';

const THUMB_SIZE = 400;
const BATCH_MAX_PHOTOS = 10;
const BATCH_MAX_BYTES = 40 * 1024 * 1024;
const PAGE_SIZE = 500;

export type SyncProgress = { running: boolean; done: number; total: number; message: string };

export type SyncResult = { uploaded: number; failed: number; pending: number; skippedReason?: string };

const idleProgress: SyncProgress = { running: false, done: 0, total: 0, message: '' };
let progress = idleProgress;
const listeners = new Set<(p: SyncProgress) => void>();

export function subscribeToSync(listener: (p: SyncProgress) => void) {
  listeners.add(listener);
  listener(progress);
  return () => {
    listeners.delete(listener);
  };
}

function report(next: SyncProgress) {
  progress = next;
  listeners.forEach((l) => l(next));
}

let running: Promise<SyncResult> | null = null;

// Safe to call from anywhere (app open, library change, background task);
// overlapping calls share the run that's already in progress.
export function runSync(session: StoredSession, options: { budgetMs?: number; ignoreWifiOnly?: boolean } = {}) {
  running ??= doSync(session, options).finally(() => {
    running = null;
    report(idleProgress);
  });
  return running;
}

async function doSync(session: StoredSession, options: { budgetMs?: number; ignoreWifiOnly?: boolean }): Promise<SyncResult> {
  const deadline = options.budgetMs ? Date.now() + options.budgetMs : Infinity;
  const status = { ...readSyncStatus(), lastRunAt: Date.now() };
  try {
    if (session.prefs.wifiOnly && !options.ignoreWifiOnly) {
      const network = await Network.getNetworkStateAsync();
      if (network.type !== Network.NetworkStateType.WIFI) {
        return { uploaded: 0, failed: 0, pending: status.pending ?? 0, skippedReason: 'Waiting for Wi-Fi' };
      }
    }
    const permission = await getPermissionsAsync(false, ['photo']);
    if (!permission.granted) throw new Error('Photo library access has not been granted');

    report({ running: true, done: 0, total: 0, message: 'Checking what is already backed up…' });
    const github = createGitHub(session.connection);
    const remote = new Set<string>();
    for (const entry of await github.listTree(PHOTOS_DIR)) {
      const parsed = parsePhotoPath(entry.path);
      if (parsed) remote.add(parsed.id);
    }

    report({ running: true, done: 0, total: 0, message: 'Scanning your photos…' });
    const pending = await findPending(session, remote);

    const result = await upload(github, session, pending, deadline);
    Object.assign(status, { lastSuccessAt: Date.now(), lastError: undefined, uploaded: (status.uploaded ?? 0) + result.uploaded, pending: result.pending });
    return result;
  } catch (e) {
    status.lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    writeSyncStatus(status);
  }
}

type PendingPhoto = { asset: AssetMetadata; id: string };

async function findPending(session: StoredSession, remote: Set<string>): Promise<PendingPhoto[]> {
  const pending: PendingPhoto[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = new Query().eq(AssetField.MEDIA_TYPE, MediaType.IMAGE);
    if (session.prefs.backupFrom > 0) query = query.gte(AssetField.CREATION_TIME, session.prefs.backupFrom);
    // Newest first, so the photo you just took is backed up first.
    const page = await query.orderBy({ key: AssetField.CREATION_TIME, ascending: false }).limit(PAGE_SIZE).offset(offset).exeForMetadata();
    for (const asset of page) {
      const id = photoId(session.keys.idKey, fingerprint(asset));
      if (!remote.has(id)) pending.push({ asset, id });
    }
    if (page.length < PAGE_SIZE) return pending;
  }
}

// Identifies the same photo across reinstalls and across phones, without
// relying on platform-specific asset ids.
function fingerprint(asset: AssetMetadata) {
  return `${asset.creationTime ?? ''}|${asset.filename ?? asset.id}|${asset.width ?? ''}x${asset.height ?? ''}`;
}

async function upload(github: GitHub, session: StoredSession, pending: PendingPhoto[], deadline: number): Promise<SyncResult> {
  let uploaded = 0;
  let failed = 0;
  let batch: NewFile[] = [];
  let batchBytes = 0;
  let batchPhotos = 0;

  const flush = async () => {
    if (batchPhotos === 0) return;
    report({ running: true, done: uploaded, total: pending.length, message: `Uploading ${batchPhotos} photo(s)…` });
    await github.commitFiles(batch, `Back up ${batchPhotos} photo${batchPhotos === 1 ? '' : 's'}`);
    uploaded += batchPhotos;
    batch = [];
    batchBytes = 0;
    batchPhotos = 0;
  };

  for (const item of pending) {
    if (Date.now() > deadline) break;
    report({ running: true, done: uploaded + batchPhotos, total: pending.length, message: 'Encrypting…' });
    try {
      const files = await encryptPhoto(session, item);
      batch.push(...files);
      batchBytes += files.reduce((sum, f) => sum + f.base64.length, 0);
      batchPhotos++;
    } catch (e) {
      // e.g. an iCloud-only photo that isn't on the phone. Try again next run.
      console.warn(`Skipping photo ${item.asset.filename}:`, e);
      failed++;
    }
    if (batchPhotos >= BATCH_MAX_PHOTOS || batchBytes >= BATCH_MAX_BYTES) await flush();
  }
  await flush();
  return { uploaded, failed, pending: pending.length - uploaded };
}

async function encryptPhoto(session: StoredSession, { asset, id }: PendingPhoto): Promise<NewFile[]> {
  const uri = await new Asset(asset.id).getUri();
  const original = await new File(uri).bytes();
  const name = asset.filename ?? uri.split('/').pop() ?? 'photo.jpg';
  const meta: PhotoMeta = {
    name,
    mime: mimeFor(name),
    takenAt: asset.creationTime,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
  };
  const thumb = await makeThumbnail(uri, asset);
  const paths = photoPaths(id, asset.creationTime);
  return [
    { path: paths.photo, base64: bytesToBase64(seal(session.keys.encKey, meta, original)) },
    { path: paths.thumb, base64: bytesToBase64(seal(session.keys.encKey, { ...meta, mime: 'image/jpeg' }, thumb)) },
  ];
}

async function makeThumbnail(uri: string, asset: AssetMetadata): Promise<Uint8Array> {
  const context = ImageManipulator.manipulate(uri);
  const landscape = (asset.width ?? 1) >= (asset.height ?? 1);
  // Resize the short side so thumbnails fill square grid cells.
  context.resize(landscape ? { height: THUMB_SIZE } : { width: THUMB_SIZE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  context.release();
  image.release();
  const file = new File(saved.uri);
  try {
    return await file.bytes();
  } finally {
    file.delete();
  }
}

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  gif: 'image/gif',
  dng: 'image/x-adobe-dng',
};

function mimeFor(name: string) {
  return MIME_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
