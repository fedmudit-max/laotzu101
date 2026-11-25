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

function stubNativeAndroidShell(ctx) {
    vm.runInContext(`
        window = {
            Capacitor: {
                isNativePlatform: function () { return true; },
                getPlatform: function () { return 'android'; },
                Plugins: {},
            },
        };
    `, ctx);
}

function stubNativeRevenueCat(ctx, purchasesPlugin) {
    ctx.__rcPlugin = purchasesPlugin || {};
    vm.runInContext(`
        window = {
            Capacitor: {
                isNativePlatform: function () { return true; },
                getPlatform: function () { return 'android'; },
                Plugins: { Purchases: __rcPlugin },
            },
        };
    `, ctx);
}

function stubRcStartupHelpers(ctx) {
    vm.runInContext(
        'refreshPremiumOfferUiIfVisible = function () {}; unlockPremiumFeatures = function () {};',
        ctx,
    );
}

function activePremiumCustomerInfo(untilDays) {
    const until = untilDays != null ? isoDaysFromNow(untilDays) : isoDaysFromNow(30);
    return {
        entitlements: {
            active: {
                premium: {
                    isActive: true,
                    expirationDate: until,
                },
            },
        },
    };
}

function createDelayedConfigurePlugin(opts) {
    opts = opts || {};
    let resolveConfigure;
    let rejectConfigure;
    const configurePromise = new Promise(function (resolve, reject) {
        resolveConfigure = resolve;
        rejectConfigure = reject;
    });
    const calls = { configure: 0, getCustomerInfo: 0, getOfferings: 0 };
    const plugin = {
        configure: function () {
            calls.configure += 1;
            if (opts.configureReject) {
                return Promise.reject(new Error('configure failed'));
            }
            return configurePromise;
        },
        getCustomerInfo: function () {
            calls.getCustomerInfo += 1;
            if (opts.getCustomerInfoReject) {
                return Promise.reject(new Error('network'));
            }
            return Promise.resolve({
                customerInfo: opts.customerInfo != null ? opts.customerInfo : null,
            });
        },
        getOfferings: function () {
            calls.getOfferings += 1;
            if (opts.getOfferingsReject) {
                return Promise.reject(new Error('offerings'));
            }
            return Promise.resolve(
                opts.offerings || {
                    current: {
                        availablePackages: [
                            {
                                identifier: '$rc_monthly',
                                product: { priceString: '₹199', price: 199 },
                            },
                        ],
                    },
                },
            );
        },
        addCustomerInfoUpdateListener: function () {},
    };
    return {
        plugin,
        resolveConfigure: function () { resolveConfigure(); },
        rejectConfigure: function () { rejectConfigure(new Error('configure failed')); },
        calls,
    };
}

test('RevenueCat flag on uses only RevenueCat offer loader', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidShell(ctx);
    stubNativeRevenueCat(ctx, {
        configure: function () { return Promise.resolve(); },
        getOfferings: function () { return Promise.resolve({ current: null, all: {} }); },
        addCustomerInfoUpdateListener: function () {},
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "";', ctx);
    assert.equal(ctx.storeBillingUsesRevenueCat(), true);
    assert.equal(ctx.isRevenueCatBillingReady(), false);
    assert.equal(ctx.preferRevenueCatStore(), true);
    vm.runInContext('refreshPremiumOfferUiIfVisible = function () {};', ctx);
    ctx.loadStoreOffers();
    await new Promise(function (r) { setTimeout(r, 30); });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'unavailable');
    assert.equal(offer.diagnosticCode, 'RC_API_KEY_MISSING');
});

test('startup billing init registers one customer-info listener', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const listeners = { n: 0 };
    stubNativeRevenueCat(ctx, {
        configure: function () { return Promise.resolve(); },
        getOfferings: function () {
            return Promise.resolve({
                current: {
                    availablePackages: [
                        { identifier: '$rc_monthly', product: { priceString: '₹1', price: 1 } },
                    ],
                },
            });
        },
        addCustomerInfoUpdateListener: function () { listeners.n += 1; },
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    vm.runInContext('refreshPremiumOfferUiIfVisible = function () {};', ctx);
    ctx.initStoreBilling();
    ctx.loadStoreOffers();
    ctx.refreshStorePurchasesSilent();
    await new Promise(function (r) { setTimeout(r, 60); });
    assert.equal(listeners.n, 1);
});

test('parallel ensureRevenueCatConfigured shares one configure call', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const calls = { configure: 0 };
    stubNativeRevenueCat(ctx, {
        configure: function () {
            calls.configure += 1;
            return Promise.resolve();
        },
        getOfferings: function () { return Promise.resolve({ current: null, all: {} }); },
        addCustomerInfoUpdateListener: function () {},
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    const a = ctx.ensureRevenueCatConfigured();
    const b = ctx.ensureRevenueCatConfigured();
    const c = ctx.ensureRevenueCatConfigured();
    await Promise.all([a, b, c]);
    assert.equal(calls.configure, 1);
});

test('web harness still uses mock pricing with RevenueCat flag on', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'mock');
});

