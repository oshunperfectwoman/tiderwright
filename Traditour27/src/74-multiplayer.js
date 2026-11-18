// ===== 74-multiplayer.js =====
// Colyseus adapter for the local sailing simulation. Each client moves its own
// skiff immediately; the server validates/relays poses and arbitrates shared play.
(function () {
  'use strict';
  const TW = window.TW;
  const PROTOCOL = 'traditour-colyseus-v2';
  const ROOM_NAME = 'traditour';
  const SEND_INTERVAL_MS = 33;
  const WEATHER_INTERVAL_MS = 250;
  const SMOOTH_SECONDS = 0.09;
  const MAX_PROJECTION_SECONDS = 0.14;
  const SNAP_DISTANCE = 35;
  const M = {
    enabled: false, connecting: false, connected: false, room: null, client: null,
    sessionId: '', weatherHostId: '', remotes: new Map(), badge: null,
    lastPoseAt: 0, lastWeatherAt: 0, lastStatePollAt: 0, revision: 0, lastSnapshotAt: 0,
    otherPlayers: 0, status: 'LOCAL', applyingRemote: false,
    roomCode: '', roomPhase: 'lobby', hostId: '', players: [], lobby: null,
    seenCollisions: new Set(), eventsRegistered: false,
  };
  function query() { return new URLSearchParams(window.location.search); }
  function getServerUrl() {
    const requested = query().get('server');
    if (requested) {
      try { const parsed = new URL(requested); if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') return parsed.href.replace(/\/$/, ''); }
      catch (_) { /* show a useful unavailable state below */ }
      return '';
    }
    const host = window.location.hostname || '127.0.0.1';
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (window.location.protocol === 'https:') return `wss://${host}:2567`;
    return `ws://${loopback ? '127.0.0.1' : host}:2567`;
  }
  function manifest() {
    const W = TW.world || {}, spawn = W.spawn || { x: 0, z: 0 };
    return {
      spawn: { x: Number(spawn.x) || 0, z: Number(spawn.z) || 0 },
      beacons: (W.beacons || []).map((b) => ({ x: Number(b.dock && b.dock.x) || 0, z: Number(b.dock && b.dock.z) || 0, radius: Number(b.dock && b.dock.r) || 10, heart: !!b.isHeart })),
      floats: (W.floats || []).map((f) => ({ x: Number(f.x) || 0, z: Number(f.z) || 0 })),
      rocks: (W.rocks || []).map((r) => ({ x: Number(r.x) || 0, z: Number(r.z) || 0, radius: Number(r.r) || 1 })),
    };
  }
  function setStatus(message, kind) {
    M.status = message;
    if (!M.badge) return;
    M.badge.textContent = message;
    M.badge.dataset.state = kind || (M.connected ? 'online' : M.connecting ? 'pending' : 'offline');
    M.badge.setAttribute('aria-label', message);
    M.badge.title = M.connected ? 'Cliquer pour quitter la partie multijoueur' : 'Cliquer pour (re)tenter la connexion';
  }
  function ensureBadge() {
    if (M.badge || !document.body) return;
    const badge = document.createElement('button');
    badge.type = 'button'; badge.textContent = 'MULTI · LOCAL'; badge.setAttribute('aria-live', 'polite');
    badge.style.cssText = ['position:fixed','top:calc(12px + env(safe-area-inset-top,0px))','right:calc(12px + env(safe-area-inset-right,0px))','z-index:80','pointer-events:auto','padding:7px 10px','border:1px solid rgba(111,183,166,.55)','border-radius:3px','background:rgba(10,17,24,.78)','color:#c6ddd6','font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace','letter-spacing:.09em','cursor:pointer','backdrop-filter:blur(8px)'].join(';');
    badge.addEventListener('click', () => {
      if (!M.connected) { connect(); return; }
      ensureLobby();
      if (M.lobby.root.style.display === 'none') { M.lobby.manual = true; updateLobby(true); }
      else { M.lobby.manual = false; M.lobby.root.style.display = 'none'; }
    });
    document.body.appendChild(badge); M.badge = badge;
    ensureLobby();
  }
  function ensureLobby() {
    if (M.lobby || !document.body) return;
    const root = document.createElement('section');
    root.id = 'tw-multi-lobby';
    root.style.cssText = 'position:fixed;z-index:240;inset:0;display:none;place-items:center;padding:20px;background:rgba(4,14,24,.42);backdrop-filter:blur(5px);font:13px/1.35 Inter,system-ui,sans-serif;color:#f2f7f8;pointer-events:auto';
    root.innerHTML = '<div style="width:min(390px,calc(100vw - 32px));padding:22px;border:1px solid rgba(32,216,208,.55);border-radius:12px;background:rgba(8,28,43,.95);box-shadow:0 22px 70px rgba(0,0,0,.52)">' +
      '<div style="color:#20d8d0;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase">TRADITOUR 2027 · SALON</div>' +
      '<button data-close style="position:absolute;right:12px;top:10px;border:0;background:transparent;color:#9bb7c8;font-size:22px;cursor:pointer">×</button><h2 style="margin:6px 0 2px;font:900 25px/1.1 Arial Narrow,Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase">Préparez la régate</h2>' +
      '<div data-room style="margin:7px 0 14px;color:#9bb7c8;font-size:11px"></div>' +
      '<label style="display:block;color:#9bb7c8;font-size:10px;letter-spacing:.08em;text-transform:uppercase">Votre nom<input data-name maxlength="18" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px 10px;border:1px solid rgba(175,207,222,.25);border-radius:6px;background:#071725;color:#f2f7f8;font:inherit"></label>' +
      '<button data-name-save style="margin-top:7px;border:1px solid rgba(175,207,222,.3);border-radius:6px;padding:7px 10px;background:transparent;color:#20d8d0;cursor:pointer">Appliquer le nom</button>' +
      '<div data-players style="display:grid;gap:5px;margin:16px 0 12px"></div>' +
      '<div data-message style="min-height:20px;color:#ffcf78;font-size:11px"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button data-ready style="flex:1;border:0;border-radius:7px;padding:11px 12px;background:#20d8d0;color:#071725;font-weight:900;cursor:pointer">JE SUIS PRÊT</button><button data-start style="flex:1;border:1px solid rgba(32,216,208,.5);border-radius:7px;padding:11px 12px;background:transparent;color:#20d8d0;font-weight:900;cursor:pointer">LANCER LA RÉGATE</button></div>' +
      '<div data-foot style="margin-top:12px;color:#7695a8;font-size:10px">Le capitaine lance quand tous les joueurs sont prêts.</div>' +
      '</div>';
    document.body.appendChild(root);
    const nameInput = root.querySelector('[data-name]');
    nameInput.value = (query().get('name') || 'Marin').slice(0, 18);
    root.querySelector('[data-ready]').addEventListener('click', () => {
      const me = M.players.find((p) => p.id === M.sessionId);
      safeSend('lobby-ready', { ready: !(me && me.ready) });
    });
    root.querySelector('[data-close]').addEventListener('click', () => { M.lobby.manual = false; M.lobby.root.style.display = 'none'; });
    root.querySelector('[data-start]').addEventListener('click', () => requestRaceStart('E1'));
    root.querySelector('[data-name-save]').addEventListener('click', () => {
      const value = String(nameInput.value || 'Marin').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18) || 'Marin';
      const url = new URL(window.location.href); url.searchParams.set('name', value); window.history.replaceState({}, '', url);
      disconnect(); connect();
    });
    M.lobby = { root, room: root.querySelector('[data-room]'), players: root.querySelector('[data-players]'), message: root.querySelector('[data-message]'), ready: root.querySelector('[data-ready]'), start: root.querySelector('[data-start]'), foot: root.querySelector('[data-foot]'), name: nameInput, manual: query().get('lobby') === '1' };
  }
  function updateLobby(force) {
    if (!M.lobby) return;
    const active = M.connected && (force || M.lobby.manual || M.roomPhase === 'lobby' || M.roomPhase === 'finished');
    M.lobby.root.style.display = active ? 'grid' : 'none';
    if (!active) return;
    const total = M.players.length, ready = M.players.filter((p) => p.ready).length;
    M.lobby.room.textContent = 'Code du salon : ' + (M.roomCode || '…') + ' · ' + total + ' joueur' + (total > 1 ? 's' : '');
    M.lobby.players.innerHTML = M.players.map((p) => '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px;border:1px solid ' + (p.ready ? 'rgba(32,216,208,.42)' : 'rgba(175,207,222,.14)') + ';border-radius:6px;background:rgba(255,255,255,.035)"><span>' + escapeHtml(p.name || 'Marin') + (p.id === M.hostId ? ' <small style="color:#ffcf78">CAPITAINE</small>' : '') + '</span><b style="color:' + (p.ready ? '#20d8d0' : '#9bb7c8') + ';font-size:10px">' + (p.ready ? 'PRÊT' : 'EN ATTENTE') + '</b></div>').join('');
    const me = M.players.find((p) => p.id === M.sessionId);
    M.lobby.ready.textContent = me && me.ready ? 'ANNULER MON PRÊT' : 'JE SUIS PRÊT';
    M.lobby.start.disabled = M.roomPhase !== 'lobby' || M.sessionId !== M.hostId || ready !== total || !total;
    M.lobby.start.style.opacity = M.lobby.start.disabled ? '.45' : '1';
    M.lobby.foot.textContent = (M.roomPhase === 'countdown' || M.roomPhase === 'racing') ? 'Une régate est déjà en cours. La prochaine manche se préparera ici.' : M.sessionId === M.hostId ? (ready === total ? 'Tous les joueurs sont prêts. Tu peux lancer.' : ready + '/' + total + ' joueurs prêts.') : 'Le capitaine lance quand tous les joueurs sont prêts.';
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function loadSdk() {
    if (window.Colyseus && window.Colyseus.Client) return Promise.resolve(window.Colyseus);
    if (M.sdkPromise) return M.sdkPromise;
    M.sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/colyseus.js', document.baseURI).href; script.async = true;
      script.onload = () => window.Colyseus && window.Colyseus.Client ? resolve(window.Colyseus) : reject(new Error('Le SDK Colyseus est chargé mais indisponible.'));
      script.onerror = () => reject(new Error('SDK Colyseus introuvable dans vendor/colyseus.js.'));
      document.head.appendChild(script);
    }).catch((error) => { M.sdkPromise = null; throw error; });
    return M.sdkPromise;
  }
  function clearConnection(message) {
        M.room = null; M.client = null; M.sessionId = ''; M.weatherHostId = '';
    M.remotes.clear(); M.seenCollisions.clear(); M.lastSnapshotAt = 0;
    M.revision = 0; M.lastPoseAt = 0; M.lastWeatherAt = 0; M.lastStatePollAt = 0;
    M.connected = false; M.connecting = false;
    M.players = []; M.roomCode = ''; M.hostId = ''; M.roomPhase = 'lobby';
    if (M.lobby) M.lobby.root.style.display = 'none';
    setStatus(message || 'MULTI · HORS LIGNE', 'offline');
  }
  function registerEvents() {
    if (M.eventsRegistered || !TW.on) return;
    M.eventsRegistered = true;
    TW.on('beaconLit', (data) => { if (M.connected && data && Number.isInteger(Number(data.index))) safeSend('objective', { kind: 'beacon', index: Number(data.index) }); });
    TW.on('pickup', (data) => { if (M.connected && data && Number.isInteger(Number(data.index))) safeSend('objective', { kind: 'float', index: Number(data.index) }); });
    TW.on('lightning', (data) => {
      if (!M.connected || !isWeatherHost() || M.applyingRemote) return;
      safeSend('weather-event', { type: 'lightning', data: { x: Number(data && data.x) || 0, y: Number(data && data.y) || 0, z: Number(data && data.z) || 0, dist: Number(data && data.dist) || 0 } });
    });
  }
  async function connect() {
    if (M.connected || M.connecting) return;
    M.connecting = true; ensureBadge(); registerEvents();
    const url = getServerUrl();
    if (!url) { M.connecting = false; setStatus('MULTI · URL SERVEUR INVALIDE', 'offline'); return; }
    setStatus('MULTI · CONNEXION…', 'pending');
    try {
      const sdk = await loadSdk(), client = new sdk.Client(url); M.client = client;
      const name = (query().get('name') || 'Marin').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18) || 'Marin';
      const room = await client.joinOrCreate(ROOM_NAME, { name, manifest: manifest() });
      M.room = room; M.sessionId = room.sessionId; M.connected = true; M.connecting = false;
      room.onStateChange((state) => acceptSnapshot(state));
      room.onMessage('shared-sync', applySharedSync);
      room.onMessage('room-state', applyRoomState);
      room.onMessage('lobby-error', (data) => { if (M.lobby) M.lobby.message.textContent = data && data.message ? data.message : 'Action impossible pour le moment.'; });
      room.onMessage('race-state', applyRaceState);
      room.onMessage('collision', applyCollision);
      room.onMessage('weather-event', applyWeatherEvent);
      room.onLeave(() => clearConnection('MULTI · DÉCONNECTÉ · CLIQUER POUR REJOINDRE'));
      room.onError(() => clearConnection('MULTI · ERREUR SERVEUR · CLIQUER POUR RÉESSAYER'));
      if (room.state) acceptSnapshot(room.state);
      safeSend('sync-request', {});
      sendPose(true);
      updateLobby();
      if (!M.lastSnapshotAt) setStatus('MULTI · CONNECTÉ', 'online');
    } catch (error) {
      console.warn('[TW multiplayer] connexion impossible:', error && error.message ? error.message : error);
      clearConnection('MULTI · HORS LIGNE · CLIQUER POUR RÉESSAYER');
    }
  }
  function disconnect() {
    const room = M.room;
    if (room && room.leave) { try { room.leave(); } catch (_) { /* cleanup below is authoritative */ } }
    clearConnection('MULTI · DÉCONNECTÉ · CLIQUER POUR REJOINDRE');
  }
  function safeSend(type, payload) {
    if (!M.room || !M.connected) return false;
    try { M.room.send(type, payload); return true; }
    catch (_) { clearConnection('MULTI · CONNEXION PERDUE · CLIQUER POUR REJOINDRE'); return false; }
  }
  function forEachBoat(boats, callback) {
    if (!boats) return;
    if (typeof boats.entries === 'function') { for (const [id, boat] of boats.entries()) callback(boat, id); return; }
    if (typeof boats.forEach === 'function') boats.forEach((boat, id) => callback(boat, id));
  }
  function acceptSnapshot(state) {
    if (!state) return;
    if (state.protocol && state.protocol !== PROTOCOL) {
      setStatus('MULTI · VERSION INCOMPATIBLE', 'offline');
      if (M.room) M.room.leave(); clearConnection('MULTI · VERSION INCOMPATIBLE'); return;
    }
    const now = performance.now(), seen = new Set(); let otherPlayers = 0, own = null;
    forEachBoat(state.boats, (boat, id) => {
      const item = {
        id: String(boat.id || id), name: String(boat.name || 'Marin'), kind: String(boat.kind || 'player'),
        x: Number(boat.x) || 0, z: Number(boat.z) || 0, y: Number(boat.y) || 0,
        heading: Number(boat.heading) || 0, vx: Number(boat.vx) || 0, vz: Number(boat.vz) || 0,
        speed: Number(boat.speed) || 0, hull: Number.isFinite(Number(boat.hull)) ? Number(boat.hull) : 1,
        sail: Number(boat.sail) || 0, boom: Number(boat.boom) || 0, pitch: Number(boat.pitch) || 0,
        roll: Number(boat.roll) || 0, rudder: Number(boat.rudder) || 0,
        color: Number(boat.color) || 0x4fd1c5, connected: boat.connected !== false,
      };
      if (item.id === M.sessionId) { own = item; return; }
      seen.add(item.id); if (item.kind === 'player' && item.connected) otherPlayers++;
      const previous = M.remotes.get(item.id), distance = previous ? Math.hypot(previous.renderX - item.x, previous.renderZ - item.z) : Infinity;
      const keepOffset = previous && distance < SNAP_DISTANCE;
      const color = item.color >>> 0;
      M.remotes.set(item.id, {
        ...item, baseX: item.x, baseZ: item.z,
        correctionX: keepOffset ? previous.renderX - item.x : 0,
        correctionZ: keepOffset ? previous.renderZ - item.z : 0,
        renderX: keepOffset ? previous.renderX : item.x, renderZ: keepOffset ? previous.renderZ : item.z,
        renderHeading: keepOffset ? previous.renderHeading : item.heading, receivedAt: now,
        renderY: keepOffset && Number.isFinite(previous.renderY) ? previous.renderY : item.y,
        waterPoseInitialized: !!(previous && previous.waterPoseInitialized && keepOffset),
        renderPitch: keepOffset && Number.isFinite(previous.renderPitch) ? previous.renderPitch : 0,
        renderRoll: keepOffset && Number.isFinite(previous.renderRoll) ? previous.renderRoll : 0,
        tint: [((color >>> 16) & 255) / 255, ((color >>> 8) & 255) / 255, (color & 255) / 255],
      });
    });
    for (const id of M.remotes.keys()) if (!seen.has(id)) M.remotes.delete(id);
    if (own) M.revision = Math.max(M.revision, Number(own.poseRevision) || 0);
    M.lastSnapshotAt = now; M.otherPlayers = otherPlayers; updateStatusFromSnapshot();
  }
  function updateStatusFromSnapshot() {
    const count = M.otherPlayers || 0, players = count === 1 ? '1 JOUEUR DISTANT' : `${count} JOUEURS DISTANTS`;
    setStatus(`MULTI · CONNECTÉ · ${players}`, 'online');
  }
  function wrap(angle) { while (angle > Math.PI) angle -= Math.PI * 2; while (angle < -Math.PI) angle += Math.PI * 2; return angle; }
  function sendPose(force) {
    const b = TW.state && TW.state.boat;
    if (!b || !M.connected) return;
    const now = performance.now();
    if (!force && now - M.lastPoseAt < SEND_INTERVAL_MS) return;
    M.lastPoseAt = now;
    safeSend('pose', {
      revision: ++M.revision, x: Number(b.x) || 0, z: Number(b.z) || 0, y: Number(b.y) || 0,
      heading: Number(b.heading) || 0, vx: Number(b.vx) || 0, vz: Number(b.vz) || 0,
      speed: Math.max(0, Number(b.speed) || 0), hull: Math.max(0, Math.min(1, Number(b.hull) || 0)),
      sail: Math.max(0, Math.min(1, Number(b.sail) || 0)), boom: Number(b.boom) || 0,
      pitch: Number(b.pitch) || 0, roll: Number(b.roll) || 0, rudder: Number(b.rudder) || 0,
    });
  }
  function sendWeather() {
    const S = TW.state;
    if (!S || !isWeatherHost()) return;
    safeSend('weather', {
            time: S.time, storm: S.storm, rain: S.rain, flash: S.flash, dawn: S.dawn, daylight: S.daylight,
      tide: S.tide, vortexStrength: S.vortexStrength, wind: S.wind, lightning: S.lightning, heart: S.heart,
    });
  }
  function applySharedSync(data) {
    if (!data) return;
    M.weatherHostId = String(data.weatherHost || '');
    if (data.objectives && TW.game && TW.game.applyNetworkObjectives) TW.game.applyNetworkObjectives(data.objectives);
    if (data.weather && M.sessionId !== M.weatherHostId && TW.game && TW.game.applyNetworkWeather) TW.game.applyNetworkWeather(data.weather);
  }
  function applyRoomState(data) {
    if (!data) return;
    M.roomCode = String(data.roomCode || ''); M.roomPhase = String(data.phase || 'lobby'); M.hostId = String(data.hostId || '');
    M.players = Array.isArray(data.players) ? data.players.map((p) => ({ id: String(p.id || ''), name: String(p.name || 'Marin'), ready: !!p.ready, connected: p.connected !== false })) : [];
    if (Array.isArray(data.players)) acceptSnapshot({ protocol: PROTOCOL, boats: data.players });
    if (M.lobby) M.lobby.message.textContent = M.roomPhase === 'finished' ? 'La manche est terminée. Le capitaine peut relancer une régate.' : '';
    updateLobby();
  }
  function applyRaceState(data) {
    if (!data || !TW.regatta) return;
    if (data.phase === 'idle') {
      if (TW.regatta.endNetworkRace) TW.regatta.endNetworkRace();
      return;
    }
    if (TW.regatta.applyNetworkRace) TW.regatta.applyNetworkRace(data);
  }
  function applyCollision(data) {
    if (!data || !data.id || M.seenCollisions.has(data.id)) return;
    M.seenCollisions.add(data.id);
    if (M.seenCollisions.size > 128) M.seenCollisions.delete(M.seenCollisions.values().next().value);
    if (TW.game && TW.game.applyNetworkCollision && TW.game.applyNetworkCollision(data)) sendPose(true);
  }
  function applyWeatherEvent(event) {
    if (!event || event.type !== 'lightning' || !TW.emit) return;
    M.applyingRemote = true;
    try { TW.emit('lightning', event.data || {}); } finally { M.applyingRemote = false; }
  }
  function localWaterPose(remote, dt) {
    const env = TW.env;
    if (!env || typeof env.seaHeight !== 'function') return;
    const x = remote.renderX, z = remote.renderZ, h = remote.renderHeading;
    const fx = Math.sin(h), fz = Math.cos(h), sideX = fz, sideZ = -fx;
    const out = {};
    const hb = env.seaHeight(x + fx * 2.5, z + fz * 2.5, out);
    const hs = env.seaHeight(x - fx * 2.3, z - fz * 2.3, out);
    const hp = env.seaHeight(x + sideX * 1.05, z + sideZ * 1.05, out);
    const hq = env.seaHeight(x - sideX * 1.05, z - sideZ * 1.05, out);

    // Use the same four-point waterline estimate as the local AI fleet.
    // Network Y is deliberately ignored: each client evaluates its own sea
    // surface, avoiding differences between clients' wave clocks.
    const targetY = (hb + hs) * 0.27 + (hp + hq) * 0.23 + 0.04;
    const targetPitch = -Math.atan2(hb - hs, 4.8) * 0.92;
    const targetRoll = Math.atan2(hp - hq, 2.1) * 0.62;
    const rate = 1 - Math.exp(-Math.max(0.001, Math.min(0.05, dt)) * 8);

    // Snap only on first local evaluation, so an arbitrary server Y cannot
    // leave a newly seen boat floating or submerged during the blend-in.
    if (!remote.waterPoseInitialized || !Number.isFinite(remote.renderY)) {
      remote.renderY = targetY;
      remote.waterPoseInitialized = true;
    } else {
      remote.renderY += (targetY - remote.renderY) * rate;
    }
    remote.renderPitch += (targetPitch - remote.renderPitch) * rate;
    remote.renderRoll += (targetRoll - remote.renderRoll) * rate;
  }
  function applyNetworkUpdate(dt) {
    if (!M.enabled || !M.connected || !M.room) return;
    const now = performance.now();
    // Colyseus normally emits every schema patch, but a newly joined tab can
    // miss the first patch while its handlers are being attached. Re-reading
    // the current state keeps both viewpoints convergent without adding a
    // second network protocol.
    if (now - M.lastStatePollAt >= 250 && M.room.state) { M.lastStatePollAt = now; acceptSnapshot(M.room.state); }
    sendPose(false);
    if (M.sessionId === M.weatherHostId && now - M.lastWeatherAt >= WEATHER_INTERVAL_MS) { M.lastWeatherAt = now; sendWeather(); }
    const step = Math.max(0, Math.min(Number(dt) || 0, 0.05));
    for (const remote of M.remotes.values()) {
      const age = Math.min(MAX_PROJECTION_SECONDS, Math.max(0, (now - remote.receivedAt) / 1000));
      const fade = Math.exp(-age / SMOOTH_SECONDS);
      remote.renderX = remote.baseX + remote.vx * age + remote.correctionX * fade;
      remote.renderZ = remote.baseZ + remote.vz * age + remote.correctionZ * fade;
      const headingError = wrap(remote.heading - remote.renderHeading);
      remote.renderHeading = wrap(remote.renderHeading + headingError * (1 - Math.exp(-step / 0.07)));
      localWaterPose(remote, step);
    }
  }
  function draw() {
    if (!M.enabled || !M.connected || !TW.boat || !TW.boat.drawState) return;
    for (const remote of M.remotes.values()) {
      if (!remote.connected) continue;
      // Final render-time guard: never let a stale network heave place the
      // remote hull below or above this client's water surface.
      localWaterPose(remote, 1 / 60);
      const visualBoat = {
        id: remote.id, x: remote.renderX, y: remote.renderY, z: remote.renderZ,
        heading: remote.renderHeading, pitch: remote.renderPitch, roll: remote.renderRoll, rudder: remote.rudder,
        boom: remote.boom, sail: remote.sail, luff: 0, vx: remote.vx, vz: remote.vz, hull: remote.hull,
      };
      TW.boat.drawState(visualBoat, { tint: remote.tint, belly: 0.12 });
    }
  }
  function requestRaceStart(id) {
    if (!M.connected || !TW.regatta || !TW.regatta.networkStartInfo) return false;
    const info = TW.regatta.networkStartInfo(id);
    return info ? safeSend('race-start', info) : false;
  }
  function abortRace() { return safeSend('race-abort', {}); }
  function isWeatherHost() { return !!M.sessionId && M.sessionId === M.weatherHostId; }
  function init() {
    M.enabled = query().get('multi') === '1';
    if (!M.enabled) return;
    ensureBadge(); registerEvents(); setStatus('MULTI · CONNEXION…', 'pending'); connect();
  }
  TW.multiplayer = {
    init, update: applyNetworkUpdate, draw, connect, disconnect, state: M,
    isConnected: () => M.connected, isWeatherHost,
    remoteBoats: () => Array.from(M.remotes.values()),
    requestRaceStart, abortRace,
  };
})();
