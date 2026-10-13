# Photo Vault

A personal phone app that backs up every photo you take to a **private GitHub
repository**. Photos are **encrypted on the phone** first, so GitHub only ever stores
scrambled data. The same app on any of your phones unlocks the vault with your
passphrase and shows your photos in a gallery.

```
 Phone camera roll                                     Private GitHub repo
 ┌─────────────┐   read   ┌──────────────────────┐ upload ┌──────────────────────────┐
 │ IMG_1234.JPG│ ───────▶ │ encrypt with your key │ ─────▶ │ photos/2026/10/…_<id>.pv │
 └─────────────┘          │ (XChaCha20-Poly1305)  │        │ thumbs/2026/10/…_<id>.pv │
                          └──────────────────────┘        │ vault.json               │
                                                           └──────────────────────────┘
 Gallery tab  ◀──── download + decrypt on the phone ◀────────────────┘
```

## What it does

- **Automatic backup.** New photos upload when you open the app, shortly after you take a
  photo while it's open, and periodically in the background.
- **Encrypted before upload.** Each photo becomes an encrypted `.pv` file. Its original
  filename, date and the picture itself are all encrypted. A key is derived from your
  passphrase with scrypt; the passphrase itself never leaves the phone.
- **Gallery.** Shows encrypted thumbnails, newest first. Tap a photo to download and decrypt
  the full-quality original. Swipe between photos. **Save to phone** restores a photo
  to your camera roll.
- **Several phones, no duplicates.** Each photo gets a stable id, so a reinstall or a second
  phone never uploads the same photo twice. Uploads happen in batches of up to 10 photos
  per commit.

## Setup

### 1. Create the GitHub side

1. Create a new **private** repository, for example `photo-vault-2026`. It can be empty.
   The app refuses to use public repositories.
2. Create a **fine-grained personal access token**: GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens.
   - Repository access: *Only select repositories* → your vault repo
   - Permissions: **Contents → Read and write**
   - Pick an expiry you're comfortable with. When it expires, disconnect and reconnect
     with a new token.

### 2. Build and install the app

The app uses native modules (background tasks, photo library, secure storage), so it needs
a [development build](https://docs.expo.dev/develop/development-builds/introduction/).
Expo Go can't run it.

```bash
cd photo-vault
npm install
npx expo run:android      # Android device or emulator connected over USB
npx expo run:ios          # needs a Mac with Xcode
# or build in the cloud, no Android Studio or Xcode needed:
npx eas-cli@latest build --profile development --platform android
```

### 3. First phone

Open the app and enter `owner/repo`, the token, and a passphrase. Leave **Create a new
vault** on and tap **Create vault**. Allow photo access when asked. Backup starts right away.

> **Write the passphrase down.** Without it, nobody can decrypt the photos, including you.
> There is no reset.

### 4. Another phone

Install the app, enter the same repo, a token and the **same passphrase**. Then switch
**Create a new vault** off and tap **Unlock vault**.

## Backup tab

| Setting | Default | Meaning |
| --- | --- | --- |
| Back up new photos automatically | on | Backs up on app open, when new photos appear, and in the background |
| Only on Wi-Fi | on | Automatic backups wait for Wi-Fi. **Back up now** ignores this |
| Include photos taken before setup | on | Off = only photos taken from now on |

## Things you should know

- **GitHub is not truly unlimited storage.** GitHub recommends keeping repositories under
  about 1 GB and strongly recommends staying under 5 GB. Its terms also say repositories
  aren't meant as general file or backup hosting, so very large media repos risk being
  flagged. The Backup tab shows how much space the repo uses. When it gets large, create a
  new private repo (for example `photo-vault-2027`) and connect to it. Older repos keep
  their photos; connect to one again to browse it. Single files over 100 MB, such as
  huge RAW photos, are rejected by GitHub.
- **GitHub rate limits.** GitHub limits how fast new content can be created, so a first
  backup of thousands of photos runs over several hours or days. The app retries
  automatically and continues where it left off.
- **iOS background backup is up to iOS.** iOS decides when background tasks run, often
  overnight while charging. Opening the app always starts a backup. Android runs it
  roughly every 15 minutes or more.
- **Photos only.** Videos aren't backed up. iCloud-only photos that aren't downloaded to
  the phone are skipped and retried later.
- **Deleting is one-way.** Deleting a photo from your phone doesn't delete it from the vault.
- **What GitHub can see:** the number of photos, their approximate size, and their capture
  date and time (in the folder and file names, so the gallery can sort without decrypting).
  It can't see the pictures, filenames, location or any other metadata.
- Decrypted copies are cached inside the app's private storage for speed. **Backup → Clear
  decrypted cache** removes them.

## How it works (for developers)

```
src/core/      platform-independent logic, unit-tested in Node
  crypto.ts    scrypt key derivation, XChaCha20-Poly1305 seal/open, HMAC photo ids
  github.ts    GitHub REST client: Git Data API batch commits, tree listing, raw downloads
  vault.ts     vault.json create/unlock, repository path layout
src/lib/       phone-side code (Expo modules)
  sync.ts      finds photos not yet in the repo, encrypts them with thumbnails, uploads in batches
  backgroundSync.ts  OS background task registration
  gallery.ts   listing, download + decrypt + cache for thumbnails and full photos
  session.tsx  signed-in state, auto-backup triggers
  storage.ts   SecureStore for token/keys/prefs, sync status file
src/app/       screens (Expo Router)
test/          Vitest tests, including an in-memory fake of the GitHub API
```

**Encrypted file format (`.pv`):** `"PVLT"` + version byte + 24-byte random nonce +
XChaCha20-Poly1305 ciphertext of (4-byte metadata length, metadata JSON, photo bytes).
The 5-byte header is bound as associated data.

**`vault.json`** stores the scrypt parameters and salt, plus a small encrypted check value
used to tell you right away when a passphrase is wrong. It contains nothing secret.

```bash
npm test            # unit + fake-GitHub integration tests
npm run typecheck
npm run lint
```
