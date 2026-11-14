/**
 * billing-store-revenuecat.js — RevenueCat Purchases (Play + App Store via RC).
 * Active when KING_USE_REVENUECAT is true and a platform API key is set.
 *
 * Requires: npm install @revenuecat/purchases-capacitor && npx cap sync
 */

var revenueCatConfigured = false;
var revenueCatConfigurePromise = null;
var revenueCatCheckoutInFlight = false;
var revenueCatRestoreInFlight = false;
var cachedRevenueCatOfferings = null;

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

function isRevenueCatConfigured() {
    return revenueCatConfigured && !!getRevenueCatPurchases();
}

function revenueCatEntitlementId() {
    return typeof REVENUECAT_ENTITLEMENT_ID !== 'undefined' ? REVENUECAT_ENTITLEMENT_ID : 'premium';
}

function revenueCatPackageIdForPlan(planId) {
    var map = typeof REVENUECAT_PACKAGE_IDENTIFIERS !== 'undefined' ? REVENUECAT_PACKAGE_IDENTIFIERS : {};
    return map[planId] || planId;
}

function premiumUntilFromRevenueCatEntitlement(ent) {
    var nowIso = new Date().toISOString();
    if (!ent || !ent.isActive) return { until: '', at: nowIso };
    if (ent.expirationDate) {
        var d = new Date(ent.expirationDate);
        if (!Number.isNaN(d.getTime())) {
            return { until: d.toISOString(), at: nowIso };
        }
    }
    if (typeof playAccessCacheUntilIso === 'function') {
        return { until: playAccessCacheUntilIso(), at: nowIso };
    }
    var days = typeof PREMIUM_PLAY_CACHE_DAYS === 'number' ? PREMIUM_PLAY_CACHE_DAYS : 3;
    return { until: new Date(Date.now() + days * MS_PER_DAY).toISOString(), at: nowIso };
}

function applyRevenueCatCustomerInfo(customerInfo, source) {
    source = source === 'restore' ? 'restore' : 'revenuecat';
    if (!customerInfo || !customerInfo.entitlements || !customerInfo.entitlements.active) {
        return { applied: false, active: false };
    }
    var ent = customerInfo.entitlements.active[revenueCatEntitlementId()];
    var dates = premiumUntilFromRevenueCatEntitlement(ent);
    if (ent && ent.isActive) {
        updateEntitlementSnapshot({
            premiumUntil: dates.until,
            lastVerifiedAt: dates.at,
            source: source,
        });
        return { applied: true, active: true };
    }
    if (state.source === 'revenuecat' || state.source === 'restore') {
        updateEntitlementSnapshot({
            premiumUntil: '',
            lastVerifiedAt: dates.at,
            source: state.source,
        });
    }
    return { applied: true, active: false };
}

function plansFromRevenueCatPackages(packages) {
    var out = [];
    var list = packages || [];
    var map = typeof REVENUECAT_PACKAGE_IDENTIFIERS !== 'undefined' ? REVENUECAT_PACKAGE_IDENTIFIERS : {};
    var planByPkg = {};
    Object.keys(map).forEach(function (planId) {
        planByPkg[map[planId]] = planId;
    });
    for (var i = 0; i < list.length; i++) {
        var pkg = list[i];
        if (!pkg || !pkg.identifier) continue;
        var planId = planByPkg[pkg.identifier] || pkg.identifier;
        var product = pkg.product || {};
        var period = planId === 'annual' ? 'year' : 'month';
        var plan = {
            id: planId,
            period: period,
            price: product.priceString || '',
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
    var Purchases = getRevenueCatPurchases();
    var apiKey = getRevenueCatApiKey();
    if (!Purchases || !apiKey) return Promise.resolve(false);
    if (revenueCatConfigured) return Promise.resolve(true);
    if (revenueCatConfigurePromise) return revenueCatConfigurePromise;

    revenueCatConfigurePromise = Purchases.configure({ apiKey: apiKey })
        .then(function () {
            revenueCatConfigured = true;
            return true;
        })
        .catch(function (err) {
            console.warn('[King RC] configure failed', err);
            revenueCatConfigurePromise = null;
            return false;
        });
    return revenueCatConfigurePromise;
}

function loadRevenueCatOffers() {
    if (!useRevenueCatBilling()) return;
    if (!storePremiumOffer) {
        premiumOfferLoadState = 'loading';
        refreshPremiumOfferUiIfVisible();
    }
    ensureRevenueCatConfigured().then(function (ok) {
        if (!ok) {
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        var Purchases = getRevenueCatPurchases();
        return Purchases.getOfferings();
    }).then(function (offerings) {
        if (!offerings) return;
        cachedRevenueCatOfferings = offerings;
        var current = offerings.current;
        if (!current || !current.availablePackages || !current.availablePackages.length) {
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
        }
        var plans = plansFromRevenueCatPackages(current.availablePackages);
        if (!plans.length) {
            if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
            refreshPremiumOfferUiIfVisible();
            return;
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
    }).catch(function () {
        if (!storePremiumOffer) premiumOfferLoadState = 'unavailable';
        refreshPremiumOfferUiIfVisible();
    });
}

function findRevenueCatPackageForPlan(planId) {
    if (!cachedRevenueCatOfferings || !cachedRevenueCatOfferings.current) return null;
    var want = revenueCatPackageIdForPlan(planId);
    var packages = cachedRevenueCatOfferings.current.availablePackages || [];
    for (var i = 0; i < packages.length; i++) {
        if (packages[i].identifier === want) return packages[i];
    }
    return null;
}

function startRevenueCatCheckout(planId) {
    if (revenueCatCheckoutInFlight) return Promise.resolve();
    revenueCatCheckoutInFlight = true;
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
        return Purchases.purchasePackage({ aPackage: pkg });
    }).then(function (result) {
        if (!result || !result.customerInfo) return;
        var next = applyRevenueCatCustomerInfo(result.customerInfo, 'revenuecat');
        if (next.active) onPremiumActivated();
    }).catch(function (err) {
        if (err && (err.userCancelled || err.code === '1')) return;
        showToast(0, 'Could not complete purchase. Try again.');
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
        if (!result || !result.customerInfo) {
            showToast(0, 'Could not reach the store. Try again.');
            return;
        }
        var hadPaid = Entitlement.isSubscriptionActive();
        var next = applyRevenueCatCustomerInfo(result.customerInfo, 'restore');
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
    if (!useRevenueCatBilling() || !isRevenueCatConfigured()) return;
    var Purchases = getRevenueCatPurchases();
    if (!Purchases) return;
    Purchases.getCustomerInfo()
        .then(function (result) {
            if (!result || !result.customerInfo) return;
            applyRevenueCatCustomerInfo(result.customerInfo, 'revenuecat');
            unlockPremiumFeatures();
        })
        .catch(function () {});
}

function bindRevenueCatListener() {
    var Purchases = getRevenueCatPurchases();
    if (!Purchases || typeof Purchases.addCustomerInfoUpdateListener !== 'function') return;
    Purchases.addCustomerInfoUpdateListener(function (customerInfo) {
        applyRevenueCatCustomerInfo(customerInfo, 'revenuecat');
        unlockPremiumFeatures();
    });
}

function initRevenueCatBilling() {
    if (!useRevenueCatBilling()) return;
    ensureRevenueCatConfigured().then(function (ok) {
        if (ok) bindRevenueCatListener();
    });
}