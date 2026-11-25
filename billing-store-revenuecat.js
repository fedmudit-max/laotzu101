/**
 * billing-store-revenuecat.js — RevenueCat Purchases (Play + App Store via RC).
 * Active when KING_USE_REVENUECAT is true (configure requires platform API key).
 *
 * Requires: npm install @revenuecat/purchases-capacitor && npx cap sync
 */

var revenueCatConfigured = false;
var revenueCatConfigurePromise = null;
var revenueCatCheckoutInFlight = false;
var revenueCatRestoreInFlight = false;
var revenueCatSilentRefreshPromise = null;
var cachedRevenueCatOfferings = null;
/** Offering whose packages are shown on the paywall (offerings.current or first valid offering). */
var cachedRevenueCatActiveOffering = null;
var revenueCatListenerBound = false;
/** requestDateMillis of the newest CustomerInfo already applied. Older snapshots must not revoke a newer purchase. */
var lastRevenueCatInfoMillis = 0;

function useRevenueCatBilling() {
    return typeof KING_USE_REVENUECAT !== 'undefined' && !!KING_USE_REVENUECAT;
}

function getRevenueCatPurchases() {
    if (typeof window === 'undefined' || !window.Capacitor) return null;
    var Cap = window.Capacitor;
    if (typeof Cap.isNativePlatform === 'function' && !Cap.isNativePlatform()) return null;
    if (Cap.Plugins && Cap.Plugins.Purchases) return Cap.Plugins.Purchases;
    if (typeof Cap.registerPlugin === 'function') {
        try {
            return Cap.registerPlugin('Purchases');
        } catch (e) {
            return null;
        }
    }
    return typeof window.Purchases !== 'undefined' ? window.Purchases : null;
}

function getRevenueCatApiKey() {
    var Cap = typeof window !== 'undefined' ? window.Capacitor : null;
    var platform = Cap && typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : 'android';
    if (platform === 'ios') {
        return typeof REVENUECAT_API_KEY_IOS !== 'undefined' ? String(REVENUECAT_API_KEY_IOS || '') : '';
    }
    return typeof REVENUECAT_API_KEY_ANDROID !== 'undefined' ? String(REVENUECAT_API_KEY_ANDROID || '') : '';
}

function revenueCatEntitlementId() {
    return typeof REVENUECAT_ENTITLEMENT_ID !== 'undefined' ? REVENUECAT_ENTITLEMENT_ID : 'premium';
}

function revenueCatPackageIdForPlan(planId) {
    var map = typeof REVENUECAT_PACKAGE_IDENTIFIERS !== 'undefined' ? REVENUECAT_PACKAGE_IDENTIFIERS : {};
    return map[planId] || planId;
}

/**
 * Map RC entitlement → local premiumUntil. King sells time-bounded subs only:
 * no invented extension when expiration is missing or unparseable (Play cache fallback is Play-only).
 */
function coerceRevenueCatObject(value) {
    if (value == null) return null;
    if (typeof value === 'string') {
        var trimmed = value.trim();
        if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
            try {
                var parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (e) { /* keep raw */ }
        }
        return null;
    }
    if (typeof value === 'object') return value;
    return null;
}

function looksLikeRevenueCatCustomerInfo(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.entitlements) return true;
    if (obj.latestExpirationDate || obj.latestExpirationDateMillis) return true;
    if (obj.activeSubscriptions) return true;
    return false;
}

function customerInfoFromPurchasesPayload(payload) {
    payload = coerceRevenueCatObject(payload);
    if (!payload) return null;
    if (payload.customerInfo && payload.customerInfo !== payload) {
        var nested = customerInfoFromPurchasesPayload(payload.customerInfo);
        if (nested) return nested;
        var inner = coerceRevenueCatObject(payload.customerInfo);
        if (looksLikeRevenueCatCustomerInfo(inner)) return inner;
    }
    if (looksLikeRevenueCatCustomerInfo(payload)) return payload;
    return null;
}

function futureIsoFromCustomerInfoRoot(info) {
    if (!info) return '';
    var d = dateFromRevenueCatValue(info.latestExpirationDate);
    if (!d) d = dateFromRevenueCatValue(info.latestExpirationDateMillis);
    if (d && d.getTime() > Date.now()) return d.toISOString();
    return '';
}

