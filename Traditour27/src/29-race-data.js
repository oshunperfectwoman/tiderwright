// ===== 29-race-data.js =====
// ============================================================================
// TIDEWRIGHT — 29-race-data.js
// Race-stage registry. Data only: no rendering, no game-state writes.
// Add new stages here; 73-regatta.js reads TW.races / TW.getRace(id).
//
// start / finish:
//   { x, z, search: { minR, maxR, dirX, dirZ } }
//   The search block nudges the mark toward open water near the nominal point.
// marks: future intermediate marks, same { x, z } shape. Empty for E1.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;

  const races = (TW.races = []);

  races.push({
    id: 'E1',
    title: 'E1 — Sainte-Rose → Morne-à-l’Eau',
    route: 'Première étape · Guadeloupe',
    start: { x: -620, z: -470, search: { minR: 38, maxR: 150, dirX: 0, dirZ: -1 } },
    finish: { x: 650, z: -430, search: { minR: 38, maxR: 175, dirX: 0, dirZ: -1 } },
    gateHalfWidth: 42,
    countdown: 30,
    holdDistance: 18,
    minCourseLength: 100,
    fallback: { dx: 450, dz: -180 },
    // Two intermediate gate centres, placed on the tested open-water corridor.
    marks: [{ at: 0.34 }, { at: 0.68 }],
    markGateHalfWidth: 34,
  });

  TW.raceById = Object.create(null);
  races.forEach((race) => { TW.raceById[race.id] = race; });
  TW.getRace = function (id) { return TW.raceById[id] || null; };
})();
