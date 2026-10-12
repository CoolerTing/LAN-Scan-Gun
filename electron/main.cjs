const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createScannerServer, getAddresses } = require('./server.cjs');
const { createInput } = require('./input.cjs');
const { normalizeSettings, readSettings, writeSettings, validatePorts } = require('./settings.cjs');

let window;
let server;
let input;
let preferences = normalizeSettings();
let savingPorts = false;
let shuttingDown = false;

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }

function emit(payload) {
  if (window && !window.isDestroyed()) window.webContents.send('server-event', payload);
}
function createWindow() {
  window = new BrowserWindow({
    width: 1160, height: 800, minWidth: 900, minHeight: 660,
    backgroundColor: '#f5f6f7', title: 'LAN Scan Gun',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
async function inputStatus() {
  return input.getStatus ? input.getStatus() : { supported: true, trusted: true };
}
ipcMain.handle('get-app-info', async () => ({
  ...server.info(), settings: preferences, addresses: getAddresses(),
  platform: process.platform, history: server.history, inputStatus: await inputStatus()
}));
ipcMain.handle('get-input-status', inputStatus);
ipcMain.handle('request-input-permission', async () => {
  if (process.platform !== 'darwin') return inputStatus();
  const status = await input.requestPermission();
  if (!status.trusted) {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  }
  return status;
});
ipcMain.handle('copy-url', () => clipboard.writeText(server.info().pairingUrl));
ipcMain.handle('open-mobile-url', () => shell.openExternal(server.info().pairingUrl));
ipcMain.handle('select-address', (_event, address) => {
  server.setAddress(address);
  return server.info();
});
ipcMain.handle('settings-changed', (_event, settings) => {
  const next = { ...preferences, enterAfterScan: Boolean(settings.enterAfterScan), sound: Boolean(settings.sound) };
  writeSettings(settingsPath(), next);
  preferences = next;
  server.updateSettings(preferences);
  return preferences;
});
ipcMain.handle('ports-changed', async (_event, ports) => {
  const next = validatePorts(ports);
  if (savingPorts) throw new Error('端口正在切换，请稍后再试。');
  savingPorts = true;
  const previous = { port: preferences.port, setupPort: preferences.setupPort };
  try {
    await server.setPorts(next);
    try {
      const updated = { ...preferences, ...next };
      writeSettings(settingsPath(), updated);
      preferences = updated;
    } catch (error) {
      await server.setPorts(previous);
      throw new Error(`端口设置未保存，已恢复原端口：${error.message}`);
    }
    return { ...server.info(), settings: preferences };
  } finally { savingPorts = false; }
});
ipcMain.handle('clear-history', () => server.clearHistory());

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      preferences = readSettings(settingsPath());
      if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
        throw new Error('缺少前端资源，请先执行 npm run build。');
      }
      input = createInput();
      server = await createScannerServer({
        root: path.join(__dirname, '..', 'dist'), dataDir: app.getPath('userData'),
        port: preferences.port, setupPort: preferences.setupPort,
        settings: preferences, inject: (value, enter) => input.send(value, enter), onEvent: emit
      });
      createWindow();
    } catch (error) {
      dialog.showErrorBox('启动失败', `${error.message}\n请检查端口 ${preferences.port}/${preferences.setupPort} 是否可用。`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    Promise.allSettled([server?.close(), input?.close()])
      .finally(() => app.quit());
  });
}
