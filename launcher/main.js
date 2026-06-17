const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow;
let serverProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
      serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Mod Updater IPC
ipcMain.handle('check-mod-status', async () => {
  const modsPath = getModsPath();
  const modFilePath = path.join(modsPath, 'shapez-multiplayer.js');
  
  if (!fs.existsSync(modsPath)) {
      fs.mkdirSync(modsPath, { recursive: true });
  }

  if (fs.existsSync(modFilePath)) {
      const code = fs.readFileSync(modFilePath, 'utf8');
      const match = code.match(/version:\s*"([^"]+)"/);
      return { installed: true, version: match ? match[1] : 'Unknown' };
  }
  return { installed: false, version: 'None' };
});

ipcMain.handle('install-mod', async () => {
  const modsPath = getModsPath();
  const modFilePath = path.join(modsPath, 'shapez-multiplayer.js');
  const repoUrl = "https://raw.githubusercontent.com/Vanir20342222/Shapez-Multiplayer/main/shapez-multiplayer.js";

  return new Promise((resolve, reject) => {
    https.get(repoUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          fs.writeFileSync(modFilePath, data, 'utf8');
          resolve(true);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
});

function getModsPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA, 'shapez.io', 'mods');
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'shapez.io', 'mods');
  } else {
    // Linux
    return path.join(os.homedir(), '.local', 'share', 'shapez.io', 'mods');
  }
}

// Server IPC
ipcMain.handle('start-server', async () => {
  if (serverProcess) {
      return { success: false, message: 'Server is already running.' };
  }

  // Find server.js relatively (assumes launcher is inside repo_temp/launcher)
  const serverJsPath = path.join(__dirname, '..', 'server.js');
  if (!fs.existsSync(serverJsPath)) {
      return { success: false, message: `Could not find server.js at ${serverJsPath}` };
  }

  serverProcess = spawn('node', [serverJsPath], { cwd: path.join(__dirname, '..') });

  serverProcess.stdout.on('data', (data) => {
      if (mainWindow) mainWindow.webContents.send('server-log', data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
      if (mainWindow) mainWindow.webContents.send('server-error', data.toString());
  });

  serverProcess.on('close', (code) => {
      if (mainWindow) mainWindow.webContents.send('server-stopped', code);
      serverProcess = null;
  });

  return { success: true, message: 'Server started successfully.' };
});

ipcMain.handle('stop-server', async () => {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
        return true;
    }
    return false;
});
