/**
 * Install the debug APK on the first attached emulator/device and launch King.
 * Prefer ANDROID_SERIAL when more than one device is listed.
 *
 * Play Internal/Closed builds are signed with your upload key; debug APK uses the
 * debug keystore. Android rejects install -r over mismatched signatures — we uninstall
 * the Play build once, then install debug (local data in app storage is removed).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APK = path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const PKG = 'com.kingtracker.app';
const ACTIVITY = PKG + '/.MainActivity';
const PREFERRED = 'adb-RZCW9196MKZ-J4man8._adb-tls-connect._tcp';

function adbBin() {
    const home = process.env.ANDROID_HOME || path.join(process.env.HOME || '', 'Library/Android/sdk');
    const sdkAdb = path.join(home, 'platform-tools/adb');
    return fs.existsSync(sdkAdb) ? sdkAdb : 'adb';
}

function adb(args, opts) {
    return execFileSync(adbBin(), args, Object.assign({ encoding: 'utf8' }, opts || {}));
}

function listDevices() {
    return adb(['devices'])
        .split('\n')
        .slice(1)
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return /\tdevice$/.test(line); })
        .map(function (line) { return line.split('\t')[0]; });
}

function installApk(serial) {
    try {
        adb(['-s', serial, 'install', '-r', APK], { stdio: 'pipe' });
        return { ok: true };
    } catch (err) {
        const combined = [
            err.message,
            err.stderr,
            err.stdout,
        ].filter(Boolean).join('\n');
        const sigMismatch = /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(combined);
        return { ok: false, sigMismatch: sigMismatch, detail: combined };
    }
}

if (!fs.existsSync(APK)) {
    console.error('No debug APK. Run: npm run android:debug');
    process.exit(1);
}

const devices = listDevices();
if (!devices.length) {
    console.error('No Android device. Turn on wireless debugging, then: npm run android:install');
    process.exit(1);
}

const wanted = process.env.ANDROID_SERIAL || '';
let serial = wanted;
if (!serial || devices.indexOf(serial) === -1) {
    if (devices.indexOf(PREFERRED) !== -1) serial = PREFERRED;
    else serial = devices[0];
}

console.log('Installing King on ' + serial);
let result = installApk(serial);
if (!result.ok && result.sigMismatch) {
    console.warn(
        '\nPlay/test-track King uses a different signing key than this debug APK.\n' +
        'Uninstalling ' + PKG + ' (app data on the phone for King will be removed).\n' +
        'Export a backup from Settings first if you need your log.\n'
    );
    adb(['-s', serial, 'uninstall', PKG], { stdio: 'inherit' });
    result = installApk(serial);
}

if (!result.ok) {
    console.error(result.detail || 'adb install failed');
    process.exit(1);
}

adb(['-s', serial, 'shell', 'am', 'force-stop', PKG], { stdio: 'inherit' });
adb(['-s', serial, 'shell', 'am', 'start', '-n', ACTIVITY], { stdio: 'inherit' });