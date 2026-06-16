const METADATA = {
  id: "multiplayer",
  name: "Shapez.io Multiplayer",
  version: "1.1.0",
  description: "Real-time cooperative multiplayer for shapez.io",
  author: "AI",
  website: "",
  minimumGameVersion: ">=1.5.0",
  doesNotAffectSavegame: false
};

function calculateDelta(oldObj, newObj) {
  if (oldObj === newObj) return undefined;
  if (typeof oldObj !== 'object' || oldObj === null || typeof newObj !== 'object' || newObj === null) return newObj;
  var diff = {};
  var hasChanges = false;
  for (var key in newObj) {
    if (!oldObj.hasOwnProperty(key)) {
      diff[key] = newObj[key];
      hasChanges = true;
    } else {
      var res = calculateDelta(oldObj[key], newObj[key]);
      if (res !== undefined) {
        diff[key] = res;
        hasChanges = true;
      }
    }
  }
  return hasChanges ? diff : undefined;
}

function applyDelta(target, delta) {
  if (typeof delta !== 'object' || delta === null) return delta;
  for (var key in delta) {
    if (typeof delta[key] === 'object' && delta[key] !== null && target.hasOwnProperty(key) && typeof target[key] === 'object') {
      target[key] = applyDelta(target[key], delta[key]);
    } else {
      target[key] = delta[key];
    }
  }
  return target;
}

class Mod extends shapez.Mod {
  init() {
    console.log("Multiplayer Mod: Initializing...");
    try {
      this.network = this.setupNetwork();
      this.ui = this.setupUI();
      this.sync = this.setupSync();
      this.actions = this.setupActions();
      this.cursorOverlay = null;
      this.playerList = [];
      this.playerPanelVisible = false;

      this.registerHooks();
      console.log("Multiplayer Mod: Registration hooks complete");
    } catch (e) {
      console.error("Multiplayer Mod: Error during init:", e);
    }
  }

  registerHooks() {
    const self = this;

    // 1. Inject Multiplayer Button in Main Menu
    this.modInterface.extendClass(shapez.MainMenuState, ({ $super, $old }) => ({
      renderMainMenu() {
        $old.renderMainMenu.apply(this, arguments);
        const mainContainer = this.htmlElement.querySelector(".mainContainer");
        if (mainContainer && !mainContainer.querySelector(".mp-btn")) {
          const btn = document.createElement("button");
          btn.innerText = "Multiplayer";
          btn.className = "styledButton mp-btn";
          btn.style.cssText = "display:block; width:100%; max-width:100%; box-sizing:border-box; padding:15px 10px; margin-top:10px; background:#4a148c; color:white; font-weight:bold; font-size:18px; letter-spacing:0.1em; text-transform:uppercase; border:none; border-radius:4px; cursor:pointer; pointer-events:all;";
          btn.onclick = () => self.ui.showLobby();
          const buttons = mainContainer.querySelector(".buttons");
          if (buttons) {
            buttons.parentNode.insertBefore(btn, buttons.nextSibling);
          } else {
            mainContainer.appendChild(btn);
          }
        }
      },
      onLeave() {
        $old.onLeave.apply(this, arguments);
        const btn = document.querySelector(".mp-btn");
        if (btn) btn.remove();
      },
      renderSavegames() {
        $old.renderSavegames.apply(this, arguments);
        setTimeout(() => {
          const savegameElements = this.htmlElement.querySelectorAll('.savegame');
          const games = this.savedGames;
          if (savegameElements.length === games.length) {
            savegameElements.forEach((elem, index) => {
              if (elem.querySelector('.mp-host-btn')) return;
              const game = games[index];
              const hostBtn = document.createElement("button");
              hostBtn.classList.add("styledButton", "mp-host-btn");
              hostBtn.innerHTML = "Host MP";
              hostBtn.style.backgroundColor = "#4a148c";
              hostBtn.style.color = "white";
              hostBtn.style.marginRight = "10px";
              
              hostBtn.onclick = () => {
                 self.ui.showLobby(game.internalId);
              };
              
              const firstButton = elem.querySelector('.deleteGame');
              if (firstButton) {
                  elem.insertBefore(hostBtn, firstButton);
              } else {
                  elem.appendChild(hostBtn);
              }
            });
          }
        }, 10);
      }
    }));

    // 2. Register keybinding for player panel (J key)
    this.modInterface.registerIngameKeybinding({
      id: "mp_player_panel",
      keyCode: "J".charCodeAt(0),
      translation: "Toggle Player Panel",
      handler: function (root) {
        self.ui.togglePlayerPanel();
      }
    });

    // 3. Register Multiplayer HUD elements
    this.modInterface.registerHudElement("multiplayerCursor", CursorOverlay);

    // 4. Initialize Multiplayer logic when game starts
    this.signals.gameStarted.add((root) => {
      self.onGameStarted(root);
    });
  }

  onGameStarted(root) {
    this.root = root;
    this.actions.setupHooks(root);

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    if (this.network.isHost) {
      this.ui.showRoomStatus(this.network.roomCode, true);
      this.syncInterval = setInterval(function() {
        if (!self.root || !self.root.entityMgr) return;
        var fullState = {
            hub: self.root.hubGoals.serialize(),
            map_hash: self.actions.totalEntitiesPlaced || 0,
            waypoints: self.root.hud.parts.waypoints.serialize(),
            pinnedShapes: self.root.hud.parts.pinnedShapes.serialize()
        };
        if (self._lastSyncObj) {
            var delta = calculateDelta(self._lastSyncObj, fullState);
            if (delta !== undefined) {
                self.network.send("state_sync_delta", { delta: delta });
            }
        } else {
            self.network.send("state_sync", fullState);
        }
        self._lastSyncObj = JSON.parse(JSON.stringify(fullState));
      }, 500);
    } else if (this.network.roomCode) {
      this.ui.showRoomStatus(this.network.roomCode, false);
    }

    // Ping interval
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(function() {
      if (self.network.ws && self.network.ws.readyState === 1) {
        self.network.send("ping", { time: Date.now() });
      }
    }, 2000);

    // Request player list from server
    if (this.network.ws && this.network.ws.readyState === 1) {
      this.network.send("request_player_list", {});
    }
  }

