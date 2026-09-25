# King 1.0.1 — pre–Play internal testing review bundle

**Purpose:** Give GPT / Claude (or a human) enough context to review the app as it stands **before** Google Play **internal testing**.

## Identity

| Field | Value |
|--------|--------|
| GitHub | `fedmudit-max/laotzu101` |
| Branch | `main` (aligned with `release/1.0.1-one-slip`) |
| Git base | `5ab914e` on `main` (pushed to `laotzu101`) |
| Service worker | `king-v367` (`sw.js` `CACHE_NAME`) |
| Generated | 2026-09-25 |
| npm `package.json` `version` | `1.0.1` (aligned with Android) |
| Android `versionName` | `1.0.1` |
| Android `versionCode` | `4` |
| Application ID | `com.kingtracker.app` (verify in `android/app/build.gradle`) |

## What this build is

- Capacitor **Android** wrapper around the King PWA (repo-root HTML/CSS/JS → `www/` + `android/app/src/main/assets/public/` via `npm run web:copy`).
- **Play billing** path present (`billing-store-play.js`, native `KingBilling`); reminders and backup are **premium-gated** on native.
- **Settings** (gear): top-anchored sheet — **How King Works** and collapsible **Premium**, daily reminder (`#remindStatus` for native permission/premium copy), export/import, privacy, reset; header with logo + “King” + plain settings icon. Home no longer shows separate Learn/Premium cards.
- **Progress tab:** Monthly Mirror, **Personal Bests** (top-3 streaks & journeys with explicit tie-breakers), collapsible Progress Graph, lifetime stats — heavy sections default collapsed.
- **Privacy:** `public/privacy.html` copied into native bundles by `scripts/copy-web.js`.
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
4. **Settings UX** — Sheet covers home when open; Learn/Premium live in settings; no leaked PII in UI; reset flow confirms destruction.
5. **Regression** — Journey logging, slip flow, Progress tab (including Personal Bests ranking), onboarding still coherent.
6. **Release hygiene** — `versionCode` bumped when shipping; `minifyEnabled` / ProGuard notes in `app/build.gradle`; no debug endpoints.

## Commands reviewers can run

```bash
npm install
npm test   # 95 tests (node --test, tests/*.test.js)
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

---

*Generated for review archive; safe to share with AI tools — no secrets included.*
