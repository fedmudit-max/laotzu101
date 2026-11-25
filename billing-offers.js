/**
 * billing-offers.js — Premium offer model: normalize plans, load state, getPremiumOffer().
 *
 * Symptom → function:
 *   Wrong/mock price on paywall → getPremiumOffer(), setPremiumOfferFromStore()
 *   Annual % badge wrong → enrichAnnualSavings()
 *
 * Does not call Play or paint UI. Store modules feed setPremiumOfferFromStore;
 * billing-ui reads getPremiumOffer() only.
 */

let storePremiumOffer = null;
/** Native store path: idle | loading | loaded | unavailable */
let premiumOfferLoadState = 'idle';
/** Last billing failure — paywall when source is unavailable (RevenueCat-only when flag on). */
let lastNativeBillingDiagnostic = '';
let lastNativeBillingDiagnosticCode = '';

var BILLING_DIAG_CODE = {
    RC_SDK_UNAVAILABLE: 'RC_SDK_UNAVAILABLE',
    RC_API_KEY_MISSING: 'RC_API_KEY_MISSING',
    RC_CONFIGURE_FAILED: 'RC_CONFIGURE_FAILED',
    RC_GET_OFFERINGS_FAILED: 'RC_GET_OFFERINGS_FAILED',
    RC_NO_CURRENT_OFFERING: 'RC_NO_CURRENT_OFFERING',
    RC_OFFERING_NO_PACKAGES: 'RC_OFFERING_NO_PACKAGES',
    RC_PACKAGES_UNMAPPED: 'RC_PACKAGES_UNMAPPED',
    RC_PLAY_PRODUCT_UNAVAILABLE: 'RC_PLAY_PRODUCT_UNAVAILABLE',
};

function billingDiagUserMessage(code) {
    if (!code) return '';
    var map = typeof PREMIUM_BILLING_DIAG_USER !== 'undefined' ? PREMIUM_BILLING_DIAG_USER : {};
    return map[code] || '';
}

function setNativeBillingFailure(code, technicalDetail) {
    lastNativeBillingDiagnosticCode = code ? String(code) : '';
    var user = billingDiagUserMessage(lastNativeBillingDiagnosticCode);
    if (user) {
        lastNativeBillingDiagnostic = user;
    } else if (technicalDetail) {
        lastNativeBillingDiagnostic = String(technicalDetail);
    } else {
        lastNativeBillingDiagnostic = '';
    }
    if (typeof logOptionalFailure === 'function' && technicalDetail && technicalDetail !== user) {
        logOptionalFailure('billing:' + (code || 'unknown'), technicalDetail);
    }
}

function getNativeBillingDiagnostic() {
    return lastNativeBillingDiagnostic || '';
}

function getNativeBillingDiagnosticCode() {
    return lastNativeBillingDiagnosticCode || '';
}

function clearNativeBillingFailure() {
    lastNativeBillingDiagnostic = '';
    lastNativeBillingDiagnosticCode = '';
}

function planDiscountPercent(listAmount, amount) {
    var list = Number(listAmount);
    var sale = Number(amount);
    if (!(list > 0) || !(sale >= 0) || sale >= list) return 0;
    return Math.round(((list - sale) / list) * 100);
}

function planPeriodSuffix(period, id) {
    if (period === 'year' || id === 'annual') return '/year';
    return '/month';
}

function planAmountNumber(plan) {
    if (!plan) return 0;
    if (plan.amount != null && Number(plan.amount) > 0) return Number(plan.amount);
    var raw = String(plan.price || '');
    if (!raw) return 0;
    var cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
    var n = parseFloat(cleaned);
    return n > 0 ? n : 0;
}

/** Keep currency framing from a store price string; swap in a new number. */
function formatAmountLike(referencePrice, amount) {
    var ref = String(referencePrice || '');
    var useDecimals = /\.\d{2}\b/.test(ref);
    var value = useDecimals ? Number(amount).toFixed(2) : String(Math.round(Number(amount)));
    var match = ref.match(/^([^\d-]*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (match) return match[1] + value + match[3];
    if (ref.indexOf('₹') !== -1) return '₹' + value;
    return value;
}

/** Annual savings badge only when monthly × 12 and annual prices come from the store (same currency). */
function showPlanPricesInUi() {
    return typeof KING_SHOW_PLAN_PRICES === 'undefined' || KING_SHOW_PLAN_PRICES === true;
}

function stripVisiblePlanPrices(plans) {
    return (plans || []).map(function (p) {
        var copy = Object.assign({}, p);
        delete copy.price;
        delete copy.listPrice;
        delete copy.listAmount;
        delete copy.amount;
        delete copy.discountPct;
        return copy;
    });
}

function enrichAnnualSavings(plans) {
    if (!showPlanPricesInUi()) return plans || [];
    var list = plans || [];
    var monthly = null;
    var annual = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === 'monthly') monthly = list[i];
        if (list[i].id === 'annual') annual = list[i];
    }
    if (!annual) return list;

    var annualAmt = planAmountNumber(annual);
    if (!(annualAmt > 0)) return list;

    var monthlyAmt = monthly ? planAmountNumber(monthly) : 0;
    if (!(monthlyAmt > 0)) {
        delete annual.listPrice;
        delete annual.listAmount;
        delete annual.discountPct;
        return list;
    }

    var compareAmt = monthlyAmt * 12;
    if (!(compareAmt > annualAmt)) {
        delete annual.listPrice;
        delete annual.listAmount;
        delete annual.discountPct;
        return list;
    }

    var pct = planDiscountPercent(compareAmt, annualAmt);
    if (!(pct > 0)) {
        delete annual.listPrice;
        delete annual.listAmount;
        delete annual.discountPct;
        return list;
    }

    annual.listAmount = compareAmt;
    annual.listPrice = formatAmountLike(annual.price, compareAmt);
    annual.discountPct = pct;
    return list;
}

