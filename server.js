const { WebSocketServer, WebSocket } = require("ws");

const port = process.env.PORT || 3005;
const wss = new WebSocketServer({ port, host: '0.0.0.0' });

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {WebSocket} host
 * @property {Set<WebSocket>} clients
 * @property {string} password
 * @property {number} maxPlayers
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<WebSocket, { room: string, id: string, isHost: boolean, color: string, isSpectator: boolean }>} */
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

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (e) {
      console.error("Error parsing message:", e);
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
      rooms.delete(info.room);
    } else {
      room.clients.delete(ws);
      const leaveMsg = JSON.stringify({ type: "player_left", payload: { id: info.id } });
      if (room.host.readyState === WebSocket.OPEN) room.host.send(leaveMsg);
      room.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) client.send(leaveMsg);
      });
      broadcastPlayerList(room);
    }
    socketInfo.delete(ws);
  });
});

function handleMessage(ws, message) {
  const { type, payload, from } = message;

  switch (type) {
    case "ping": {
      ws.send(JSON.stringify({ type: "pong", payload: payload }));
      break;
    }

    case "room_create": {
      const code = generateRoomCode();
      const id = from || "Host";
      const password = payload.password || "";
      const maxPlayers = payload.maxPlayers ? parseInt(payload.maxPlayers) : 10;
      
      rooms.set(code, { code, host: ws, clients: new Set(), password, maxPlayers });
      socketInfo.set(ws, { room: code, id, isHost: true, color: "#b39ddb", isSpectator: false });
      ws.send(JSON.stringify({ type: "room_created", payload: { code, id } }));
      break;
    }

    case "room_join": {
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

      const id = from || "Player_" + Math.floor(Math.random() * 1000);
      const color = getRandomColor();
      
      room.clients.add(ws);
      socketInfo.set(ws, { room: code, id, isHost: false, color, isSpectator: !!isSpectator });

      const joinMsg = JSON.stringify({ type: "player_joined", payload: { id, code, color, isSpectator: !!isSpectator } });
      room.host.send(joinMsg);
      room.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) client.send(joinMsg);
      });

      ws.send(JSON.stringify({
        type: "room_joined",
        payload: {
          code,
          id,
          players: [socketInfo.get(room.host).id, ...Array.from(room.clients).map(c => socketInfo.get(c).id)],
        },
      }));
      broadcastPlayerList(room);
      break;
    }

    case "snapshot": {
      const info = socketInfo.get(ws);
      if (!info || !info.isHost) return;
      const room = rooms.get(info.room);
      if (!room) return;
      
      const targetId = payload.targetId;
      if (targetId) {
        // Targeted snapshot to a specific client
        room.clients.forEach(c => {
          const ci = socketInfo.get(c);
          if (ci && ci.id === targetId && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(message));
          }
        });
      } else {
        // Broadcast to all clients (fallback)
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
        info.color = getRandomColor(); // Host loses purple
        const targetInfo = socketInfo.get(targetWs);
        targetInfo.isHost = true;
        targetInfo.color = "#b39ddb"; // New host gets purple
        room.host = targetWs;

        const transferMsg = JSON.stringify({ type: "host_transferred", payload: { newHostId: targetId, oldHostId: info.id } });
        if (room.host.readyState === WebSocket.OPEN) room.host.send(transferMsg);
        room.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(transferMsg);
        });
        broadcastPlayerList(room);
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
      if (room.host.readyState === WebSocket.OPEN && room.host !== ws) room.host.send(chatMsg);
      room.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c !== ws) c.send(chatMsg);
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

    default: {
      const info = socketInfo.get(ws);
      if (!info) return;
      const room = rooms.get(info.room);
      if (!room) return;

      const relayMsg = JSON.stringify(message);
      if (info.isHost) {
        room.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(relayMsg); });
      } else {
        if (room.host.readyState === WebSocket.OPEN) room.host.send(relayMsg);
      }
      break;
    }
  }
}

console.log("Relay server listening on ws://0.0.0.0:" + port);
