const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createKingContext,
    resetKing,
    seedJourney,
    getState,
    setState,
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

test('next journey target after first journey with 12 strong days', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });
    setState(ctx, {
        pendingNextJourney: true,
        journeyEndedDate: '2026-06-15',
        completedJourneys: [{
            attempt: 1,
            score: { success: 12, failures: 10 },
            date: '2026-06-15T00:00:00.000Z',
        }],
        bestJourney: { success: 12, failures: 10 },
    });

    assert.equal(ctx.formatNextJourneyTargetLine(2), 'Journey 2: Beat 12 Strong Days to Win');
    assert.equal(ctx.getNextJourneyTargetGoal(), 'Beat 12 Strong Days to Win');
});

test('next journey target after first journey with no strong days', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });
    setState(ctx, {
        pendingNextJourney: true,
        journeyEndedDate: '2026-06-15',
        completedJourneys: [{
            attempt: 1,
            score: { success: 0, failures: 10 },
            date: '2026-06-15T00:00:00.000Z',
        }],
        bestJourney: { success: 0, failures: 10 },
    });

    assert.equal(ctx.formatNextJourneyTargetLine(2), 'Journey 2: Target 25 strong days');
});

test('first journey archive has no prior best but still returns comparison', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 9);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start });

    slipOnConsecutiveDays(ctx, start, 10);
    const comparison = ctx.archiveCompletedJourney(end);
    assert.ok(comparison);
    assert.equal(comparison.prevBestScore, null);
    assert.equal(comparison.score.success, 0);
    assert.equal(comparison.score.failures, 10);
    assert.equal(comparison.attempt, 1);
});

test('first journey with strong days does not treat mirrored bestJourney as prior best', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 21);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start });

    for (let i = 0; i < 12; i++) {
        ctx.applyStrongDay({ logDate: ctx.addDaysToKey(start, i), suppressUI: true });
    }
    slipOnConsecutiveDays(ctx, ctx.addDaysToKey(start, 12), 10);

    const comparison = ctx.archiveCompletedJourney(end);
    assert.ok(comparison);
    assert.equal(comparison.prevBestScore, null);
    assert.equal(comparison.score.success, 12);
    assert.equal(getState(ctx).bestJourney.success, 12);
    assert.equal(getState(ctx).bestJourney.failures, 10);
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
    ctx.archiveCompletedJourney(lastSlipDay);

    const best = getState(ctx).bestJourney;
    assert.equal(best.success, 5);
    assert.equal(best.failures, 10);
});

test('journey milestone labels use strong days wording', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });

    assert.equal(ctx.formatJourneyMilestoneLabel(100), '100 Strong Days');
    assert.equal(ctx.formatJourneyMilestoneLabel(200), '200 Strong Days');
});

test('warrior unlock hint shows day count on first locked row only', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });

    assert.equal(ctx.formatJourneyMilestoneUnlockHint(50), 'Log 50 strong days to unlock');
    assert.equal(ctx.formatJourneyMilestoneUnlockHint(100), 'Keep going to unlock');
    assert.equal(ctx.formatJourneyMilestoneUnlockHint(200), '200 Strong Days to unlock');
    assert.equal(ctx.formatJourneyMilestoneUnlockHint(400), '400 Strong Days to unlock');
});

test('first journey display best mirrors current after slip-first start', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });

    ctx.applySlipDay({ logDate: '2026-06-15' });
    var displayAfterSlip = ctx.getDisplayBestJourney();
    assert.equal(displayAfterSlip.success, 0);
    assert.equal(displayAfterSlip.failures, 1);
    assert.equal(getState(ctx).score.success, 0);
    assert.equal(getState(ctx).score.failures, 1);
});

test('best journey hint hidden on first journey', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });

    assert.equal(ctx.getBestJourneyHintText(), null);

    setState(ctx, { score: { success: 25, failures: 0 } });
    assert.equal(ctx.getBestJourneyHintText(), null);

    setState(ctx, { score: { success: 50, failures: 0 } });
    assert.equal(ctx.getBestJourneyHintText(), null);
});

test('best journey hint shows beat prior best on later journeys', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15', attempt: 2 });
    setState(ctx, {
        score: { success: 10, failures: 0 },
        completedJourneys: [{
            attempt: 1,
            score: { success: 38, failures: 10 },
            endedDate: '2026-06-14',
        }],
    });

    assert.equal(ctx.getBestJourneyHintText(), 'Beat 38 Strong Days to Win!');

    setState(ctx, { score: { success: 26, failures: 0 } });
    assert.equal(ctx.getBestJourneyHintText(), 'Beat 38 Strong Days to Win!');

    setState(ctx, { score: { success: 40, failures: 0 } });
    assert.equal(ctx.getBestJourneyHintText(), 'New Best! Keep Going!');
});

test('best journey hint shows keep going when current journey beats prior', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15', attempt: 2 });
    setState(ctx, {
        score: { success: 149, failures: 2 },
        completedJourneys: [{
            attempt: 1,
            score: { success: 145, failures: 10 },
            endedDate: '2026-06-14',
        }],
    });

    assert.equal(ctx.getBestJourneyHintText(), 'New Best! Keep Going!');
});

test('best journey hint hides while awaiting next journey', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    seedJourney(ctx, { today: '2026-06-15', start: '2026-06-15' });
    setState(ctx, { pendingNextJourney: true, journeyEndedDate: '2026-06-15' });

    assert.equal(ctx.getBestJourneyHintText(), null);
});

