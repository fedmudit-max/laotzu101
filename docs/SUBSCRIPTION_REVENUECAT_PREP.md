# King — Path B: RevenueCat (Play + App Store)

**Status:** Scaffold in repo; **`KING_USE_REVENUECAT = false`** until internal billing is ready. Closed testing stays on native Play flags with subscribe UI off.

## Architecture

```text
billing-offers.js          → getPremiumOffer() (unchanged)
billing-platform.js        → init / offers / checkout / restore (Play OR RevenueCat)
billing-store-play.js      → KingBilling + updateEntitlementSnapshot (Play)
billing-store-revenuecat.js → @revenuecat/purchases-capacitor
billing-ui.js              → paywall + gates (unchanged rules; Entitlement.js owns trial)
entitlement.js             → trial (appStartDate) + premiumUntil (paid cache)
```

**Local 15-day trial** stays in `entitlement.js`. RevenueCat only asserts **paid** entitlement `premium` (or `REVENUECAT_ENTITLEMENT_ID`).

## RevenueCat dashboard (do this first)

1. [RevenueCat](https://app.revenuecat.com) → **New project** → add **Android** (`com.kingtracker.app`).
2. **Google Play**: link service credentials (JSON) per RC docs; same subscription product IDs as Play Console.
3. **Entitlements**: create `premium` (match `REVENUECAT_ENTITLEMENT_ID` in `constants.js`).
4. **Products**: attach Play `king_premium_monthly` / `king_premium_annual` to entitlement `premium`.
5. **Offerings**: default offering → packages whose **identifiers** match `REVENUECAT_PACKAGE_IDENTIFIERS` (`monthly`, `annual` by default).
6. **App Store** (when iOS starts): add iOS app, products, same entitlement `premium`.
7. Copy **public** SDK keys → `constants.js`:
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