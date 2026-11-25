/**
 * constants.js — App keys, limits, and feature flags.
 */

/**
 * Closed testing: trial + locks after trial, but no subscribe UI (testers don’t see paid messaging).
 * Internal billing test: SUBSCRIPTION_UI true, FRIENDS_FULL_ACCESS false.
 */
/** Flipped per release track; not const so harness can override in tests. */
var KING_SUBSCRIPTION_UI_ENABLED = true;
var KING_FRIENDS_BUILD_FULL_ACCESS = false;
/** When true, purchases use RevenueCat only (no KingBilling JS path). Requires cap sync + API key. */
var KING_USE_REVENUECAT = true;
/**
 * RevenueCat public SDK keys — leave empty here. Set the real key only in
 * gitignored constants-revenuecat.local.js (copy from constants-revenuecat.local.example.js).
 */
var REVENUECAT_API_KEY_ANDROID = '';
var REVENUECAT_API_KEY_IOS = '';
/** Must match RevenueCat dashboard entitlement identifier. */
var REVENUECAT_ENTITLEMENT_ID = 'premium';
/** Package identifiers in the default RevenueCat offering → King plan ids. */
var REVENUECAT_PACKAGE_IDENTIFIERS = {
    monthly: '$rc_monthly',
    annual: '$rc_annual',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
/** Before this local hour, strong-log confirm modal shows early-log hint (20 = 8pm). */
const EARLY_STRONG_LOG_CUTOFF_HOUR = 20;
const EARLY_STRONG_LOG_CONFIRM_HINT_TAIL =
    'For accuracy, log around 9pm or bedtime. You can turn on the reminder in settings.';
const STORAGE_KEY = 'habitTracker_v3';
const LAST_BACKUP_KEY = 'kingLastBackupAt';
/** One-time home card: journey football / cricket metaphor (localStorage). */
const KING_JOURNEY_METAPHOR_HINT_KEY = 'kingJourneyMetaphorHintDismissed';
const KING_JOURNEY_BEST_HINT_KEY = 'kingJourneyBestHintDismissed';
const URGE_DURATION_SECS = 30;
const BREATH_IN_SECS = 4;
const BREATH_OUT_SECS = 4;
/** SVG breath ring arc length (2π × r=54). */
const BREATH_RING_CIRCUMFERENCE = 339;
/** Peak gain for urge-surf inhale/exhale breath cue (Web Audio). */
const BREATH_SOUND_GAIN = 0.75;
const BACKUP_FORMAT = 'king-backup';
const BACKUP_VERSION = 1;
/** Premium trial length in wall days since appStartDate (install Day 1 … Day N inclusive). */
const PREMIUM_TRIAL_DAYS = 15;
/**
 * RevenueCat store product identifiers (dashboard) → King plan ids monthly / annual.
 * Packages in offerings use REVENUECAT_PACKAGE_IDENTIFIERS ($rc_monthly, $rc_annual).
 */
const REVENUECAT_PRODUCT_CATALOG = [
    { id: 'monthly', productId: 'king_premium:monthly', period: 'month' },
    { id: 'annual', productId: 'king_premium:yearly', period: 'year' },
];
const PREMIUM_ANNUAL_VALUE_MESSAGE = 'Best value for the long journey';
/**
 * When false, paywall shows plan names only — no amounts, strikethrough, or % off.
 * Google Play still shows the price on the purchase sheet. Set true for billing tests.
 */
var KING_SHOW_PLAN_PRICES = true;
/** Dev mock plan rows (no amounts). Web / harness only — not shown on Android billing builds. */
const PREMIUM_PLANS_MOCK = [
    { id: 'monthly', period: 'month' },
    { id: 'annual', period: 'year', message: PREMIUM_ANNUAL_VALUE_MESSAGE },
];
/** Shown on paywall when plan prices are hidden in-app. */
const PREMIUM_PLAN_PRICE_AT_CHECKOUT = 'Google Play shows your price at checkout.';
/** Paywall copy when Play pricing cannot be loaded on Android. */
const PREMIUM_PRICE_UNAVAILABLE = 'Price unavailable';
/** RevenueCat track: offerings/configure failed — fix dashboard, not Play fallback. */
const PREMIUM_RC_OFFERS_UNAVAILABLE =
    'RevenueCat plans did not load. Check dashboard setup (details below).';
const PREMIUM_RC_SETUP_STEPS =
    '1) Project → Android app com.kingtracker.app\n' +
    '2) Google Play linked (service credentials)\n' +
    '3) Products: king_premium:monthly & king_premium:yearly → entitlement premium\n' +
    '4) Offering: packages $rc_monthly + $rc_annual → those products — mark offering **Current**';
/** User-facing copy for setNativeBillingFailure(code) — keys match billing-offers BILLING_DIAG_CODE. */
const PREMIUM_BILLING_DIAG_USER = {
    RC_SDK_UNAVAILABLE: 'RevenueCat Purchases is not available in this build. Run cap sync and reinstall.',
    RC_API_KEY_MISSING: 'RevenueCat Android public API key is missing from the app bundle (constants-revenuecat.local.js + web:copy).',
    RC_CONFIGURE_FAILED: 'RevenueCat could not finish setup. Check the API key and network.',
    RC_GET_OFFERINGS_FAILED: 'RevenueCat could not load offerings. Check network and dashboard.',
    RC_NO_CURRENT_OFFERING: 'RevenueCat has no Current offering with packages. Mark an offering Current in the dashboard.',
    RC_OFFERING_NO_PACKAGES: 'Current offering has no packages. Add $rc_monthly and $rc_annual.',
    RC_PACKAGES_UNMAPPED: 'Packages exist but King did not recognize monthly/annual. Tie king_premium:monthly and king_premium:yearly.',
    RC_PLAY_PRODUCT_UNAVAILABLE: 'Plans loaded but Google Play prices are missing in RevenueCat. Link Play and wait for product sync.',
};
const PREMIUM_PRICE_LOADING = 'Loading price…';
/** Web / PWA — no store billing; avoid showing dev mock INR prices. */
const PREMIUM_PRICE_WEB_HINT = 'Subscribe in the King Android app — Google Play shows your local price.';
/** Feature bullets on paywall + premium panel. */
const PREMIUM_FEATURES = [
    'Weekly timeline — one week at a time',
    'Streak, Journey & Progress milestones',
    'Daily knowledge cards',
    'Monthly Mirror',
    'Progress Graph',
    'Daily reminder to log your day',
    'Features in future',
];

