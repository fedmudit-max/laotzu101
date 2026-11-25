/**
 * Cross-device import: Nov 1 install → Nov 20 export → Nov 25 import (no Premium).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createKingContext,
    resetKing,
    getState,
    setState,
    simulateRestoreImportBackup,
} = require('./helpers/king-harness');

const APP_START = '2025-11-01';
const EXPORT_DAY = '2025-11-20';
const IMPORT_DAY = '2025-11-25';

function trialIsoForWallDate(dateKey) {
    const parts = dateKey.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
    return d.toISOString();
}

function buildNov1ToNov20Progress(ctx) {
    const dailyLog = {};
    let day = 1;
    for (let d = 1; d <= 20; d += 1) {
        const key = `2025-11-${String(d).padStart(2, '0')}`;
        dailyLog[key] = { date: key, status: 'strong', day: day };
        day += 1;
    }
    return Object.assign({}, ctx.getDefaultState(), {
        attempt: 2,
        calendarDay: 20,
        journeyStartDate: APP_START,
        appStartDate: APP_START,
        trialStartedAt: trialIsoForWallDate(APP_START),
        lastOpenedDate: EXPORT_DAY,
        score: { success: 18, failures: 2 },
        dailyLog,
        premiumUntil: '',
        source: '',
        lastVerifiedAt: '',
    });
}

test('Nov 25 fresh device: Nov 1 backup keeps expired trial and progress, no Premium', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: IMPORT_DAY });
    const deviceSnap = getState(ctx);
    assert.equal(deviceSnap.appStartDate, '');

    const saved = buildNov1ToNov20Progress(ctx);
    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        exportedAt: `${EXPORT_DAY}T12:00:00.000Z`,
        onboardingComplete: true,
        state: saved,
    }));
    assert.equal(backup.ok, true);

    simulateRestoreImportBackup(ctx, backup);
    const s = getState(ctx);

    assert.equal(s.appStartDate, APP_START);
    assert.equal(s.score.success, 18);
    assert.equal(s.score.failures, 2);
    assert.equal(Object.keys(s.dailyLog).length, 20);
    assert.equal(ctx.Entitlement.isTrialActive(s), false);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), false);
    assert.equal(ctx.Entitlement.hasPremiumAccess(s), false);
    assert.equal(s.premiumUntil, '');
    assert.equal(s.attempt, 2);
    assert.equal(ctx.canAccessJourneyGracePremiumFeature(), true);
});

test('Nov 25 fresh device: backup cannot smuggle Premium entitlement', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: IMPORT_DAY });
    const saved = buildNov1ToNov20Progress(ctx);
    saved.premiumUntil = new Date(Date.parse(`${IMPORT_DAY}T00:00:00Z`) + 86400000 * 365).toISOString();
    saved.source = 'revenuecat';

    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        state: saved,
    }));
    simulateRestoreImportBackup(ctx, backup);
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
});

test('existing device: earliest appStart prevents trial extension on import', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: IMPORT_DAY });
    setState(ctx, {
        appStartDate: APP_START,
        trialStartedAt: trialIsoForWallDate(APP_START),
        score: { success: 2, failures: 0 },
        dailyLog: { '2025-11-01': { date: '2025-11-01', status: 'strong', day: 1 } },
        attempt: 1,
    });
    assert.equal(ctx.Entitlement.isTrialActive(getState(ctx)), false);

    const saved = buildNov1ToNov20Progress(ctx);
    saved.appStartDate = '2025-11-18';
    saved.trialStartedAt = trialIsoForWallDate('2025-11-18');

    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        state: saved,
    }));
    simulateRestoreImportBackup(ctx, backup);

    const s = getState(ctx);
    assert.equal(s.appStartDate, APP_START);
    assert.equal(ctx.Entitlement.isTrialActive(s), false);
    assert.equal(s.score.success, 18);
});

test('trialStartedAt newer than appStart cannot restart trial (appStart is anchor)', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: IMPORT_DAY });
    const saved = buildNov1ToNov20Progress(ctx);
    saved.trialStartedAt = trialIsoForWallDate('2025-11-20');

    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        state: saved,
    }));
    simulateRestoreImportBackup(ctx, backup);

    const s = getState(ctx);
    assert.equal(s.appStartDate, APP_START);
    assert.equal(ctx.Entitlement.isTrialActive(s), false);
    assert.equal(ctx.Entitlement.daysRemaining(s), 0);
});