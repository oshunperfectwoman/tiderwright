// ===== 60-audio.js =====
// ============================================================================
// TIDEWRIGHT — 60-audio.js
// Procedural storm soundscape + adaptive score ("The Tidewright's Air", D Dorian -> D major, 6/8).
// Everything is synthesised with the Web Audio API: no samples, no worklets, no ScriptProcessor.
// OWNER: agent AUDIO.
//
// Signal flow:   wind / sea / rain / maw ─► amb ─┐
//                one-shots (thunder, boat…) ─► sfx ─┼─► 28 Hz HP ─► compressor ─► trim ─► muffle LP ─► dim ─► soft clip ─► master ─► out
//                score voices ─► musIn ─► LP ─► duck ─► mus ─┘                (reverb: sends ─► convolver ─► back into the mix)
// The whole graph lives in Engine(ctx) so the very same code can be rendered by an OfflineAudioContext
// (TW.audio.selfTest) and measured, since nobody can listen to it during development.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;
  const clamp = TW.clamp, lerp = TW.lerp, sat = TW.saturate, sstep = TW.smoothstep, damp = TW.damp;
  const TAU = Math.PI * 2;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------------------------------------------------------------------------
  // SCORE DATA — "The Tidewright's Air"
  // Chords: b = cello bass note, b2 = its answering note, r/t = harp ladder root + third (or lad = explicit ladder),
  // pad = four-voice string voicing (voice-led by hand).
  // ---------------------------------------------------------------------------
  const CH = {
    Dm: { b: 38, b2: 45, r: 50, t: 3, pad: [50, 57, 62, 65] },
    C: { b: 36, b2: 43, r: 48, t: 4, pad: [48, 55, 60, 64] },
    Am: { b: 45, b2: 40, r: 45, t: 3, pad: [45, 57, 60, 64] },
    Bb: { b: 46, b2: 41, r: 46, t: 4, pad: [46, 53, 62, 65], flat6: 1 },
    F: { b: 41, b2: 48, r: 41, t: 4, pad: [53, 57, 60, 65] },
    G: { b: 43, b2: 50, r: 43, t: 4, pad: [55, 59, 62, 67] },
    As: { b: 45, b2: 40, r: 45, t: 5, pad: [45, 57, 62, 64] },                       // Asus4
    D: { b: 38, b2: 45, r: 50, t: 4, pad: [50, 57, 62, 66] },
    A: { b: 45, b2: 40, r: 45, t: 4, pad: [45, 57, 61, 64] },
    Bm: { b: 47, b2: 42, r: 47, t: 3, pad: [47, 54, 59, 62] },
    Df: { b: 42, b2: 45, lad: [54, 57, 62, 66, 69, 74, 78, 81], pad: [54, 57, 62, 66] },   // D/F#
    ED: { b: 38, b2: 47, lad: [50, 56, 59, 64, 68, 71, 76, 80], pad: [50, 56, 59, 64], lyd: 1 }, // E/D — the Lydian light
    Em: { b: 40, b2: 47, r: 52, t: 3, pad: [52, 55, 59, 62] },
  };
  // Melodies: one array per bar of [startEighth, lengthEighths, midi]. 6 eighths to the bar.
  const AIR_A = [
    [[0, 2, 74], [2, 1, 76], [3, 2, 77], [5, 1, 76]],
    [[0, 3, 76], [3, 2, 72], [5, 1, 74]],
    [[0, 2, 76], [2, 1, 72], [3, 2, 71], [5, 1, 69]],
    [[0, 5, 74]],
    [[0, 2, 77], [2, 1, 79], [3, 2, 77], [5, 1, 74]],
    [[0, 3, 81], [3, 2, 77], [5, 1, 72]],
    [[0, 2, 76], [2, 1, 74], [3, 2, 72], [5, 1, 76]],
    [[0, 6, 74]],
  ];
  const CTR_A = [
    [[0, 3, 65], [3, 3, 69]],
    [[0, 3, 67], [3, 3, 64]],
    [[0, 3, 64], [3, 3, 67]],
    [[0, 2, 65], [2, 1, 69], [3, 2, 65], [5, 1, 64]],
    [[0, 3, 62], [3, 3, 70]],
    [[0, 3, 72], [3, 3, 69]],
    [[0, 3, 67], [3, 2, 67], [5, 1, 64]],
    [[0, 2, 65], [2, 1, 64], [3, 3, 62]],
  ];
  const AIR_B = [
    [[0, 2, 72], [2, 1, 77], [3, 3, 81]],
    [[0, 2, 79], [2, 1, 76], [3, 2, 79], [5, 1, 76]],
    [[0, 2, 74], [2, 1, 71], [3, 2, 74], [5, 1, 79]],
    [[0, 3, 77], [3, 3, 74]],
    [[0, 2, 77], [2, 1, 74], [3, 3, 70]],
    [[0, 2, 72], [2, 1, 76], [3, 3, 79]],
    [[0, 3, 81], [3, 1, 79], [4, 1, 76], [5, 1, 72]],
    [[0, 3, 74], [3, 3, 76]],
  ];
  const CTR_B = [
    [[0, 3, 69], [3, 3, 72]],
    [[0, 3, 72], [3, 3, 67]],
    [[0, 3, 71], [3, 3, 67]],
    [[0, 2, 69], [2, 1, 67], [3, 3, 65]],
    [[0, 3, 70], [3, 3, 65]],
    [[0, 3, 64], [3, 3, 67]],
    [[0, 3, 72], [3, 3, 64]],
    [[0, 6, 69]],
  ];
  // The air transfigured into D major for the dawn.
  const AIR_MA = [
    [[0, 2, 74], [2, 1, 76], [3, 2, 78], [5, 1, 76]],
    [[0, 3, 76], [3, 2, 73], [5, 1, 74]],
    [[0, 2, 78], [2, 1, 74], [3, 2, 71], [5, 1, 74]],
    [[0, 5, 74]],
    [[0, 2, 79], [2, 1, 81], [3, 2, 79], [5, 1, 74]],
    [[0, 3, 81], [3, 2, 78], [5, 1, 74]],
    [[0, 2, 76], [2, 1, 74], [3, 2, 73], [5, 1, 76]],
    [[0, 6, 74]],
  ];
  const CTR_MA = [
    [[0, 3, 66], [3, 3, 69]],
    [[0, 3, 69], [3, 3, 64]],
    [[0, 3, 62], [3, 3, 66]],
    [[0, 2, 66], [2, 1, 69], [3, 2, 66], [5, 1, 64]],
    [[0, 3, 71], [3, 3, 67]],
    [[0, 3, 69], [3, 3, 66]],
    [[0, 3, 69], [3, 2, 67], [5, 1, 64]],
    [[0, 2, 66], [2, 1, 64], [3, 3, 62]],
  ];
  const AIR_MB = [
    [[0, 2, 71], [2, 1, 74], [3, 3, 79]],
    [[0, 2, 78], [2, 1, 74], [3, 2, 78], [5, 1, 81]],
    [[0, 3, 81], [3, 2, 76], [5, 1, 73]],
    [[0, 3, 74], [3, 3, 71]],
    [[0, 2, 74], [2, 1, 79], [3, 3, 83]],
    [[0, 3, 81], [3, 2, 78], [5, 1, 74]],
    [[0, 2, 76], [2, 1, 79], [3, 2, 78], [5, 1, 76]],
    [[0, 4, 76], [4, 2, 73]],
  ];
  const AIR_CODA = [
    [[0, 3, 78], [3, 3, 81]],
    [[0, 3, 80], [3, 3, 76]],
    [[0, 6, 78]],
    [],
    [[0, 2, 74], [2, 1, 76], [3, 3, 78]],
    [[0, 2, 80], [2, 1, 78], [3, 3, 76]],
    [[0, 3, 74], [3, 3, 76]],
    [[0, 6, 74]],
  ];
  const SEC = {
    I: { ch: ['Dm', 'Dm'] },
    A: { ch: ['Dm', 'C', 'Am', 'Dm', 'Bb', 'F', 'C', 'Dm'], mel: AIR_A, ctr: CTR_A },
    B: { ch: ['F', 'C', 'G', 'Dm', 'Bb', 'C', 'Am', 'As'], mel: AIR_B, ctr: CTR_B },
    MA: { ch: ['D', 'A', 'Bm', 'D', 'G', 'Df', 'A', 'D'], mel: AIR_MA, ctr: CTR_MA, major: 1 },
    MB: { ch: ['G', 'D', 'A', 'Bm', 'G', 'Df', 'Em', 'A'], mel: AIR_MB, major: 1 },
    CO: { ch: ['D', 'ED', 'D', 'G', 'D', 'ED', 'As', 'D'], mel: AIR_CODA, major: 1 },
  };
  const FORMS = {
    title: { seq: [{ s: 'I' }, { s: 'A', mel: 1 }, { s: 'B', mel: 1, low: 1 }], loop: 1 },
    sail: { seq: [{ s: 'A', mel: 1 }, { s: 'A', mel: 1, vary: 1 }, { s: 'B', mel: 1 }, { s: 'A', mel: 1, vary: 1, ctr: 1 }], loop: 0 },
    ending: { seq: [{ s: 'MA', mel: 1, tri: 1 }, { s: 'MB', mel: 1, tri: 1 }, { s: 'MA', mel: 1, tri: 1, vary: 1, ctr: 1 }], next: 'coda' },
    coda: { seq: [{ s: 'CO', mel: 1 }, { s: 'CO' }], loop: 0 },
  };
  const HARP_PATS = [[0, 2, 3, 4, 3, 2], [0, 1, 2, 3, 2, 1], [0, 2, 4, 3, 5, 4], [0, 3, 2, 4, 3, 5], [0, 2, 3, 5, 4, 3]];
  // Bodhrán: + = low down-stroke, − = light up-stroke, per eighth.
  const DRUMS = {
    lilt: [1, 0, -0.35, 0.7, 0, -0.4],
    jig: [1, -0.25, -0.45, 0.75, -0.25, -0.5],
    urge: [1, -0.4, -0.5, 0.85, -0.4, 0.6],
    fill: [1, -0.4, -0.5, 0.8, -0.6, -0.7],
  };
  const ARCH = [0.5, 0.6, 0.7, 0.6, 0.8, 1, 0.8, 0.6];
  const PCS_MIN = [2, 4, 5, 7, 9, 11, 0], PCS_FLAT6 = [2, 4, 5, 7, 9, 10, 0], PCS_MAJ = [2, 4, 6, 7, 9, 11, 1], PCS_LYD = [2, 4, 6, 8, 9, 11, 1];
  const ladderOf = (c) => c.lad || [c.r, c.r + 7, c.r + 12, c.r + 12 + c.t, c.r + 19, c.r + 24, c.r + 24 + c.t, c.r + 31];
  const pcsOf = (c, major) => (major ? (c.lyd ? PCS_LYD : PCS_MAJ) : (c.flat6 ? PCS_FLAT6 : PCS_MIN));
  const inScale = (m, pcs) => pcs.indexOf(((m % 12) + 12) % 12) >= 0;
  function scaleStep(m, dir, pcs) { let x = m + dir; for (let i = 0; i < 4; i++, x += dir) if (inScale(x, pcs)) return x; return m + 2 * dir; }
  function passing(a, b, pcs) { if (Math.abs(a - b) < 2) return null; const dir = b > a ? 1 : -1; let best = null; for (let x = a + dir; x !== b; x += dir) if (inScale(x, pcs)) best = x; return best; }

  // Group levels (the mix), tuned from offline renders.
  const LV = { wind: 1.0, sea: 1.0, rain: 1.0, pad: 0.45, harp: 2.8, mel: 2.2, bass: 0.65, drum: 1.4, choir: 1.3, bell: 0.8 };
  const TAPS = ['amb', 'sfx', 'mus', 'rev', 'wind', 'sea', 'rain', 'pad', 'harp', 'mel', 'bass', 'drum', 'choir', 'bell'];

  // ===========================================================================
  // ENGINE
  // ===========================================================================
  function Engine(ctx, opt) {
    opt = opt || {};
    const sr = ctx.sampleRate;
    const rnd = TW.rng(((TW.seed | 0) ^ 0x5eaf00d) >>> 0);
    const rr = (a, b) => a + (b - a) * rnd();
    const lowQ = TW.quality && TW.quality.level === 0;
    let nodeCount = 0, shots = 0, live = 0, noteCount = 0;

    // ---- node helpers -------------------------------------------------------
    const G = (v) => { const g = ctx.createGain(); g.gain.value = v; nodeCount++; return g; };
    const BQ = (type, f, q, db) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; if (db !== undefined) b.gain.value = db; nodeCount++; return b; };
    const hasPan = !!ctx.createStereoPanner;
    const PAN = (p) => { nodeCount++; if (hasPan) { const n = ctx.createStereoPanner(); n.pan.value = p; return n; } return ctx.createGain(); };
    const OSC = (type, f, det) => { const o = ctx.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; if (det) o.detune.value = det; nodeCount++; return o; };
    const chain = function () { for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; };
    const wave = (amps) => { const n = amps.length + 1, re = new Float32Array(n), im = new Float32Array(n); for (let i = 0; i < amps.length; i++) im[i + 1] = amps[i]; return ctx.createPeriodicWave(re, im); };

    // ---- buffer synthesis ---------------------------------------------------
    function toBuffer(chans) { const b = ctx.createBuffer(chans.length, chans[0].length, sr); for (let c = 0; c < chans.length; c++) b.getChannelData(c).set(chans[c]); return b; }
    function normPeak(d, peak) { let m = 1e-9; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; return d; }
    function fadeTail(d, frac) { const n = d.length, f = Math.max(8, Math.floor(n * frac)); for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f; return d; }
    // Seamlessly looping noise, DC-free, RMS 0.25.
    function genNoise(kind, secs, seed) {
      const n = Math.floor(sr * secs), fade = Math.floor(sr * 0.3), tot = n + fade, d = new Float32Array(tot), r = TW.rng(seed);
      if (kind === 'white') { for (let i = 0; i < tot; i++) d[i] = r() * 2 - 1; }
      else if (kind === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < tot; i++) {
          const w = r() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
        }
      } else { // brown, with a ~9 Hz high-pass so it does not wander
        let b = 0, lp = 0; const a = 1 - Math.exp(-TAU * 9 / sr);
        for (let i = 0; i < tot; i++) { b = (b + 0.02 * (r() * 2 - 1)) / 1.02; lp += a * (b - lp); d[i] = b - lp; }
      }
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = d[i];
      for (let i = 0; i < fade; i++) { const t = i / fade; o[i] = d[i] * Math.sqrt(t) + d[n + i] * Math.sqrt(1 - t); }
      let mean = 0; for (let i = 0; i < n; i++) mean += o[i]; mean /= n;
      let e = 0; for (let i = 0; i < n; i++) { o[i] -= mean; e += o[i] * o[i]; }
      const k = 0.25 / Math.sqrt(e / n + 1e-12); for (let i = 0; i < n; i++) o[i] *= k;
      return toBuffer([o]);
    }
    // Large dark hall / sea-cave impulse response: decaying noise whose top end dies first, sparse early echoes, decorrelated L/R.
    function genIR(secs) {
      const n = Math.floor(sr * secs), rt = secs * 0.82, pre = Math.floor(sr * 0.014), chans = [];
      for (let c = 0; c < 2; c++) {
        const d = new Float32Array(n), r = TW.rng(9173 + c * 977); let lp = 0, lp2 = 0, a = 0.5, k = 0;
        for (let i = pre; i < n; i++) {
          if (((i - pre) & 63) === 0) { // coefficients refreshed every 64 samples
            const t = (i - pre) / sr, fc = 5200 * Math.exp(-t * 1.25) + 420; a = 1 - Math.exp(-TAU * fc / sr);
            k = Math.exp(-6.91 * t / rt) * (1 - Math.exp(-t / 0.025)) / Math.pow(a / (2 - a), 0.3);
          }
          lp += a * ((r() * 2 - 1) - lp); lp2 += a * (lp - lp2);
          d[i] = lp2 * k;
        }
        for (let k = 0; k < 7; k++) { const i = Math.floor(sr * (0.017 + r() * 0.085)); d[i] += (r() < 0.5 ? -1 : 1) * (0.5 - k * 0.05) * 0.35; }
        chans.push(fadeTail(d, 0.12));
      }
      return toBuffer(chans);
    }
    // Rain patter on sailcloth and oilskin: a stereo loop of short resonant ticks.
    function genPatter(secs) {
      const n = Math.floor(sr * secs), L = new Float32Array(n), R = new Float32Array(n), r = TW.rng(4421), ticks = Math.floor(secs * 62);
      for (let k = 0; k < ticks; k++) {
        const f = 750 * Math.pow(2, r() * 2.3), w = TAU * f / sr, rad = 0.84 + 0.11 * r(), a1 = 2 * rad * Math.cos(w), a2 = -rad * rad;
        const len = Math.floor(sr * (0.003 + 0.011 * r())), amp = 0.15 + 0.85 * r() * r(), pan = r() * Math.PI * 0.5, gl = Math.cos(pan), gr = Math.sin(pan);
        const start = Math.floor(r() * n); let y1 = 0, y2 = 0;
        for (let j = 0; j < len * 5; j++) {
          const x = j < len ? (r() * 2 - 1) * Math.exp(-j / (len * 0.4)) : 0, y = x + a1 * y1 + a2 * y2; y2 = y1; y1 = y;
          const idx = (start + j) % n; L[idx] += y * amp * gl; R[idx] += y * amp * gr;
        }
      }
      let m = 1e-9; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
      for (let i = 0; i < n; i++) { L[i] *= 0.9 / m; R[i] *= 0.9 / m; }
      return toBuffer([L, R]);
    }
    // Additive struck-metal/glass tone: parts = [ratio, amp, t60].
    function genPartials(secs, f0, parts, strike, seed) {
      const n = Math.floor(sr * secs), d = new Float32Array(n);
      for (let p = 0; p < parts.length; p++) {
        const f = f0 * parts[p][0]; if (f > sr * 0.45) continue;
        const w = TAU * f / sr, c = 2 * Math.cos(w), dec = Math.exp(-6.91 / (parts[p][2] * sr));
        let y1 = 0, y2 = -Math.sin(w), a = parts[p][1];
        for (let i = 0; i < n; i++) { const y = c * y1 - y2; y2 = y1; y1 = y; d[i] += y * a; a *= dec; }
      }
      if (strike) { const r = TW.rng(seed || 5), m = Math.floor(sr * 0.012); let lp = 0; for (let i = 0; i < m; i++) { lp += 0.35 * ((r() * 2 - 1) - lp); d[i] += lp * strike * Math.exp(-i / (m * 0.25)); } }
      return toBuffer([normPeak(fadeTail(d, 0.08), 0.9)]);
    }
    function genDrum(kind) {
      const lo = kind === 'drumLo', tick = kind === 'drumTick', secs = lo ? 0.5 : tick ? 0.09 : 0.28, n = Math.floor(sr * secs), d = new Float32Array(n), r = TW.rng(lo ? 71 : tick ? 73 : 79);
      let ph = 0, ph2 = 0, ph3 = 0, lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = r() * 2 - 1;
        if (tick) { lp += 0.5 * (w - lp); d[i] = ((w - lp) * 0.6 + Math.sin(TAU * 1900 * t) * 0.3) * Math.exp(-t / 0.008); continue; }
        const f = lo ? 62 + 70 * Math.exp(-t / 0.028) : 118 + 90 * Math.exp(-t / 0.018);
        ph += TAU * f / sr; ph2 += TAU * f * 1.593 / sr; ph3 += TAU * f * 2.296 / sr;
        const body = Math.sin(ph) * Math.exp(-t / (lo ? 0.13 : 0.06)) + 0.3 * Math.sin(ph2) * Math.exp(-t / (lo ? 0.06 : 0.035)) + 0.16 * Math.sin(ph3) * Math.exp(-t / 0.03);
        lp += (lo ? 0.09 : 0.2) * (w - lp);
        d[i] = (body + lp * Math.exp(-t / (lo ? 0.012 : 0.008)) * (lo ? 1.6 : 2.2)) * (1 - Math.exp(-t / 0.0008));
      }
      return toBuffer([normPeak(fadeTail(d, 0.1), 0.9)]);
    }
    const bufs = {
      white: genNoise('white', 4.3, 101), pink: genNoise('pink', 6.1, 202), brown: genNoise('brown', 8.3, 303),
    };
    const lazy = {
      patter: () => genPatter(lowQ ? 4 : 6.5),
      bell: () => genPartials(6, 220, [[0.5, 0.3, 6.5], [1, 1, 5], [1.183, 0.55, 3.6], [1.506, 0.35, 2.6], [2, 0.65, 2.9], [2.514, 0.22, 1.6], [2.662, 0.18, 1.4], [3.011, 0.28, 1.2], [4.166, 0.16, 0.8], [5.433, 0.09, 0.5], [6.8, 0.05, 0.35]], 0.5, 11),
      chime: () => genPartials(5, 440, [[1, 1, 4.6], [2.0, 0.42, 3.0], [3.01, 0.2, 1.9], [4.03, 0.1, 1.2], [5.2, 0.05, 0.7], [6.3, 0.03, 0.45]], 0.25, 13),
      glass: () => genPartials(2.4, 880, [[1, 1, 2.0], [2.76, 0.5, 1.1], [5.4, 0.25, 0.55], [8.93, 0.1, 0.3]], 0.15, 17),
      drumLo: () => genDrum('drumLo'), drumHi: () => genDrum('drumHi'), drumTick: () => genDrum('drumTick'),
    };
    const getBuf = (name) => bufs[name] || (bufs[name] = lazy[name]());
    // Karplus-Strong plucked string, rendered once per pitch and cached (harp / hammered dulcimer).
    const plucks = {};
    function pluckBuf(midi) {
      let p = plucks[midi]; if (p) return p;
      const f = mtof(midi), N = Math.max(2, Math.round(sr / f)), k = sat((midi - 38) / 50), t60 = lerp(4.2, 1.5, k), s = lerp(0.5, 0.28, k);
      const n = Math.floor(sr * Math.min(2.6, t60 * 0.75)), d = new Float32Array(n), r = TW.rng(1000 + midi), ex = new Float32Array(N);
      let lp = 0, mean = 0; const bright = lerp(0.3, 0.72, k);
      for (let i = 0; i < N; i++) { lp += bright * ((r() * 2 - 1) - lp); ex[i] = lp; mean += lp; }
      mean /= N; const pp = Math.max(1, Math.floor(N * 0.17));
      for (let i = 0; i < N && i < n; i++) d[i] = (ex[i] - mean) - 0.55 * (ex[(i - pp + N) % N] - mean);
      const rho = Math.exp(-6.91 / (f * t60));
      for (let i = N; i < n; i++) d[i] = rho * ((1 - s) * d[i - N] + s * (i > N ? d[i - N - 1] : 0));
      const fi = Math.floor(sr * 0.0008); for (let i = 0; i < fi; i++) d[i] *= i / fi;
      p = plucks[midi] = { buf: toBuffer([normPeak(fadeTail(d, 0.15), 0.8)]), rate: f * (N + s) / sr };
      return p;
    }

    // ---- master chain -------------------------------------------------------
    const mix = BQ('highpass', 28, 0.7), comp = ctx.createDynamicsCompressor(), trim = G(0.78), muffle = BQ('lowpass', 20000, 0.5), dim = G(1), shaper = ctx.createWaveShaper(), master = G(0);
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3.5; comp.attack.value = 0.012; comp.release.value = 0.35;
    { // soft clip: transparent below 0.5, asymptote ~0.85 -> the output can never reach full scale
      const n = 4097, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x), y = a < 0.5 ? a : 0.5 + 0.42 * Math.tanh((a - 0.5) / 0.42); c[i] = x < 0 ? -y : y; }
      shaper.curve = c;
    }
    chain(mix, comp, trim, muffle, dim, shaper, master);
    if (!opt.offline) master.connect(ctx.destination);
    const amb = G(0.8), ambLP = BQ('lowpass', 20000, 0.5), sfx = G(0.9), musIn = G(1), musLP = BQ('lowpass', 20000, 0.5), musDuck = G(1), musHush = G(1), mus = G(0.77);
    chain(amb, ambLP, mix); sfx.connect(mix); chain(musIn, musLP, musDuck, musHush, mus, mix);
    const revIn = G(1), conv = ctx.createConvolver(), revOut = G(0.8), musRev = G(1);
    conv.buffer = genIR(lowQ ? 2.8 : 4.4);
    chain(revIn, conv, revOut, mix); musRev.connect(revIn);
    const bus = {};
    ['wind', 'sea', 'rain'].forEach((n) => { bus[n] = G(LV[n]); bus[n].connect(amb); });
    ['pad', 'harp', 'mel', 'bass', 'drum', 'choir', 'bell'].forEach((n) => { bus[n] = G(LV[n]); bus[n].connect(musIn); });
    const taps = { amb, sfx, mus, rev: revOut, wind: bus.wind, sea: bus.sea, rain: bus.rain, pad: bus.pad, harp: bus.harp, mel: bus.mel, bass: bus.bass, drum: bus.drum, choir: bus.choir, bell: bus.bell };
    let analyser = null, meterBuf = null, meterOn = false; const meter = { peak: 0, sum: 0, n: 0, frames: 0 };
    if (!opt.offline && ctx.createAnalyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; master.connect(analyser); meterBuf = new Float32Array(analyser.fftSize); }

    // ---- parameter driving (change-gated so automation lists stay short) ----
    const lastV = Object.create(null);
    function drive(key, param, v, tc) {
      const l = lastV[key];
      if (l !== undefined && Math.abs(v - l) <= 0.012 * Math.abs(l) + 1e-5) return;
      lastV[key] = v; param.setTargetAtTime(v, ctx.currentTime, tc || 0.12);
    }
    const loopSrc = (name, rate, off) => { const s = ctx.createBufferSource(); s.buffer = getBuf(name); s.loop = true; s.playbackRate.value = rate || 1; s.start(0, (off || 0) % (s.buffer.duration - 0.05)); nodeCount++; return s; };

    // ---- one-shot helpers ---------------------------------------------------
    function route(node, o) {
      let n = node;
      if (o.pan && hasPan) { const p = PAN(clamp(o.pan, -1, 1)); n.connect(p); n = p; }
      n.connect(o.out || sfx);
      if (o.send) { const s = G(o.send); n.connect(s); s.connect(o.rev || revIn); }
      return n;
    }
    function endOf(src, lastNode) { live++; shots++; src.onended = () => { live--; try { src.disconnect(); lastNode.disconnect(); } catch (e) { /* already gone */ } }; }
    const T0 = (t) => Math.max(t || 0, ctx.currentTime + 0.004);
    function envelope(g, t, o) {
      const atk = o.atk || 0.005, hold = o.hold || 0;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g, t + atk);
      g.gain.setTargetAtTime(0, t + atk + hold, Math.max(0.008, (o.dur - atk - hold) / 4.5));
    }
    function noiseShot(o) {
      const t = T0(o.t), s = ctx.createBufferSource(); s.buffer = bufs[o.buf || 'pink']; s.loop = true; if (o.rate) s.playbackRate.value = o.rate;
      const f = BQ(o.type || 'lowpass', o.f0, o.q || 0.7);
      if (o.f1) { f.frequency.setValueAtTime(o.f0, t); if (o.fm) f.frequency.exponentialRampToValueAtTime(o.fm, t + o.dur * (o.tm || 0.3)); f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur); }
      const g = G(0); envelope(g, t, o); s.connect(f); f.connect(g);
      let n = g; if (o.hp) { const h = BQ('highpass', o.hp, 0.7); g.connect(h); n = h; }
      const lastNode = route(n, o);
      s.start(t, rnd() * (s.buffer.duration - 0.1)); s.stop(t + o.dur + 0.05); endOf(s, lastNode);
    }
    function toneShot(o) {
      const t = T0(o.t), os = OSC(o.wave || o.type || 'sine', o.f0);
      os.frequency.setValueAtTime(o.f0, t); if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.dur));
      const g = G(0); envelope(g, t, o); os.connect(g);
      let n = g; if (o.lp) { const f = BQ(o.lpType || 'lowpass', o.lp, o.q || 0.7); g.connect(f); n = f; }
      const lastNode = route(n, o);
      os.start(t); os.stop(t + o.dur + 0.05); endOf(os, lastNode);
    }
    function bufShot(buf, o) {
      const t = T0(o.t), s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = o.rate || 1;
      const g = G(o.g); s.connect(g);
      let n = g; if (o.lp) { const f = BQ('lowpass', o.lp, 0.6); g.connect(f); n = f; }
      const lastNode = route(n, o);
      s.start(t); endOf(s, lastNode);
    }
    const struck = (name, f0, midi, o) => { o.rate = mtof(midi) / f0; bufShot(getBuf(name), o); };
    const bell = (midi, o) => struck('bell', 220, midi, o);
    const chime = (midi, o) => struck('chime', 440, midi, o);
    const glass = (midi, o) => struck('glass', 880, midi, o);
    function pluck(t, midi, vel, o) {
      const p = pluckBuf(midi); o = o || {};
      bufShot(p.buf, { t, rate: p.rate, g: vel * 0.2, pan: clamp((midi - 62) / 34, -0.6, 0.6), send: o.send === undefined ? 0.3 : o.send, lp: o.lp, out: bus.harp, rev: musRev });
      noteCount++;
    }

    // =========================================================================
    // AMBIENCE (persistent voices)
    // =========================================================================
    const W = {}, SEA = {}, RAIN = {}, MAW = {}, KIN = {}, FL = {};
    (function buildAmbience() {
      const band = (srcName, rate, off, type, f, q, pan, out) => { const s = loopSrc(srcName, rate, off), flt = BQ(type, f, q), g = G(0), p = PAN(pan); chain(s, flt, g, p, out); return { f: flt, g, s }; };
      // wind: a broad body, three wandering resonances (the howl), and thin whistles in the rigging
      W.body = band('pink', 1, 0.3, 'bandpass', 260, 0.8, 0, bus.wind);
      W.howlA = band('pink', 0.9, 2.1, 'bandpass', 520, 7, -0.45, bus.wind);
      W.howlB = band('pink', 1.13, 3.7, 'bandpass', 880, 9, 0.5, bus.wind);
      W.moan = band('brown', 1, 1.2, 'bandpass', 150, 4, 0.15, bus.wind);
      W.wh1 = band('white', 1, 0.5, 'bandpass', 2400, 28, -0.25, bus.wind);
      if (!lowQ) W.wh2 = band('white', 0.93, 2.2, 'bandpass', 3100, 34, 0.4, bus.wind);
      // sea: swell rumble, breaking wash left and right, hull chuckle, bow wash
      SEA.rumble = band('brown', 1, 4.0, 'lowpass', 110, 0.7, 0, bus.sea);
      SEA.washL = band('pink', 1.02, 1.0, 'lowpass', 1200, 0.6, -0.6, bus.sea);
      SEA.washR = band('pink', 0.97, 4.4, 'lowpass', 1200, 0.6, 0.6, bus.sea);
      SEA.washHP = BQ('highpass', 170, 0.7); // shared by re-patching both wash bands through it
      SEA.washL.g.disconnect(); SEA.washR.g.disconnect();
      { const pl = PAN(-0.6), pr = PAN(0.6); SEA.washL.g.connect(pl); SEA.washR.g.connect(pr); pl.connect(SEA.washHP); pr.connect(SEA.washHP); SEA.washHP.connect(bus.sea); }
      SEA.chuckle = band('white', 1, 1.7, 'bandpass', 900, 3, -0.1, bus.sea);
      SEA.bow = band('pink', 1.2, 2.9, 'bandpass', 1500, 0.7, 0.1, bus.sea);
      // rain: hiss L/R, a mid roar, and the patter loop
      RAIN.hL = band('white', 1, 0.2, 'highpass', 3000, 0.6, -0.8, bus.rain);
      RAIN.hR = band('white', 1.07, 2.6, 'highpass', 3300, 0.6, 0.8, bus.rain);
      RAIN.lp = BQ('lowpass', 9500, 0.6); bus.rain.disconnect(); bus.rain.connect(RAIN.lp); RAIN.lp.connect(amb);
      RAIN.body = band('pink', 1.1, 5.0, 'bandpass', 1400, 0.6, 0, bus.rain);
      { const s = loopSrc('patter', 1, 0), hp = BQ('highpass', 450, 0.7), g = G(0); chain(s, hp, g, bus.rain); RAIN.pat = { g, s }; }
      // lantern flame
      FL.v = band('pink', 0.8, 3.3, 'bandpass', 330, 0.7, 0, sfx);
      // the Maw: sub churn, beating sines, and a mid "throat" so small speakers hear it too
      MAW.out = G(0); MAW.out.connect(amb);
      MAW.sub = band('brown', 0.5, 2.0, 'lowpass', 90, 3, 0, MAW.out); MAW.sub.g.gain.value = 0.8;
      MAW.churn = band('pink', 0.7, 0.8, 'bandpass', 220, 2, 0, MAW.out);
      { const o1 = OSC('sine', 36), o2 = OSC('sine', 39.5), g = G(0.3); o1.connect(g); o2.connect(g); g.connect(MAW.out); o1.start(); o2.start(); }
      // kindling: a shimmer that climbs toward the bloom
      KIN.out = G(0); KIN.out.connect(sfx); { const s = G(0.6); KIN.out.connect(s); s.connect(revIn); }
      KIN.air = band('white', 1, 3.1, 'bandpass', 900, 5, 0, KIN.out); KIN.air.g.gain.value = 1;
      KIN.tg = G(0); KIN.tg.connect(KIN.out);
      // the held breath before the Heartlight catches: one thin high thread of sound
      KIN.th = G(0); KIN.th.connect(sfx); { const sn = G(0.7); KIN.th.connect(sn); sn.connect(revIn); }
      [1760, 1762.6].forEach((f) => { const o = OSC('sine', f), g = G(0.5); o.connect(g); g.connect(KIN.th); o.start(); });
      KIN.osc = [62, 69, 74, 81].map((m, i) => { const o = OSC('sine', mtof(m) * (i % 2 ? 1.003 : 0.998)), g = G(i < 2 ? 0.3 : 0.2); o.connect(g); g.connect(KIN.tg); o.start(); return o; });
    })();

    // smoothed inputs
    const inp = { storm: 0.8, rain: 0.5, dawn: 0, gust: 0, wsp: 14, speed: 0, luff: 0, roll: 0, pitch: 0, oil: 1, inten: 1, flick: 1, phase: 'title', lit: 0, danger: 0, maw: 0, ring: null, kprog: 0, hush: 0, heartT: -1, paused: false, heartOpen: false, tgt: null, heading: 0 };
    const sm = { hush: 0, storm: 0.8, rain: 0.5, dawn: 0, gust: 0, speed: 0, danger: 0, maw: 0, k: 0, luff: 0 };
    const cur = { S: null, hud: null };
    let T = 0, lastNow = -1, frameInt = 0.02, surge = 0, gustKick = 0, muffled = 0;
    const nz = (rate, k) => TW.noise2(T * rate + k * 31.7, k * 7.3, 911);

    function readInputs(S, hud, h) {
      const b = S.boat || {}, w = S.wind || {}, l = S.lantern || {};
      inp.storm = sat(S.storm || 0); inp.rain = sat(S.rain || 0); inp.dawn = sat(S.dawn || 0);
      inp.gust = sat((w.gust || 0) * 2.2);   // GAME's gusts peak around 0.3–0.45
      inp.wsp = w.speed || 0; inp.speed = Math.abs(b.speed || 0); inp.luff = sat(b.luff || 0);
      inp.roll = b.roll || 0; inp.pitch = b.pitch || 0; inp.heading = b.heading || 0;
      inp.oil = l.oil === undefined ? 1 : l.oil; inp.inten = sat(l.intensity === undefined ? 1 : l.intensity); inp.flick = l.flicker === undefined ? 1 : l.flicker;
      inp.hush = S.heart ? sat(S.heart.hush || 0) : 0; inp.heartT = S.heart && S.heart.t !== undefined ? S.heart.t : -1;
      inp.paused = S.phase === 'paused'; if (!inp.paused) inp.phase = S.phase || 'sailing';
      let lit = S.litCount | 0, kind = 0, prog = 0; const bs = S.beacons || [];
      for (let i = 0; i < bs.length; i++) { if (bs[i].kindled) kind++; else if (bs[i].progress > prog) prog = bs[i].progress; }
      inp.lit = Math.max(lit, kind, hud && hud.lit ? hud.lit | 0 : 0);
      inp.heartOpen = !!(hud && hud.heartOpen) || inp.lit >= 5;
      // the Maw
      let maw = 0; const vs = sat(S.vortexStrength || 0);
      if (vs > 0.01) {
        const v = TW.world && TW.world.vortex;
        if (v) { const d = Math.hypot((b.x || 0) - v.x, (b.z || 0) - v.z), r = v.r || 120; maw = vs * (1 - sstep(r * 0.8, r * 5, d)); }
        else maw = vs * (hud && hud.danger !== undefined ? sat(hud.danger) : 0.5);
      }
      inp.maw = maw;
      inp.danger = hud && hud.danger !== undefined ? sat(hud.danger) : Math.max(1 - sstep(0.05, 0.25, inp.oil), 1 - sstep(0.1, 0.4, b.hull === undefined ? 1 : b.hull), maw);
      // dock ring / kindling
      inp.ring = null; inp.tgt = hud && hud.target ? hud.target : null;
      if (hud) { if (hud.ring) { inp.ring = hud.ring; prog = hud.ring.inRing ? hud.ring.progress || 0 : 0; } else prog = 0; }
      else if (TW.world && TW.world.beacons) {
        const wb = TW.world.beacons;
        for (let i = 0; i < wb.length; i++) { if (bs[i] && bs[i].kindled) continue; const dk = wb[i].dock; if (dk && Math.hypot(b.x - dk.x, b.z - dk.z) < 130) { inp.ring = { index: i, inRing: true, progress: bs[i] ? bs[i].progress : 0 }; break; } }
      }
      inp.kprog = prog > 0.02 && prog < 0.995 ? prog : 0;
      sm.hush = damp(sm.hush, inp.hush, 14, h);
      sm.storm = damp(sm.storm, inp.storm, 1.2, h); sm.rain = damp(sm.rain, inp.rain, 1.5, h); sm.dawn = damp(sm.dawn, inp.dawn, 1.5, h);
      sm.gust = damp(sm.gust, inp.gust, 3, h); sm.speed = damp(sm.speed, inp.speed, 3, h); sm.danger = damp(sm.danger, inp.danger, 1.2, h);
      sm.maw = damp(sm.maw, inp.maw, 1.5, h); sm.k = damp(sm.k, inp.kprog, inp.kprog > sm.k ? 7 : 3, h); sm.luff = damp(sm.luff, inp.luff, 5, h);
    }

    function driveAmbience(h) {
      const st = sm.storm, dawn = sm.dawn, gust = Math.min(1.4, sm.gust + gustKick * 0.7), title = inp.phase === 'title';
      // --- wind ---
      const wsp = sat(inp.wsp / 18), wl = clamp(0.05 + 0.55 * st + 0.45 * st * wsp, 0, 1) * (1 - 0.72 * dawn);
      drive('wb.g', W.body.g.gain, 0.9 * wl * (0.6 + 0.6 * nz(0.21, 1)) * (1 + 0.7 * gust));
      drive('wb.f', W.body.f.frequency, 250 + 240 * nz(0.13, 2) + 140 * gust, 0.3);
      drive('wa.g', W.howlA.g.gain, 4.2 * wl * st * Math.pow(nz(0.17, 3), 2) * (1 + gust), 0.25);
      drive('wa.f', W.howlA.f.frequency, 380 * Math.pow(2, nz(0.09, 4) * 1.2) * (1 + 0.12 * gust), 0.35);
      drive('wh.g', W.howlB.g.gain, 3.6 * wl * st * Math.pow(nz(0.14, 5), 2) * (1 + gust), 0.25);
      drive('wh.f', W.howlB.f.frequency, 650 * Math.pow(2, nz(0.11, 6) * 1.1) * (1 + 0.1 * gust), 0.35);
      drive('wm.g', W.moan.g.gain, 1.5 * wl * (0.4 + 0.6 * nz(0.1, 7)), 0.3);
      drive('wm.f', W.moan.f.frequency, 140 + 120 * nz(0.07, 8), 0.5);
      const wamt = sstep(0.5, 0.95, st + 0.3 * gust) * (1 - dawn);
      drive('w1.g', W.wh1.g.gain, 3.0 * wamt * Math.pow(nz(0.23, 9), 1.5), 0.2);
      drive('w1.f', W.wh1.f.frequency, 2000 * Math.pow(2, nz(0.19, 10) * 0.7), 0.25);
      if (W.wh2) { drive('w2.g', W.wh2.g.gain, 2.2 * wamt * Math.pow(nz(0.27, 11), 2), 0.2); drive('w2.f', W.wh2.f.frequency, 2900 * Math.pow(2, nz(0.16, 12) * 0.5), 0.25); }
      // --- sea ---
      const sea = 0.18 + 0.82 * st;
      surge += h * TAU / (7.6 * (0.8 + 0.5 * nz(0.05, 13)));
      const eL = Math.pow(0.5 + 0.5 * Math.sin(surge), 2.5), eR = Math.pow(0.5 + 0.5 * Math.sin(surge - 0.7 - nz(0.06, 14)), 2.5), e2 = 0.5 + 0.5 * Math.sin(surge * 2.7 + 1);
      drive('sr.g', SEA.rumble.g.gain, 0.2 * Math.pow(sea, 1.3) * (0.8 + 0.4 * eL), 0.4);
      drive('sl.g', SEA.washL.g.gain, 0.95 * sea * (0.16 + eL + 0.2 * e2), 0.2);
      drive('sR.g', SEA.washR.g.gain, 0.95 * sea * (0.16 + eR + 0.2 * (1 - e2)), 0.2);
      drive('sl.f', SEA.washL.f.frequency, 800 + 2800 * eL * (0.45 + 0.55 * st), 0.25);
      drive('sR.f', SEA.washR.f.frequency, 800 + 2800 * eR * (0.45 + 0.55 * st), 0.25);
      const sp = sat(sm.speed / 10);
      drive('sc.g', SEA.chuckle.g.gain, 0.55 * sp * (0.25 + 1.7 * Math.pow(nz(6.3, 15), 2)), 0.05);
      drive('sc.f', SEA.chuckle.f.frequency, 600 + 950 * nz(2.9, 16), 0.08);
      drive('sb.g', SEA.bow.g.gain, 0.34 * sp * sp * (0.7 + 0.3 * eL), 0.2);
      // --- rain ---
      const rn = sm.rain, hiss = 0.5 * Math.pow(rn, 1.2) * (0.85 + 0.3 * nz(0.3, 17));
      drive('rl.g', RAIN.hL.g.gain, hiss); drive('rr.g', RAIN.hR.g.gain, hiss * (0.9 + 0.2 * nz(0.33, 18)));
      drive('rb.g', RAIN.body.g.gain, 0.26 * rn * (1 + 0.5 * gust));
      drive('rp.g', RAIN.pat.g.gain, 0.5 * sstep(0.02, 0.5, rn) * (1 - 0.3 * rn));
      drive('rp.r', RAIN.pat.s.playbackRate, 0.88 + 0.3 * rn, 0.5);
      // --- lantern flame flutter ---
      const lowOil = 1 - sstep(0.05, 0.25, inp.oil);
      drive('fl.g', FL.v.g.gain, 0.07 * inp.inten * (0.45 + 0.9 * nz(7 + 9 * lowOil, 19) + 2.5 * Math.abs(inp.flick - 1)), 0.04);
      // --- the Maw ---
      const m = sm.maw;
      drive('mw.g', MAW.out.gain, 1.1 * Math.pow(m, 1.4), 0.3);
      if (m > 0.01) { drive('mw.c', MAW.churn.g.gain, 3.4 * (0.5 + 0.5 * Math.sin(T * TAU * 0.8 + 3 * nz(0.4, 20))), 0.1); drive('mw.f', MAW.sub.f.frequency, 70 + 55 * m, 0.4); drive('mw.cf', MAW.churn.f.frequency, 170 + 140 * nz(0.5, 21), 0.2); }
      // --- kindling shimmer ---
      const k = sm.k;
      const hu = sm.hush;
      drive('k.g', KIN.out.gain, k > 0.004 ? 0.2 * Math.sqrt(k) * (1 - 0.6 * hu) : 0, 0.08);
      drive('k.th', KIN.th.gain, 0.02 * Math.pow(hu, 1.5), 0.1);
      if (k > 0.004) {
        drive('k.f', KIN.air.f.frequency, 900 * Math.pow(2, k * 2.3), 0.08);
        drive('k.t', KIN.tg.gain, 0.22 * k * (0.7 + 0.3 * Math.sin(T * 9)), 0.05);
        const det = (k - 1) * 700; for (let i = 0; i < KIN.osc.length; i++) drive('k.d' + i, KIN.osc[i].detune, det, 0.1);
      }
      // --- bus balance: the score sits under the gale and comes forward as it eases ---
      const pz = inp.paused;
      // The Heartlight's held breath: the weather sinks ~24 dB and goes under water, the score falls away;
      // after ignition the beds come back clearly lower (the gale is breaking) and then follow the storm value.
      const ht = inp.heartT, broke = ht < 0 ? 1 : lerp(lerp(0.25, 0.65, sstep(0.5, 7, ht)), 1, sstep(25, 45, ht));
      drive('amb', amb.gain, 0.8 * (pz ? 0.3 : 1) * (title ? 0.32 : 1) * lerp(1, 0.063, hu) * broke, 0.14);
      drive('alp', ambLP.frequency, 20000 * Math.pow(320 / 20000, hu), 0.1);
      drive('mhu', musHush.gain, lerp(1, 0.02, Math.pow(hu, 0.8)), 0.1);
      drive('mus', mus.gain, 0.77 * (0.62 + 0.38 * (1 - st)) * (title ? 1.5 : 1) * (pz ? 0.55 : 1), 0.5);
      drive('mlp', musLP.frequency, pz ? 650 : 20000 * Math.pow(500 / 20000, hu), pz ? 0.25 : 0.12);
      drive('mrv', musRev.gain, (pz ? 0.5 : 1) * (1 - 0.97 * hu), 0.12);
      if (PAD.lp) {
        drive('plp', PAD.lp.frequency, (600 + 900 * (1 - st) + 800 * dawn + 160 * nz(0.08, 22)) * (1 - 0.35 * sm.danger), 0.6);
        drive('dlp', PAD.dlp.frequency, 200 + 150 * nz(0.06, 23) + 120 * dawn, 0.6);
      }
      if (muffled && T - muffled > 10) recover(1.5);
    }

    // =========================================================================
    // SOUND EFFECTS
    // =========================================================================
    function thunder(dist) {
      const d = clamp(dist || 900, 30, 5000), t0 = ctx.currentTime + Math.min(d / 343, 3.5), near = d < 400, prox = sat(1 - d / 1900), g = 0.3 + 0.7 * prox;
      if (near) {
        const p = rr(-0.5, 0.5);
        noiseShot({ buf: 'white', t: t0, dur: 0.22, type: 'highpass', f0: 1400, f1: 500, g: 0.55 * g, atk: 0.002, pan: p, send: 0.35 });
        noiseShot({ buf: 'pink', t: t0 + 0.01, dur: 0.6, type: 'bandpass', f0: 2600, f1: 500, q: 0.9, g: 0.9 * g, atk: 0.004, pan: p, send: 0.4 });
        for (let i = 0; i < 4; i++) noiseShot({ buf: 'white', t: t0 + 0.05 + rnd() * 0.3, dur: 0.07 + rnd() * 0.08, type: 'bandpass', f0: 900 + rnd() * 2200, q: 1.5, g: 0.3 * g * rnd(), atk: 0.002, pan: rr(-0.8, 0.8), send: 0.3 });
      }
      const n = near ? 7 : 5; let ts = t0 + (near ? 0.06 : 0);
      for (let i = 0; i < n; i++) {
        const dur = rr(1.6, 3.8), f = (near ? 330 : 210) * rr(0.6, 1.2);
        noiseShot({ buf: 'brown', t: ts, dur, rate: rr(0.6, 1.1), type: 'lowpass', f0: f, f1: f * 0.45, q: 0.8, g: 2.3 * g * Math.pow(0.8, i) * rr(0.6, 1), atk: i === 0 && near ? 0.03 : rr(0.12, 0.5), hold: 0.15, pan: rr(-0.7, 0.7), send: 0.3 });
        ts += rr(0.22, 0.65);
      }
      noiseShot({ buf: 'brown', t: t0, dur: 2.8, type: 'lowpass', f0: 75, q: 1, g: 1.2 * g, atk: near ? 0.02 : 0.3, hold: 0.2 });
      const dk = 1 - (0.2 + 0.4 * prox);
      musDuck.gain.setTargetAtTime(dk, t0, 0.07); musDuck.gain.setTargetAtTime(1, t0 + 1.3, 1.1);
    }
    function creak(str) {
      const t = ctx.currentTime + 0.01, rope = rnd() < 0.4, dur = rr(0.22, 0.7), f = rope ? rr(1100, 2100) : rr(420, 1000), p0 = rope ? rr(24, 44) : rr(36, 72), up = rnd() < 0.6;
      const os = OSC('sawtooth', p0), flt = BQ('bandpass', f, rope ? 11 : 8), flt2 = BQ('bandpass', f * rr(1.9, 2.6), 6), g = G(0), g2 = G(0.35);
      os.frequency.setValueAtTime(p0, t); os.frequency.linearRampToValueAtTime(p0 * (up ? rr(1.25, 1.9) : rr(0.55, 0.8)), t + dur);
      flt.frequency.setValueAtTime(f, t); flt.frequency.linearRampToValueAtTime(f * (up ? 1.12 : 0.9), t + dur);
      const lvl = (rope ? 0.11 : 0.16) * (0.5 + 0.5 * str);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + 0.04); g.gain.setValueAtTime(lvl * 0.8, t + dur * 0.6); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.1);
      os.connect(flt); os.connect(flt2); flt2.connect(g2); g2.connect(g); flt.connect(g);
      const lastNode = route(g, { pan: rr(-0.4, 0.4), send: 0.08 });
      os.start(t); os.stop(t + dur + 0.15); endOf(os, lastNode);
      noiseShot({ buf: 'pink', t, dur, type: 'bandpass', f0: f, q: 9, g: lvl * 1.6, atk: 0.04, hold: dur * 0.5, pan: rr(-0.4, 0.4) });
    }
    function flog(l) {
      const t = ctx.currentTime + 0.005, p = rr(-0.3, 0.3);
      noiseShot({ buf: 'pink', t, dur: 0.09, type: 'lowpass', f0: rr(700, 1500), g: 0.5 * l * rr(0.5, 1), atk: 0.004, pan: p });
      toneShot({ f0: rr(100, 130), f1: 68, t, dur: 0.08, g: 0.16 * l, atk: 0.003, pan: p });
    }
    function splash(str, t) {
      t = t || ctx.currentTime;
      noiseShot({ buf: 'pink', t, dur: 0.9 + 0.6 * str, type: 'lowpass', f0: 3600, f1: 700, hp: 300, g: 0.5 * str, atk: 0.03, pan: rr(-0.5, 0.5), send: 0.12 });
      noiseShot({ buf: 'white', t: t + 0.02, dur: 0.5, type: 'bandpass', f0: 1400, f1: 500, q: 0.8, g: 0.22 * str, atk: 0.02, pan: rr(-0.5, 0.5) });
    }
    function slap(str) {
      const t = ctx.currentTime + 0.005;
      toneShot({ f0: 85, f1: 48, t, dur: 0.22, g: 0.3 * str, atk: 0.004 });
      noiseShot({ buf: 'white', t, dur: 0.35, type: 'bandpass', f0: 800, f1: 320, q: 0.9, g: 0.3 * str, atk: 0.006, pan: rr(-0.3, 0.3) });
    }
    function bump(s) {
      const t = ctx.currentTime + 0.004, p = rr(-0.3, 0.3); s = clamp(s === undefined ? 0.5 : s, 0.1, 1);
      toneShot({ f0: 96, f1: 44, t, dur: 0.3, g: 0.75 * s, atk: 0.003, pan: p });
      noiseShot({ buf: 'pink', t, dur: 0.18, type: 'lowpass', f0: 520, g: 0.8 * s, atk: 0.002, pan: p, send: 0.1 });
      noiseShot({ buf: 'pink', t: t + 0.004, dur: 0.12, type: 'bandpass', f0: rr(280, 380), q: 6, g: 1.2 * s, atk: 0.002, pan: p });
      if (s > 0.45) splash(s * 0.5, t + 0.04);
    }
    function wreck() {
      const t = ctx.currentTime; bump(1);
      for (let i = 0; i < 7; i++) noiseShot({ buf: 'pink', t: t + 0.03 + rnd() * 0.6, dur: rr(0.05, 0.16), type: 'bandpass', f0: rr(500, 2600), q: 2.2, g: rr(0.25, 0.6), atk: 0.002, pan: rr(-0.6, 0.6), send: 0.15 });
      toneShot({ type: 'sawtooth', f0: 70, f1: 38, t: t + 0.1, dur: 0.9, g: 0.3, atk: 0.05, hold: 0.4, lp: 600, lpType: 'bandpass', q: 6 });
      splash(1, t + 0.25); muffle_(1.2, 0.4);
    }
    function bigWave(str) { // the bow slams into a sea and green water comes aboard
      const t = ctx.currentTime + 0.004, k = 0.35 + 0.65 * sat(str === undefined ? 0.6 : str);
      toneShot({ f0: 82, f1: 42, t, dur: 0.35, g: 0.5 * k, atk: 0.004 });
      noiseShot({ buf: 'brown', t, dur: 1.6, type: 'lowpass', f0: 140, g: 0.8 * k, atk: 0.04, hold: 0.1 });
      noiseShot({ buf: 'pink', t: t + 0.02, dur: 1.3 + k, type: 'lowpass', f0: 3200, f1: 600, hp: 200, g: 0.5 * k, atk: 0.05, pan: -0.5, send: 0.12 });
      noiseShot({ buf: 'pink', t: t + 0.07, dur: 1.4 + k, type: 'lowpass', f0: 2800, f1: 600, hp: 200, g: 0.45 * k, atk: 0.08, pan: 0.5, send: 0.12 });
      noiseShot({ buf: 'white', t: t + 0.12, dur: 1.3, type: 'highpass', f0: 3500, g: 0.11 * k, atk: 0.18, pan: rr(-0.4, 0.4) });   // spray falling back
    }
    function gustSfx() {
      gustKick = 1;
      noiseShot({ buf: 'pink', dur: 2.2, type: 'bandpass', f0: 280, fm: 950, tm: 0.4, f1: 380, q: 1.6, g: 0.4, atk: 0.7, hold: 0.2, pan: rr(-0.6, 0.6) });
    }
    let lastLow = -99;
    function lanternLow() {
      if (T - lastLow < 5) return; lastLow = T; const t = ctx.currentTime + 0.02;
      glass(81, { t, g: 0.12, pan: -0.15, send: 0.5 }); glass(77, { t: t + 0.3, g: 0.1, pan: 0.15, send: 0.5 });
    }
    function muffle_(tc, delay) {
      const t = ctx.currentTime + (delay || 0); muffled = T || 0.001;
      muffle.frequency.setTargetAtTime(230, t, tc * 0.5); dim.gain.setTargetAtTime(0.3, t, tc);
    }
    function recover(tc) { if (!muffled) return; muffled = 0; const t = ctx.currentTime; muffle.frequency.setTargetAtTime(20000, t, tc * 0.6); dim.gain.setTargetAtTime(1, t, tc * 0.5); }
    function lanternOut() {
      const t = ctx.currentTime;
      noiseShot({ buf: 'white', t, dur: 0.7, type: 'highpass', f0: 2600, f1: 5000, g: 0.14, atk: 0.01 });
      toneShot({ f0: 180, f1: 70, t, dur: 0.35, g: 0.15, atk: 0.01 });
      glass(74, { t: t + 0.1, g: 0.07, send: 0.7 }); muffle_(1.3, 0.15);
    }
    let pickN = 0;
    function pickup() {
      const maj = sm.dawn > 0.5, pent = maj ? [74, 76, 78, 81, 83, 86] : [74, 77, 79, 81, 84, 86], t = ctx.currentTime + 0.01;
      const i = (pickN * 2 + (rnd() < 0.3 ? 1 : 0)) % pent.length; pickN++;
      glass(pent[i], { t, g: 0.17, pan: rr(-0.3, 0.3), send: 0.5 });
      glass(pent[(i + 2) % pent.length] + (rnd() < 0.5 ? 12 : 0), { t: t + 0.09, g: 0.11, pan: rr(-0.3, 0.3), send: 0.5 });
      glass(pent[i] + 12, { t: t + 0.2, g: 0.06, send: 0.6 });
    }
    function click() {
      const t = ctx.currentTime + 0.003;
      noiseShot({ buf: 'white', t, dur: 0.035, type: 'bandpass', f0: 1700, q: 3, g: 0.2, atk: 0.001 });
      toneShot({ type: 'triangle', f0: 430, f1: 290, t, dur: 0.05, g: 0.1, atk: 0.001 });
    }
    function buoyBell() {
      let pan = rr(-0.5, 0.5), g = 0.13;
      if (inp.tgt && inp.ring && inp.tgt.index === inp.ring.index) { pan = clamp(-Math.sin(TW.wrapAngle(inp.tgt.bearing - inp.heading)) * 0.75, -0.8, 0.8); g *= clamp(1.25 - (inp.tgt.dist || 0) / 160, 0.4, 1.2); }
      const t = ctx.currentTime + 0.02, o = { t, g: g * rr(0.6, 1), pan, send: 0.55, lp: 2600 };
      bell(69, o);
      if (rnd() < 0.4) bell(69, { t: t + rr(0.17, 0.36), g: o.g * 0.5, pan, send: 0.55, lp: 2200 });
    }
    function kindleStart() {
      const t = ctx.currentTime;
      noiseShot({ buf: 'white', t, dur: 0.4, type: 'bandpass', f0: 3000, f1: 1200, q: 1.2, g: 0.1, atk: 0.02, send: 0.3 });
      glass(74, { t: t + 0.05, g: 0.06, send: 0.6 });
    }
    // Beacon lit: fire whoomph now, a swell of open fifths that crests on the next bar line, where the bells ring the true chord.
    function bloom(heart) {
      const t = ctx.currentTime, k = heart ? 1.4 : 1;
      noiseShot({ buf: 'brown', t, dur: heart ? 3.4 : 2.3, type: 'lowpass', f0: 90, fm: heart ? 950 : 680, tm: 0.12, f1: 140, g: 1.0 * k, atk: 0.07, hold: 0.12, send: 0.3 });
      noiseShot({ buf: 'pink', t: t + 0.02, dur: 1.5, type: 'bandpass', f0: 500, fm: 2400, tm: 0.15, f1: 900, q: 0.8, g: 0.45 * k, atk: 0.05, send: 0.4 });
      toneShot({ f0: 64, f1: 36, t, dur: 1.3, g: 0.5, atk: 0.03 });
      for (let i = 0; i < (heart ? 16 : 9); i++) noiseShot({ buf: 'white', t: t + 0.15 + rnd() * 1.8, dur: 0.03, type: 'bandpass', f0: 2000 + rnd() * 3200, q: 3, g: 0.05 + rnd() * 0.07, atk: 0.001, pan: rr(-0.6, 0.6) });
      let tb = t + 0.6;
      if (heart) { // from silence: the score re-enters on a fresh downbeat in D major, and a bright ring of air travels outward
        M.jump = true; tb = t + 0.45;
        noiseShot({ buf: 'pink', t: t + 0.05, dur: 3.6, type: 'bandpass', f0: 900, fm: 3200, tm: 0.3, f1: 6500, q: 0.7, g: 0.3, atk: 1.0, hold: 0.3, pan: -0.6, send: 0.5 });
        noiseShot({ buf: 'white', t: t + 0.2, dur: 3.6, type: 'bandpass', f0: 1400, fm: 4200, tm: 0.3, f1: 8000, q: 0.8, g: 0.2, atk: 1.2, hold: 0.3, pan: 0.6, send: 0.5 });
      } else if (M.on) tb = Math.max(t + 0.35, M.step === 0 ? M.next : M.next + (6 - M.step) * M.e);
      const notes = heart ? [38, 50, 57, 62, 69, 74, 76] : [50, 57, 62, 69];
      for (let i = 0; i < notes.length; i++) toneShot({ type: 'triangle', f0: mtof(notes[i]), t, dur: tb - t + (heart ? 7 : 4.5), g: (heart ? 0.07 : 0.055) * (i === 0 ? 1.3 : 1), atk: tb - t, hold: 0.2, pan: (i % 2 ? 0.4 : -0.4), send: 0.6, out: bus.bell, rev: musRev });
      M.bloom = { heart: !!heart };
    }

    function triggers(h) {
      gustKick *= Math.exp(-h / 1.3);
      const active = !inp.paused && inp.phase !== 'title';
      const dRoll = Math.abs(inp.roll - trg.roll), dPitch = inp.pitch - trg.pitch; trg.roll = inp.roll; trg.pitch = inp.pitch;
      if (sm.hush > 0.96 && !trg.beat && active) { // the held breath: one soft heartbeat
        trg.beat = true; const t = ctx.currentTime + 0.03;
        toneShot({ f0: 62, f1: 40, t, dur: 0.3, g: 0.2, atk: 0.012 }); toneShot({ f0: 56, f1: 38, t: t + 0.21, dur: 0.3, g: 0.13, atk: 0.012 });
      } else if (sm.hush < 0.5) trg.beat = false;
      if (!active || muffled || sm.hush > 0.2) return;
      trg.creak += (dRoll + 0.5 * Math.abs(dPitch)) * (0.6 + 0.6 * sm.storm);
      if (trg.creak > 0.1 && T > trg.nextCreak) { creak(sat(trg.creak * 3)); trg.creak = 0; trg.nextCreak = T + rr(0.7, 2.6); }
      if (trg.creak > 0.4) trg.creak = 0.4;
      if (sm.luff > 0.25 && T > trg.nextFlog) { flog(sm.luff); trg.nextFlog = T + rr(0.09, 0.22) / (0.5 + sm.luff); }
      if (!cur.hud && h > 0 && dPitch / h > 0.55 && sm.speed > 2.5 && T > trg.nextSlap)   /* with the real GAME, slams arrive as 'bigWave' */ { slap(sat(dPitch / h / 1.6) * sat(sm.speed / 8)); trg.nextSlap = T + rr(1.3, 2.8); }
      if (inp.ring) { trg.buoy -= h * (0.6 + 0.8 * sm.storm); if (trg.buoy <= 0) { buoyBell(); trg.buoy = rr(1.8, 6.5); } } else if (trg.buoy > 1.2) trg.buoy = 1.2;
    }
    const trg = { roll: 0, pitch: 0, creak: 0, nextCreak: 1.5, nextFlog: 0, nextSlap: 2, buoy: 1.2, beat: false };

    // =========================================================================
    // SCORE — instruments
    // =========================================================================
    const PAD = {}, CHOIR = {}, TREM = {};
    (function buildPad() { // bowed strings: four voices of detuned saws through a slow low-pass, plus the D drone
      PAD.lp = BQ('lowpass', 900, 0.6); PAD.g = G(0); chain(PAD.lp, PAD.g, bus.pad);
      { const s = G(0.5); PAD.g.connect(s); s.connect(musRev); }
      PAD.notes = [50, 57, 62, 65];
      PAD.v = PAD.notes.map((m, i) => {
        const f = mtof(m), o1 = OSC('sawtooth', f, -7 - i), o2 = OSC('sawtooth', f, 7 + i), vg = G(0.11), pn = PAN([-0.55, 0.25, -0.2, 0.55][i]);
        o1.connect(vg); o2.connect(vg); chain(vg, pn, PAD.lp); o1.start(); o2.start(); return { o1, o2, vg };
      });
      PAD.dlp = BQ('lowpass', 240, 0.9); PAD.dg = G(0); chain(PAD.dlp, PAD.dg, bus.pad);
      [[38, -5, 0.5], [38, 6, 0.5], [45, 3, 0.22]].forEach((d) => { const o = OSC('sawtooth', mtof(d[0]), d[1]), g = G(d[2]); chain(o, g, PAD.dlp); o.start(); });
    })();
    function padChord(notes, t, dark) {
      const now = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        let m = notes[i]; if (dark && i === 3) m -= 12;
        if (m === PAD.notes[i]) continue; PAD.notes[i] = m;
        const v = PAD.v[i], f = mtof(m);
        v.o1.frequency.setTargetAtTime(f, t, 0.06); v.o2.frequency.setTargetAtTime(f, t, 0.06);
        v.vg.gain.setTargetAtTime(0.06, Math.max(now, t - 0.12), 0.05); v.vg.gain.setTargetAtTime(0.11, t + 0.03, 0.32);   // a fresh bow stroke
      }
    }
    function buildChoir() { // wordless voices: detuned saws through three vowel formants
      CHOIR.g = G(0); CHOIR.pre = G(0.16); CHOIR.g.connect(bus.choir); { const s = G(0.9); CHOIR.g.connect(s); s.connect(musRev); }
      CHOIR.fm = [[350, 5, 1], [800, 7, 0.5], [2500, 8, 0.18]].map((d) => { const f = BQ('bandpass', d[0], d[1]), g = G(d[2]); chain(CHOIR.pre, f, g, CHOIR.g); return f; });
      { const lp = BQ('lowpass', 420, 0.6), g = G(0.25); chain(CHOIR.pre, lp, g, CHOIR.g); }
      const lfo = OSC('sine', 5.3), ld = G(9); lfo.connect(ld); lfo.start();
      CHOIR.notes = [57, 62, 65, 74];
      CHOIR.v = CHOIR.notes.map((m, i) => { const f = mtof(m), o1 = OSC('sawtooth', f, -9), o2 = OSC('sawtooth', f, 8), pn = PAN([-0.4, 0.4, -0.15, 0.15][i]); ld.connect(o1.detune); ld.connect(o2.detune); o1.connect(pn); o2.connect(pn); pn.connect(CHOIR.pre); o1.start(); o2.start(); return { o1, o2 }; });
      CHOIR.built = true;
    }
    function choirChord(pad, t, ah) {
      const notes = [pad[1], pad[2], pad[3], pad[2] + 12];
      for (let i = 0; i < 4; i++) { if (notes[i] === CHOIR.notes[i]) continue; CHOIR.notes[i] = notes[i]; const f = mtof(notes[i]); CHOIR.v[i].o1.frequency.setTargetAtTime(f, t, 0.1); CHOIR.v[i].o2.frequency.setTargetAtTime(f, t, 0.1); }
      const F = ah ? [760, 1150, 2800] : [350, 800, 2500];
      if (CHOIR.ah !== !!ah) { CHOIR.ah = !!ah; for (let i = 0; i < 3; i++) CHOIR.fm[i].frequency.setTargetAtTime(F[i], t, 1.5); }
    }
    function buildTrem() { // low tremolo strings for danger
      TREM.g = G(0); TREM.am = G(0.55); const lp = BQ('lowpass', 950, 0.7); chain(lp, TREM.am, TREM.g, bus.pad);
      const lfo = OSC('sine', 8.3), ld = G(0.45); chain(lfo, ld); ld.connect(TREM.am.gain); lfo.start();
      [[50, -6], [50, 7], [57, -5], [57, 6]].forEach((d) => { const o = OSC('sawtooth', mtof(d[0]), d[1]), g = G(0.25); chain(o, g, lp); o.start(); });
      TREM.built = true;
    }
    const VOICES = [];
    // Monophonic sustained voice (whistle / cello / fiddle): one oscillator played legato by automation.
    function MonoVoice(o) {
      const osc = OSC(o.wave, 220), env = G(0), outG = G(o.out), pn = PAN(o.pan || 0), lfo = OSC('sine', o.vibRate || 5), vib = G(0);
      let head = osc; if (o.lp) { const f = BQ('lowpass', o.lp, o.lpQ || 0.7); osc.connect(f); head = f; }
      head.connect(env); chain(env, outG, pn, o.bus); { const s = G(o.send || 0.3); pn.connect(s); s.connect(musRev); }
      chain(lfo, vib); vib.connect(osc.frequency); osc.start(); lfo.start();
      let bp = null, bg = null;
      if (o.breath) { const s = loopSrc('pink', 1.3, rnd() * 4); bp = BQ('bandpass', 1500, 1.3); bg = G(o.breath); chain(s, bp, bg, env); }
      const atk = o.atk || 0.018, sus = o.sus || 0.82, vibAmt = o.vibAmt || 0.005;
      const v = {
        slurNext: false,
        // opt: slurOut (no release, the next note is slurred), tongue (brief dip, next note re-attacks), grace (midi), vib (0..1)
        note(t, midi, d, vel, opt) {
          opt = opt || {}; const f = mtof(midi), slurIn = v.slurNext; v.slurNext = !!opt.slurOut; noteCount++;
          if (slurIn) { osc.frequency.setTargetAtTime(f, t, 0.022); env.gain.setTargetAtTime(vel * sus, t, 0.05); }
          else {
            if (opt.grace) { osc.frequency.setValueAtTime(mtof(opt.grace), t); osc.frequency.setTargetAtTime(f, t + 0.038, 0.011); } else osc.frequency.setValueAtTime(f, t);
            env.gain.setTargetAtTime(vel, t, atk); env.gain.setTargetAtTime(vel * sus, t + atk * 4, 0.12);
            if (bg) { bg.gain.setValueAtTime(o.breath * 3.5, t); bg.gain.setTargetAtTime(o.breath, t + 0.015, 0.035); }
          }
          if (bp) bp.frequency.setTargetAtTime(Math.min(f * 2.1, 6000), t, 0.01);
          if (opt.slurOut) { /* held into the next note */ }
          else if (opt.tongue) env.gain.setTargetAtTime(vel * 0.3, t + d - 0.045, 0.014);
          else { const rel = Math.min(0.2, d * 0.3); env.gain.setTargetAtTime(0, t + d - rel, rel / 2.5); }
          vib.gain.setTargetAtTime(0, t, 0.03);
          if (d > 0.55) vib.gain.setTargetAtTime(f * vibAmt * (opt.vib === undefined ? 1 : opt.vib), t + 0.28, 0.22);   // vibrato blooms on long notes
          v.open = !!(opt.slurOut || opt.tongue); v.openEnd = t + d;
        },
        // a held note whose continuation never came (layer dropped out, form changed): let it go
        release(t) { env.gain.setTargetAtTime(0, t, 0.07); v.slurNext = false; v.open = false; },
        open: false, openEnd: 0,
      };
      VOICES.push(v);
      return v;
    }
    const W_WHISTLE = wave([1, 0.26, 0.08, 0.035, 0.012]), W_LOW = wave([1, 0.42, 0.14, 0.06, 0.02, 0.01]);
    const W_CELLO = wave([1, 0.62, 0.3, 0.2, 0.17, 0.1, 0.09, 0.07, 0.05, 0.045, 0.035, 0.03, 0.022, 0.018]);
    const W_FIDDLE = wave([1, 0.5, 0.36, 0.25, 0.2, 0.16, 0.13, 0.11, 0.09, 0.08, 0.06, 0.05, 0.04, 0.035, 0.03, 0.025]);
    const whistle = MonoVoice({ wave: W_WHISTLE, out: 0.085, pan: -0.12, send: 0.45, breath: 0.05, vibRate: 5.1, vibAmt: 0.0055, bus: bus.mel });
    const lowW = MonoVoice({ wave: W_LOW, out: 0.075, pan: 0.3, send: 0.5, breath: 0.08, vibRate: 4.7, vibAmt: 0.005, atk: 0.026, bus: bus.mel });
    const fiddle = MonoVoice({ wave: W_FIDDLE, out: 0.045, pan: 0.28, send: 0.4, lp: 2600, lpQ: 1.1, vibRate: 5.6, vibAmt: 0.005, atk: 0.04, bus: bus.mel });
    const cello = MonoVoice({ wave: W_CELLO, out: 0.16, pan: 0.1, send: 0.2, lp: 1100, vibRate: 4.6, vibAmt: 0.0035, atk: 0.05, sus: 0.9, bus: bus.bass });
    function drumHit(t, v) {
      const lo = v > 0, a = Math.abs(v);
      bufShot(getBuf(lo ? 'drumLo' : 'drumHi'), { t, g: 0.3 * a * M.L.drum, rate: lo ? rr(0.97, 1.03) : rr(0.95, 1.08), pan: lo ? -0.08 : 0.12, send: 0.12, out: bus.drum, rev: musRev });
      noteCount++;
    }

    // =========================================================================
    // SCORE — conductor (look-ahead scheduler, driven from update())
    // =========================================================================
    const M = { on: false, form: '', si: 0, bar: 0, step: 0, next: 0, e: 0.4, bpm: 50, bars: 0, L: {}, chord: CH.Dm, lad: ladderOf(CH.Dm), sec: SEC.I, ent: FORMS.title.seq[0], pat: HARP_PATS[0], dpat: DRUMS.lilt, mel: null, ctr: null, melOn: false, ctrOn: false, restart: false, jump: false, force: null, bloom: null, energy: 0, intro: 0, introLow: false, stalls: 0, bassLong: false, major: false, pcs: PCS_MIN };
    function desiredForm() {
      const p = inp.phase;
      if (p === 'title') return 'title';
      if (p === 'free') return 'coda';
      if (p === 'ending' || sm.dawn > 0.3 || inp.dawn > 0.3 || inp.heartT >= 0) return 'ending';
      return 'sail';
    }
    function vary(notes, pcs) { // controlled variation: split dotted quarters with a passing tone
      const out = [];
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i], nx = notes[i + 1];
        if (n[1] === 3 && nx && rnd() < 0.6) { const p = passing(n[2], nx[2], pcs) || scaleStep(n[2], 1, pcs); out.push([n[0], 2, n[2]], [n[0] + 2, 1, p]); }
        else out.push(n);
      }
      return out;
    }
    function barStart(t) {
      // ---- which form / section / bar ----
      const want = M.force || desiredForm(), forced = !!M.force; M.force = null;
      if (M.restart || forced || want !== M.form) {
        let sw = true; if (forced) M.form = '';
        if (!M.restart && M.form) { if (M.form === 'ending' && want === 'coda') sw = false; if (M.form === 'coda' && want === 'ending') sw = false; }
        if (sw) { M.first = !M.form && !forced; M.intro = want === 'sail' && !M.restart ? 4 : 0; M.form = want; M.si = 0; M.bar = 0; M.restart = false; }
      }
      let form = FORMS[M.form];
      if (M.bar >= SEC[form.seq[M.si].s].ch.length) {
        M.bar = 0; M.si++;
        if (M.si >= form.seq.length) { if (form.next) { M.form = form.next; form = FORMS[M.form]; M.si = 0; } else M.si = form.loop || 0; }
      }
      const ent = form.seq[M.si], sec = SEC[ent.s], bar = M.bar, ch = CH[sec.ch[bar]], f = M.form, L = inp.lit, dg = sm.danger, major = !!sec.major;
      M.ent = ent; M.sec = sec; M.chord = ch; M.lad = ladderOf(ch); M.major = major; M.pcs = pcsOf(ch, major);
      if (bar === 0) { // section-level choices
        M.pat = HARP_PATS[(rnd() * (f === 'ending' ? 5 : 3)) | 0];
        M.dbase = f === 'ending' || M.energy ? DRUMS.jig : (rnd() < 0.5 ? DRUMS.lilt : DRUMS.jig);
      }
      // ---- layers (evaluated on the bar line; melodic voices enter on half-phrase boundaries) ----
      const Ly = M.L = { harp: 'sparse', harpV: 1, bass: 0, drum: 0, choir: 0, pad: 0.3, drone: 0.25, trem: 0, sparkle: 0, hint: 0, bells: 0, mel: 0, ctr: 0, ah: 0 };
      let wantMel = false, wantCtr = false, bpm = 56;
      if (f === 'title') { Ly.harp = 'title'; Ly.pad = 0.36; Ly.drone = 0.12; wantMel = !!ent.mel; bpm = 50; Ly.mel = 0.85; }
      else if (f === 'sail') {
        Ly.harp = L >= 1 ? 'arp' : 'sparse'; Ly.harpV = 0.8 + 0.05 * L; Ly.hint = L >= 1 && L < 3 ? 0.75 : 0;
        Ly.bass = L >= 2 ? 1 : 0; wantMel = L >= 3 && !!ent.mel; Ly.mel = 0.9;
        M.introLow = false; if (M.intro > 0) { M.intro--; if (L < 3) { wantMel = true; Ly.mel = 0.6; M.introLow = true; } }
        Ly.drum = L >= 4 ? (M.energy ? 1 : 0.8) : (dg > 0.65 ? 0.5 : 0);
        wantCtr = L >= 5 && !!ent.ctr; Ly.ctr = 0.8; Ly.choir = L >= 5 ? (M.energy ? 0.5 : 0.3) : 0;
        Ly.sparkle = M.energy ? 0.5 : (L >= 4 ? 0.2 : 0); Ly.bells = L >= 1 ? 1 : 0;
        Ly.pad = 0.27 + 0.02 * L; Ly.drone = 0.32 - 0.03 * L; Ly.trem = sstep(0.45, 0.9, dg);
        bpm = 56 + 0.8 * L + (M.energy ? 1.5 : 0) + 2 * dg;
      } else if (f === 'ending') {
        Ly.harp = 'arp'; Ly.harpV = 1.1; Ly.bass = 1; wantMel = true; Ly.mel = 1; Ly.drum = 1; wantCtr = !!ent.ctr; Ly.ctr = 0.85;
        Ly.choir = 0.8; Ly.ah = 1; Ly.sparkle = 0.6; Ly.bells = 2; Ly.pad = 0.36; Ly.drone = 0.15; bpm = 61;
      } else { // coda
        Ly.harp = 'coda'; Ly.bass = 0.7; wantMel = !!ent.mel; Ly.mel = 0.75; Ly.choir = 0.4; Ly.ah = 0; Ly.bells = 2; Ly.pad = 0.33; Ly.drone = 0.1; bpm = 53;
      }
      if (bar % 4 === 0 || f === 'title') { M.melOn = wantMel; M.ctrOn = wantCtr; } else { if (!wantMel) M.melOn = false; if (!wantCtr) M.ctrOn = false; }
      if (!M.melOn) Ly.mel = 0; if (!M.ctrOn) Ly.ctr = 0;
      // ---- tempo (eased bar by bar) ----
      M.bpm = M.first ? bpm : M.bpm + clamp(bpm - M.bpm, -1.5, 1.5); M.first = false; M.e = 60 / (M.bpm * 3);
      // ---- sustained voices cross-fade over a bar or two ----
      padChord(ch.pad, t, f === 'sail' && dg > 0.6);
      PAD.g.gain.setTargetAtTime(Ly.pad, t, 1.3); PAD.dg.gain.setTargetAtTime(Ly.drone, t, 1.6);
      if (Ly.choir > 0 && !CHOIR.built) buildChoir();
      if (CHOIR.built) { choirChord(ch.pad, t, Ly.ah); CHOIR.g.gain.setTargetAtTime(Ly.choir * (0.85 + 0.15 * ARCH[bar % 8]), t, 1.4); }
      if (Ly.trem > 0.02 && !TREM.built) buildTrem();
      if (TREM.built) TREM.g.gain.setTargetAtTime(Ly.trem * 0.32, t, 0.8);
      // ---- this bar's material ----
      const last = bar === sec.ch.length - 1;
      M.dpat = last && sec.ch.length > 2 ? DRUMS.fill : (dg > 0.6 && f === 'sail' ? DRUMS.urge : M.dbase);
      M.bassLong = last || bar % 4 === 3 || rnd() < 0.2;
      M.mel = sec.mel ? (ent.vary ? vary(sec.mel[bar], M.pcs) : sec.mel[bar]) : null;
      M.melNext = sec.mel && bar + 1 < sec.mel.length ? sec.mel[bar + 1] : null;
      M.ctr = sec.ctr ? sec.ctr[bar] : null;
      // ---- bells ----
      if (M.bloom) { // the beacon's chord, rung on the bar line
        const hrt = M.bloom.heart, ns = [ch.pad[0] + 12, ch.pad[1] + 12, ch.pad[2] + 12, ch.pad[3] + 12, ch.pad[1] + 24];
        if (hrt) { ns.push(ch.pad[2] + 24, ch.pad[3] + 24); chime(ch.b + 12, { t, g: 0.2, send: 0.6, out: bus.bell, rev: musRev }); }
        for (let i = 0; i < ns.length; i++) chime(ns[i], { t: t + i * 0.075, g: (hrt ? 0.16 : 0.15) * (1 - i * 0.07), pan: ((i % 2) * 2 - 1) * 0.45, send: 0.6, out: bus.bell, rev: musRev });
        if (CHOIR.built && hrt) { CHOIR.g.gain.setTargetAtTime(1, t, 0.4); }
        M.bloom = null;
      } else if (Ly.bells === 1 && bar === 0 && rnd() < 0.65) bell(50, { t, g: 0.1, pan: rr(-0.5, 0.5), send: 0.7, lp: 1900, out: bus.bell, rev: musRev });   // a distant bell, far across the water
      else if (Ly.bells === 2 && bar % 4 === 0) { chime(ch.pad[3] + 12, { t, g: 0.1, pan: 0.35, send: 0.6, out: bus.bell, rev: musRev }); chime(ch.pad[1] + 12, { t: t + 0.09, g: 0.07, pan: -0.35, send: 0.6, out: bus.bell, rev: musRev }); }
      M.barT = t; M.bars++;
    }
    function playLine(voice, notes, nextBar, p, t, e, lvl, oct, bar, ornaments) {
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i]; if (n[0] !== p) continue;
        const nx = notes[i + 1], endsBar = n[0] + n[1] === 6;
        const contiguous = nx ? nx[0] === n[0] + n[1] : (endsBar && n[1] < 5 && nextBar && nextBar.length && nextBar[0][0] === 0);
        const slurOut = contiguous && rnd() < 0.42, wasSlur = voice.slurNext;
        let grace = 0;
        if (ornaments && !wasSlur) { if (i === 0 && bar % 4 === 0 && rnd() < 0.5) grace = scaleStep(n[2], -1, M.pcs); else if (n[1] >= 2 && rnd() < 0.26) grace = scaleStep(n[2], 1, M.pcs); }
        const vel = lvl * (0.7 + 0.24 * ARCH[bar % 8]) * (p === 0 ? 1 : 0.93) * rr(0.94, 1.04);
        voice.note(t + rnd() * 0.012, n[2] + oct, n[1] * e, vel, { slurOut, tongue: contiguous && !slurOut, grace: grace ? grace + oct : 0 });
      }
    }
    function scheduleStep(t) {
      if (M.step === 0) barStart(t);
      const L = M.L, e = M.e, p = M.step, lad = M.lad, bar = M.bar, ch = M.chord;
      const tl = t + (p === 1 || p === 4 ? 0.055 * e : 0) + rnd() * 0.01;      // the lilt: the middle quaver of each group leans late
      const acc = (p === 0 ? 1 : p === 3 ? 0.84 : 0.62) * rr(0.9, 1.06);
      // ---- harp / dulcimer ----
      if (L.harp === 'arp') {
        pluck(tl, lad[M.pat[p]], acc * L.harpV);
        if (L.sparkle && (p === 2 || p === 5) && rnd() < L.sparkle) pluck(tl + e * 0.5, lad[rnd() < 0.5 ? 6 : 7], 0.34, { send: 0.45 });
        if (L.hint && M.mel && (p === 0 || p === 3) && rnd() < L.hint) for (let i = 0; i < M.mel.length; i++) if (M.mel[i][0] === p) pluck(tl + 0.012, M.mel[i][2], 0.62, { send: 0.45 });   // the harp remembers the air
      } else if (L.harp === 'sparse') {
        const low = lad[0] - 12 < 36 ? lad[0] : lad[0] - 12;
        if (p === 0) pluck(tl, low, 0.95, { lp: 2200, send: 0.4 });
        if (p === 3 && bar % 2 === 1) pluck(tl, lad[1] - (lad[1] - 12 < 36 ? 0 : 12), 0.6, { lp: 2200, send: 0.4 });
        if (p === 2 && bar % 4 === 1 && rnd() < 0.6) pluck(tl, lad[2], 0.36, { send: 0.5 });
        if (p === 4 && bar % 4 === 3) pluck(tl, lad[5], 0.3, { send: 0.6 });
      } else if (L.harp === 'title') {
        if (p === 0) { const roll = [0, 2, 3, 4]; for (let i = 0; i < 4; i++) pluck(tl + i * 0.05, lad[roll[i]], 0.8 - i * 0.09, { send: 0.45 }); }
        if (p === 3) pluck(tl, lad[2], 0.5, { send: 0.45 });
        if (p === 4) pluck(tl, lad[3], 0.42, { send: 0.45 });
        if (p === 5 && bar % 2 === 1) pluck(tl, lad[4], 0.4, { send: 0.45 });
      } else if (L.harp === 'coda') {
        if (p === 0) { const roll = [0, 1, 2, 3]; for (let i = 0; i < 4; i++) pluck(tl + i * 0.055, lad[roll[i]], 0.75 - i * 0.08, { send: 0.45 }); }
        if (p === 2) pluck(tl, lad[4], 0.42, { send: 0.45 });
        if (p === 3) pluck(tl, lad[3], 0.46, { send: 0.45 });
        if (p === 4 && bar % 2 === 1) pluck(tl, lad[5], 0.36, { send: 0.5 });
        if (p === 5) pluck(tl, lad[4], 0.3, { send: 0.5 });
      }
      // ---- cello ----
      if (L.bass) {
        if (p === 0) cello.note(t + 0.004, ch.b, (M.bassLong ? 6 : 3) * e, 0.82 * L.bass, { slurOut: !M.bassLong, vib: M.bassLong ? 1 : 0.5 });
        else if (p === 3 && !M.bassLong) cello.note(tl, ch.b2, 3 * e * 0.98, 0.62 * L.bass, {});
      }
      // ---- bodhrán ----
      if (L.drum > 0) {
        const v = M.dpat[p]; if (v) drumHit(tl, v * rr(0.88, 1.05));
        if (M.dpat === DRUMS.fill && p === 5) drumHit(tl + e * 0.5, -0.6);
      }
      // ---- the air, and its counter-melody ----
      if (L.mel > 0 && M.mel) {
        const low = !!M.ent.low || (M.form === 'sail' && M.introLow);
        playLine(low ? lowW : whistle, M.mel, M.melNext, p, tl, e, L.mel, low ? -12 : 0, bar, true);
        if (M.ent.tri && M.form === 'ending') for (let i = 0; i < M.mel.length; i++) { const n = M.mel[i]; if (n[0] === p) fiddle.note(tl + 0.01, n[2], n[1] * e * 0.96, 0.7 * (0.75 + 0.25 * ARCH[bar % 8]), {}); }
      }
      if (L.ctr > 0 && M.ctr) playLine(lowW, M.ctr, null, p, tl, e, L.ctr, 0, bar, false);
      for (let i = 0; i < VOICES.length; i++) { const v = VOICES[i]; if (v.open && v.openEnd <= t + 0.03) v.release(Math.max(v.openEnd, t)); }
    }
    function musicTick(now) {
      if (!M.on) { M.on = true; M.next = now + 0.12; }
      if (M.jump) { M.jump = false; M.next = now + 0.08; M.step = 0; M.bar = 0; M.si = 0; M.force = 'ending'; for (let i = 0; i < VOICES.length; i++) VOICES[i].release(now + 0.02); }
      const look = clamp(frameInt * 2.4 + 0.1, 0.25, 1.2);
      if (M.next < now + 0.015) { M.next = now + 0.05; M.stalls++; }      // fell behind (tab stalled): pick up where we left off, never a burst
      let guard = 0;
      while (M.next < now + look && guard++ < 10) {
        scheduleStep(M.next);
        M.next += M.e; M.step++; if (M.step >= 6) { M.step = 0; M.bar++; }
      }
    }

    // =========================================================================
    // events + per-frame update
    // =========================================================================
    function event(name, data) {
      data = data || {};
      switch (name) {
        case 'lightning': thunder(data.dist); break;
        case 'bump': bump(data.strength); break;
        case 'wreck': wreck(); break;
        case 'bigWave': bigWave(data.strength); break;
        case 'gust': gustSfx(); break;
        case 'pickup': pickup(); break;
        case 'ui:click': click(); break;
        case 'lanternLow': lanternLow(); break;
        case 'lanternOut': lanternOut(); break;
        case 'respawn': recover(1.6); chime(62, { t: ctx.currentTime + 0.4, g: 0.08, send: 0.7 }); break;
        case 'beaconKindling': kindleStart(); break;
        case 'beaconLit': bloom(!!data.isHeart); break;
        case 'heartOpen': M.energy = 1; bell(50, { t: ctx.currentTime + 1.2, g: 0.16, send: 0.7, lp: 2400 }); bell(50, { t: ctx.currentTime + 3.0, g: 0.11, send: 0.7, lp: 2000 }); break;
        case 'ending': M.energy = 1; break;
        case 'start': gustKick = 0.8; chime(50, { t: ctx.currentTime + 0.05, g: 0.12, send: 0.7 }); break;
        case 'restart': M.restart = true; M.jump = false; M.force = null; M.energy = 0; M.bloom = null; recover(0.8); break;
        default: break;
      }
    }
    function update(dt, S, hud) {
      cur.S = S; cur.hud = hud || null;
      const now = ctx.currentTime, fi = lastNow < 0 ? 0.016 : now - lastNow;
      if (fi <= 0) return;
      lastNow = now; frameInt += (Math.min(fi, 1) - frameInt) * 0.2;
      const h = Math.min(fi, 0.25); T += h;
      readInputs(S, hud || null, h);
      driveAmbience(h);
      triggers(h);
      musicTick(now);
      if (meterOn && analyser) {
        if (analyser.getFloatTimeDomainData) {
          analyser.getFloatTimeDomainData(meterBuf);
          for (let i = 0; i < meterBuf.length; i++) { const a = Math.abs(meterBuf[i]); if (a > meter.peak) meter.peak = a; meter.sum += a * a; }
          meter.n += meterBuf.length; meter.frames++;
        }
      }
    }
    function setMaster(v, tc) { if (tc > 0) master.gain.setTargetAtTime(v, ctx.currentTime, tc); else master.gain.value = v; }
    function info() {
      return {
        nodes: nodeCount, shots, liveShots: live, notes: noteCount, plucksCached: Object.keys(plucks).length,
        form: M.form, section: M.ent ? M.ent.s : '', bar: M.bar, step: M.step, bars: M.bars, bpm: Math.round(M.bpm * 10) / 10, stalls: M.stalls,
        chord: M.sec ? M.sec.ch[Math.min(M.bar, M.sec.ch.length - 1)] : '', layers: M.L, melOn: M.melOn, lit: inp.lit, phase: inp.phase,
        danger: Math.round(sm.danger * 100) / 100, muffled: !!muffled, lookahead: Math.round(clamp(frameInt * 2.4 + 0.1, 0.25, 1.2) * 100) / 100,
        peak: Math.round(meter.peak * 1e4) / 1e4, rms: meter.n ? Math.round(Math.sqrt(meter.sum / meter.n) * 1e4) / 1e4 : 0, meterFrames: meter.frames,
      };
    }
    return { ctx, update, event, setMaster, info, taps, master, meterOn(v) { meterOn = v; }, meterReset() { meter.peak = 0; meter.sum = 0; meter.n = 0; meter.frames = 0; } };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================
  let ctx = null, eng = null, failed = false, inited = false, errors = 0, suspendTimer = 0;
  const EVENTS = ['start', 'beaconKindling', 'beaconLit', 'pickup', 'bump', 'wreck', 'lanternOut', 'respawn', 'lightning', 'gust', 'lanternLow', 'pause', 'resume', 'heartOpen', 'ending', 'restart', 'bigWave', 'ui:click'];
  const fail = (e) => { errors++; if (errors < 4 && window.console) console.warn('[TW.audio]', e && e.message ? e.message : e); };
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  function wake() { if (ctx && ctx.state !== 'running' && !A.muted && !hidden()) { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { fail(e); } } }
  function sleep() { if (ctx && ctx.state === 'running') { try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { fail(e); } } }

  const A = TW.audio = {
    muted: false,
    volume: 1,
    init() {
      if (inited) return; inited = true;
      EVENTS.forEach((n) => TW.on(n, (d) => A.event(n, d)));
      try {
        document.addEventListener('visibilitychange', () => { if (hidden()) sleep(); else wake(); });
        // Fallback unlock: the first gesture anywhere starts audio, so the title air can play before "Begin" is pressed.
        const GEST = ['pointerdown', 'keydown', 'touchend'];
        const unlock = () => { if (failed) return; if (!eng) A.start(); else wake(); };
        GEST.forEach((g) => window.addEventListener(g, unlock, true));
      } catch (e) { fail(e); }
    },
    // Call from a user gesture (may be called repeatedly).
    start() {
      if (failed) return;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) { failed = true; return; }
          try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
          try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }
        }
        if (!eng) {
          eng = Engine(ctx, {});
          eng.setMaster(A.muted ? 0 : A.volume * 0.95, 0.6);
          if (TW.q && TW.q.has('audiodebug')) eng.meterOn(true);
        }
        wake(); if (A.muted) sleep();
      } catch (e) { failed = true; eng = null; fail(e); }
    },
    update(dt) {
      if (!eng || ctx.state !== 'running') return;
      try { eng.update(dt, TW.state, TW.game && TW.game.hud); } catch (e) { fail(e); if (errors > 12) { eng = null; failed = true; sleep(); } }
    },
    event(name, data) {
      if (!eng || ctx.state !== 'running') return;
      try { eng.event(name, data); } catch (e) { fail(e); }
    },
    setMuted(b) {
      A.muted = !!b;
      if (!eng) return;
      try {
        clearTimeout(suspendTimer);
        if (A.muted) { eng.setMaster(0, 0.05); suspendTimer = setTimeout(() => { if (A.muted) sleep(); }, 450); }
        else { wake(); eng.setMaster(A.volume * 0.95, 0.08); }
      } catch (e) { fail(e); }
    },
    setVolume(v) {
      A.volume = sat(+v || 0);
      if (eng && !A.muted) { try { eng.setMaster(A.volume * 0.95, 0.08); } catch (e) { fail(e); } }
    },
    // Development surface: context state, node / note counts, where the score is, and a running peak / RMS meter of the master output.
    debug(reset) {
      const d = { started: !!eng, failed, errors, muted: A.muted, volume: A.volume, state: ctx ? ctx.state : 'none', sampleRate: ctx ? ctx.sampleRate : 0, time: ctx ? Math.round(ctx.currentTime * 100) / 100 : 0 };
      if (eng) { try { const i = eng.info(); for (const k in i) d[k] = i[k]; eng.meterOn(true); if (reset) eng.meterReset(); } catch (e) { fail(e); } }
      return d;
    },
    // Render the real engine through an OfflineAudioContext and measure it. Returns a Promise of level statistics.
    //   o = { dur, sr, state:{storm,rain,dawn,phase,lit,speed,danger,vortex,oil,luff,kindle}, anim:{dawn:[0,1],...}, events:[[t,name,data],...] }  (or an array of such)
    selfTest(o) {
      if (Array.isArray(o)) { const out = []; return o.reduce((p, s) => p.then(() => A.selfTest(s)).then((r) => { out.push(r); }), Promise.resolve()).then(() => out); }
      o = o || {};
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = o.sr || 44100, dur = o.dur || 10, NCH = TAPS.length + 2, t0 = performance.now();
      const oc = new OAC(NCH, Math.ceil(sr * dur), sr), st = o.state || {};
      const S = JSON.parse(JSON.stringify(TW.state));
      S.phase = st.phase || 'sailing'; if (!S.heart) S.heart = { hush: 0, t: -1, x: 0, y: 0, z: 0 };
      const setS = (k, v) => {
        if (k === 'lit') { S.litCount = v | 0; } else if (k === 'speed') S.boat.speed = v; else if (k === 'luff') S.boat.luff = v; else if (k === 'oil') S.lantern.oil = v;
        else if (k === 'vortex') S.vortexStrength = v; else if (k === 'hush') S.heart.hush = v; else if (k === 'heartt') S.heart.t = v; else if (k === 'gust') S.wind.gust = v; else if (k === 'roll') S.boat.roll = v; else if (k === 'pitch') S.boat.pitch = v; else if (k !== 'phase' && k !== 'danger' && k !== 'kindle') S[k] = v;
      };
      for (const k in st) setS(k, st[k]);
      const hud = { danger: st.danger || 0, lit: S.litCount, heartOpen: S.litCount >= 5, ring: st.kindle !== undefined ? { index: 0, inRing: true, progress: st.kindle } : null, target: null };
      const e = Engine(oc, { offline: true }); e.setMaster(1, 0);
      const merger = oc.createChannelMerger(NCH), split = oc.createChannelSplitter(2);
      e.master.connect(split); split.connect(merger, 0, 0); split.connect(merger, 1, 1);
      TAPS.forEach((n, i) => { const g = oc.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; e.taps[n].connect(g); g.connect(merger, 0, i + 2); });
      oc.destination.channelInterpretation = 'discrete'; merger.connect(oc.destination);
      const evs = (o.events || []).slice().sort((a, b) => a[0] - b[0]), step = 0.1, anim = o.anim || {};
      const tick = (t) => {
        for (const k in anim) { const v = lerp(anim[k][0], anim[k][1], sat(t / dur)); if (k === 'danger') hud.danger = v; else if (k === 'kindle') hud.ring = { index: 0, inRing: true, progress: v }; else setS(k, v); }
        S.boat.roll = 0.12 * Math.sin(t * 1.1) * S.storm; S.boat.pitch = 0.1 * Math.sin(t * 0.83 + 1) * S.storm;
        if (o.tick) o.tick(t, S, hud);
        while (evs.length && evs[0][0] <= t) { const ev = evs.shift(); if (ev[1] === 'phase') S.phase = ev[2]; else e.event(ev[1], ev[2] || {}); }
        e.update(step, S, hud);
      };
      for (let k = 1; k * step < dur - 0.01; k++) { const t = k * step; oc.suspend(t).then(() => { try { tick(t); } catch (err) { fail(err); } oc.resume(); }); }
      tick(0);
      return oc.startRendering().then((buf) => {
        const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), r4 = (x) => Math.round(x * 1e4) / 1e4;
        let peak = 0, sum = 0, clipped = 0, lr = 0, ll = 0, rrr = 0, dc = 0;
        const win = Math.round(sr * (o.win || 1)), sec = [], a1 = 1 - Math.exp(-TAU * 150 / sr), a2 = 1 - Math.exp(-TAU * 800 / sr), a3 = 1 - Math.exp(-TAU * 4000 / sr); let l1 = 0, l2 = 0, l3 = 0; const bands = [0, 0, 0, 0];
        let ss = 0, sn = 0;
        for (let i = 0; i < n; i++) {
          const l = L[i], r = R[i], a = Math.max(Math.abs(l), Math.abs(r)), m = 0.5 * (l + r);
          if (a > peak) peak = a; if (a >= 0.999) clipped++;
          sum += 0.5 * (l * l + r * r); lr += l * r; ll += l * l; rrr += r * r; dc += m;
          l1 += a1 * (m - l1); l2 += a2 * (m - l2); l3 += a3 * (m - l3);
          bands[0] += l1 * l1; bands[1] += (l2 - l1) * (l2 - l1); bands[2] += (l3 - l2) * (l3 - l2); bands[3] += (m - l3) * (m - l3);
          ss += 0.5 * (l * l + r * r); sn++; if (sn >= win) { sec.push(r4(Math.sqrt(ss / sn))); ss = 0; sn = 0; }
        }
        const bt = bands[0] + bands[1] + bands[2] + bands[3] + 1e-12, tapStats = {};
        TAPS.forEach((name, i) => { const d = buf.getChannelData(i + 2); let p = 0, s = 0; for (let j = 0; j < n; j++) { const a = Math.abs(d[j]); if (a > p) p = a; s += a * a; } tapStats[name] = [r4(Math.sqrt(s / n)), r4(p)]; });
        return {
          name: o.name || '', dur, renderMs: Math.round(performance.now() - t0), peak: r4(peak), rms: r4(Math.sqrt(sum / n)), clipped, dc: r4(dc / n), corrLR: r4(lr / Math.sqrt(ll * rrr + 1e-12)),
          bandsPct: { sub150: Math.round(100 * bands[0] / bt), low800: Math.round(100 * bands[1] / bt), mid4k: Math.round(100 * bands[2] / bt), high: Math.round(100 * bands[3] / bt) },
          rmsPerSec: sec, taps_rms_peak: tapStats, info: e.info(), errors,
        };
      });
    },
  };
})();

