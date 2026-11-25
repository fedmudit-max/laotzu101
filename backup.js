/**
 * backup.js — Export / import progress JSON.
 */

function isStoreEntitlementSource(src) {
    return src === 'play' || src === 'restore' || src === 'revenuecat';
}

/** Backup JSON is user-controlled — never treat billing fields as proof of purchase. */
function stripUntrustedBackupBillingFields(s) {
    if (!s || typeof s !== 'object') return s;
    s.premiumUntil = '';
    s.lastVerifiedAt = '';
    s.source = '';
    return s;
}

function snapshotDeviceEntitlement(s) {
    s = s || (typeof state !== 'undefined' ? state : null);
    if (!s || typeof Entitlement === 'undefined') return null;
    if (!isStoreEntitlementSource(s.source)) return null;
    if (!Entitlement.isSubscriptionActive(s)) return null;
    return {
        premiumUntil: s.premiumUntil,
        source: s.source,
        lastVerifiedAt: s.lastVerifiedAt || '',
    };
}

function reconcileEntitlementAfterImport(deviceEnt) {
    if (!deviceEnt || typeof updateEntitlementSnapshot !== 'function') return;
    var until = new Date(deviceEnt.premiumUntil);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return;
    updateEntitlementSnapshot({
        premiumUntil: deviceEnt.premiumUntil,
        lastVerifiedAt: deviceEnt.lastVerifiedAt,
        source: deviceEnt.source,
    });
}

function isValidWallDate(key) {
    return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function isPastOrPresentWallDate(key) {
    if (!isValidWallDate(key)) return false;
    if (typeof todayKey !== 'function') return true;
    return key <= todayKey();
}

function earliestWallDate(a, b) {
    if (!isPastOrPresentWallDate(a)) return isPastOrPresentWallDate(b) ? b : '';
    if (!isPastOrPresentWallDate(b)) return a;
    return a < b ? a : b;
}

function deviceHasEstablishedProgress(s) {
    if (!s) return false;
    if ((Number(s.attempt) || 0) > 1) return true;
    var log = s.dailyLog || {};
    return Object.keys(log).length > 0;
}

function trialProbeState(base, appStartDate, trialStartedAt) {
    var probe = Object.assign({}, base || {});
    if (appStartDate) probe.appStartDate = appStartDate;
    if (trialStartedAt) probe.trialStartedAt = trialStartedAt;
    return probe;
}

/**
 * Trial anchors on import: earliest valid install day, never extend an active trial,
 * never restart an expired trial on this device.
 */
function applyTrialAnchorPolicyForImport(imported, deviceBefore) {
    imported = imported || {};
    deviceBefore = deviceBefore || {};
    var out = Object.assign({}, imported);

    var deviceApp = isPastOrPresentWallDate(deviceBefore.appStartDate) ? deviceBefore.appStartDate : '';
    var importApp = isPastOrPresentWallDate(out.appStartDate) ? out.appStartDate : '';
    var fromLog = typeof inferAppStartFromLog === 'function' ? inferAppStartFromLog(out) : '';
    importApp = earliestWallDate(importApp, isPastOrPresentWallDate(fromLog) ? fromLog : '');

    var deviceTrialExpired = false;
    if (deviceBefore.trialStartedAt && typeof Entitlement !== 'undefined') {
        var devProbe = trialProbeState(deviceBefore, deviceApp, deviceBefore.trialStartedAt);
        deviceTrialExpired = !Entitlement.isTrialActive(devProbe);
    }

    var chosenApp = '';
    if (deviceHasEstablishedProgress(deviceBefore) || deviceApp || deviceBefore.trialStartedAt) {
        chosenApp = earliestWallDate(deviceApp, importApp);
        if (deviceTrialExpired) {
            chosenApp = deviceApp || chosenApp;
            if (deviceBefore.trialStartedAt) out.trialStartedAt = deviceBefore.trialStartedAt;
        }
    } else {
        chosenApp = importApp;
    }

    if (chosenApp) out.appStartDate = chosenApp;
    else if (!isPastOrPresentWallDate(out.appStartDate)) out.appStartDate = '';

    if (out.trialStartedAt) {
        var trialStart = new Date(out.trialStartedAt);
        if (Number.isNaN(trialStart.getTime()) || trialStart.getTime() > Date.now()) {
            out.trialStartedAt = deviceTrialExpired ? (deviceBefore.trialStartedAt || '') : '';
        }
    }
    if (deviceTrialExpired && deviceBefore.trialStartedAt) {
        out.trialStartedAt = deviceBefore.trialStartedAt;
    }
    if (chosenApp && !out.trialStartedAt && typeof trialStartIsoForCalendarDayOne === 'function') {
        out.trialStartedAt = trialStartIsoForCalendarDayOne(trialProbeState(out, chosenApp, ''));
    }

    return out;
}

function applyBackupImportState(deviceSnap, importedState) {
    var prepared = Object.assign({}, importedState || {});
    stripUntrustedBackupBillingFields(prepared);
    prepared = applyTrialAnchorPolicyForImport(prepared, deviceSnap || {});
    var deviceEnt = snapshotDeviceEntitlement(deviceSnap);
    replaceState(mergeSavedState(prepared));
    reconcileEntitlementAfterImport(deviceEnt);
    return deviceEnt;
}

/** Snapshot of app state for export to a JSON file on the user's device. */
function buildBackupPayload() {
    syncJourneyMilestoneCountsFromHistory(state);
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        onboardingComplete: safeGet('onboardingComplete') === 'true',
        state: JSON.parse(JSON.stringify(state)),
    };
}