function paidUntilIsoFromPlan(planId) {
    var days = planId === 'monthly' ? 32 : 370;
    var dayMs = typeof MS_PER_DAY === 'number' ? MS_PER_DAY : 24 * 60 * 60 * 1000;
    return new Date(Date.now() + days * dayMs).toISOString();
}

function writePaidRevenueCatAccess(untilIso, source) {
    if (!untilIso) return;
    updateEntitlementSnapshot({
        premiumUntil: untilIso,
        lastVerifiedAt: new Date().toISOString(),
        source: source === 'restore' ? 'restore' : 'revenuecat',
    });
}

function epochMillisFromRevenueCatNumber(n) {
    n = Number(n);
    if (!(n > 0)) return 0;
    if (n < 1e11) n *= 1000;
    return n;
}

function customerInfoRequestMillis(info) {
    if (!info) return 0;
    var n = epochMillisFromRevenueCatNumber(info.requestDateMillis);
    if (n > 0) return n;
    if (info.requestDate) {
        var t = new Date(info.requestDate).getTime();
        if (!Number.isNaN(t)) return t;
    }
    return 0;
}

function dateFromRevenueCatValue(raw) {
    if (raw == null || raw === '') return null;
    var n = typeof raw === 'number' ? raw : Number(raw);
    if (n > 0 && String(raw).trim() !== '' && (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw).trim()))) {
        var fromNumber = new Date(epochMillisFromRevenueCatNumber(n));
        if (!Number.isNaN(fromNumber.getTime())) return fromNumber;
    }
    if (typeof raw === 'string') {
        var fromString = new Date(raw);
        if (!Number.isNaN(fromString.getTime())) return fromString;
    }
    return null;
}

function revenueCatEntitlementIsActive(ent) {
    if (!ent) return false;
    if (ent.isActive === false || ent.isActive === 0 || ent.isActive === 'false') return false;
    if (ent.isActive === true || ent.isActive === 1 || ent.isActive === 'true') return true;
    return true;
}

function revenueCatEntitlementMap(bucket) {
    var out = {};
    if (!bucket) return out;
    if (Array.isArray(bucket)) {
        for (var i = 0; i < bucket.length; i++) {
            var row = bucket[i];
            if (!row) continue;
            var key = row.identifier || row.entitlementId || ('idx' + i);
            out[key] = row;
        }
        return out;
    }
    if (typeof bucket === 'object') return bucket;
    return out;
}

function findRevenueCatPremiumEntitlement(customerInfo) {
    var want = String(revenueCatEntitlementId() || 'premium').toLowerCase();
    var ents = (customerInfo && customerInfo.entitlements) || {};
    var active = revenueCatEntitlementMap(ents.active);
    var all = revenueCatEntitlementMap(ents.all);
    function pick(map) {
        if (map[revenueCatEntitlementId()]) return map[revenueCatEntitlementId()];
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i++) {
            if (String(keys[i]).toLowerCase() === want) return map[keys[i]];
            var row = map[keys[i]];
            var ident = row && (row.identifier || row.entitlementId);
            if (ident && String(ident).toLowerCase() === want) return row;
        }
        return null;
    }
    var fromActive = pick(active);
    if (fromActive) return fromActive;
    var fromAll = pick(all);
    if (fromAll && revenueCatEntitlementIsActive(fromAll)) return fromAll;
    var activeKeys = Object.keys(active);
    for (var j = 0; j < activeKeys.length; j++) {
        if (revenueCatEntitlementIsActive(active[activeKeys[j]])) return active[activeKeys[j]];
    }
    return null;
}

function findDormantRevenueCatPremiumEntitlement(customerInfo) {
    var ents = (customerInfo && customerInfo.entitlements) || {};
    var all = revenueCatEntitlementMap(ents.all);
    var want = String(revenueCatEntitlementId() || 'premium').toLowerCase();
    var row = all[revenueCatEntitlementId()] || all.premium;
    if (!row) {
        var keys = Object.keys(all);
        for (var i = 0; i < keys.length; i++) {
            if (String(keys[i]).toLowerCase() === want) {
                row = all[keys[i]];
                break;
            }
        }
    }
    if (!row || revenueCatEntitlementIsActive(row)) return null;
    return row;
}

