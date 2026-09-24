# Notes for automated / sandbox review

## Web assets → Android (no `cap sync` required for release)

Release command: `npm run android:bundle` → `npm run web:copy` then Gradle `:app:bundleRelease`.

`scripts/copy-web.js` creates `android/app/src/main/assets/public/` when `android/app` exists and copies the same PWA files as `www/`. You do **not** need `npx cap sync` for web HTML/CSS/JS to reach the AAB.

`public/` and Capacitor JSON under `assets/` remain gitignored; only this `.gitkeep` is in the archive.

## What sandboxes usually cannot verify

- **Gradle wrapper**: first build downloads `gradle-8.14.3-all.zip` from `services.gradle.org` (or uses `~/.gradle/wrapper/dists/`). Network-blocked environments fail after `web:copy` succeeds; that is not evidence the project is misconfigured.
- **Signed AAB**: upload keystore and `android/keystore.properties` are local-only (not in this zip). Maintainer validates `BUILD SUCCESSFUL`, `signReleaseBundle`, and `android/app/build/outputs/bundle/release/app-release.aab`.

See `android/RELEASE_SIGNING.md` for the maintainer checklist.

## Review ZIP (no build artifacts)

Maintainers: `npm run review:zip` — runs `web:copy` then zips the tree with excludes for `android/**/build/`, `.gradle`, keystores, and `node_modules`. Do not hand-zip the repo after a local Gradle build without those excludes.
