/**
 * Paid entitlement fields through save → load → runStateMigrations.
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
    simulateColdStartInit,
} = require('./helpers/king-harness');

function saveAndColdStart(ctx) {
    vm.runInContext('saveToStorage(state)', ctx);
    simulateColdStartInit(ctx);
}

test('active RevenueCat subscription survives save reload and cold start', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(25);
    const verified = isoDaysFromNow(-1);
    setState(ctx, {
        premiumUntil: until,
        source: 'revenuecat',
        lastVerifiedAt: verified,
        trialStartedAt: isoDaysFromNow(-40),
        appStartDate: '2026-05-01',
    });
    saveAndColdStart(ctx);
    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(s.source, 'revenuecat');
    assert.equal(s.lastVerifiedAt, verified);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
});

test('active RevenueCat subscription survives mergeSavedState migration only', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(10);
    const saved = {
        ...ctx.getDefaultState(),
        premiumUntil: until,
        source: 'revenuecat',
        trialStartedAt: isoDaysFromNow(-20),
        appStartDate: '2026-06-01',
        onboardingComplete: true,
    };
    ctx.replaceState(ctx.mergeSavedState(saved));
    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(s.source, 'revenuecat');
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
});

test('expired RevenueCat cache remains expired after migration', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-15' });
    const until = isoDaysFromNow(-10);
    setState(ctx, {
        premiumUntil: until,
        source: 'revenuecat',
        trialStartedAt: isoDaysFromNow(-60),
        appStartDate: '2026-05-01',
    });
    saveAndColdStart(ctx);
    const s = getState(ctx);
    assert.equal(s.premiumUntil, until);
    assert.equal(s.source, 'revenuecat');
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), false);
});

test('unknown paid source is stripped on migration', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const saved = {
        ...ctx.getDefaultState(),
        premiumUntil: isoDaysFromNow(90),
        source: 'dev',
    };
    ctx.replaceState(ctx.mergeSavedState(saved));
    const s = getState(ctx);
    assert.equal(s.premiumUntil, '');
    assert.equal(s.source, '');
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
});

test('revenuecat with empty premiumUntil does not grant paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    const saved = {
        ...ctx.getDefaultState(),
        premiumUntil: '',
        source: 'revenuecat',
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
    };
    ctx.replaceState(ctx.mergeSavedState(saved));
    const s = getState(ctx);
    assert.equal(s.source, 'revenuecat');
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), false);
});

test('revenuecat with unparseable premiumUntil does not grant paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const saved = {
        ...ctx.getDefaultState(),
        premiumUntil: 'not-an-iso-date',
        source: 'revenuecat',
    };
    ctx.replaceState(ctx.mergeSavedState(saved));
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('no subscription stays free after migration', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    const saved = {
        ...ctx.getDefaultState(),
        premiumUntil: '',
        source: '',
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
    };
    ctx.replaceState(ctx.mergeSavedState(saved));
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
});

test('offline cold start preserves unexpired revenuecat cache', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(7);
    setState(ctx, {
        premiumUntil: until,
        source: 'revenuecat',
        lastVerifiedAt: isoDaysFromNow(-2),
    });
    saveAndColdStart(ctx);
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});

test('15-day local trial unchanged after migration', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-5),
        appStartDate: '2026-06-10',
        premiumUntil: '',
        source: '',
    });
    saveAndColdStart(ctx);
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isTrialActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
});

test('journey grace access unchanged after migration', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-15',
        premiumUntil: '',
        source: '',
        attempt: 2,
    });
    saveAndColdStart(ctx);
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
    assert.equal(ctx.canAccessJourneyGracePremiumFeature(), true);
});

test('legacy play subscription survives migration', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(3);
    setState(ctx, {
        premiumUntil: until,
        source: 'play',
        lastVerifiedAt: isoDaysFromNow(0),
    });
    saveAndColdStart(ctx);
    const s = getState(ctx);
    assert.equal(s.source, 'play');
    assert.equal(s.premiumUntil, until);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
});

test('legacy restore source survives migration', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(3);
    const saved = {
        ...ctx.getDefaultState(),
        premiumUntil: until,
        source: 'restore',
    };
    ctx.replaceState(ctx.mergeSavedState(saved));
    assert.equal(getState(ctx).source, 'restore');
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), true);
});