function revenueCatEntitlementHasPastExpiration(ent) {
    if (!ent) return false;
    var d = dateFromRevenueCatValue(ent.expirationDate);
    if (!d) d = dateFromRevenueCatValue(ent.expirationDateMillis);
    return !!(d && d.getTime() <= Date.now());
}

function hasActiveStoreSubscriptions(info) {
    if (!info) return false;
    var subs = info.activeSubscriptions;
    if (Array.isArray(subs) && subs.length) return true;
    if (subs && typeof subs === 'object' && !Array.isArray(subs) && Object.keys(subs).length) {
        return true;
    }
    return false;
}

function premiumUntilFromRevenueCatEntitlement(ent) {
    var nowIso = new Date().toISOString();
    if (!ent || !revenueCatEntitlementIsActive(ent)) return { until: '', at: nowIso };
    var d = dateFromRevenueCatValue(ent.expirationDate);
    if (!d) d = dateFromRevenueCatValue(ent.expirationDateMillis);
    if (!d) return { until: '', at: nowIso };
    return { until: d.toISOString(), at: nowIso };
}

function applyRevenueCatCustomerInfo(customerInfo, source) {
    source = source === 'restore' ? 'restore' : 'revenuecat';
    customerInfo = customerInfoFromPurchasesPayload(customerInfo);
    if (!customerInfo) {
        return { applied: false, active: false };
    }
    var requestMillis = customerInfoRequestMillis(customerInfo);
    if (requestMillis && lastRevenueCatInfoMillis && requestMillis < lastRevenueCatInfoMillis) {
        var stillActive = typeof Entitlement !== 'undefined' && Entitlement.isSubscriptionActive(state);
        return { applied: false, active: !!stillActive };
    }
    var localPaid = typeof Entitlement !== 'undefined' && Entitlement.isSubscriptionActive(state);
    var ent = findRevenueCatPremiumEntitlement(customerInfo);
    var dates = premiumUntilFromRevenueCatEntitlement(ent);
    var untilMs = dates.until ? new Date(dates.until).getTime() : 0;
    var untilInFuture = untilMs > Date.now();

    if (ent && revenueCatEntitlementIsActive(ent) && untilInFuture) {
        if (requestMillis) lastRevenueCatInfoMillis = requestMillis;
        writePaidRevenueCatAccess(dates.until, source);
        if (!requestMillis) lastRevenueCatInfoMillis = Date.now();
        return { applied: true, active: true };
    }
    if (ent && revenueCatEntitlementIsActive(ent)) {
        if (requestMillis) lastRevenueCatInfoMillis = requestMillis;
        if (localPaid) return { applied: false, active: true };
        return { applied: false, active: false };
    }
    var rootUntil = futureIsoFromCustomerInfoRoot(customerInfo);
    if (rootUntil) {
        if (requestMillis) lastRevenueCatInfoMillis = requestMillis;
        writePaidRevenueCatAccess(rootUntil, source);
        if (!requestMillis) lastRevenueCatInfoMillis = Date.now();
        return { applied: true, active: true };
    }
    if (hasActiveStoreSubscriptions(customerInfo) && localPaid) {
        if (requestMillis) lastRevenueCatInfoMillis = requestMillis;
        return { applied: false, active: true };
    }
    var dormant = findDormantRevenueCatPremiumEntitlement(customerInfo);
    var periodEnded = revenueCatEntitlementHasPastExpiration(ent)
        || revenueCatEntitlementHasPastExpiration(dormant);
    if (periodEnded && !hasActiveStoreSubscriptions(customerInfo)) {
        if (requestMillis) lastRevenueCatInfoMillis = requestMillis;
        if (state.source === 'revenuecat' || state.source === 'restore') {
            updateEntitlementSnapshot({
                premiumUntil: '',
                lastVerifiedAt: dates.at,
                source: state.source,
            });
        }
        return { applied: true, active: false };
    }
    if (localPaid) return { applied: false, active: true };
    return { applied: false, active: false };
}

function revenueCatProductIdentifier(product) {
    if (!product) return '';
    return String(product.identifier || product.productIdentifier || product.storeProductId || '');
}