/**
 * Parse an exported backup file (or raw saved state JSON).
 * @returns {{ ok: true, state, exportedAt, onboardingComplete } | { ok: false, error: string }}
 */
function parseBackupJson(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: 'invalid-json' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'invalid-json' };
    }

    let saved = parsed;
    let exportedAt = null;
    let onboardingComplete = null;

    if (parsed.format === BACKUP_FORMAT) {
        if (!parsed.state || typeof parsed.state !== 'object') {
            return { ok: false, error: 'missing-state' };
        }
        saved = parsed.state;
        exportedAt = parsed.exportedAt || null;
        onboardingComplete = parsed.onboardingComplete;
    }

    if (typeof saved.attempt !== 'number' || !saved.score || typeof saved.score !== 'object') {
        return { ok: false, error: 'not-king-backup' };
    }

    var savedForMerge = Object.assign({}, saved);
    stripUntrustedBackupBillingFields(savedForMerge);

    return {
        ok: true,
        state: mergeSavedState(savedForMerge),
        exportedAt,
        onboardingComplete,
    };
}

function recordLastBackupAt(iso) {
    safeSet(LAST_BACKUP_KEY, iso || new Date().toISOString());
}

function clearLastBackupAt() {
    safeRemove(LAST_BACKUP_KEY);
}

function formatLastBackupLabel() {
    const raw = safeGet(LAST_BACKUP_KEY);
    if (!raw) return 'Never';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return 'Never';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ════════════════════════════════════════════════════════
//  BACKUP — export / import JSON on device
// ════════════════════════════════════════════════════════

let pendingImportBackup = null;

function formatImportConfirmMessage() {
    if (!pendingImportBackup) return 'Restore this export? Current progress on this device will be replaced.';
    const when = pendingImportBackup.exportedAt
        ? new Date(pendingImportBackup.exportedAt).toLocaleString()
        : 'an earlier save';
    var journey = (pendingImportBackup.state && pendingImportBackup.state.attempt) || 1;
    return `Restore progress exported ${when}? (Journey ${journey}) This replaces your current progress on this device.`;
}

function isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function isNativeCapacitor() {
    try {
        return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
            && window.Capacitor.isNativePlatform());
    } catch (e) {
        return false;
    }
}

function getCapacitorPlugin(name) {
    var Cap = window.Capacitor;
    if (!Cap) return null;
    if (Cap.Plugins && Cap.Plugins[name]) return Cap.Plugins[name];
    if (typeof Cap.registerPlugin === 'function') {
        try { return Cap.registerPlugin(name); } catch (e) { return null; }
    }
    return null;
}

function isShareCancelled(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    var msg = String(err.message || err.errorMessage || err);
    return /cancel/i.test(msg);
}