test('RevenueCat configure without a promise still loads offerings', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeRevenueCat(ctx, {
        configure: function () {},
        getOfferings: function () {
            return Promise.resolve({
                current: {
                    availablePackages: [
                        {
                            identifier: '$rc_monthly',
                            packageType: 'MONTHLY',
                            product: { identifier: 'king_premium:monthly', priceString: '₹149', price: 149 },
                        },
                        {
                            identifier: '$rc_annual',
                            packageType: 'ANNUAL',
                            product: { identifier: 'king_premium:yearly', priceString: '₹999', price: 999 },
                        },
                    ],
                },
            });
        },
        addCustomerInfoUpdateListener: function () {},
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    vm.runInContext('refreshPremiumOfferUiIfVisible = function () {};', ctx);
    ctx.loadStoreOffers();
    await new Promise(function (r) { setTimeout(r, 30); });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'revenuecat');
    assert.equal(offer.plans.length, 2);
    assert.equal(offer.plans[0].id, 'annual');
    assert.equal(offer.plans[1].id, 'monthly');
});

test('RevenueCat offerings route through platform without KingBilling', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const configured = { done: false };
    stubNativeRevenueCat(ctx, {
        configure: function () {
            configured.done = true;
            return Promise.resolve();
        },
        getOfferings: function () {
            return Promise.resolve({
                current: {
                    availablePackages: [
                        {
                            identifier: '$rc_monthly',
                            product: { priceString: '₹199', price: 199 },
                        },
                    ],
                },
            });
        },
        addCustomerInfoUpdateListener: function () {},
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    vm.runInContext('refreshPremiumOfferUiIfVisible = function () {};', ctx);
    assert.equal(ctx.isRevenueCatBillingReady(), true);
    ctx.loadStoreOffers();
    await new Promise(function (r) { setTimeout(r, 50); });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'revenuecat');
    assert.equal(offer.plans.length, 1);
    assert.ok(configured.done);
});

test('getPremiumOffer uses mock plans on web harness', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'mock');
    assert.ok(offer.plans.length >= 2);
    assert.equal(offer.plans[0].price, undefined);
    assert.equal(offer.plans[0].id, 'monthly');
});

test('getPremiumOffer never shows mock on native without store prices', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidShell(ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'loading');
    assert.equal(offer.plans.length, 0);
});

test('getPremiumOffer shows RevenueCat prices after setPremiumOfferFromStore', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidShell(ctx);
    ctx.setPremiumOfferFromStore({
        source: 'revenuecat',
        plans: [
            { id: 'monthly', price: '$4.99', amount: 4.99 },
            { id: 'annual', price: '$39.99', amount: 39.99 },
        ],
    });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'revenuecat');
    assert.equal(offer.plans[0].price, '$4.99');
    assert.equal(offer.plans[1].price, '$39.99');
});

test('annual savings badge uses monthly x12 vs annual store amounts', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    ctx.setPremiumOfferFromStore({
        source: 'revenuecat',
        plans: [
            { id: 'monthly', price: '₹100', amount: 100 },
            { id: 'annual', price: '₹900', amount: 900 },
        ],
    });
    const offer = ctx.getPremiumOffer();
    const annual = offer.plans.find(function (p) { return p.id === 'annual'; });
    assert.ok(annual);
    assert.equal(annual.discountPct, 25);
    assert.ok(annual.listPrice);
});

test('getPremiumOffer unavailable when store pricing load fails on native', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidShell(ctx);
    vm.runInContext('premiumOfferLoadState = "unavailable"', ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'unavailable');
    assert.equal(offer.plans.length, 0);
});

test('getPremiumOffer never shows mock on production web host', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    vm.runInContext('location = { hostname: "fedmudit-max.github.io" };', ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'web');
    assert.equal(offer.plans.length, 0);
});

test('updateEntitlementSnapshot accepts revenuecat source', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(3);
    ctx.updateEntitlementSnapshot({
        source: 'revenuecat',
        premiumUntil: until,
        lastVerifiedAt: isoDaysFromNow(0),
    });
    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(s.source, 'revenuecat');
});

