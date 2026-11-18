// ===== 29-rocks.js =====
// Hand-authored hazards and the sea arch. Geometry logic remains in 30-world.js.
(function () {
  'use strict';
  const TW = window.TW;
  // hand-placed hazards: [x, z, r, h, lean]
  const ROCKS_HAND = [
    [-700, -25, 6, 14, 0], [-655, 30, 5, 9, 0], [-610, -55, 7, 19, 0.5], [-735, 100, 5, 6, 0],
    [-300, 700, 6, 12, 0], [-235, 745, 5, 7, 0], [-40, 690, 6, 15, 0.6],
    [430, -130, 7, 20, 0], [475, -65, 5, 9, 0], [390, -195, 6, 13, 0.4],
    [300, 300, 6, 16, 0.7], [345, 345, 5, 8, 0],
    [-80, -560, 7, 22, 0], [-30, -612, 5, 10, 0],
    [700, 330, 6, 14, 0.5], [760, 380, 5, 8, 0],
  ];
  const ARCH = { ax: -520, az: 370, bx: -490, bz: 378, h: 19, r: 6.5 };   // a sea arch off Basse-Terre
  TW.worldRocks = { ROCKS_HAND, ARCH };
})();
