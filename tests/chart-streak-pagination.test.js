const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createKingContext, resetKing, getState, setState } = require('./helpers/king-harness');

const ROOT = path.join(__dirname, '..');

function loadChartHistory(ctx) {
    vm.runInContext(
        [
            'function isAwaitingNextJourney() { return !!state.pendingNextJourney; }',
            'function requirePremium() { return true; }',
            'function canAccessJourneyGracePremiumFeature() { return true; }',
            'function setHistoryEmptyVisible() {}',
            'function ensureDeferredHeavyRendered() {}',
            'var monthPanelOpen = false;',
            'var chartPanelOpen = false;',
            'var lifetimePanelOpen = false;',
            'var bestPerformancesPanelOpen = false;',
            'var chartMode = "streaks";',
            'var chartPage = -1;',
            'document = {',
            '  getElementById: function () {',
            '    return { classList: { toggle: function () {} }, setAttribute: function () {},',
            '      addEventListener: function () {}, hidden: false, textContent: "" };',
            '  }',
            '};',
        ].join('\n'),
        ctx,
    );
    const code = fs.readFileSync(path.join(ROOT, 'ui-history.js'), 'utf8');
    vm.runInContext(code, ctx, { filename: 'ui-history.js' });
}

function pastJourneysFourByTen() {
    const streaks = function (n) {
        const out = [];
        for (let i = 0; i < n; i++) out.push(i + 1);
        return out;
    };
    return [
        { attempt: 1, streaks: streaks(10) },
        { attempt: 2, streaks: streaks(10) },
        { attempt: 3, streaks: streaks(10) },
        { attempt: 4, streaks: streaks(10) },
    ];
}

test('archived journey is not duplicated in live streak entries', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    loadChartHistory(ctx);
    const archived = pastJourneysFourByTen();
    setState(ctx, {
        attempt: 4,
        pendingNextJourney: false,
        currentStreak: 0,
        currentJourneyStreaks: archived[3].streaks,
        pastJourneyStreaks: archived,
        completedJourneys: archived.map((j, i) => ({
            attempt: j.attempt,
            score: { success: 0, failures: 3 },
        })),
    });
    const pages = ctx.buildStreakChartPages();
    assert.equal(pages.length, 4);
    const last = pages[3];
    assert.equal(last.points.length, 10);
    assert.equal(last.points[0].label, 'S31');
    assert.equal(last.points[9].label, 'S40');
});

test('in-progress journey keeps ended segments and live streak on one page', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    loadChartHistory(ctx);
    const ended = [3, 5, 2, 7, 4, 6, 1, 8, 2];
    setState(ctx, {
        attempt: 4,
        pendingNextJourney: false,
        currentStreak: 12,
        currentJourneyStreaks: ended,
        pastJourneyStreaks: pastJourneysFourByTen().slice(0, 3),
    });
    const pages = ctx.buildStreakChartPages();
    assert.equal(pages.length, 4);
    const livePage = pages[3];
    assert.equal(livePage.points.length, 10);
    assert.equal(livePage.points[0].label, 'S31');
    assert.equal(livePage.points[8].label, 'S39');
    assert.equal(livePage.points[9].label, 'S40…');
    assert.equal(livePage.points[9].live, true);
});

test('streak pagination opens on full latest journey page after journey 4', () => {
    const ctx = createKingContext();
    resetKing(ctx);
    loadChartHistory(ctx);
    setState(ctx, {
        attempt: 4,
        pendingNextJourney: true,
        currentStreak: 0,
        currentJourneyStreaks: [],
        pastJourneyStreaks: pastJourneysFourByTen(),
    });
    vm.runInContext('chartPage = -1;', ctx);
    const pagination = ctx.getChartPagination();
    assert.equal(pagination.show.length, 10);
    assert.equal(pagination.show[0].label, 'S31');
    assert.equal(pagination.show[9].label, 'S40');
});