test('updateEntitlementSnapshot ignores non-play sources', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, { premiumUntil: '' });
    ctx.updateEntitlementSnapshot({
        source: 'dev',
        premiumUntil: isoDaysFromNow(30),
    });
    assert.equal(getState(ctx).premiumUntil, '');
});

test('updateEntitlementSnapshot writes play purchase cache', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(3);
    const verified = isoDaysFromNow(0);

    ctx.updateEntitlementSnapshot({
        source: 'play',
        premiumUntil: until,
        lastVerifiedAt: verified,
    });

    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(s.lastVerifiedAt, verified);
    assert.equal(s.source, 'play');
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
});

test('restore source updates entitlement like play', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(3);

    ctx.updateEntitlementSnapshot({
        source: 'restore',
        premiumUntil: until,
        lastVerifiedAt: isoDaysFromNow(0),
    });

    const s = getState(ctx);
    assert.equal(s.source, 'restore');
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
});

test('expired cache after restore denies premium when trial ended', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-30' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-40),
        appStartDate: '2026-05-25',
        journeyStartDate: '2026-06-15',
        lastOpenedDate: '2026-06-30',
        calendarDay: 16,
    });
    ctx.updateEntitlementSnapshot({
        source: 'restore',
        premiumUntil: isoDaysFromNow(-1),
        lastVerifiedAt: isoDaysFromNow(-2),
    });

    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
});

test('premium trial panel phase is early during trial', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-9),
        appStartDate: '2026-06-06',
        calendarDay: 10,
        journeyStartDate: '2026-06-06',
    });
    assert.equal(ctx.getPremiumTrialPanelPhase(), 'early');
});

test('premium trial panel phase stays early in the last trial week', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-10),
        appStartDate: '2026-06-05',
        calendarDay: 11,
        journeyStartDate: '2026-06-05',
    });
    assert.equal(ctx.getPremiumTrialPanelPhase(), 'early');
});

test('premium trial panel phase is expired after trial ends', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-40),
        appStartDate: '2026-05-26',
        premiumUntil: '',
        calendarDay: 20,
        journeyStartDate: '2026-05-26',
    });
    assert.equal(ctx.getPremiumTrialPanelPhase(), 'expired');
});

test('premium trial panel phase is active for paid subscription', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-40),
        premiumUntil: isoDaysFromNow(2),
        source: 'play',
    });
    assert.equal(ctx.getPremiumTrialPanelPhase(), 'active');
});

test('journey grace premium lock stays open through journey 2 after trial', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-4),
        appStartDate: '2026-06-11',
        calendarDay: 5,
        journeyStartDate: '2026-06-11',
        attempt: 2,
    });
    assert.equal(ctx.Entitlement.isTrialActive(getState(ctx)), true);
    assert.equal(ctx.shouldLockJourneyGracePremiumFeature(), false);
});

test('journey grace premium lock from journey 3 even during trial', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-2),
        appStartDate: '2026-06-13',
        calendarDay: 3,
        journeyStartDate: '2026-06-13',
        attempt: 3,
    });
    assert.equal(ctx.Entitlement.isTrialActive(getState(ctx)), true);
    assert.equal(ctx.shouldLockJourneyGracePremiumFeature(), false);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
        attempt: 3,
        premiumUntil: '',
        source: '',
    });
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
    assert.equal(ctx.shouldLockJourneyGracePremiumFeature(), true);
    setState(ctx, { attempt: 2 });
    assert.equal(ctx.shouldLockJourneyGracePremiumFeature(), false);
});

test('canAccessJourneyGracePremiumFeature on journey 2 after install trial ended', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-15',
        attempt: 2,
    });
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
    assert.equal(ctx.canAccessJourneyGracePremiumFeature(), true);
});

test('journey grace premium lock never applies when paid subscription is active', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        attempt: 5,
        premiumUntil: isoDaysFromNow(30),
        source: 'play',
    });
    assert.equal(ctx.shouldLockJourneyGracePremiumFeature(), false);
});

test('startup refresh waits for async RevenueCat configure before customerInfo', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({
        customerInfo: activePremiumCustomerInfo(30),
    });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    setState(ctx, { premiumUntil: '', source: '' });

    ctx.initStoreBilling();
    ctx.loadStoreOffers();
    const refresh = ctx.refreshStorePurchasesSilent();
    await new Promise(function (r) { setTimeout(r, 15); });
    assert.equal(rc.calls.getCustomerInfo, 0);

    rc.resolveConfigure();
    await refresh;
    assert.equal(rc.calls.configure, 1);
    assert.equal(rc.calls.getCustomerInfo, 1);
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
    assert.equal(getState(ctx).source, 'revenuecat');
});

