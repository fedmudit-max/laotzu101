/**
 * RevenueCat CustomerInfo → Entitlement access decisions.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
    createKingContext,
    resetKing,
    isoDaysFromNow,
    getState,
    setState,
} = require('./helpers/king-harness');

function applyRcCustomerInfo(ctx, customerInfo, source) {
    ctx.__customerInfo = customerInfo;
    const src = source != null ? source : 'revenuecat';
    return vm.runInContext(
        'applyRevenueCatCustomerInfo(__customerInfo, ' + JSON.stringify(src) + ')',
        ctx,
    );
}

function premiumEntitlement(overrides) {
    overrides = overrides || {};
    return Object.assign(
        {
            isActive: true,
            expirationDate: isoDaysFromNow(30),
        },
        overrides,
    );
}

function customerInfoWithPremium(ent) {
    return {
        entitlements: {
            active: {
                premium: ent,
            },
        },
    };
}

function stubNativeRcRefresh(ctx, plugin) {
    ctx.__rcPlugin = plugin;
    vm.runInContext(`
        window = {
            Capacitor: {
                isNativePlatform: function () { return true; },
                getPlatform: function () { return 'android'; },
                Plugins: { Purchases: __rcPlugin },
            },
        };
        refreshPremiumOfferUiIfVisible = function () {};
        unlockPremiumFeatures = function () {};
    `, ctx);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
}

test('active monthly subscription with valid future expiration grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(31);
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: until,
        productIdentifier: 'king_premium:monthly',
    }));
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
    assert.equal(s.source, 'revenuecat');
});

test('active annual subscription with valid future expiration grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(365);
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: until,
        productIdentifier: 'king_premium:yearly',
    }));
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(new Date(s.premiumUntil).getTime(), new Date(until).getTime());
});

test('expired subscription removes paid access when RC reports inactive', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        premiumUntil: isoDaysFromNow(30),
        source: 'revenuecat',
    });
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: false,
        expirationDate: isoDaysFromNow(-1),
    }));
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('expired subscription clears store when RC reports premium inactive in all', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, { premiumUntil: isoDaysFromNow(10), source: 'revenuecat' });
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {},
            all: { premium: { isActive: false, expirationDate: isoDaysFromNow(-1) } },
        },
    });
    assert.equal(getState(ctx).premiumUntil, '');
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('cancelled but still in paid period keeps access until expiration', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const paidThrough = isoDaysFromNow(12);
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: paidThrough,
        unsubscribeDetectedAt: isoDaysFromNow(0),
    }));
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
});

test('refunded or revoked subscription clears paid access on RC confirmation', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, { premiumUntil: isoDaysFromNow(20), source: 'revenuecat' });
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {},
            all: { premium: { isActive: false, expirationDate: isoDaysFromNow(-1) } },
        },
    });
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
});

test('missing expirationDate does not invent paid cache extension', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
        premiumUntil: '',
        source: '',
    });
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: null,
    }));
    const s = getState(ctx);
    assert.equal(s.premiumUntil, '');
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), false);
});

test('invalid expirationDate does not grant invented paid window', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: 'not-a-valid-date',
    }));
    assert.equal(getState(ctx).premiumUntil, '');
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('active without expiration preserves existing valid local cache (offline-safe)', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(5);
    setState(ctx, { premiumUntil: until, source: 'revenuecat' });
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: '',
    }));
    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
});

test('offline startup with valid cached entitlement grants paid access without RC', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(14);
    setState(ctx, { premiumUntil: until, source: 'revenuecat', lastVerifiedAt: isoDaysFromNow(-1) });
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
});

test('offline startup with expired cached entitlement denies paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        premiumUntil: isoDaysFromNow(-3),
        source: 'revenuecat',
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
});

test('RC refresh failure preserves previously valid cached entitlement', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(8);
    setState(ctx, { premiumUntil: until, source: 'revenuecat' });
    let resolveConfigure;
    const configurePromise = new Promise(function (r) { resolveConfigure = r; });
    stubNativeRcRefresh(ctx, {
        configure: function () { return configurePromise; },
        getCustomerInfo: function () { return Promise.reject(new Error('offline')); },
        addCustomerInfoUpdateListener: function () {},
    });
    const refresh = ctx.refreshStorePurchasesSilent();
    resolveConfigure();
    await refresh;
    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
});

test('expirationDateMillis grants paid access when expirationDate is missing', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const untilMs = Date.now() + 20 * 24 * 60 * 60 * 1000;
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: null,
        expirationDateMillis: untilMs,
    }));
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(new Date(s.premiumUntil).getTime(), untilMs);
});

test('latestExpirationDate grants paid access when entitlements.active is empty', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(28);
    applyRcCustomerInfo(ctx, {
        entitlements: { active: {} },
        latestExpirationDate: until,
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('customerInfo without entitlements still grants from latestExpirationDate', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(14);
    applyRcCustomerInfo(ctx, {
        latestExpirationDate: until,
        activeSubscriptions: ['king_premium:monthly'],
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('purchase result wrapped as customerInfo grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(15);
    applyRcCustomerInfo(ctx, {
        customerInfo: customerInfoWithPremium({
            isActive: true,
            expirationDate: until,
        }),
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('older CustomerInfo does not revoke a newer purchase', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(20);
    applyRcCustomerInfo(ctx, {
        requestDateMillis: 2000,
        entitlements: {
            active: {
                premium: { isActive: true, expirationDate: until },
            },
        },
    });
    applyRcCustomerInfo(ctx, {
        requestDateMillis: 1000,
        entitlements: { active: {} },
    });
    assert.equal(getState(ctx).premiumUntil, new Date(until).toISOString());
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('successful RC refresh with no active subscription clears RC-paid cache', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, { premiumUntil: isoDaysFromNow(30), source: 'revenuecat' });
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {},
            all: { premium: { isActive: false, expirationDate: isoDaysFromNow(-2) } },
        },
    });
    assert.equal(getState(ctx).premiumUntil, '');
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('no paid subscription but active local trial still has premium access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-4),
        appStartDate: '2026-06-11',
        premiumUntil: '',
        source: '',
    });
    applyRcCustomerInfo(ctx, { entitlements: { active: {} } });
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isTrialActive(s), true);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
});

test('empty active map does not revoke a still-valid local paid cache', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(18);
    setState(ctx, { premiumUntil: until, source: 'revenuecat' });
    applyRcCustomerInfo(ctx, { entitlements: { active: {} } });
    assert.equal(getState(ctx).premiumUntil, until);
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('inactive premium in all without past expiration does not revoke checkout grant', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(28);
    setState(ctx, { premiumUntil: until, source: 'revenuecat' });
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {},
            all: { premium: { isActive: false } },
        },
        activeSubscriptions: ['king_premium:monthly'],
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('inactive premium in all still grants from latestExpirationDate after purchase', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(31);
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {},
            all: { premium: { isActive: false } },
        },
        latestExpirationDate: until,
        activeSubscriptions: ['king_premium:yearly'],
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('expirationDateMillis in unix seconds grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const untilMs = Date.now() + 25 * 24 * 60 * 60 * 1000;
    const untilSec = Math.floor(untilMs / 1000);
    applyRcCustomerInfo(ctx, customerInfoWithPremium({
        isActive: true,
        expirationDate: null,
        expirationDateMillis: untilSec,
    }));
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(Math.abs(new Date(s.premiumUntil).getTime() - untilSec * 1000) < 1000, true);
});

test('premium entitlement in all (not active map) with isActive grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(21);
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {},
            all: { premium: { isActive: true, expirationDate: until } },
        },
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('case-insensitive entitlement identifier grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(9);
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: {
                Premium: { isActive: true, expirationDate: until, identifier: 'Premium' },
            },
        },
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('active entitlements array grants paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(11);
    applyRcCustomerInfo(ctx, {
        entitlements: {
            active: [{ identifier: 'premium', isActive: true, expirationDate: until }],
        },
    });
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('no paid subscription but journey grace on journey 2 grants grace access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-15',
        premiumUntil: '',
        source: '',
        attempt: 2,
    });
    applyRcCustomerInfo(ctx, { entitlements: { active: {} } });
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
    assert.equal(ctx.canAccessJourneyGracePremiumFeature(), true);
});