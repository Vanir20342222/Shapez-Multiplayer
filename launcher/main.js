const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require("ws");

let mainWindow;
let wss = null;

// =====================
// SERVER STATE
// =====================
const rooms = new Map();
const socketInfo = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomColor() {
  const letters = '89ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * letters.length)];
  }
  return color;
}

function broadcastPlayerList(room) {
  const hostInfo = socketInfo.get(room.host);
  const players = [];
  if (hostInfo) players.push({ id: hostInfo.id, isHost: true, color: hostInfo.color, isSpectator: false });
  room.clients.forEach(c => {
    const info = socketInfo.get(c);
    if (info) players.push({ id: info.id, isHost: false, color: info.color, isSpectator: info.isSpectator });
  });
  const msg = JSON.stringify({ type: "player_list", payload: { players } });
  if (room.host.readyState === WebSocket.OPEN) room.host.send(msg);
  room.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function logToUI(msg, isError = false) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(isError ? 'server-error' : 'server-log', msg);
  }
}

// =====================
// ELECTRON SETUP
// =====================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (wss) {
      wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.close();
      });
      wss.close();
      wss = null;
      rooms.clear();
      socketInfo.clear();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// =====================
// MOD UPDATER IPC
// =====================
ipcMain.handle('check-mod-status', async () => {
  try {
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
  } catch (err) {
    console.error("Error checking mod status:", err);
    return { installed: false, version: 'Error' };
  }
});

ipcMain.handle('install-mod', async () => {
  const modsPath = getModsPath();
  const modFilePath = path.join(modsPath, 'shapez-multiplayer.js');
  const tmpFilePath = modFilePath + '.tmp';
  const timestamp = Date.now();
  const repoUrl = `https://raw.githubusercontent.com/Vanir20342222/Shapez-Multiplayer/main/shapez-multiplayer.js?t=${timestamp}`;

  return new Promise((resolve, reject) => {
    https.get(repoUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Failed to download: ${res.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(tmpFilePath);
      const hash = crypto.createHash('sha256');
      
      res.on('data', chunk => hash.update(chunk));
      res.pipe(fileStream);
      
      fileStream.on('close', () => {
        try {
          const fileHash = hash.digest('hex');
          const stats = fs.statSync(tmpFilePath);
          // Simple size validation to act as a security/integrity check if no hash is available
          if (stats.size < 100) {
            if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
            return reject(new Error("File too small, possibly corrupted or invalid"));
          }
          fs.renameSync(tmpFilePath, modFilePath);
          resolve(true);
        } catch (e) {
          reject(e);
        }
      });
      
      fileStream.on('error', (err) => {
        if (fs.existsSync(tmpFilePath)) fs.unlink(tmpFilePath, () => reject(err));
        else reject(err);
      });
    }).on('error', reject);
  });
});

function getModsPath() {
  if (process.platform === 'win32') {
    var appData = app.getPath('appData');
    return path.join(appData, 'shapez.io', 'mods');
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'shapez.io', 'mods');
  } else {
    return path.join(os.homedir(), '.local', 'share', 'shapez.io', 'mods');
  }
}

ipcMain.handle('get-public-ip', async () => {
  return new Promise((resolve, reject) => {
    https.get('https://api.ipify.org?format=json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.ip);
        } catch(e) {
          resolve('Unknown');
        }
      });
    }).on('error', () => {
      resolve('Unknown');
    });
  });
});

// =====================
// SERVER IPC
// =====================
ipcMain.handle('start-server', async () => {
  if (wss) {
      return { success: false, message: 'Server is already running.' };
  }

  try {
    const port = 3005;
    wss = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 5 * 1024 * 1024 });

    wss.on('listening', () => {
      logToUI(`Relay server listening on ws://0.0.0.0:${port}`);
    });

    wss.on('error', (error) => {
      logToUI(`Server error: ${error.message}`, true);
      if (wss) {
          wss.close();
          wss = null;
          if (mainWindow) mainWindow.webContents.send('server-stopped', 1);
      }
    });

    wss.on("connection", (ws) => {
      ws._lastMessageTime = [];
      ws.on("message", (data) => {
        try {
          const now = Date.now();
          ws._lastMessageTime.push(now);
          if (ws._lastMessageTime.length > 50) {
              const first = ws._lastMessageTime.shift();
              if (now - first < 1000) {
                  logToUI(`Rate limit exceeded for a client. Disconnecting.`);
                  ws.close();
                  return;
              }
          }
          const message = JSON.parse(data);
          handleMessage(ws, message);
        } catch (e) {
          logToUI(`Error parsing message: ${e.message}`, true);
        }
      });

      ws.on("close", () => {
        const info = socketInfo.get(ws);
        if (!info) return;

        const room = rooms.get(info.room);
        if (!room) return;

        if (info.isHost) {
          const closeMsg = JSON.stringify({ type: "player_left", payload: { id: info.id, wasHost: true } });
          room.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(closeMsg);
          });
          room.clients.forEach(client => {
            socketInfo.delete(client);
            if (client.readyState === WebSocket.OPEN) client.close();
          });
          rooms.delete(info.room);
          logToUI(`Room ${info.room} closed because host ${info.id} disconnected.`);
        } else {
          room.clients.delete(ws);
          const leaveMsg = JSON.stringify({ type: "player_left", payload: { id: info.id } });
          if (room.host.readyState === WebSocket.OPEN) room.host.send(leaveMsg);
          room.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(leaveMsg);
          });
          logToUI(`Player ${info.id} left room ${info.room}.`);
          broadcastPlayerList(room);
        }
        socketInfo.delete(ws);
      });
    });

    return { success: true, message: 'Server started successfully.' };
  } catch (err) {
    return { success: false, message: `Failed to start server: ${err.message}` };
  }
});