  setupNetwork() {
    var self = this;
    return {
      ws: null,
      roomCode: null,
      playerId: null,
      isHost: false,
      players: new Set(),
      pendingHostSavegameId: null,
      serverUrl: null,
      actionQueue: [],
      actionInterval: null,

      connect: function(serverUrl) {
        var net = this;
        net.serverUrl = serverUrl;
        return new Promise(function(resolve, reject) {
          net.ws = new WebSocket(serverUrl);
          net.ws.onopen = function() {
              if (net.actionInterval) clearInterval(net.actionInterval);
              net.actionInterval = setInterval(function() {
                  if (net.actionQueue.length > 0) {
                      net.send("action_batch", { actions: net.actionQueue });
                      net.actionQueue = [];
                  }
              }, 50);
              resolve();
          };
          net.ws.onerror = reject;
          net.ws.onmessage = function(e) { net.handleMessage(JSON.parse(e.data)); };
          net.ws.onclose = function() {
            if (net.actionInterval) clearInterval(net.actionInterval);
            console.warn("Disconnected from server");
            var overlay = document.getElementById("mp-status");
            if (overlay) overlay.remove();
            self.ui.removePlayerPanel();

            if (net.roomCode && !net.isHost) {
              var reconEl = document.createElement("div");
              reconEl.id = "mp-reconnect";
              reconEl.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:rgba(180,0,0,0.8);color:white;padding:5px 15px;font-family:monospace;z-index:9999;border-radius:4px;font-weight:bold;pointer-events:none;";
              reconEl.textContent = "Connection lost. Reconnecting...";
              document.body.appendChild(reconEl);

              var attemptReconnect = function() {
                net.connect(net.serverUrl).then(function() {
                  var rEl = document.getElementById("mp-reconnect");
                  if (rEl) rEl.remove();
                  net.send("room_join", { code: net.roomCode });
                }).catch(function() {
                  setTimeout(attemptReconnect, 3000);
                });
              };
              setTimeout(attemptReconnect, 3000);
            }
          };
        });
      },

      send: function(type, payload) {
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: type, payload: payload, from: this.playerId }));
        }
      },

      handleMessage: function(msg) {
        var type = msg.type;
        var payload = msg.payload;
        var from = msg.from;

        switch (type) {
          case "room_created":
            this.roomCode = payload.code;
            this.playerId = payload.id;
            this.isHost = true;
            var hostSave;
            if (this.pendingHostSavegameId) {
                hostSave = shapez.GLOBAL_APP.savegameMgr.getSavegameById(this.pendingHostSavegameId);
            } else {
                hostSave = shapez.GLOBAL_APP.savegameMgr.createNewSavegame();
            }
            hostSave.readAsync().then(function() {
                shapez.GLOBAL_APP.stateMgr.moveToState("InGameState", { savegame: hostSave });
            });
            break;

          case "room_joined":
            this.roomCode = payload.code;
            this.playerId = payload.id;
            this.players = new Set(payload.players);
            break;

          case "player_joined":
            this.players.add(payload.id);
            if (this.isHost && self.root) {
              var snap = self.sync.createSnapshot(self.root);
              this.send("snapshot", { targetId: payload.id, dump: snap });
            }
            break;

          case "snapshot":
            var metaData = {
                lastUpdate: Date.now(),
                version: shapez.Savegame.getCurrentVersion(),
                internalId: "mp_guest_temp",
                name: "Multiplayer Guest"
            };
            var joinSave = new shapez.Savegame(shapez.GLOBAL_APP, {
                internalId: "mp_guest_temp",
                metaDataRef: metaData,
            });
            joinSave.isSaveable = function() { return false; };
            joinSave.readAsync().then(function() {
                joinSave.currentData.dump = payload.dump;
                if (payload.map_hash !== undefined) {
                    self.actions.totalEntitiesPlaced = payload.map_hash;
                }
                shapez.GLOBAL_APP.stateMgr.moveToState("InGameState", { savegame: joinSave, gameModeId: "regularMode" });
            });
            break;

          case "request_snapshot":
            if (self.network.isHost && self.root) {
              var snap = self.sync.createSnapshot(self.root);
              self.network.send("snapshot", { targetId: from, dump: snap, map_hash: self.actions.totalEntitiesPlaced });
            }
            break;

          case "waypoint_action":
            if (self.network.isHost && self.root) {
                self.actions.isRemote = true;
                try {
                   var wpPart = self.root.hud.parts.waypoints;
                   if (payload.type === "add") {
                       wpPart.addWaypoint(payload.label, {x: payload.x, y: payload.y});
                   } else if (payload.type === "delete" || payload.type === "rename") {
                       var wp = wpPart.waypoints.find(w => w.label === payload.label && w.center.x === payload.x && w.center.y === payload.y);
                       if (wp) {
                           if (payload.type === "delete") wpPart.deleteWaypoint(wp);
                           else if (payload.type === "rename") wpPart.renameWaypoint(wp, payload.newLabel);
                       }
                   }
                } finally {
                   self.actions.isRemote = false;
                }
            }
            break;

          case "pinned_action":
            if (self.network.isHost && self.root) {
                self.actions.isRemote = true;
                try {
                   var psPart = self.root.hud.parts.pinnedShapes;
                   if (payload.type === "pin") {
                       var def = self.root.shapeDefinitionMgr.getShapeFromShortKey(payload.key);
                       if (def) psPart.pinNewShape(def);
                   } else if (payload.type === "unpin") {
                       psPart.unpinShape(payload.key);
                   }
                } finally {
                   self.actions.isRemote = false;
                }
            }
            break;

          case "upgrade_action":
            if (self.network.isHost && self.root) {
                self.actions.isRemote = true;
                self.root.hubGoals.tryUnlockUpgrade(payload.upgradeId);
                self.actions.isRemote = false;
            }
            break;

          case "lever_action":
            if (self.root) {
                var contents = self.root.map.getLayerContentXY(payload.x, payload.y, "regular");
                if (contents && contents.components.Lever) {
                    self.actions.isRemote = true;
                    contents.components.Lever.toggled = payload.toggled;
                    self.actions.isRemote = false;
                    if (self.network.isHost) {
                        self.network.send("lever_action", payload);
                    }
                }
            }
            break;

          case "constant_signal_action":
            if (self.root) {
                var contents = self.root.map.getLayerContentXY(payload.x, payload.y, "wires");
                if (contents && contents.components.ConstantSignal) {
                    self.actions.isRemote = true;
                    var item = null;
                    if (payload.signal) {
                        item = self.root.hud.parts.constantSignalEdit.parseSignalCode(contents, payload.signal);
                    }
                    contents.components.ConstantSignal.signal = item;
                    self.actions.isRemote = false;
                    if (self.network.isHost) {
                        self.network.send("constant_signal_action", payload);
                    }
                }
            }
            break;

          case "state_sync":
            if (!self.network.isHost && self.root) {
              if (payload.map_hash !== undefined && payload.map_hash !== self.actions.totalEntitiesPlaced) {
                  self.network.send("request_snapshot", {});
                  self.actions.totalEntitiesPlaced = payload.map_hash;
              }
              self._lastSyncObj = JSON.parse(JSON.stringify(payload));
              self.sync.applyState(self.root, payload);
            }
            break;

          case "state_sync_delta":
            if (!self.network.isHost && self.root && self._lastSyncObj) {
                applyDelta(self._lastSyncObj, payload.delta);
                if (self._lastSyncObj.map_hash !== undefined && self._lastSyncObj.map_hash !== self.actions.totalEntitiesPlaced) {
                    self.network.send("request_snapshot", {});
                    self.actions.totalEntitiesPlaced = self._lastSyncObj.map_hash;
                }
                self.sync.applyState(self.root, self._lastSyncObj);
            }
            break;

          case "action":
            self.actions.handleRemote(payload, from);
            break;

          case "action_batch":
            if (payload.actions) {
                for (var i = 0; i < payload.actions.length; i++) {
                    self.actions.handleRemote(payload.actions[i], from);
                }
            }
            break;

          case "speed_control":
            if (!self.network.isHost) {
                var speedInput = document.getElementById("speed");
                var pauseImg = document.getElementById("pause-image");
                var pauseBtn = document.getElementById("pause-button");
                
                if (speedInput && speedInput.value !== payload.speed) {
                    speedInput.value = payload.speed;
                    speedInput.dispatchEvent(new Event("input"));
                }
                
                if (pauseImg && pauseBtn) {
                    var isPaused = pauseImg.src.indexOf("play") !== -1;
                    if (isPaused !== payload.paused) {
                        pauseBtn.click();
                    }
                }
            }
            break;

          case "cursor":
            if (self.cursorOverlay) self.cursorOverlay.updateRemote(from, payload);
            break;

          case "chat_message":
            self.ui.appendChatMessage(from, payload.text);
            break;

          case "player_list":
            self.playerList = payload.players || [];
            self.ui.updatePlayerPanel();
            break;

          case "host_transferred":
            if (payload.newHostId === self.network.playerId) {
              self.network.isHost = true;
              // Update status badge
              var statusEl = document.getElementById("mp-status");
              if (statusEl) {
                statusEl.innerHTML = "ROOM: <b>" + self.network.roomCode + "</b> (Host)";
              }
              // Start sync loop
              if (self.syncInterval) clearInterval(self.syncInterval);
              self.syncInterval = setInterval(function() {
                if (!self.root || !self.root.entityMgr) return;
                var stateSync = { hub: self.root.hubGoals.serialize() };
                self.network.send("state_sync", stateSync);
              }, 500);
            } else if (payload.oldHostId === self.network.playerId) {
              self.network.isHost = false;
              if (self.syncInterval) clearInterval(self.syncInterval);
              var statusEl2 = document.getElementById("mp-status");
              if (statusEl2) {
                statusEl2.innerHTML = "ROOM: <b>" + self.network.roomCode + "</b> (Guest)";
              }
            }
            break;

          case "kicked":
            alert(payload.reason || "You have been kicked by the host.");
            shapez.GLOBAL_APP.stateMgr.moveToState("MainMenuState");
            break;

          case "player_left":
            this.players.delete(payload.id);
            if (payload.wasHost) {
              alert("Host disconnected");
              shapez.GLOBAL_APP.stateMgr.moveToState("MainMenuState");
            }
            break;

          case "error":
            alert(payload.message);
            break;

          case "pong":
            var latency = Date.now() - payload.time;
            var pingEl = document.getElementById("mp-ping");
            if (pingEl) pingEl.textContent = latency + "ms";
            break;
        }
      }
    };
  }

  setupUI() {
    var self = this;
    return {
      showLobby: function(hostSavegameId) {
        if (typeof hostSavegameId === "undefined") hostSavegameId = null;
        var isJoining = !hostSavegameId;
        var overlay = document.createElement("div");
        overlay.id = "mp-lobby";
        overlay.style.cssText = "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.65); display:flex; align-items:center; justify-content:center; z-index:999999; pointer-events:all;";
        
        var dialog = document.createElement("div");
        dialog.style.cssText = "background:#3a3f47; border-radius:8px; padding:25px; width:380px; max-width:90vw; box-shadow:0 8px 32px rgba(0,0,0,0.4); color:#eee; font-family:inherit;";
        
        var title = document.createElement("h2");
        title.textContent = isJoining ? "Multiplayer" : "Host Multiplayer";
        title.style.cssText = "margin:0 0 20px 0; color:#b39ddb; text-transform:uppercase; letter-spacing:0.05em; font-size:20px;";
        dialog.appendChild(title);
        
        var fields = [
          { label: "Server IP", id: "mp-ip", value: "localhost" },
          { label: "Port", id: "mp-port", value: "3005" },
          { label: "Your Name", id: "mp-name", value: "Player" },
        ];
        if (isJoining) {
          fields.push({ label: "Room Code", id: "mp-code", value: "", placeholder: "Enter room code" });
          fields.push({ label: "Password (Optional)", id: "mp-pass", value: "", type: "password" });
        } else {
          fields.push({ label: "Room Password (Optional)", id: "mp-pass", value: "", type: "text" });
          fields.push({ label: "Max Players", id: "mp-max", value: "10", type: "number" });
        }
        
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          var wrapper = document.createElement("div");
          wrapper.style.cssText = "margin-bottom:14px;";
          
          var lbl = document.createElement("label");
          lbl.textContent = f.label;
          lbl.style.cssText = "display:block; margin-bottom:5px; color:#aaa; font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em;";
          wrapper.appendChild(lbl);
          
          var inp = document.createElement("input");
          inp.id = f.id;
          inp.type = f.type || "text";
          inp.value = f.value || "";
          inp.placeholder = f.placeholder || f.label;
          inp.style.cssText = "width:100%; box-sizing:border-box; padding:10px 12px; background:#2a2e35; color:#eee; border:1px solid #555; border-radius:4px; font-size:14px; outline:none;";
          wrapper.appendChild(inp);
          dialog.appendChild(wrapper);
        }

        if (isJoining) {
            var specWrap = document.createElement("div");
            specWrap.style.cssText = "margin-bottom:14px; display:flex; align-items:center; gap:8px;";
            var specCheck = document.createElement("input");
            specCheck.type = "checkbox";
            specCheck.id = "mp-spectator";
            var specLbl = document.createElement("label");
            specLbl.textContent = "Join as Spectator";
            specLbl.style.cssText = "color:#aaa; font-size:13px; cursor:pointer;";
            specLbl.onclick = function() { specCheck.checked = !specCheck.checked; };
            specWrap.appendChild(specCheck);
            specWrap.appendChild(specLbl);
            dialog.appendChild(specWrap);
        }
        
        var btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex; gap:10px; margin-top:22px;";
        
        var makeBtn = function(text, bg, id) {
          var b = document.createElement("button");
          b.id = id || "";
          b.textContent = text;
          b.style.cssText = "flex:1; padding:12px; background:" + bg + "; color:white; border:none; border-radius:4px; font-size:14px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; cursor:pointer; pointer-events:all;";
          b.onmouseenter = function() { b.style.opacity = "0.85"; };
          b.onmouseleave = function() { b.style.opacity = "1"; };
          return b;
        };
        
        var cancelBtn = makeBtn("Cancel", "#e53935", "mp-cancel");
        btnRow.appendChild(cancelBtn);
        
        if (isJoining) {
          btnRow.appendChild(makeBtn("Join", "#43a047", "mp-join"));
          btnRow.appendChild(makeBtn("Host", "#4a148c", "mp-host"));
        } else {
          btnRow.appendChild(makeBtn("Host Game", "#4a148c", "mp-host"));
        }
        
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        var closeLobby = function() {
            var el = document.getElementById("mp-lobby");
            if (el) el.remove();
        };

        document.getElementById("mp-cancel").onclick = closeLobby;

        var hostBtnEl = document.getElementById("mp-host");
        if (hostBtnEl) {
            hostBtnEl.onclick = function() {
              var name = document.getElementById("mp-name").value || "Host";
              var ip = document.getElementById("mp-ip").value || "localhost";
              var port = document.getElementById("mp-port").value || "3005";
              var pass = document.getElementById("mp-pass") ? document.getElementById("mp-pass").value : "";
              var max = document.getElementById("mp-max") ? document.getElementById("mp-max").value : "10";
              var serverUrl = "ws://" + ip + ":" + port;
              self.network.connect(serverUrl).then(function() {
                self.network.playerId = name;
                self.network.isSpectator = false;
                self.network.pendingHostSavegameId = hostSavegameId;
                self.network.send("room_create", { password: pass, maxPlayers: max });
                closeLobby();
              }).catch(function(e) {
                alert("Failed to connect to " + serverUrl + "\nMake sure the server is running!");
              });
            };
        }

        var joinBtnEl = document.getElementById("mp-join");
        if (joinBtnEl) {
            joinBtnEl.onclick = function() {
              var name = document.getElementById("mp-name").value || "Guest";
              var code = document.getElementById("mp-code").value.toUpperCase();
              var pass = document.getElementById("mp-pass").value || "";
              var spec = document.getElementById("mp-spectator").checked;
              var ip = document.getElementById("mp-ip").value || "localhost";
              var port = document.getElementById("mp-port").value || "3005";
              var serverUrl = "ws://" + ip + ":" + port;
              if (!code) return;
              self.network.connect(serverUrl).then(function() {
                self.network.playerId = name;
                self.network.isSpectator = spec;
                self.network.send("room_join", { code: code, password: pass, isSpectator: spec });
                closeLobby();
              }).catch(function(e) {
                alert("Failed to connect to " + serverUrl + "\nMake sure the server is running!");
              });
            };
        }
      },

      showRoomStatus: function(code, isHost) {
        var existing = document.getElementById("mp-status");
        if (existing) existing.remove();
        var status = document.createElement("div");
        status.id = "mp-status";
        status.style.cssText = "position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);color:#dfd;padding:5px 10px;font-family:monospace;z-index:9000;border-radius:4px;pointer-events:none;";
        status.innerHTML = "ROOM: <b>" + code + "</b> (" + (isHost ? "Host" : "Guest") + ") <span id='mp-ping' style='color:#aaa;margin-left:8px;font-size:10px;'>...</span>";
        document.body.appendChild(status);
      },

      togglePlayerPanel: function() {
        self.playerPanelVisible = !self.playerPanelVisible;
        if (self.playerPanelVisible) {
          self.network.send("request_player_list", {});
          self.ui.showPlayerPanel();
        } else {
          self.ui.removePlayerPanel();
        }
      },

      showPlayerPanel: function() {
        self.ui.removePlayerPanel();
        
        if (!self.network.roomCode) return;

        var panel = document.createElement("div");
        panel.id = "mp-player-panel";
        panel.style.cssText = "position:fixed; top:50px; right:10px; width:260px; background:#2a2e35; border:1px solid #555; border-radius:8px; z-index:9500; color:#eee; font-family:inherit; box-shadow:0 4px 16px rgba(0,0,0,0.4); pointer-events:all;";
        
        // Header
        var header = document.createElement("div");
        header.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid #444; background:#333840; border-radius:8px 8px 0 0;";
        
        var titleEl = document.createElement("span");
        titleEl.textContent = "Players (" + self.playerList.length + ")";
        titleEl.style.cssText = "font-weight:bold; font-size:14px; text-transform:uppercase; letter-spacing:0.05em; color:#b39ddb;";
        header.appendChild(titleEl);
        
        var closeBtn = document.createElement("button");
        closeBtn.textContent = "\u00D7";
        closeBtn.style.cssText = "background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1; pointer-events:all;";
        closeBtn.onclick = function() {
          self.playerPanelVisible = false;
          self.ui.removePlayerPanel();
        };
        header.appendChild(closeBtn);
        panel.appendChild(header);
        
        // Keybind hint
        var hint = document.createElement("div");
        hint.textContent = "Press J to toggle";
        hint.style.cssText = "padding:4px 14px; font-size:10px; color:#666; text-align:center; border-bottom:1px solid #3a3f47;";
        panel.appendChild(hint);
        
        // Player list
        var listContainer = document.createElement("div");
        listContainer.id = "mp-player-list";
        listContainer.style.cssText = "max-height:300px; overflow-y:auto;";
        
        for (var i = 0; i < self.playerList.length; i++) {
          var p = self.playerList[i];
          var row = document.createElement("div");
          row.style.cssText = "display:flex; align-items:center; justify-content:space-between; padding:8px 14px; border-bottom:1px solid #333840;";
          
          // Player info
          var info = document.createElement("div");
          info.style.cssText = "display:flex; align-items:center; gap:8px;";
          
          var dot = document.createElement("span");
          dot.style.cssText = "width:8px; height:8px; border-radius:50%; background:" + (p.isHost ? "#b39ddb" : "#43a047") + "; display:inline-block; flex-shrink:0;";
          info.appendChild(dot);
          
          var nameEl = document.createElement("span");
          nameEl.textContent = p.id;
          nameEl.style.cssText = "font-size:13px;" + (p.id === self.network.playerId ? " font-weight:bold; color:#fff;" : " color:#ccc;");
          info.appendChild(nameEl);
          
          if (p.isSpectator) {
            var specBadge = document.createElement("span");
            specBadge.textContent = "SPECTATOR";
            specBadge.style.cssText = "font-size:9px; background:#455a64; color:#fff; padding:2px 5px; border-radius:3px; margin-left:4px;";
            info.appendChild(specBadge);
          }
          
          if (p.isHost) {
            var badge = document.createElement("span");
            badge.textContent = "HOST";
            badge.style.cssText = "font-size:9px; background:#4a148c; color:#fff; padding:2px 5px; border-radius:3px; margin-left:4px; font-weight:bold;";
            info.appendChild(badge);
          }
          
          if (p.id === self.network.playerId) {
            var youBadge = document.createElement("span");
            youBadge.textContent = "YOU";
            youBadge.style.cssText = "font-size:9px; background:#333; color:#aaa; padding:2px 5px; border-radius:3px; margin-left:4px;";
            info.appendChild(youBadge);
          }
          
          row.appendChild(info);
          
          // Action buttons (host only, not for self)
          if (self.network.isHost && p.id !== self.network.playerId) {
            var actions = document.createElement("div");
            actions.style.cssText = "display:flex; gap:4px;";
            
            // Transfer host button
            var transferBtn = document.createElement("button");
            transferBtn.textContent = "\u2B06";
            transferBtn.title = "Transfer host to " + p.id;
            transferBtn.style.cssText = "background:#1565c0; color:white; border:none; border-radius:3px; padding:3px 6px; cursor:pointer; font-size:11px; pointer-events:all;";
            (function(targetId) {
              transferBtn.onclick = function() {
                if (confirm("Transfer host to " + targetId + "?")) {
                  self.network.send("transfer_host", { targetId: targetId });
                }
              };
            })(p.id);
            actions.appendChild(transferBtn);
            
            // Kick button
            var kickBtn = document.createElement("button");
            kickBtn.textContent = "\u2716";
            kickBtn.title = "Kick " + p.id;
            kickBtn.style.cssText = "background:#c62828; color:white; border:none; border-radius:3px; padding:3px 6px; cursor:pointer; font-size:11px; pointer-events:all;";
            (function(targetId) {
              kickBtn.onclick = function() {
                if (confirm("Kick " + targetId + "?")) {
                  self.network.send("kick_player", { targetId: targetId });
                }
              };
            })(p.id);
            actions.appendChild(kickBtn);
            
            row.appendChild(actions);
          }
          
          listContainer.appendChild(row);
        }
        
        if (self.playerList.length === 0) {
          var empty = document.createElement("div");
          empty.textContent = "No players connected";
          empty.style.cssText = "padding:20px 14px; text-align:center; color:#666; font-size:13px;";
          listContainer.appendChild(empty);
        }
        
        panel.appendChild(listContainer);
        
        // Chat section
        var chatContainer = document.createElement("div");
        chatContainer.style.cssText = "display:flex; flex-direction:column; border-top:1px solid #444; background:#2a2e35;";
        
        var chatLog = document.createElement("div");
        chatLog.id = "mp-chat-log";
        chatLog.style.cssText = "height:120px; overflow-y:auto; padding:8px 14px; font-size:12px; color:#ddd; display:flex; flex-direction:column; gap:4px;";
        chatContainer.appendChild(chatLog);
        
        var chatInputWrap = document.createElement("div");
        chatInputWrap.style.cssText = "padding:8px 14px; display:flex; gap:6px; background:#333840;";
        
        var chatInput = document.createElement("input");
        chatInput.type = "text";
        chatInput.placeholder = "Type message...";
        chatInput.style.cssText = "flex:1; background:#222; border:1px solid #555; color:#eee; border-radius:3px; padding:4px 8px; font-size:12px; outline:none;";
        
        var chatBtn = document.createElement("button");
        chatBtn.textContent = "Send";
        chatBtn.style.cssText = "background:#4a148c; color:white; border:none; border-radius:3px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;";
        
        var sendChat = function() {
            var text = chatInput.value.trim();
            if (text) {
                self.network.send("chat_message", { text: text });
                chatInput.value = "";
            }
        };
        chatBtn.onclick = sendChat;
        chatInput.onkeydown = function(e) {
            e.stopPropagation(); // Prevent game from capturing keys while typing
            if (e.key === "Enter") sendChat();
        };
        chatInput.onkeyup = function(e) { e.stopPropagation(); };
        chatInput.onkeypress = function(e) { e.stopPropagation(); };
        
        chatInputWrap.appendChild(chatInput);
        chatInputWrap.appendChild(chatBtn);
        chatContainer.appendChild(chatInputWrap);
        panel.appendChild(chatContainer);
        
        // Room code footer
        var footer = document.createElement("div");
        footer.style.cssText = "padding:10px 14px; border-top:1px solid #444; background:#333840; border-radius:0 0 8px 8px; display:flex; justify-content:space-between; align-items:center;";
        
        var codeLabel = document.createElement("span");
        codeLabel.textContent = "Room: " + (self.network.roomCode || "N/A");
        codeLabel.style.cssText = "font-size:12px; color:#888; font-family:monospace;";
        footer.appendChild(codeLabel);
        
        var roleLabel = document.createElement("span");
        roleLabel.textContent = self.network.isHost ? "Host" : "Guest";
        roleLabel.style.cssText = "font-size:11px; color:" + (self.network.isHost ? "#b39ddb" : "#43a047") + "; font-weight:bold; text-transform:uppercase;";
        footer.appendChild(roleLabel);
        
        panel.appendChild(footer);
        document.body.appendChild(panel);
      },

      updatePlayerPanel: function() {
        if (self.playerPanelVisible) {
          self.ui.showPlayerPanel();
        }
      },

      removePlayerPanel: function() {
        var el = document.getElementById("mp-player-panel");
        if (el) el.remove();
      },

      appendChatMessage: function(sender, text) {
        var log = document.getElementById("mp-chat-log");
        if (log) {
            var msgEl = document.createElement("div");
            msgEl.innerHTML = "<b>" + sender + ":</b> " + text;
            log.appendChild(msgEl);
            log.scrollTop = log.scrollHeight;
        } else {
            // Show toast if panel is closed
            var toast = document.createElement("div");
            toast.style.cssText = "position:fixed; bottom:20px; right:20px; background:rgba(40,40,40,0.9); color:white; padding:10px 15px; border-left:4px solid #4a148c; border-radius:4px; font-size:13px; z-index:9999; box-shadow:0 4px 12px rgba(0,0,0,0.5); pointer-events:none; transition:opacity 0.5s;";
            toast.innerHTML = "<b>" + sender + ":</b> " + text;
            document.body.appendChild(toast);
            setTimeout(function() {
                toast.style.opacity = "0";
                setTimeout(function() { toast.remove(); }, 500);
            }, 5000);
        }
      }
    };
  }

  setupSync() {
    return {
      createSnapshot: function(root) {
        root.savegame.updateData(root);
        return root.savegame.getCurrentDump();
      },
      applyState: function(root, state) {
          if (state.hub && root.hubGoals) {
              var oldUpgrades = JSON.stringify(root.hubGoals.upgradeLevels || {});
              root.hubGoals.deserialize(state.hub, root);
              var newUpgrades = JSON.stringify(root.hubGoals.upgradeLevels || {});
              if (oldUpgrades !== newUpgrades) {
                  for (var id in root.hubGoals.upgradeLevels) {
                     root.signals.upgradePurchased.dispatch(id);
                  }
              }
          }
          if (state.waypoints && root.hud.parts.waypoints) {
              var oldWp = JSON.stringify(root.hud.parts.waypoints.serialize());
              var newWp = JSON.stringify(state.waypoints);
              if (oldWp !== newWp) {
                  root.hud.parts.waypoints.deserialize(state.waypoints);
              }
          }
          if (state.pinnedShapes && root.hud.parts.pinnedShapes) {
              var oldPs = JSON.stringify(root.hud.parts.pinnedShapes.serialize());
              var newPs = JSON.stringify(state.pinnedShapes);
              if (oldPs !== newPs) {
                  root.hud.parts.pinnedShapes.deserialize(state.pinnedShapes);
                  root.hud.parts.pinnedShapes.rerenderFull();
              }
          }
      }
    };
  }

  setupActions() {
    var self = this;
    return {
      isRemote: false,
      totalEntitiesPlaced: 0,
      setupHooks: function(root) {
        if (!shapez.Blueprint.prototype.tryPlace.__mp_hooked) {
            var origBlueprintPlace = shapez.Blueprint.prototype.tryPlace;
            shapez.Blueprint.prototype.tryPlace = function (blueprintRoot, tile) {
                var entitiesToPlace = [];
                if (!self.actions.isRemote && !self.network.isSpectator) {
                     for (var i = 0; i < this.entities.length; ++i) {
                         var entity = this.entities[i];
                         if (blueprintRoot.logic.checkCanPlaceEntity(entity, { offset: tile })) {
                             var staticComp = entity.components.StaticMapEntity;
                             var metaBuilding = staticComp.getMetaBuilding();
                             entitiesToPlace.push({
                                 code: metaBuilding.getId(),
                                 origin: { x: staticComp.origin.x + tile.x, y: staticComp.origin.y + tile.y },
                                 rotation: staticComp.rotation,
                                 rotationVariant: staticComp.getRotationVariant(),
                                 variant: staticComp.getVariant()
                             });
                         }
                     }
                }

                var res = origBlueprintPlace.apply(this, arguments);

                if (res && entitiesToPlace.length > 0) {
                     for (var i = 0; i < entitiesToPlace.length; ++i) {
                          self.network.actionQueue.push({
                              type: "place",
                              payload: entitiesToPlace[i]
                          });
                          self.actions.totalEntitiesPlaced++;
                     }
                }
                return res;
            };
            shapez.Blueprint.prototype.tryPlace.__mp_hooked = true;
        }

        var origPlace = root.logic.tryPlaceBuilding;
        root.logic.tryPlaceBuilding = function (params) {
          var res = origPlace.apply(this, arguments);
          if (res) {
            if (!self.actions.isRemote && !self.network.isSpectator) {
              self.network.actionQueue.push({
                type: "place",
                payload: {
                  code: params.building.getId(),
                  origin: { x: params.origin.x, y: params.origin.y },
                  rotation: params.rotation,
                  rotationVariant: params.rotationVariant || 0,
                  variant: params.variant || "default"
                }
              });
            }
            self.actions.totalEntitiesPlaced++;
          }
          return res;
        };

        var origDelete = root.logic.tryDeleteBuilding;
        root.logic.tryDeleteBuilding = function (entity) {
          var res = origDelete.apply(this, arguments);
          if (res) {
            if (!self.actions.isRemote && !self.network.isSpectator) {
              var origin = entity.components.StaticMapEntity.origin;
              self.network.actionQueue.push({ type: "delete", payload: { x: origin.x, y: origin.y } });
            }
            self.actions.totalEntitiesPlaced--;
          }
          return res;
        };

        // Hooks for Waypoints
        var origAddWaypoint = root.hud.parts.waypoints.addWaypoint;
        root.hud.parts.waypoints.addWaypoint = function(label, position) {
            if (!self.network.isHost && !self.actions.isRemote) {
                self.network.send("waypoint_action", { type: "add", label: label, x: position.x, y: position.y });
            }
            return origAddWaypoint.apply(this, arguments);
        };

        var origDeleteWaypoint = root.hud.parts.waypoints.deleteWaypoint;
        root.hud.parts.waypoints.deleteWaypoint = function(waypoint) {
            if (!self.network.isHost && !self.actions.isRemote) {
                self.network.send("waypoint_action", { type: "delete", label: waypoint.label, x: waypoint.center.x, y: waypoint.center.y });
            }
            return origDeleteWaypoint.apply(this, arguments);
        };

        var origRenameWaypoint = root.hud.parts.waypoints.renameWaypoint;
        root.hud.parts.waypoints.renameWaypoint = function(waypoint, newLabel) {
            if (!self.network.isHost && !self.actions.isRemote) {
                self.network.send("waypoint_action", { type: "rename", label: waypoint.label, newLabel: newLabel, x: waypoint.center.x, y: waypoint.center.y });
            }
            return origRenameWaypoint.apply(this, arguments);
        };

        // Hooks for Pinned Shapes
        var origPinShape = root.hud.parts.pinnedShapes.pinNewShape;
        root.hud.parts.pinnedShapes.pinNewShape = function(definition) {
            if (!self.network.isHost && !self.actions.isRemote) {
                self.network.send("pinned_action", { type: "pin", key: definition.getHash() });
            }
            return origPinShape.apply(this, arguments);
        };

        var origUnpinShape = root.hud.parts.pinnedShapes.unpinShape;
        root.hud.parts.pinnedShapes.unpinShape = function(key) {
            if (!self.network.isHost && !self.actions.isRemote) {
                self.network.send("pinned_action", { type: "unpin", key: key });
            }
            return origUnpinShape.apply(this, arguments);
        };

        // Hooks for Upgrades
        if (shapez.HubGoals && !shapez.HubGoals.prototype.tryUnlockUpgrade.__mp_hooked) {
            var origUnlockUpgrade = shapez.HubGoals.prototype.tryUnlockUpgrade;
            shapez.HubGoals.prototype.tryUnlockUpgrade = function (upgradeId) {
                if (!self.actions.isRemote && !self.network.isHost && !self.network.isSpectator) {
                    self.network.send("upgrade_action", { upgradeId: upgradeId });
                    return false; // Let the host handle it
                }
                return origUnlockUpgrade.apply(this, arguments);
            };
            shapez.HubGoals.prototype.tryUnlockUpgrade.__mp_hooked = true;
        }

        // Hooks for Levers
        if (shapez.HUDLeverToggle && !shapez.HUDLeverToggle.prototype.downPreHandler.__mp_hooked) {
            var origLeverToggle = shapez.HUDLeverToggle.prototype.downPreHandler;
            shapez.HUDLeverToggle.prototype.downPreHandler = function (pos, button) {
                var res = origLeverToggle.apply(this, arguments);
                if (res === shapez.STOP_PROPAGATION && !self.actions.isRemote && button === shapez.enumMouseButton.left) {
                    var tile = this.root.camera.screenToWorld(pos).toTileSpace();
                    var contents = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
                    if (contents && contents.components.Lever) {
                        var isToggled = contents.components.Lever.toggled;
                        self.network.send("lever_action", { x: tile.x, y: tile.y, toggled: isToggled });
                    }
                }
                return res;
            };
            shapez.HUDLeverToggle.prototype.downPreHandler.__mp_hooked = true;
        }

        // Hooks for Constant Signals
        if (shapez.HUDConstantSignalEdit && !shapez.HUDConstantSignalEdit.prototype.editConstantSignal.__mp_hooked) {
            var origEditConstantSignal = shapez.HUDConstantSignalEdit.prototype.editConstantSignal;
            shapez.HUDConstantSignalEdit.prototype.editConstantSignal = function (entity, opts) {
                if (entity.components.ConstantSignal && !entity.components.ConstantSignal.__mp_hooked) {
                    var _signal = entity.components.ConstantSignal.signal;
                    Object.defineProperty(entity.components.ConstantSignal, "signal", {
                        get: function() { return _signal; },
                        set: function(val) {
                            var changed = (_signal !== val);
                            _signal = val;
                            if (changed && !self.actions.isRemote) {
                                var tile = entity.components.StaticMapEntity.origin;
                                var valKey = val ? val.getAsCopyableKey() : null;
                                self.network.send("constant_signal_action", { x: tile.x, y: tile.y, signal: valKey });
                            }
                        }
                    });
                    entity.components.ConstantSignal.__mp_hooked = true;
                }
                return origEditConstantSignal.apply(this, arguments);
            };
            shapez.HUDConstantSignalEdit.prototype.editConstantSignal.__mp_hooked = true;
        }

        // Share hub progress
        if (root.signals.storyGoalCompleted) {
          root.signals.storyGoalCompleted.add(function(lvl) {
            if (!self.actions.isRemote) self.network.send("delta", { type: "level", lvl: lvl });
          });
        }
        
        // Speed Control Mod Compatibility
        self._speedSyncInterval = setInterval(function() {
            if (!self.network) return;
            var speedInput = document.getElementById("speed");
            var pauseImg = document.getElementById("pause-image");
            
            if (self.network.isHost) {
                if (!speedInput) return;
                var state = {
                    speed: speedInput.value,
                    paused: pauseImg ? pauseImg.src.indexOf("play") !== -1 : false
                };
                if (JSON.stringify(state) !== JSON.stringify(self.lastSpeedState)) {
                    self.lastSpeedState = state;
                    self.network.send("speed_control", state);
                }
            } else {
                if (speedInput) speedInput.style.pointerEvents = "none";
                var pauseBtn = document.getElementById("pause-button");
                if (pauseBtn) pauseBtn.style.pointerEvents = "none";
            }
        }, 200);
      },

      handleRemote: function(action, from) {
        try {
          var root = self.root;
          if (!root) return;
          this.isRemote = true;
          if (action.type === "place") {
            var code = action.payload.code;
            var origin = action.payload.origin;
            var rotation = action.payload.rotation;
            var rotationVariant = action.payload.rotationVariant;
            var variant = action.payload.variant;
            var metaBuilding = shapez.gMetaBuildingRegistry.findById(code);
            if (metaBuilding) {
              var res = root.logic.tryPlaceBuilding({
                building: metaBuilding,
                origin: new shapez.Vector(origin.x, origin.y),
                rotation: rotation || 0,
                originalRotation: rotation || 0,
                rotationVariant: rotationVariant || 0,
                variant: variant || "default"
              });
              if(res) this.totalEntitiesPlaced++;
            }
          } else if (action.type === "delete") {
            var entity = root.map.getLayerContentXY(action.payload.x, action.payload.y, "regular");
            if (entity) {
                var res = root.logic.tryDeleteBuilding(entity);
                if(res) this.totalEntitiesPlaced--;
            }
          }
        } catch (e) {
          console.error("Multiplayer Mod: Error handling remote action:", e);
        } finally {
          this.isRemote = false;
        }
      }
    };
  }
}

