const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
    createKingContext,
    resetKing,
    isoDaysFromNow,
    getState,
    setState,
    seedJourney,
    simulateRestoreImportBackup,
} = require('./helpers/king-harness');

function maliciousBackupState(ctx, extra) {
    return Object.assign(
        {
            ...ctx.getDefaultState(),
            attempt: 3,
            score: { success: 20, failures: 2 },
            dailyLog: { '2026-06-01': { date: '2026-06-01', status: 'strong', day: 1 } },
            appStartDate: '2026-06-01',
            trialStartedAt: isoDaysFromNow(-60),
            onboardingComplete: true,
        },
        extra || {},
    );
}

test('normal backup round-trip restores progress without trusting backup billing', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-17' });
    seedJourney(ctx, { today: '2026-06-17', start: '2026-06-15' });
    ctx.applyStrongDay({ logDate: '2026-06-15', suppressUI: true });
    ctx.applyStrongDay({ logDate: '2026-06-16', suppressUI: true });

    const parsed = ctx.parseBackupJson(JSON.stringify(ctx.buildBackupPayload()));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.state.score.success, 2);

    resetKing(ctx, { today: '2026-06-17' });
    simulateRestoreImportBackup(ctx, parsed);
    assert.equal(getState(ctx).score.success, 2);
});

test('fabricated premium in backup does not grant paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
        premiumUntil: '',
        source: '',
    });
    const saved = maliciousBackupState(ctx, {
        premiumUntil: isoDaysFromNow(365),
        source: 'revenuecat',
        lastVerifiedAt: isoDaysFromNow(0),
    });
    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        state: saved,
    }));
    assert.equal(backup.ok, true);
    simulateRestoreImportBackup(ctx, backup);
    assert.equal(ctx.Entitlement.isSubscriptionActive(getState(ctx)), false);
    assert.equal(getState(ctx).premiumUntil, '');
});

test('expired subscription fields in backup do not grant paid access', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    const saved = maliciousBackupState(ctx, {
        premiumUntil: isoDaysFromNow(-5),
        source: 'revenuecat',
    });
    const backup = ctx.parseBackupJson(JSON.stringify({ format: 'king-backup', version: 1, state: saved }));
    simulateRestoreImportBackup(ctx, backup);
    assert.equal(ctx.Entitlement.hasPremiumAccess(getState(ctx)), false);
});

test('parse strips billing before mergeSavedState', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const saved = maliciousBackupState(ctx, {
        premiumUntil: isoDaysFromNow(90),
        source: 'revenuecat',
    });
    const parsed = ctx.parseBackupJson(JSON.stringify({ format: 'king-backup', version: 1, state: saved }));
    assert.equal(parsed.state.premiumUntil, '');
    assert.equal(parsed.state.source, '');
});

test('device paid subscriber keeps access when importing progress-only backup', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    const until = isoDaysFromNow(20);
    setState(ctx, {
        premiumUntil: until,
        source: 'revenuecat',
        trialStartedAt: isoDaysFromNow(-40),
        appStartDate: '2026-05-01',
        score: { success: 1, failures: 0 },
    });
    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        state: maliciousBackupState(ctx, {
            premiumUntil: isoDaysFromNow(500),
            source: 'revenuecat',
            score: { success: 50, failures: 1 },
        }),
    }));
    simulateRestoreImportBackup(ctx, backup);
    const s = getState(ctx);
    assert.equal(s.score.success, 50);
    assert.equal(ctx.Entitlement.isSubscriptionActive(s), true);
    assert.equal(s.premiumUntil, until);
});

