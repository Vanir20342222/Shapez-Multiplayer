const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPublicIp: () => ipcRenderer.invoke('get-public-ip'),
  checkModStatus: () => ipcRenderer.invoke('check-mod-status'),
  installMod: () => ipcRenderer.invoke('install-mod'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  onServerLog: (callback) => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('server-log', fn);
    return () => ipcRenderer.removeListener('server-log', fn);
  },
  onServerError: (callback) => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('server-error', fn);
    return () => ipcRenderer.removeListener('server-error', fn);
  },
  onServerStopped: (callback) => {
    const fn = (_event, code) => callback(code);
    ipcRenderer.on('server-stopped', fn);
    return () => ipcRenderer.removeListener('server-stopped', fn);
  },
});
