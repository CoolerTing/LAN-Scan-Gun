const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scanGun', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openMobileUrl: () => ipcRenderer.invoke('open-mobile-url'),
  copyUrl: () => ipcRenderer.invoke('copy-url'),
  selectAddress: (address) => ipcRenderer.invoke('select-address', address),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  setSettings: (settings) => ipcRenderer.invoke('settings-changed', settings),
  setPorts: (ports) => ipcRenderer.invoke('ports-changed', ports),
  onServerEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('server-event', handler);
    return () => ipcRenderer.removeListener('server-event', handler);
  }
});
