# Release signing checklist (Play Store)

King uses **Google Play App Signing**: Google holds the app signing key; you upload AABs signed with your **upload key**. Never commit keystores or `keystore.properties` (see `.gitignore`).

## One-time local setup

1. Copy `keystore.properties.example` → `android/keystore.properties` (repo root: `king-nofap-v1.0.1/android/`).
2. Place the upload keystore at **`android/app/king-upload.keystore`** (paths in `storeFile` are relative to the `app` module).
3. Fill in `storePassword`, `keyAlias`, and `keyPassword` in `keystore.properties`.
4. Back up the keystore and passwords somewhere safe (password manager + offline copy). Losing the upload key requires Play Console upload-key reset.

## Before every Play upload

- [ ] `android/keystore.properties` exists on the machine that builds the bundle.
- [ ] `android/app/king-upload.keystore` exists and matches that config.
- [ ] Bump `versionCode` in `app/build.gradle` (Play rejects duplicate codes).
- [ ] Build from repo root:
  ```bash
  npm run android:bundle
  ```
  Gradle runs `syncKingWebAssets` via `preBuild`, so web changes are included.
- [ ] Output AAB path and timestamp look current:
  `android/app/build/outputs/bundle/release/app-release.aab`
- [ ] Play Console → **App integrity** / **App signing** → **Upload key certificate** SHA-1 matches your upload keystore:
  ```bash
  keytool -list -v -keystore android/app/king-upload.keystore -alias upload
  ```
  (Use the alias from `keystore.properties`.)

## If release signing is missing

`app/build.gradle` only applies `signingConfigs.release` when `keystore.properties` exists. Without it, a release build may **not** be signed with your upload key. Do not upload that AAB to Play.

## After first successful upload

Keep using the **same upload keystore** for this app (`com.kingtracker.app`). A different key will be rejected unless you complete Google’s upload-key reset.

## How to know the bundle step succeeded

After `npm run android:bundle`, Gradle should end with **`BUILD SUCCESSFUL`** and tasks including **`signReleaseBundle`** (and **`validateSigningRelease`** when `keystore.properties` is present).

Confirm a **fresh** artifact (not an old file left on disk):

```bash
ls -la android/app/build/outputs/bundle/release/app-release.aab
```

Upload **`app-release.aab`** only — not the unsigned intermediate under `intermediates/`.

### Sandboxed / offline review environments

Some CI or remote review setups cannot reach `services.gradle.org` to download the Gradle wrapper (`gradle-8.14.3-all.zip`). That failure happens **after** `web:copy` succeeds and does **not** mean the project’s release config is wrong. Verification requires a machine with either network access for the first wrapper fetch or an existing `~/.gradle/wrapper/dists/` cache (normal Android Studio / local dev).

## Smoke test (recommended)

Install a **release** build on a device before or right after internal testing:

```bash
cd android && ./gradlew :app:assembleRelease
```

Install the release APK from `app/build/outputs/apk/release/`, then verify open, log strong/slip, reminder, and Play billing (license tester).

See also `ARCHITECTURE.md` → **Android release builds**.
