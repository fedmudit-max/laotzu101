/**
 * billing-platform.js — RevenueCat billing router (King 1.0.2 RC-only track).
 * No KingBilling / legacy Play JS fallback when KING_USE_REVENUECAT is true.
 */

function storeBillingUsesRevenueCat() {
    return typeof KING_USE_REVENUECAT !== 'undefined' && !!KING_USE_REVENUECAT;
}

function isKingNativeShell() {
    var Cap = typeof window !== 'undefined' ? window.Capacitor : null;
    return !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
}

/** RevenueCat flag on, native shell, API key set, Purchases plugin present. */
function isRevenueCatBillingReady() {
    if (!storeBillingUsesRevenueCat()) return false;
    if (!isKingNativeShell()) return false;
    var key = typeof getRevenueCatApiKey === 'function' ? getRevenueCatApiKey() : '';
    if (!key) return false;
    return typeof getRevenueCatPurchases === 'function' && !!getRevenueCatPurchases();
}

function preferRevenueCatStore() {
    return storeBillingUsesRevenueCat();
}

function isNativePremiumStoreAvailable() {
    if (storeBillingUsesRevenueCat()) {
        return isKingNativeShell();
    }
    return false;
}

function initStoreBilling() {
    if (!storeBillingUsesRevenueCat()) return;
    initRevenueCatBilling();
}

function loadStoreOffers() {
    if (!storeBillingUsesRevenueCat()) return;
    loadRevenueCatOffers();
}

function refreshStorePurchasesSilent() {
    if (!storeBillingUsesRevenueCat()) {
        return Promise.resolve();
    }
    return refreshRevenueCatSilent();
}

function startStoreCheckout(planId) {
    if (!storeBillingUsesRevenueCat()) return Promise.resolve();
    return startRevenueCatCheckout(planId);
}

function restoreStoreAccess() {
    if (!storeBillingUsesRevenueCat()) return Promise.resolve();
    return restoreRevenueCatAccess();
}