// ===== 29-weather-data.js =====
// Generated from traditour_2026_configuration_meteo_manus_v2.csv.
// Data registry only: the game/weather director reads this through TW.getWeather.
(function () {
  'use strict';
  const TW = window.TW;
  const configs = [
  {
    "id": "PROLOGUE",
    "route": {
      "start": "Sainte-Rose",
      "finish": "Sainte-Rose"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_PROLOGUE",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "ENE puis E",
      "averageKnots": 14.0,
      "gustKnots": 22.0,
      "evolution": "13 kn au départ, monte vers 16 kn, oscille entre 13 et 17 kn, termine vers 14 kn"
    },
    "sea": {
      "state": "Peu agitée",
      "swellHeightM": 0.8,
      "swellDirection": "E"
    },
    "rain": "Averses isolées possibles",
    "visibilityKm": "15-20",
    "grains": {
      "presence": "Non organisé ; pas de grain marqué prévu",
      "trajectory": "Aucun grain structuré ; petites averses locales sans trajectoire imposée"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E1",
    "route": {
      "start": "Sainte-Rose",
      "finish": "Morne-à-l'Eau"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E1",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "E",
      "averageKnots": 16.0,
      "gustKnots": 25.0,
      "evolution": "15-17 kn au départ, renforcement à 18-19 kn, molle temporaire au milieu, environ 16 kn à l'arrivée"
    },
    "sea": {
      "state": "Peu agitée à modérée",
      "swellHeightM": 1.0,
      "swellDirection": "E"
    },
    "rain": "Averses éparses possibles",
    "visibilityKm": "12-20",
    "grains": {
      "presence": "Un grain isolé possible",
      "trajectory": "Cellule isolée se déplaçant d'est en ouest, à distance du parcours ; ne pas bloquer toute la flotte"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E2",
    "route": {
      "start": "Morne-à-l'Eau",
      "finish": "Port-Louis"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E2",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "ENE puis E",
      "averageKnots": 12.0,
      "gustKnots": 21.0,
      "evolution": "Vent irrégulier de 10-13 kn, molles à 7-9 kn, reprise à 15-16 kn en fin de course"
    },
    "sea": {
      "state": "Peu agitée",
      "swellHeightM": 0.7,
      "swellDirection": "ENE"
    },
    "rain": "Petites averses lointaines possibles",
    "visibilityKm": "12-18",
    "grains": {
      "presence": "Faible ; petites cellules pluvieuses possibles",
      "trajectory": "Petites cellules dérivant d'est en ouest en restant majoritairement hors de l'axe de course"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E3",
    "route": {
      "start": "Port-Louis",
      "finish": "Deshaies"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E3",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "E",
      "averageKnots": 18.0,
      "gustKnots": 28.0,
      "evolution": "16-18 kn au départ, renforcement à 20-22 kn dans le dernier tiers, puis baisse vers 17 kn"
    },
    "sea": {
      "state": "Modérée à agitée",
      "swellHeightM": 1.3,
      "swellDirection": "E"
    },
    "rain": "Averses possibles",
    "visibilityKm": "10-18",
    "grains": {
      "presence": "Un grain modéré possible",
      "trajectory": "Un grain traverse obliquement la zone de course d'est en ouest ; rafales renforcées pendant son passage"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E4",
    "route": {
      "start": "Vieux-Habitants",
      "finish": "Gourbeyre"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E4",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "ESE puis E",
      "averageKnots": 13.0,
      "gustKnots": 23.0,
      "evolution": "12-14 kn au départ, molles locales à 6-8 kn, accélérations dans les couloirs jusqu'à 17-19 kn"
    },
    "sea": {
      "state": "Peu agitée à modérée",
      "swellHeightM": 0.9,
      "swellDirection": "SE"
    },
    "rain": "Averses localisées",
    "visibilityKm": "8-16",
    "grains": {
      "presence": "Cellules convectives localisées possibles",
      "trajectory": "Petites cellules se déplacent du sud-est vers le nord-ouest ; passage possible près des reliefs"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E5",
    "route": {
      "start": "Gourbeyre",
      "finish": "Capesterre"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E5",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "E",
      "averageKnots": 17.0,
      "gustKnots": 27.0,
      "evolution": "15-17 kn au départ, renforcement à 19-21 kn, variations rapides sous les nuages, légère baisse en fin de course"
    },
    "sea": {
      "state": "Modérée à agitée",
      "swellHeightM": 1.2,
      "swellDirection": "ESE"
    },
    "rain": "Averses parfois soutenues",
    "visibilityKm": "10-18",
    "grains": {
      "presence": "Un ou deux grains modérés possibles",
      "trajectory": "Une ou deux cellules se déplacent d'est en ouest ; zone de rafales et pluie intense temporaire"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E6",
    "route": {
      "start": "Capesterre",
      "finish": "Pointe-à-Pitre"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E6",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "ENE puis E",
      "averageKnots": 15.0,
      "gustKnots": 25.0,
      "evolution": "14-16 kn au départ, molles à 9-11 kn, reprise à 18-20 kn, rotation progressive de ENE vers E"
    },
    "sea": {
      "state": "Peu agitée à modérée",
      "swellHeightM": 1.0,
      "swellDirection": "E"
    },
    "rain": "Averse isolée possible",
    "visibilityKm": "12-20",
    "grains": {
      "presence": "Un grain isolé possible près de l'arrivée",
      "trajectory": "Petite cellule dérivant d'est en ouest, pouvant couper l'approche finale"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E7",
    "route": {
      "start": "A_REPRENDRE_DU_PARCOURS_EXISTANT_E7",
      "finish": "A_REPRENDRE_DU_PARCOURS_EXISTANT_E7"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E7",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT ; ETAPE DE NUIT",
    "wind": {
      "direction": "E",
      "averageKnots": 11.0,
      "gustKnots": 19.0,
      "evolution": "10-12 kn au départ, possible molle en début de nuit, reprises à 14-16 kn ; direction assez stable"
    },
    "sea": {
      "state": "Peu agitée",
      "swellHeightM": 0.8,
      "swellDirection": "E"
    },
    "rain": "Averse isolée possible",
    "visibilityKm": "8-15",
    "grains": {
      "presence": "Pas de grain fort prévu",
      "trajectory": "Aucune trajectoire de grain imposée ; éventuelle averse faible en bord de parcours"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E8",
    "route": {
      "start": "Pointe-à-Pitre",
      "finish": "Sainte-Anne"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E8",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT",
    "wind": {
      "direction": "E",
      "averageKnots": 19.0,
      "gustKnots": 29.0,
      "evolution": "17-19 kn au départ, renforcement à 21-23 kn au milieu, rafales jusqu'à 29 kn, légère baisse à l'arrivée"
    },
    "sea": {
      "state": "Modérée à agitée",
      "swellHeightM": 1.4,
      "swellDirection": "E"
    },
    "rain": "Averses et passages pluvieux possibles",
    "visibilityKm": "10-20",
    "grains": {
      "presence": "Un grain modéré possible",
      "trajectory": "Cellule se déplaçant d'est en ouest à travers une partie du parcours ; rafales et pluie pendant le passage"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E9",
    "route": {
      "start": "A_REPRENDRE_DU_PARCOURS_EXISTANT_E9",
      "finish": "A_REPRENDRE_DU_PARCOURS_EXISTANT_E9"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E9",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT_E9",
    "wind": {
      "direction": "ENE",
      "averageKnots": 14.0,
      "gustKnots": 24.0,
      "evolution": "13-15 kn au départ, molle temporaire à 8-10 kn, reprise à 17-19 kn en zone exposée"
    },
    "sea": {
      "state": "Peu agitée à modérée",
      "swellHeightM": 1.1,
      "swellDirection": "E"
    },
    "rain": "Averses localisées possibles",
    "visibilityKm": "10-18",
    "grains": {
      "presence": "Un grain isolé possible",
      "trajectory": "Cellule isolée dérivant d'est en ouest, à positionner pour créer un choix tactique sans couvrir tout le parcours"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  },
  {
    "id": "E10",
    "route": {
      "start": "A_REPRENDRE_DU_PARCOURS_EXISTANT_E10",
      "finish": "Ti Kanpo (à confirmer avec le parcours du jeu)"
    },
    "marksSource": "A_EXTRAIRE_DU_PARCOURS_EXISTANT_E10",
    "durationOrDistance": "CONSERVER_DISTANCE_ET_DUREE_DU_PARCOURS_EXISTANT_E10",
    "wind": {
      "direction": "ENE puis E",
      "averageKnots": 14.0,
      "gustKnots": 24.0,
      "evolution": "Vent variable : 13-15 kn, molle à 8-10 kn, reprise à 17-19 kn, puis environ 14 kn en fin de course"
    },
    "sea": {
      "state": "Peu agitée à modérée",
      "swellHeightM": 1.1,
      "swellDirection": "E"
    },
    "rain": "Averses localisées possibles",
    "visibilityKm": "10-18",
    "grains": {
      "presence": "Un grain isolé possible",
      "trajectory": "Cellule isolée dérivant d'est en ouest ; passage possible sur un secteur du parcours, laissant une route alternative"
    },
    "source": "traditour_2026_configuration_meteo_manus_v2.csv"
  }
];
  TW.weatherConfigs = configs;
  TW.weatherByStage = Object.create(null);
  configs.forEach((cfg) => { TW.weatherByStage[cfg.id] = cfg; });
  TW.getWeather = function (id) { return TW.weatherByStage[id] || null; };
})();
