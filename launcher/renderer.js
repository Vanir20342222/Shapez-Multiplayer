const btnUpdate = document.getElementById('btn-update');
const updateText = document.getElementById('update-text');
const updateLoader = document.getElementById('update-loader');
const localVersionEl = document.getElementById('local-version');
const modStatusEl = document.getElementById('mod-status');

const btnServer = document.getElementById('btn-server');
const serverLogs = document.getElementById('server-logs');
const connectionStatus = document.getElementById('connection-status');

let isServerRunning = false;
let currentPublicIp = 'Unknown';

// ---------------------
// Initialization
// ---------------------
async function init() {
  const ipEl = document.getElementById('public-ip');
  const ipContainer = document.getElementById('ip-display-container');
  
  try {
    currentPublicIp = await window.electronAPI.getPublicIp();
    ipEl.textContent = currentPublicIp;
  } catch(e) {
    // M18: Set to 'Failed' so stale 'Unknown' is not copied
    currentPublicIp = 'Failed';
    ipEl.textContent = 'Failed';
  }

  ipContainer.addEventListener('click', () => {
    if (currentPublicIp && currentPublicIp !== 'Unknown' && currentPublicIp !== 'Failed') {
      // M16: Error-handle clipboard write
      navigator.clipboard.writeText(currentPublicIp).then(() => {
        const oldText = ipEl.textContent;
        ipEl.textContent = 'Copied!';
        ipEl.style.color = '#43a047';
        setTimeout(() => {
          ipEl.textContent = oldText;
          ipEl.style.color = '#b39ddb';
        }, 1500);
      }).catch(() => {
        ipEl.textContent = 'Copy failed';
        ipEl.style.color = 'var(--error)';
        setTimeout(() => {
          ipEl.textContent = currentPublicIp;
          ipEl.style.color = '#b39ddb';
        }, 1500);
      });
    }
  });

  refreshModStatus();
}

window.addEventListener('DOMContentLoaded', init);

// ---------------------
// Mod Updater Logic
// ---------------------
async function refreshModStatus() {
  // M17: Error handling for IPC call
  try {
    const status = await window.electronAPI.checkModStatus();
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
  } catch (e) {
    localVersionEl.textContent = 'Error';
    modStatusEl.textContent = 'Error';
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
    await window.electronAPI.installMod();
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
    // L5: Auto-reset error state after 5 seconds
    setTimeout(() => {
      updateText.textContent = 'Install / Update Mod';
      btnUpdate.className = 'btn btn-primary';
      btnUpdate.style.background = '';
    }, 5000);
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
  // M15: Cap log entries at 500
  while (serverLogs.children.length > 500) {
    serverLogs.removeChild(serverLogs.firstChild);
  }
}

btnServer.addEventListener('click', async () => {
  if (isServerRunning) {
      await window.electronAPI.stopServer();
  } else {
      btnServer.disabled = true;
      btnServer.textContent = 'Starting...';
      const res = await window.electronAPI.startServer();
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

window.electronAPI.onServerLog((data) => {
    appendLog(data);
});

window.electronAPI.onServerError((data) => {
    appendLog(data, true);
});

window.electronAPI.onServerStopped((code) => {
    isServerRunning = false;
    btnServer.textContent = 'Start Server';
    btnServer.className = 'btn btn-primary';
    connectionStatus.textContent = 'Server Offline';
    connectionStatus.classList.remove('active');
    appendLog(`[System] Server stopped with exit code ${code}`);
});
