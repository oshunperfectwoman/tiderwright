// ===== game-settings.js =====
// Central tuning registry. Keep values here editable for the future admin panel.
(function () {
  'use strict';
  const TW = window.TW;
  const RUNTIME_DEFAULTS = { manualWeather: false, storm: null, rain: null, manualWind: false, windAngle: null, windSpeed: null };
  TW.settings = {
    weather: {
      daylight: 0.78,
      initialStorm: 0.28,
      initialRain: 0.07,
      directorBase: 0.28,
      resetBase: 0.85,
      heartOpenBase: 0.84,
      stormSteps: [0.28, 0.26, 0.24, 0.22, 0.20, 0.18],
      rainBaseMin: 0.025,
      rainBaseMax: 0.12,
      furyRainBase: 0.30,
      furyRainNoise: 0.12,
      squallInitialDelay: [70, 40],
      squallCooldown: [55, 65],
      squallDuration: [18, 10],
    },
    wind: {
      direction: [-0.5, 0.866],
      wobbleDegrees: 25,
      speedMin: 7,
      speedMax: 17,
      hushSpeedScale: 0.62,
      initialSpeed: 14,
    },
    ocean: {
      waveScale: 1,
      swellDirection: 0,
      waveSet: [
        [97.0, 2.20, 0.80, 0.0, 1],
        [61.0, 1.40, 0.82, 0.18, 1],
        [37.0, 0.82, 0.86, -0.22, 1],
        [23.0, 0.46, 0.88, 0.78, 0],
        [14.3, 0.24, 0.90, -0.93, 0],
        [9.1, 0.125, 0.85, 0.22, 0],
        [5.7, 0.064, 0.80, 1.38, 0],
        [3.3, 0.030, 0.70, -1.27, 0],
      ],
    },
    world: {
      deep: -80,
      reliefScale: 1,
      cellSize: 2,
      channels: {
        saintes: { ax: -500, az: 470, bx: -125, bz: 505, w: 105, depth: -48 },
      },
      rocksOverride: null,
    },
    runtime: RUNTIME_DEFAULTS,
    navigation: {
      oilTime: 420,
      oilRain: 0.3,
      floatOil: 0.3,
      floatRadius: 7,
      kindleTime: 3.0,
      kindleSpeed: 2.5,
      bounds: 1250,
      endTime: 40,
      cameraMinClear: 1.4,
      crew: {
        members: [
          { x: 0.46, z: 0.12, scale: 0.90 },
          { x: -0.46, z: 0.12, scale: 0.90 },
          { x: 0.00, z: 0.56, scale: 0.86 },
        ],
      },
    },
  };
  // The admin panel may persist terrain settings between reloads.
  function merge(dst, patch) {
    if (!patch || typeof patch !== 'object') return dst;
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') merge(dst[k], v);
      else if (v !== undefined) dst[k] = v;
    });
    return dst;
  }
  try {
    const saved = JSON.parse(localStorage.getItem('tidewright.settings') || 'null');
    if (saved) merge(TW.settings, saved);
  } catch (e) {}
  // Runtime overrides are intentionally temporary: opening the panel must never lock the voyage into manual mode.
  TW.settings.runtime = { manualWeather: false, storm: null, rain: null, manualWind: false, windAngle: null, windSpeed: null };
  TW.saveSettings = function () {
    try { const copy = JSON.parse(JSON.stringify(TW.settings)); delete copy.runtime; localStorage.setItem('tidewright.settings', JSON.stringify(copy)); } catch (e) {}
  };
})();