function kingPlanIdFromStoreProductId(productId) {
    var list = typeof REVENUECAT_PRODUCT_CATALOG !== 'undefined' ? REVENUECAT_PRODUCT_CATALOG : [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].productId === productId) return list[i].id;
    }
    var lower = String(productId || '').toLowerCase();
    if (lower === 'king_premium:yearly' || lower.indexOf('yearly') !== -1) return 'annual';
    if (lower === 'king_premium:monthly' || lower.indexOf('monthly') !== -1) return 'monthly';
    if (lower.indexOf('annual') !== -1 || lower.indexOf('year') !== -1) return 'annual';
    if (lower.indexOf('month') !== -1) return 'monthly';
    return '';
}

function normalizeRevenueCatOfferingsPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.current != null || raw.all) return raw;
    if (raw.offerings && typeof raw.offerings === 'object') return raw.offerings;
    return raw;
}

function packagesFromRevenueCatOffering(offering) {
    if (!offering) return [];
    var list = offering.availablePackages;
    if (list && list.length) return list.slice();
    var out = [];
    ['annual', 'monthly', 'sixMonth', 'threeMonth', 'twoMonth', 'weekly', 'lifetime'].forEach(function (slot) {
        if (offering[slot]) out.push(offering[slot]);
    });
    return out;
}

function kingPlanIdFromRevenueCatPackage(pkg) {
    if (!pkg) return '';
    var pkgType = String(pkg.packageType || '').toUpperCase();
    if (pkgType === 'ANNUAL') return 'annual';
    if (pkgType === 'MONTHLY') return 'monthly';
    var map = typeof REVENUECAT_PACKAGE_IDENTIFIERS !== 'undefined' ? REVENUECAT_PACKAGE_IDENTIFIERS : {};
    var planByPkg = {};
    Object.keys(map).forEach(function (planId) {
        planByPkg[map[planId]] = planId;
    });
    if (pkg.identifier && planByPkg[pkg.identifier]) return planByPkg[pkg.identifier];
    var fromProduct = kingPlanIdFromStoreProductId(revenueCatProductIdentifier(pkg.product));
    if (fromProduct) return fromProduct;
    var ident = String(pkg.identifier || '').toLowerCase();
    if (ident.indexOf('annual') !== -1) return 'annual';
    if (ident.indexOf('month') !== -1) return 'monthly';
    if (ident === 'annual' || ident === 'yearly' || ident === 'year') return 'annual';
    if (ident === 'monthly' || ident === 'month') return 'monthly';
    return '';
}

function offeringHasPackages(offering) {
    return packagesFromRevenueCatOffering(offering).length > 0;
}

function resolveRevenueCatOffering(offerings) {
    if (!offerings) return null;
    var current = offerings.current;
    if (current && offeringHasPackages(current)) {
        return current;
    }
    var all = offerings.all;
    if (!all || typeof all !== 'object') return null;
    var preferred = all.default || all.Default || all.standard || all.Standard;
    if (preferred && offeringHasPackages(preferred)) {
        return preferred;
    }
    var keys = Object.keys(all);
    for (var i = 0; i < keys.length; i++) {
        var off = all[keys[i]];
        if (off && offeringHasPackages(off)) return off;
    }
    return null;
}

function plansFromRevenueCatPackages(packages) {
    var out = [];
    var seen = Object.create(null);
    var list = packages || [];
    for (var i = 0; i < list.length; i++) {
        var pkg = list[i];
        if (!pkg) continue;
        var planId = kingPlanIdFromRevenueCatPackage(pkg);
        if (planId !== 'monthly' && planId !== 'annual') continue;
        if (seen[planId]) continue;
        seen[planId] = true;
        var product = pkg.product || {};
        var period = planId === 'annual' ? 'year' : 'month';
        var plan = {
            id: planId,
            period: period,
            price: product.priceString || product.localizedPriceString || '',
            message: planId === 'annual' && typeof PREMIUM_ANNUAL_VALUE_MESSAGE !== 'undefined'
                ? PREMIUM_ANNUAL_VALUE_MESSAGE
                : '',
        };
        if (product.price != null && !Number.isNaN(Number(product.price))) {
            plan.amount = Number(product.price);
        }
        out.push(plan);
    }
    var order = { annual: 0, monthly: 1 };
    out.sort(function (a, b) {
        return (order[a.id] != null ? order[a.id] : 9) - (order[b.id] != null ? order[b.id] : 9);
    });
    return out;
}

