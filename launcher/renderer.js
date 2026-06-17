const { ipcRenderer } = require('electron');

const btnUpdate = document.getElementById('btn-update');
const updateText = document.getElementById('update-text');
const updateLoader = document.getElementById('update-loader');
const localVersionEl = document.getElementById('local-version');
const modStatusEl = document.getElementById('mod-status');

const btnServer = document.getElementById('btn-server');
const serverLogs = document.getElementById('server-logs');
const connectionStatus = document.getElementById('connection-status');

let isServerRunning = false;

// ---------------------
// Mod Updater Logic
// ---------------------
async function refreshModStatus() {
  const status = await ipcRenderer.invoke('check-mod-status');
  if (status.installed) {
    localVersionEl.textContent = status.version;
    modStatusEl.textContent = 'Installed';
    modStatusEl.className = 'status-badge active';
  } else {
    localVersionEl.textContent = 'Not Found';
    modStatusEl.textContent = 'Missing';
    modStatusEl.className = 'status-badge';
    modStatusEl.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
    modStatusEl.style.color = 'var(--error)';
  }
}

btnUpdate.addEventListener('click', async () => {
  btnUpdate.disabled = true;
  updateText.textContent = 'Downloading...';
  updateLoader.style.display = 'block';

  try {
    await ipcRenderer.invoke('install-mod');
    await refreshModStatus();
    updateText.textContent = 'Update Successful!';
    btnUpdate.className = 'btn btn-primary';
    btnUpdate.style.background = 'linear-gradient(135deg, var(--success) 0%, #059669 100%)';
    setTimeout(() => {
        updateText.textContent = 'Install / Update Mod';
        btnUpdate.className = 'btn btn-primary';
        btnUpdate.style.background = '';
        btnUpdate.disabled = false;
    }, 3000);
  } catch (err) {
    updateText.textContent = 'Error: ' + err.message;
    btnUpdate.className = 'btn btn-danger';
    btnUpdate.disabled = false;
    updateLoader.style.display = 'none';
  }
  updateLoader.style.display = 'none';
});

// ---------------------
// Server Logic
// ---------------------
function appendLog(text, isError = false) {
  const el = document.createElement('div');
  el.className = isError ? 'log-entry log-error' : 'log-entry';
  el.textContent = text.trim();
  serverLogs.appendChild(el);
  serverLogs.scrollTop = serverLogs.scrollHeight;
}

btnServer.addEventListener('click', async () => {
  if (isServerRunning) {
      await ipcRenderer.invoke('stop-server');
  } else {
      btnServer.disabled = true;
      btnServer.textContent = 'Starting...';
      const res = await ipcRenderer.invoke('start-server');
      if (!res.success) {
          appendLog(res.message, true);
          btnServer.disabled = false;
          btnServer.textContent = 'Start Server';
      } else {
          isServerRunning = true;
          btnServer.disabled = false;
          btnServer.textContent = 'Stop Server';
          btnServer.className = 'btn btn-danger';
          connectionStatus.textContent = 'Server Running';
          connectionStatus.classList.add('active');
          serverLogs.innerHTML = ''; // Clear logs on start
      }
  }
});

ipcRenderer.on('server-log', (e, data) => {
    appendLog(data);
});

ipcRenderer.on('server-error', (e, data) => {
    appendLog(data, true);
});

ipcRenderer.on('server-stopped', (e, code) => {
    isServerRunning = false;
    btnServer.textContent = 'Start Server';
    btnServer.className = 'btn btn-primary';
    connectionStatus.textContent = 'Server Offline';
    connectionStatus.classList.remove('active');
    appendLog(`[System] Server stopped with exit code ${code}`);
});

// Initialize
refreshModStatus();
