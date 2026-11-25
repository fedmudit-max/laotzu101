/**
 * King release preflight — offline checks before android:bundle (no network, no key echo).
 */
const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDER_KEYS = new Set([
    '',
    'goog_REPLACE_WITH_REVENUECAT_PUBLIC_KEY',
    'goog_REPLACE_WITH',
    'goog_xxx',
    'goog_test_key',
    'goog_test',
    'REPLACE_WITH',
    'YOUR_KEY_HERE',
]);

const PLACEHOLDER_PATTERN = /REPLACE|TODO|DUMMY|EXAMPLE|_xxx\b/i;

function maskKey(key) {
    if (!key || typeof key !== 'string') return '(missing)';
    const t = key.trim();
    if (t.length < 8) return '(too short)';
    return t.slice(0, 5) + '…' + t.slice(-4);
}

function parseBoolVar(text, name) {
    const re = new RegExp('var\\s+' + name + '\\s*=\\s*(true|false)', 'i');
    const m = text.match(re);
    return m ? m[1].toLowerCase() === 'true' : false;
}

function parseStringVar(text, name) {
    const re = new RegExp('var\\s+' + name + '\\s*=\\s*[\'"]([^\'"]*)[\'"]', 'i');
    const m = text.match(re);
    return m ? m[1] : '';
}

function parsePackageIdentifiers(text) {
    const block = text.match(/REVENUECAT_PACKAGE_IDENTIFIERS\s*=\s*\{([\s\S]*?)\};/);
    if (!block) return { monthly: '', annual: '' };
    const inner = block[1];
    const monthly = inner.match(/monthly:\s*['"]([^'"]+)['"]/);
    const annual = inner.match(/annual:\s*['"]([^'"]+)['"]/);
    return {
        monthly: monthly ? monthly[1] : '',
        annual: annual ? annual[1] : '',
    };
}

function resolveAndroidKey(constantsText, localText) {
    const fromConstants = parseStringVar(constantsText, 'REVENUECAT_API_KEY_ANDROID');
    if (localText) {
        const fromLocal = parseStringVar(localText, 'REVENUECAT_API_KEY_ANDROID');
        if (fromLocal) return fromLocal.trim();
    }
    return (fromConstants || '').trim();
}

function isPlaceholderKey(key) {
    if (!key) return true;
    const t = String(key).trim();
    if (PLACEHOLDER_KEYS.has(t)) return true;
    if (PLACEHOLDER_PATTERN.test(t)) return true;
    return t.length < 12;
}

function readAndroidGradle(root) {
    const gradlePath = path.join(root, 'android/app/build.gradle');
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    const appId = gradle.match(/applicationId\s+"([^"]+)"/);
    const versionCode = gradle.match(/versionCode\s+(\d+)/);
    return {
        applicationId: appId ? appId[1] : '',
        versionCode: versionCode ? parseInt(versionCode[1], 10) : 0,
    };
}

/**
 * @param {{ root?: string, checkAssets?: boolean, previousVersionCode?: number|null }} options
 * @returns {{ ok: boolean, errors: string[], meta: object }}
 */
