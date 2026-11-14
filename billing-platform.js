/**
 * billing-platform.js — Route store billing to RevenueCat or native KingBilling (Play).
 */

function storeBillingUsesRevenueCat() {
    return typeof useRevenueCatBilling === 'function'
        && useRevenueCatBilling()
        && typeof getRevenueCatApiKey === 'function'
        && !!getRevenueCatApiKey();
}

function isNativePremiumStoreAvailable() {
    if (storeBillingUsesRevenueCat()) {
        return typeof getRevenueCatPurchases === 'function' && !!getRevenueCatPurchases();
    }
    return !!getKingBillingPlugin();
}

function initStoreBilling() {
    if (storeBillingUsesRevenueCat()) {
        initRevenueCatBilling();
        return;
    }
    bindPlayPurchasesListener();
}

function loadStoreOffers() {
    if (storeBillingUsesRevenueCat()) {
        loadRevenueCatOffers();
        return;
    }
    loadPlayOffers();
}

function refreshStorePurchasesSilent() {
    if (storeBillingUsesRevenueCat()) {
        refreshRevenueCatSilent();
        return;
    }
    refreshPlayPurchasesSilent();
}

function startStoreCheckout(planId) {
    if (storeBillingUsesRevenueCat()) {
        return startRevenueCatCheckout(planId);
    }
    return startPremiumCheckoutNativePlay(planId);
}

function restoreStoreAccess() {
    if (storeBillingUsesRevenueCat()) {
        return restoreRevenueCatAccess();
    }
    return restorePremiumAccessNativePlay();
}