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

test('active local trial grants premium access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-4),
        appStartDate: '2026-06-11',
        calendarDay: 5,
        journeyStartDate: '2026-06-11',
    });
    const s = getState(ctx);

    assert.equal(ctx.Entitlement.isTrialActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
    assert.equal(ctx.Entitlement.getAccess(s).active, true);
});

test('expired trial denies premium without subscription', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-40),
        appStartDate: '2026-05-25',
        premiumUntil: '',
        calendarDay: 3,
        journeyStartDate: '2026-06-13',
        attempt: 2,
    });
    const s = getState(ctx);

    assert.equal(ctx.Entitlement.isTrialActive(s), false);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), false);
    assert.equal(ctx.Entitlement.shouldShowPaywall(s), true);
});

test('active premiumUntil cache grants access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-40),
        premiumUntil: isoDaysFromNow(2),
        source: 'play',
    });
    const s = getState(ctx);

    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
    assert.equal(ctx.Entitlement.daysRemaining(s) >= 1, true);
});

test('trial days remaining follow appStartDate not journey day counter', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-24' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(0),
        appStartDate: '2026-06-15',
        journeyStartDate: '2026-06-22',
        lastOpenedDate: '2026-06-24',
        calendarDay: 3,
        attempt: 2,
    });
    assert.equal(ctx.Entitlement.daysRemaining(getState(ctx)), 6);
    ctx.todayKey = function () { return '2026-06-29'; };
    setState(ctx, {
        journeyStartDate: '2026-06-22',
        lastOpenedDate: '2026-06-29',
        calendarDay: 8,
    });
    assert.equal(ctx.Entitlement.daysRemaining(getState(ctx)), 1);
    ctx.todayKey = function () { return '2026-06-30'; };
    setState(ctx, {
        lastOpenedDate: '2026-06-30',
        calendarDay: 9,
    });
    assert.equal(ctx.Entitlement.isTrialActive(getState(ctx)), false);
});

test('new journey day 1 does not restart trial after install window ended', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-15',
        journeyStartDate: '2026-07-01',
        calendarDay: 1,
        attempt: 3,
    });
    const s = getState(ctx);
    assert.equal(ctx.Entitlement.isTrialActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), false);
});

test('friends build flag grants access after onboarding without trial', () => {
    const ctx = createKingContext();
    vm.runInContext('KING_FRIENDS_BUILD_FULL_ACCESS = true;', ctx);
    resetKing(ctx);
    setState(ctx, { trialStartedAt: isoDaysFromNow(-40), premiumUntil: '' });
    const s = getState(ctx);

    assert.equal(ctx.Entitlement.hasPremiumAccess(s), true);
    assert.equal(ctx.Entitlement.shouldShowPaywall(s), false);
});

test('expired premiumUntil cache denies subscription access', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    setState(ctx, { premiumUntil: isoDaysFromNow(-1), source: 'play' });
    const s = getState(ctx);

    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
});
