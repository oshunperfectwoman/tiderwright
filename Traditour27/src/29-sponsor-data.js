// ===== 29-sponsor-data.js =====
// Central sponsor, placement, assignment and IndexedDB registry.
(function () {
  'use strict';
  const TW = window.TW;
  if (!TW) return;

  const DB_NAME = 'traditour-sponsoring';
  const DB_VERSION = 2;
  const MAX_LOGO_BYTES = 4 * 1024 * 1024;
  const MAX_LOGO_DIMENSION = 4096;
  const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const STAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const TYPE_RE = /^image\/(png|jpeg|webp)$/;
  const state = { sponsors: [], assignments: {} };
  const listeners = new Set();
  const mounts = new Set();
  const pendingAssets = new Map();
  const deletedAssets = new Set();
  const imageCache = new Map();
  let replaceAssets = false;
  let db = null;
  let storageAvailable = false;
  let error = '';

  const placements = [
    ['sail_player', 'Voile du joueur', 'Bateaux et voiles', '40-boat.js · texture UV de la voile joueur', false],
    ['sail_prudent', 'Voile du concurrent prudent', 'Bateaux et voiles', '40-boat.js · voile du bot prudent', false],
    ['sail_competitor', 'Voile du concurrent compétiteur', 'Bateaux et voiles', '40-boat.js · voile du bot compétiteur', false],
    ['sail_aggressive', 'Voile du concurrent agressif', 'Bateaux et voiles', '40-boat.js · voile du bot agressif', false],
    ['buoy_start', 'Bouées de départ', 'Bouées et monde 3D', 'Marquage sur les deux bouées de la ligne de départ', false],
    ['buoy_mark', 'Bouées intermédiaires', 'Bouées et monde 3D', 'Marquage sur les bouées des portes intermédiaires', false],
    ['buoy_finish', 'Bouées d’arrivée', 'Bouées et monde 3D', 'Marquage sur les deux bouées de la ligne d’arrivée', false],
    ['ui_title', 'Écran d’accueil', 'HUD et interfaces', 'Zone dédiée à l’écran titre', false],
    ['ui_championship', 'Sélection du championnat', 'HUD et interfaces', 'Zone dédiée à la sélection/presentation du championnat', false],
    ['ui_hud', 'HUD de navigation', 'HUD et interfaces', 'Emplacement discret, hors instruments essentiels', false],
    ['ui_chart', 'Carte de navigation', 'Carte de navigation', 'Cartouche réservé dans la carte canvas', false],
    ['ui_race_panel', 'Panneau de régate', 'Régate et étapes', 'Zone dédiée au panneau de régate', false],
    ['ui_leaderboard', 'Classement', 'Résultats et compétition', 'Zone dédiée au tableau de classement', false],
    ['ui_countdown', 'Compte à rebours', 'Régate et étapes', 'Zone non intrusive pendant le compte à rebours', false],
    ['ui_finish', 'Animation d’arrivée', 'Résultats et compétition', 'Zone de l’animation d’arrivée', false],
    ['ui_results', 'Résultats de course', 'Résultats et compétition', 'Zone dédiée aux résultats de la régate', false],
    ['ui_pause', 'Écran de pause', 'HUD et interfaces', 'Zone de l’écran de pause', false],
    ['stage_presentation', 'Présentation de l’étape', 'Régate et étapes', 'Présentation associée à l’identifiant de l’étape (E1, etc.)', false],
    ['stage_start', 'Départ de l’étape', 'Régate et étapes', 'Affichage sponsor associé au départ de l’étape', false],
    ['stage_route', 'Parcours et portes', 'Régate et étapes', 'Affichage sponsor associé au parcours de l’étape', false],
    ['stage_finish', 'Arrivée de l’étape', 'Régate et étapes', 'Affichage sponsor associé à l’arrivée de l’étape', false],
    ['stage_results', 'Résultats de l’étape', 'Résultats et compétition', 'Résultats rattachés à l’identifiant de l’étape', false],
  ].map(([id, name, category, description, connected]) => Object.freeze({ id, name, category, description, connected, available: true }));
  const placementById = new Map(placements.map((p) => [p.id, p]));

  const DEMO_SPONSORS = [
    { id: 'demo-player', name: 'L’Ordinaire · Big Mat', color: '#f4cf32', active: true, demo: 'player' },
    { id: 'demo-prudent', name: 'Banque Française Mutualiste', color: '#174f91', active: true, demo: 'prudent' },
    { id: 'demo-competitor', name: 'BRED', color: '#12539a', active: true, demo: 'competitor' },
    { id: 'demo-aggressive', name: 'Parions Sport', color: '#54c878', active: true, demo: 'aggressive' },
  ];
  const DEMO_ASSIGNMENTS = {
    sail_player: { sponsorId: 'demo-player', active: true },
    sail_prudent: { sponsorId: 'demo-prudent', active: true },
    sail_competitor: { sponsorId: 'demo-competitor', active: true },
    sail_aggressive: { sponsorId: 'demo-aggressive', active: true },
  };

  function emit(reason) {
    listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.warn('[TW] sponsor listener failed', e); } });
    mounts.forEach((mount) => renderMount(mount));
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function validId(id) { return typeof id === 'string' && ID_RE.test(id); }
  function validStageId(id) { return typeof id === 'string' && STAGE_ID_RE.test(id); }
  function findSponsor(id) { return state.sponsors.find((s) => s.id === id) || null; }
  function isStagePlacement(id) { return /^stage_/.test(id); }
  function assignmentKey(id, stageId) { return isStagePlacement(id) ? id + '@' + (validStageId(stageId) ? stageId : 'E1') : id; }
  function notifyState() { emit('change'); }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB indisponible dans ce navigateur.')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains('sponsors')) d.createObjectStore('sponsors', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('assignments')) d.createObjectStore('assignments', { keyPath: 'placementId' });
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Impossible d’ouvrir IndexedDB.'));
      request.onblocked = () => reject(new Error('La base IndexedDB est bloquée par un autre onglet.'));
    });
  }
  function allFrom(storeName) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Lecture IndexedDB impossible.'));
    });
  }
  function persistAll() {
    if (!db) return Promise.reject(new Error(error || 'IndexedDB indisponible; les changements ne peuvent pas être enregistrés.'));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sponsors', 'assignments', 'assets', 'meta'], 'readwrite');
      const sponsorStore = tx.objectStore('sponsors'), assignmentStore = tx.objectStore('assignments'), assetStore = tx.objectStore('assets'), metaStore = tx.objectStore('meta');
      sponsorStore.clear(); assignmentStore.clear();
      state.sponsors.forEach((s) => sponsorStore.put({ id: s.id, name: s.name, color: s.color || '', active: !!s.active, demo: s.demo || '' }));
      Object.keys(state.assignments).forEach((placementId) => {
        const a = state.assignments[placementId];
        if (placementById.has(placementId.split('@')[0]) && a && validId(a.sponsorId)) assignmentStore.put({ placementId, sponsorId: a.sponsorId, active: a.active !== false, stageId: a.stageId || 'E1' });
      });
      if (replaceAssets) assetStore.clear();
      deletedAssets.forEach((id) => assetStore.delete(id));
      pendingAssets.forEach((blob, id) => assetStore.put({ id, blob, type: blob.type || 'application/octet-stream' }));
      metaStore.put({ id: 'initialized', value: true });
      tx.oncomplete = () => { pendingAssets.clear(); deletedAssets.clear(); replaceAssets = false; storageAvailable = true; resolve(true); };
      tx.onerror = () => reject(tx.error || new Error('Écriture IndexedDB impossible.'));
      tx.onabort = () => reject(tx.error || new Error('Écriture IndexedDB annulée.'));
    });
  }
  function seedDemo() {
    state.sponsors = clone(DEMO_SPONSORS);
    state.assignments = clone(DEMO_ASSIGNMENTS);
  }

  function readMeta(id) {
    return new Promise((resolve, reject) => {
      try {
        const request = db.transaction('meta', 'readonly').objectStore('meta').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Lecture des préférences sponsoring impossible.'));
      } catch (e) { reject(e); }
    });
  }

  const ready = (async () => {
    try {
      db = await openDB();
      const [sponsors, assignments, initialized] = await Promise.all([allFrom('sponsors'), allFrom('assignments'), readMeta('initialized')]);
      if (sponsors.length) {
        state.sponsors = sponsors.filter((s) => s && validId(s.id) && typeof s.name === 'string').map((s) => ({ id: s.id, name: s.name.slice(0, 80), color: typeof s.color === 'string' ? s.color : '', active: s.active !== false, demo: s.demo || '' }));
        state.assignments = {};
        assignments.forEach((a) => { if (a && typeof a.placementId === 'string' && placementById.has(a.placementId.split('@')[0]) && validId(a.sponsorId)) state.assignments[a.placementId] = { sponsorId: a.sponsorId, active: a.active !== false, ...(isStagePlacement(a.placementId.split('@')[0]) ? { stageId: validStageId(a.stageId) ? a.stageId : 'E1' } : {}) }; });
      } else if (!initialized || initialized.value !== true) {
        seedDemo();
        await persistAll();
      }
      storageAvailable = true;
    } catch (e) {
      error = e && e.message ? e.message : 'IndexedDB indisponible.';
      seedDemo();
      console.warn('[TW] sponsoring: ' + error);
    }
    return true;
  })();

  function sponsorForPlacement(placementId, stageId) {
    const p = placementById.get(placementId), a = state.assignments[assignmentKey(placementId, stageId)];
    if (!p || !p.available || !a || a.active === false) return null;
    const s = findSponsor(a.sponsorId);
    return s && s.active ? s : null;
  }
  function getTransparentCanvas() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    canvas.dataset.twSailTransparent = '1';
    return canvas;
  }

  function getSailDemoCanvas(slot) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    canvas.dataset.twSailDemo = '1';
    const ctx = canvas.getContext('2d'); if (!ctx) return canvas;
    if (slot === 'sail_player') {
      ctx.fillStyle = '#f4cf32'; ctx.fillRect(40, 78, 432, 112); ctx.fillStyle = '#17663b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 46px Arial, sans-serif'; ctx.fillText("L'Ordinaire", 256, 134);
      ctx.fillStyle = '#30343a'; ctx.fillRect(40, 326, 432, 116); ctx.font = '900 76px Arial, sans-serif'; const w1 = ctx.measureText('Big').width, w2 = ctx.measureText('Mat').width; let x = 256 - (w1 + w2) / 2; ctx.textAlign = 'left'; ctx.fillStyle = '#e43d35'; ctx.fillText('Big', x, 384); x += w1; ctx.fillStyle = '#2877d1'; ctx.fillText('Mat', x, 384);
    } else if (slot === 'sail_prudent') {
      ctx.fillStyle = '#f4f3ed'; ctx.fillRect(0, 0, 512, 512); ctx.fillStyle = '#174f91'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 38px Arial, sans-serif'; ctx.fillText('Banque Française', 256, 236); ctx.font = '700 42px Arial, sans-serif'; ctx.fillText('Mutualiste', 256, 290);
    } else if (slot === 'sail_competitor') {
      ctx.fillStyle = '#f4f3ed'; ctx.fillRect(0, 0, 512, 512); ctx.fillStyle = '#12539a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 112px Arial, sans-serif'; ctx.fillText('BRED', 256, 256);
    } else {
      ctx.fillStyle = '#102747'; ctx.fillRect(0, 0, 512, 512); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 66px Arial, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('PARIONS', 256, 225); ctx.font = '900 78px Arial, sans-serif'; ctx.fillStyle = '#54c878'; ctx.fillText('SPORT', 256, 300);
    }
    return canvas;
  }
  function fetchAsset(sponsorId) {
    if (pendingAssets.has(sponsorId)) return Promise.resolve(pendingAssets.get(sponsorId));
    if (!db) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = db.transaction('assets', 'readonly').objectStore('assets').get(sponsorId);
        req.onsuccess = () => resolve(req.result && req.result.blob instanceof Blob ? req.result.blob : null);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function validateImageBlob(blob) {
    let image;
    try {
      image = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob), img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
        img.src = url;
      });
    } catch (e) { throw new Error('Le fichier ne contient pas une image lisible.'); }
    const w = image.width || image.naturalWidth, h = image.height || image.naturalHeight;
    if (!w || !h || w > MAX_LOGO_DIMENSION || h > MAX_LOGO_DIMENSION) { if (image.close) image.close(); throw new Error('Dimensions invalides (maximum 4096 × 4096 px).'); }
    if (image.close) image.close();
    return true;
  }
  async function imageForSponsor(sponsor) {
    if (!sponsor || sponsor.demo) return null;
    if (imageCache.has(sponsor.id)) return imageCache.get(sponsor.id);
    const blob = await fetchAsset(sponsor.id);
    if (!blob) return null;
    try {
      const image = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob), img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image invalide')); }; img.src = url;
      });
      imageCache.set(sponsor.id, image);
      return image;
    } catch (e) { return null; }
  }
  async function getSailImage(placementId) {
    await ready;
    const s = sponsorForPlacement(placementId);
    if (!s) return getTransparentCanvas();
    if (s.demo) return getSailDemoCanvas(placementId);
    return await imageForSponsor(s) || getTransparentCanvas();
  }
  async function getPlacementImage(placementId, stageId) {
    await ready;
    const s = sponsorForPlacement(placementId, stageId);
    if (!s) return null;
    return s.demo ? getSailDemoCanvas('sail_' + s.demo) : await imageForSponsor(s);
  }
  async function getLogoBlob(placementId, stageId) {
    await ready;
    const s = sponsorForPlacement(placementId, stageId);
    if (!s || s.demo) return null;
    return fetchAsset(s.id);
  }
  async function getSponsorPreview(sponsorId) {
    await ready;
    const s = findSponsor(sponsorId);
    if (!s) return null;
    if (s.demo) return { kind: 'canvas', source: getSailDemoCanvas('sail_' + s.demo) };
    const blob = await fetchAsset(s.id);
    return blob ? { kind: 'blob', source: blob } : null;
  }
  async function renderMount(mount) {
    const token = ++mount.token;
    if (!mount.node.isConnected) return;
    const placement = placementById.get(mount.placementId), sponsor = sponsorForPlacement(mount.placementId, mount.stageId);
    if (!placement || !placement.connected || !sponsor) {
      if (mount.url) URL.revokeObjectURL(mount.url); mount.url = null; mount.node.replaceChildren(); mount.node.hidden = true; return;
    }
    const preview = await getSponsorPreview(sponsor.id);
    if (token !== mount.token || !mount.node.isConnected) return;
    if (mount.url) URL.revokeObjectURL(mount.url); mount.url = null; mount.node.replaceChildren();
    if (!preview) { mount.node.hidden = true; return; }
    if (preview.kind === 'canvas') mount.node.appendChild(preview.source);
    else {
      mount.url = URL.createObjectURL(preview.source);
      const image = document.createElement('img'); image.alt = sponsor.name; image.src = mount.url; image.loading = 'lazy'; image.draggable = false; mount.node.appendChild(image);
    }
    mount.node.title = sponsor.name; mount.node.setAttribute('aria-label', sponsor.name); mount.node.hidden = false;
  }
  function mount(placementId, parent, className, stageId) {
    if (!placementById.has(placementId) || !parent || !parent.appendChild) return null;
    const node = document.createElement('span'); node.className = 'tw-sponsor-mark' + (className ? ' ' + String(className).replace(/[^a-zA-Z0-9 _-]/g, '') : ''); node.hidden = true;
    const record = { placementId, stageId: stageId || 'E1', node, token: 0, url: null }; mounts.add(record); parent.appendChild(node); ready.then(() => renderMount(record));
    return node;
  }
  function updateMountStage(node, stageId) { mounts.forEach((m) => { if (m.node === node) { m.stageId = validStageId(stageId) ? stageId : 'E1'; renderMount(m); } }); }

  const api = {
    ready,
    maxLogoBytes: MAX_LOGO_BYTES,
    get storageAvailable() { return storageAvailable; },
    get storageError() { return error; },
    getSponsors() { return clone(state.sponsors); },
    getPlacements(stageId) { return placements.map((p) => { const current = placementById.get(p.id) || p, assignment = api.getAssignment(p.id, stageId), sponsor = sponsorForPlacement(p.id, stageId); return { ...current, assignment: assignment ? { ...assignment } : null, sponsor: sponsor ? clone(sponsor) : null }; }); },
    getPlacement(id, stageId) { const p = placementById.get(id); return p ? { ...p, assignment: api.getAssignment(id, stageId) ? { ...api.getAssignment(id, stageId) } : null, sponsor: sponsorForPlacement(id, stageId) ? clone(sponsorForPlacement(id, stageId)) : null } : null; },
    getAssignment(id, stageId) { const a = state.assignments[assignmentKey(id, stageId)]; return a ? { ...a } : null; },
    getSponsor(id) { const s = findSponsor(id); return s ? clone(s) : null; },
    snapshot() { return { sponsors: clone(state.sponsors), assignments: clone(state.assignments) }; },
    onChange(fn) { if (typeof fn !== 'function') return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    getSailImage,
    getPlacementImage,
    getSailFallback(placementId) { return getTransparentCanvas(); },
    mount,
    updateMountStage,
    async getLogoBlob(placementId, stageId) { return getLogoBlob(placementId, stageId); },
    async getSponsorPreview(id) { return getSponsorPreview(id); },
    setConnected(id, connected) { if (!placementById.has(id)) return false; placementById.set(id, Object.freeze({ ...placementById.get(id), connected: !!connected })); notifyState(); return true; },
    createSponsor(name) {
      const safeName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!safeName) throw new Error('Saisissez un nom de sponsor.');
      const base = safeName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'sponsor';
      let id = base, n = 2; while (findSponsor(id)) id = base + '-' + n++;
      const s = { id, name: safeName, color: '', active: true, demo: '' }; state.sponsors.push(s); notifyState(); return clone(s);
    },
    updateSponsor(id, patch) {
      const s = findSponsor(id); if (!s) throw new Error('Sponsor introuvable.');
      if (patch.name !== undefined) { const name = String(patch.name).trim().replace(/\s+/g, ' ').slice(0, 80); if (!name) throw new Error('Le nom ne peut pas être vide.'); s.name = name; }
      if (patch.active !== undefined) s.active = !!patch.active;
      if (patch.color !== undefined) s.color = /^#[0-9a-f]{6}$/i.test(String(patch.color)) ? String(patch.color) : '';
      notifyState(); return clone(s);
    },
    async importLogo(id, file) {
      const s = findSponsor(id); if (!s) throw new Error('Sponsor introuvable.');
      if (!(file instanceof Blob) || !TYPE_RE.test(file.type)) throw new Error('Formats acceptés : PNG, JPEG et WebP.');
      if (file.size <= 0 || file.size > MAX_LOGO_BYTES) throw new Error('Le logo doit peser au maximum 4 Mo.');
      await validateImageBlob(file);
      pendingAssets.set(id, file.slice(0, file.size, file.type));
      const oldImage = imageCache.get(id); if (oldImage && oldImage.close) oldImage.close(); imageCache.delete(id);
      deletedAssets.delete(id); s.demo = ''; notifyState(); return true;
    },
    assign(placementId, sponsorId, active, stageId) {
      if (!placementById.has(placementId)) throw new Error('Emplacement inconnu.');
      if (sponsorId && !findSponsor(sponsorId)) throw new Error('Sponsor inconnu.');
      const key = assignmentKey(placementId, stageId);
      if (sponsorId) state.assignments[key] = { sponsorId, active: active !== false, ...(isStagePlacement(placementId) ? { stageId: validStageId(stageId) ? stageId : 'E1' } : {}) };
      else delete state.assignments[key];
      notifyState(); return true;
    },
    toggleAssignment(placementId, active, stageId) { const a = state.assignments[assignmentKey(placementId, stageId)]; if (!a || !placementById.has(placementId)) return false; a.active = !!active; notifyState(); return true; },
    deleteSponsor(id) {
      if (!findSponsor(id)) return false;
      state.sponsors = state.sponsors.filter((s) => s.id !== id);
      Object.keys(state.assignments).forEach((key) => { if (state.assignments[key].sponsorId === id) delete state.assignments[key]; });
      pendingAssets.delete(id); deletedAssets.add(id); const oldImage = imageCache.get(id); if (oldImage && oldImage.close) oldImage.close(); imageCache.delete(id); notifyState(); return true;
    },
    restore(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.sponsors) || !snapshot.assignments) throw new Error('Sauvegarde temporaire invalide.');
      state.sponsors = clone(snapshot.sponsors); state.assignments = clone(snapshot.assignments); pendingAssets.clear(); replaceAssets = false;
      snapshot.sponsors.forEach((s) => deletedAssets.delete(s.id)); imageCache.forEach((image) => { if (image && image.close) image.close(); }); imageCache.clear(); notifyState();
    },
    resetDemo() {
      const demos = new Map(DEMO_SPONSORS.map((s) => [s.id, s]));
      state.sponsors.forEach((s) => { if (demos.has(s.id)) Object.assign(s, clone(demos.get(s.id))); });
      DEMO_SPONSORS.forEach((s) => { if (!findSponsor(s.id)) state.sponsors.unshift(clone(s)); });
      state.assignments = clone(DEMO_ASSIGNMENTS); pendingAssets.clear(); imageCache.clear(); notifyState();
    },
    async save() { await persistAll(); notifyState(); return true; },
    async exportData() {
      await ready;
      const out = { format: 'traditour-sponsors-v1', sponsors: clone(state.sponsors), assignments: clone(state.assignments), logos: {} };
      for (const s of state.sponsors) { const blob = await fetchAsset(s.id); if (!blob) continue; out.logos[s.id] = { type: blob.type, data: await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(r.error); r.readAsDataURL(blob); }) }; }
      return JSON.stringify(out, null, 2);
    },
    async importData(text) {
      let doc; try { doc = JSON.parse(text); } catch (e) { throw new Error('Le fichier JSON est illisible.'); }
      if (!doc || doc.format !== 'traditour-sponsors-v1' || !Array.isArray(doc.sponsors) || !doc.assignments || typeof doc.assignments !== 'object') throw new Error('Format de sauvegarde sponsoring non reconnu.');
      const ids = new Set();
      const sponsors = doc.sponsors.map((s) => {
        if (!s || !validId(s.id) || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim()) throw new Error('Fiche sponsor invalide ou identifiant en double.');
        ids.add(s.id); return { id: s.id, name: s.name.trim().slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '', active: s.active !== false, demo: s.demo || '' };
      });
      const assignments = {};
      Object.keys(doc.assignments).forEach((key) => { const a = doc.assignments[key], slot = key.split('@')[0], stageId = a && validStageId(a.stageId) ? a.stageId : 'E1'; if (!placementById.has(slot) || !a || !ids.has(a.sponsorId) || (key.includes('@') && !isStagePlacement(slot))) throw new Error('Affectation invalide : ' + key); const normalizedKey = assignmentKey(slot, stageId); assignments[normalizedKey] = { sponsorId: a.sponsorId, active: a.active !== false, ...(isStagePlacement(slot) ? { stageId } : {}) }; });
      const old = api.snapshot();
      state.sponsors = sponsors; state.assignments = assignments; pendingAssets.clear(); deletedAssets.clear(); replaceAssets = true; imageCache.forEach((image) => { if (image && image.close) image.close(); }); imageCache.clear();
      try {
        const logos = doc.logos || {};
        for (const id of Object.keys(logos)) {
          if (!ids.has(id)) continue;
          const entry = logos[id]; if (!entry || !TYPE_RE.test(entry.type)) throw new Error('Type de logo interdit dans la sauvegarde.');
          const binary = atob(String(entry.data || '')); if (binary.length > MAX_LOGO_BYTES) throw new Error('Un logo dépasse la limite de 4 Mo.');
          const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: entry.type }); await validateImageBlob(blob); pendingAssets.set(id, blob);
        }
      } catch (e) { state.sponsors = old.sponsors; state.assignments = old.assignments; pendingAssets.clear(); replaceAssets = false; throw e; }
      notifyState(); return true;
    },
  };
  const markStyle = document.createElement('style');
  markStyle.setAttribute('data-tw-sponsors', '');
  markStyle.textContent = '.tw-sponsor-mark[hidden]{display:none!important}.tw-sponsor-mark{display:inline-flex;align-items:center;justify-content:center;overflow:hidden;vertical-align:middle}.tw-sponsor-mark img,.tw-sponsor-mark canvas{display:block;max-width:100%;max-height:100%;object-fit:contain}';
  document.head.appendChild(markStyle);
  TW.sponsors = api;
})();
