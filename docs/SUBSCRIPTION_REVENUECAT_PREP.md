# King — Path B: RevenueCat (Play + App Store)

**Status:** Internal RC track: **`KING_USE_REVENUECAT = true`** — no KingBilling JS fallback. Set `REVENUECAT_API_KEY_ANDROID` (or `constants-revenuecat.local.js`). Closed testing stays on shipped **versionCode 8** (subscribe UI off).

## Architecture

```text
billing-offers.js          → getPremiumOffer() (unchanged)
billing-platform.js        → init / offers / checkout / restore — **RC-only when `KING_USE_REVENUECAT` (no KingBilling fallback)**
billing-entitlement-snapshot.js → `updateEntitlementSnapshot` (RevenueCat writes)
billing-store-revenuecat.js  → Purchases SDK
billing-store-revenuecat.js → @revenuecat/purchases-capacitor
billing-ui.js              → paywall + gates (unchanged rules; Entitlement.js owns trial)
entitlement.js             → trial (appStartDate) + premiumUntil (paid cache)
```

**Local 15-day trial** stays in `entitlement.js`. RevenueCat only asserts **paid** entitlement `premium` (or `REVENUECAT_ENTITLEMENT_ID`).

## RevenueCat dashboard (do this first)

1. [RevenueCat](https://app.revenuecat.com) → **New project** → add **Android** (`com.kingtracker.app`).
2. **Google Play**: link service credentials (JSON) per RC docs; same subscription product IDs as Play Console.
3. **Entitlements**: create `premium` (match `REVENUECAT_ENTITLEMENT_ID` in `constants.js`).
4. **Products**: attach `king_premium:monthly` / `king_premium:yearly` to entitlement `premium`.
5. **Offerings**: create an offering (e.g. `default`) with packages whose **identifiers** match `REVENUECAT_PACKAGE_IDENTIFIERS` (`$rc_monthly`, `$rc_annual`). **Mark that offering as Current** in RevenueCat — otherwise `offerings.current` is null and the paywall stays empty.
6. **Play link**: subscriptions must show “Published” / linked in RC (service credentials). Until Play products sync, `priceString` may be blank.
7. **App Store** (when iOS starts): add iOS app, products, same entitlement `premium`.
8. Copy **public** SDK keys → `constants-revenuecat.local.js` (gitignored) and run `npm run web:copy` before bundle:
   - `REVENUECAT_API_KEY_ANDROID`
   - `REVENUECAT_API_KEY_IOS` (TestFlight later)

Never commit secret API keys (RevenueCat secret / Play service account json is dashboard-only).

## Enable in the app

| Step | Action |
|------|--------|
| 1 | Fill API keys in `constants.js` |
| 2 | `KING_USE_REVENUECAT = true` |
| 3 | `KING_SUBSCRIPTION_UI_ENABLED = true` (internal / billing track only) |
| 4 | `npm install` → `npm run cap:sync` |
| 5 | New **`versionCode`** → Internal testing AAB (not closed-test track) |

## npm / Capacitor

```bash
cd king-nofap-v1.0.1
npm install @revenuecat/purchases-capacitor@12.0.3
npm run cap:sync
```

Android: `MainActivity` is already `singleTask` (OK for Play billing verification flow).

iOS (later): In-App Purchase capability; RC SPM/CocoaPods via plugin; sandbox tester.

## Fast iteration (skip the 1‑hour Play upload loop)

You only need a **new AAB** when you bump **`versionCode`** or change **native** code (Gradle, Capacitor plugins, `MainActivity`, etc.).

For **billing JS, RC mapping, paywall copy, constants, API key** — use a **debug install** (about 2–5 minutes):

```bash
cd king-nofap-v1.0.1
npm run release:preflight    # RC key landed in assets (runs inside bundle too)
npm run android:install      # web:copy → debug APK → phone
```

Requirements: phone on **wireless/USB debugging**, same Google account as a **license tester** if you tap Subscribe. The app id is still `com.kingtracker.app`; RevenueCat + `getOfferings` work on debug builds.

| Goal | Where (no device) |
|------|-------------------|
| Key in APK assets | `npm run release:preflight` |
| Offering / package ids wired | RC dashboard → **Offerings** + **Products** (see prices sync from Play) |
| App logic | `npm test` (`tests/billing.test.js`) |

| Goal | On device (no Play upload) |
|------|----------------------------|
| See paywall + RC prices | Open Settings → Premium → subscribe |
| Why plans are empty | `npm run billing:logcat` in a terminal, then open paywall; watch `billing:revenuecat-*` in **Chrome** `chrome://inspect` → King WebView console |

Keep **one** internal-testing release on Play for tester eligibility. Iterate billing with **`android:install`** until RC shows prices; ship an AAB only when you are ready to publish that **versionCode**.

## Testing checklist

- [ ] Offerings load; paywall shows prices when `KING_SHOW_PLAN_PRICES = true`
- [ ] Purchase (license / sandbox) unlocks gated sections
- [ ] Restore on reinstall
- [ ] `customerInfo` refresh on cold start (`refreshStorePurchasesSilent`)
- [ ] Local trial still ends at 15 install days; paid stacks with `Entitlement.hasPremiumAccess()`
- [ ] Journey 1–2 grace for Best Journey / Personal Bests unchanged

## Migration from KingBilling-only

| Phase | Track |
|-------|--------|
| A | Internal test, `KING_USE_REVENUECAT = false`, native Play |
| B | Internal test, `KING_USE_REVENUECAT = true`, RC keys + linked products |
| C | Production when B passes; iOS TestFlight with same RC project |

`KingBilling` Java code can remain during Phase B; RC replaces the JS purchase path when the flag is on.

## Optional later

- **App User ID**: anonymous (default). For cross-device subs, add Sign in with Apple / email and `Purchases.logIn`.
- **Webhooks**: RC → your backend if you outgrow device-only cache (not required for v1).