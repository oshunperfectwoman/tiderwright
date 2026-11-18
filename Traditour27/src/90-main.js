// ===== 90-main.js =====
// ============================================================================
// TIDEWRIGHT — 90-main.js
// Boot, frame loop, module orchestration, dynamic resolution, debug overrides.
// OWNER: lead. Other modules must not edit this file.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;
  const S = TW.state;
  TW.stats = { fps: 0, frameMs: 0, scale: 1, frames: 0, errors: 0, renderer: '', stubbed: TW.stubbed || [] };
  TW.quality = { level: 1, scale: 1, auto: true, dprCap: 2 }; // level: 0 low, 1 medium, 2 high (modules may read it)

  const errCount = Object.create(null);
  let lost = false;
  // Run fn; a module that keeps throwing is muted after a few errors so one bug cannot take the whole frame down.
  function safe(tag, fn, arg) {
    if (!fn) return;
    if (errCount[tag] > 4 && (S.frame & 127) !== 0) return; // muted: retry every ~2 s
    try { const r = fn(arg); if (errCount[tag]) errCount[tag] = 0; return r; } catch (e) {
      errCount[tag] = (errCount[tag] || 0) + 1; TW.stats.errors++;
      console.error('[TW] ' + tag + ' threw' + (errCount[tag] > 4 ? ' (muting further calls)' : '') + ':', e && e.stack ? e.stack : e);
    }
  }
  TW.safe = safe;

  const RENDER = ['sky', 'world', 'boat', 'ocean', 'fx'];
  const UPDATE = ['game', 'multiplayer', 'regatta', 'world', 'ocean', 'sky', 'boat', 'fx', 'audio', 'ui'];
  const INIT = ['post', 'sky', 'world', 'ocean', 'boat', 'fx', 'audio', 'game', 'multiplayer', 'regatta', 'ui'];

  function boot() {
    const root = document.getElementById('tw-root');
    const canvas = document.getElementById('tw-canvas');
    const gl = TW.initGL(canvas);
    const loading = document.getElementById('tw-loading');
    if (loading && ['only', 'without', 'autostart', 'uidemo', 'noveil', 'cam'].some((k) => TW.q.has(k))) loading.hidden = true; // dev/test runs: no veil
    if (!gl) {
      const m = document.getElementById('tw-nogl');
      if (m) m.hidden = false;
      if (loading) loading.hidden = true;
      return;
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); lost = true;
      safe('game.pause', TW.game && TW.game.pause && TW.game.pause.bind(TW.game));
      const m = document.getElementById('tw-nogl');
      if (m) { m.textContent = 'Lanmè-la vin nwè: navigatè-la viré pran kontwòl grafik-la. Wouvè paj-la ankò pou navigé.'; m.style.background = 'var(--tw-ink)'; m.style.zIndex = '60'; m.hidden = false; }
    });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    TW.stats.renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    const software = /swiftshader|llvmpipe|software/i.test(TW.stats.renderer);
    const coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    TW.isTouch = coarse;
    TW.quality.level = TW.qf('q', coarse ? 0 : 1) | 0;
    TW.quality.dprCap = coarse ? 1.5 : 2;
    if (TW.q.has('scale')) { TW.quality.scale = TW.qf('scale', 1); TW.quality.auto = false; }
    else if (software) { TW.quality.scale = 1; TW.quality.auto = false; }
    else TW.quality.scale = coarse ? 0.7 : 0.85;

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND);
    TW.env.init();
    if (TW.world && TW.world.drawGlows) TW.world.deferGlows = true;
    INIT.forEach((n) => safe(n + '.init', TW[n] && TW[n].init && TW[n].init.bind(TW[n])));

    let cw = 0, ch = 0, lastScale = 0;
    function resize() {
      const cssW = Math.max(1, root.clientWidth), cssH = Math.max(1, root.clientHeight);
      // the composite pass runs at canvas resolution: budget the canvas itself (~2.6 MP desktop, 2 MP touch)
      const dpr = Math.min(window.devicePixelRatio || 1, TW.quality.dprCap, Math.sqrt((TW.isTouch ? 2.0e6 : 2.6e6) / (cssW * cssH))) * (TW.quality.canvasK || 1);
      const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
      if (w !== cw || h !== ch || lastScale !== TW.quality.scale) {
        cw = w; ch = h; lastScale = TW.quality.scale;
        canvas.width = w; canvas.height = h;
        safe('post.resize', () => TW.post.resize(w, h, TW.quality.scale));
        TW.stats.scale = TW.quality.scale;
        TW.emit('resize', { w, h, scale: TW.quality.scale });
      }
    }
    TW.requestResize = resize;
    window.addEventListener('resize', resize);
    resize();

    // ---- debug: warp the simulation forward without rendering -----------------
    const fixdt = TW.qf('fixdt', 0);
    const warp = TW.qf('warp', 0);
    if (TW.q.has('autostart')) safe('game.start', TW.game.start && TW.game.start.bind(TW.game));
    if (warp > 0) {
      const step = 1 / 30;
      for (let t = 0; t < warp; t += step) { S.dt = step; S.time += step; safe('game.update', TW.game.update.bind(TW.game), step); safe('fx.update', TW.fx.update && TW.fx.update.bind(TW.fx), step); }
    }

    // #probe in the page address: mute, and show a small readout (fps, resolution scale, quality tier, GPU) for checking real devices
    let probe = null;
    if (/probe/i.test(String(location.hash || ''))) {
      probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:70;pointer-events:none;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#e9efe6;background:rgba(10,17,24,.72);padding:6px 10px;border-radius:4px;white-space:pre;text-align:center;max-width:94%;overflow:hidden';
      probe.textContent = 'measuring…';
      root.appendChild(probe);
      safe('audio.setMuted', () => TW.audio.setMuted && TW.audio.setMuted(true));
    }
    let last = performance.now(), acc = 0, accN = 0, slow = 0, fast = 0, cap = 1, capHold = 180, capped = false, capRef = null;
    const floorScale = TW.isTouch ? 0.55 : 0.45;
    function frame(now) {
      requestAnimationFrame(frame);
      if (lost) { last = now; return; }
      let rdt = (now - last) / 1000; last = now;
      if (!(rdt > 0)) rdt = 1 / 60;
      const dt = fixdt > 0 ? fixdt : Math.min(rdt, 0.05);
      resize();
      S.dt = dt; S.frame++;
      if (S.phase !== 'paused') S.time += dt;
      if (TW.q.has('time')) S.time = TW.qf('time', 0) + (TW.q.has('freeze') ? 0 : S.frame * 0.0001);

      for (let i = 0; i < UPDATE.length; i++) { const m = TW[UPDATE[i]]; if (m && m.update) safe(UPDATE[i] + '.update', m.update.bind(m), dt); }
      debugOverrides();
      // Warm-up: for the first two frames (still behind the loading veil) force every effect on once, so drivers that
      // compile shaders lazily do it now and not at the first lightning bolt, the first lit beacon or the dawn.
      let warm = null;
      if (TW.stats.frames < 2 && !TW.q.has('nowarm')) {
        warm = { flash: S.flash, dawn: S.dawn, daylight: S.daylight, rain: S.rain, vortex: S.vortexStrength, lit: S.beacons.map((b) => b.lit), prog: S.beacons.map((b) => b.progress) };
        S.flash = 1; S.dawn = 0.5; S.rain = 1; S.vortexStrength = 1;
        S.beacons.forEach((b) => { b.lit = 1; b.progress = 0.5; });
        if (TW.stats.frames === 0) safe('fx.bolt', () => TW.fx.bolt && TW.fx.bolt(S.cam.pos[0] * 2 - S.cam.target[0] + (S.cam.pos[0] - S.cam.target[0]) * 40, 0, S.cam.pos[2] * 2 - S.cam.target[2] + (S.cam.pos[2] - S.cam.target[2]) * 40, 7));   // behind the camera: compiled, never seen
        if (TW.stats.frames === 0) safe('fx.emit', () => TW.fx.emit && TW.fx.emit('spray', S.cam.target[0], -40, S.cam.target[2])   /* under the sea: compiled, never seen */);
      }
      safe('env.update', TW.env.update);

      safe('post.begin', TW.post.begin.bind(TW.post));
      for (let i = 0; i < RENDER.length; i++) {
        const m = TW[RENDER[i]];
        if (m && m.draw) safe(RENDER[i] + '.draw', m.draw.bind(m));
        // beacon beams / flares are additive and must composite over the sea
        if (RENDER[i] === 'ocean' && TW.world.drawGlows) safe('world.drawGlows', TW.world.drawGlows.bind(TW.world));
        // restore the agreed default GL state between modules
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.colorMask(true, true, true, true); gl.blendEquation(gl.FUNC_ADD); gl.activeTexture(gl.TEXTURE0);
        if (TW.post.scene) TW.post.scene.bind();
      }
      safe('post.end', TW.post.end.bind(TW.post));
      if (warm) {
        S.flash = warm.flash; S.dawn = warm.dawn; S.daylight = warm.daylight; S.rain = warm.rain; S.vortexStrength = warm.vortex;
        S.beacons.forEach((b, i) => { b.lit = warm.lit[i]; b.progress = warm.prog[i]; });
      }

      // ---- stats + dynamic resolution ----
      TW.stats.frames++;
      if (TW.stats.frames === 3 && loading) { loading.classList.add('tw-done'); setTimeout(() => { loading.hidden = true; }, 1000); }
      if (rdt > 0.25) { acc = 0; accN = 0; slow = 0; } else { acc += rdt; accN++; }   // hidden tab / one-off compile hitch: not a sample
      if (accN >= 20) {
        const ms = (acc / accN) * 1000; acc = 0; accN = 0;
        TW.stats.frameMs = Math.round(ms * 10) / 10; TW.stats.fps = Math.round(1000 / ms);
        if (probe) probe.textContent = TW.stats.fps + ' fps  ' + TW.stats.frameMs + ' ms   scale ' + TW.quality.scale.toFixed(2) + '   tier ' + TW.quality.level + (capped ? '   (frame-capped)' : '') + '   canvas ' + canvas.width + 'x' + canvas.height + '\n' + TW.stats.renderer.slice(0, 90) + (TW.caps.floatRT ? '' : '  [no float targets]') + (TW.stats.errors ? '   errors ' + TW.stats.errors : '') + (TW.shaderErrors ? '\nshader errors: ' + TW.shaderErrorNames.slice(0, 6).join(', ') : '');
        if (TW.quality.auto && S.frame > 90 && S.phase !== 'title' && document.visibilityState !== 'hidden') {
          if (ms > (TW.isTouch ? 23 : 20.5)) { slow++; fast = 0; } else if (ms < 17.2) { fast++; slow = 0; capRef = null; } else { slow = 0; fast = 0; }
          if (slow >= 2 && capped) { slow = 0; if (ms > 43) { capped = false; capRef = null; } }   // browser frame cap (~30 fps), not the GPU: leave resolution alone unless it gets clearly worse
          else if (slow >= 2 && capRef && (capRef.ms > 30 ? capRef.n >= (TW.isTouch ? 2 : 3) : TW.quality.scale <= floorScale) && Math.abs(ms - capRef.ms) < 2.5) {
            // three resolution drops bought no time at all: rAF is being capped near 30 fps (Safari in an iframe, low-power mode). Put the picture back.
            TW.quality.scale = capRef.scale; cap = 1; capped = true; slow = 0;
          }
          else if (slow >= 2 && TW.quality.scale > floorScale) {
            if (!capRef && ms < 36.5) capRef = { scale: TW.quality.scale, ms: ms, n: 0 };
            if (capRef) capRef.n++;
            cap = Math.max(floorScale, TW.quality.scale - 0.05); capHold = 180; TW.quality.scale = Math.max(floorScale, TW.quality.scale - 0.1); slow = 0;
          }
          else if (slow >= 2 && TW.quality.level > 0) { TW.quality.level = 0; if (TW.ocean && TW.ocean.setShaderQuality) TW.ocean.setShaderQuality(0); slow = 0; cap = 1; capHold = 180; }   // at the floor and still slow: phone-grade post + ocean
          else if (slow >= 2 && ms > 36.5 && (TW.quality.canvasK || 1) > 0.75) { TW.quality.canvasK = (TW.quality.canvasK || 1) - 0.14; slow = 0; }   // last resort: a smaller canvas (the composite pass is per canvas pixel)
          else if (fast >= 6 && TW.quality.scale < Math.min(1, cap)) { TW.quality.scale = Math.min(1, cap, TW.quality.scale + 0.05); fast = 0; }
          else if (fast >= 6 && cap < 1 && --capHold <= 0) { cap = Math.min(1, cap + 0.05); capHold = 180; }   // probe above the last known-bad scale only about once a minute
        }
      }
    }
    requestAnimationFrame(frame);
  }

  // Optional query-string overrides for look-dev and screenshots (harmless in production).
  function debugOverrides() {
    const q = TW.q;
    if (q.has('storm')) S.storm = TW.qf('storm', S.storm);
    if (q.has('rain')) S.rain = TW.qf('rain', S.rain);
    if (q.has('dawn')) S.dawn = TW.qf('dawn', S.dawn);
    if (q.has('flash')) S.flash = TW.qf('flash', S.flash);
    if (q.has('vortex')) S.vortexStrength = TW.qf('vortex', S.vortexStrength);
    if (S.heart) { if (q.has('hearthush')) S.heart.hush = TW.qf('hearthush', 0); if (q.has('heartt')) S.heart.t = TW.qf('heartt', -1) + (q.has('freeze') ? 0 : 0); }
    if (q.has('oil')) S.lantern.oil = TW.qf('oil', 1);
    if (q.has('lit')) { const n = TW.qf('lit', 0); S.beacons.forEach((b, i) => { if (i < n) { b.lit = 1; b.kindled = true; } }); }
    if (q.has('boat')) { const a = q.get('boat').split(',').map(Number); S.boat.x = a[0]; S.boat.z = a[1]; if (a.length > 2) S.boat.heading = a[2]; }
    if (q.has('cam')) { // cam=px,py,pz,tx,ty,tz[,fov]
      const a = q.get('cam').split(',').map(Number);
      if (a.length >= 6) { S.cam.pos = [a[0], a[1], a[2]]; S.cam.target = [a[3], a[4], a[5]]; if (a[6]) S.cam.fov = a[6]; }
    }
  }

  // Let the loading veil paint once before the (blocking) world generation + shader compiles.
  const go = () => requestAnimationFrame(() => setTimeout(boot, 20));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