class CursorOverlay extends shapez.BaseHUDPart {
  initialize() {
    this.mod = shapez.MODS.mods.find(function(m) { return m.metadata.id === "multiplayer"; });
    if (this.mod) {
      this.mod.cursorOverlay = this;
    }
    this.cursors = new Map();
  }
  update() {
    if (!this.mod) return;
    if (this.root.app.tickCount % 6 === 0) {
      var pos = this.root.app.mouseHandler.getMouseWorldPos();
      if (pos) this.mod.network.send("cursor", { x: pos.x, y: pos.y });
    }
  }
  updateRemote(id, pos) {
    if (!this.cursors) this.cursors = new Map();
    this.cursors.set(id, { x: pos.x, y: pos.y, time: Date.now() });
  }
  drawOverlays(parameters) {
    if (!this.cursors) return;
    var context = parameters.context;
    var zoomLevel = parameters.zoomLevel;
    var now = Date.now();
    var toDelete = [];
    this.cursors.forEach(function(data, id) {
      if (now - data.time > 5000) { toDelete.push(id); return; }
      var screenPos = this.root.camera.worldToScreen(new shapez.Vector(data.x, data.y));
      
      var color = "#ff00ff";
      if (this.mod.playerList) {
          for (var i = 0; i < this.mod.playerList.length; i++) {
              if (this.mod.playerList[i].id === id) {
                  color = this.mod.playerList[i].color || color;
                  break;
              }
          }
      }

      context.fillStyle = color;
      context.beginPath();
      context.arc(screenPos.x, screenPos.y, 5 / zoomLevel, 0, Math.PI * 2);
      context.fill();
      context.font = (12 / zoomLevel) + "px sans-serif";
      context.fillText(id, screenPos.x + 8 / zoomLevel, screenPos.y);
    }.bind(this));
    for (var i = 0; i < toDelete.length; i++) {
      this.cursors.delete(toDelete[i]);
    }
  }
}
