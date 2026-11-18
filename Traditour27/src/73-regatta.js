// ===== 73-regatta.js =====
// ============================================================================
// TIDEWRIGHT — 73-regatta.js
// Regatta mission layer: HUD, gate placement, countdown, timing, progress and
// finish detection. The boat remains driven by 70-game.js; temporary 3D buoys
// are rendered by TW.world.setRaceBuoys. Stage data lives in 29-race-data.js.
// OWNER: agent REGATTA.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;
  const DEG = 180 / Math.PI;

  const R = (TW.regattaState = {
    stage: null,
    phase: 'idle',              // idle | countdown | racing | finished
    countdown: 0,
    goT: 0,
    elapsed: 0,
    prevStartSide: -1,
    falseStartCount: 0,
    falseStartT: 0,
    finishT: 0,
    playerFinished: false,
    playerTime: 0,
    playerRank: 0,
    total: 0,
    editor: { active: false, drag: -1, selected: -1, dirty: false, points: null },
    best: null,
    gate: { sx: 0, sz: 0, fx: 0, fz: 0, px: 0, pz: 0, ux: 0, uz: 0, half: 42, ready: false },
    courseGates: [],
    competitors: Object.create(null),
    playerPrev: { x: 0, z: 0 },
    hold: { x: 0, z: 0, heading: 0 },
    prevFinishSide: -1,
    hudAcc: 0,
    lastNow: 0,
    networkAuthority: false,
    networkPlayers: [],
    networkFalseStartRevision: 0,
    ui: {},
  });

  let built = false;

  const CSS = `
#tw-regatta{position:fixed;z-index:240;left:max(14px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));width:min(340px,calc(100vw - 28px));color:var(--tw-foam,#e9efe6);font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;text-shadow:0 1px 8px #00131c;display:none}
#tw-regatta.tw-rg-open{display:block}
#tw-regatta .tw-rg-panel{pointer-events:auto;position:relative;background:linear-gradient(145deg,rgba(8,17,24,.94),rgba(16,32,43,.88));border:1px solid rgba(255,180,90,.38);border-radius:12px;padding:15px 16px 13px;box-shadow:0 14px 42px rgba(0,0,0,.55);backdrop-filter:blur(12px)}
#tw-regatta .tw-rg-eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--tw-verdigris,#6fb7a6);font-weight:700}
#tw-regatta h2{margin:4px 0 2px;color:var(--tw-foam,#e9efe6);font:600 20px/1.15 Georgia,"Times New Roman",serif;letter-spacing:.01em;padding-right:24px}
#tw-regatta .tw-rg-route{font-size:11px;color:var(--tw-mist,#9fb3b8);margin-bottom:12px}
#tw-regatta .tw-rg-fleet{display:grid;gap:3px;margin:8px 0 4px;font-size:10px;color:var(--tw-mist,#9fb3b8)}
#tw-regatta .tw-rg-fleet b{font-weight:700;color:var(--tw-foam,#e9efe6)}
#tw-regatta .tw-rg-close{position:absolute;right:8px;top:8px;width:30px;height:30px;border:0;background:transparent;color:var(--tw-mist,#9fb3b8);font:22px/1 system-ui;cursor:pointer;padding:0}
#tw-regatta .tw-rg-close:hover{color:var(--tw-foam,#e9efe6)}
#tw-regatta .tw-rg-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
#tw-regatta .tw-rg-stat{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);border-radius:7px;padding:7px 9px}
#tw-regatta .tw-rg-stat small{display:block;color:var(--tw-mist,#9fb3b8);font-size:9px;text-transform:uppercase;letter-spacing:.1em}
#tw-regatta .tw-rg-stat strong{display:block;margin-top:2px;font-size:17px;font-variant-numeric:tabular-nums;color:var(--tw-foam,#e9efe6)}
#tw-regatta .tw-rg-best{font-size:10px;color:var(--tw-verdigris,#6fb7a6);min-height:1.2em;margin:-4px 0 6px}
#tw-regatta .tw-rg-bar{height:4px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;margin:7px 0 0}
#tw-regatta .tw-rg-bar i{display:block;height:100%;width:0;background:var(--tw-ember,#ffb45a);transition:width .15s linear}
#tw-regatta .tw-rg-compass{display:flex;align-items:center;gap:9px;margin-top:10px;font-size:11px;color:var(--tw-foam,#e9efe6)}
#tw-regatta .tw-rg-needle{width:27px;height:27px;border:1px solid rgba(111,183,166,.7);border-radius:50%;display:grid;place-items:center;color:var(--tw-ember,#ffb45a);font-size:17px;flex:none;transition:transform .12s linear}
#tw-regatta .tw-rg-done{color:var(--tw-ember,#ffb45a);font-weight:700}
#tw-regatta .tw-rg-actions{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
#tw-regatta .tw-rg-action{flex:1 1 100%;border:0;border-radius:7px;padding:10px 12px;background:var(--tw-ember,#ffb45a);color:var(--tw-ink,#0a1118);font-weight:800;font-size:12px;letter-spacing:.04em;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.28)}
#tw-regatta .tw-rg-action:hover{background:#ffc77a}
#tw-regatta .tw-rg-action:active{transform:translateY(1px);box-shadow:0 2px 0 rgba(0,0,0,.28)}
#tw-regatta .tw-rg-action:disabled{opacity:.55;cursor:default;transform:none}
#tw-regatta .tw-rg-secondary{border:1px solid rgba(255,180,90,.4);border-radius:7px;background:transparent;color:var(--tw-ember,#ffb45a);padding:8px 10px;font-size:11px;cursor:pointer}
#tw-regatta .tw-rg-secondary:hover{background:rgba(255,180,90,.1)}
#tw-rg-liveboard{position:fixed;z-index:238;right:max(14px,env(safe-area-inset-right));top:86px;width:min(300px,calc(100vw - 28px));display:none;pointer-events:none;color:#f2f7f8;font:12px/1.35 Inter,"Segoe UI",Roboto,Arial,sans-serif;text-shadow:0 1px 8px #00131c}
#tw-rg-liveboard.tw-rg-liveboard--on{display:block}
#tw-rg-liveboard .tw-rg-live-panel{background:rgba(8,28,43,.88);border:1px solid rgba(32,216,208,.42);border-radius:8px;padding:11px 12px 10px;box-shadow:0 14px 36px rgba(0,0,0,.35);backdrop-filter:blur(14px)}
#tw-rg-liveboard .tw-rg-live-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:7px;color:#20d8d0;font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}
#tw-rg-liveboard .tw-rg-live-sub{color:#9bb7c8;font:10px Inter,"Segoe UI",sans-serif;letter-spacing:.04em;text-transform:none}
#tw-rg-liveboard .tw-rg-live-row{display:grid;grid-template-columns:18px 27px minmax(0,1fr) auto;gap:6px;align-items:center;min-height:25px;border-top:1px solid rgba(175,207,222,.12);font-variant-numeric:tabular-nums}
#tw-rg-liveboard .tw-rg-live-row:first-child{border-top:0}
#tw-rg-liveboard .tw-rg-live-row--player{color:#20d8d0;font-weight:800;background:rgba(32,216,208,.08)}
#tw-rg-liveboard .tw-rg-live-row--leader .tw-rg-live-rank{color:#b8f36b}
#tw-rg-liveboard .tw-rg-live-row--done .tw-rg-live-gap{color:#20d8d0}
#tw-rg-liveboard .tw-rg-live-rank{color:#20d8d0;text-align:center;font-weight:800}
#tw-rg-liveboard .tw-rg-live-boat{color:#f2f7f8;font-weight:800}
#tw-rg-liveboard .tw-rg-live-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tw-rg-liveboard .tw-rg-live-gap{color:#9bb7c8;text-align:right;white-space:nowrap}
#tw-rg-liveboard .tw-rg-live-final{display:none;margin-top:9px;padding-top:8px;border-top:1px solid rgba(32,216,208,.35);color:#f2f7f8;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
#tw-rg-liveboard.tw-rg-liveboard--final .tw-rg-live-final{display:block;color:#20d8d0}
#tw-rg-liveboard .tw-rg-results{display:none;margin-top:7px}
#tw-rg-liveboard.tw-rg-liveboard--final .tw-rg-results{display:block}
#tw-rg-liveboard.tw-rg-liveboard--final .tw-rg-live-rows,#tw-rg-liveboard.tw-rg-liveboard--final .tw-rg-director{display:none}
#tw-rg-liveboard .tw-rg-results-title{margin:0 0 5px;color:#f2f7f8;font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
#tw-rg-liveboard .tw-rg-result{padding:5px 3px;border-top:1px solid rgba(175,207,222,.14);font-variant-numeric:tabular-nums}
#tw-rg-liveboard .tw-rg-result--player{background:rgba(32,216,208,.08);color:#20d8d0}
#tw-rg-liveboard .tw-rg-result-main{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:6px;align-items:center;font-size:10px}
#tw-rg-liveboard .tw-rg-result-rank{color:#20d8d0;font-weight:900;text-align:center}
#tw-rg-liveboard .tw-rg-result-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}
#tw-rg-liveboard .tw-rg-result-time{color:#f2f7f8;font-weight:800;white-space:nowrap}
#tw-rg-liveboard .tw-rg-result-splits{display:flex;flex-wrap:wrap;gap:2px 8px;margin:3px 0 0 26px;color:#9bb7c8;font-size:9px;line-height:1.3}
#tw-rg-liveboard.tw-rg-liveboard--final .tw-rg-live-panel{max-height:calc(100vh - 96px);overflow:auto}
#tw-rg-liveboard .tw-rg-director{margin-top:10px;padding-top:9px;border-top:1px solid rgba(175,207,222,.18)}
#tw-rg-liveboard .tw-rg-director-title{display:flex;justify-content:space-between;color:#f2f7f8;font:800 10px/1 Inter,"Segoe UI",sans-serif;letter-spacing:.14em;text-transform:uppercase}
#tw-rg-liveboard .tw-rg-director-state{color:#b8f36b}
#tw-rg-liveboard .tw-rg-tactical{display:block;width:100%;height:auto;margin-top:7px;border:1px solid rgba(175,207,222,.16);border-radius:5px;background:rgba(7,23,37,.45)}
#tw-rg-liveboard .tw-rg-course{fill:none;stroke:rgba(242,247,248,.42);stroke-width:1.5;stroke-dasharray:4 3}
#tw-rg-liveboard .tw-rg-start{stroke:#b8f36b;stroke-width:2}.tw-rg-finish{stroke:#20d8d0;stroke-width:2}
#tw-rg-liveboard .tw-rg-tactical-boat circle{fill:#ff754f;stroke:#f2f7f8;stroke-width:.7}.tw-rg-liveboard .tw-rg-tactical-boat--player circle{fill:#20d8d0;r:4.5}
#tw-rg-liveboard .tw-rg-tactical-boat text{fill:#f2f7f8;font:700 8px Inter,"Segoe UI",sans-serif}
#tw-rg-liveboard .tw-rg-history{display:grid;gap:2px;margin-top:6px;color:#9bb7c8;font-size:9px;letter-spacing:.02em}
@media(max-width:600px){#tw-rg-liveboard{right:10px;top:78px;width:min(245px,calc(100vw - 20px));font-size:11px}#tw-rg-liveboard .tw-rg-live-row{min-height:22px;grid-template-columns:16px 23px minmax(0,1fr) auto}}
#tw-regatta .tw-rg-hint{font-size:10px;color:var(--tw-mist,#9fb3b8);margin-top:8px;min-height:2.4em}
#tw-race-markers{position:fixed;inset:0;z-index:230;pointer-events:none;overflow:hidden}
.tw-rg-editor .tw-rg-buoy{width:20px;height:20px;margin:-10px 0 0 -10px;pointer-events:auto;cursor:grab;border-width:2px;box-shadow:0 0 16px currentColor,0 0 3px #fff}
.tw-rg-editor .tw-rg-buoy:active{cursor:grabbing;transform:scale(1.18)}
#tw-rg-editor-box{position:fixed;z-index:260;right:max(14px,env(safe-area-inset-right));top:max(70px,calc(14px + env(safe-area-inset-top)));width:min(290px,calc(100vw - 28px));display:none;pointer-events:auto;color:var(--tw-foam,#e9efe6);font:12px/1.4 system-ui,sans-serif;text-shadow:0 1px 8px #00131c}
body.tw-rg-editor #tw-rg-editor-box{display:block}
body.tw-rg-editor .twui-chart.twui-on{opacity:1!important;visibility:visible!important;transform:none!important}
#tw-rg-editor-box .tw-rg-editor-panel{background:linear-gradient(145deg,rgba(8,17,24,.96),rgba(16,32,43,.9));border:1px solid rgba(111,183,166,.65);border-radius:10px;padding:12px 13px;box-shadow:0 14px 42px rgba(0,0,0,.5);backdrop-filter:blur(12px)}
#tw-rg-editor-box strong{display:block;color:var(--tw-ember,#ffb45a);font-size:13px;margin-bottom:3px}
#tw-rg-editor-box p{margin:4px 0 10px;color:var(--tw-mist,#9fb3b8)}
#tw-rg-editor-box .tw-rg-editor-actions{display:flex;gap:7px;flex-wrap:wrap}
#tw-rg-editor-box .tw-rg-editor-tools{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin:7px 0 9px}
#tw-rg-editor-box .tw-rg-editor-tools button{padding:6px 7px;font-size:10px}
#tw-rg-editor-box .tw-rg-editor-selection{display:block;width:100%;color:var(--tw-mist,#9fb3b8);font-size:10px}
#tw-rg-editor-box button{border:1px solid rgba(255,180,90,.5);border-radius:6px;background:transparent;color:var(--tw-ember,#ffb45a);padding:7px 9px;font-size:11px;cursor:pointer}
#tw-rg-editor-box button.tw-rg-editor-save{background:var(--tw-ember,#ffb45a);color:var(--tw-ink,#0a1118);font-weight:800}
.tw-rg-buoy{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;border:1px solid rgba(255,255,255,.7);box-shadow:0 0 8px currentColor;background:currentColor;display:none}
.tw-rg-buoy--start{color:#ffd84a}.tw-rg-buoy--finish{color:#22eaff}.tw-rg-buoy--mark{color:#b8f36b}.tw-rg-buoy--selected{transform:scale(1.45);box-shadow:0 0 16px currentColor,0 0 0 2px #fff}
#tw-rg-countdown{position:fixed;z-index:250;left:50%;top:18%;transform:translate(-50%,-50%);font:900 clamp(48px,10vw,104px)/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 12px #ffcf39,0 0 35px #ff9d24,0 4px 18px #00131c;text-align:center;pointer-events:none;letter-spacing:.03em}
#tw-rg-countdown .tw-rg-cd-num{display:block}
#tw-rg-countdown small{display:block;font-size:clamp(12px,2vw,19px);letter-spacing:.2em;color:#ffe7a1;margin-top:8px}
#tw-rg-finish-fx{position:fixed;z-index:255;left:50%;top:39%;transform:translate(-50%,-50%) scale(.7);opacity:0;pointer-events:none;text-align:center;color:#fff;filter:drop-shadow(0 0 18px #ffbd58);font:900 clamp(38px,8vw,86px)/.95 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
#tw-rg-finish-fx small{display:block;margin-top:13px;color:#ffe7a1;font-size:clamp(11px,1.8vw,18px);letter-spacing:.24em}
#tw-rg-finish-fx.tw-rg-finish-fx--on{animation:tw-rg-finish-pop 1.8s cubic-bezier(.2,.8,.25,1) both}
body.tw-rg-finish-flash #tw-canvas{animation:tw-rg-finish-flash .55s ease-out both}
@keyframes tw-rg-finish-pop{0%{opacity:0;transform:translate(-50%,-50%) scale(.68)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}35%{opacity:1;transform:translate(-50%,-50%) scale(1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-58%) scale(1.04)}}
@keyframes tw-rg-finish-flash{0%{filter:brightness(1)}18%{filter:brightness(1.55)}100%{filter:brightness(1)}}
body.tw-race-panel-open .twui-beacons,body.tw-race-active .twui-beacons{opacity:0!important;pointer-events:none}
@media(max-width:600px){#tw-regatta{width:min(300px,calc(100vw - 24px));left:12px;top:max(12px,env(safe-area-inset-top))}#tw-regatta .tw-rg-panel{padding:12px 13px 11px}#tw-regatta h2{font-size:18px}}
/* TradiTour 2027 race controls: same glass/cyan language as the main HUD. */
#tw-regatta{font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif;color:#f2f7f8}
#tw-regatta .tw-rg-panel{background:rgba(8,28,43,.88);border-color:rgba(32,216,208,.42);border-radius:8px;backdrop-filter:blur(14px);box-shadow:0 16px 42px rgba(0,0,0,.35)}
#tw-regatta h2{font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
#tw-regatta .tw-rg-eyebrow,#tw-regatta .tw-rg-best{color:#20d8d0}
#tw-regatta .tw-rg-action{background:#20d8d0;color:#071725;border-color:#20d8d0;border-radius:7px}
#tw-regatta .tw-rg-secondary{border-color:rgba(175,207,222,.28);color:#20d8d0;border-radius:7px}
#tw-rg-countdown{font-family:"Rajdhani","Arial Narrow",Inter,sans-serif;color:#f2f7f8;text-shadow:0 0 16px rgba(32,216,208,.75),0 0 42px rgba(37,139,255,.45)}
#tw-rg-countdown small{color:#20d8d0;font-family:Inter,"Segoe UI",sans-serif;font-weight:800}
#tw-rg-finish-fx{filter:drop-shadow(0 0 18px rgba(32,216,208,.72));font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif}
#tw-rg-finish-fx small{color:#20d8d0;font-family:Inter,"Segoe UI",sans-serif}
`;

  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function sponsorMount(id, parent, cls, stageId) {
    if (!TW.sponsors || !parent) return null;
    const node = TW.sponsors.mount(id, parent, cls, stageId || 'E1');
    if (node) TW.sponsors.setConnected(id, true);
    return node;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const fmt = (t) => {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };
  const fmtPrecise = (t) => {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t - Math.floor(t)) * 100);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function loadBest(id) {
    try {
      const v = parseFloat(localStorage.getItem('tidewright.race.' + id + '.best'));
      return isFinite(v) && v > 0 ? v : null;
    } catch (e) { return null; }
  }
  function saveBest(id, t) {
    try { localStorage.setItem('tidewright.race.' + id + '.best', String(t)); } catch (e) { /* storage may be unavailable */ }
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  function build() {
    if (built) return;
    const style = el('style');
    style.textContent = CSS + '\n#tw-regatta .tw-rg-sponsor-stage{width:86px;height:24px;margin:5px 0;opacity:.9}#tw-rg-countdown .tw-rg-sponsor-countdown{width:72px;height:22px;margin:9px auto 0;opacity:.92}#tw-rg-finish-fx .tw-rg-sponsor-finish{width:82px;height:24px;margin:12px auto 0;opacity:.92}#tw-rg-liveboard .tw-rg-sponsor-results{width:70px;height:22px;margin:7px auto 0;opacity:.85}#tw-rg-liveboard .tw-rg-sponsor-results img,#tw-regatta .tw-rg-sponsor-stage img,#tw-rg-countdown .tw-rg-sponsor-countdown img,#tw-rg-finish-fx .tw-rg-sponsor-finish img{max-width:100%;max-height:100%;object-fit:contain}';
    document.head.appendChild(style);

    const root = el('section', { id: 'tw-regatta', 'aria-label': 'Régate TradiTour 2027', 'aria-live': 'polite' });
    const panel = el('div', { class: 'tw-rg-panel' });
    const close = el('button', { class: 'tw-rg-close', type: 'button', 'aria-label': 'Fermer le panneau de régate' }, '×');
    const eyebrow = el('div', { class: 'tw-rg-eyebrow' }, 'TradiTour 2027 · Régate');
    const title = el('h2', { id: 'tw-rg-title' }, 'Régate');
    const stagePresentationWrap = el('div', { class: 'tw-rg-sponsor-wrap' });
    const stagePresentationSponsor = sponsorMount('stage_presentation', stagePresentationWrap, 'tw-rg-sponsor-stage', 'E1');
    const route = el('div', { class: 'tw-rg-route', id: 'tw-rg-route' }, '');
    const stageRouteWrap = el('div', { class: 'tw-rg-sponsor-wrap' });
    const stageRouteSponsor = sponsorMount('stage_route', stageRouteWrap, 'tw-rg-sponsor-stage', 'E1');
    const fleet = el('div', { class: 'tw-rg-fleet', id: 'tw-rg-fleet' }, '');
    const stats = el('div', { class: 'tw-rg-stats' });
    const timeStat = el('div', { class: 'tw-rg-stat' });
    timeStat.appendChild(el('small', {}, 'Chrono'));
    const timeEl = el('strong', { id: 'tw-rg-time' }, '00:00');
    timeStat.appendChild(timeEl);
    const distStat = el('div', { class: 'tw-rg-stat' });
    distStat.appendChild(el('small', {}, 'Distance restante'));
    const distEl = el('strong', { id: 'tw-rg-distance' }, '—');
    distStat.appendChild(distEl);
    stats.append(timeStat, distStat);
    const best = el('div', { class: 'tw-rg-best', id: 'tw-rg-best' }, '');
    const bar = el('div', { class: 'tw-rg-bar' });
    const progress = el('i', { id: 'tw-rg-progress' });
    bar.appendChild(progress);
    const compass = el('div', { class: 'tw-rg-compass', id: 'tw-rg-compass' });
    const needle = el('span', { class: 'tw-rg-needle' }, '↑');
    const bearing = el('span', { id: 'tw-rg-bearing' }, 'Prêt à prendre le départ');
    compass.append(needle, bearing);
    const actions = el('div', { class: 'tw-rg-actions' });
    const startBtn = el('button', { class: 'tw-rg-action', id: 'tw-rg-start', type: 'button' }, 'Prendre le départ');
    const abortBtn = el('button', { class: 'tw-rg-secondary', id: 'tw-rg-abort', type: 'button', hidden: '' }, 'Abandonner');
    actions.append(startBtn, abortBtn);
    const hint = el('div', { class: 'tw-rg-hint', id: 'tw-rg-hint' }, '');
    panel.append(close, eyebrow, title, stagePresentationWrap, route, stageRouteWrap, fleet, stats, best, bar, compass, actions, hint);
    root.appendChild(panel);

    const markers = el('div', { id: 'tw-race-markers', 'aria-hidden': 'true' });
    const buoys = [];
    for (let i = 0; i < 4; i++) {
      const b = el('div', { class: 'tw-rg-buoy ' + (i < 2 ? 'tw-rg-buoy--start' : 'tw-rg-buoy--finish') });
      markers.appendChild(b);
      buoys.push(b);
    }

    const countdown = el('div', { id: 'tw-rg-countdown', hidden: '' });
    const cdNum = el('span', { class: 'tw-rg-cd-num' }, '30');
    const cdSmall = el('small', {}, 'PRÉPAREZ-VOUS · DÉPART DANS');
    countdown.append(cdNum, cdSmall);
    const uiCountdownSponsor = sponsorMount('ui_countdown', countdown, 'tw-rg-sponsor-countdown');
    const stageStartSponsor = sponsorMount('stage_start', countdown, 'tw-rg-sponsor-countdown', 'E1');
    const finishFx = el('div', { id: 'tw-rg-finish-fx', 'aria-live': 'assertive' });
    finishFx.appendChild(el('span', {}, 'Arrivée !'));
    finishFx.appendChild(el('small', {}, 'TradiTour 2027 · ligne franchie'));
    const uiFinishSponsor = sponsorMount('ui_finish', finishFx, 'tw-rg-sponsor-finish');
    const stageFinishSponsor = sponsorMount('stage_finish', finishFx, 'tw-rg-sponsor-finish', 'E1');
    const editorBox = el('div', { id: 'tw-rg-editor-box' });
    const editorPanel = el('div', { class: 'tw-rg-editor-panel' });
    editorPanel.appendChild(el('strong', {}, 'Placer les portes de régate'));
    editorPanel.appendChild(el('p', {}, 'Déplacez les bouées sur la carte. Ajoutez des marques intermédiaires, sélectionnez-les pour les supprimer et sauvegardez le parcours de cette étape.'));
    const editorTools = el('div', { class: 'tw-rg-editor-tools' });
    const addMark = el('button', { type: 'button' }, '+ Ajouter une marque');
    const deleteMark = el('button', { type: 'button' }, 'Supprimer la sélection');
    const editorSelection = el('span', { class: 'tw-rg-editor-selection' }, 'Aucune sélection');
    editorTools.append(addMark, deleteMark, editorSelection);
    const editorActions = el('div', { class: 'tw-rg-editor-actions' });
    const saveEditor = el('button', { class: 'tw-rg-editor-save', type: 'button' }, 'Enregistrer');
    const resetEditor = el('button', { type: 'button' }, 'Réinitialiser');
    const finishEditorBtn = el('button', { type: 'button' }, 'Terminer');
    editorActions.append(saveEditor, resetEditor, finishEditorBtn);
    editorPanel.append(editorTools, editorActions); editorBox.appendChild(editorPanel);

    const liveBoard = el('aside', { id: 'tw-rg-liveboard', 'aria-live': 'polite', 'aria-label': 'Classement de la régate' });
    const livePanel = el('div', { class: 'tw-rg-live-panel' });
    const liveHead = el('div', { class: 'tw-rg-live-head' });
    const liveHeadLabel = el('span', {}, 'Klasman an dirèk');
    const liveHeadSub = el('span', { class: 'tw-rg-live-sub' }, 'Temps réel');
    liveHead.append(liveHeadLabel, liveHeadSub);
    const liveRows = el('div', { class: 'tw-rg-live-rows' });
    const liveFinal = el('div', { class: 'tw-rg-live-final' }, 'Classement officiel · temps d’arrivée et passages cumulés');
    const results = el('div', { class: 'tw-rg-results' });
    const resultsTitle = el('div', { class: 'tw-rg-results-title' }, 'Résultats officiels');
    const resultsRows = el('div', { class: 'tw-rg-results-rows' });
    const uiResultsSponsor = sponsorMount('ui_results', results, 'tw-rg-sponsor-results');
    const stageResultsSponsor = sponsorMount('stage_results', results, 'tw-rg-sponsor-results', 'E1');
    results.append(resultsTitle, resultsRows);
    if (uiResultsSponsor) results.appendChild(uiResultsSponsor);
    if (stageResultsSponsor) results.appendChild(stageResultsSponsor);
    livePanel.append(liveHead, liveRows, liveFinal, results); liveBoard.appendChild(livePanel);

    document.body.append(root, markers, countdown, finishFx, editorBox, liveBoard);
    if (TW.raceDirector && TW.raceDirector.init) TW.raceDirector.init();

    R.ui = { root, panel, close, title, route, fleet, timeEl, distEl, best, progress, compass, needle, bearing, startBtn, abortBtn, hint, buoys, countdown, cdNum, cdSmall, finishFx, editorBox, saveEditor, resetEditor, finishEditorBtn, addMark, deleteMark, editorSelection, markers, editorMarks: [], liveBoard, liveRows, liveFinal, liveHeadLabel, liveHeadSub, results, resultsTitle, resultsRows, sponsorNodes: { stage_presentation: stagePresentationSponsor, stage_route: stageRouteSponsor, stage_start: stageStartSponsor, stage_finish: stageFinishSponsor, stage_results: stageResultsSponsor } };

    close.addEventListener('click', closePanel);
    startBtn.addEventListener('click', () => start(R.stage && R.stage.id));
    abortBtn.addEventListener('click', abort);
    saveEditor.addEventListener('click', saveEditorPoints);
    addMark.addEventListener('click', addIntermediateMark);
    deleteMark.addEventListener('click', deleteSelectedMark);
    resetEditor.addEventListener('click', () => { try { localStorage.removeItem('traditour.race.' + R.stage.id + '.gates'); } catch (e) { /* storage optional */ } R.editor.points = null; R.editor.selected = -1; prepareGate(R.stage); R.editor.points = defaultEditorPoints(); R.editor.dirty = true; updateEditorNodes(); });
    finishEditorBtn.addEventListener('click', () => closeEditor());
    buoys.forEach((node, i) => {
      node.title = i < 2 ? (i === 0 ? 'Départ — bouée jaune 1' : 'Départ — bouée jaune 2') : (i === 2 ? 'Arrivée — bouée cyan 1' : 'Arrivée — bouée cyan 2');
      node.addEventListener('pointerdown', (ev) => {
        if (!R.editor.active) return;
        ev.preventDefault(); ev.stopPropagation(); R.editor.drag = i; node.setPointerCapture(ev.pointerId);
      });
      node.addEventListener('pointermove', (ev) => {
        if (!R.editor.active || R.editor.drag !== i) return;
        const p = screenToWater(ev.clientX, ev.clientY);
        if (!p) return;
        if (!R.editor.points) R.editor.points = gatePoints();
        R.editor.points[i] = p; applyGatePoints(R.editor.points.slice(0, 4)); syncRaceBuoys(); R.editor.dirty = true; updateEditorNodes();
      });
      node.addEventListener('pointerup', () => { if (R.editor.drag === i) R.editor.drag = -1; });
    });
    markers.addEventListener('pointerdown', (ev) => {
      if (!R.editor.active) return;
      const node = ev.target.closest && ev.target.closest('.tw-rg-buoy');
      if (!node) return;
      const i = node.dataset.editorIndex != null ? Number(node.dataset.editorIndex) : buoys.indexOf(node); if (i < 0 || !isFinite(i)) return;
      ev.preventDefault(); ev.stopPropagation(); R.editor.drag = i; R.editor.selected = i; updateEditorNodes();
    });
    document.addEventListener('pointermove', (ev) => {
      if (!R.editor.active || R.editor.drag < 0) return;
      const p = screenToWater(ev.clientX, ev.clientY); if (!p) return;
      if (!R.editor.points) R.editor.points = gatePoints();
      R.editor.points[R.editor.drag] = p; applyGatePoints(R.editor.points.slice(0, 4)); syncRaceBuoys(); R.editor.dirty = true; updateEditorNodes();
      ev.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerup', () => { R.editor.drag = -1; });
    buoys.forEach((node, i) => node.addEventListener('mousedown', (ev) => {
      if (!R.editor.active) return;
      ev.preventDefault(); ev.stopPropagation(); R.editor.drag = i;
    }));
    document.addEventListener('mousemove', (ev) => {
      if (!R.editor.active || R.editor.drag < 0) return;
      const p = screenToWater(ev.clientX, ev.clientY); if (!p) return;
      if (!R.editor.points) R.editor.points = gatePoints();
      R.editor.points[R.editor.drag] = p; applyGatePoints(R.editor.points.slice(0, 4)); syncRaceBuoys(); R.editor.dirty = true; updateEditorNodes();
    });
    document.addEventListener('mouseup', () => { R.editor.drag = -1; });
    built = true;
  }

  // ---------------------------------------------------------------------------
  // Stage / panel
  // ---------------------------------------------------------------------------
  function setStage(id) {
    const stage = TW.getRace ? TW.getRace(id) : null;
    if (!stage) return false;
    if (R.stage && R.stage.id !== stage.id && (R.phase === 'countdown' || R.phase === 'racing')) return false;
    R.stage = stage;
    if (TW.sponsors && TW.sponsors.updateMountStage && R.ui && R.ui.sponsorNodes) Object.keys(R.ui.sponsorNodes).forEach((key) => { const node = R.ui.sponsorNodes[key]; if (node) TW.sponsors.updateMountStage(node, stage.id); });
    R.best = loadBest(stage.id);
    if (R.ui.title) R.ui.title.textContent = stage.title || stage.id;
    if (R.ui.route) R.ui.route.textContent = stage.route || '';
    if (R.ui.best) R.ui.best.textContent = R.best ? 'Record : ' + fmt(R.best) : '';
    updatePanel();
    return true;
  }

  function openPanel(id) {
    if (!built) build();
    if (id) setStage(id);
    if (!R.stage) setStage('E1');
    if (!R.stage) return false;
    R.ui.root.classList.add('tw-rg-open');
    document.body.classList.add('tw-race-panel-open');
    updatePanel();
    return true;
  }

  function closePanel() {
    if (!R.ui.root) return;
    R.ui.root.classList.remove('tw-rg-open');
    document.body.classList.remove('tw-race-panel-open');
    if (R.phase === 'idle' || R.phase === 'finished') {
      setRaceMode(false);
      document.body.classList.remove('tw-race-active');
    }
  }

  function togglePanel() {
    if (R.ui.root && R.ui.root.classList.contains('tw-rg-open')) closePanel();
    else openPanel(R.stage && R.stage.id);
  }

  function setRaceMode(on) {
    if (TW.game && typeof TW.game.setRaceMode === 'function') TW.game.setRaceMode(!!on);
  }

  function openEditor(id) {
    if (!built) build();
    if (R.phase === 'countdown' || R.phase === 'racing') return false;
    if (id) setStage(id);
    if (!R.stage) setStage('E1');
    if (!R.stage) return false;
    if (!R.gate.ready) prepareGate(R.stage);
    R.editor.active = true; R.editor.drag = -1; R.editor.selected = -1; R.editor.points = loadEditorPoints() || defaultEditorPoints();
    R.editor.dirty = false;
    syncRaceBuoys();
    document.body.classList.add('tw-rg-editor');
    if (TW.ui && TW.ui.openChart) TW.ui.openChart();
    if (TW.chartView && TW.chartView.cv && TW.chartView.cv.parentElement) { TW.chartView.cv.parentElement.style.opacity = '1'; TW.chartView.cv.parentElement.style.visibility = 'visible'; TW.chartView.cv.parentElement.style.transform = 'none'; TW.chartView.cv.parentElement.style.transition = 'none'; }
    openPanel(R.stage.id);
    updateEditorNodes();
    updateMarkers();
    return true;
  }

  function closeEditor(save) {
    if (save !== false) saveEditorPoints();
    R.editor.active = false; R.editor.drag = -1;
    updateEditorNodes();
    document.body.classList.remove('tw-rg-editor');
    if (TW.chartView && TW.chartView.cv && TW.chartView.cv.parentElement) { TW.chartView.cv.parentElement.style.opacity = ''; TW.chartView.cv.parentElement.style.visibility = ''; TW.chartView.cv.parentElement.style.transform = ''; TW.chartView.cv.parentElement.style.transition = ''; }
    if (TW.ui && TW.ui.closeChart) TW.ui.closeChart();
    if (R.phase === 'idle') { R.gate.ready = false; if (TW.world && TW.world.clearRaceBuoys) TW.world.clearRaceBuoys(); updateMarkers(); }
  }

  function toggleEditor(id) {
    return R.editor.active ? (closeEditor(), false) : openEditor(id || (R.stage && R.stage.id) || 'E1');
  }

  // ---------------------------------------------------------------------------
  // Course geometry
  // ---------------------------------------------------------------------------
  function nearestSeaPoint(p) {
    const wx = p && isFinite(p.x) ? p.x : 0;
    const wz = p && isFinite(p.z) ? p.z : 0;
    const s = (p && p.search) || {};
    const minR = isFinite(s.minR) ? s.minR : 38;
    const maxR = isFinite(s.maxR) ? s.maxR : 175;
    const dirX = isFinite(s.dirX) ? s.dirX : 0;
    const dirZ = isFinite(s.dirZ) ? s.dirZ : 1;
    const world = TW.world;
    if (!world || typeof world.heightAt !== 'function') return { x: wx, z: wz };
    let best = null, bestScore = Infinity;
    for (let r = minR; r <= maxR; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 36) {
        const x = wx + Math.cos(a) * r, z = wz + Math.sin(a) * r;
        if (world.heightAt(x, z) > -3) continue;
        let blocked = false;
        if (world.rocks) {
          for (let i = 0; i < world.rocks.length; i++) {
            const rock = world.rocks[i];
            if (Math.hypot(x - rock.x, z - rock.z) < rock.r + 10) { blocked = true; break; }
          }
        }
        if (blocked) continue;
        let shallow = 0;
        for (let j = 0; j < 8; j++) {
          const aa = j * Math.PI / 4;
          if (world.heightAt(x + Math.cos(aa) * 16, z + Math.sin(aa) * 16) > -2.5) shallow++;
        }
        const dot = Math.cos(a) * dirX + Math.sin(a) * dirZ;
        const score = r + (1 - dot) * 18 + shallow * 22;
        if (score < bestScore) { bestScore = score; best = { x, z }; }
      }
    }
    return best || { x: wx + dirX * maxR, z: wz + dirZ * maxR };
  }

  function gatePoints() {
    const g = R.gate;
    return [
      { x: g.sx + g.px * g.half, z: g.sz + g.pz * g.half },
      { x: g.sx - g.px * g.half, z: g.sz - g.pz * g.half },
      { x: g.fx + g.px * g.half, z: g.fz + g.pz * g.half },
      { x: g.fx - g.px * g.half, z: g.fz - g.pz * g.half },
    ];
  }

  function defaultEditorPoints() {
    const pts = gatePoints(), stage = R.stage, g = R.gate;
    (stage && Array.isArray(stage.marks) ? stage.marks : []).forEach((mark) => {
      const at = isFinite(mark.at) ? Math.max(0.08, Math.min(0.92, mark.at)) : null;
      const x = isFinite(mark.x) ? mark.x : at !== null ? g.sx + (g.fx - g.sx) * at : NaN;
      const z = isFinite(mark.z) ? mark.z : at !== null ? g.sz + (g.fz - g.sz) * at : NaN;
      if (isFinite(x) && isFinite(z)) pts.push({ x, z });
    });
    return pts;
  }

  function markGate(center, index) {
    const g = R.gate, half = Math.max(12, Math.min(g.half, (R.stage && R.stage.markGateHalfWidth) || 34));
    return { id: 'mark-' + (index + 1), type: 'mark', name: 'MARQUE ' + (index + 1), x: center.x, z: center.z, px: g.px, pz: g.pz, ux: g.ux, uz: g.uz, half: half };
  }

  function buildCourseGates() {
    const marks = (R.editor.points || []).slice(4).filter((p) => p && isFinite(p.x) && isFinite(p.z));
    const gates = marks.map(markGate);
    const g = R.gate;
    gates.push({ id: 'finish', type: 'finish', name: 'ARRIVÉE', x: g.fx, z: g.fz, px: g.px, pz: g.pz, ux: g.ux, uz: g.uz, half: g.half });
    return gates;
  }

  function syncRaceBuoys() {
    if (!TW.world || typeof TW.world.setRaceBuoys !== 'function') return;
    const g = R.gate, base = gatePoints(), starts = base.slice(0, 2), finishes = base.slice(2, 4);
    const marks = (R.editor.points || []).slice(4);
    const half = Math.max(12, Math.min(g.half, (R.stage && R.stage.markGateHalfWidth) || 34));
    const markBuoys = [];
    marks.forEach((p) => markBuoys.push(
      { x: p.x + g.px * half, z: p.z + g.pz * half },
      { x: p.x - g.px * half, z: p.z - g.pz * half }
    ));
    TW.world.setRaceBuoys(starts.concat(markBuoys, finishes));
  }

  function applyGatePoints(points) {
    if (!points || points.length < 4) return;
    const sx = (points[0].x + points[1].x) * 0.5, sz = (points[0].z + points[1].z) * 0.5;
    const fx = (points[2].x + points[3].x) * 0.5, fz = (points[2].z + points[3].z) * 0.5;
    let px = points[0].x - points[1].x, pz = points[0].z - points[1].z;
    const width = Math.max(12, Math.hypot(px, pz) * 0.5);
    const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
    let ux = fx - sx, uz = fz - sz, length = Math.hypot(ux, uz);
    if (length < 40) return;
    ux /= length; uz /= length;
    const g = R.gate;
    g.sx = sx; g.sz = sz; g.fx = fx; g.fz = fz; g.px = px; g.pz = pz; g.ux = ux; g.uz = uz; g.half = width; g.ready = true;
    R.total = length;
    R.hold.x = sx - ux * (R.stage && R.stage.holdDistance || 18);
    R.hold.z = sz - uz * (R.stage && R.stage.holdDistance || 18);
    R.hold.heading = Math.atan2(ux, uz);
    syncRaceBuoys();
    updateMarkers();
  }

  function addIntermediateMark() {
    R.editor.points = Array.isArray(R.editor.points) && R.editor.points.length >= 4 ? R.editor.points : gatePoints();
    const g = R.gate, k = R.editor.points.length - 3, f = Math.min(0.85, Math.max(0.15, k / 5));
    R.editor.points.push({ x: g.sx + g.ux * R.total * f, z: g.sz + g.uz * R.total * f });
    R.editor.selected = R.editor.points.length - 1; R.editor.dirty = true; syncRaceBuoys(); updateEditorNodes(); updateMarkers();
  }
  function deleteSelectedMark() {
    const i = R.editor.selected;
    if (i < 4 || !R.editor.points || !R.editor.points[i]) return;
    R.editor.points.splice(i, 1); R.editor.selected = -1; R.editor.dirty = true; syncRaceBuoys(); updateEditorNodes(); updateMarkers();
  }
  function updateEditorNodes() {
    const ui = R.ui; if (!ui || !ui.markers) return;
    while (ui.editorMarks.length < Math.max(0, (R.editor.points || []).length - 4)) {
      const n = el('div', { class: 'tw-rg-buoy tw-rg-buoy--mark' }); n.dataset.editorIndex = String(ui.editorMarks.length + 4); ui.markers.appendChild(n); ui.editorMarks.push(n);
    }
    ui.editorMarks.forEach((n, j) => { const i = j + 4; n.dataset.editorIndex = String(i); n.style.display = R.editor.active ? 'block' : 'none'; n.classList.toggle('tw-rg-buoy--selected', R.editor.selected === i); });
    if (ui.editorSelection) ui.editorSelection.textContent = R.editor.selected >= 0 ? ('Sélection : ' + (R.editor.selected < 2 ? 'Départ' : R.editor.selected < 4 ? 'Arrivée' : 'Marque ' + (R.editor.selected - 3))) : 'Aucune sélection';
  }

  function saveEditorPoints() {
    if (!R.stage || !R.editor.points) return;
    try { localStorage.setItem('traditour.race.' + R.stage.id + '.gates', JSON.stringify(R.editor.points)); } catch (e) { /* storage optional */ }
    R.editor.dirty = false;
  }

  function loadEditorPoints() {
    if (!R.stage) return null;
    try {
      const p = JSON.parse(localStorage.getItem('traditour.race.' + R.stage.id + '.gates') || 'null');
      return Array.isArray(p) && p.length >= 4 ? p : null;
    } catch (e) { return null; }
  }

  function screenToWater(clientX, clientY) {
    const chart = R.editor.active && TW.chartView && TW.chartView.cv && TW.chartView.open ? TW.chartView.cv.getBoundingClientRect() : null;
    if (chart) {
      const ext = TW.chartView.ext || 1400;
      return { x: ((clientX - chart.left) / chart.width) * 2 * ext - ext, z: ((clientY - chart.top) / chart.height) * 2 * ext - ext };
    }
    const inv = TW.env && TW.env.invViewProj;
    const r = TW.canvas && TW.canvas.getBoundingClientRect();
    if (!inv || !r) return null;
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const point = (z) => {
      const x = inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12];
      const y = inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13];
      const w = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15];
      return [x / w, y / w, (inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14]) / w];
    };
    const a = point(-1), b = point(1), dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-5) return null;
    const t = -a[1] / dy;
    if (t < 0 || t > 1) return null;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t };
  }

  function prepareGate(stage) {
    const startPt = nearestSeaPoint(stage.start), finishPt = nearestSeaPoint(stage.finish);
    let dx = finishPt.x - startPt.x, dz = finishPt.z - startPt.z, len = Math.hypot(dx, dz);
    if (len < (stage.minCourseLength || 100)) { finishPt.x = startPt.x + (stage.fallback || { dx: 450 }).dx; finishPt.z = startPt.z + (stage.fallback || { dz: -180 }).dz; dx = finishPt.x - startPt.x; dz = finishPt.z - startPt.z; len = Math.hypot(dx, dz); }
    const ux = dx / len, uz = dz / len, half = isFinite(stage.gateHalfWidth) ? stage.gateHalfWidth : 42;
    applyGatePoints([
      { x: startPt.x - uz * half, z: startPt.z + ux * half }, { x: startPt.x + uz * half, z: startPt.z - ux * half },
      { x: finishPt.x - uz * half, z: finishPt.z + ux * half }, { x: finishPt.x + uz * half, z: finishPt.z - ux * half },
    ]);
    const saved = loadEditorPoints();
    if (saved) {
      R.editor.points = saved;
      applyGatePoints(saved);
      const defaults = defaultEditorPoints();
      while (R.editor.points.length < defaults.length) R.editor.points.push(defaults[R.editor.points.length]);
    }
    else R.editor.points = defaultEditorPoints();
  }

  function placeBoat(x, z, heading) {
    const S = TW.state, b = S && S.boat;
    if (!b) return;
    const dx = x - b.x, dz = z - b.z;
    b.x = x; b.z = z; b.heading = heading;
    b.vx = 0; b.vz = 0; b.speed = 0; b.rudder = 0; b.pitch = 0; b.roll = 0; b.aground = 0;
    if (S.cam) {
      if (Array.isArray(S.cam.pos)) { S.cam.pos[0] += dx; S.cam.pos[2] += dz; }
      if (Array.isArray(S.cam.target)) { S.cam.target[0] += dx; S.cam.target[2] += dz; }
    }
  }

  function pinBoat() {
    const S = TW.state, b = S && S.boat;
    if (!b) return;
    b.x = R.hold.x; b.z = R.hold.z; b.heading = R.hold.heading;
    b.vx = 0; b.vz = 0; b.speed = 0; b.rudder = 0; b.pitch = 0; b.roll = 0; b.aground = 0;
  }

  function project(x, y, z, rect, allowOffscreen) {
    const env = TW.env;
    if (!env || typeof env.project !== 'function' || !TW.canvas) return null;
    const pr = env.project([x, y, z]);
    if (!(pr[2] > 0.1)) return null;
    if (!allowOffscreen && (pr[0] < -0.2 || pr[0] > 1.2 || pr[1] < -0.2 || pr[1] > 1.2)) return null;
    const r = rect || TW.canvas.getBoundingClientRect();
    return { x: r.left + pr[0] * r.width, y: r.top + pr[1] * r.height };
  }

  function drawLine(line, x1, z1, x2, z2, rect) {
    const p1 = project(x1, 1.1, z1, rect, true), p2 = project(x2, 1.1, z2, rect, true);
    if (!p1 || !p2) { line.style.display = 'none'; return; }
    line.style.display = 'block';
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    line.style.left = p1.x + 'px';
    line.style.top = p1.y + 'px';
    line.style.width = Math.hypot(dx, dy) + 'px';
    line.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
  }

  function updateMarkers() {
    const ui = R.ui, g = R.gate;
    if (!ui || !ui.buoys) return;
    if (!g.ready) {
      ui.buoys.forEach((b) => { b.style.display = 'none'; });
      return;
    }
    const map = R.editor.active && TW.chartView && TW.chartView.cv && TW.chartView.open ? TW.chartView.cv.getBoundingClientRect() : null;
    const rect = map || (TW.canvas ? TW.canvas.getBoundingClientRect() : null);
    const basePts = [
      [g.sx + g.px * g.half, g.sz + g.pz * g.half],
      [g.sx - g.px * g.half, g.sz - g.pz * g.half],
      [g.fx + g.px * g.half, g.fz + g.pz * g.half],
      [g.fx - g.px * g.half, g.fz - g.pz * g.half],
    ];
    const extraPts = R.editor.active ? (R.editor.points || []).slice(4).map((p) => [p.x, p.z]) : [];
    const pts = basePts.concat(extraPts), nodes = ui.buoys.concat(R.editor.active ? ui.editorMarks : []);
    for (let i = 0; i < nodes.length; i++) {
      let p;
      if (map) {
        const ext = TW.chartView.ext || 1400;
        p = { x: rect.left + (pts[i][0] + ext) / (2 * ext) * rect.width, y: rect.top + (pts[i][1] + ext) / (2 * ext) * rect.height };
      } else p = project(pts[i][0], 1.3, pts[i][1], rect);
      const node = nodes[i];
      if (!p) { node.style.display = 'none'; continue; }
      node.style.display = 'block';
      node.style.left = p.x + 'px';
      node.style.top = p.y + 'px';
    }
  }

  // ---------------------------------------------------------------------------
  // Panel values
  // ---------------------------------------------------------------------------
  function standings() {
    const S = TW.state, boat = S && S.boat, total = Math.max(1, R.courseGates.length);
    if (!boat || !R.gate.ready) return [];
    const rows = [];
    const add = (id, name, number, x, z, speed, player) => {
      const state = competitorState(id), next = R.courseGates[state.checkpointIndex];
      const target = next || R.courseGates[R.courseGates.length - 1];
      const dist = target ? Math.hypot(target.x - x, target.z - z) : 0;
      const progress = state.finished ? 1 : (state.checkpointIndex + (target ? 1 - Math.min(1, dist / Math.max(1, R.total / total)) : 0)) / total;
      rows.push({ id, boat: number, name, x, z, speed, progress, checkpointIndex: state.checkpointIndex, gatesPassed: state.passTimes.length, nextGate: state.finished ? 'TERMINÉE' : target.name, splits: state.passTimes.slice(), finished: state.finished, time: state.finished ? state.finishTime : null, player });
    };
    const localName = TW.multiplayer && TW.multiplayer.state && Array.isArray(TW.multiplayer.state.players)
      ? ((TW.multiplayer.state.players.find((p) => p.id === TW.multiplayer.state.sessionId) || {}).name || 'Joueur')
      : 'Joueur';
    add('player', localName, 'J', boat.x, boat.z, boat.speed || 0, true);
    if (R.networkAuthority) {
      const remotes = TW.multiplayer && TW.multiplayer.remoteBoats ? TW.multiplayer.remoteBoats() : [];
      (R.networkPlayers || []).filter((q) => !TW.multiplayer || q.id !== TW.multiplayer.state.sessionId).forEach((q, i) => {
        const pose = remotes.find((p) => p.id === q.id);
        if (pose) add(q.id, q.name || 'Marin', 'M' + (i + 1), pose.renderX, pose.renderZ, pose.speed || 0, false);
      });
    } else if (TW.fleet && TW.fleet.results) TW.fleet.results().forEach((q, i) => add(q.id, q.name, String(i + 1), q.x, q.z, q.speed, false));
    rows.sort((a, b) => a.finished !== b.finished ? (a.finished ? -1 : 1) : a.finished ? a.time - b.time : a.checkpointIndex !== b.checkpointIndex ? b.checkpointIndex - a.checkpointIndex : b.progress - a.progress);
    rows.forEach((row, i) => { row.rank = i + 1; row.gapDistance = Math.max(0, (rows[0].progress - row.progress) * R.total); row.gapTime = rows[0].finished && row.finished ? Math.max(0, row.time - rows[0].time) : null; });
    return rows;
  }

  function updateLiveBoard() {
    const ui = R.ui, rows = standings();
    if (!ui || !ui.liveBoard || !ui.liveRows) return;
    const on = R.phase === 'countdown' || R.phase === 'racing' || R.phase === 'finished';
    ui.liveBoard.classList.toggle('tw-rg-liveboard--on', on);
    ui.liveBoard.classList.toggle('tw-rg-liveboard--final', R.phase === 'finished');
    if (ui.liveHeadLabel) ui.liveHeadLabel.textContent = R.phase === 'finished' ? 'Classement officiel' : 'Klasman an dirèk';
    if (ui.liveHeadSub) ui.liveHeadSub.textContent = R.phase === 'finished' ? 'Résultats complets' : 'Temps réel';
    if (!on || !rows.length) return;
    ui.liveRows.textContent = '';
    rows.forEach((row) => {
      const line = el('div', { class: 'tw-rg-live-row' + (row.player ? ' tw-rg-live-row--player' : '') + (row.rank === 1 ? ' tw-rg-live-row--leader' : '') + (row.finished ? ' tw-rg-live-row--done' : '') });
      const checkpointLabel = row.finished ? 'TERMINÉ' : (row.gatesPassed + '/' + R.courseGates.length + ' · ' + row.nextGate);
      line.append(el('span', { class: 'tw-rg-live-rank' }, String(row.rank)), el('span', { class: 'tw-rg-live-boat' }, row.boat), el('span', { class: 'tw-rg-live-name' }, row.name + ' · ' + checkpointLabel));
      let gap = '—';
      if (row.finished) gap = row.rank === 1 ? fmtPrecise(row.time) : (row.gapTime !== null ? '+' + fmtPrecise(row.gapTime) : fmtPrecise(row.time));
      else if (row.rank > 1) gap = '≈ +' + Math.round(row.gapDistance) + ' m';
      line.append(el('span', { class: 'tw-rg-live-gap' }, gap));
      ui.liveRows.appendChild(line);
    });
    if (R.phase === 'finished' && ui.resultsRows) {
      const player = rows.find((row) => row.player);
      ui.resultsTitle.textContent = (player ? 'Résultats officiels · joueur ' + player.rank + '/' + rows.length : 'Résultats officiels') + ' · écarts par étape vs 1er';
      ui.resultsRows.textContent = '';
      const winner = rows[0];
      rows.forEach((row) => {
        const item = el('div', { class: 'tw-rg-result' + (row.player ? ' tw-rg-result--player' : '') });
        const main = el('div', { class: 'tw-rg-result-main' });
        const time = row.finished ? (row.rank === 1 ? fmtPrecise(row.time) : '+' + fmtPrecise(row.time - winner.time)) : 'Pa fini';
        main.append(el('span', { class: 'tw-rg-result-rank' }, String(row.rank)), el('span', { class: 'tw-rg-result-name' }, row.name + ' · ' + row.boat), el('span', { class: 'tw-rg-result-time' }, time));
        item.appendChild(main);
        const splits = el('div', { class: 'tw-rg-result-splits' });
        let previous = 0;
        (row.splits || []).forEach((cumulative, index) => {
          const gate = R.courseGates[index];
          const leg = cumulative - previous, leaderCumulative = winner && winner.splits ? winner.splits[index] : null;
          const leaderPrevious = index > 0 && winner && winner.splits ? winner.splits[index - 1] : 0;
          const delta = leaderCumulative === null || leaderCumulative === undefined ? null : leg - (leaderCumulative - leaderPrevious);
          const deltaLabel = delta === null ? '' : delta > 0.005 ? ' · +' + fmtPrecise(delta) + ' vs 1er' : delta < -0.005 ? ' · −' + fmtPrecise(-delta) + ' vs 1er' : ' · égal au 1er';
          splits.appendChild(el('span', {}, (gate ? gate.name : 'Passage ' + (index + 1)) + ' · cum. ' + fmtPrecise(cumulative) + deltaLabel));
          previous = cumulative;
        });
        if (splits.childNodes.length) item.appendChild(splits);
        ui.resultsRows.appendChild(item);
      });
    }
  }
  function updatePanel() {
    const ui = R.ui;
    if (!ui || !ui.timeEl || !R.stage) return;
    const S = TW.state, b = S && S.boat, g = R.gate;
    const nextGate = nextGateFor('player');
    const dist = b && nextGate ? Math.hypot(nextGate.x - b.x, nextGate.z - b.z) : 0;
    const pct = R.courseGates.length ? (competitorState('player').checkpointIndex / R.courseGates.length) : 0;
    ui.timeEl.textContent = fmt(R.elapsed);
    if (R.phase === 'racing' || R.phase === 'finished') {
      ui.distEl.textContent = dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(2) + ' km';
    } else {
      ui.distEl.textContent = R.total ? (R.total / 1000).toFixed(2) + ' km' : '—';
    }
    ui.progress.style.width = (pct * 100).toFixed(1) + '%';
    if (R.phase === 'racing' && b && g.ready) {
      const target = nextGate || { x: g.fx, z: g.fz };
      const bearing = Math.atan2(target.x - b.x, target.z - b.z);
      const relative = bearing - (b.heading || 0);
      ui.needle.style.display = '';
      ui.needle.style.transform = 'rotate(' + relative + 'rad)';
      ui.bearing.textContent = 'Prochaine porte : ' + (nextGate ? nextGate.name : 'ARRIVÉE') + ' · ' + Math.round(((bearing * DEG) % 360 + 360) % 360) + '°';
    } else if (R.phase === 'finished') {
      ui.needle.style.display = 'none';
      ui.bearing.innerHTML = '<span class="tw-rg-done">Ligne d’arrivée franchie !</span>';
    } else {
      ui.needle.style.display = '';
      ui.needle.style.transform = 'rotate(0rad)';
      ui.bearing.textContent = R.phase === 'countdown' ? 'Préparation du départ' : 'Prêt à prendre le départ';
    }
    const counting = R.phase === 'countdown', racing = R.phase === 'racing', finished = R.phase === 'finished';
    ui.startBtn.hidden = racing || counting;
    ui.startBtn.disabled = racing || counting;
    ui.startBtn.textContent = finished ? 'Rejouer la régate' : 'Prendre le départ';
    ui.abortBtn.hidden = !(racing || counting);
    ui.hint.textContent = counting ? ('Départ dans ' + Math.ceil(R.countdown) + ' s : placez-vous derrière la ligne.')
      : racing ? ('Franchissez la porte ' + (nextGate ? nextGate.name : 'ARRIVÉE') + ' entre les deux bouées.')
        : finished ? ('Temps réalisé : ' + fmt(R.elapsed) + '.')
          : 'La navigation et les réglages du bateau ne sont pas modifiés.';
    if (R.phase === 'countdown' && R.falseStartT > 0) ui.hint.textContent = 'Faux départ : vous êtes reparti derrière la porte. Nouveau départ dans ' + Math.ceil(R.countdown) + ' s.';
    ui.best.textContent = R.best ? 'Record : ' + fmt(R.best) : '';
    if (ui.fleet && TW.fleet && TW.fleet.results) {
      const rows = R.networkAuthority ? (R.networkPlayers || []).map((p) => {
        const own = TW.multiplayer && p.id === TW.multiplayer.state.sessionId;
        const pose = !own && TW.multiplayer && TW.multiplayer.remoteBoats ? TW.multiplayer.remoteBoats().find((q) => q.id === p.id) : null;
        return { name: p.name, finished: p.finished, time: p.finishTime, speed: own ? (TW.state.boat.speed || 0) : (pose ? pose.speed : 0), checkpointIndex: p.checkpointIndex };
      }) : TW.fleet.results();
      ui.fleet.innerHTML = rows.map((q) => '<span><b style="color:rgb(' + Math.round(q.finished ? 255 : 170) + ',' + Math.round(q.finished ? 190 : 190) + ',' + Math.round(q.finished ? 95 : 205) + ')">' + (q.name || 'Marin') + '</b> · ' + (q.finished ? fmt(q.time) : R.networkAuthority ? ('PORTE ' + Math.min(q.checkpointIndex + 1, R.courseGates.length) + '/' + R.courseGates.length) : (q.speed > 0.2 ? Math.round(q.speed * 3.6) + ' km/h' : 'en attente')) + '</span>').join('');
      ui.fleet.hidden = !(R.phase === 'countdown' || R.phase === 'racing' || R.phase === 'finished');
    }
    updateLiveBoard();
  }

  // ---------------------------------------------------------------------------
  // Race lifecycle
  // ---------------------------------------------------------------------------
  function networkStartInfo(id) {
    if (!built) build();
    const stage = TW.getRace ? TW.getRace(id || (R.stage && R.stage.id) || 'E1') : null;
    if (!stage || !setStage(stage.id)) return null;
    prepareGate(stage);
    R.courseGates = buildCourseGates();
    const g = R.gate, distance = isFinite(stage.holdDistance) ? stage.holdDistance : 18;
    const countdown = TW.qf ? TW.qf('racecd', stage.countdown) : stage.countdown;
    return {
      id: stage.id,
      countdownSeconds: Math.max(3, Math.min(90, isFinite(countdown) ? countdown : 30)),
      course: R.courseGates.map((gate) => ({ id: gate.id, type: gate.type, name: gate.name, x: gate.x, z: gate.z, px: gate.px, pz: gate.pz, ux: gate.ux, uz: gate.uz, half: gate.half })),
      startGate: { sx: g.sx, sz: g.sz, fx: g.fx, fz: g.fz, px: g.px, pz: g.pz, ux: g.ux, uz: g.uz, half: g.half,
        holdX: g.sx - g.ux * distance, holdZ: g.sz - g.uz * distance, heading: Math.atan2(g.ux, g.uz) },
    };
  }

  function installNetworkGeometry(startGate, course) {
    if (!startGate || !Array.isArray(course) || !course.length) return;
    const g = R.gate;
    g.sx = startGate.sx; g.sz = startGate.sz; g.fx = startGate.fx; g.fz = startGate.fz;
    g.px = startGate.px; g.pz = startGate.pz; g.ux = startGate.ux; g.uz = startGate.uz; g.half = startGate.half; g.ready = true;
    R.hold.x = startGate.holdX; R.hold.z = startGate.holdZ; R.hold.heading = startGate.heading;
    R.total = Math.hypot(g.fx - g.sx, g.fz - g.sz);
    R.courseGates = course.map((gate) => ({ id: gate.id, type: gate.type, name: gate.name, x: gate.x, z: gate.z, px: gate.px, pz: gate.pz, ux: gate.ux, uz: gate.uz, half: gate.half }));
    const half = g.half;
    R.editor.points = [
      { x: g.sx - g.uz * half, z: g.sz + g.ux * half }, { x: g.sx + g.uz * half, z: g.sz - g.ux * half },
      { x: g.fx - g.uz * half, z: g.fz + g.ux * half }, { x: g.fx + g.uz * half, z: g.fz - g.ux * half },
    ].concat(R.courseGates.filter((gate) => gate.type === 'mark').map((gate) => ({ x: gate.x, z: gate.z })));
    syncRaceBuoys(); updateMarkers();
  }

  function applyNetworkRace(snapshot) {
    if (!snapshot || !TW.multiplayer || !TW.multiplayer.state) return;
    const sessionId = TW.multiplayer.state.sessionId;
    if (Array.isArray(snapshot.players) && !snapshot.players.some((player) => player.id === sessionId)) return;
    const networkPlayers = Array.isArray(snapshot.players) ? snapshot.players.slice() : [];
    const newRun = !R.stage || !snapshot.id || R.stage.id !== snapshot.id || R.phase === 'idle' || (R.phase === 'finished' && snapshot.phase === 'countdown');
    if (newRun) start(snapshot.id, true, snapshot);
    else installNetworkGeometry(snapshot.startGate, snapshot.course);
    R.networkAuthority = true;
    R.networkPlayers = networkPlayers;
    R.networkPlayers.forEach((player) => {
      const id = player.id === sessionId ? 'player' : player.id;
      const state = competitorState(id);
      if (newRun && player.id === sessionId && isFinite(player.startX) && isFinite(player.startZ)) {
        placeBoat(player.startX, player.startZ, R.hold.heading);
        R.playerPrev.x = TW.state.boat.x; R.playerPrev.z = TW.state.boat.z;
      }
      state.checkpointIndex = Math.max(0, Number(player.checkpointIndex) || 0);
      state.passTimes = Array.isArray(player.passTimes) ? player.passTimes.map(Number).filter(Number.isFinite) : [];
      state.finished = !!player.finished; state.finishTime = Number(player.finishTime) || 0;
      state.lastCheckpoint = state.passTimes.length ? (R.courseGates[state.passTimes.length - 1] || {}).id : null;
    });
    const falseStartRevision = Number(snapshot.falseStartRevision) || 0;
    if (falseStartRevision > R.networkFalseStartRevision) {
      R.networkFalseStartRevision = falseStartRevision;
      R.falseStartCount++;
      if (snapshot.falseStartPlayer === sessionId) {
        const own = networkPlayers.find((player) => player.id === sessionId);
        placeBoat(own && isFinite(own.startX) ? own.startX : R.hold.x, own && isFinite(own.startZ) ? own.startZ : R.hold.z, R.hold.heading);
      }
      R.playerPrev.x = TW.state.boat.x; R.playerPrev.z = TW.state.boat.z;
      R.falseStartT = 3;
      TW.emit('race:falseStart', { id: snapshot.id, count: R.falseStartCount });
    }
    const own = R.competitors.player;
    if (own && own.finished && !R.playerFinished) {
      R.elapsed = own.finishTime;
      finishRace();
    }
    if (snapshot.phase === 'countdown') {
      R.phase = 'countdown'; R.countdown = Math.max(0, Number(snapshot.countdown) || 0);
    } else if (snapshot.phase === 'racing') {
      if (R.phase !== 'racing') beginRacing();
      R.elapsed = Math.max(0, Number(snapshot.elapsed) || 0);
    } else if (snapshot.phase === 'finished') {
      R.countdown = 0; completeRace();
    }
    updatePanel();
  }

  function endNetworkRace() {
    if (!R.networkAuthority) return;
    if (R.phase === 'countdown' || R.phase === 'racing') abort(true);
    R.networkAuthority = false; R.networkPlayers = []; R.networkFalseStartRevision = 0;
  }

  function start(id, fromNetwork, networkState) {
    if (!built) build();
    const stage = TW.getRace ? TW.getRace(id || (R.stage && R.stage.id) || 'E1') : null;
    if (!stage) return false;
    if (!fromNetwork && TW.multiplayer && TW.multiplayer.isConnected && TW.multiplayer.isConnected()) return TW.multiplayer.requestRaceStart(stage.id);
    if (R.phase === 'countdown' || R.phase === 'racing') return false;
    setStage(stage.id);
    const S = TW.state, b = S && S.boat;
    if (!S || !b || !TW.game) return false;
    if (S.phase === 'ending') return false;
    if (S.phase === 'title') TW.game.start();
    else if (S.phase === 'paused' && TW.game.resume) TW.game.resume();
    if (S.phase !== 'sailing' && S.phase !== 'free') return false;

    prepareGate(stage);
    const g = R.gate;
    const len = R.total;
    R.hold.x = g.sx - g.ux * (isFinite(stage.holdDistance) ? stage.holdDistance : 18);
    R.hold.z = g.sz - g.uz * (isFinite(stage.holdDistance) ? stage.holdDistance : 18);
    R.hold.heading = Math.atan2(g.ux, g.uz);
    R.elapsed = 0;
    R.hudAcc = 0;
    R.lastNow = 0;
    R.goT = 0;
    R.prevStartSide = -1;
    R.falseStartCount = 0;
    R.falseStartT = 0;
    R.finishT = 0;
    R.playerFinished = false;
    R.playerTime = 0;
    R.playerRank = 0;
    R.courseGates = buildCourseGates();
    R.networkAuthority = !!fromNetwork;
    R.networkPlayers = [];
    R.networkFalseStartRevision = 0;
    if (fromNetwork && networkState) installNetworkGeometry(networkState.startGate, networkState.course);
    R.competitors = Object.create(null);
    R.competitors.player = { id: 'player', checkpointIndex: 0, passTimes: [], finished: false, finishTime: 0, lastCheckpoint: null };
    R.playerPrev.x = b.x; R.playerPrev.z = b.z;

    syncRaceBuoys();

    placeBoat(R.hold.x, R.hold.z, R.hold.heading);
    R.playerPrev.x = b.x; R.playerPrev.z = b.z;
    R.prevStartSide = -18;
    R.prevFinishSide = (b.x - g.fx) * g.ux + (b.z - g.fz) * g.uz;
    setRaceMode(true);

    R.phase = 'countdown';
    const cd = TW.qf ? TW.qf('racecd', stage.countdown) : stage.countdown;
    R.countdown = fromNetwork && networkState ? Math.max(0, Number(networkState.countdown) || 0) : Math.max(0, isFinite(cd) ? cd : 30);
    if (R.ui.countdown) {
      R.ui.countdown.hidden = false;
      if (R.ui.cdNum) R.ui.cdNum.textContent = R.countdown > 0 ? String(Math.ceil(R.countdown)) : 'Annou pati !';
      if (R.ui.cdSmall) R.ui.cdSmall.textContent = 'PRÉPAREZ-VOUS · DÉPART DANS';
    }
    openPanel(stage.id);
    R.ui.root.classList.remove('tw-rg-open');
    document.body.classList.remove('tw-race-panel-open');
    document.body.classList.add('tw-race-active');
    updatePanel();
    updateMarkers();
    TW.emit('race:start', { id: stage.id, stage: stage, total: len });
    return true;
  }

  function beginRacing() {
    R.phase = 'racing';
    R.elapsed = 0;
    R.countdown = 0;
    R.goT = 0.9;
    const boat = TW.state && TW.state.boat; if (boat) { R.playerPrev.x = boat.x; R.playerPrev.z = boat.z; }
    if (R.ui.countdown) {
      R.ui.countdown.hidden = false;
      if (R.ui.cdNum) R.ui.cdNum.textContent = 'Annou pati !';
      if (R.ui.cdSmall) R.ui.cdSmall.textContent = 'BONNE RÉGATE !';
    }
    updatePanel();
    TW.emit('race:go', { id: R.stage && R.stage.id });
  }

  function finishRace() {
    if (R.playerFinished) return;
    const state = R.competitors.player || (R.competitors.player = { id: 'player', checkpointIndex: 0, passTimes: [], finished: false });
    state.finished = true; if (!R.networkAuthority) state.finishTime = R.elapsed;
    R.playerFinished = true;
    R.playerTime = R.networkAuthority ? (Number(state.finishTime) || R.elapsed) : R.elapsed;
    const ownRow = R.networkAuthority ? standings().find((row) => row.player) : null;
    R.playerRank = ownRow ? ownRow.rank : 1 + (TW.fleet && TW.fleet.results ? TW.fleet.results().filter((b) => b.finished && b.time <= R.playerTime).length : 0);
    R.countdown = 0; R.goT = 0; R.finishT = 1.8;
    if (R.ui.countdown) R.ui.countdown.hidden = true;
    if (R.ui.finishFx) { R.ui.finishFx.classList.remove('tw-rg-finish-fx--on'); void R.ui.finishFx.offsetWidth; R.ui.finishFx.classList.add('tw-rg-finish-fx--on'); }
    document.body.classList.add('tw-rg-finish-flash');
    setTimeout(() => document.body.classList.remove('tw-rg-finish-flash'), 650);
    const id = R.stage && R.stage.id, prevBest = R.best, newBest = !prevBest || R.playerTime < prevBest;
    if (id && newBest) { R.best = R.playerTime; saveBest(id, R.playerTime); }
    updatePanel();
    TW.emit('race:finish', { id: id, time: R.playerTime, best: R.best, newBest: newBest, rank: R.playerRank });
  }

  function crossedGate(gate, x0, z0, x1, z1) {
    const s0 = (x0 - gate.x) * gate.ux + (z0 - gate.z) * gate.uz;
    const s1 = (x1 - gate.x) * gate.ux + (z1 - gate.z) * gate.uz;
    if (!(s0 < 0 && s1 >= 0)) return false;
    const t = s0 / (s0 - s1);
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const lateral = Math.abs((x - gate.x) * gate.px + (z - gate.z) * gate.pz);
    return lateral <= gate.half + 5;
  }

  function competitorState(id) {
    return R.competitors[id] || (R.competitors[id] = { id: id, checkpointIndex: 0, passTimes: [], finished: false, finishTime: 0, lastCheckpoint: null });
  }

  function checkCompetitorCrossing(id, x0, z0, x1, z1, time) {
    const state = competitorState(id);
    if (state.finished || R.phase !== 'racing') return state;
    const gate = R.courseGates[state.checkpointIndex];
    if (!gate || !crossedGate(gate, x0, z0, x1, z1)) return state;
    state.lastCheckpoint = gate.id;
    state.passTimes.push(isFinite(time) ? time : R.elapsed);
    state.checkpointIndex++;
    TW.emit('race:checkpoint', { id: id, checkpoint: gate.id, index: state.checkpointIndex, time: state.passTimes[state.passTimes.length - 1] });
    if (gate.type === 'finish') {
      state.finished = true; state.finishTime = state.passTimes[state.passTimes.length - 1];
      if (id === 'player') finishRace();
    }
    return state;
  }

  function nextGateFor(id) {
    const state = competitorState(id);
    return state.finished ? null : (R.courseGates[state.checkpointIndex] || null);
  }

  function updateRace(dt) {
    const S = TW.state, b = S && S.boat;
    if (!b || !R.gate.ready) return;
    const state = R.networkAuthority ? competitorState('player') : checkCompetitorCrossing('player', R.playerPrev.x, R.playerPrev.z, b.x, b.z, R.elapsed);
    R.playerPrev.x = b.x; R.playerPrev.z = b.z;
    R.playerFinished = !!state.finished;
    if (R.playerFinished) R.playerTime = state.finishTime;
    if (!R.networkAuthority && R.playerFinished && TW.fleet && TW.fleet.results && TW.fleet.results().every((q) => q.finished)) completeRace();
    R.hudAcc += dt;
    if (R.hudAcc >= 0.08) { R.hudAcc = 0; updatePanel(); }
  }

  function completeRace() {
    if (R.phase === 'finished') return;
    R.phase = 'finished';
    R.countdown = 0;
    if (R.ui.countdown) R.ui.countdown.hidden = true;
    const finalRows = standings(), finalPlayer = finalRows.find((row) => row.player);
    if (finalPlayer) R.playerRank = finalPlayer.rank;
    try {
      const key = 'traditour.championship.results';
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      all[R.stage && R.stage.id || 'E1'] = finalRows.map((row) => ({ id: row.id, name: row.name, rank: row.rank, time: row.time, splits: row.splits || [] }));
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) { /* championship storage is optional */ }
    updatePanel();
    TW.emit('race:complete', { id: R.stage && R.stage.id, playerTime: R.playerTime, rank: R.playerRank });
  }

  function abort(fromNetwork) {
    if (R.networkAuthority && !fromNetwork && TW.multiplayer && TW.multiplayer.abortRace) { TW.multiplayer.abortRace(); return; }
    R.phase = 'idle';
    R.countdown = 0;
    R.goT = 0;
    R.elapsed = 0;
    R.playerFinished = false;
    R.playerTime = 0;
    R.playerRank = 0;
    R.prevStartSide = -1;
    R.finishT = 0;
    R.gate.ready = false;
    R.prevFinishSide = -1;
    if (R.ui.countdown) R.ui.countdown.hidden = true;
    if (TW.world && typeof TW.world.setRaceBuoys === 'function') TW.world.setRaceBuoys([]);
    if (R.ui.buoys) R.ui.buoys.forEach((b) => { b.style.display = 'none'; });
    setRaceMode(false);
    document.body.classList.remove('tw-race-active');
    updatePanel();
    TW.emit('race:abort', { id: R.stage && R.stage.id });
  }

  function update(dt) {
    if (!built) return;
    const S = TW.state;
    if (!S) return;
    if (S.phase === 'paused') { R.lastNow = 0; return; }
    if (S.phase === 'ending' && R.phase !== 'idle') { abort(); return; }
    const now = performance.now();
    const realDt = R.lastNow ? Math.min((now - R.lastNow) / 1000, 1) : (dt > 0 ? dt : 0);
    R.lastNow = now;
    if (R.phase === 'countdown') {
      if (R.falseStartT > 0) R.falseStartT = Math.max(0, R.falseStartT - realDt);
      R.countdown = Math.max(0, R.countdown - realDt);
      const b = S.boat, g = R.gate;
      const startSide = (b.x - g.sx) * g.ux + (b.z - g.sz) * g.uz;
      const startLateral = Math.abs((b.x - g.sx) * g.px + (b.z - g.sz) * g.pz);
      if (!R.networkAuthority && R.prevStartSide < 0 && startSide >= 0 && startLateral <= g.half + 8) {
        R.falseStartCount++;
        R.falseStartT = 3;
        R.countdown = 30;
        placeBoat(R.hold.x, R.hold.z, R.hold.heading);
        R.playerPrev.x = b.x; R.playerPrev.z = b.z;
        R.prevStartSide = -18;
        if (R.ui.cdNum) R.ui.cdNum.textContent = '30';
        if (R.ui.cdSmall) R.ui.cdSmall.textContent = 'FAUX DÉPART · DÉPART REPRIS DANS';
        if (R.ui.hint) R.ui.hint.textContent = 'Faux départ : vous êtes reparti derrière la ligne.';
        TW.emit('race:falseStart', { id: R.stage && R.stage.id, count: R.falseStartCount });
      } else {
        R.prevStartSide = startSide;
      }
      if (R.ui.countdown) {
        R.ui.countdown.hidden = false;
        if (R.ui.cdNum) R.ui.cdNum.textContent = R.countdown > 0 ? String(Math.ceil(R.countdown)) : 'Annou pati !';
        if (R.ui.cdSmall) R.ui.cdSmall.textContent = R.countdown > 0 ? 'PRÉPAREZ-VOUS · DÉPART DANS' : 'BONNE RÉGATE !';
      }
      updatePanel();
      updateMarkers();
      if (TW.raceDirector && TW.raceDirector.update) TW.raceDirector.update(realDt);
      if (R.countdown <= 0 && !R.networkAuthority) beginRacing();
    } else if (R.phase === 'racing') {
      R.elapsed += realDt;
      if (R.goT > 0) {
        R.goT = Math.max(0, R.goT - realDt);
        if (R.goT <= 0 && R.ui.countdown) R.ui.countdown.hidden = true;
      }
      if (TW.fleet && TW.fleet.update) TW.fleet.update(dt, R);
      updateRace(realDt);
      if (TW.raceDirector && TW.raceDirector.update) TW.raceDirector.update(realDt);
      if (R.finishT > 0) { R.finishT = Math.max(0, R.finishT - realDt); if (R.finishT <= 0 && R.ui.finishFx) R.ui.finishFx.classList.remove('tw-rg-finish-fx--on'); }
      updateMarkers();
    } else if (R.phase === 'finished') {
      if (R.finishT > 0) R.finishT = Math.max(0, R.finishT - realDt);
      updateMarkers();
    }
  }

  function init() {
    if (built) return;
    build();
    const id = TW.qs ? TW.qs('race', '') : '';
    if (id && TW.getRace && TW.getRace(id)) {
      openPanel(id);
      if (TW.q && TW.q.has('racego')) start(id);
    }
  }

  TW.regatta = {
    init: init,
    update: update,
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    start: start,
    networkStartInfo: networkStartInfo,
    applyNetworkRace: applyNetworkRace,
    endNetworkRace: endNetworkRace,
    restart: function () { return start(R.stage && R.stage.id); },
    abort: abort,
    editor: { open: openEditor, close: closeEditor, toggle: toggleEditor, save: saveEditorPoints },
    standings: standings,
    checkCompetitorCrossing: checkCompetitorCrossing,
    nextGateFor: nextGateFor,
    competitorState: competitorState,
    state: R,
  };
})();