function ensureRevenueCatConfigured() {
    if (!useRevenueCatBilling()) return Promise.resolve(false);
    if (revenueCatConfigured) return Promise.resolve(true);
    if (revenueCatConfigurePromise) return revenueCatConfigurePromise;

    var Purchases = getRevenueCatPurchases();
    var apiKey = getRevenueCatApiKey();
    if (!Purchases || typeof Purchases.configure !== 'function') {
        return Promise.resolve(false);
    }
    if (!apiKey) return Promise.resolve(false);

    try {
        var configured = Purchases.configure({ apiKey: apiKey });
        // Android plugin marks configure as RETURN_NONE, so the bridge returns undefined
        // after the native call. That is success, not a missing promise.
        if (!configured || typeof configured.then !== 'function') {
            revenueCatConfigured = true;
            bindRevenueCatListenerOnce();
            return Promise.resolve(true);
        }
        revenueCatConfigurePromise = configured
            .then(function () {
                revenueCatConfigured = true;
                bindRevenueCatListenerOnce();
                return true;
            })
            .catch(function (err) {
                revenueCatConfigurePromise = null;
                if (typeof logOptionalFailure === 'function') {
                    logOptionalFailure('billing:revenuecat-configure', err);
                }
                return false;
            });
        return revenueCatConfigurePromise;
    } catch (err) {
        revenueCatConfigurePromise = null;
        if (typeof logOptionalFailure === 'function') {
            logOptionalFailure('billing:revenuecat-configure', err);
        }
        return Promise.resolve(false);
    }
}

function bindRevenueCatListenerOnce() {
    if (revenueCatListenerBound) return;
    var Purchases = getRevenueCatPurchases();
    if (!Purchases || typeof Purchases.addCustomerInfoUpdateListener !== 'function') return;
    revenueCatListenerBound = true;
    Purchases.addCustomerInfoUpdateListener(function (payload) {
        var info = customerInfoFromPurchasesPayload(payload);
        if (!info) return;
        applyRevenueCatCustomerInfo(info, 'revenuecat');
        if (typeof unlockPremiumFeatures === 'function') unlockPremiumFeatures();
    });
}

