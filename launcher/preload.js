const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPublicIp: () => ipcRenderer.invoke('get-public-ip'),
  checkModStatus: () => ipcRenderer.invoke('check-mod-status'),
  installMod: () => ipcRenderer.invoke('install-mod'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  onServerLog: (callback) => ipcRenderer.on('server-log', (_event, data) => callback(data)),
  onServerError: (callback) => ipcRenderer.on('server-error', (_event, data) => callback(data)),
  onServerStopped: (callback) => ipcRenderer.on('server-stopped', (_event, code) => callback(code)),
});