test('import cannot extend active trial with newer appStartDate', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-20' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-5),
        appStartDate: '2026-06-15',
        score: { success: 3, failures: 0 },
        dailyLog: { '2026-06-15': { date: '2026-06-15', status: 'strong', day: 1 } },
    });
    assert.equal(ctx.Entitlement.isTrialActive(getState(ctx)), true);
    const remainingBefore = ctx.Entitlement.daysRemaining(getState(ctx));

    const base = getState(ctx);
    const saved = Object.assign({}, base, {
        appStartDate: '2026-06-18',
        trialStartedAt: isoDaysFromNow(-1),
        score: { success: 10, failures: 0 },
        dailyLog: Object.assign({}, base.dailyLog),
    });
    const backup = ctx.parseBackupJson(JSON.stringify({ format: 'king-backup', version: 1, state: saved }));
    simulateRestoreImportBackup(ctx, backup);
    assert.equal(getState(ctx).appStartDate, '2026-06-15');
    assert.ok(ctx.Entitlement.daysRemaining(getState(ctx)) <= remainingBefore);
});

test('import cannot restart expired trial on existing device', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-01',
        score: { success: 5, failures: 0 },
        dailyLog: { '2026-05-01': { date: '2026-05-01', status: 'strong', day: 1 } },
    });
    assert.equal(ctx.Entitlement.isTrialActive(getState(ctx)), false);

    const saved = maliciousBackupState(ctx, {
        appStartDate: '2026-06-28',
        trialStartedAt: isoDaysFromNow(-2),
    });
    const backup = ctx.parseBackupJson(JSON.stringify({ format: 'king-backup', version: 1, state: saved }));
    simulateRestoreImportBackup(ctx, backup);
    const s = getState(ctx);
    assert.equal(s.appStartDate, '2026-05-01');
    assert.equal(ctx.Entitlement.isTrialActive(s), false);
});

test('fresh device with old backup does not receive a new 15-day trial', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    const saved = maliciousBackupState(ctx, {
        appStartDate: '2026-06-28',
        trialStartedAt: isoDaysFromNow(-2),
    });
    saved.dailyLog = { '2026-05-10': { date: '2026-05-10', status: 'strong', day: 1 } };
    const backup = ctx.parseBackupJson(JSON.stringify({ format: 'king-backup', version: 1, state: saved }));
    simulateRestoreImportBackup(ctx, backup);
    const s = getState(ctx);
    assert.equal(s.appStartDate, '2026-05-10');
    assert.equal(ctx.Entitlement.isTrialActive(s), false);
});

test('future trialStartedAt in backup is rejected', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-15' });
    const saved = maliciousBackupState(ctx, {
        appStartDate: '2026-06-15',
        trialStartedAt: isoDaysFromNow(5),
    });
    const prepared = ctx.applyTrialAnchorPolicyForImport(saved, getState(ctx));
    const trial = new Date(prepared.trialStartedAt || '');
    assert.ok(!prepared.trialStartedAt || trial.getTime() <= Date.now());
});

test('journey grace unchanged after importing ineligible backup', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-07-01' });
    setState(ctx, {
        attempt: 2,
        trialStartedAt: isoDaysFromNow(-50),
        appStartDate: '2026-05-15',
    });
    const backup = ctx.parseBackupJson(JSON.stringify({
        format: 'king-backup',
        version: 1,
        state: maliciousBackupState(ctx, { attempt: 2 }),
    }));
    simulateRestoreImportBackup(ctx, backup);
    assert.equal(getState(ctx).attempt, 2);
    assert.equal(ctx.canAccessJourneyGracePremiumFeature(), true);
});

test('save reload import pipeline preserves progress access decision', () => {
    const ctx = createKingContext();
    resetKing(ctx, { today: '2026-06-17' });
    seedJourney(ctx, { today: '2026-06-17', start: '2026-06-10' });
    ctx.applyStrongDay({ logDate: '2026-06-10', suppressUI: true });
    vm.runInContext('saveToStorage(state)', ctx);

    const json = JSON.stringify(ctx.buildBackupPayload());
    const parsed = ctx.parseBackupJson(json);
    assert.equal(parsed.ok, true);

    resetKing(ctx, { today: '2026-06-17' });
    vm.runInContext('replaceState(getDefaultState())', ctx);
    simulateRestoreImportBackup(ctx, parsed);

    const s = getState(ctx);
    assert.equal(s.score.success, 1);
    assert.equal(ctx.Entitlement.isTrialActive(s), true);
});