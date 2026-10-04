const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadDateHelpers() {
    const sandbox = { Date, String, Number, Object, Math };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'constants.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic-dates-log.js'), 'utf8'), sandbox);
    return sandbox;
}

test('early strong confirm hint before 8pm local', () => {
    const ctx = loadDateHelpers();
    const msg = vm.runInContext(
        'getEarlyStrongLogConfirmHint(new Date(2026, 5, 15, 19, 30, 0))',
        ctx
    );
    assert.equal(
        msg,
        'It\u2019s 7:30 PM, early to log now. For accuracy, log around 9pm or bedtime. You can turn on the reminder in settings.'
    );
});

test('no early strong confirm hint when daily reminder is on', () => {
    const ctx = loadDateHelpers();
    ctx.isDailyReminderEnabled = () => true;
    assert.equal(
        vm.runInContext('getEarlyStrongLogConfirmHint(new Date(2026, 5, 15, 19, 30, 0))', ctx),
        null
    );
});

test('no early strong confirm hint at or after 8pm local', () => {
    const ctx = loadDateHelpers();
    assert.equal(
        vm.runInContext('getEarlyStrongLogConfirmHint(new Date(2026, 5, 15, 20, 0, 0))', ctx),
        null
    );
    assert.equal(
        vm.runInContext('getEarlyStrongLogConfirmHint(new Date(2026, 5, 15, 21, 0, 0))', ctx),
        null
    );
});
