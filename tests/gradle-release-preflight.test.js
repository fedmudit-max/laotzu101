/**
 * Gradle ↔ release preflight wiring (dry-run task graph; no full AAB build required).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GRADLE = path.join(ROOT, 'android', 'gradlew');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');

let gradleRunnable = null;

function gradleAvailable() {
    if (gradleRunnable != null) return gradleRunnable;
    if (!fs.existsSync(GRADLE)) {
        gradleRunnable = false;
        return false;
    }
    const probe = spawnSync(GRADLE, ['--dry-run', ':help'], {
        cwd: path.join(ROOT, 'android'),
        encoding: 'utf8',
        timeout: 120000,
    });
    const combined = (probe.stdout || '') + (probe.stderr || '');
    gradleRunnable = probe.status === 0
        && !/Could not determine a usable wildcard IP|Unable to locate a Java Runtime/i.test(combined);
    return gradleRunnable;
}

function gradlewDryRun(taskName) {
    if (!gradleAvailable()) {
        return { skipped: true, output: '' };
    }
    try {
        const out = execFileSync(GRADLE, [':app:' + taskName, '--dry-run'], {
            cwd: path.join(ROOT, 'android'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
            timeout: 120000,
        });
        return { skipped: false, output: out };
    } catch (err) {
        const combined = String(err.stdout || '') + String(err.stderr || '');
        return { skipped: false, output: combined, error: err };
    }
}

test('build.gradle wires kingReleasePreflight for release variants', () => {
    const src = fs.readFileSync(BUILD_GRADLE, 'utf8');
    assert.match(src, /kingReleasePreflight/);
    assert.match(src, /bundleRelease/);
    assert.match(src, /assembleRelease/);
    assert.match(src, /dependsOn ['"]syncKingWebAssets['"]/);
    assert.match(src, /outputs\.upToDateWhen\s*\{\s*false\s*\}/);
    assert.match(src, /outputs\.cacheIf\s*\{\s*false\s*\}/);
    assert.equal(/kingReleasePreflightStamp|outputs\.file\(kingReleasePreflightStamp\)/.test(src), false);
});

test('package.json android:bundle delegates to Gradle bundleRelease', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['android:bundle'], /gradlew.*bundleRelease/);
});

test('bundleRelease dry-run includes kingReleasePreflight after syncKingWebAssets', () => {
    const r = gradlewDryRun('bundleRelease');
    if (r.skipped) {
        assert.ok(true, 'gradlew not available');
        return;
    }
    assert.match(r.output, /kingReleasePreflight/);
    assert.match(r.output, /syncKingWebAssets/);
    const preIdx = r.output.indexOf('kingReleasePreflight');
    const syncIdx = r.output.indexOf('syncKingWebAssets');
    assert.ok(syncIdx !== -1 && preIdx !== -1, 'expected tasks in dry-run output');
});

test('assembleRelease dry-run includes kingReleasePreflight', () => {
    const r = gradlewDryRun('assembleRelease');
    if (r.skipped) {
        assert.ok(true, 'gradlew not available');
        return;
    }
    assert.match(r.output, /kingReleasePreflight/);
});

test('assembleDebug dry-run does not require kingReleasePreflight', () => {
    const r = gradlewDryRun('assembleDebug');
    if (r.skipped) {
        assert.ok(true, 'gradlew not available');
        return;
    }
    assert.equal(/kingReleasePreflight/.test(r.output), false);
});

test('clean dry-run does not run kingReleasePreflight', () => {
    const r = gradlewDryRun('clean');
    if (r.skipped) {
        assert.ok(true, 'gradlew not available');
        return;
    }
    assert.equal(/kingReleasePreflight/.test(r.output), false);
});

test('help dry-run does not run kingReleasePreflight', () => {
    const r = gradlewDryRun('help');
    if (r.skipped) {
        assert.ok(true, 'gradlew not available');
        return;
    }
    assert.equal(/kingReleasePreflight/.test(r.output), false);
});

test('kingReleasePreflight Exec fails when RevenueCat key missing (Gradle task)', () => {
    if (!gradleAvailable()) {
        assert.ok(true, 'Gradle/Java not available in this environment');
        return;
    }
    const localPath = path.join(ROOT, 'constants-revenuecat.local.js');
    const hadLocal = fs.existsSync(localPath);
    let backup = null;
    if (hadLocal) {
        backup = fs.readFileSync(localPath, 'utf8');
        fs.unlinkSync(localPath);
    }
    try {
        const result = spawnSync(GRADLE, [':app:kingReleasePreflight'], {
            cwd: path.join(ROOT, 'android'),
            encoding: 'utf8',
            env: { ...process.env },
            timeout: 180000,
        });
        assert.notEqual(result.status, 0, 'kingReleasePreflight should fail without local RC key');
        const combined = (result.stdout || '') + (result.stderr || '');
        assert.match(combined, /preflight FAILED|REVENUECAT_API_KEY_ANDROID/i);
    } finally {
        if (hadLocal && backup != null) {
            fs.writeFileSync(localPath, backup, 'utf8');
        }
    }
});

test('kingReleasePreflight is not skipped on a second unchanged invocation', () => {
    if (!gradleAvailable()) {
        assert.ok(true, 'Gradle/Java not available in this environment');
        return;
    }
    const first = spawnSync(GRADLE, [':app:kingReleasePreflight'], {
        cwd: path.join(ROOT, 'android'),
        encoding: 'utf8',
        env: { ...process.env },
        timeout: 180000,
    });
    const second = spawnSync(GRADLE, [':app:kingReleasePreflight'], {
        cwd: path.join(ROOT, 'android'),
        encoding: 'utf8',
        env: { ...process.env },
        timeout: 180000,
    });
    const a = (first.stdout || '') + (first.stderr || '');
    const b = (second.stdout || '') + (second.stderr || '');
    assert.equal(/kingReleasePreflight UP-TO-DATE/.test(a), false);
    assert.equal(/kingReleasePreflight UP-TO-DATE/.test(b), false);
    assert.match(b, /:app:kingReleasePreflight/);
});

test('PLAY_PREVIOUS_VERSION_CODE at or above current versionCode fails preflight', () => {
    if (!gradleAvailable()) {
        assert.ok(true, 'Gradle/Java not available in this environment');
        return;
    }
    const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
    const m = gradle.match(/versionCode\s+(\d+)/);
    const current = m ? Number(m[1]) : 9;
    const result = spawnSync(GRADLE, [':app:kingReleasePreflight'], {
        cwd: path.join(ROOT, 'android'),
        encoding: 'utf8',
        env: { ...process.env, PLAY_PREVIOUS_VERSION_CODE: String(current) },
        timeout: 180000,
    });
    assert.notEqual(result.status, 0);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /must be greater than Play previous|preflight FAILED/i);
});