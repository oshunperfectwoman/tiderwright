// ===== 29-world-data.js =====
// Tidewright world data. This file is deliberately data-only; generation remains in 30-world.js.
(function () {
  'use strict';
  const TW = window.TW;
  const ISLES = (TW.worldIslands || []).map((I) => Object.assign({}, I, (TW.worldLighthouses || {})[I.name] || {}));
  const ROCKS_HAND = (TW.worldRocks || {}).ROCKS_HAND || [];
  const ARCH = (TW.worldRocks || {}).ARCH;
  const SAINTES_CHANNEL = (TW.worldChannels || {}).SAINTES_CHANNEL;
  const FLOATS_HAND = [
    [-590, 735], [-440, 400], [-345, 245], [-720, 215], [-672, -12], [-380, -250], [-330, -650], [-40, -802],
    [60, -360], [470, -610], [440, -400], [600, 40], [730, 260], [300, 385], [128, 640], [170, 165], [-120, 760],
  ];
  const SPAWN_DIR = [-0.42, 0.908], SPAWN_DIST = 265, MAW_DIST = 265, MAW_R = 120;
  TW.worldData = { ISLES, ROCKS_HAND, ARCH, SAINTES_CHANNEL, FLOATS_HAND, SPAWN_DIR, SPAWN_DIST, MAW_DIST, MAW_R };
})();