test('silent refresh grants paid access when local cache expired', async () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({
        customerInfo: activePremiumCustomerInfo(10),
    });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    setState(ctx, {
        premiumUntil: isoDaysFromNow(-5),
        source: 'revenuecat',
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
    });
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);

    const refresh = ctx.refreshStorePurchasesSilent();
    rc.resolveConfigure();
    await refresh;
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), true);
});

test('silent refresh does not grant premium without active RC entitlement', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({
        customerInfo: { entitlements: { active: {} } },
    });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    setState(ctx, { premiumUntil: '', source: '' });

    const refresh = ctx.refreshStorePurchasesSilent();
    rc.resolveConfigure();
    await refresh;
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('silent refresh does not grant premium when RevenueCat configure fails', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({ configureReject: true });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);

    const refresh = ctx.refreshStorePurchasesSilent();
    await refresh;
    assert.equal(rc.calls.getCustomerInfo, 0);
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('silent refresh leaves state unchanged when customerInfo network fails', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({ getCustomerInfoReject: true });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    const until = isoDaysFromNow(-2);
    setState(ctx, { premiumUntil: until, source: 'revenuecat' });

    const refresh = ctx.refreshStorePurchasesSilent();
    rc.resolveConfigure();
    await refresh;
    assert.equal(getState(ctx).premiumUntil, until);
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
});

test('parallel silent refresh calls coalesce into one customerInfo fetch', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({
        customerInfo: activePremiumCustomerInfo(5),
    });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);

    const a = ctx.refreshStorePurchasesSilent();
    const b = ctx.refreshStorePurchasesSilent();
    const c = ctx.refreshStorePurchasesSilent();
    rc.resolveConfigure();
    await Promise.all([a, b, c]);
    assert.equal(rc.calls.configure, 1);
    assert.equal(rc.calls.getCustomerInfo, 1);
});

test('premium restores when offerings fail but customerInfo succeeds on startup', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubRcStartupHelpers(ctx);
    const rc = createDelayedConfigurePlugin({
        customerInfo: activePremiumCustomerInfo(20),
        getOfferingsReject: true,
    });
    stubNativeRevenueCat(ctx, rc.plugin);
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    setState(ctx, { premiumUntil: '', source: '' });

    ctx.initStoreBilling();
    ctx.loadStoreOffers();
    const refresh = ctx.refreshStorePurchasesSilent();
    rc.resolveConfigure();
    await refresh;
    await new Promise(function (r) { setTimeout(r, 30); });

    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'unavailable');
});

test('RevenueCat maps catalog product ids when package identifiers are custom', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeRevenueCat(ctx, {
        configure: function () { return Promise.resolve(); },
        getOfferings: function () {
            return Promise.resolve({
                current: {
                    availablePackages: [
                        {
                            identifier: 'custom_month',
                            product: {
                                identifier: 'king_premium:monthly',
                                priceString: '₹149',
                                price: 149,
                            },
                        },
                        {
                            identifier: 'custom_year',
                            product: {
                                identifier: 'king_premium:yearly',
                                priceString: '₹999',
                                price: 999,
                            },
                        },
                    ],
                },
            });
        },
        addCustomerInfoUpdateListener: function () {},
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    vm.runInContext('refreshPremiumOfferUiIfVisible = function () {};', ctx);
    ctx.loadStoreOffers();
    await new Promise(function (r) { setTimeout(r, 50); });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'revenuecat');
    assert.equal(offer.plans.length, 2);
    assert.equal(offer.plans[0].id, 'annual');
    assert.equal(offer.plans[0].price, '₹999');
});

test('RevenueCat uses offerings.all when current is empty', async () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeRevenueCat(ctx, {
        configure: function () { return Promise.resolve(); },
        getOfferings: function () {
            return Promise.resolve({
                current: null,
                all: {
                    default: {
                        availablePackages: [
                            {
                                identifier: '$rc_monthly',
                                product: { priceString: '₹149', price: 149 },
                            },
                        ],
                    },
                },
            });
        },
        addCustomerInfoUpdateListener: function () {},
    });
    vm.runInContext('REVENUECAT_API_KEY_ANDROID = "goog_test_key";', ctx);
    vm.runInContext('refreshPremiumOfferUiIfVisible = function () {};', ctx);
    ctx.loadStoreOffers();
    await new Promise(function (r) { setTimeout(r, 50); });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'revenuecat');
    assert.equal(offer.plans.length, 1);
    assert.equal(offer.plans[0].id, 'monthly');
});