function normalizePremiumPlan(p) {
    p = p || {};
    var id = p.id || p.period || 'monthly';
    var listAmount = p.listAmount != null ? Number(p.listAmount) : 0;
    var amount = p.amount != null ? Number(p.amount) : 0;
    var period = p.period || (id === 'annual' ? 'year' : 'month');
    var plan = { id: id, period: period };

    if (showPlanPricesInUi()) {
        if (p.price) {
            plan.price = String(p.price);
        } else if (amount > 0) {
            plan.price = '₹' + amount + planPeriodSuffix(period, id);
        }
        if (amount > 0) plan.amount = amount;

        if (id !== 'annual') {
            if (p.listPrice) {
                plan.listPrice = String(p.listPrice);
                if (p.discountPct) plan.discountPct = p.discountPct;
            } else if (listAmount > 0 && amount > 0 && listAmount > amount) {
                plan.listAmount = listAmount;
                plan.listPrice = '₹' + listAmount;
                plan.discountPct = planDiscountPercent(listAmount, amount);
            }
        }
    }

    if (id === 'annual') {
        plan.message = p.message || PREMIUM_ANNUAL_VALUE_MESSAGE;
    } else if (p.message) {
        plan.message = p.message;
    }
    return plan;
}

function normalizePremiumPlans(plans, allowMockFallback) {
    var src = plans && plans.length ? plans : (allowMockFallback ? PREMIUM_PLANS_MOCK : []);
    if (!src.length) return [];
    return enrichAnnualSavings(src.map(normalizePremiumPlan));
}

function usesNativeBillingPricing() {
    if (typeof storeBillingUsesRevenueCat === 'function' && storeBillingUsesRevenueCat()) {
        return typeof isKingNativeShell === 'function' && isKingNativeShell();
    }
    if (typeof isKingNativeShell === 'function' && isKingNativeShell()) {
        return true;
    }
    if (typeof isNativePremiumStoreAvailable === 'function') {
        return isNativePremiumStoreAvailable();
    }
    return false;
}

/** Dev mock INR plans: local web only (localhost / node tests). Never on GitHub Pages or Android. */
function allowsMockPremiumPricing() {
    if (usesNativeBillingPricing()) return false;
    if (typeof location === 'undefined') return true;
    var host = String(location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
}

/**
 * Store modules call when Play/App Store returns localized products.
 * @param {{ price?: string, trialDays?: number, plans?: Array, source?: string }|null} offer
 */
function setPremiumOfferFromStore(offer) {
    if (!offer || typeof offer !== 'object') {
        storePremiumOffer = null;
        return;
    }
    var plans = offer.plans;
    if ((!plans || !plans.length) && offer.price) {
        plans = [{ id: 'monthly', price: offer.price }];
    }
    if (!plans || !plans.length) {
        storePremiumOffer = null;
        return;
    }
    storePremiumOffer = {
        trialDays: offer.trialDays != null ? Number(offer.trialDays) : PREMIUM_TRIAL_DAYS,
        plans: normalizePremiumPlans(plans, false),
        source: offer.source || 'store',
    };
    premiumOfferLoadState = 'loaded';
}

/**
 * Offer for the Premium modal only.
 * Access must not read this — Entitlement.getAccess() owns “is Premium?”.
 */
function getPremiumOffer() {
    function withDisplayPlans(offer) {
        if (!offer || !offer.plans) return offer;
        if (showPlanPricesInUi()) return offer;
        return Object.assign({}, offer, { plans: stripVisiblePlanPrices(offer.plans) });
    }
    if (storePremiumOffer && storePremiumOffer.plans && storePremiumOffer.plans.length) {
        return withDisplayPlans({
            trialDays: storePremiumOffer.trialDays || PREMIUM_TRIAL_DAYS,
            plans: storePremiumOffer.plans,
            source: storePremiumOffer.source || 'store',
        });
    }
    if (usesNativeBillingPricing()) {
        if (premiumOfferLoadState === 'unavailable') {
            return withDisplayPlans({
                trialDays: PREMIUM_TRIAL_DAYS,
                plans: [],
                source: 'unavailable',
                diagnosticCode: getNativeBillingDiagnosticCode(),
            });
        }
        return withDisplayPlans({
            trialDays: PREMIUM_TRIAL_DAYS,
            plans: [],
            source: 'loading',
        });
    }
    if (allowsMockPremiumPricing()) {
        return withDisplayPlans({
            trialDays: PREMIUM_TRIAL_DAYS,
            plans: normalizePremiumPlans(PREMIUM_PLANS_MOCK, true),
            source: 'mock',
        });
    }
    return withDisplayPlans({
        trialDays: PREMIUM_TRIAL_DAYS,
        plans: [],
        source: 'web',
    });
}
