const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createKingContext,
    resetKing,
    seedJourney,
    getState,
} = require('./helpers/king-harness');

function slipOnConsecutiveDays(ctx, startDate, count) {
    for (let i = 0; i < count; i++) {
        const r = ctx.applySlipDay({ logDate: ctx.addDaysToKey(startDate, i) });
        assert.equal(r.applied, true, 'slip day ' + (i + 1));
    }
}

test('fresh journey has zero slips and can log', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });
    const s = getState(ctx);

    assert.equal(s.score.success, 0);
    assert.equal(s.score.failures, 0);
    assert.equal(ctx.canLogToday(), true);
    assert.equal(ctx.isAwaitingNextJourney(), false);
});

test('single slip increments failure count', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });

    const result = ctx.applySlipDay({ logDate: '2026-06-15' });
    assert.equal(result.applied, true);
    assert.equal(getState(ctx).score.failures, 1);
    assert.equal(ctx.journeyIsOver(getState(ctx)), false);
});

test('second slip on same day is blocked', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });

    assert.equal(ctx.applySlipDay({ logDate: '2026-06-15' }).applied, true);
    const second = ctx.applySlipDay({ logDate: '2026-06-15' });
    assert.equal(second.applied, false);
    assert.equal(getState(ctx).score.failures, 1);
});

test('ten slip days ends journey and blocks further logging', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 9);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start });

    slipOnConsecutiveDays(ctx, start, 10);
    const s = getState(ctx);
    assert.equal(s.score.failures, 10);
    assert.equal(ctx.journeyIsOver(s), true);
    assert.equal(ctx.canLogToday(), false);

    const blocked = ctx.applySlipDay({ logDate: end });
    assert.equal(blocked.applied, false);
});

test('archive after 10 slip days sets awaiting next journey', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 9);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start });

    slipOnConsecutiveDays(ctx, start, 10);
    const comparison = ctx.archiveCompletedJourney(end);
    const s = getState(ctx);
    assert.ok(comparison);
    assert.equal(ctx.isAwaitingNextJourney(), true);
    assert.equal(s.journeyEndedDate, end);
    assert.equal(s.completedJourneys.length, 1);
    assert.equal(s.completedJourneys[0].score.failures, 10);
    assert.equal(s.completedJourneys[0].score.success, 0);
});

test('strong days accumulate until journey ends', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-17' });
    seedJourney(ctx, { today: '2026-06-17', start: '2026-06-15' });

    ctx.applyStrongDay({ logDate: '2026-06-15', suppressUI: true });
    ctx.applyStrongDay({ logDate: '2026-06-16', suppressUI: true });
    const third = ctx.applyStrongDay({ logDate: '2026-06-17', suppressUI: true });

    assert.equal(third.applied, true);
    assert.equal(getState(ctx).score.success, 3);
    assert.equal(getState(ctx).score.failures, 0);
});

test('beginNextJourney after end day resets score and bumps attempt', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 9);
    const nextDay = ctx.addDaysToKey(start, 10);
    resetKing(ctx, { today: nextDay });
    seedJourney(ctx, { today: nextDay, start });

    slipOnConsecutiveDays(ctx, start, 10);
    ctx.archiveCompletedJourney(end);

    ctx.beginNextJourney();
    const s = getState(ctx);
    assert.equal(s.attempt, 2);
    assert.equal(s.score.success, 0);
    assert.equal(s.score.failures, 0);
    assert.equal(ctx.isAwaitingNextJourney(), false);
    assert.equal(s.journeyStartDate, nextDay);
    assert.equal(ctx.canLogToday(), true);
});

test('permanent best journey updates when finished score beats prior', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const firstSlipDay = ctx.addDaysToKey(start, 5);
    const lastSlipDay = ctx.addDaysToKey(start, 14);
    resetKing(ctx, { today: lastSlipDay });
    seedJourney(ctx, { today: lastSlipDay, start });

    for (let i = 0; i < 5; i++) {
        ctx.applyStrongDay({ logDate: ctx.addDaysToKey(start, i), suppressUI: true });
    }
    slipOnConsecutiveDays(ctx, firstSlipDay, 10);

    const best = getState(ctx).bestJourney;
    assert.equal(best.success, 5);
    assert.equal(best.failures, 10);
});