ipcMain.handle('stop-server', async () => {
    if (wss) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.close();
        });
        wss.close();
        wss = null;
        rooms.clear();
        socketInfo.clear();
        logToUI('Server stopped gracefully.');
        if (mainWindow) mainWindow.webContents.send('server-stopped', 0);
        return true;
    }
    return false;
});

// =====================
// MESSAGE HANDLING
// =====================
function handleMessage(ws, message) {
  // H12: Override 'from' field with server-assigned ID to prevent spoofing
  var senderInfo = socketInfo.get(ws);
  if (senderInfo) message.from = senderInfo.id;

  const { type, payload, from } = message;

  switch (type) {
    case "ping": {
      ws.send(JSON.stringify({ type: "pong", payload: payload }));
      break;
    }

    case "room_create": {
      // H5: Prevent duplicate room/join
      if (socketInfo.has(ws)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Already in a room' }));
        return;
      }
      // H6: Avoid room code collision
      var code = generateRoomCode();
      while (rooms.has(code)) { code = generateRoomCode(); }
      const id = from || "Host";
      const password = payload.password || "";
      // H7: parseInt with radix + NaN/bounds validation
      var maxPlayers = parseInt(payload.maxPlayers, 10);
      if (isNaN(maxPlayers) || maxPlayers < 2) maxPlayers = 10;
      if (maxPlayers > 100) maxPlayers = 100;
      
      rooms.set(code, { code, host: ws, clients: new Set(), password, maxPlayers });
      socketInfo.set(ws, { room: code, id, isHost: true, color: "#b39ddb", isSpectator: false });
      ws.send(JSON.stringify({ type: "room_created", payload: { code, id } }));
      logToUI(`Room created: ${code} by ${id} (Max: ${maxPlayers}${password ? ', Password protected' : ''})`);
      break;
    }

    case "room_join": {
      // H5: Prevent duplicate room/join
      if (socketInfo.has(ws)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Already in a room' }));
        return;
      }
      const { code, password, isSpectator } = payload;
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "Room not found" } }));
        return;
      }
      
      if (room.password && room.password !== password) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "Incorrect password" } }));
        return;
      }
      
      if (room.clients.size + 1 >= room.maxPlayers) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "Room is full" } }));
        return;
      }

      // M4: Null reference check for host info
      const hostInfo = socketInfo.get(room.host);
      if (!hostInfo) {
        ws.send(JSON.stringify({ type: 'error', message: 'Host info unavailable' }));
        return;
      }

      let id = from || "Player_" + Math.floor(Math.random() * 1000);
      
      // Enforce ID uniqueness
      let isUnique = false;
      while (!isUnique) {
        isUnique = true;
        if (hostInfo.id === id) {
          isUnique = false;
        } else {
          for (const c of room.clients) {
            const cInfo = socketInfo.get(c);
            if (cInfo && cInfo.id === id) {
              isUnique = false;
              break;
            }
          }
        }
        if (!isUnique) id += "_1";
      }

      const color = getRandomColor();
      
      room.clients.add(ws);
      socketInfo.set(ws, { room: code, id, isHost: false, color, isSpectator: !!isSpectator });

      const joinMsg = JSON.stringify({ type: "player_joined", payload: { id, code, color, isSpectator: !!isSpectator } });
      // C6: readyState guard before host.send
      if (room.host.readyState === WebSocket.OPEN) {
        room.host.send(joinMsg);
      }
      room.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) client.send(joinMsg);
      });

      ws.send(JSON.stringify({
        type: "room_joined",
        payload: {
          code,
          id,
          players: [hostInfo.id, ...Array.from(room.clients).map(c => socketInfo.get(c).id)],
        },
      }));
      broadcastPlayerList(room);
      logToUI(`${isSpectator ? '[SPECTATOR] ' : ''}Player ${id} joined room ${code}`);
      break;
    }

    case "snapshot": {
      const info = socketInfo.get(ws);
      if (!info || !info.isHost) return;
      const room = rooms.get(info.room);
      if (!room) return;
      
      const targetId = payload.targetId;
      if (targetId) {
        room.clients.forEach(c => {
          const ci = socketInfo.get(c);
          if (ci && ci.id === targetId && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(message));
          }
        });
      } else {
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(message));
        });
      }
      break;
    }

    case "kick_player": {
      const info = socketInfo.get(ws);
      if (!info || !info.isHost) return;
      const room = rooms.get(info.room);
      if (!room) return;

      const targetId = payload.targetId;
      let targetWs = null;
      room.clients.forEach(c => {
        const ci = socketInfo.get(c);
        if (ci && ci.id === targetId) targetWs = c;
      });

      if (targetWs) {
        targetWs.send(JSON.stringify({ type: "kicked", payload: { reason: payload.reason || "Kicked by host" } }));
        room.clients.delete(targetWs);
        socketInfo.delete(targetWs);
        targetWs.close();

        const leaveMsg = JSON.stringify({ type: "player_left", payload: { id: targetId } });
        if (room.host.readyState === WebSocket.OPEN) room.host.send(leaveMsg);
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(leaveMsg);
        });
        broadcastPlayerList(room);
        logToUI(`Host kicked player ${targetId} from room ${info.room}`);
      }
      break;
    }

    case "transfer_host": {
      const info = socketInfo.get(ws);
      if (!info || !info.isHost) return;
      const room = rooms.get(info.room);
      if (!room) return;

      const targetId = payload.targetId;
      let targetWs = null;
      room.clients.forEach(c => {
        const ci = socketInfo.get(c);
        if (ci && ci.id === targetId) targetWs = c;
      });

      if (targetWs) {
        room.clients.delete(targetWs);
        room.clients.add(ws);

        info.isHost = false;
        info.color = getRandomColor();
        const targetInfo = socketInfo.get(targetWs);
        targetInfo.isHost = true;
        targetInfo.color = "#b39ddb";
        room.host = targetWs;

        const transferMsg = JSON.stringify({ type: "host_transferred", payload: { newHostId: targetId, oldHostId: info.id } });
        if (room.host.readyState === WebSocket.OPEN) room.host.send(transferMsg);
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(transferMsg);
        });
        broadcastPlayerList(room);
        logToUI(`Host transferred from ${info.id} to ${targetId} in room ${info.room}`);
      }
      break;
    }

    case "request_player_list": {
      const info = socketInfo.get(ws);
      if (!info) return;
      const room = rooms.get(info.room);
      if (!room) return;
      broadcastPlayerList(room);
      break;
    }

    case "chat_message": {
      const info = socketInfo.get(ws);
      if (!info) return;
      const room = rooms.get(info.room);
      if (!room) return;
      
      const chatMsg = JSON.stringify(message);
      if (room.host !== ws && room.host.readyState === WebSocket.OPEN) room.host.send(chatMsg);
      room.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(chatMsg);
        }
      });
      break;
    }

    case "cursor": {
      const info = socketInfo.get(ws);
      if (!info) return;
      const room = rooms.get(info.room);
      if (!room) return;
      
      const cursorMsg = JSON.stringify(message);
      if (room.host.readyState === WebSocket.OPEN && room.host !== ws) room.host.send(cursorMsg);
      room.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c !== ws) c.send(cursorMsg);
      });
      break;
    }

    case "cursor_update":
    case "blueprint_chunk":
    case "blueprint":
    case "action_batch":
    case "state_update":
    case "goal_update":
    case "recipe_update": {
      const info = socketInfo.get(ws);
      if (!info) return;
      const room = rooms.get(info.room);
      if (!room) return;

      if (info.isHost) {
        room.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
        });
      } else {
        if (room.host.readyState === WebSocket.OPEN) room.host.send(JSON.stringify(message));
      }
      break;
    }

    default: {
      // H8: Relay unknown message types instead of silently dropping
      const info = socketInfo.get(ws);
      if (!info) return;
      const room = rooms.get(info.room);
      if (!room) return;
      const serialized = JSON.stringify(message);
      if (info.isHost) {
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(serialized);
        });
      } else {
        if (room.host.readyState === WebSocket.OPEN) room.host.send(serialized);
      }
      break;
    }
  }
}
