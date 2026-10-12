const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_PORTS, validatePorts, normalizeSettings, readSettings, writeSettings
} = require('../electron/settings.cjs');
const { resolveLanguage } = require('../electron/language.cjs');

test('settings keep the default ports and migrate older files', () => {
  assert.deepEqual(normalizeSettings({ enterAfterScan: false }), {
    enterAfterScan: false, sound: true, language: 'auto', ...DEFAULT_PORTS
  });
  assert.deepEqual(normalizeSettings({ port: '9000', setupPort: 9001 }), {
    enterAfterScan: true, sound: true, language: 'auto', ...DEFAULT_PORTS
  });
});

test('language follows the system locale unless explicitly selected', () => {
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh');
  assert.equal(resolveLanguage('auto', 'zh_Hant_TW'), 'zh');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('auto', 'ja-JP'), 'en');
  assert.equal(resolveLanguage('zh', 'en-US'), 'zh');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
});

test('settings validate distinct integer ports and persist them', () => {
  for (const ports of [
    { port: 0, setupPort: 8788 },
    { port: 1.5, setupPort: 8788 },
    { port: 8787, setupPort: 8787 },
    { port: 65536, setupPort: 8788 },
    { port: 8787, setupPort: Number.NaN }
  ]) {
    assert.throws(() => validatePorts(ports), /端口号|不能使用/);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-settings-tests-'));
  const filename = path.join(directory, 'nested', 'settings.json');
  try {
    const settings = {
      enterAfterScan: false, sound: false, language: 'auto', port: 19001, setupPort: 19002
    };
    writeSettings(filename, settings);
    assert.deepEqual(readSettings(filename), settings);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
