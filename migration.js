/**
 * migration.js — Upgrade saved state when schema changes.
 *
 * Trial seed (trialStartedAt) is not migrated here — onboarding / init own
 * that write (startPremiumTrial / ensureTrialStarted) from Calendar Day 1.
 */

function migrateDailyLogToDateKeys(log) {
    const out = {};
    for (const [key, entry] of Object.entries(log || {})) {
        if (typeof entry === 'object' && entry.date) {
            out[entry.date] = entry;
        } else {
            out[key] = entry;
        }
    }
    return out;
}

function migrateLongestStreakAtStart(merged, saved) {
    if (saved.longestStreakAtStreakStart !== undefined) {
        return merged.longestStreakAtStreakStart;
    }
    const streak = merged.currentStreak || 0;
    const longest = merged.longestStreak || 0;
    if (streak === 0) return longest;
    if (streak < longest) return longest;
    return 0;
}

function repairMultiSlipInflation(s) {
    if (typeof isAwaitingNextJourney === 'function' && isAwaitingNextJourney(s)) return;
    var log = s.dailyLog || {};
    var anchor = typeof readJourneyAnchorWallDate === 'function'
        ? readJourneyAnchorWallDate(s)
        : (s.journeyStartDate || '');
    var deflated = 0;
    Object.keys(log).forEach(function (k) {
        var entry = log[k];
        if (!entry || typeof entry !== 'object' || logStatus(entry) !== 'slip') return;
        var date = entry.date || (/^\d{4}-\d{2}-\d{2}$/.test(k) ? k : '');
        if (anchor && date && date < anchor) return;
        var sc = Math.max(1, Number(entry.slipCount) || 1);
        if (sc > 1) {
            deflated += sc - 1;
            entry.slipCount = 1;
        }
    });
    if (deflated > 0 && s.score) {
        s.score.failures = Math.max(0, (Number(s.score.failures) || 0) - deflated);
    }
    if ((s.todayFailCount || 0) > 1) s.todayFailCount = 1;
}

function runStateMigrations(merged, saved) {
    merged.dailyLog = migrateDailyLogToDateKeys(saved.dailyLog || merged.dailyLog);
    merged.longestStreakAtStreakStart = migrateLongestStreakAtStart(merged, saved);
    repairMultiSlipInflation(merged);

    // Seed journey/app start dates for saves that predate these fields (load-time ensure).
    if (typeof ensureJourneyAnchorWallDate === 'function') {
        ensureJourneyAnchorWallDate(merged);
    } else if (!merged.journeyStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(merged.journeyStartDate)) {
        merged.journeyStartDate = typeof inferJourneyStartFromLog === 'function'
            ? inferJourneyStartFromLog(merged)
            : (merged.lastOpenedDate || '');
    }
    delete merged.devDateOffset;

    // Paid window only from Play client purchase/restore — not URL or local “success”.
    var paidSource = merged.source;
    if (paidSource !== 'play' && paidSource !== 'restore') {
        merged.premiumUntil = '';
        if (paidSource !== 'local-trial') merged.source = '';
    }

    if (typeof ensureAppStartWallDate === 'function') {
        ensureAppStartWallDate(merged);
    } else if (!merged.appStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(merged.appStartDate)) {
        merged.appStartDate = typeof inferAppStartFromLog === 'function'
            ? inferAppStartFromLog(merged)
            : (merged.journeyStartDate || '');
    }

    return merged;
}
