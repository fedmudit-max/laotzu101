# King 1.0.2 — Play internal testing snapshot

**Purpose:** Give GPT / Claude (or a human) enough context to review the app as it stands for **Google Play internal testing** upload.

## Identity

| Field | Value |
|--------|--------|
| GitHub | `fedmudit-max/laotzu101` |
| Branch | `main` |
| Release commit (1.0.2 baseline) | `75a62cf` — *Release 1.0.2: settings bottom sheet, reorder, privacy, and spacing.* |
| Working tree | Uncommitted session work — run `git status` before upload. |
| Service worker | `king-v423` (`sw.js` `CACHE_NAME`) |
| Snapshot updated | 2026-10-04 (internal test cut #2) |
| npm `package.json` `version` | `1.0.2` (aligned with Android) |
| Android `versionName` | `1.0.2` |
| Android `versionCode` | `7` |
| Application ID | `com.kingtracker.app` (verify in `android/app/build.gradle`) |

## What this build is

- Capacitor **Android** wrapper around the King PWA (repo-root HTML/CSS/JS → `www/` + `android/app/src/main/assets/public/` via `npm run web:copy`).
- **Play billing** code present (`billing-store-play.js`, native `KingBilling`); **friends build** flags in `constants.js`: `KING_FRIENDS_BUILD_FULL_ACCESS` + subscription UI off (full access for testers until flags flipped for billing test).
- **Settings** (gear): bottom sheet — **How King Works**, collapsible **Premium**, daily reminder (`#remindStatus` for native permission/premium copy), export/import, privacy, reset.
- **Home:** one-time journey metaphor / best-journey hint cards (Journey 1); **strong-day confirm** before 8pm local: early-log card above title (local time + bedtime copy + settings gear → Reminder), hidden if daily reminder is on.
- **Progress tab:** Monthly Mirror, **Personal Bests**, collapsible Progress Graph, lifetime stats.
- **Privacy:** `public/privacy.html` → `privacy.html` + `privacy-content.js` via `scripts/copy-web.js`. Short version: *King does not store your data; it stays on your phone.*
- **Notifications:** Android reminder channel (private); see `reminder.js` and native notifier under `android/`.

## Regenerate a clean review archive

From repo root (excludes all `build/`, `.gradle`, keystores, `node_modules`):

```bash
npm run review:zip
```

Output: `King-<version>-code-review-<date>.zip` in the repo root and a copy on your Desktop. The script fails if any `/build/` path slips into the zip.

## What is **not** in this zip

- `node_modules/` — run `npm ci` or `npm install` at repo root.
- **Gradle `build/` outputs** — not included (review hygiene).
- Upload keystore / `android/keystore.properties` — local only; see `android/RELEASE_SIGNING.md`.
- Signed **AAB** — build locally: `npm run android:bundle` → `android/app/build/outputs/bundle/release/app-release.aab`.
- Gradle wrapper download may need network on first build (see `GPT-REVIEW.md`).

## Suggested review focus (Play internal test)

1. **Store policy & privacy** — Data stays on device; backup is user-initiated JSON; privacy page matches in-app links.
2. **Permissions** — `AndroidManifest.xml`: only what reminder, backup share, and billing need.
3. **Billing** — Subscription/trial copy in UI matches Play product setup; restore/purchase error paths; premium gates on reminder + backup + Personal Bests panel.
4. **Settings UX** — Sheet behavior; Learn/Premium in settings; no leaked PII in UI; reset flow confirms destruction.
5. **Regression** — Journey logging, slip flow, early-log confirm hint (time + reminder off), journey hint cards, Progress tab, onboarding.
6. **Release hygiene** — `versionCode` bumped when shipping; `minifyEnabled` / ProGuard notes in `app/build.gradle`; no debug endpoints.

## Commands reviewers can run

```bash
npm install
npm test   # 103 tests (node --test, tests/*.test.js)
npm run web:copy
npm run android:debug          # needs JDK + Android SDK; may download Gradle once
npm run android:bundle         # release AAB; needs keystore.properties locally
```

## PWA / Pages (optional)

- `https://fedmudit-max.github.io/laotzu101/` — same web assets after deploy from `main`.

## Maintainer sign-off before upload

- [ ] `BUILD SUCCESSFUL` + `signReleaseBundle` on maintainer machine  
- [ ] Smoke test release or debug APK on a physical device  
- [ ] Play Console internal testing track + testers listed  
- [ ] Store listing, content rating, and data safety form aligned with on-device-only storage narrative  
- [ ] `versionCode` higher than any build already on the internal track  

---

*Snapshot for review archive; safe to share with AI tools — no secrets included.*
