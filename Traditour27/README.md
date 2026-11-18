# Tidewright — source organisée

Cette première étape du refactoring est volontairement mécanique. Le code n’a pas été réécrit : les sections JavaScript existantes ont été extraites dans `src/` en conservant exactement leur ordre et leur contenu.

## Construire le jeu

Depuis ce dossier :

```bash
python3 build.py
```

Le script génère `../Tidewright.rebuilt.html`. Une comparaison octet par octet avec `../Tidewright.html` doit être identique avant toute modification fonctionnelle.

## Sections actuelles

- `00-core.js` : noyau, état et utilitaires
- `game-settings.js` : registre central des paramètres modifiables
- `10-env.js` : environnement WebGL et éclairage
- `20-sky.js` : ciel
- `21-ocean.js` : océan et houle
- `29-islands.js` : formes, positions et reliefs des îles
- `29-lighthouses.js` : noms, positions et paramètres des phares
- `29-rocks.js` : rochers placés à la main et arche marine
- `29-channels.js` : zones de navigation et corrections de profondeur
- `29-world-data.js` : assemblage des données du monde, flottants et départ
- `29-race-data.js` : registre des étapes de régate (E1 : Sainte-Rose → Morne-à-l’Eau)
- `30-world.js` : génération des îles, relief, profondeurs, phares et rochers
- `40-boat.js` : bateau
- `41-fx.js` : pluie, embruns et effets
- `50-post.js` : post-traitement visuel
- `60-audio.js` : musique et paysage sonore
- `70-game.js` : logique de jeu, navigation et météo
- `71-ui.js` : interface et carte
- `72-admin.js` : panneau de réglages en direct (F2)
- `72-fleet.js` : adversaires IA de la régate solo, désactivés lors d’une course en ligne
- `73-regatta.js` : mission de régate, HUD, compte à rebours, chrono, lignes et arrivée
- `74-multiplayer.js` : client Colyseus optionnel et rendu des autres voiliers
- `90-main.js` : initialisation et boucle principale

## Régate

La première étape est disponible depuis l’écran titre (`Régate E1`) et depuis
la barre d’outils en jeu (bouton drapeau). Le module `73-regatta.js` :

- place le bateau derrière la ligne de départ et le maintient pendant le compte à rebours ;
- ajoute quatre bouées 3D temporaires via `TW.world.setRaceBuoys` (or au départ, cyan à l’arrivée) ;
- affiche les lignes de départ/arrivée, le chrono, la distance, la progression et le cap ;
- impose le franchissement ordonné des portes intermédiaires avant l’arrivée ;
- enregistre pour chaque concurrent ses temps de passage, son temps final et son classement ;
- affiche les portes de départ (or), intermédiaires (vert) et d’arrivée (cyan) ;
- enregistre le meilleur temps par étape dans `localStorage` ;
- neutralise les objectifs et le kindling de l’aventure pendant la course via `TW.game.setRaceMode`.

Les étapes suivantes se déclarent dans `29-race-data.js`. Chaque entrée de `marks`
est le centre d'une porte intermédiaire (coordonnées `x`/`z` ou fraction `at` du
parcours). Chaque porte possède deux bouées et doit être franchie dans l'ordre.
L'éditeur de parcours permet de déplacer ou d'ajouter ces centres.

## Paramètres centralisés

`game-settings.js` regroupe progressivement les réglages de la météo, du vent, de la houle, des canaux et de la navigation. Le panneau F2 (`72-admin.js`) permet déjà de modifier ce registre puis de demander une reconstruction du monde.

## Paramètres centralisés

`game-settings.js` regroupe progressivement les réglages de la météo, du vent, de la houle, des canaux et de la navigation. La future page d’administration pourra modifier ce registre puis demander une reconstruction du monde.

## Mode multijoueur (Colyseus)

L’intégration multijoueur est optionnelle : le solo reste le comportement par défaut. En mode connecté, le jeu synchronise les poses de navigation, les objectifs, la météo et les contacts entre bateaux; les courses partagent leur départ, leurs portes et leur classement serveur. Pour les essais locaux, démarrer `colyseus-server/` avec `npm ci && npm run dev:server`, reconstruire le jeu avec `python3 build.py`, puis ouvrir `Tidewright.rebuilt.html?multi=1` dans deux onglets servis en HTTP. L’installation, le protocole, les limites et les précautions de déploiement sont dans [`MULTIPLAYER.md`](MULTIPLAYER.md).