test('archive below-best uses permanent bestJourney when higher than completed rows', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 19);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start, attempt: 2 });
    setState(ctx, {
        score: { success: 12, failures: 10 },
        bestJourney: { success: 40, failures: 10 },
        completedJourneys: [{
            attempt: 1,
            score: { success: 38, failures: 10 },
            date: '2026-06-14T00:00:00.000Z',
        }],
    });

    const comparison = ctx.archiveCompletedJourney(end);
    assert.ok(comparison);
    assert.equal(comparison.prevBestScore.success, 40);
    assert.equal(
        ctx.isBetterJourneyScore(
            comparison.score.success,
            comparison.score.failures,
            comparison.prevBestScore,
        ),
        false,
    );
});

test('archive exposes prior best when second journey ends below first', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 19);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start, attempt: 2 });
    setState(ctx, {
        score: { success: 12, failures: 10 },
        bestJourney: { success: 38, failures: 10 },
        completedJourneys: [{
            attempt: 1,
            score: { success: 38, failures: 10 },
            date: '2026-06-14T00:00:00.000Z',
        }],
    });

    const comparison = ctx.archiveCompletedJourney(end);
    assert.ok(comparison);
    assert.equal(comparison.prevBestScore.success, 38);
    assert.equal(comparison.prevBestScore.failures, 10);
    assert.equal(comparison.prevBestAttempt, 1);
    assert.equal(
        ctx.isBetterJourneyScore(
            comparison.score.success,
            comparison.score.failures,
            comparison.prevBestScore,
        ),
        false,
    );
});

test('archive falls back to bestJourney when completed history is missing', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 14);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start, attempt: 2 });
    setState(ctx, {
        score: { success: 5, failures: 10 },
        bestJourney: { success: 20, failures: 10 },
        completedJourneys: [],
    });

    const comparison = ctx.archiveCompletedJourney(end);
    assert.ok(comparison);
    assert.equal(comparison.prevBestScore.success, 20);
    assert.equal(comparison.prevBestAttempt, 1);
});

test('second journey archive keeps prior best after 10th slip', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 24);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start, attempt: 2 });
    setState(ctx, {
        completedJourneys: [{
            attempt: 1,
            score: { success: 12, failures: 10 },
            date: '2026-06-14T00:00:00.000Z',
        }],
        bestJourney: { success: 12, failures: 10 },
    });

    for (let i = 0; i < 15; i++) {
        ctx.applyStrongDay({ logDate: ctx.addDaysToKey(start, i), suppressUI: true });
    }
    slipOnConsecutiveDays(ctx, ctx.addDaysToKey(start, 15), 10);

    assert.equal(getState(ctx).bestJourney.success, 12);
    const comparison = ctx.archiveCompletedJourney(end);
    assert.ok(comparison);
    assert.equal(comparison.prevBestScore.success, 12);
    assert.equal(comparison.score.success, 15);
    assert.equal(
        ctx.isBetterJourneyScore(
            comparison.score.success,
            comparison.score.failures,
            comparison.prevBestScore,
        ),
        true,
    );
});

test('buildComparisonForAwaitingJourney rebuilds journey 2 comparison on reopen', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-20' });
    seedJourney(ctx, { today: '2026-06-20', start: '2026-06-15', attempt: 2 });
    setState(ctx, {
        pendingNextJourney: true,
        journeyEndedDate: '2026-06-19',
        completedJourneys: [
            { attempt: 1, score: { success: 12, failures: 10 } },
            { attempt: 2, score: { success: 7, failures: 10 } },
        ],
        score: { success: 7, failures: 10 },
    });

    const comparison = ctx.buildComparisonForAwaitingJourney();
    assert.ok(comparison);
    assert.equal(comparison.attempt, 2);
    assert.equal(comparison.prevBestScore.success, 12);
    assert.equal(comparison.score.success, 7);
});

test('wasJourneyComparisonShown keys by archived attempt and end date', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-20' });

    const comparison = {
        attempt: 2,
        score: { success: 15, failures: 10 },
        prevBestScore: { success: 12, failures: 10 },
        journeyEndedDate: '2026-06-19',
    };

    assert.equal(ctx.wasJourneyComparisonShown(comparison), false);
    ctx.markJourneyComparisonShown(comparison);
    assert.equal(ctx.wasJourneyComparisonShown(comparison), true);

    setState(ctx, { attempt: 3, journeyEndedDate: '' });
    assert.equal(ctx.wasJourneyComparisonShown(comparison), true);
});

test('healStrandedJourneyEnd returns comparison when it archives a stranded finish', () => {
    const ctx = createKingContext();
    const start = '2026-06-15';
    const end = ctx.addDaysToKey(start, 14);
    resetKing(ctx, { today: end });
    seedJourney(ctx, { today: end, start, attempt: 2 });
    setState(ctx, {
        score: { success: 8, failures: 10 },
        bestJourney: { success: 25, failures: 10 },
        completedJourneys: [{
            attempt: 1,
            score: { success: 25, failures: 10 },
            date: '2026-06-14T00:00:00.000Z',
        }],
    });

    const healResult = ctx.healStrandedJourneyEnd();
    assert.ok(healResult);
    assert.equal(healResult.prevBestScore.success, 25);
    assert.equal(ctx.isAwaitingNextJourney(), true);
});
