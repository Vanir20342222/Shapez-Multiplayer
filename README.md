<div align="center">
  <h1>⚙️ Shapez Multiplayer Mod ⚙️</h1>
  <p><b>Real-time cooperative multiplayer for shapez.io!</b></p>
</div>

> [!WARNING]
> **Disclaimer:** This mod was completely *vibecoded* by AI! It is currently in **Alpha**, so expect bugs, weird sync issues, and funny behavior. Use at your own risk!

Share a single factory map with friends, place buildings together, and deliver shapes to a shared hub. This project includes a single-file game mod and a lightweight Node.js WebSocket relay server.

## ✨ Features
* **Co-op Factory Building**: Place and delete belts, miners, and buildings together in real time.
* **Hub Syncing**: Shape deliveries and upgrades sync perfectly between all players.
* **Player Presence**: See live colored cursors mapping exactly where your friends are working.
* **In-Game Chat**: Press `J` to open the Player Panel and chat with your room.
* **Room Security**: Create private password-protected rooms and limit player capacity.
* **Spectator Mode**: Join games as a read-only spectator just to watch the factory grow.
* **Auto-Healing**: Deep synchronization logic handles lag gracefully and heals desyncs instantly.

---

## 🚀 1. Installing the Mod

To play multiplayer, you must install the mod file into your shapez.io game.

1. Download the `shapez-multiplayer.js` file from this repository.
2. Open your shapez.io game and navigate to **Settings** -> **Mods**.
3. Click **Open Mods Folder**.
4. Drag and drop the `shapez-multiplayer.js` file into the folder.
5. Restart shapez.io. You should now see "Multiplayer" options in the main menu!

---

## 🖥️ 2. Setting up the Server

Because shapez.io runs in a browser/Electron wrapper, a central relay server is required to bounce messages between players. **Only one person needs to run the server.**

1. Download and install [Node.js](https://nodejs.org/).
2. Download `server.js`, `package.json`, and `package-lock.json` from this repository into an empty folder.
3. Open a terminal/command prompt in that folder.
4. Run `npm install` to install the required `ws` dependency.
5. Run `node server.js`.
6. You should see: `Relay server listening on ws://0.0.0.0:3005`. Leave this terminal open!

---

## 🌍 3. Playing with Friends (Port Forwarding)

If you are just playing on the same computer or local Wi-Fi, you can use `localhost` or your local IP address (e.g., `192.168.1.50`). However, to play with friends over the internet, the person running the server must **Port Forward** port `3005`.

### Method A: Port Forwarding (Recommended)
1. Log into your home router's admin panel (usually `192.168.1.1` or `10.0.0.1`).
2. Find the **Port Forwarding** section.
3. Add a new rule forwarding **TCP port 3005** to the local IPv4 address of the computer running the Node.js server.
4. Find your Public IP Address by googling "What is my IP".
5. Give your Public IP Address to your friends. They will use this to connect to your server.

### Method B: Tunnels (No Router Access needed)
If you cannot port forward, you can use a tunneling service:
* **Ngrok**: Run `ngrok tcp 3005`. It will give you a public URL (e.g., `tcp://0.tcp.ngrok.io:12345`). Your friends will type `0.tcp.ngrok.io` as the IP and `12345` as the port.
* **Hamachi/Radmin VPN**: Both you and your friends install the VPN program, join the same network, and your friends will connect to your VPN-provided IP address.

---

## 🎮 4. How to Play

### Hosting a Game
1. Launch the game and load into a save file.
2. Press `Esc` and click **Host Multiplayer**.
3. Enter the IP of the server. (If you are running the Node.js server on the same computer you are playing on, type `localhost`).
4. Enter `3005` as the port.
5. Provide a password and max player limit (optional).
6. Click **Host Game**. You will be given a random 6-character Room Code.

### Joining a Game
1. On the Main Menu, click **Multiplayer**.
2. Enter the Server IP (Your friend's Public IP, Ngrok URL, or Hamachi IP).
3. Enter `3005` as the port (or the custom Ngrok port).
4. Type in the **Room Code** your friend gave you.
5. Click **Join**. You will seamlessly load into their factory!

---

### Shortcuts
* Press `J` while in-game to open the Player Panel. Here you can chat, view connected players, and (if you are the host) kick players or transfer host privileges.