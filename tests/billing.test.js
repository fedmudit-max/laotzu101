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

function stubNativeAndroidBilling(ctx, billingPlugin) {
    ctx.__billingPlugin = billingPlugin || {};
    vm.runInContext(`
        window = {
            Capacitor: {
                isNativePlatform: function () { return true; },
                getPlatform: function () { return 'android'; },
                Plugins: { KingBilling: __billingPlugin },
            },
        };
    `, ctx);
}

test('getPremiumOffer uses mock plans on web harness', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'mock');
    assert.ok(offer.plans.length >= 2);
    assert.equal(offer.plans[0].price, undefined);
    assert.equal(offer.plans[0].id, 'monthly');
});

test('getPremiumOffer never shows mock on native without Play prices', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidBilling(ctx);
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'loading');
    assert.equal(offer.plans.length, 0);
});

test('getPremiumOffer shows Play prices after setPremiumOfferFromStore', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidBilling(ctx);
    ctx.setPremiumOfferFromStore({
        source: 'play',
        plans: [
            { id: 'monthly', price: '$4.99', amount: 4.99 },
            { id: 'annual', price: '$39.99', amount: 39.99 },
        ],
    });
    const offer = ctx.getPremiumOffer();
    assert.equal(offer.source, 'play');
    assert.equal(offer.plans[0].price, undefined);
    assert.equal(offer.plans[1].price, undefined);
});

test('getPremiumOffer unavailable when Play pricing load fails on native', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    stubNativeAndroidBilling(ctx);
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