function downloadBackupFile(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function getKingBackupExportPlugin() {
    return getCapacitorPlugin('KingBackupExport');
}

function isAndroidNative() {
    try {
        var Cap = window.Capacitor;
        return isNativeCapacitor() && Cap.getPlatform && Cap.getPlatform() === 'android';
    } catch (e) {
        return false;
    }
}

let pendingExportPayload = null;

function openExportChoiceModal(payload) {
    pendingExportPayload = payload;
    var modal = document.getElementById('exportChoiceModal');
    if (modal) modal.classList.add('active');
}

function closeExportChoiceModal() {
    pendingExportPayload = null;
    var modal = document.getElementById('exportChoiceModal');
    if (modal) modal.classList.remove('active');
}

function runAndroidNativeExport(mode) {
    var payload = pendingExportPayload;
    if (!payload) return;
    closeExportChoiceModal();

    var Export = getKingBackupExportPlugin();
    if (!Export) {
        shareNativeBackupFile(payload.json, payload.filename).then(function (result) {
            handleNativeShareExportResult(payload.exportedAt, payload.json, payload.filename, result);
        });
        return;
    }

    var opts = {
        content: payload.json,
        filename: payload.filename,
        mimeType: 'application/json',
    };
    var call = mode === 'downloads'
        ? Export.saveToDownloads(opts)
        : Export.saveAs(opts);

    Promise.resolve(call).then(function (result) {
        finishBackupExport(payload.exportedAt);
        var savedName = (result && result.filename) || payload.filename;
        if (mode === 'downloads') {
            showToast(0, 'Saved to Downloads: ' + savedName);
        } else {
            showToast(0, 'Backup saved: ' + savedName);
        }
    }).catch(function (err) {
        if (isShareCancelled(err)) return;
        console.error('King native export failed:', err);
        shareNativeBackupFile(payload.json, payload.filename).then(function (result) {
            handleNativeShareExportResult(payload.exportedAt, payload.json, payload.filename, result);
        });
    });
}

function handleNativeShareExportResult(exportedAt, json, filename, result) {
    if (result === 'shared') {
        finishBackupExport(exportedAt);
        return;
    }
    if (result === 'cancelled') return;
    shareWebBackupFile(json, filename, exportedAt);
}

function finishBackupExport(iso) {
    recordLastBackupAt(iso);
    renderBackupStatus();
}

function shareNativeBackupFile(json, filename) {
    if (!isNativeCapacitor()) return Promise.resolve(false);
    var FS = getCapacitorPlugin('Filesystem');
    var Share = getCapacitorPlugin('Share');
    if (!FS || !Share || typeof FS.writeFile !== 'function' || typeof Share.share !== 'function') {
        return Promise.resolve(false);
    }

    return FS.writeFile({
        path: filename,
        data: json,
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true,
    }).then(function () {
        return FS.getUri({ path: filename, directory: 'CACHE' });
    }).then(function (result) {
        var uri = result && result.uri;
        if (!uri) throw new Error('no-uri');
        return Share.share({
            title: 'King progress export',
            text: filename,
            files: [uri],
            dialogTitle: 'Save King progress',
        });
    }).then(function () {
        return 'shared';
    }).catch(function (err) {
        if (isShareCancelled(err)) return 'cancelled';
        console.error('King native export failed:', err);
        return false;
    });
}

function shareWebBackupFile(json, filename, exportedAt) {
    const file = new File([json], filename, { type: 'application/json' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'King progress export' })
            .then(function () {
                finishBackupExport(exportedAt);
                showToast(0, 'Export ready — save to Files or Drive.');
            })
            .catch(function (e) {
                if (isShareCancelled(e)) return;
                downloadBackupFile(json, filename);
                finishBackupExport(exportedAt);
                showToast(0, 'Look in Files for king-backup.');
            });
        return;
    }

    downloadBackupFile(json, filename);
    finishBackupExport(exportedAt);
    showToast(0, 'Look in Files for king-backup.');
}

function exportProgressBackup() {
    if (!isMobileDevice()) {
        showToast(0, 'Export is available on your phone — open the King app there.');
        return;
    }

    const payload = buildBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const filename = `king-backup-${todayKey()}.json`;
    const exportedAt = payload.exportedAt;

    if (isAndroidNative() && getKingBackupExportPlugin()) {
        openExportChoiceModal({ json, filename, exportedAt });
        return;
    }

    shareNativeBackupFile(json, filename).then(function (result) {
        handleNativeShareExportResult(exportedAt, json, filename, result);
    });
}

function openImportPicker() {
    if (!isMobileDevice()) {
        showToast(0, 'Import is available on your phone — open the King app there.');
        return;
    }
    var picker = document.getElementById('importFileInput');
    if (picker) picker.click();
}

function onImportFileSelected(e) {
    const input = e.target;
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const result = parseBackupJson(String(reader.result || ''));
        if (!result.ok) {
            const msg = result.error === 'invalid-json'
                ? 'That file is not valid JSON.'
                : 'That is not a valid King export file.';
            showToast(0, msg);
            return;
        }
        pendingImportBackup = result;
        showModal('import');
    };
    reader.onerror = () => showToast(0, 'Could not read that file.');
    reader.readAsText(file);
}

function restoreImportBackup(backup) {
    if (!backup || !backup.state) {
        showToast(0, 'Nothing to restore.');
        return;
    }
    var deviceSnap = JSON.parse(JSON.stringify(state));
    applyBackupImportState(deviceSnap, backup.state);
    if (typeof healStrandedJourneyEnd === 'function') healStrandedJourneyEnd();
    if (typeof recomputeCurrentStreak === 'function') recomputeCurrentStreak();
    if (backup.onboardingComplete === true) {
        safeSet('onboardingComplete', 'true');
    } else if (backup.onboardingComplete === false) {
        safeRemove('onboardingComplete');
    }
    chartPage = -1;
    chartMode = 'streaks';
    currentTab = 0;
    invalidateJourneyMilestonesRender();
    switchTab(0);
    switchChartMode('streaks');
    if (backup.exportedAt) recordLastBackupAt(backup.exportedAt);
    saveToStorage(state);
    if (typeof isSubscriptionCommerceUiEnabled === 'function' && isSubscriptionCommerceUiEnabled()) {
        if (typeof refreshStorePurchasesSilent === 'function') refreshStorePurchasesSilent();
    }
    if (Entitlement.hasPremiumAccess()) {
        unlockPremiumFeatures();
    } else {
        renderAll();
    }
    if (safeGet('onboardingComplete')) {
        checkNewDay();
        if (Entitlement.hasPremiumAccess()) unlockPremiumFeatures();
        else renderAll();
    }
    else checkOnboarding();
    showToast(0, 'Progress restored.');
}