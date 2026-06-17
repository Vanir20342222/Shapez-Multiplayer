# Shapez.io Multiplayer Mod

A real-time cooperative multiplayer framework for shapez.io.

> **Note:** This mod is currently in Alpha. While core synchronization logic is robust, edge cases may occasionally trigger desyncs. Use at your own risk.

> **Disclaimer:** This mod was completely *vibecoded* by AI! Expect bugs, weird sync issues, and funny behavior.

Share a single factory map with friends, build cooperative infrastructure, and deliver shapes to a shared hub. This project is powered by a custom client-side mod and a lightweight, standalone WebSocket relay server.

## Features
* **Co-op Factory Building:** Place and delete belts, miners, and buildings together in real time.
* **Hub Synchronization:** Shape deliveries and hub upgrade goals sync perfectly between all connected clients.
* **Live Player Presence:** View colored cursors indicating exactly where other players are actively working.
* **In-Game Chat Overlay:** Press `J` to open the Player Panel and communicate with your room.
* **Room Security:** Create private, password-protected rooms and limit maximum player capacity.
* **Spectator Mode:** Join games as a read-only spectator to observe factory growth.
* **Auto-Healing State:** Advanced packet sequencing and deep synchronization logic handles network lag gracefully, recovering instantly from dropped packets.

---

## 1. Installation & Server Hosting

The multiplayer ecosystem is entirely managed through the **Shapez Multiplayer Launcher**. This standalone application automatically installs the mod into your local game directory and functions as the host server.

### Setup Instructions
1. Navigate to the **[Releases](../../releases)** page of this repository.
2. Download the appropriate executable for your Operating System (`.exe` for Windows, `.AppImage` for Linux).
3. Run the Launcher application.
4. Click **Install / Update Mod**. The launcher will automatically locate your shapez.io installation and inject the latest mod code.
5. If you intend to host the session, click **Start Server** directly within the Launcher.

> **Caution Regarding Mod Conflicts:** All players joining a session **must** have identical mods installed. If the host is running additional mods (e.g., `usage_statistics.js`) and guests are not, the game will critically desync when attempting to build the factory state. 

---

## 2. Networking (Port Forwarding)

If you are playing on a local network (LAN), players can connect using your local IPv4 address (e.g., `192.168.1.50`). To play over the internet, the host must expose the server port.

### Method A: Port Forwarding (Recommended)
1. Access your home router's administration panel.
2. Locate the **Port Forwarding** configuration.
3. Create a rule forwarding **TCP port 3005** to the local IPv4 address of the host machine.
4. Provide your Public IP Address to your guests.

### Method B: Virtual Private Networks / Tunnels
If router configuration is unavailable, utilize a tunneling service:
* **Ngrok:** Execute `ngrok tcp 3005` to generate a public TCP tunnel URL. Guests will input the provided URL and dynamic port.
* **Hamachi / Radmin VPN:** The host and guests join the same virtual network, allowing guests to connect via the host's VPN-assigned IP address.

---

## 3. How to Play

### Hosting a Session
1. Start the server via the Multiplayer Launcher.
2. Launch shapez.io.
3. Press "Host MP" under the save file that you wish to host.
4. Enter your connection details. If the Launcher is running on your machine, use `localhost` and port `3005`. If not enter the servers's Public IP, VPN IP, or Tunnel URL.
5. Configure a password and player limit if desired, then click **Host Game**.
6. Distribute the generated 6-character Room Code to your guests.

### Joining a Session
1. Launch shapez.io and select **Multiplayer** from the Main Menu.
2. Enter the host's Public IP, VPN IP, or Tunnel URL.
3. Enter port `3005` (or the specific port provided by your tunnel service).
4. Input the Room Code and click **Join**.

---

### Shortcuts
* **`J`** - Toggle Player Panel. Hosts can utilize this panel to kick disruptive players or transfer host privileges.