function loadRevenueCatOffers() {
    if (!useRevenueCatBilling()) return;
    if (!storePremiumOffer) {
        premiumOfferLoadState = 'loading';
        refreshPremiumOfferUiIfVisible();
    }
    var Purchases = getRevenueCatPurchases();
    if (!Purchases) {
        if (typeof setNativeBillingFailure === 'function') {
            setNativeBillingFailure(BILLING_DIAG_CODE.RC_SDK_UNAVAILABLE, 'Purchases plugin missing');
        }
        if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
        refreshPremiumOfferUiIfVisible();
        return;
    }
    var apiKey = getRevenueCatApiKey();
    if (!apiKey) {
        if (typeof setNativeBillingFailure === 'function') {
            setNativeBillingFailure(BILLING_DIAG_CODE.RC_API_KEY_MISSING, 'REVENUECAT_API_KEY_ANDROID empty');
        }
        if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
        refreshPremiumOfferUiIfVisible();
        return;
    }
    ensureRevenueCatConfigured().then(function (ok) {
        if (!ok) {
            if (typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(BILLING_DIAG_CODE.RC_CONFIGURE_FAILED, 'configure returned false');
            }
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        return Purchases.getOfferings();
    }).then(function (offerings) {
        if (offerings === undefined) return;
        if (offerings === null) {
            if (typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(BILLING_DIAG_CODE.RC_GET_OFFERINGS_FAILED, 'getOfferings returned null');
            }
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        offerings = normalizeRevenueCatOfferingsPayload(offerings);
        if (!offerings) {
            if (typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(BILLING_DIAG_CODE.RC_GET_OFFERINGS_FAILED, 'empty offerings payload');
            }
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        cachedRevenueCatOfferings = offerings;
        var currentOnly = offerings.current;
        cachedRevenueCatActiveOffering = resolveRevenueCatOffering(offerings);
        if (!cachedRevenueCatActiveOffering) {
            if (currentOnly && !offeringHasPackages(currentOnly)) {
                if (typeof setNativeBillingFailure === 'function') {
                    setNativeBillingFailure(BILLING_DIAG_CODE.RC_OFFERING_NO_PACKAGES, 'Current offering has no packages');
                }
            } else if (typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(BILLING_DIAG_CODE.RC_NO_CURRENT_OFFERING, 'no resolvable offering');
            }
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        var pkgs = packagesFromRevenueCatOffering(cachedRevenueCatActiveOffering);
        if (!pkgs.length) {
            if (typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(BILLING_DIAG_CODE.RC_OFFERING_NO_PACKAGES, 'offering resolved but zero packages');
            }
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        var plans = plansFromRevenueCatPackages(pkgs);
        if (!plans.length) {
            if (typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(BILLING_DIAG_CODE.RC_PACKAGES_UNMAPPED, 'packages did not map to monthly/annual');
            }
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        var missingStorePrice = false;
        if (typeof showPlanPricesInUi === 'function' && showPlanPricesInUi()) {
            for (var pi = 0; pi < plans.length; pi++) {
                if (!plans[pi].price && !(plans[pi].amount > 0)) missingStorePrice = true;
            }
            if (missingStorePrice && typeof setNativeBillingFailure === 'function') {
                setNativeBillingFailure(
                    BILLING_DIAG_CODE.RC_PLAY_PRODUCT_UNAVAILABLE,
                    'RC packages lack Play priceString'
                );
            }
        }
        if (!missingStorePrice && typeof clearNativeBillingFailure === 'function') {
            clearNativeBillingFailure();
        }
        setPremiumOfferFromStore({
            trialDays: PREMIUM_TRIAL_DAYS,
            plans: plans,
            source: 'revenuecat',
        });
        var overlay = document.getElementById('premiumOverlay');
        if (overlay && overlay.classList.contains('active')) {
            showPremiumModal({ plans: plans, source: 'revenuecat' });
        }
        if (typeof renderPremiumPanelContent === 'function') renderPremiumPanelContent();
    }).catch(function (err) {
        if (typeof setNativeBillingFailure === 'function') {
            var msg = err && (err.message || err.errorMessage) ? String(err.message || err.errorMessage) : 'getOfferings rejected';
            setNativeBillingFailure(BILLING_DIAG_CODE.RC_GET_OFFERINGS_FAILED, msg);
        }
        if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
        refreshPremiumOfferUiIfVisible();
    });
}

function findRevenueCatPackageForPlan(planId) {
    var offering = cachedRevenueCatActiveOffering;
    if (!offering) {
        offering = cachedRevenueCatOfferings ? resolveRevenueCatOffering(cachedRevenueCatOfferings) : null;
    }
    if (!offering) return null;
    var want = revenueCatPackageIdForPlan(planId);
    var packages = packagesFromRevenueCatOffering(offering);
    for (var i = 0; i < packages.length; i++) {
        if (packages[i].identifier === want) return packages[i];
        if (kingPlanIdFromRevenueCatPackage(packages[i]) === planId) return packages[i];
    }
    return null;
}

function startRevenueCatCheckout(planId) {
    if (revenueCatCheckoutInFlight) return Promise.resolve();
    revenueCatCheckoutInFlight = true;
    var purchased = false;
    return ensureRevenueCatConfigured().then(function (ok) {
        if (!ok) {
            showToast(0, 'Billing is not configured. Add RevenueCat API keys.');
            return;
        }
        var pkg = findRevenueCatPackageForPlan(planId);
        if (!pkg) {
            showToast(0, 'Plan not available. Check RevenueCat offerings.');
            return;
        }
        var Purchases = getRevenueCatPurchases();
        purchased = true;
        return Purchases.purchasePackage({ aPackage: pkg });
    }).then(function (result) {
        if (!purchased) return;
        var next = applyRevenueCatCustomerInfo(result, 'revenuecat');
        if (next.active) {
            onPremiumActivated();
            return;
        }
        var Purchases = getRevenueCatPurchases();
        if (!Purchases || typeof Purchases.getCustomerInfo !== 'function') {
            writePaidRevenueCatAccess(paidUntilIsoFromPlan(planId), 'revenuecat');
            onPremiumActivated();
            return;
        }
        var synced = typeof Purchases.syncPurchases === 'function'
            ? Purchases.syncPurchases().catch(function () {})
            : Promise.resolve();
        return synced.then(function () {
            return Purchases.getCustomerInfo();
        }).then(function (fresh) {
            var refreshed = applyRevenueCatCustomerInfo(fresh, 'revenuecat');
            if (refreshed.active) {
                onPremiumActivated();
                return;
            }
            writePaidRevenueCatAccess(paidUntilIsoFromPlan(planId), 'revenuecat');
            onPremiumActivated();
        });
    }).catch(function (err) {
        if (err && (err.userCancelled || err.code === '1' || err.code === 1)) return;
        var code = String(err && (err.code != null ? err.code : err.errorCode) || '');
        var msg = String(err && (err.message || err.errorMessage) || '');
        var alreadyOwned = code === '6' || code === '7'
            || /already.?purchased|ITEM_ALREADY_OWNED|product.?already/i.test(msg);
        if (!alreadyOwned) {
            showToast(0, 'Could not complete purchase. Try again.');
            return;
        }
        var Purchases = getRevenueCatPurchases();
        var synced = Purchases && typeof Purchases.syncPurchases === 'function'
            ? Purchases.syncPurchases().catch(function () {})
            : Promise.resolve();
        return synced.then(function () {
            if (!Purchases || typeof Purchases.getCustomerInfo !== 'function') {
                writePaidRevenueCatAccess(paidUntilIsoFromPlan(planId), 'revenuecat');
                onPremiumActivated();
                return;
            }
            return Purchases.getCustomerInfo().then(function (fresh) {
                var refreshed = applyRevenueCatCustomerInfo(fresh, 'revenuecat');
                if (refreshed.active) {
                    onPremiumActivated();
                    return;
                }
                writePaidRevenueCatAccess(paidUntilIsoFromPlan(planId), 'revenuecat');
                onPremiumActivated();
            });
        }).catch(function () {
            writePaidRevenueCatAccess(paidUntilIsoFromPlan(planId), 'revenuecat');
            onPremiumActivated();
        });
    }).then(function () {
        revenueCatCheckoutInFlight = false;
    });
}

function restoreRevenueCatAccess() {
    if (revenueCatRestoreInFlight) return Promise.resolve();
    revenueCatRestoreInFlight = true;
    return ensureRevenueCatConfigured().then(function (ok) {
        if (!ok) {
            showToast(0, 'Billing is not configured.');
            return;
        }
        var Purchases = getRevenueCatPurchases();
        return Purchases.restorePurchases();
    }).then(function (result) {
        var info = customerInfoFromPurchasesPayload(result);
        if (!info) {
            showToast(0, 'Could not reach the store. Try again.');
            return;
        }
        var hadPaid = Entitlement.isSubscriptionActive();
        var next = applyRevenueCatCustomerInfo(info, 'restore');
        if (next.active) {
            unlockPremiumFeatures();
            closePremiumSheet();
            showToast(0, hadPaid ? 'Premium is active.' : 'Premium restored 👑');
            return;
        }
        unlockPremiumFeatures();
        showToast(0, 'No active Premium subscription on this account.');
    }).catch(function () {
        showToast(0, 'Could not restore purchases.');
    }).then(function () {
        revenueCatRestoreInFlight = false;
    });
}

function refreshRevenueCatSilent() {
    if (!useRevenueCatBilling()) return Promise.resolve();
    if (revenueCatSilentRefreshPromise) return revenueCatSilentRefreshPromise;

    revenueCatSilentRefreshPromise = ensureRevenueCatConfigured()
        .then(function (ok) {
            if (!ok) return;
            var Purchases = getRevenueCatPurchases();
            if (!Purchases) return;
            return Purchases.getCustomerInfo();
        })
        .then(function (result) {
            if (!result) return;
            applyRevenueCatCustomerInfo(result, 'revenuecat');
            if (typeof unlockPremiumFeatures === 'function') unlockPremiumFeatures();
        })
        .catch(function () {})
        .then(function () {
            revenueCatSilentRefreshPromise = null;
        });
    return revenueCatSilentRefreshPromise;
}

function initRevenueCatBilling() {
    if (!useRevenueCatBilling()) return;
    /* configure + listener: ensureRevenueCatConfigured() from load / refresh / checkout */
}