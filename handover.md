# Shapez.io Multiplayer Mod - Project Handover

## Overview
This project is a real-time cooperative multiplayer mod for the game Shapez.io. It consists of two main components:
1. **The Game Mod (`shapez-multiplayer.js`)**: Injected directly into the Shapez.io web client via the game's official Mod API.
2. **The Standalone Launcher (`launcher/`)**: An Electron application that acts as the entry point. It hosts the local WebSockets relay server for multiplayer connections and provides a UI to join/host rooms, display public IPs, and manage the mod installation.

## Core Architecture & State Synchronization
- **Host Authority**: The player who hosts the room has the authoritative game state. The host sends a full state dump (`state_sync`) to joining guests, and then sends compressed diff-based updates (`state_sync_delta`) every 500ms.
- **WebSocket Relay**: The Launcher runs a `WebSocketServer` (ws) on port `3005`. It routes messages between the host and guests. Custom message routing ensures cursor tracking and chat messages are broadcast globally to all connected clients.
- **Action Queue**: Guests cannot modify the world state directly. When a guest performs an action (e.g., placing a building, adding a waypoint), the action is intercepted, canceled locally, and sent to the Host via the WebSocket as a remote action. The Host executes it, and the result is synced back to everyone in the next 500ms `state_sync_delta`.

## Key Features Implemented
1. **Saved Servers UI**: The mod intercepts the shapez.io main menu to add a "Saved Servers" list. It uses `localStorage` to save the IP, Port, and Room Code of successful connections, allowing 1-click joining.
2. **Off-Screen Player Tracking**: The game tracks everyone's cursors. If a player moves off your screen, a dynamic, color-coded arrow pointing to their exact location appears on the edge of your screen, complete with their initial.
3. **Waypoints & Pinned Shapes Sync**: In-game waypoints and pinned shapes are fully synchronized. We recently fixed a bug where guest waypoints were silently failing on the Host by passing a `shapez.Vector` instead of a plain object.
4. **Chat System**: A custom HTML/CSS chat overlay injected into the bottom left of the game UI.
5. **Auto-Updater**: The Launcher bypasses GitHub caching to instantly download the latest `shapez-multiplayer.js` directly from the repository when the user clicks "Update Mod".

## Recent Bug Fixes (v1.4.3)
- Fixed the WebSocket server in the Launcher so it correctly broadcasts `cursor` messages to *all* clients, not just the host.
- Fixed a `reading 'ws'` console crash by adding `var self = this;` to `onGameStarted`.
- Fixed high-DPI scaling issues with the off-screen tracking arrows by using `window.innerWidth/innerHeight` instead of the physical canvas dimensions.
- Repaired guest-created waypoints by passing strict `shapez.Vector` objects.

## Important Files
- `/launcher/main.js`: The Electron backend. Contains the WebSocket relay server logic.
- `/launcher/index.html`: The UI for the standalone launcher.
- `/shapez-multiplayer.js`: The core mod file containing all game hooks, network serialization, and UI overlays.
- `/server.js`: *Deprecated/Legacy* - The relay server logic was ported into `launcher/main.js` so users don't have to run a separate Node server.

## Next Steps for the New Agent
1. Read `shapez-multiplayer.js` to understand how `setupHooks` intercepts building placement, wire modifications, and UI elements.
2. If modifying network behavior, remember that the relay server logic is inside `launcher/main.js`. If you change it, the user MUST rebuild the launcher using `npm run build:linux` (or their OS equivalent).
3. Mod updates should bump the `METADATA.version` in `shapez-multiplayer.js` so the Launcher's auto-update button correctly fetches it.
