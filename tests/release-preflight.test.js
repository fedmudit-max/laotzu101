const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    validateReleaseConfig,
    isPlaceholderKey,
} = require('../scripts/release-preflight');

const VALID_KEY = 'goog_AbCdEfGhIjKlMnOpQrStUv';

function writeFixture(root, files) {
    Object.keys(files).forEach(function (rel) {
        const dest = path.join(root, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, files[rel], 'utf8');
    });
}

function baseConstants(overrides) {
    const lines = [
        'var KING_USE_REVENUECAT = true;',
        'var REVENUECAT_API_KEY_ANDROID = \'\';',
        'var REVENUECAT_ENTITLEMENT_ID = \'premium\';',
        'var REVENUECAT_PACKAGE_IDENTIFIERS = {',
        '    monthly: \'$rc_monthly\',',
        '    annual: \'$rc_annual\',',
        '};',
    ];
    return lines.join('\n') + '\n' + (overrides || '');
}

function baseGradle(versionCode) {
    return [
        'android {',
        '    defaultConfig {',
        '        applicationId "com.kingtracker.app"',
        '        versionCode ' + versionCode,
        '        versionName "1.0.2"',
        '    }',
        '}',
    ].join('\n');
}

function makeRoot(tmp, opts) {
    opts = opts || {};
    writeFixture(tmp, {
        'constants.js': opts.constants || baseConstants(),
        'constants-revenuecat.local.js': opts.local
            || ('var REVENUECAT_API_KEY_ANDROID = \''
                + (opts.key !== undefined ? opts.key : VALID_KEY) + '\';\n'),
        'android/app/build.gradle': opts.gradle || baseGradle(
            opts.versionCode !== undefined ? opts.versionCode : 10,
        ),
    });
    if (opts.withAssets) {
        const key = opts.key !== undefined ? opts.key : VALID_KEY;
        writeFixture(tmp, {
            'android/app/src/main/assets/public/constants.js': opts.constants || baseConstants(),
            'android/app/src/main/assets/public/constants-revenuecat.local.js':
                'var REVENUECAT_API_KEY_ANDROID = \'' + key + '\';\n',
        });
    }
}

test('valid release configuration passes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { withAssets: true, versionCode: 10 });
    const r = validateReleaseConfig({ root: tmp, checkAssets: true });
    assert.equal(r.ok, true);
});

test('missing RevenueCat local file fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    writeFixture(tmp, {
        'constants.js': baseConstants(),
        'android/app/build.gradle': baseGradle(10),
    });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /missing/i.test(e)));
});

test('empty RevenueCat key fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { key: '', withAssets: false });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('dummy placeholder key fails', () => {
    assert.equal(isPlaceholderKey('goog_test_key'), true);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { key: 'goog_test_key' });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('incorrect key prefix fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { key: 'appl_invalidkeyvalue' });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /goog_/i.test(e)));
});

test('RevenueCat disabled fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    const constants = baseConstants().replace('KING_USE_REVENUECAT = true', 'KING_USE_REVENUECAT = false');
    makeRoot(tmp, { constants });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('incorrect entitlement identifier fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    const broken = baseConstants().replace(
        "REVENUECAT_ENTITLEMENT_ID = 'premium'",
        "REVENUECAT_ENTITLEMENT_ID = 'pro'",
    );
    makeRoot(tmp, { constants: broken });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('incorrect monthly package identifier fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    const broken = baseConstants().replace('$rc_monthly', 'monthly');
    makeRoot(tmp, { constants: broken });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('incorrect annual package identifier fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    const broken = baseConstants().replace('$rc_annual', 'annual');
    makeRoot(tmp, { constants: broken });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('missing generated configuration in Android assets fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { withAssets: false });
    const r = validateReleaseConfig({ root: tmp, checkAssets: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Android asset/i.test(e)));
});

test('invalid Android versionCode fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { versionCode: 0 });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false });
    assert.equal(r.ok, false);
});

test('versionCode not greater than supplied previous fails', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { versionCode: 9 });
    const r = validateReleaseConfig({ root: tmp, checkAssets: false, previousVersionCode: 9 });
    assert.equal(r.ok, false);
});

test('valid versionCode increase passes previous check', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'king-preflight-'));
    makeRoot(tmp, { versionCode: 10, withAssets: true });
    const r = validateReleaseConfig({ root: tmp, checkAssets: true, previousVersionCode: 9 });
    assert.equal(r.ok, true);
});