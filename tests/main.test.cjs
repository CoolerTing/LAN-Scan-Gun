const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../electron/settings.cjs');

async function desktop(dataDir, platform = 'win32') {
  const handlers = new Map();
  const server = {
    history: [],
    info: () => ({ port: server.port, setupPort: server.setupPort }),
    setPorts: async (ports) => { Object.assign(server, ports); return server.info(); },
    updateSettings: () => {}
  };
  let startup;
  const errors = [];
  const inputs = [];
  const openedUrls = [];
  let trusted = false;
  let permissionRequests = 0;
  const mockElectron = {
    app: {
      getPath: () => dataDir, requestSingleInstanceLock: () => true,
      on: () => {}, quit: () => {},
      whenReady: () => ({ then: (callback) => { startup = callback(); } })
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    shell: { openExternal: async (url) => { openedUrls.push(url); } },
    dialog: { showErrorBox: (...args) => errors.push(args) },
    BrowserWindow: class {
      constructor() { this.webContents = { setWindowOpenHandler: () => {}, on: () => {} }; }
      setMenuBarVisibility() {}
      loadFile() {}
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.resolve(__dirname, '../electron'), process: { platform },
    require(name) {
      if (name === 'electron') return mockElectron;
      if (name === 'node:fs') return {
        ...fs, existsSync: (filename) => filename.endsWith(path.join('dist', 'index.html')) || fs.existsSync(filename)
      };
      if (name === './settings.cjs') return settings;
      if (name === './input.cjs') return {
        createInput: () => ({
          send: async (...args) => { inputs.push(args); },
          getStatus: async () => ({ supported: true, trusted: platform !== 'darwin' || trusted }),
          requestPermission: async () => {
            permissionRequests++;
            return { supported: true, trusted };
          }
        })
      };
      if (name === './server.cjs') return {
        getAddresses: () => [],
        createScannerServer: async (options) => {
          server.port = options.port;
          server.setupPort = options.setupPort;
          server.inject = options.inject;
          return server;
        }
      };
      return require(name);
    }
  });
  await startup;
  assert.deepEqual(errors, []);
  return {
    server, inputs, openedUrls, permissionRequests: () => permissionRequests,
    authorize: () => { trusted = true; },
    invoke: (name, payload) => handlers.get(name)(null, payload)
  };
}

test('desktop saves ports across restart and boolean settings do not overwrite them', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-desktop-tests-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = await desktop(directory);
  assert.deepEqual(first.server.info(), { port: 8787, setupPort: 8788 });
  await first.invoke('ports-changed', { port: 19001, setupPort: 19002 });
  first.invoke('settings-changed', { enterAfterScan: false, sound: false });
  const saved = settings.readSettings(path.join(directory, 'settings.json'));
  assert.deepEqual(saved, { port: 19001, setupPort: 19002, enterAfterScan: false, sound: false });
  const restarted = await desktop(directory);
  assert.deepEqual(restarted.server.info(), { port: 19001, setupPort: 19002 });
  assert.equal((await restarted.invoke('get-app-info')).settings.enterAfterScan, false);
});

test('desktop rolls back service ports when settings cannot be saved', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-save-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const running = await desktop(directory);
  fs.mkdirSync(path.join(directory, 'settings.json.tmp'));
  await assert.rejects(running.invoke('ports-changed', { port: 19001, setupPort: 19002 }), /已恢复原端口/);
  assert.deepEqual(running.server.info(), { port: 8787, setupPort: 8788 });
  assert.equal((await running.invoke('get-app-info')).settings.port, 8787);
});

test('macOS desktop shares scan injection and reports real input permission status', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-macos-desktop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const running = await desktop(directory, 'darwin');
  const info = await running.invoke('get-app-info');
  assert.equal(info.platform, 'darwin');
  assert.equal(info.inputStatus.trusted, false);
  await running.server.inject('  中文-123  ', false);
  await running.server.inject('NEXT', true);
  assert.deepEqual(running.inputs, [['  中文-123  ', false], ['NEXT', true]]);
  await running.invoke('request-input-permission');
  assert.equal(running.permissionRequests(), 1);
  assert.deepEqual(running.openedUrls, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  ]);
  running.authorize();
  assert.equal((await running.invoke('get-input-status')).trusted, true);
  await running.invoke('request-input-permission');
  assert.equal(running.openedUrls.length, 1, 'authorized input does not open settings again');
});

test('Windows desktop does not request macOS permissions', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-windows-desktop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const running = await desktop(directory);
  assert.equal((await running.invoke('request-input-permission')).trusted, true);
  assert.equal(running.permissionRequests(), 0);
  assert.deepEqual(running.openedUrls, []);
});