function validateReleaseConfig(options) {
    options = options || {};
    const root = options.root || path.join(__dirname, '..');
    const errors = [];
    const checkAssets = options.checkAssets !== false;
    let previousVersionCode = options.previousVersionCode;
    if (previousVersionCode == null && process.env.PLAY_PREVIOUS_VERSION_CODE != null) {
        previousVersionCode = Number(process.env.PLAY_PREVIOUS_VERSION_CODE);
    }

    const constantsPath = path.join(root, 'constants.js');
    const localPath = path.join(root, 'constants-revenuecat.local.js');
    if (!fs.existsSync(constantsPath)) {
        errors.push('Missing constants.js');
        return { ok: false, errors, meta: {} };
    }
    const constantsText = fs.readFileSync(constantsPath, 'utf8');
    const localText = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';

    if (!parseBoolVar(constantsText, 'KING_USE_REVENUECAT')) {
        errors.push('KING_USE_REVENUECAT must be true for release builds');
    }

    const ent = parseStringVar(constantsText, 'REVENUECAT_ENTITLEMENT_ID') || 'premium';
    if (ent !== 'premium') {
        errors.push('REVENUECAT_ENTITLEMENT_ID must be "premium" (found "' + ent + '")');
    }

    const pkgs = parsePackageIdentifiers(constantsText);
    if (pkgs.monthly !== '$rc_monthly') {
        errors.push('REVENUECAT monthly package must be $rc_monthly');
    }
    if (pkgs.annual !== '$rc_annual') {
        errors.push('REVENUECAT annual package must be $rc_annual');
    }

    const key = resolveAndroidKey(constantsText, localText);
    if (!key) {
        errors.push('REVENUECAT_API_KEY_ANDROID is missing (set constants-revenuecat.local.js)');
    } else if (!key.startsWith('goog_')) {
        errors.push('REVENUECAT_API_KEY_ANDROID must start with goog_ (masked: ' + maskKey(key) + ')');
    } else if (isPlaceholderKey(key)) {
        errors.push('REVENUECAT_API_KEY_ANDROID looks like a placeholder (masked: ' + maskKey(key) + ')');
    }

    let gradle = { applicationId: '', versionCode: 0 };
    try {
        gradle = readAndroidGradle(root);
    } catch (e) {
        errors.push('Could not read android/app/build.gradle');
    }
    if (gradle.applicationId !== 'com.kingtracker.app') {
        errors.push('applicationId must be com.kingtracker.app');
    }
    if (!Number.isInteger(gradle.versionCode) || gradle.versionCode < 1) {
        errors.push('versionCode must be a positive integer');
    }
    if (previousVersionCode != null && !Number.isNaN(Number(previousVersionCode))) {
        if (gradle.versionCode <= Number(previousVersionCode)) {
            errors.push(
                'versionCode ' + gradle.versionCode + ' must be greater than Play previous '
                + Number(previousVersionCode),
            );
        }
    }

    if (checkAssets) {
        const assetsRoot = path.join(root, 'android/app/src/main/assets/public');
        const assetsConstants = path.join(assetsRoot, 'constants.js');
        const assetsLocal = path.join(assetsRoot, 'constants-revenuecat.local.js');
        if (!fs.existsSync(assetsConstants)) {
            errors.push('Missing Android asset constants.js — run npm run web:copy first');
        }
        if (!fs.existsSync(assetsLocal)) {
            errors.push('Missing Android asset constants-revenuecat.local.js — run npm run web:copy first');
        } else if (fs.existsSync(assetsConstants)) {
            const assetKey = resolveAndroidKey(
                fs.readFileSync(assetsConstants, 'utf8'),
                fs.readFileSync(assetsLocal, 'utf8'),
            );
            if (!assetKey.startsWith('goog_') || isPlaceholderKey(assetKey)) {
                errors.push('Android public bundle lacks a valid RevenueCat key (masked: ' + maskKey(assetKey) + ')');
            }
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        meta: {
            versionCode: gradle.versionCode,
            keyMasked: maskKey(key),
        },
    };
}

function main() {
    const argv = process.argv.slice(2);
    let skipAssets = false;
    let previous = undefined;
    argv.forEach(function (arg) {
        if (arg === '--skip-assets') skipAssets = true;
        const m = arg.match(/^--previous-version-code=(\d+)$/);
        if (m) previous = Number(m[1]);
    });
    const result = validateReleaseConfig({
        checkAssets: !skipAssets,
        previousVersionCode: previous,
    });
    if (result.ok) {
        console.log(
            'King release preflight: OK'
            + ' (versionCode ' + result.meta.versionCode
            + ', RC key ' + result.meta.keyMasked + ')',
        );
        process.exit(0);
    }
    console.error('King release preflight FAILED:');
    result.errors.forEach(function (err) {
        console.error('  • ' + err);
    });
    process.exit(1);
}

if (require.main === module) {
    main();
}

module.exports = {
    validateReleaseConfig,
    isPlaceholderKey,
    maskKey,
    resolveAndroidKey,
    parsePackageIdentifiers,
    PLACEHOLDER_KEYS,
};