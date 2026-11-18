// ===== 29-lighthouses.js =====
// Navigation-light data kept separate from island geometry.
(function () {
  'use strict';
  const TW = window.TW;
  TW.worldLighthouses = {
    'Grande-Terre': { bname: 'Feu de la Pointe des Châteaux — Saint-François', lhPos: [246, 18], lhAng: 0.2, lhBack: 18, padMin: 10, padMax: 15 },
    'La Désirade': { bname: 'Phare de la Pointe Doublé — La Désirade', lhPos: [104, 0], lhAng: 0.55, lhBack: 15, padMin: 11, padMax: 17 },
    'Marie-Galante': { bname: 'Feu du port de Grand-Bourg — Marie-Galante', lhPos: [-148, 48], lhAng: -0.5, lhBack: 20, padMin: 12, padMax: 18 },
    'Terre-de-Haut': { bname: 'Feu du Bourg des Saintes — Terre-de-Haut', lhPos: [-8, -42], lhAng: -0.8, lhBack: 16, padMin: 13, padMax: 19 },
    'Terre-de-Bas': { bname: 'Feu de Terre-de-Bas — Les Saintes', lhPos: [52, -20], lhAng: 0.65, lhBack: 16, padMin: 12, padMax: 18 },
    'Basse-Terre': { bname: 'Phare de Vieux-Fort — Basse-Terre', lhPos: [-178, 330] },
  };
})();
