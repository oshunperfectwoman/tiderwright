// ===== 71-ui.js =====
// ============================================================================
// TIDEWRIGHT — 71-ui.js
// The brass-and-vellum instrument layer: title, HUD, sea chart, pause, ending,
// touch controls. DOM / CSS / inline SVG / one 2D canvas, all built in init()
// inside #tw-ui. Reads TW.state + TW.game.hud/stats, writes only TW.game.touch.
// OWNER: agent UI.
//   Debug: ?uidemo=title|hud|kindle|chart|pause|lanternout|ending[|free]  fabricates a plausible
//   hud/stats/phase so each screen can be screenshotted against the stub game. &uitouch forces touch layout.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;
  const FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", P052, Georgia, serif';
  const DEG = 180 / Math.PI, TAU = Math.PI * 2;
  const mod = (a, n) => ((a % n) + n) % n;
  const isNum = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;

  // ---------------------------------------------------------------------------
  // Inline SVG line drawings (24-unit grid, currentColor)
  // ---------------------------------------------------------------------------
  const FLAME_D = 'M12 2.6c.9 3.6 4.9 5.6 4.9 10.3a4.9 4.9 0 0 1-9.8 0c0-2.2 1-3.6 2.2-4.9.2 1.5.9 2.4 1.7 2.7-.5-2.6-.2-5.6 1-8.1z';
  const svg = (inner, cls, vb) => '<svg class="' + (cls || 'twui-ic') + '" viewBox="' + (vb || '0 0 24 24') + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  const IC = {
    flame: svg('<path d="' + FLAME_D + '"/>'),
    sail: svg('<path d="M11.2 2.8v15.4"/><path d="M11.2 4.2c4.7 2.9 7.3 7.4 7.8 12.8h-7.8"/><path d="M9.4 7.6C7 10.4 5.6 13.6 5.2 17h4.2"/><path d="M3.4 19.4c2 .9 4.6 1.4 8.6 1.4s6.6-.5 8.6-1.4"/>'),
    anchor: svg('<circle cx="12" cy="4.6" r="1.9"/><path d="M12 6.5v14"/><path d="M8.4 10h7.2"/><path d="M4.6 13.6c.5 4.2 3.6 6.9 7.4 6.9s6.9-2.7 7.4-6.9"/><path d="M3.2 15.6l1.4-2 2 1.3M20.8 15.6l-1.4-2-2 1.3"/>'),
    pause: svg('<path d="M9 6.5v11M15 6.5v11"/>'),
    chart: svg('<path d="M3.6 6.4l5.4-2 6 2 5.4-2v13.2l-5.4 2-6-2-5.4 2z"/><path d="M9 4.4v13.2M15 6.4v13.2"/>'),
    bell: svg('<path d="M7 15.6c0-6 1.4-9.6 5-9.6s5 3.6 5 9.6z"/><path d="M5.4 15.6h13.2"/><path d="M12 3.6V6"/><circle cx="12" cy="18.4" r="1.2"/><path class="twui-strike" d="M4.6 20.4L19.4 4.2"/>'),
    settings: svg('<path d="M12 3.8l1.3 1.9 2.3-.1.8 2.2 2.1.9-.1 2.3 1.9 1.3-1.9 1.3.1 2.3-2.1.9-.8 2.2-2.3-.1-1.3 1.9-1.3-1.9-2.3.1-.8-2.2-2.1-.9.1-2.3-1.9-1.3 1.9-1.3-.1-2.3 2.1-.9.8-2.2 2.3.1z"/><circle cx="12" cy="12" r="2.4"/>'),
    close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    rose: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 2.2l1.9 7.9 7.9 1.9-7.9 1.9-1.9 7.9-1.9-7.9-7.9-1.9 7.9-1.9z"/>'),
    turn: svg('<rect x="7.5" y="3.5" width="9" height="15" rx="1.2"/><path d="M4 13.5c0 4 2.6 6.6 6.4 7M8.6 18.6l1.9 1.9-1.9 1.9"/>'),
    flag: svg('<path d="M5 21V3"/><path d="M5 4h13l-2.6 3.6L18 11H5z"/><path d="M5 11h13l-2.6 3.6L18 18.2H5z"/>'),
  };

  // ---------------------------------------------------------------------------
  // Stylesheet (everything prefixed twui-; colours only from the shell's --tw-* tokens)
  // ---------------------------------------------------------------------------
  const CSS = `
.twui-root{position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:${FONT};font-size:clamp(13px,calc(1.1vmin + 6px),19px);line-height:1.35;color:var(--tw-foam);font-variant-numeric:tabular-nums lining-nums;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;
  --twui-scrim:color-mix(in srgb,var(--tw-ink) 68%,transparent);
  --twui-scrim-soft:color-mix(in srgb,var(--tw-ink) 40%,transparent);
  --twui-rule:color-mix(in srgb,var(--tw-foam) 26%,transparent);
  --twui-rule-strong:color-mix(in srgb,var(--tw-foam) 54%,transparent);
  --twui-ember-rule:color-mix(in srgb,var(--tw-ember) 62%,transparent);
  --twui-shadow:0 0 .5em color-mix(in srgb,var(--tw-ink) 94%,transparent),0 1px 2px color-mix(in srgb,var(--tw-ink) 88%,transparent),0 0 1.7em color-mix(in srgb,var(--tw-ink) 62%,transparent);
  --twui-gl:max(16px,env(safe-area-inset-left,0px));--twui-gr:max(16px,env(safe-area-inset-right,0px));
  --twui-gt:max(12px,env(safe-area-inset-top,0px));--twui-gb:max(14px,env(safe-area-inset-bottom,0px));
  --twui-tap:38px;
  text-shadow:var(--twui-shadow);}
.twui-root.twui-touch{--twui-tap:44px}
.twui-root *,.twui-root *::before,.twui-root *::after{box-sizing:border-box}
.twui-root svg{display:block;overflow:visible}
.twui-ic{width:1.25em;height:1.25em;flex:none}
.twui-root :where(button){font:inherit;color:inherit;margin:0;-webkit-appearance:none;appearance:none;touch-action:none;-webkit-user-select:none;user-select:none}
.twui-root :focus-visible{outline:2px solid var(--tw-foam);outline-offset:3px}
.twui-root button:focus:not(:focus-visible){outline:none}
.twui-key{display:inline-block;min-width:1.7em;padding:.06em .48em .02em;margin:0 .12em;border:1px solid var(--twui-rule-strong);border-radius:2px;font:inherit;font-size:.76em;letter-spacing:.1em;text-transform:uppercase;text-align:center;color:var(--tw-foam);background:var(--twui-scrim-soft);font-style:normal;vertical-align:.08em}

/* ---- buttons: engraved double rule, sharp corners ---- */
.twui-btn{position:relative;pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:.75em;min-height:44px;padding:.62em 1.7em .56em 1.9em;border:1px solid var(--twui-rule-strong);border-radius:1px;background:var(--twui-scrim);font-size:.84em;letter-spacing:.26em;text-transform:uppercase;white-space:nowrap;cursor:pointer;text-shadow:var(--twui-shadow);transition:background .3s ease,border-color .3s ease,color .3s ease,box-shadow .5s ease}
.twui-btn::after{content:"";position:absolute;inset:3px;border:1px solid var(--twui-rule);pointer-events:none;transition:border-color .3s ease}
.twui-btn:hover{background:color-mix(in srgb,var(--tw-foam) 12%,var(--twui-scrim));border-color:var(--tw-foam)}
.twui-btn:active{background:color-mix(in srgb,var(--tw-foam) 20%,var(--twui-scrim))}
.twui-btn--pri{color:var(--tw-ember);border-color:var(--twui-ember-rule);box-shadow:0 0 1.6em color-mix(in srgb,var(--tw-ember-deep) 22%,transparent)}
.twui-btn--pri::after{border-color:color-mix(in srgb,var(--tw-ember) 30%,transparent)}
.twui-btn--pri:hover{background:color-mix(in srgb,var(--tw-ember) 15%,var(--twui-scrim));border-color:var(--tw-ember);box-shadow:0 0 2.2em color-mix(in srgb,var(--tw-ember-deep) 42%,transparent)}
.twui-btn--pri:active{background:color-mix(in srgb,var(--tw-ember) 26%,var(--twui-scrim))}
.twui-btn .twui-ic{width:1.35em;height:1.35em;margin-left:-.35em}
/* text toggles */
.twui-tog{pointer-events:auto;display:inline-flex;align-items:center;gap:.6em;min-height:var(--twui-tap);padding:.2em .2em;border:0;background:none;cursor:pointer;font-size:.74em;letter-spacing:.2em;text-transform:uppercase;text-shadow:var(--twui-shadow)}
.twui-tog-mark{width:.82em;height:.82em;border:1px solid var(--tw-verdigris);border-radius:50%;flex:none;transition:background .3s ease,box-shadow .3s ease}
.twui-tog[aria-pressed="true"] .twui-tog-mark{background:var(--tw-verdigris);box-shadow:0 0 .7em color-mix(in srgb,var(--tw-verdigris) 70%,transparent)}
.twui-tog-lab{color:var(--tw-mist)}
.twui-tog-val{color:var(--tw-foam);min-width:2.3em;text-align:left;border-bottom:1px solid var(--twui-rule)}
.twui-tog:hover .twui-tog-val{border-bottom-color:var(--tw-foam)}
.twui-toggles{display:flex;flex-wrap:wrap;gap:0 1.6em;align-items:center}
/* round brass instrument buttons */
.twui-ib{pointer-events:auto;display:grid;place-items:center;width:var(--twui-tap);height:var(--twui-tap);padding:0;border:1px solid var(--twui-rule-strong);border-radius:50%;background:var(--twui-scrim-soft);color:var(--tw-foam);cursor:pointer;transition:background .3s ease,border-color .3s ease,color .3s ease}
.twui-ib:hover{background:var(--twui-scrim);border-color:var(--tw-foam)}
.twui-ib .twui-ic{width:19px;height:19px;filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-ib .twui-strike{opacity:0}
.twui-ib.twui-muted{color:var(--tw-mist)}
.twui-ib.twui-muted .twui-strike{opacity:1}
.twui-ib.twui-active{border-color:var(--tw-ember);color:var(--tw-ember)}
/* controls legend */
.twui-legend{display:flex;flex-wrap:wrap;gap:.35em 1.4em;font-size:.84em;color:color-mix(in srgb,var(--tw-foam) 62%,var(--tw-mist));letter-spacing:.03em}
.twui-lg{white-space:nowrap}
.twui-legend--touch .twui-lg{white-space:normal}
.twui-lg b{font-weight:400;color:var(--tw-foam);font-size:.8em;text-transform:uppercase;letter-spacing:.18em}

/* ---- title ---- */
.twui-title{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start;padding:0 var(--twui-gr) calc(var(--twui-gb) + 4vh) calc(var(--twui-gl) + 4.4vw);transition:opacity 1.6s ease,visibility 0s linear 1.6s}
.twui-title::before{content:"";position:absolute;inset:0;background:radial-gradient(118% 96% at 0% 100%,color-mix(in srgb,var(--tw-ink) 84%,transparent) 0%,color-mix(in srgb,var(--tw-ink) 52%,transparent) 38%,transparent 70%);pointer-events:none}
.twui-title.twui-off{opacity:0;visibility:hidden}
.twui-title.twui-off *{pointer-events:none!important}
.twui-title-in{position:relative;display:flex;flex-direction:column;align-items:flex-start;max-width:100%}
.twui-title-in>*{animation:twui-rise 1.3s cubic-bezier(.2,.7,.2,1) both}
.twui-title-in>:nth-child(2){animation-delay:.25s}
.twui-title-in>:nth-child(3){animation-delay:.5s}
.twui-title-in>:nth-child(4){animation-delay:.75s}
.twui-title-in>:nth-child(5){animation-delay:1s}
.twui-wmwrap{display:inline-flex;flex-direction:column;align-items:flex-start;max-width:100%}
@keyframes twui-rise{from{opacity:0;transform:translateY(.7em)}to{opacity:1;transform:none}}
.twui-wm{position:relative;margin:0;font-weight:400;font-size:clamp(29px,max(6.3vw,min(8.6vw,36px)),104px);letter-spacing:.22em;line-height:1;white-space:nowrap;color:var(--tw-foam);text-shadow:0 0 .45em color-mix(in srgb,var(--tw-ember) 24%,transparent),0 .03em .05em color-mix(in srgb,var(--tw-ink) 90%,transparent),0 0 1em color-mix(in srgb,var(--tw-ink) 70%,transparent)}
.twui-wm-i{position:relative;display:inline-block}
.twui-wm-glow{position:absolute;left:calc(50% - .11em);bottom:1.08em;width:3em;height:3em;margin:0 0 -1.5em -1.5em;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--tw-ember) 58%,transparent),color-mix(in srgb,var(--tw-ember-deep) 20%,transparent) 42%,transparent);mix-blend-mode:screen;animation:twui-breathe 5.4s ease-in-out infinite;pointer-events:none}
.twui-wm-flame{position:absolute;left:calc(50% - .11em);bottom:.775em;width:.5em;height:.68em;margin-left:-.25em;transform-origin:50% 100%;animation:twui-flicker 3.3s ease-in-out infinite;filter:drop-shadow(0 0 .08em var(--tw-ember))}
@keyframes twui-breathe{0%,100%{opacity:.78;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}
@keyframes twui-flicker{0%,100%{transform:scaleY(1) skewX(0)}30%{transform:scaleY(1.07) skewX(-2.5deg)}55%{transform:scaleY(.95) skewX(2deg)}80%{transform:scaleY(1.04) skewX(-1deg)}}
.twui-swash{width:calc(100% - .22em);height:.34em;margin-top:.16em;font-size:clamp(29px,max(6.3vw,min(8.6vw,36px)),104px);color:var(--tw-ember);filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-swash path{stroke-width:1.3;vector-effect:non-scaling-stroke;stroke-dasharray:1;stroke-dashoffset:0;animation:twui-draw 2.6s .7s cubic-bezier(.4,0,.2,1) both}
@keyframes twui-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.twui-premise{margin:.8em 0 1.15em;max-width:100%;font-style:italic;font-size:1.14em;line-height:1.45;color:var(--tw-foam)}
.twui-premise span{display:block}
@media (min-width:720px){.twui-premise span{white-space:nowrap}}
.twui-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:.5em 2.2em;margin-bottom:.8em}
.twui-rotate{display:none;align-items:center;gap:.6em;margin-top:.9em;font-style:italic;font-size:.84em;color:var(--tw-mist)}
@media (orientation:portrait) and (max-width:520px){.twui-touch .twui-rotate{display:flex}}

/* ---- HUD ---- */
.twui-hud{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity 1.2s ease,visibility 0s linear 1.2s}
.twui-hud.twui-on{opacity:1;visibility:visible;transition:opacity 1.4s ease .4s,visibility 0s}
.twui-hud.twui-on.twui-leaving{opacity:0;transition:opacity 5s ease}
.twui-hush .twui-hud.twui-on,.twui-hush .twui-hint,.twui-hush .twui-kindle{opacity:0!important;transition:opacity .9s ease}
.twui-hud.twui-leaving button{pointer-events:none}
.twui-hide{display:none!important}
.twui-beacons,.twui-kindle,.twui-hint{transition:opacity .5s ease}
.twui-compass{transition:opacity 1.3s ease}
.twui-bannering .twui-compass,.twui-root[data-phase="ending"] .twui-compass{opacity:0}
.twui-quiet .twui-compass,.twui-quiet .twui-beacons,.twui-quiet .twui-kindle,.twui-quiet .twui-hint{opacity:0}
.twui-gauges,.twui-corner{transition:opacity .5s ease}
.twui-root[data-phase="paused"] .twui-gauges,.twui-root[data-phase="paused"] .twui-corner{opacity:.25}
/* compass ribbon */
.twui-top{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);grid-template-areas:"b c k" ". g g";align-items:start;gap:.55em .9em;padding:var(--twui-gt) var(--twui-gr) 0 var(--twui-gl)}
.twui-compass{grid-area:c;position:relative;width:clamp(180px,32vw,440px);text-align:center}
.twui-compass::before{content:"";position:absolute;inset:-22px -16% -20px;background:radial-gradient(closest-side,color-mix(in srgb,var(--tw-ink) 54%,transparent),color-mix(in srgb,var(--tw-ink) 32%,transparent) 52%,transparent);pointer-events:none}
.twui-tape{position:relative;height:2em;overflow:hidden;border-bottom:1px solid var(--twui-rule-strong);-webkit-mask-image:linear-gradient(to right,transparent,#000 16%,#000 84%,transparent);mask-image:linear-gradient(to right,transparent,#000 16%,#000 84%,transparent)}
.twui-strip{position:absolute;left:0;top:0;width:600%;height:100%;will-change:transform}
.twui-tk{position:absolute;bottom:0;width:1px;height:.34em;background:var(--tw-verdigris);opacity:.9}
.twui-tk--m{height:.62em;opacity:1}
.twui-tl{position:absolute;top:.2em;width:4em;margin-left:-2em;padding-left:.16em;font-size:.72em;letter-spacing:.16em;text-transform:uppercase;color:color-mix(in srgb,var(--tw-foam) 60%,var(--tw-mist));text-align:center;text-shadow:0 0 .3em var(--tw-ink),0 0 .7em var(--tw-ink),0 1px 1px var(--tw-ink)}
.twui-tl--c{top:.02em;font-size:.96em;color:var(--tw-foam)}
.twui-tl--n{color:var(--tw-ember)}
.twui-lane{position:relative;height:1.2em}
.twui-lub{position:absolute;left:50%;top:1px;margin-left:-4px;border:4px solid transparent;border-top:0;border-bottom:5px solid var(--tw-foam);filter:drop-shadow(0 1px 1px var(--tw-ink))}
.twui-mk{position:absolute;left:0;top:0;width:100%;height:100%;will-change:transform;transition:opacity .4s ease}
.twui-mk>svg{position:absolute;left:0;top:.08em;width:1.05em;height:1.05em;margin-left:-.525em;filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-mk[data-off="l"],.twui-mk[data-off="r"]{opacity:.6}
.twui-mk--tgt{color:var(--tw-ember)}
.twui-mk--tgt>svg path{fill:var(--tw-ember);stroke:var(--tw-ember-deep);stroke-width:1}
.twui-mk--wind{color:var(--tw-verdigris)}
.twui-mk--wind.twui-irons{color:var(--tw-foam);animation:twui-pulse 1.1s ease-in-out infinite}
@keyframes twui-pulse{0%,100%{opacity:1}50%{opacity:.25}}
.twui-tgt{position:relative;margin-top:.1em;font-size:.76em;font-weight:600;letter-spacing:.2em;text-transform:uppercase;padding-left:.2em;white-space:nowrap;color:var(--tw-foam);text-shadow:0 0 .25em var(--tw-ink),0 0 .5em var(--tw-ink),0 1px 1px var(--tw-ink),0 0 1.1em var(--tw-ink),0 0 2em var(--tw-ink)}
.twui-tgt i{font-style:normal;color:var(--tw-ember);margin:0 .5em}
.twui-tgt-d{color:color-mix(in srgb,var(--tw-foam) 70%,var(--tw-mist))}
.twui-ironstip{margin-top:.3em;font-style:italic;font-size:.88em;color:var(--tw-ember);opacity:0;transition:opacity .7s ease}
.twui-ironstip.twui-on{opacity:1}
/* beacon pips */
.twui-beacons{grid-area:b;position:relative;justify-self:start;max-width:min(100%,21em)}
.twui-raceboard{display:none;position:relative;width:min(25em,calc(100vw - 2em));padding:.65em .8em .55em;border:1px solid var(--twui-ember-rule);background:color-mix(in srgb,var(--tw-ink) 72%,transparent);box-shadow:0 0 .9em color-mix(in srgb,var(--tw-ink) 58%,transparent);font-size:.72em;letter-spacing:.06em}
.twui-raceboard.twui-on{display:block}
.twui-race .twui-beacons>.twui-pips,.twui-race .twui-beacons>.twui-obj{display:none}
.twui-racehead{display:flex;justify-content:space-between;gap:1em;margin-bottom:.38em;color:var(--tw-ember);font-size:.76em;letter-spacing:.18em;text-transform:uppercase}
.twui-raceclock{font-variant-numeric:tabular-nums;color:var(--tw-foam);letter-spacing:.08em}
.twui-racerow{display:grid;grid-template-columns:1.5em 2.1em minmax(0,1fr) auto;gap:.42em;align-items:center;min-height:1.65em;color:var(--tw-mist);font-variant-numeric:tabular-nums}
.twui-racerow+.twui-racerow{border-top:1px solid color-mix(in srgb,var(--tw-foam) 10%,transparent)}
.twui-racerow--player{color:var(--tw-foam);font-weight:700}
.twui-racerow--done{color:var(--tw-ember)}
.twui-rank{color:var(--tw-ember);text-align:center}
.twui-raceboat{font-weight:700;color:var(--tw-foam)}
.twui-racegap{color:var(--tw-mist);text-align:right}
.twui-raceprogress{display:flex;align-items:center;justify-content:space-between;gap:.8em;margin:.1em 0 .45em;padding:.35em .5em;border-left:2px solid var(--tt-cyan);background:rgba(32,216,208,.07);color:var(--tt-white);font:800 .76em/1.2 Inter,"Segoe UI",sans-serif;letter-spacing:.1em;text-transform:uppercase}
.twui-raceprogress strong{color:var(--tt-cyan);font-variant-numeric:tabular-nums}
.twui-racenotice{position:absolute;left:50%;top:calc(100% + .45em);transform:translateX(-50%);padding:.35em .7em;border:1px solid rgba(32,216,208,.45);border-radius:4px;background:rgba(5,22,34,.92);color:var(--tt-white);font:900 .82em/1.2 Inter,"Segoe UI",sans-serif;letter-spacing:.12em;text-align:center;white-space:nowrap;opacity:0;pointer-events:none}
.twui-racenotice.twui-racenotice--show{animation:twui-race-notice 2.2s ease both}
@keyframes twui-race-notice{0%{opacity:0;transform:translate(-50%,.35em) scale(.96)}12%,72%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-.25em) scale(1)}}
.twui-racerow{grid-template-columns:1.35em 1.8em minmax(0,1fr) auto}
.twui-racesplit{display:block;margin-top:.08em;color:var(--tt-muted);font-size:.78em;font-weight:600;letter-spacing:.04em}
.twui-racerow--player .twui-racesplit{color:var(--tt-cyan)}
.twui-racetrack{height:3px;flex-basis:100%;overflow:hidden;border-radius:4px;background:rgba(242,247,248,.16);margin-top:.08em}
.twui-racetrack i{display:block;width:0;height:100%;background:var(--tt-cyan);transition:width .2s ease}
.twui-sailread{display:table;margin:.28em auto 0;padding:.18em .55em;border:1px solid rgba(32,216,208,.28);border-radius:999px;background:rgba(7,23,37,.48);color:var(--tt-cyan);font:800 .64em/1.3 Inter,"Segoe UI",sans-serif;letter-spacing:.12em;text-transform:uppercase}
.twui-navcue{min-height:1.25em;margin-top:.18em;color:var(--tt-white);font:800 .67em/1.25 Inter,"Segoe UI",sans-serif;letter-spacing:.1em;text-align:center;text-transform:uppercase;opacity:0;transform:translateY(-2px);transition:opacity .18s ease,transform .18s ease}
.twui-navcue.twui-on{opacity:1;transform:none}
.twui-navcue.twui-navcue--alert{color:#ffd18d}
.twui-beacons::before{content:"";position:absolute;inset:-14px -40px -14px -30px;background:radial-gradient(closest-side,color-mix(in srgb,var(--tw-ink) 42%,transparent),transparent);pointer-events:none}
.twui-pips{position:relative;display:flex;align-items:flex-end;gap:.3em;height:2em}
.twui-pip{width:1.22em;height:1.22em;color:color-mix(in srgb,var(--tw-foam) 72%,transparent);filter:drop-shadow(0 1px 2px var(--tw-ink));transition:color 1.4s ease,filter 1.4s ease;transform-origin:50% 90%}
.twui-pip path{fill:var(--twui-scrim-soft);transition:fill 1.4s ease;stroke-width:1.5}
.twui-pip--heart{width:1.9em;height:1.9em;margin-left:.3em}
.twui-pip--heart path{stroke-width:1.05}
.twui-pip.twui-lit{color:var(--tw-ember);filter:drop-shadow(0 0 .28em var(--tw-ember)) drop-shadow(0 0 .7em var(--tw-ember-deep))}
.twui-pip.twui-lit path{fill:var(--tw-ember)}
.twui-pip.twui-flare{animation:twui-flare 2.2s cubic-bezier(.2,.7,.2,1)}
@keyframes twui-flare{0%{transform:scale(1)}16%{transform:scale(2.3);filter:drop-shadow(0 0 .5em var(--tw-foam)) drop-shadow(0 0 1.4em var(--tw-ember))}100%{transform:scale(1)}}
.twui-obj{text-wrap:balance;position:relative;margin-top:.35em;font-style:italic;font-size:.9em;line-height:1.3;color:var(--tw-foam)}
/* corner buttons */
.twui-corner{grid-area:k;justify-self:end;display:flex;gap:.55em}
/* gauges */
.twui-gauges{position:absolute;left:var(--twui-gl);bottom:var(--twui-gb);display:flex;align-items:flex-end;font-size:1.12em}
.twui-gauges::before{content:"";position:absolute;inset:-22px -44px -22px -34px;background:radial-gradient(closest-side,color-mix(in srgb,var(--tw-ink) 50%,transparent),transparent);pointer-events:none}
.twui-touch .twui-gauges{position:relative;left:auto;bottom:auto;grid-area:g;justify-self:end}
@media (max-width:899px),(max-height:519px){.twui-gauges{position:relative;left:auto;bottom:auto;grid-area:g;justify-self:end}}
.twui-g{position:relative;display:flex;flex-direction:column;align-items:center;gap:.3em;padding:0 .95em}
.twui-g+.twui-g{border-left:1px solid var(--twui-rule)}
.twui-g:first-child{padding-left:.1em}
.twui-g:last-child{padding-right:.1em}
.twui-g-fig{height:2.3em;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.twui-g-lab{font-size:.58em;letter-spacing:.24em;text-transform:uppercase;color:var(--tw-mist);padding-left:.24em}
.twui-lantern{width:1.6em;height:2.25em;color:var(--tw-foam);filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-lantern .twui-oil{fill:color-mix(in srgb,var(--tw-ember) 34%,transparent);stroke:none;transform-origin:0 26.5px;transition:transform .8s ease}
.twui-lantern .twui-lflame{fill:var(--tw-ember);stroke:none;transform-origin:10px 21px;transition:transform .8s ease;filter:drop-shadow(0 0 2px var(--tw-ember))}
.twui-g--low .twui-lantern{color:var(--tw-ember);animation:twui-low 1.3s ease-in-out infinite}
@keyframes twui-low{0%,100%{opacity:1}50%{opacity:.5}}
.twui-hull{width:2.7em;height:1.25em;color:var(--tw-foam);filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-bar{width:2.7em;height:3px;margin-top:.32em;background:var(--twui-rule);overflow:hidden}
.twui-bar i{display:block;width:100%;height:100%;background:var(--tw-verdigris);transform-origin:0 50%;transition:transform .6s ease,background .6s ease}
.twui-g--low .twui-hull{color:var(--tw-ember)}
.twui-g--low .twui-bar i{background:var(--tw-ember-deep)}
.twui-spd{font-size:1.62em;line-height:1;letter-spacing:.02em;min-width:2.1em;text-align:center}
.twui-sailg{position:relative;width:1.7em;height:2.05em;color:var(--tw-foam);filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-sailg svg{position:absolute;inset:0;width:100%;height:100%}
.twui-sailfill{color:var(--tw-verdigris);transition:clip-path .5s ease}
.twui-sailfill path{fill:color-mix(in srgb,var(--tw-verdigris) 62%,transparent);stroke:none}
/* kindling */
.twui-bottom{position:absolute;left:50%;bottom:calc(var(--twui-gb) + 1.4vh);width:min(36em,calc(100vw - 42em));transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.7em}
@media (max-width:899px),(max-height:519px){.twui-bottom{width:min(36em,calc(100vw - var(--twui-gl) - var(--twui-gr)))}}
.twui-touch .twui-bottom{width:min(36em,calc(100vw - 480px))}
@media (max-width:759px){.twui-touch .twui-bottom{width:max(11em,calc(100vw - 360px))}}
@media (max-width:759px) and (min-height:520px){.twui-touch .twui-bottom{width:calc(100vw - var(--twui-gl) - var(--twui-gr));bottom:calc(var(--twui-gb) + 176px)}}
.twui-bannering .twui-kindle.twui-on{opacity:0}
.twui-kindle{max-width:100%;display:flex;flex-direction:column;align-items:center;gap:.5em;text-align:center;opacity:0;transition:opacity .7s ease}
.twui-kindle.twui-on{opacity:1}
.twui-quiet .twui-kindle.twui-on{opacity:0}
.twui-ring{width:4.3em;height:4.3em;color:var(--tw-ember);filter:drop-shadow(0 0 .5em color-mix(in srgb,var(--tw-ink) 80%,transparent))}
.twui-ring-bg{fill:var(--twui-scrim-soft);stroke:var(--twui-rule-strong);stroke-width:1}
.twui-ring-fg{stroke:var(--tw-ember);stroke-width:2.6;transform:rotate(-90deg);transform-origin:50% 50%;filter:drop-shadow(0 0 3px var(--tw-ember-deep))}
.twui-ring-fl{fill:color-mix(in srgb,var(--tw-ember) 22%,transparent);stroke:var(--tw-ember);stroke-width:1.2;transition:fill .5s ease}
.twui-kindle.twui-in .twui-ring-fl{fill:var(--tw-ember)}
.twui-kindle.twui-far .twui-ring{opacity:.55}
.twui-kindle-txt{font-size:.98em;letter-spacing:.05em}
/* hints */
.twui-hint{width:100%;min-height:2.7em;display:flex;align-items:flex-end;justify-content:center;text-align:center;font-style:italic;font-size:1.06em;line-height:1.35;text-wrap:balance;opacity:0;transition:opacity 1s ease}
.twui-hint.twui-on{opacity:1}
.twui-quiet .twui-hint.twui-on{opacity:0}
/* beacon banner */
.twui-banner{position:absolute;left:0;right:0;top:max(33%,12.5em);display:flex;flex-direction:column;align-items:center;gap:.5em;padding:0 var(--twui-gr) 0 var(--twui-gl);text-align:center;opacity:0;transform:translateY(.5em);transition:opacity 1.5s ease,transform 2.4s cubic-bezier(.2,.7,.2,1)}
.twui-banner.twui-on{opacity:1;transform:none}
.twui-banner::before{content:"";position:absolute;left:50%;top:50%;width:min(46em,96vw);height:15em;transform:translate(-50%,-50%);background:radial-gradient(closest-side,color-mix(in srgb,var(--tw-ink) 52%,transparent),transparent);pointer-events:none}
.twui-banner-name{position:relative;font-size:clamp(20px,3.5vw,54px);line-height:1.1;letter-spacing:.32em;padding-left:.32em;text-transform:uppercase;text-shadow:0 0 .6em color-mix(in srgb,var(--tw-ember) 50%,transparent),var(--twui-shadow)}
.twui-rule{position:relative;display:flex;align-items:center;justify-content:center;gap:.9em;color:var(--tw-ember);width:min(24em,74vw)}
.twui-rule::before,.twui-rule::after{content:"";flex:1;height:1px;background:var(--twui-ember-rule)}
.twui-rule .twui-ic{width:1.05em;height:1.05em;filter:drop-shadow(0 0 .3em var(--tw-ember-deep))}
.twui-rule .twui-ic path{fill:var(--tw-ember);stroke:none}
.twui-banner-sub{position:relative;font-style:italic;font-size:1.14em}
/* edge vignette, hull flash, black-out */
.twui-vig,.twui-flash,.twui-fade{position:absolute;inset:0;opacity:0;will-change:opacity}
.twui-vig{box-shadow:inset 0 0 24vmin 5vmin color-mix(in srgb,var(--tw-ember-deep) 32%,var(--tw-ink))}
.twui-flash{box-shadow:inset 0 0 20vmin 3vmin color-mix(in srgb,var(--tw-ember-deep) 72%,transparent);background:color-mix(in srgb,var(--tw-foam) 7%,transparent)}
.twui-fade{background:color-mix(in srgb,var(--tw-ink) 22%,black)}
.twui-fadetxt{position:absolute;left:50%;top:50%;width:min(30em,84vw);transform:translate(-50%,-50%);text-align:center;font-style:italic;font-size:clamp(17px,2.3vw,30px);line-height:1.4;opacity:0;transition:opacity 1.8s ease}
.twui-fadetxt.twui-on{opacity:1;transition:opacity 1.8s ease .5s}

/* ---- touch controls ---- */
.twui-stickzone,.twui-kbtn{display:none}
.twui-touch.twui-play .twui-stickzone{display:block}
.twui-touch.twui-play .twui-kbtn{display:grid}
.twui-stickzone{position:absolute;left:0;top:24%;bottom:0;width:45%;pointer-events:auto;touch-action:none}
.twui-stick{position:absolute;left:0;top:0;width:124px;height:124px;margin:-62px 0 0 -62px;border-radius:50%;border:1px solid color-mix(in srgb,var(--tw-ember) 46%,var(--tw-mist));background:radial-gradient(closest-side,transparent 62%,var(--twui-scrim-soft));box-shadow:inset 0 0 0 5px color-mix(in srgb,var(--tw-ink) 30%,transparent),inset 0 0 0 6px var(--twui-rule);opacity:.42;transition:opacity .35s ease;will-change:transform}
.twui-stick.twui-held{opacity:1}
.twui-stick svg{position:absolute;inset:0;width:100%;height:100%;color:var(--tw-mist)}
.twui-knob{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;border:1px solid var(--tw-ember);background:var(--twui-scrim);box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--tw-ember) 22%,transparent),0 0 14px color-mix(in srgb,var(--tw-ember-deep) 40%,transparent);will-change:transform}
.twui-kbtn{position:absolute;right:calc(var(--twui-gr) + 6px);bottom:calc(var(--twui-gb) + 10px);width:92px;height:92px;padding:0;place-items:center;border-radius:50%;border:1px solid var(--twui-rule-strong);background:var(--twui-scrim);pointer-events:auto;touch-action:none;cursor:pointer;color:var(--tw-mist);transition:border-color .5s ease,color .5s ease,box-shadow .7s ease}
.twui-kbtn>*{grid-area:1/1}
.twui-kbtn .twui-ring{width:100%;height:100%;filter:none}
.twui-kbtn .twui-ring-bg{fill:none;stroke:var(--twui-rule)}
.twui-kbtn .twui-ring-fl{display:none}
.twui-kbtn-in{display:flex;flex-direction:column;align-items:center;gap:1px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;padding-left:.22em}
.twui-kbtn-in .twui-ic{width:26px;height:26px;margin-left:-.22em}
.twui-kbtn.twui-ready{border-color:var(--tw-ember);color:var(--tw-ember);box-shadow:0 0 22px color-mix(in srgb,var(--tw-ember-deep) 60%,transparent),inset 0 0 16px color-mix(in srgb,var(--tw-ember) 20%,transparent);animation:twui-ready 2.2s ease-in-out infinite}
.twui-kbtn.twui-ready .twui-ic path{fill:color-mix(in srgb,var(--tw-ember) 40%,transparent)}
.twui-kbtn.twui-held{background:color-mix(in srgb,var(--tw-ember) 22%,var(--twui-scrim))}
@keyframes twui-ready{0%,100%{box-shadow:0 0 18px color-mix(in srgb,var(--tw-ember-deep) 50%,transparent),inset 0 0 14px color-mix(in srgb,var(--tw-ember) 16%,transparent)}50%{box-shadow:0 0 34px color-mix(in srgb,var(--tw-ember-deep) 85%,transparent),inset 0 0 20px color-mix(in srgb,var(--tw-ember) 30%,transparent)}}

/* ---- sea chart ---- */
.twui-chart{--twui-cs:min(86vh,92vw,800px);position:absolute;left:50%;top:50%;width:var(--twui-cs);height:var(--twui-cs);margin:calc(var(--twui-cs) / -2) 0 0 calc(var(--twui-cs) / -2);pointer-events:none;opacity:0;visibility:hidden;transform:translateY(1.2em) rotate(.35deg);transition:opacity .5s ease,transform .7s cubic-bezier(.2,.7,.2,1),visibility 0s linear .5s;box-shadow:0 1.4em 4.5em color-mix(in srgb,var(--tw-ink) 86%,transparent),0 0 0 1px color-mix(in srgb,var(--tw-ink) 70%,transparent);text-shadow:none}
.twui-chart.twui-on{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity .5s ease,transform .7s cubic-bezier(.2,.7,.2,1),visibility 0s}
.twui-chart canvas{display:block;width:100%;height:100%}
.twui-chart-x{position:absolute;top:calc(2.4% + 4px);right:calc(2.4% + 4px);border-color:color-mix(in srgb,var(--tw-ink) 60%,transparent);background:color-mix(in srgb,var(--tw-foam) 40%,transparent);color:var(--tw-ink)}
.twui-chart-x:hover{background:color-mix(in srgb,var(--tw-foam) 80%,transparent);border-color:var(--tw-ink)}
.twui-chart-x .twui-ic{filter:none}
.twui-chart .twui-chart-x:focus-visible{outline-color:var(--tw-ink)}
@media (max-height:520px),(max-width:560px){.twui-chart{--twui-cs:min(calc(100vh - 16px),calc(100vw - 16px))}}
.twui-rock-tools{position:absolute;z-index:3;left:50%;bottom:2.2%;transform:translateX(-50%);width:min(94%,700px);display:flex;flex-direction:column;gap:5px;padding:7px;border:1px solid rgba(10,17,24,.45);border-radius:5px;background:rgba(233,239,230,.88);color:#0a1118;box-shadow:0 3px 14px rgba(0,0,0,.25);font:11px/1.25 Inter,"Segoe UI",sans-serif;pointer-events:auto}
.twui-rock-tool-row{display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:wrap}
.twui-rock-tool-btn{min-height:30px;padding:5px 8px;border:1px solid rgba(10,17,24,.48);border-radius:3px;background:rgba(10,17,24,.88);color:#e9efe6;font:700 10px/1.2 Inter,"Segoe UI",sans-serif;letter-spacing:.03em;cursor:pointer}
.twui-rock-tool-btn:hover:not(:disabled),.twui-rock-tool-btn.twui-rock-on{background:#b9622b;color:#fff}
.twui-rock-tool-btn:disabled{opacity:.42;cursor:default}
.twui-rock-controls[hidden]{display:none!important}
.twui-rock-hint,.twui-rock-status{display:block;text-align:center;font-size:9px;color:#263b42}
.twui-rock-status{font-weight:800;color:#713c20}
.twui-rock-range{display:flex;align-items:center;gap:5px;font-size:9px;white-space:nowrap}
.twui-rock-range input{width:92px;accent-color:#b9622b;touch-action:auto}
.twui-rock-range output{min-width:28px;font-variant-numeric:tabular-nums;text-align:right}
.twui-chart.twui-rock-editing canvas{cursor:crosshair;touch-action:none}
@media (max-width:560px){.twui-rock-tools{bottom:1.2%;width:96%;padding:5px}.twui-rock-tool-btn{min-height:34px;padding:5px 6px;font-size:9px}.twui-rock-range input{width:70px}}

/* ---- pause + ending ---- */
.twui-pause,.twui-end{position:absolute;inset:0;display:flex;justify-content:center;opacity:0;visibility:hidden;pointer-events:none}
.twui-pause{align-items:center;padding:var(--twui-gt) var(--twui-gr) var(--twui-gb) var(--twui-gl);background:radial-gradient(ellipse at 50% 50%,color-mix(in srgb,var(--tw-ink) 82%,transparent) 0%,color-mix(in srgb,var(--tw-ink) 56%,transparent) 75%);transition:opacity .5s ease,visibility 0s linear .5s}
.twui-pause.twui-on{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .5s ease,visibility 0s}
.twui-col{display:flex;flex-direction:column;align-items:center;gap:.75em;text-align:center;max-width:100%}
.twui-col>.twui-ic{width:2.1em;height:2.1em;color:var(--tw-verdigris);margin-bottom:-.2em;filter:drop-shadow(0 1px 2px var(--tw-ink))}
.twui-h{margin:0;font-weight:400;font-size:clamp(22px,3.3vw,46px);line-height:1.1;letter-spacing:.32em;padding-left:.32em;text-transform:uppercase}
.twui-sub{margin:0;font-style:italic;font-size:1.04em;color:var(--tw-foam);max-width:32em;line-height:1.45}
.twui-sub span{display:block;text-wrap:balance}
.twui-stack{display:flex;flex-direction:column;align-items:stretch;gap:.7em;min-width:16em;margin-top:.35em}
.twui-pair{display:flex;flex-wrap:wrap;justify-content:center;gap:.7em 1em}
.twui-pause .twui-toggles{justify-content:center}
.twui-pause .twui-legend{justify-content:center;max-width:min(92vw,60em)}
.twui-pause-confirm{display:none}
.twui-pause.twui-confirming .twui-pause-main{display:none}
.twui-pause.twui-confirming .twui-pause-confirm{display:flex}
.twui-end{align-items:flex-end;padding:var(--twui-gt) var(--twui-gr) calc(var(--twui-gb) + 5vh) var(--twui-gl);transition:opacity 1.2s ease,visibility 0s linear 1.2s}
.twui-end::before{content:"";position:absolute;inset:0;background:radial-gradient(92% 96% at 50% 100%,color-mix(in srgb,var(--tw-ink) 74%,transparent) 0%,color-mix(in srgb,var(--tw-ink) 46%,transparent) 44%,transparent 74%)}
.twui-end.twui-on{opacity:1;visibility:visible;transition:opacity 3.5s ease,visibility 0s}
.twui-end.twui-on button{pointer-events:auto}
.twui-end .twui-col{position:relative;gap:.8em}
.twui-end .twui-h{text-shadow:0 0 .7em color-mix(in srgb,var(--tw-ember) 45%,transparent),var(--twui-shadow)}
.twui-stats{display:flex;justify-content:center;margin:.35em 0 .5em}
.twui-stat{padding:0 1.5em;display:flex;flex-direction:column;align-items:center;gap:.2em}
.twui-stat+.twui-stat{border-left:1px solid var(--twui-rule)}
.twui-stat b{font-weight:400;font-size:1.55em;line-height:1.1;letter-spacing:.03em}
.twui-stat b small{font-size:.58em;font-style:italic;color:var(--tw-mist);margin:0 .3em;letter-spacing:0}
.twui-stat span{font-size:.6em;letter-spacing:.22em;text-transform:uppercase;color:color-mix(in srgb,var(--tw-foam) 55%,var(--tw-mist));padding-left:.22em;max-width:14em}
@media (min-width:720px){.twui-stat span{white-space:nowrap;max-width:none}.twui-end .twui-sub{max-width:44em}}

/* ---- reflow: narrow portrait phones ---- */
@media (max-width:640px){
  .twui-title{padding-left:var(--twui-gl);padding-bottom:calc(var(--twui-gb) + 3.5vh)}
  .twui-premise{font-size:1.05em;margin:.8em 0 1.1em}
  .twui-stats{display:grid;grid-template-columns:1fr 1fr;gap:.9em 0}
  .twui-stat{padding:0 1em}
  .twui-stat:nth-child(3){border-left:0}
  .twui-stack{min-width:min(16em,100%)}
}
@media (max-width:599px){
  .twui-top{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"b k" "c c" "g g"}
  .twui-compass{justify-self:center;width:min(72vw,300px)}
  .twui-root .twui-gauges{justify-self:center}
  .twui-banner{top:max(42%,18em)}
}
@media (max-height:440px){
  .twui-title{padding-bottom:calc(var(--twui-gb) + 3vh)}
  .twui-premise{margin:.6em 0 .8em}
  .twui-title-row{margin-bottom:.5em}
  .twui-col{gap:.5em}
  .twui-end{padding-bottom:calc(var(--twui-gb) + 2vh)}
  .twui-end .twui-col{gap:.5em}
  .twui-stats{margin:.1em 0 .2em}
}
/* -------------------------------------------------------------------------
   TRADITOUR 2027 — Caribbean Sailing Racing design system
   The game world remains untouched; only interface tokens and components
   below are re-skinned.
--------------------------------------------------------------------------- */
.twui-root{--tt-ink:#071725;--tt-deep:#102B40;--tt-panel:#123247;--tt-panel-glass:rgba(8,28,43,.82);--tt-cyan:#20D8D0;--tt-blue:#258BFF;--tt-white:#F2F7F8;--tt-muted:#9BB7C8;--tt-orange:#FF754F;--tt-lime:#B8F36B;--tt-line:rgba(175,207,222,.22);--tw-ink:var(--tt-ink);--tw-foam:var(--tt-white);--tw-mist:var(--tt-muted);--tw-verdigris:var(--tt-cyan);--tw-ember:var(--tt-cyan);--tw-ember-deep:var(--tt-blue);font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif;letter-spacing:.01em}
.twui-title{justify-content:center;padding:0 var(--twui-gr) 8vh var(--twui-gl);background:linear-gradient(90deg,rgba(7,23,37,.88),rgba(7,23,37,.32) 54%,transparent 82%)}
.twui-title::before{background:linear-gradient(180deg,rgba(7,23,37,.14),rgba(7,23,37,.62)),radial-gradient(80% 120% at 0% 100%,rgba(7,23,37,.92),transparent 76%)}
.twui-title-in{max-width:42em}
.twui-wm{display:flex;flex-direction:column;gap:.02em;font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif;font-weight:900;font-size:clamp(40px,9vw,112px);line-height:.8;letter-spacing:.08em;text-transform:uppercase;color:var(--tt-white);text-shadow:0 6px 22px rgba(0,0,0,.5)}
.twui-wm small{font-size:.42em;letter-spacing:.28em;color:var(--tt-cyan);line-height:1;margin-left:.06em}
.twui-wm-glow,.twui-wm-flame,.twui-swash{display:none}
.twui-premise{margin:1.4em 0 1.6em;font-style:normal;font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif;font-size:clamp(13px,1.6vw,21px);font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:var(--tt-cyan)}
.twui-premise span{display:block}
.twui-btn{min-height:48px;border:1px solid var(--tt-line);border-radius:7px;background:rgba(18,50,71,.72);font-family:Inter,"Segoe UI",sans-serif;font-weight:800;letter-spacing:.12em;color:var(--tt-white);box-shadow:0 8px 24px rgba(0,0,0,.22);transition:transform .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease}
.twui-btn::after{display:none}
.twui-btn:hover{transform:translateY(-2px);background:rgba(32,216,208,.15);border-color:var(--tt-cyan);box-shadow:0 0 22px rgba(32,216,208,.2)}
.twui-btn--pri{background:var(--tt-cyan);border-color:var(--tt-cyan);color:var(--tt-ink);box-shadow:0 0 26px rgba(32,216,208,.24)}
.twui-btn--pri:hover{background:#62eee8;border-color:#62eee8;color:var(--tt-ink)}
.twui-legend{font-family:Inter,"Segoe UI",sans-serif;color:var(--tt-muted)}
.twui-ib{border-radius:8px;background:rgba(8,28,43,.62);border-color:var(--tt-line);color:var(--tt-white)}
.twui-ib:hover,.twui-ib.twui-active{background:rgba(32,216,208,.16);border-color:var(--tt-cyan);color:var(--tt-cyan)}
.twui-top{padding-top:18px}
.twui-compass::before{background:radial-gradient(closest-side,rgba(7,23,37,.72),rgba(7,23,37,.22) 56%,transparent)}
.twui-tk{background:var(--tt-cyan)} .twui-tl--n{color:var(--tt-cyan)} .twui-lub{border-bottom-color:var(--tt-white)}
.twui-tgt i,.twui-tgt-d{color:var(--tt-cyan)}
.twui-raceboard{border-color:rgba(32,216,208,.42);border-radius:8px;background:rgba(8,28,43,.78);backdrop-filter:blur(12px);box-shadow:0 12px 28px rgba(0,0,0,.28);font-family:Inter,"Segoe UI",sans-serif}
.twui-racehead{color:var(--tt-cyan);font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif;font-weight:800}
.twui-raceclock{position:fixed;z-index:245;left:50%;top:17px;transform:translateX(-50%);padding:.15em .5em;border-bottom:2px solid var(--tt-cyan);font-family:"Rajdhani","Arial Narrow",Inter,sans-serif;font-size:clamp(25px,3.3vw,48px);font-weight:800;letter-spacing:.08em;color:var(--tt-white);text-shadow:0 0 18px rgba(32,216,208,.35)}
.twui-racerow--player{color:var(--tt-cyan);background:rgba(32,216,208,.08)}
.twui-rank,.twui-raceboat{color:var(--tt-cyan)} .twui-racegap{color:var(--tt-muted)}
.twui-g-lab{color:var(--tt-muted)} .twui-sailfill path{fill:rgba(32,216,208,.72)} .twui-bar i{background:var(--tt-cyan)}
.twui-pause,.twui-end{background:rgba(7,23,37,.76);backdrop-filter:blur(16px)}
.twui-h{font-family:"Arial Narrow","Roboto Condensed",Inter,sans-serif;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--tt-white)}
.twui-sub{font-family:Inter,"Segoe UI",sans-serif;font-style:normal;color:var(--tt-muted)}
.twui-stat b{font-family:"Rajdhani","Arial Narrow",Inter,sans-serif;color:var(--tt-cyan)}
.twui-hint{font-family:Inter,"Segoe UI",sans-serif;color:var(--tt-white)}
@media (max-width:520px){.twui-raceboard{width:min(22em,calc(100vw - 1.5em));font-size:.64em}.twui-raceclock{top:12px;font-size:25px}.twui-title{padding-left:18px;padding-bottom:8vh}.twui-wm{font-size:clamp(42px,15vw,78px)}.twui-premise{font-size:11px;letter-spacing:.16em}}
@media (prefers-reduced-motion:reduce){
  .twui-root *,.twui-root *::before,.twui-root *::after{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01s!important;transition-delay:0s!important}
}
`;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let built = false, root = null, clock = 0, lastPhase = '', touchMode = false, muted = false;
  let painterlyOn = true, painterlyVal = 1;
  const E = {};                 // cached DOM refs
  const L = Object.create(null); // last displayed values (diff cache)
  const toggles = [];
  let pips = [], pipOrder = [], pipLit = [], pipsPrimed = false;
  const hints = []; let hintT = 0, hintState = 0;             // 0 idle, 1 showing, 2 gap
  const banners = []; let bannerT = 0, bannerState = 0, bannerLit = false, bannerAge = 0;
  let flash = 0, ironsT = 0, navCueT = 0, navWindSampleT = 0, navWindCooldown = 0;
  let lastPointOfSail = '', navWindReference = null;
  let fadeMsgT = 0, fadeMsgOn = false;
  let endActive = false, endT = 0, endShown = false;
  let demo = null, demoWorld = null;
  const stick = { id: null, ox: 0, oy: 0 }; let kindleId = null;
  const chart = { open: false, N: 256, ext: 1400, grid: null, base: null, stat: null, size: 0, dirty: true, cv: null, ctx: null, col: null,
    rockEditing: false, rockPlacement: false, rockEditRocks: null, rockOriginalRocks: null, rockBaseline: '', rockDirty: false,
    rockSelected: -1, rockDrag: -1, rockPointerId: null, rockDragOrigin: null, rockStatus: '', rockTools: null, rockControls: null,
    rockEditButton: null, rockAddButton: null, rockDeleteButton: null, rockSaveButton: null, rockCancelButton: null,
    rockRadius: null, rockRadiusOut: null, rockHeight: null, rockHeightOut: null, rockStatusNode: null, rockCountNode: null };

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const world = () => demoWorld || TW.world || null;
  const game = () => TW.game || null;
  const call = (name) => { const g = game(); if (g && typeof g[name] === 'function') { try { g[name](); } catch (e) { console.error('[TW] ui: game.' + name + ' threw', e); } } };
  const touchObj = () => { const g = game(); if (!g) return null; if (!g.touch || typeof g.touch !== 'object') g.touch = { steer: 0, trim: 0, kindle: false }; return g.touch; };
  const audioStart = () => { try { if (TW.audio && TW.audio.start) TW.audio.start(); } catch (e) { /* audio is optional */ } };
  const click = () => TW.emit('ui:click');
  function setTxt(key, node, str) { if (L[key] !== str) { L[key] = str; node.textContent = str; } }
  function setCls(key, node, cls, on) { on = !!on; if (L[key] !== on) { L[key] = on; node.classList.toggle(cls, on); } }
  function showNavCue(text, type) {
    if (!E.navCue || !text) return;
    E.navCue.textContent = text;
    E.navCue.classList.toggle('twui-navcue--alert', type === 'alert');
    E.navCue.classList.add('twui-on');
    navCueT = 2.8;
  }
  function button(cls, html, label, fn) {
    const b = el('button', cls, html); b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', (ev) => { ev.preventDefault(); click(); fn(ev); if (ev.detail > 0 && document.activeElement === b) b.blur(); });
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return b;
  }
  const focusGame = () => { blurActive(); try { if (TW.canvas && TW.canvas.focus) TW.canvas.focus({ preventScroll: true }); } catch (e) { /* ignore */ } };
  const blurActive = () => { const a = document.activeElement; if (a && root && root.contains(a) && a.blur) a.blur(); };
  function sponsorMount(id, parent, cls) {
    if (!TW.sponsors || !parent) return null;
    const node = TW.sponsors.mount(id, parent, cls);
    if (node) TW.sponsors.setConnected(id, true);
    return node;
  }

  // ---------------------------------------------------------------------------
  // Sound / painterly toggles (shared between title and pause)
  // ---------------------------------------------------------------------------
  function setMuted(m) {
    muted = !!m;
    try { if (TW.audio && TW.audio.setMuted) TW.audio.setMuted(muted); } catch (e) { /* ignore */ }
    try { localStorage.setItem('tidewright.muted', muted ? '1' : '0'); } catch (e) { /* storage may be unavailable */ }
    syncToggles();
  }
  const postParams = () => (TW.post && TW.post.params) || null;
  function setPainterly(on) {
    painterlyOn = !!on;
    const p = postParams(); if (p) p.painterly = painterlyOn ? painterlyVal : 0;
    syncToggles();
  }
  function makeToggle(label, get, set) {
    const b = button('twui-tog', '<i class="twui-tog-mark"></i><span class="twui-tog-lab">' + label + '</span><span class="twui-tog-val"></span>', null, () => set(!get()));
    toggles.push({ b, get, val: b.lastChild });
    return b;
  }
  function syncToggles() {
    for (let i = 0; i < toggles.length; i++) { const t = toggles[i], on = !!t.get(); t.b.setAttribute('aria-pressed', on ? 'true' : 'false'); t.val.textContent = on ? 'Aktivé' : 'Désaktivé'; }
    if (E.muteBtn) { E.muteBtn.classList.toggle('twui-muted', muted); E.muteBtn.setAttribute('aria-label', muted ? 'Son koupé — limé son-la' : 'Son-la limé — koupé son-la'); }
  }
  function toggleRow() {
    const r = el('div', 'twui-toggles');
    r.appendChild(makeToggle('Son', () => !muted, (on) => setMuted(!on)));
    const p = postParams();
    if (demo || (p && 'painterly' in p)) r.appendChild(makeToggle('Efè penti', () => painterlyOn, setPainterly));
    return r;
  }
  function legendHTML(touch) {
    const k = (s) => '<kbd class="twui-key">' + s + '</kbd>';
    if (touch) return '<span class="twui-lg"><b>Gwo pous a goch</b> — viré bar-la pou dirijé, pousé anlè pou ouvè plis vwal</span><span class="twui-lg"><b>Gwo pous a dwèt</b> — kenbé « Limé » adan sèk boué-yo</span><span class="twui-lg"><b>Glisé dwèt-la asi lanmè-la</b> pou gadé alantou</span>';
    return '<span class="twui-lg">' + k('A') + k('D') + ' dirijé</span><span class="twui-lg">' + k('W') + k('S') + ' ajisté vwal</span><span class="twui-lg">' + k('Space') + ' limé flanm</span><span class="twui-lg">' + k('C') + ' kat maren</span><span class="twui-lg">' + k('M') + ' koupé son</span><span class="twui-lg">' + k('Esc') + ' poz</span>';
  }
  function setTouchMode(on) {
    on = !!on;
    if (on === touchMode && L.touchInit) return;
    touchMode = on; L.touchInit = true;
    root.classList.toggle('twui-touch', on);
    const html = legendHTML(on);
    if (E.legendTitle) { E.legendTitle.innerHTML = html; E.legendTitle.classList.toggle('twui-legend--touch', on); }
    if (E.legendPause) { E.legendPause.innerHTML = html; E.legendPause.classList.toggle('twui-legend--touch', on); }
    L.kindleTxt = undefined;
    if (!on) resetTouch();
    else if (E.stickRest && stick.id === null && (lastPhase === 'sailing' || lastPhase === 'free')) E.stickRest();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function doStart() {
    if (lastPhase !== 'title') return;
    audioStart();
    if (demo) demo.phase = 'sailing';
    call('start');
    focusGame();
  }
  function doPause() { if (demo) demo.phase = 'paused'; call('pause'); }
  function doResume() { if (demo) demo.phase = demo.prev || 'sailing'; call('resume'); focusGame(); }
  function doRestart() {
    if (demo) { demo.phase = 'sailing'; resetRun(); }
    call('restart'); focusGame();
  }
  function doSailOn() { if (demo) demo.phase = 'free'; call('sailOn'); focusGame(); }
  function toggleChart(force) {
    const playing = lastPhase === 'sailing' || lastPhase === 'free';
    const want = force === undefined ? !chart.open : !!force;
    if (want && !playing) return;
    if (want === chart.open) return;
    chart.open = want;
    E.chart.classList.toggle('twui-on', want);
    root.classList.toggle('twui-quiet', want || lastPhase === 'paused');
    E.chartBtn.classList.toggle('twui-active', want);
    E.chartBtn.setAttribute('aria-pressed', want ? 'true' : 'false');
    if (want) chart.dirty = true; else blurActive();
  }
  function resetRun() {
    hints.length = 0; hintT = 0; hintState = 0; E.hint.classList.remove('twui-on');
    banners.length = 0; bannerT = 0; bannerState = 0; E.banner.classList.remove('twui-on'); root.classList.remove('twui-bannering');
    endActive = false; endT = 0; endShown = false; E.end.classList.remove('twui-on'); E.hud.classList.remove('twui-leaving');
    fadeMsgOn = false; fadeMsgT = 0; E.fadeTxt.classList.remove('twui-on');
    flash = 0; pipsPrimed = false;
    toggleChart(false);
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  function buildTitle() {
    const t = el('div', 'twui-title twui-off');
    const inn = el('div', 'twui-title-in');
    const wm = el('h1', 'twui-wm');
    wm.setAttribute('aria-label', 'TradiTour 2027');
    wm.innerHTML = '<span>TRADITOUR</span><small>2027</small>';
    const wrap = el('div', 'twui-wmwrap');
    wrap.appendChild(wm);
    wrap.appendChild(el('div', 'twui-swash', '<svg viewBox="0 0 600 24" preserveAspectRatio="none" width="100%" height="100%" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path pathLength="1" d="M3 13C34 4 62 21 104 12s78-9 124 0 96 11 150 1 104-9 158-2c22 3 44 3 50-4 4-6-5-9-9-4-4 6 6 13 17 8"/></svg>'));
    inn.appendChild(wrap);
    inn.appendChild(el('p', 'twui-premise', '<span>KOURI A VWAL AN KARAYIB-LA</span>'));
    const row = el('div', 'twui-title-row');
    E.startBtn = button('twui-btn twui-btn--pri', IC.sail + 'ANNOU NAVIGÉ', null, doStart);
    row.appendChild(E.startBtn);
    E.raceBtn = button('twui-btn', IC.flag + 'CHAMPIONNAT · E1', null, () => { if (TW.regatta) TW.regatta.open('E1'); });
    row.appendChild(E.raceBtn);
    row.appendChild(toggleRow());
    inn.appendChild(row);
    const sponsorRow = el('div', 'twui-sponsor-row');
    sponsorMount('ui_title', sponsorRow, 'twui-sponsor-title');
    sponsorMount('ui_championship', sponsorRow, 'twui-sponsor-championship');
    inn.appendChild(sponsorRow);
    E.legendTitle = el('div', 'twui-legend');
    inn.appendChild(E.legendTitle);
    inn.appendChild(el('div', 'twui-rotate', IC.turn + '<span>Viré ekran-la pou vwè plis lanmè</span>'));
    t.appendChild(inn);
    E.title = t;
    return t;
  }

  function ringSVG() {
    return '<svg class="twui-ring" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle class="twui-ring-bg" cx="24" cy="24" r="20.5"/><circle class="twui-ring-fg" cx="24" cy="24" r="20.5" stroke-linecap="round" stroke-dasharray="128.81" stroke-dashoffset="128.81"/><path class="twui-ring-fl" transform="translate(13.2 12.4) scale(.9)" stroke-linejoin="round" d="' + FLAME_D + '"/></svg>';
  }

  function buildHud() {
    const hud = el('div', 'twui-hud');
    // compass ribbon ---------------------------------------------------------
    const comp = el('div', 'twui-compass');
    const tape = el('div', 'twui-tape');
    const strip = el('div', 'twui-strip');
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    let h = '';
    for (let d = 0; d < 720; d += 15) {
      const pc = (d / 7.2).toFixed(3), major = d % 45 === 0;
      h += '<i class="twui-tk' + (major ? ' twui-tk--m' : '') + '" style="left:' + pc + '%"></i>';
      if (major) { const n = names[(d % 360) / 45]; h += '<span class="twui-tl' + (n.length === 1 ? ' twui-tl--c' : '') + (n === 'N' ? ' twui-tl--n' : '') + '" style="left:' + pc + '%">' + n + '</span>'; }
    }
    strip.innerHTML = h;
    tape.appendChild(strip); comp.appendChild(tape);
    const lane = el('div', 'twui-lane');
    lane.appendChild(el('i', 'twui-lub'));
    E.mkWind = el('div', 'twui-mk twui-mk--wind', svg('<path d="M12 21V6.5"/><path d="M7.6 16.6L12 21l4.4-4.4"/><path d="M12 10.4l-3.6-3.6M12 6.9L8.4 3.3M12 10.4l3.6-3.6M12 6.9l3.6-3.6" stroke-width="1.1"/>'));
    E.mkTgt = el('div', 'twui-mk twui-mk--tgt', IC.flame);
    lane.appendChild(E.mkWind); lane.appendChild(E.mkTgt);
    comp.appendChild(lane);
    E.tgt = el('div', 'twui-tgt', '<span class="twui-tgt-n"></span><i>·</i><span class="twui-tgt-d"></span>');
    E.tgtN = E.tgt.firstChild; E.tgtD = E.tgt.lastChild;
    comp.appendChild(E.tgt);
    E.irons = el('div', 'twui-ironstip', 'Twò pre van-la — viré lwen van-la');
    comp.appendChild(E.irons);
    E.sailRead = el('div', 'twui-sailread', 'ALLURE · —');
    E.navCue = el('div', 'twui-navcue'); E.navCue.setAttribute('role', 'status'); E.navCue.setAttribute('aria-live', 'polite');
    comp.append(E.sailRead, E.navCue);
    E.strip = strip; E.compass = comp;
    const top = el('div', 'twui-top');
    hud.appendChild(top);
    // beacons ----------------------------------------------------------------
    const bc = el('div', 'twui-beacons');
    E.pips = el('div', 'twui-pips'); E.pips.setAttribute('role', 'img');
    E.obj = el('div', 'twui-obj');
    bc.appendChild(E.pips); bc.appendChild(E.obj);
    E.beacons = bc;
    E.raceBoard = el('div', 'twui-raceboard');
    E.raceBoard.innerHTML = '<div class="twui-racehead"><span>Classement</span><span class="twui-raceclock">00:00</span></div><div class="twui-raceprogress"><span class="twui-raceprogress-label">Prochaine porte</span><strong class="twui-raceprogress-value">—</strong><span class="twui-racetrack"><i></i></span></div><div class="twui-racerows"></div><div class="twui-racenotice" aria-live="polite"></div>';
    E.raceClock = E.raceBoard.querySelector('.twui-raceclock'); E.raceRows = E.raceBoard.querySelector('.twui-racerows');
    E.raceProgress = E.raceBoard.querySelector('.twui-raceprogress-value'); E.raceProgressBar = E.raceBoard.querySelector('.twui-racetrack i'); E.raceNotice = E.raceBoard.querySelector('.twui-racenotice');
    sponsorMount('ui_race_panel', E.raceBoard.querySelector('.twui-racehead'), 'twui-sponsor-racepanel');
    const leaderboardSponsor = sponsorMount('ui_leaderboard', E.raceBoard, 'twui-sponsor-leaderboard');
    if (leaderboardSponsor) E.raceBoard.insertBefore(leaderboardSponsor, E.raceNotice);
    bc.appendChild(E.raceBoard);
    top.appendChild(bc); top.appendChild(comp);
    // corner buttons ---------------------------------------------------------
    const corner = el('div', 'twui-corner');
    E.chartBtn = button('twui-ib', IC.chart, 'Kat maren', () => toggleChart());
    E.chartBtn.setAttribute('aria-pressed', 'false');
    E.raceEditBtn = button('twui-ib', IC.flag, 'Placer les bouées de régate', () => { if (TW.regatta && TW.regatta.editor) TW.regatta.editor.toggle('E1'); });
    E.muteBtn = button('twui-ib', IC.bell, 'Son', () => setMuted(!muted));
    E.pauseBtn = button('twui-ib', IC.pause, 'Poz', doPause);
    E.regattaBtn = button('twui-ib', IC.flag, 'Régate', () => { if (TW.regatta) TW.regatta.toggle(); });
    E.settingsBtn = button('twui-ib', IC.settings, 'Paramèt', () => { if (TW.admin && TW.admin.toggle) TW.admin.toggle(true); });
    corner.appendChild(E.chartBtn); corner.appendChild(E.raceEditBtn); corner.appendChild(E.muteBtn); corner.appendChild(E.pauseBtn); corner.appendChild(E.regattaBtn); corner.appendChild(E.settingsBtn);
    top.appendChild(corner);
    sponsorMount('ui_hud', hud, 'twui-sponsor-hud');
    // gauges -----------------------------------------------------------------
    const g = el('div', 'twui-gauges');
    E.gOil = el('div', 'twui-g', '<div class="twui-g-fig"><svg class="twui-lantern" viewBox="0 0 20 30" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect class="twui-oil" x="4.6" y="10.6" width="10.8" height="15.9"/><path class="twui-lflame" d="M10 12.4c.7 2.4 2.7 3.5 2.7 6.1a2.7 2.7 0 0 1-5.4 0c0-1.5.8-2.3 1.4-3.1.2.9.6 1.4 1 1.6-.2-1.5-.1-3.2.3-4.6z"/>' +
      '<path d="M6.6 5.6a3.4 3.4 0 0 1 6.8 0"/><path d="M5.4 7.4h9.2l1.2 2.8H4.2z"/><path d="M4.2 10.2v16.4h11.6V10.2"/><path d="M2.8 28.6h14.4l-1.4-2H4.2z"/></svg></div><span class="twui-g-lab">Lwil</span>');
    E.oilRect = E.gOil.querySelector('.twui-oil'); E.oilFlame = E.gOil.querySelector('.twui-lflame');
    E.gHull = el('div', 'twui-g', '<div class="twui-g-fig"><svg class="twui-hull" viewBox="0 0 44 20" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2 5.4c5 1.2 12 1.8 20 1.8s15-.6 20-1.8c-1.2 6.2-4.6 10.6-9.4 12.2H11.4C6.6 16 3.2 11.600 2 5.400z"/><path d="M6.4 10.800c5 .8 10 1.200 15.600 1.200s10.600-.4 15.600-1.200" opacity=".55"/><path d="M22 7.200v10.400" opacity=".55"/></svg><div class="twui-bar"><i></i></div></div><span class="twui-g-lab">Kò bato</span>');
    E.hullBar = E.gHull.querySelector('.twui-bar i');
    E.gSpd = el('div', 'twui-g', '<div class="twui-g-fig"><span class="twui-spd">0.0</span></div><span class="twui-g-lab">kt</span>');
    E.spd = E.gSpd.querySelector('.twui-spd');
    const sailShape = '<path d="M10 2v20.500"/><path d="M10 3.400c5.600 3.600 8.800 9.400 9.400 16.600H10z"/><path d="M8.200 7.400C5.200 11 3.400 15.200 3 20h5.200z"/>';
    E.gSail = el('div', 'twui-g', '<div class="twui-g-fig"><div class="twui-sailg">' + svg(sailShape, 'twui-sailfill', '0 0 22 26') + svg(sailShape + '<path d="M1.600 24h19"/>', 'twui-sailline', '0 0 22 26') + '</div></div><span class="twui-g-lab">Vwal</span>');
    E.sailFill = E.gSail.querySelector('.twui-sailfill');
    // La réserve d’huile reste active; seule sa jauge HUD est masquée pour la version Traditour.
    g.appendChild(E.gHull); g.appendChild(E.gSpd); g.appendChild(E.gSail);
    E.gauges = g;
    top.appendChild(g);
    // kindling prompt --------------------------------------------------------
    E.kindle = el('div', 'twui-kindle', ringSVG() + '<div class="twui-kindle-txt"></div>');
    E.kindleFg = E.kindle.querySelector('.twui-ring-fg'); E.kindleTxt = E.kindle.lastChild;
    const bottom = el('div', 'twui-bottom');
    hud.appendChild(bottom);
    bottom.appendChild(E.kindle);
    E.hint = el('div', 'twui-hint'); E.hint.setAttribute('role', 'status');
    bottom.appendChild(E.hint);
    E.banner = el('div', 'twui-banner', '<div class="twui-banner-name"></div><div class="twui-rule">' + IC.flame + '</div><div class="twui-banner-sub"></div>');
    E.bannerName = E.banner.firstChild; E.bannerSub = E.banner.lastChild;
    E.hud = hud;
    return hud;
  }

  function buildTouch(frag) {
    const zone = el('div', 'twui-stickzone');
    let ticks = '';
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, r0 = i % 6 === 0 ? 50 : 54, x0 = 62 + Math.sin(a) * r0, y0 = 62 - Math.cos(a) * r0, x1 = 62 + Math.sin(a) * 58, y1 = 62 - Math.cos(a) * 58; ticks += 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + 'L' + x1.toFixed(1) + ' ' + y1.toFixed(1); }
    E.stick = el('div', 'twui-stick', '<svg viewBox="0 0 124 124" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true"><path d="' + ticks + '" opacity=".8"/><path d="M62 20l-4 6h8zM62 104l-4-6h8z" fill="currentColor" stroke="none" opacity=".7"/><path d="M22 62l6-4v8zM102 62l-6-4v8z" fill="currentColor" stroke="none" opacity=".7"/></svg><i class="twui-knob"></i>');
    E.knob = E.stick.lastChild;
    zone.appendChild(E.stick);
    E.zone = zone;
    frag.appendChild(zone);
    E.kbtn = el('button', 'twui-kbtn', ringSVG() + '<span class="twui-kbtn-in">' + IC.flame + 'Limé</span>');
    E.kbtn.type = 'button'; E.kbtn.setAttribute('aria-label', 'Kenbé pou limé flanm-la');
    E.kbtnFg = E.kbtn.querySelector('.twui-ring-fg');
    frag.appendChild(E.kbtn);

    const R = 46;
    const place = () => { E.stick.style.transform = 'translate(' + stick.ox.toFixed(0) + 'px,' + stick.oy.toFixed(0) + 'px)'; };
    const rest = () => { const r = zone.getBoundingClientRect(); stick.ox = Math.min(Math.max(96, r.width * 0.42), r.width - 70); stick.oy = Math.max(70, r.height - 104); place(); };
    E.stickRest = rest;
    zone.addEventListener('pointerdown', (ev) => {
      if (stick.id !== null || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      stick.id = ev.pointerId;
      try { zone.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      const r = zone.getBoundingClientRect();
      stick.ox = TW.clamp(ev.clientX - r.left, 66, Math.max(66, r.width - 20));
      stick.oy = TW.clamp(ev.clientY - r.top, 20, Math.max(20, r.height - 66));
      stick.cx = r.left + stick.ox; stick.cy = r.top + stick.oy;
      place(); E.knob.style.transform = 'translate(0px,0px)';
      E.stick.classList.add('twui-held');
    });
    zone.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== stick.id) return;
      ev.preventDefault();
      let dx = ev.clientX - stick.cx, dy = ev.clientY - stick.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      E.knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      const nx = dx / R, ny = -dy / R, t = touchObj();
      if (t) {
        t.steer = Math.abs(nx) < 0.14 ? 0 : Math.sign(nx) * (Math.abs(nx) - 0.14) / 0.86;
        t.trim = Math.abs(ny) < 0.34 ? 0 : Math.sign(ny) * (Math.abs(ny) - 0.34) / 0.66;
      }
    });
    const release = (ev) => {
      if (ev.pointerId !== stick.id) return;
      stick.id = null;
      const t = touchObj(); if (t) { t.steer = 0; t.trim = 0; }
      E.knob.style.transform = 'translate(0px,0px)';
      E.stick.classList.remove('twui-held');
      rest();
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', release);
    zone.addEventListener('contextmenu', (ev) => ev.preventDefault());

    E.kbtn.addEventListener('pointerdown', (ev) => {
      if (kindleId !== null) return;
      ev.preventDefault();
      kindleId = ev.pointerId;
      try { E.kbtn.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      const t = touchObj(); if (t) t.kindle = true;
      E.kbtn.classList.add('twui-held');
      click();
    });
    const kRelease = (ev) => {
      if (ev.pointerId !== kindleId) return;
      kindleId = null;
      const t = touchObj(); if (t) t.kindle = false;
      E.kbtn.classList.remove('twui-held');
    };
    E.kbtn.addEventListener('pointerup', kRelease);
    E.kbtn.addEventListener('pointercancel', kRelease);
    E.kbtn.addEventListener('lostpointercapture', kRelease);
    E.kbtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
    E.kbtn.addEventListener('keydown', (ev) => { if (ev.code === 'Space' || ev.code === 'Enter') { const t = touchObj(); if (t) t.kindle = true; } });
    E.kbtn.addEventListener('keyup', () => { const t = touchObj(); if (t && kindleId === null) t.kindle = false; });
    E.kbtn.addEventListener('blur', () => { const t = touchObj(); if (t && kindleId === null) t.kindle = false; });
  }
  function resetTouch() {
    stick.id = null; kindleId = null;
    const g = game(), t = g && g.touch;
    if (t) { t.steer = 0; t.trim = 0; t.kindle = false; }
    if (E.knob) { E.knob.style.transform = 'translate(0px,0px)'; E.stick.classList.remove('twui-held'); E.kbtn.classList.remove('twui-held'); }
  }

  function buildPause() {
    const p = el('div', 'twui-pause');
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Poz');
    const main = el('div', 'twui-col twui-pause-main', IC.pause + '<h2 class="twui-h">PAUSE</h2><p class="twui-sub">La course est momentanément suspendue.</p>');
    const stack = el('div', 'twui-stack');
    E.resumeBtn = button('twui-btn twui-btn--pri', 'REPRENDRE LA COURSE', null, doResume);
    stack.appendChild(E.resumeBtn);
    stack.appendChild(button('twui-btn', 'RECOMMENCER', null, () => { p.classList.add('twui-confirming'); try { E.keepBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }));
    main.appendChild(stack);
    main.appendChild(toggleRow());
    E.legendPause = el('div', 'twui-legend');
    main.appendChild(E.legendPause);
    sponsorMount('ui_pause', main, 'twui-sponsor-pause');
    const conf = el('div', 'twui-col twui-pause-confirm', IC.pause + '<h2 class="twui-h">RECOMMENCER ?</h2><p class="twui-sub">La course actuelle sera réinitialisée.</p>');
    const pair = el('div', 'twui-pair');
    E.keepBtn = button('twui-btn twui-btn--pri', 'ANNULER', null, () => { p.classList.remove('twui-confirming'); try { E.resumeBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } });
    pair.appendChild(E.keepBtn);
    pair.appendChild(button('twui-btn', 'RECOMMENCER', null, () => { p.classList.remove('twui-confirming'); doRestart(); }));
    conf.appendChild(pair);
    p.appendChild(main); p.appendChild(conf);
    E.pause = p;
    return p;
  }

  function buildEnding() {
    const e = el('div', 'twui-end');
    const col = el('div', 'twui-col', '<h2 class="twui-h">VOYAGE TERMINÉ</h2><div class="twui-rule">' + IC.flag + '</div>' +
      '<p class="twui-sub"><span>Navigation terminée. Consultez vos performances et reprenez la mer.</span></p>' +
      '<div class="twui-stats">' +
      '<div class="twui-stat"><b data-s="time">–</b><span>TEMPS</span></div>' +
      '<div class="twui-stat"><b data-s="floats">–</b><span>MARQUES</span></div>' +
      '<div class="twui-stat"><b data-s="knocks">–</b><span>CHOCS</span></div>' +
      '<div class="twui-stat"><b data-s="respawns">–</b><span>REPRISES</span></div></div>');
    const pair = el('div', 'twui-pair');
    E.sailOnBtn = button('twui-btn twui-btn--pri', IC.sail + 'CONTINUER', null, doSailOn);
    pair.appendChild(E.sailOnBtn);
    pair.appendChild(button('twui-btn', 'REJOUER', null, doRestart));
    col.appendChild(pair);
    e.appendChild(col);
    E.end = e; E.endStats = col.querySelector('.twui-stats');
    return e;
  }
  function fillStats() {
    const s = (game() && game().stats) || null;
    const set = (k, html, ok) => { const n = E.endStats.querySelector('[data-s="' + k + '"]'); if (!n) return; n.parentNode.classList.toggle('twui-hide', !ok); if (ok) n.innerHTML = html; };
    const t = s && isNum(s.time) ? Math.max(0, Math.round(s.time)) : -1;
    set('time', t >= 0 ? Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2) : '', t >= 0);
    const fOk = !!s && isNum(s.floats);
    set('floats', fOk ? (s.floats | 0) + (isNum(s.floatsTotal) ? '<small>/</small>' + (s.floatsTotal | 0) : '') : '', fOk);
    set('knocks', s && isNum(s.knocks) ? String(s.knocks | 0) : '', !!s && isNum(s.knocks));
    set('respawns', s && isNum(s.respawns) ? String(s.respawns | 0) : '', !!s && isNum(s.respawns));
    E.endStats.classList.toggle('twui-hide', !s);
  }

  // ---------------------------------------------------------------------------
  // Sea chart (2D canvas; static layer built once, dynamic layer each frame while open)
  // ---------------------------------------------------------------------------
  function token(name, fb) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { /* ignore */ }
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return fb;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
  function chartColours() {
    const ink = token('--tt-ink', token('--tw-ink', [7, 23, 37])), foam = token('--tt-white', token('--tw-foam', [242, 247, 248])),
      cyan = token('--tt-cyan', token('--tw-ember', [32, 216, 208])), blue = token('--tt-blue', token('--tw-ember-deep', [37, 139, 255])),
      muted = token('--tt-muted', token('--tw-mist', [155, 183, 200]));
    chart.col = { ink, foam, ember: cyan, deep: blue, verd: [74, 205, 177], muted,
      vellum: [3, 15, 29], land: [76, 139, 91], sea: [5, 42, 72], line: [86, 176, 198],
      shallow: [24, 130, 160], coast: [190, 232, 226], grid: [160, 210, 224], label: [235, 247, 250] };
  }
  function buildChart() {
    const c = el('div', 'twui-chart');
    c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Kat maren pou achipèl Gwadloup');
    chart.cv = document.createElement('canvas');
    c.appendChild(chart.cv);
    sponsorMount('ui_chart', c, 'twui-sponsor-chart');
    chart.rockTools = el('div', 'twui-rock-tools');
    const toolHead = el('div', 'twui-rock-tool-row');
    chart.rockEditButton = button('twui-rock-tool-btn', 'Chanjé wòch', 'Ouvè zouti pou wòch', toggleRockEditor);
    toolHead.appendChild(chart.rockEditButton);
    chart.rockControls = el('div', 'twui-rock-controls'); chart.rockControls.hidden = true;
    const toolActions = el('div', 'twui-rock-tool-row');
    chart.rockAddButton = button('twui-rock-tool-btn', 'Ajouté on wòch', 'Ajouté on nouvo wòch', toggleRockPlacement);
    chart.rockDeleteButton = button('twui-rock-tool-btn', 'Efasé wòch-la', 'Efasé wòch chwazi a', deleteSelectedRock); chart.rockDeleteButton.disabled = true;
    chart.rockSaveButton = button('twui-rock-tool-btn', 'Sové é woukoumansé', 'Sové sé chanjman-la é woukoumansé jwèt-la', saveRockEdits); chart.rockSaveButton.disabled = true;
    chart.rockCancelButton = button('twui-rock-tool-btn', 'Anilé', 'Anilé sé chanjman-la', cancelRockEdits);
    toolActions.append(chart.rockAddButton, chart.rockDeleteButton, chart.rockSaveButton, chart.rockCancelButton);
    const toolRanges = el('div', 'twui-rock-tool-row');
    const makeRockRange = (name, min, max, step) => {
      const label = el('label', 'twui-rock-range'); label.appendChild(el('span', '', name));
      const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.disabled = true;
      const output = el('output', '', '—'); label.append(input, output); toolRanges.appendChild(label); return { input, output };
    };
    const radius = makeRockRange('Gwosè', 3, 20, 0.5); chart.rockRadius = radius.input; chart.rockRadiusOut = radius.output;
    const height = makeRockRange('Wotè', 4, 40, 1); chart.rockHeight = height.input; chart.rockHeightOut = height.output;
    chart.rockRadius.addEventListener('input', setSelectedRockRadius);
    chart.rockHeight.addEventListener('input', setSelectedRockHeight);
    chart.rockStatusNode = el('div', 'twui-rock-status', 'Pétèt chwazi on wòch.');
    chart.rockCountNode = el('div', 'twui-rock-hint', 'Pilyé pon natirèl-la ka rété anplas.');
    chart.rockControls.append(toolActions, toolRanges, chart.rockStatusNode, chart.rockCountNode,
      el('div', 'twui-rock-hint', 'Tiré on wòch pou déplasé’y. Chwazi « Ajouté », apré kliké asi lanmè-la. Sové ké woukoumansé jwèt-la.'));
    chart.rockTools.append(toolHead, chart.rockControls); c.appendChild(chart.rockTools);
    chart.cv.addEventListener('pointerdown', rockPointerDown);
    chart.cv.addEventListener('pointermove', rockPointerMove);
    chart.cv.addEventListener('pointerup', rockPointerUp);
    chart.cv.addEventListener('pointercancel', rockPointerUp);
    c.appendChild(button('twui-ib twui-chart-x', IC.close, 'Fèmé kat-la', () => toggleChart(false)));
    c.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    E.chart = c;
    TW.chartView = chart;
    return c;
  }
  function chartSample() {
    const W = world(), N = chart.N, ext = chart.ext, g = new Float32Array(N * N), C = chart.col;
    const hf = W && typeof W.heightAt === 'function' ? W.heightAt : null;
    for (let j = 0, k = 0; j < N; j++) {
      const z = (j / (N - 1) * 2 - 1) * ext;
      for (let i = 0; i < N; i++, k++) { let hh = -60; if (hf) { hh = +hf.call(W, (i / (N - 1) * 2 - 1) * ext, z); if (hh !== hh) hh = -60; } g[k] = hh; }
    }
    chart.grid = g;
    // Relief colorimétrique V11 : altitude et bathymétrie restent liées à la grille 3D.
    const b = document.createElement('canvas'); b.width = b.height = N;
    const bx = b.getContext('2d'), img = bx.createImageData(N, N), d = img.data;
    for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) {
      const hh = g[k], n = TW.fbm2(i * 0.025, j * 0.025, 5, 77), n2 = TW.noise2(i * 0.19, j * 0.19, 5);
      const rx = i / (N - 1) * 2 - 1, ry = j / (N - 1) * 2 - 1, edge = 1 - 0.12 * TW.smoothstep(0.78, 1.48, Math.hypot(rx, ry));
      const shade = (0.88 + 0.17 * n + 0.045 * n2) * edge;
      let r, gg, bb;
      if (hh > 0.2) {
        const elevation = TW.saturate((hh - 1) / 95), texture = 0.84 + n * 0.22 + n2 * 0.08;
        const low = [55, 124, 79], high = [153, 164, 111];
        r = low[0] + (high[0] - low[0]) * elevation; gg = low[1] + (high[1] - low[1]) * elevation; bb = low[2] + (high[2] - low[2]) * elevation;
        const left = g[j * N + Math.max(0, i - 1)], right = g[j * N + Math.min(N - 1, i + 1)];
        const up = g[Math.max(0, j - 1) * N + i], down = g[Math.min(N - 1, j + 1) * N + i];
        const slope = Math.min(1, Math.hypot(right - left, down - up) / 58), relief = texture * (0.88 + slope * 0.18);
        r *= relief; gg *= relief; bb *= relief;
      } else {
        const dp = -hh, shallow = dp < 4 ? 0.88 : dp < 12 ? 0.66 : dp < 28 ? 0.42 : dp < 65 ? 0.23 : 0.08;
        const deep = [3, 30, 58], shelf = [17, 111, 151];
        r = deep[0] + (shelf[0] - deep[0]) * shallow; gg = deep[1] + (shelf[1] - deep[1]) * shallow; bb = deep[2] + (shelf[2] - deep[2]) * shallow;
        const texture = 0.91 + n * 0.12 + n2 * 0.045; r *= texture; gg *= texture; bb *= texture;
      }
      d[k * 4] = Math.max(0, Math.min(255, r * shade)); d[k * 4 + 1] = Math.max(0, Math.min(255, gg * shade)); d[k * 4 + 2] = Math.max(0, Math.min(255, bb * shade)); d[k * 4 + 3] = 255;
    }
    bx.putImageData(img, 0, 0);
    chart.base = b;
  }
  function isoPath(ctx, level, m, w) {
    const N = chart.N, g = chart.grid, s = w / (N - 1);
    ctx.beginPath();
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const k = j * N + i, a = g[k] - level, b = g[k + 1] - level, c = g[k + N + 1] - level, d = g[k + N] - level;
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const tx = m + (i + a / (a - b)) * s, ty = m + j * s, rx = m + (i + 1) * s, ry = m + (j + b / (b - c)) * s,
        bx = m + (i + d / (d - c)) * s, by = m + (j + 1) * s, lx = m + i * s, ly = m + (j + a / (a - d)) * s;
      switch (code) {
        case 1: case 14: ctx.moveTo(lx, ly); ctx.lineTo(tx, ty); break;
        case 2: case 13: ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); break;
        case 3: case 12: ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); break;
        case 4: case 11: ctx.moveTo(rx, ry); ctx.lineTo(bx, by); break;
        case 6: case 9: ctx.moveTo(tx, ty); ctx.lineTo(bx, by); break;
        case 7: case 8: ctx.moveTo(lx, ly); ctx.lineTo(bx, by); break;
        case 5: ctx.moveTo(lx, ly); ctx.lineTo(tx, ty); ctx.moveTo(rx, ry); ctx.lineTo(bx, by); break;
        default: ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); ctx.moveTo(lx, ly); ctx.lineTo(bx, by);
      }
    }
  }
  function chartFont(ctx, px, style, track) {
    ctx.font = (style || '') + ' ' + px.toFixed(1) + 'px ' + FONT;
    if ('letterSpacing' in ctx) { try { ctx.letterSpacing = (track ? (px * track).toFixed(1) : '0') + 'px'; } catch (e) { /* ignore */ } }
  }
  function haloText(ctx, str, x, y, C, alpha) {
    ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(3,16,29,0.92)'; ctx.lineWidth = Math.max(2.8, chart.size / 185);
    ctx.strokeText(str, x, y); ctx.fillStyle = rgba(C.label || C.foam || C.ink, alpha === undefined ? 0.94 : alpha); ctx.fillText(str, x, y);
  }
  function chartStatic() {
    const S = chart.size, C = chart.col, W = world();
    if (!chart.grid) chartSample();
    const st = chart.stat || (chart.stat = document.createElement('canvas'));
    st.width = st.height = S;
    const ctx = st.getContext('2d'), u = S / 100, m = Math.round(2.4 * u), w = S - 2 * m, ext = chart.ext, N = chart.N;
    const X = (x) => m + (x + ext) / (2 * ext) * w;
    chart.m = m; chart.w = w; chart.u = u;
    ctx.fillStyle = rgba(mix(C.vellum, C.ink, 0.1)); ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(chart.base, m, m, w, w);
    ctx.save(); ctx.beginPath(); ctx.rect(m, m, w, w); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const coastIsles = (W && W._isles || []).filter((I) => I && Array.isArray(I.coast) && I.coast.length >= 3);
    if (coastIsles.length) {
      coastIsles.forEach((I) => { ctx.beginPath(); I.coast.forEach((pt, idx) => { const px = X(pt[0]), py = X(pt[1]); idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); ctx.fillStyle = 'rgba(73,132,91,0.88)'; ctx.fill(); });
      const topoLevels = [12, 25, 50, 80, 120, 180];
      topoLevels.forEach((level, idx) => { ctx.strokeStyle = idx % 2 === 0 ? 'rgba(225,238,190,0.24)' : 'rgba(225,238,190,0.15)'; ctx.lineWidth = Math.max(0.55, u * (idx % 2 === 0 ? 0.105 : 0.075)); isoPath(ctx, level, m, w); ctx.stroke(); });
      ctx.strokeStyle = rgba(C.coast, 0.94); ctx.lineWidth = Math.max(1.35, u * 0.3);
      coastIsles.forEach((I) => { ctx.beginPath(); I.coast.forEach((pt, idx) => { const px = X(pt[0]), py = X(pt[1]); idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); ctx.stroke(); });
    }
    ctx.strokeStyle = rgba(C.grid, 0.14); ctx.lineWidth = Math.max(0.55, u * 0.075); ctx.setLineDash([u * 0.55, u * 0.8]);
    ctx.beginPath(); for (let q = -1200; q <= 1200; q += 300) { const p = X(q); ctx.moveTo(p, m); ctx.lineTo(p, m + w); ctx.moveTo(m, p); ctx.lineTo(m + w, p); } ctx.stroke(); ctx.setLineDash([]);
    const rnd = TW.rng ? TW.rng(4177) : Math.random, g = chart.grid, s = w / (N - 1);
    // hill hatching on the lee (south-east) slopes — light falls from the north-west
    ctx.strokeStyle = rgba(C.line, 0.42); ctx.lineWidth = Math.max(0.6, u * 0.11); ctx.beginPath();
    for (let k = -N; k < N; k += 2) {
      let run = -1;
      for (let t = 0; t <= N; t++) {
        const i = t, j = t + k, inside = i >= 0 && j >= 0 && i < N - 1 && j < N - 1;
        const on = inside && g[j * N + i] > 1.2 && g[j * N + i] - g[(j + 1) * N + i + 1] > 0.55;
        if (on && run < 0) run = t;
        else if (!on && run >= 0) {
          if (t - run >= 1) { const j0 = (rnd() - 0.5) * 0.7, j1 = (rnd() - 0.5) * 0.7; ctx.moveTo(m + (run - 0.3 + j0) * s, m + (run + k - 0.3 - j0) * s); ctx.lineTo(m + (t - 0.4 + j1) * s, m + (t + k - 0.4 - j1) * s); }
          run = -1;
        }
      }
    }
    ctx.stroke();
    // soundings: depth lines hugging the shore, land contours, then the coast itself
    ctx.strokeStyle = rgba(C.sea, 0.5); ctx.lineWidth = Math.max(0.6, u * 0.1); ctx.setLineDash([u * 0.9, u * 0.7]); isoPath(ctx, -16, m, w); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = rgba(C.line, 0.34); ctx.lineWidth = Math.max(0.6, u * 0.1); isoPath(ctx, -5, m, w); ctx.stroke();
    ctx.strokeStyle = rgba(C.line, 0.3); isoPath(ctx, 22, m, w); ctx.stroke(); isoPath(ctx, 52, m, w); ctx.stroke();
    ctx.strokeStyle = rgba(C.ink, 0.88); ctx.lineWidth = Math.max(1.1, u * 0.24); isoPath(ctx, 0.25, m, w); ctx.stroke();
    // the reach of the gale
    ctx.strokeStyle = rgba(C.line, 0.3); ctx.lineWidth = Math.max(0.6, u * 0.1); ctx.setLineDash([u * 0.3, u * 1.1]);
    ctx.beginPath(); ctx.arc(X(0), X(0), 1250 / (2 * ext) * w, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // scattered soundings in fathoms
    chartFont(ctx, Math.max(8, u * 1.45), 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = rgba(C.line, 0.4);
    for (let n = 0; n < 150; n++) {
      const a = rnd() * TAU, rr = Math.sqrt(rnd()) * 1280, x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      const gi = Math.round((x + ext) / (2 * ext) * (N - 1)), gj = Math.round((z + ext) / (2 * ext) * (N - 1)), hh = g[gj * N + gi];
      if (hh < -3 && hh > -70 && n % 2 === 0) ctx.fillText(String(Math.max(1, Math.round(-hh / 1.83))), X(x), X(z));
    }
    // Fixed arch pillars stay on the static layer; editable rocks follow pointer drags.
    const allRocks = (W && W.rocks) || [];
    const rocks = chart.rockEditing ? allRocks.filter((r) => r && r.arch) : allRocks;
    ctx.strokeStyle = rgba(C.ink, 0.72); ctx.lineWidth = Math.max(0.8, u * 0.15); ctx.beginPath();
    const rs = Math.max(2, u * 0.5);
    for (let i = 0; i < rocks.length && i < 600; i++) { const r = rocks[i]; if (!r || !isNum(r.x) || !isNum(r.z)) continue; const x = X(r.x), y = X(r.z); ctx.moveTo(x - rs, y); ctx.lineTo(x + rs, y); ctx.moveTo(x, y - rs); ctx.lineTo(x, y + rs); }
    ctx.stroke();
    // the Maw
    let mawAt = null;
    const vx = W && W.vortex;
    if (vx && isNum(vx.x) && isNum(vx.z)) {
      const cx = X(vx.x), cy = X(vx.z), R = Math.max(u * 2.6, (vx.r || 100) / (2 * ext) * w);
      ctx.strokeStyle = rgba(C.ink, 0.72); ctx.lineWidth = Math.max(0.9, u * 0.17);
      for (let arm = 0; arm < 2; arm++) { ctx.beginPath(); for (let t = 0; t <= 60; t++) { const f = t / 60, a = f * TAU * 1.6 + arm * Math.PI, r = R * (0.08 + 0.92 * f); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (t) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
      mawAt = [cx, cy, R];
    }
    // island names
    const isl = (W && W.islands) || [];
    // labels are placed above / below / beside their feature, wherever nothing else has been lettered yet
    const placed = [[m, m, m + u * 54, m + u * 10.5], [m, S - m - u * 23, m + u * 23, S - m], [S - m - u * 26, S - m - u * 8, S - m, S - m]];
    const label = (str, cx, cy, r, px, alpha) => {
      const tw = ctx.measureText(str).width + px * 0.8, th = px * 1.2, gap = r + th * 0.62;
      const opts = [[0, -gap], [0, gap], [r + tw / 2 + px * 0.3, 0], [-(r + tw / 2 + px * 0.3), 0], [0, -gap - th], [0, gap + th]];
      let bx = 0, by = 0, found = false;
      for (let o = 0; o < opts.length && !found; o++) {
        const x = TW.clamp(cx + opts[o][0], m + tw / 2 + u, S - m - tw / 2 - u), y = TW.clamp(cy + opts[o][1], m + th, S - m - th);
        let hit = false;
        for (let q = 0; q < placed.length && !hit; q++) { const P = placed[q]; hit = x - tw / 2 < P[2] && x + tw / 2 > P[0] && y - th / 2 < P[3] && y + th / 2 > P[1]; }
        if (!hit || o === 0) { bx = x; by = y; found = !hit; }
      }
      placed.push([bx - tw / 2, by - th / 2, bx + tw / 2, by + th / 2]);
      haloText(ctx, str, bx, by, C, alpha);
    };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ipx = Math.max(11, u * 2.15), order = isl.slice().sort((a, b) => ((b && b.r) || 0) - ((a && a.r) || 0));
    chartFont(ctx, ipx, 'italic small-caps', 0.1);
    for (let i = 0; i < order.length; i++) { const I = order[i]; if (!I || !I.name || !isNum(I.x) || !isNum(I.z)) continue; label(String(I.name), X(I.x), X(I.z), (I.r || 120) / (2 * ext) * w * 0.8, ipx); }
    if (mawAt) { const mpx = Math.max(10, u * 1.9); chartFont(ctx, mpx, 'italic', 0.06); label('The Maw', mawAt[0], mawAt[1], mawAt[2] + u * 0.3, mpx, 0.85); }
    ctx.restore();
    // neatline: double rule with a ticked scale
    ctx.strokeStyle = rgba(C.ink, 0.85); ctx.lineWidth = Math.max(1, u * 0.2); ctx.strokeRect(m - u * 0.9, m - u * 0.9, w + u * 1.8, w + u * 1.8);
    ctx.lineWidth = Math.max(0.6, u * 0.09); ctx.strokeRect(m, m, w, w);
    ctx.beginPath();
    for (let i = 0; i <= 56; i++) { const p = m + (i / 56) * w, len = i % 4 === 0 ? u * 0.9 : u * 0.45; ctx.moveTo(p, m); ctx.lineTo(p, m + len); ctx.moveTo(p, m + w); ctx.lineTo(p, m + w - len); ctx.moveTo(m, p); ctx.lineTo(m + len, p); ctx.moveTo(m + w, p); ctx.lineTo(m + w - len, p); }
    ctx.stroke();
    // cartouche
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    chartFont(ctx, Math.max(12, u * 2.5), '', 0.3); ctx.fillStyle = rgba(C.ink, 0.92); ctx.fillText('ACHIPÈL GWADLOUP', m + u * 3, m + u * 5.2);
    ctx.strokeStyle = rgba(C.ink, 0.6); ctx.lineWidth = Math.max(0.6, u * 0.09); ctx.beginPath(); ctx.moveTo(m + u * 3, m + u * 6.3); ctx.lineTo(m + u * 22, m + u * 6.3); ctx.stroke();
    chartFont(ctx, Math.max(10, u * 1.65), 'italic'); ctx.fillStyle = rgba(C.ink, 0.72); ctx.fillText('On kat pou pilòt, jan yo té fè rèlevé-la avan Gwo Van-la', m + u * 3, m + u * 8.6);
    // compass rose (N up)
    const rcx = m + u * 12.5, rcy = S - m - u * 12.5, rr = u * 7;
    chart.rose = [rcx, rcy, rr];
    ctx.strokeStyle = rgba(C.ink, 0.75); ctx.lineWidth = Math.max(0.6, u * 0.1);
    ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, TAU); ctx.moveTo(rcx + rr * 0.86, rcy); ctx.arc(rcx, rcy, rr * 0.86, 0, TAU); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, r0 = rr * (i % 4 === 0 ? 0.74 : 0.8); ctx.moveTo(rcx + Math.sin(a) * r0, rcy - Math.cos(a) * r0); ctx.lineTo(rcx + Math.sin(a) * rr * 0.86, rcy - Math.cos(a) * rr * 0.86); } ctx.stroke();
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + (pass ? 0 : Math.PI / 4), len = rr * (pass ? 0.98 : 0.6), wd = rr * (pass ? 0.15 : 0.11);
      const tx = rcx + Math.sin(a) * len, ty = rcy - Math.cos(a) * len, lx = rcx + Math.sin(a - Math.PI / 2) * wd, ly = rcy - Math.cos(a - Math.PI / 2) * wd, rx = rcx + Math.sin(a + Math.PI / 2) * wd, ry = rcy - Math.cos(a + Math.PI / 2) * wd;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); ctx.lineTo(rcx, rcy); ctx.closePath(); ctx.fillStyle = rgba(C.ink, pass ? 0.82 : 0.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); ctx.lineTo(rcx, rcy); ctx.closePath(); ctx.fillStyle = rgba(C.vellum, 1); ctx.fill(); ctx.stroke();
    }
    chartFont(ctx, Math.max(11, u * 2.1), ''); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = rgba(C.ink, 0.9); ctx.fillText('N', rcx, rcy - rr - u * 0.9);
    // scale bar
    const sb = 500 / (2 * ext) * w, sx = S - m - u * 4 - sb, sy = S - m - u * 4;
    ctx.strokeStyle = rgba(C.ink, 0.8); ctx.lineWidth = Math.max(0.8, u * 0.14); ctx.beginPath(); ctx.moveTo(sx, sy - u * 0.7); ctx.lineTo(sx, sy); ctx.lineTo(sx + sb, sy); ctx.lineTo(sx + sb, sy - u * 0.7); ctx.moveTo(sx + sb / 2, sy); ctx.lineTo(sx + sb / 2, sy - u * 0.45); ctx.stroke();
    chartFont(ctx, Math.max(9, u * 1.5), 'italic'); ctx.textAlign = 'center'; ctx.fillStyle = rgba(C.ink, 0.75); ctx.fillText('500 m', sx + sb / 2, sy - u * 1.3);
  }
  function rockCopy(q) {
    return { x: Number(q.x), z: Number(q.z), r: Number(q.r) || 6, h: Number(q.h) || 12, lean: Number(q.lean) || 0, la: Number(q.la) || 0 };
  }
  function rockSignature(rocks) {
    return (rocks || []).map((q) => [q.x, q.z, q.r, q.h, q.lean, q.la].map((v) => (Number(v) || 0).toFixed(2)).join(',')).join('|');
  }
  function refreshRockEditor(status) {
    if (status) chart.rockStatus = status;
    chart.rockDirty = rockSignature(chart.rockEditRocks) !== chart.rockBaseline;
    chart.dirty = true;
    updateRockEditorUI();
  }
  function updateRockEditorUI() {
    if (!chart.rockEditButton) return;
    const selected = chart.rockEditRocks && chart.rockEditRocks[chart.rockSelected];
    chart.rockEditButton.textContent = chart.rockEditing ? 'Fèmé zouti wòch' : 'Chanjé wòch';
    chart.rockEditButton.classList.toggle('twui-rock-on', chart.rockEditing);
    chart.rockControls.hidden = !chart.rockEditing;
    chart.rockDeleteButton.disabled = !selected;
    chart.rockSaveButton.disabled = !chart.rockDirty;
    chart.rockAddButton.classList.toggle('twui-rock-on', chart.rockPlacement);
    chart.rockRadius.disabled = !selected; chart.rockHeight.disabled = !selected;
    if (selected) {
      chart.rockRadius.value = String(selected.r); chart.rockRadiusOut.value = Number(selected.r).toFixed(1) + ' m';
      chart.rockHeight.value = String(selected.h); chart.rockHeightOut.value = Number(selected.h).toFixed(0) + ' m';
      chart.rockStatusNode.textContent = chart.rockStatus || ('Wòch ' + (chart.rockSelected + 1) + ' chwazi.');
    } else chart.rockStatusNode.textContent = chart.rockStatus || 'Pétèt chwazi on wòch.';
    chart.rockCountNode.textContent = 'Wòch ou pé déplasé: ' + ((chart.rockEditRocks && chart.rockEditRocks.length) || 0) + ' · pilyé pon-la ka rété anplas.';
  }
  function toggleRockEditor() {
    if (chart.rockEditing) {
      if (chart.rockDirty && !window.confirm('Ni chanjman ki poko sové. Ou vlé jété-yo?')) return;
      chart.rockEditing = false; chart.rockPlacement = false; chart.rockEditRocks = null; chart.rockOriginalRocks = null;
      chart.rockSelected = -1; chart.rockDrag = -1; chart.rockPointerId = null; chart.rockDirty = false; chart.rockStatus = '';
      E.chart.classList.remove('twui-rock-editing'); chart.stat = null; chart.dirty = true; updateRockEditorUI(); return;
    }
    const W = TW.world;
    if (!W || !Array.isArray(W.rocks)) { chart.rockStatus = 'Kat-la poko pare pou édité sé wòch-la.'; updateRockEditorUI(); return; }
    chart.rockOriginalRocks = W.rocks.filter((q) => q && !q.arch).map(rockCopy);
    chart.rockEditRocks = chart.rockOriginalRocks.map(rockCopy);
    chart.rockBaseline = rockSignature(chart.rockEditRocks); chart.rockDirty = false; chart.rockSelected = -1;
    chart.rockEditing = true; chart.rockPlacement = false; chart.rockStatus = 'Tiré on wòch pou déplasé’y.';
    E.chart.classList.add('twui-rock-editing'); chart.stat = null; chart.dirty = true; updateRockEditorUI();
  }
  function toggleRockPlacement() {
    if (!chart.rockEditing) return;
    chart.rockPlacement = !chart.rockPlacement;
    chart.rockStatus = chart.rockPlacement ? 'Kliké asi on plas lib adan lanmè-la pou pozé on wòch.' : 'Tiré on wòch pou déplasé’y.';
    updateRockEditorUI();
  }
  function cancelRockEdits() {
    if (!chart.rockEditing) return;
    if (chart.rockDirty && !window.confirm('Jété tout sé chanjman ki poko sové?')) return;
    chart.rockEditing = false; chart.rockPlacement = false; chart.rockEditRocks = null; chart.rockOriginalRocks = null;
    chart.rockSelected = -1; chart.rockDrag = -1; chart.rockPointerId = null; chart.rockDirty = false; chart.rockStatus = '';
    E.chart.classList.remove('twui-rock-editing'); chart.stat = null; chart.dirty = true; updateRockEditorUI();
  }
  function saveRockEdits() {
    if (!chart.rockEditing || !chart.rockDirty || !Array.isArray(chart.rockEditRocks)) return;
    if (!window.confirm('Sové sé wòch-la é woukoumansé jwèt-la?')) return;
    TW.settings.world.rocksOverride = chart.rockEditRocks.slice(0, 200).map(rockCopy);
    TW.saveSettings(); location.reload();
  }
  function rockPoint(ev) {
    if (!chart.cv || !chart.size || !chart.w) return null;
    const rect = chart.cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = (ev.clientX - rect.left) * chart.size / rect.width, py = (ev.clientY - rect.top) * chart.size / rect.height;
    if (px < chart.m || py < chart.m || px > chart.m + chart.w || py > chart.m + chart.w) return null;
    return { px, py, x: ((px - chart.m) / chart.w * 2 - 1) * chart.ext, z: ((py - chart.m) / chart.w * 2 - 1) * chart.ext };
  }
  function rockHit(px, py) {
    let hit = -1, best = Infinity;
    (chart.rockEditRocks || []).forEach((q, i) => {
      const x = chart.m + (q.x + chart.ext) / (2 * chart.ext) * chart.w, y = chart.m + (q.z + chart.ext) / (2 * chart.ext) * chart.w;
      const d = Math.hypot(px - x, py - y), limit = Math.max(9, q.r / (2 * chart.ext) * chart.w + 6);
      if (d <= limit && d < best) { hit = i; best = d; }
    });
    return hit;
  }
  function rockDropError(x, z, r, ignore, origin) {
    const W = TW.world;
    if (!W || typeof W.heightAt !== 'function') return 'Kat-la poko pare.';
    if (Math.hypot(x, z) > 1225) return 'Rété andidan zòn navigasyon-an.';
    const ch = (TW.worldChannels || {}).SAINTES_CHANNEL;
    if (ch) {
      const vx = ch.bx - ch.ax, vz = ch.bz - ch.az, wx = x - ch.ax, wz = z - ch.az;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
      if (Math.hypot(x - ch.ax - vx * t, z - ch.az - vz * t) <= ch.w) return 'Pa mété wòch adan kanal-la.';
    }
    if (W.spawn && Math.hypot(x - W.spawn.x, z - W.spawn.z) < 85 + r) return 'Rété pli lwen dèpa-a.';
    if (W.vortex && Math.hypot(x - W.vortex.x, z - W.vortex.z) < (W.vortex.r || 100) + 64 + r) return 'Rété lwen Maw-la.';
    const docks = W.beacons || [];
    for (let i = 0; i < docks.length; i++) if (docks[i] && docks[i].dock) {
      const D = docks[i].dock, ex = x - D.x, ez = z - D.z, d = Math.hypot(ex, ez);
      if (d < 88 + r) return 'Rété lwen pò-yo.';
      const dir = docks[i].dockDir;
      if (dir && d < 300 && (ex * dir.x + ez * dir.z) / d > 0.45) return 'Kité koulwa pou apwòch pò-la lib.';
    }
    const originalSpot = (chart.rockOriginalRocks || []).some((q) => Math.hypot(x - q.x, z - q.z) <= q.r + r + 3);
    const dragSpot = origin && Math.hypot(x - origin.x, z - origin.z) <= origin.r + r + 3;
    if (W.heightAt(x, z) > -2.5 && !originalSpot && !dragSpot) return 'Chwazi dlo fon, pa tè.';
    const fixed = (W.rocks || []).filter((q) => q && q.arch);
    const current = fixed.concat(chart.rockEditRocks || []);
    for (let i = 0; i < current.length; i++) {
      const q = current[i]; if (!q || (ignore >= 0 && current[i] === chart.rockEditRocks[ignore])) continue;
      if (Math.hypot(x - q.x, z - q.z) < r + (q.r || 6) + 10) return 'Wòch-la two pré dè on lòt.';
    }
    return '';
  }
  function rockPointerDown(ev) {
    if (!chart.rockEditing) return;
    const p = rockPoint(ev); if (!p) return;
    ev.preventDefault(); ev.stopPropagation();
    let idx = rockHit(p.px, p.py);
    if (idx < 0 && chart.rockPlacement) {
      if (chart.rockEditRocks.length >= 200) { chart.rockStatus = 'Ou ja ni 200 wòch; pa pé ajouté ankò.'; updateRockEditorUI(); return; }
      const q = { x: p.x, z: p.z, r: 6, h: 12, lean: 0, la: Math.random() * TAU };
      const error = rockDropError(q.x, q.z, q.r, -1, null);
      if (error) { chart.rockStatus = error; updateRockEditorUI(); return; }
      chart.rockEditRocks.push(q); idx = chart.rockEditRocks.length - 1; refreshRockEditor('Nouvo wòch-la pozé; ou pé déplasé’y.');
    }
    chart.rockSelected = idx;
    if (idx >= 0) {
      const q = chart.rockEditRocks[idx]; chart.rockStatus = 'Wòch ' + (idx + 1) + ' chwazi.';
      chart.rockDrag = idx; chart.rockPointerId = ev.pointerId; chart.rockDragOrigin = { x: q.x, z: q.z, r: q.r };
      try { chart.cv.setPointerCapture(ev.pointerId); } catch (e) { /* optional */ }
    } else if (!chart.rockPlacement) chart.rockStatus = 'Pétèt chwazi on wòch.';
    updateRockEditorUI();
  }
  function rockPointerMove(ev) {
    if (!chart.rockEditing || chart.rockDrag < 0 || chart.rockPointerId !== ev.pointerId) return;
    const p = rockPoint(ev); if (!p) return;
    ev.preventDefault();
    const q = chart.rockEditRocks[chart.rockDrag], error = rockDropError(p.x, p.z, q.r, chart.rockDrag, chart.rockDragOrigin);
    if (error) { if (chart.rockStatus !== error) { chart.rockStatus = error; updateRockEditorUI(); } return; }
    q.x = p.x; q.z = p.z; refreshRockEditor('Wòch-la déplasé. Sové pou apliké’y adan jwèt-la.');
  }
  function rockPointerUp(ev) {
    if (chart.rockPointerId !== ev.pointerId) return;
    chart.rockDrag = -1; chart.rockPointerId = null; chart.rockDragOrigin = null;
  }
  function deleteSelectedRock() {
    if (!chart.rockEditing || chart.rockSelected < 0) return;
    chart.rockEditRocks.splice(chart.rockSelected, 1); chart.rockSelected = -1; chart.rockStatus = 'Wòch-la efasé. Sové pou apliké chanjman-an.';
    refreshRockEditor(chart.rockStatus);
  }
  function setSelectedRockRadius() {
    const q = chart.rockEditRocks && chart.rockEditRocks[chart.rockSelected]; if (!q) return;
    const next = Number(chart.rockRadius.value), error = rockDropError(q.x, q.z, next, chart.rockSelected, { x: q.x, z: q.z, r: q.r });
    if (error) { chart.rockRadius.value = String(q.r); chart.rockStatus = error; updateRockEditorUI(); return; }
    q.r = next; refreshRockEditor('Gwosè-la chanjé. Sové pou apliké’y adan jwèt-la.');
  }
  function setSelectedRockHeight() {
    const q = chart.rockEditRocks && chart.rockEditRocks[chart.rockSelected]; if (!q) return;
    q.h = Number(chart.rockHeight.value); refreshRockEditor('Wotè-la chanjé. Sové pou apliké’y adan jwèt-la.');
  }
  function drawRockEditor(ctx, u, m, w, ext, C) {
    const rocks = chart.rockEditRocks || [];
    ctx.save(); ctx.lineCap = 'round';
    rocks.forEach((q, i) => {
      const x = m + (q.x + ext) / (2 * ext) * w, y = m + (q.z + ext) / (2 * ext) * w;
      const r = Math.max(u * 0.55, q.r / (2 * ext) * w), selected = i === chart.rockSelected;
      ctx.strokeStyle = rgba(selected ? C.deep : C.ink, 0.96); ctx.lineWidth = Math.max(1.4, u * 0.24);
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      if (selected) { ctx.beginPath(); ctx.arc(x, y, Math.max(7, r + 5), 0, TAU); ctx.strokeStyle = rgba(C.ember, 0.95); ctx.lineWidth = Math.max(1.5, u * 0.28); ctx.stroke(); }
    });
    ctx.restore();
  }
  function islandNamed(W, name) {
    const isl = (W && W.islands) || [], n = String(name).toLowerCase();
    for (let i = 0; i < isl.length; i++) if (isl[i] && String(isl[i].name).toLowerCase() === n) return true;
    return false;
  }
  function raceChartActive() {
    const r = TW.regattaState, p = r && r.phase;
    return !!(r && r.gate && r.courseGates && r.courseGates.length && (p === 'countdown' || p === 'racing' || p === 'finished'));
  }
  function racePoint(g) {
    if (!g) return null;
    const x = isNum(g.x) ? g.x : isNum(g.cx) ? g.cx : isNum(g.sx) ? g.sx : null;
    const z = isNum(g.z) ? g.z : isNum(g.cz) ? g.cz : isNum(g.sz) ? g.sz : null;
    return x === null || z === null ? null : { x, z };
  }
  function drawRaceMap(ctx, u, m, w, ext, C, X) {
    if (!raceChartActive()) return false;
    const R = TW.regattaState, course = R.courseGates || [], gate = R.gate || {};
    const D = TW.raceDirector && TW.raceDirector.state;
    const rows = D && D.active && Array.isArray(D.competitors) ? D.competitors : [];
    const player = rows.find((r) => r.id === 'player'), passed = player ? Math.max(0, player.checkpointIndex || 0) : 0;
    const next = passed < course.length ? course[passed] : null;
    const start = { x: gate.sx, z: gate.sz }, points = [start].concat(course.map(racePoint).filter(Boolean));
    ctx.save(); ctx.beginPath(); ctx.rect(m, m, w, w); ctx.clip();
    // Le tracé vient exclusivement du contrat de régate, dans son ordre réel.
    ctx.strokeStyle = rgba(C.deep, 0.68); ctx.lineWidth = Math.max(1.2, u * 0.3); ctx.setLineDash([u * 0.65, u * 0.7]);
    ctx.beginPath(); points.forEach((p, i) => { const x = X(p.x), y = X(p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
    course.forEach((g, i) => {
      const p = racePoint(g); if (!p) return;
      const ux = isNum(g.px) ? g.px : 1, uz = isNum(g.pz) ? g.pz : 0, half = Math.max(5, Number(g.half || g.width || 18));
      const a = { x: p.x - ux * half, z: p.z - uz * half }, b = { x: p.x + ux * half, z: p.z + uz * half };
      const isNext = g === next, isPassed = i < passed, alpha = isNext ? 1 : isPassed ? 0.3 : 0.5;
      if (isNext) { ctx.shadowColor = rgba(C.ember, 0.9); ctx.shadowBlur = u * (3.2 + 0.35 * Math.sin(clock * 4)); }
      ctx.strokeStyle = rgba(isNext ? C.ember : isPassed ? C.deep : C.line, alpha); ctx.lineWidth = Math.max(1.1, u * (isNext ? 0.34 : 0.18));
      ctx.beginPath(); ctx.moveTo(X(a.x), X(a.z)); ctx.lineTo(X(b.x), X(b.z)); ctx.stroke(); ctx.shadowBlur = 0;
      [a, b].forEach((q) => { ctx.fillStyle = rgba(isNext ? C.ember : C.line, alpha + 0.12); ctx.beginPath(); ctx.arc(X(q.x), X(q.z), Math.max(1.5, u * (isNext ? 0.55 : 0.35)), 0, TAU); ctx.fill(); });
      if (isNext || isPassed || i === course.length - 1) { chartFont(ctx, Math.max(8, u * 1.2), 'small-caps', 0.1); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; haloText(ctx, String(g.name || (i === course.length - 1 ? 'ARRIVÉE' : 'PORTE ' + (i + 1))), X(p.x), X(p.z) - u * 1.4, C, isNext ? 1 : 0.58); }
    });
    if (isNum(start.x) && isNum(start.z)) {
      const half = Math.max(5, Number(gate.half || 18)), px = isNum(gate.px) ? gate.px : 1, pz = isNum(gate.pz) ? gate.pz : 0;
      const a = { x: start.x - px * half, z: start.z - pz * half }, b = { x: start.x + px * half, z: start.z + pz * half };
      ctx.strokeStyle = rgba(C.muted || C.line, 0.8); ctx.lineWidth = Math.max(1, u * 0.2); ctx.beginPath(); ctx.moveTo(X(a.x), X(a.z)); ctx.lineTo(X(b.x), X(b.z)); ctx.stroke();
      [a, b].forEach((q) => { ctx.fillStyle = rgba(C.muted || C.line, 0.9); ctx.beginPath(); ctx.arc(X(q.x), X(q.z), Math.max(1.5, u * 0.42), 0, TAU); ctx.fill(); });
      chartFont(ctx, Math.max(8, u * 1.2), 'small-caps', 0.1); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; haloText(ctx, 'DÉPART', X(start.x), X(start.z) + u * 1.4, C, 0.7);
    }
    // Utilise les trajectoires déjà produites par Race Director, sans historique parallèle.
    rows.forEach((r) => { const trace = Array.isArray(r.trajectory) ? r.trajectory : []; if (trace.length < 2) return; ctx.strokeStyle = rgba(r.player ? C.ember : C.line, r.player ? 0.5 : 0.25); ctx.lineWidth = Math.max(0.7, u * 0.12); ctx.beginPath(); trace.forEach((p, i) => { const a = i / Math.max(1, trace.length - 1); ctx.globalAlpha = (r.player ? 0.12 : 0.06) + a * (r.player ? 0.38 : 0.2); const x = X(p.x), y = X(p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.globalAlpha = 1; });
    // Positions X/Z et orientation réelles du joueur et de la flotte.
    rows.forEach((r) => { if (!isNum(r.x) || !isNum(r.z)) return; const x = X(r.x), y = X(r.z), sz = u * (r.player ? 1.65 : 1.25); ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI - (isNum(r.heading) ? r.heading : 0)); ctx.fillStyle = rgba(r.player ? C.ember : C.line, 0.96); ctx.strokeStyle = rgba(C.ink, 0.95); ctx.lineWidth = Math.max(0.8, u * 0.16); ctx.beginPath(); ctx.moveTo(0, -sz * 1.2); ctx.lineTo(sz * 0.7, sz * 0.9); ctx.lineTo(0, sz * 0.55); ctx.lineTo(-sz * 0.7, sz * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); chartFont(ctx, Math.max(8, u * 1.15), 'small-caps', 0.1); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; haloText(ctx, String(r.number || r.id || '?'), x + sz * 1.05, y, C, r.player ? 1 : 0.72); });
    ctx.restore();
    return true;
  }
  function drawChart() {
    const cv = chart.cv;
    if (chart.dirty) {
      chart.dirty = false;
      const css = cv.clientWidth || 0;
      if (css < 40) { chart.dirty = true; return; }
      const size = Math.min(1600, Math.round(css * Math.min(2, window.devicePixelRatio || 1)));
      if (size !== chart.size || !chart.stat) {
        chart.size = size; cv.width = cv.height = size; chart.ctx = cv.getContext('2d');
        if (!chart.col) chartColours();
        chartStatic();
      }
    }
    const ctx = chart.ctx; if (!ctx || !chart.stat) return;
    const S = TW.state, C = chart.col, u = chart.u, m = chart.m, w = chart.w, ext = chart.ext, W = world();
    const X = (x) => m + (x + ext) / (2 * ext) * w;
    const hud = game() && game().hud;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.drawImage(chart.stat, 0, 0);
    if (chart.rockEditing) drawRockEditor(ctx, u, m, w, ext, C);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const bx = X(S.boat.x), by = X(S.boat.z);
    const wb = (W && W.beacons) || [];
    let raceActive = false;
    // dotted course to the current target
    const tg = hud && hud.target, tb = tg && wb[tg.index];
    if (tb && !raceChartActive()) {
      const dk = tb.dock || tb;
      ctx.strokeStyle = rgba(C.deep, 0.95); ctx.lineWidth = Math.max(1.6, u * 0.34); ctx.setLineDash([u * 0.05, u * 1.0]);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(X(dk.x), X(dk.z)); ctx.stroke(); ctx.setLineDash([]);
    }
    // beacons
    for (let i = 0; i < wb.length; i++) {
      const b = wb[i]; if (!b || !isNum(b.x) || !isNum(b.z)) continue;
      const lit = isKindled(i), x = X(b.x), y = X(b.z), s = u * (b.isHeart ? 2.1 : 1.5);
      if (b.dock && isNum(b.dock.x) && !lit) { ctx.strokeStyle = rgba(C.deep, 0.9); ctx.lineWidth = Math.max(0.8, u * 0.14); ctx.setLineDash([u * 0.35, u * 0.4]); ctx.beginPath(); ctx.arc(X(b.dock.x), X(b.dock.z), Math.max(u * 0.9, (b.dock.r || 30) / (2 * ext) * w), 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      if (lit) {
        const pr = s * (3.1 + 0.25 * Math.sin(clock * 1.7 + i * 2.1)), gr = ctx.createRadialGradient(x, y - s * 0.85, 0, x, y - s * 0.85, pr);
        gr.addColorStop(0, rgba(C.ember, 0.75)); gr.addColorStop(0.45, rgba(C.deep, 0.24)); gr.addColorStop(1, rgba(C.deep, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y - s * 0.85, pr, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(C.deep, 0.9); ctx.lineWidth = Math.max(0.8, u * 0.15); ctx.beginPath();
        for (let k = 0; k < 8; k++) { if (k === 4) continue; const a = k * Math.PI / 4; ctx.moveTo(x + Math.sin(a) * s * 0.75, y - s * 0.85 - Math.cos(a) * s * 0.75); ctx.lineTo(x + Math.sin(a) * s * 1.45, y - s * 0.85 - Math.cos(a) * s * 1.45); }
        ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.55); ctx.lineTo(x - s * 0.26, y - s * 0.5); ctx.lineTo(x + s * 0.26, y - s * 0.5); ctx.lineTo(x + s * 0.5, y + s * 0.55); ctx.closePath();
      ctx.fillStyle = rgba(lit ? C.vellum : mix(C.vellum, C.ink, 0.72)); ctx.fill();
      ctx.strokeStyle = rgba(C.ink, 0.95); ctx.lineWidth = Math.max(1, u * 0.18); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - s * 0.85, s * 0.34, 0, TAU); ctx.fillStyle = rgba(lit ? C.ember : mix(C.vellum, C.ink, 0.72)); ctx.fill(); ctx.stroke();
      if (b.isHeart) { ctx.beginPath(); ctx.arc(x, y - s * 0.1, s * 1.75, 0, TAU); ctx.lineWidth = Math.max(0.6, u * 0.1); ctx.strokeStyle = rgba(C.ink, 0.6); ctx.stroke(); }
      if (b.name && tg && tg.index === i && !islandNamed(W, b.name)) { chartFont(ctx, Math.max(9, u * 1.5), 'small-caps', 0.14); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; haloText(ctx, String(b.name), TW.clamp(x, m + u * 9, m + w - u * 9), y + s * (b.isHeart ? 1.85 : 0.8) + u * 0.25, C, 0.92); }
    }
    raceActive = drawRaceMap(ctx, u, m, w, ext, C, X);
    // wind arrow, flying in to the rose from where the wind comes
    if (chart.rose) {
      const wa = hud && isNum(hud.windAngle) ? hud.windAngle : Math.atan2(S.wind.dirX, S.wind.dirZ), th = -wa;
      const rx = chart.rose[0], ry = chart.rose[1], rr = chart.rose[2], sx = Math.sin(th), sy = -Math.cos(th);
      const x0 = rx + sx * rr * 1.62, y0 = ry + sy * rr * 1.62, x1 = rx + sx * rr * 1.08, y1 = ry + sy * rr * 1.08, px = -sy, py = sx, hw = u * 0.7;
      ctx.strokeStyle = rgba(C.sea, 1); ctx.fillStyle = rgba(C.sea, 1); ctx.lineWidth = Math.max(1.2, u * 0.26);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 - sx * u * 0.3, y1 - sy * u * 0.3); ctx.lineTo(x1 + sx * u * 1.5 + px * hw, y1 + sy * u * 1.5 + py * hw); ctx.lineTo(x1 + sx * u * 1.5 - px * hw, y1 + sy * u * 1.5 - py * hw); ctx.closePath(); ctx.fill();
      ctx.lineWidth = Math.max(0.9, u * 0.16); ctx.beginPath();
      for (let k = 0; k < 2; k++) { const fx = x0 - sx * k * u * 0.8, fy = y0 - sy * k * u * 0.8; ctx.moveTo(fx, fy); ctx.lineTo(fx + sx * u * 0.9 + px * hw, fy + sy * u * 0.9 + py * hw); ctx.moveTo(fx, fy); ctx.lineTo(fx + sx * u * 0.9 - px * hw, fy + sy * u * 0.9 - py * hw); }
      ctx.stroke();
    }
    // the skiff (the tactical layer already draws the player during a race)
    if (raceActive) return;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 2.4);
    ctx.strokeStyle = rgba(C.deep, 0.75 - 0.4 * pulse); ctx.lineWidth = Math.max(1, u * 0.18); ctx.beginPath(); ctx.arc(bx, by, u * (2.3 + 0.9 * pulse), 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.PI - S.boat.heading);
    ctx.beginPath(); ctx.moveTo(0, -u * 1.75); ctx.quadraticCurveTo(u * 0.95, -u * 0.2, u * 0.6, u * 1.15); ctx.lineTo(-u * 0.6, u * 1.15); ctx.quadraticCurveTo(-u * 0.95, -u * 0.2, 0, -u * 1.75); ctx.closePath();
    ctx.fillStyle = rgba(C.ember); ctx.fill(); ctx.strokeStyle = rgba(C.ink, 0.95); ctx.lineWidth = Math.max(1, u * 0.2); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD updates (diffed; no layout reads)
  // ---------------------------------------------------------------------------
  function isKindled(i) {
    if (demo) return !!demo.kindled[i];
    const b = TW.state.beacons && TW.state.beacons[i];
    return !!(b && (b.kindled || b.lit > 0.5));
  }
  function ensurePips(hud) {
    const W = world(), wb = (W && W.beacons) || null;
    const n = wb && wb.length ? wb.length : (hud && isNum(hud.total) ? hud.total | 0 : 0);
    if (n === pips.length) return;
    pips = []; pipOrder = []; pipLit = []; pipsPrimed = false;
    E.pips.textContent = '';
    for (let i = 0; i < n; i++) if (!(wb && wb[i] && wb[i].isHeart) && !(!wb && i === n - 1)) pipOrder.push(i);
    for (let i = 0; i < n; i++) if ((wb && wb[i] && wb[i].isHeart) || (!wb && i === n - 1)) pipOrder.push(i);
    for (let k = 0; k < pipOrder.length; k++) {
      const i = pipOrder[k], heart = (wb && wb[i] && wb[i].isHeart) || (!wb && i === n - 1);
      const holder = document.createElement('div');
      holder.innerHTML = svg('<path d="' + FLAME_D + '"/>', 'twui-pip' + (heart ? ' twui-pip--heart' : ''));
      const node = holder.firstChild;
      E.pips.appendChild(node); pips.push(node); pipLit.push(false);
    }
  }
  function setMarker(key, node, markDeg, deg) {
    let rel = mod(markDeg - deg + 180, 360) - 180, off = '';
    let x = 50 + (rel / 120) * 100;
    if (x < 5) { x = 5; off = 'l'; } else if (x > 95) { x = 95; off = 'r'; }
    const q = Math.round(x * 8);
    if (L[key] !== q) { L[key] = q; node.style.transform = 'translateX(' + (q / 8).toFixed(2) + '%)'; }
    if (L[key + 'o'] !== off) { L[key + 'o'] = off; node.setAttribute('data-off', off); }
  }
  function raceClock(t) { t = Math.max(0, Number(t) || 0); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0'); }
  function updateRaceBoard(S, phase) {
    const rr = TW.regattaState, board = E.raceBoard;
    const racePhase = rr && rr.phase;
    const active = !!(rr && (racePhase === 'countdown' || racePhase === 'racing' || racePhase === 'finished'));
    E.hud.classList.toggle('twui-race', active);
    board.classList.toggle('twui-on', active);
    if (!active || !rr.gate || !rr.total || !E.raceRows) return;
    const total = rr.total;
    const rows = TW.regatta && TW.regatta.standings ? TW.regatta.standings() : [];
    if (!rows.length) return;
    const leader = rows[0], liveGap = (r) => Math.max(0, (leader.progress - r.progress) * total);
    E.raceClock.textContent = raceClock(rr.elapsed);
    const playerNext = TW.regatta && TW.regatta.nextGateFor ? TW.regatta.nextGateFor('player') : null;
    const playerState = TW.regatta && TW.regatta.competitorState ? TW.regatta.competitorState('player') : null;
    const gates = rr.courseGates || [], passed = playerState ? playerState.checkpointIndex : 0, totalGates = gates.length;
    const nextDist = playerNext && S && S.boat ? Math.round(Math.hypot(playerNext.x - S.boat.x, playerNext.z - S.boat.z)) : null;
    E.raceProgress.textContent = playerNext ? ('PORTE ' + (passed + 1) + '/' + totalGates + ' · ' + playerNext.name + (nextDist === null ? '' : ' · ' + nextDist + ' M')) : 'PARCOURS TERMINÉ';
    if (E.raceProgressBar) E.raceProgressBar.style.width = (totalGates ? Math.min(100, passed / totalGates * 100) : 0).toFixed(1) + '%';
    E.raceRows.textContent = '';
    rows.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'twui-racerow' + (r.player ? ' twui-racerow--player' : '') + (r.finished ? ' twui-racerow--done' : '');
      const rank = document.createElement('span'); rank.className = 'twui-rank'; rank.textContent = String(i + 1);
      const boat = document.createElement('span'); boat.className = 'twui-raceboat'; boat.textContent = r.boat;
      const name = document.createElement('span'); name.textContent = r.name;
      const split = document.createElement('small'); split.className = 'twui-racesplit';
      const splitIndex = r.splits && r.splits.length ? r.splits.length : 0;
      if (splitIndex) {
        const gate = gates[Math.min(splitIndex - 1, gates.length - 1)];
        const cumulative = r.splits[splitIndex - 1], previous = splitIndex > 1 ? r.splits[splitIndex - 2] : 0;
        split.textContent = (gate ? gate.name : 'PASSAGE ' + splitIndex) + ' · +' + raceClock(cumulative - previous) + ' / ' + raceClock(cumulative);
      } else split.textContent = (r.gatesPassed || 0) + '/' + totalGates + ' portes';
      name.appendChild(split);
      const gap = document.createElement('span'); gap.className = 'twui-racegap';
      if (i === 0) gap.textContent = r.finished ? raceClock(r.time) : '—';
      else if (r.finished && leader.finished) gap.textContent = '+' + raceClock(Math.max(0, r.time - leader.time));
      else { gap.textContent = '≈ +' + Math.round(liveGap(r)) + ' m'; gap.title = 'Écart estimé de progression sur le parcours, pas distance entre bateaux'; }
      row.append(rank, boat, name, gap); E.raceRows.appendChild(row);
    });
  }
  function updateHud(hud, S, phase, dt) {
    updateRaceBoard(S, phase);
    // compass --------------------------------------------------------------
    const heading = hud && isNum(hud.heading) ? hud.heading : S.boat.heading;
    const deg = mod((Math.PI - heading) * DEG, 360);
    const p = deg < 180 ? deg + 360 : deg, q = Math.round(p * 10);
    if (L.cq !== q) { L.cq = q; E.strip.style.transform = 'translateX(' + (8.33333 - q / 72).toFixed(3) + '%)'; }
    const wa = hud && isNum(hud.windAngle) ? hud.windAngle : Math.atan2(S.wind.dirX, S.wind.dirZ);
    setMarker('mw', E.mkWind, mod(-wa * DEG, 360), deg);
    const point = hud && hud.pointOfSail || 'run';
    const pointNames = { irons: 'VENT DEBOUT', close: 'PRÈS DU VENT', beam: 'TRAVERS', broad: 'LARGUE', run: 'VENT ARRIÈRE' };
    if (E.sailRead) E.sailRead.textContent = 'ALLURE · ' + (pointNames[point] || point.toUpperCase());
    if (phase === 'sailing' || phase === 'free') {
      if (lastPointOfSail && point !== lastPointOfSail) showNavCue('CHANGEMENT D’ALLURE · ' + (pointNames[point] || point.toUpperCase()), 'sail');
      lastPointOfSail = point;
      if (navWindReference === null) navWindReference = wa;
      navWindSampleT += dt;
      if (navWindSampleT >= 3) {
        navWindSampleT = 0;
        if (Math.abs(TW.wrapAngle(wa - navWindReference)) > 24 * Math.PI / 180 && clock >= navWindCooldown) {
          showNavCue('LE VENT A TOURNÉ', 'alert'); navWindReference = wa; navWindCooldown = clock + 18;
        }
      }
    } else { lastPointOfSail = ''; navWindReference = null; navWindSampleT = 0; }
    navCueT = Math.max(0, navCueT - dt);
    if (E.navCue) E.navCue.classList.toggle('twui-on', navCueT > 0);
    const irons = !!(hud && hud.inIrons);
    ironsT = irons ? ironsT + dt : 0;
    { const hh = TW.state.heart; setCls('hush', root, 'twui-hush', !!hh && hh.hush > 0.05); }   // the held breath before the Heartlight: nothing on screen but the picture
    setCls('irons', E.mkWind, 'twui-irons', irons);
    setCls('ironsTip', E.irons, 'twui-on', ironsT > 1.1);
    const tg = hud && hud.target;
    const tgOk = !!(tg && isNum(tg.bearing));
    setCls('tgHide', E.mkTgt, 'twui-hide', !tgOk);
    setCls('tgTxtHide', E.tgt, 'twui-hide', !tgOk);
    if (tgOk) {
      setMarker('mt', E.mkTgt, mod((Math.PI - tg.bearing) * DEG, 360), deg);
      setTxt('tgN', E.tgtN, tg.name ? String(tg.name) : 'Baliz');
      if (isNum(tg.dist)) { const dq = tg.dist < 100 ? Math.round(tg.dist / 5) * 5 : Math.round(tg.dist / 10) * 10; if (L.tgD !== dq) { L.tgD = dq; E.tgtD.textContent = dq >= 1000 ? Math.floor(dq / 1000) + ' ' + ('00' + (dq % 1000)).slice(-3) + ' m' : dq + ' m'; } }
      else setTxt('tgDx', E.tgtD, '');
    }
    // beacons --------------------------------------------------------------
    ensurePips(hud);
    let lit = 0;
    for (let k = 0; k < pips.length; k++) {
      const on = isKindled(pipOrder[k]); if (on) lit++;
      if (on !== pipLit[k]) {
        pipLit[k] = on; pips[k].classList.toggle('twui-lit', on);
        if (on && pipsPrimed) { const n = pips[k]; n.classList.remove('twui-flare'); void n.getBoundingClientRect(); n.classList.add('twui-flare'); }
      }
    }
    pipsPrimed = true;
    if (L.litN !== lit) { L.litN = lit; E.pips.setAttribute('aria-label', lit + ' limyè ka limé asi ' + pips.length); }
    setCls('pipsHide', E.pips, 'twui-hide', pips.length === 0);
    const obj = phase !== 'free' && hud && hud.objective ? String(hud.objective) : '';
    setTxt('obj', E.obj, obj);
    // gauges ---------------------------------------------------------------
    const oil = hud && isNum(hud.oil) ? hud.oil : (S.lantern && isNum(S.lantern.oil) ? S.lantern.oil : NaN);
    const oilOk = isNum(oil);
    setCls('oilHide', E.gOil, 'twui-hide', !oilOk);
    if (oilOk) {
      const oq = Math.round(TW.saturate(oil) * 50);
      if (L.oil !== oq) { L.oil = oq; const f = oq / 50; E.oilRect.style.transform = 'scaleY(' + f.toFixed(3) + ')'; E.oilFlame.style.transform = 'scale(' + (f <= 0 ? 0 : 0.45 + 0.55 * f).toFixed(3) + ')'; }
      setCls('oilLow', E.gOil, 'twui-g--low', oil < 0.2);
    }
    const hull = hud && isNum(hud.hull) ? hud.hull : (isNum(S.boat.hull) ? S.boat.hull : NaN);
    const hullOk = isNum(hull);
    setCls('hullHide', E.gHull, 'twui-hide', !hullOk);
    if (hullOk) {
      const hq = Math.round(TW.saturate(hull) * 50);
      if (L.hull !== hq) { L.hull = hq; E.hullBar.style.transform = 'scaleX(' + (hq / 50).toFixed(3) + ')'; }
      setCls('hullLow', E.gHull, 'twui-g--low', hull < 0.34);
    }
    const spd = hud && isNum(hud.speed) ? hud.speed : (isNum(S.boat.speed) ? S.boat.speed : NaN);
    const spdOk = isNum(spd);
    setCls('spdHide', E.gSpd, 'twui-hide', !spdOk);
    if (spdOk) { const kq = Math.round(Math.abs(spd) * 19.44); if (L.spd !== kq) { L.spd = kq; E.spd.textContent = (kq / 10).toFixed(1); } }
    const sail = hud && isNum(hud.sail) ? hud.sail : (isNum(S.boat.sail) ? S.boat.sail : NaN);
    const sailOk = isNum(sail);
    setCls('sailHide', E.gSail, 'twui-hide', !sailOk);
    if (sailOk) { const sq = Math.round(TW.saturate(sail) * 20); if (L.sail !== sq) { L.sail = sq; const v = 'inset(' + (88 - sq * 4.2).toFixed(1) + '% 0 0 0)'; E.sailFill.style.clipPath = v; E.sailFill.style.webkitClipPath = v; } }
    // kindling ---------------------------------------------------------------
    const ring = hud && hud.ring;
    const ringOn = !!ring && (phase === 'sailing' || phase === 'free');
    setCls('kOn', E.kindle, 'twui-on', ringOn);
    const inRing = !!(ring && ring.inRing);
    if (ring) {
      setCls('kIn', E.kindle, 'twui-in', inRing);
      setCls('kFar', E.kindle, 'twui-far', !inRing);
      const mode = (inRing ? 1 : 0) + (touchMode ? 2 : 0);
      if (L.kindleTxt !== mode) { L.kindleTxt = mode; E.kindleTxt.innerHTML = inRing ? (touchMode ? 'Kenbé bouton <b style="font-weight:400;color:var(--tw-ember)">Limé</b> pou voyé flanm-la anlè' : 'Kenbé <kbd class="twui-key">Space</kbd> pou limé flanm-la') : 'Mété bato-la adan sèk boué-yo'; }
    }
    const pq = ring && isNum(ring.progress) ? Math.round(TW.saturate(ring.progress) * 100) : 0;
    if (L.kp !== pq) { L.kp = pq; const off = (128.81 * (1 - pq / 100)).toFixed(2); E.kindleFg.style.strokeDashoffset = off; E.kbtnFg.style.strokeDashoffset = off; }
    setCls('kReady', E.kbtn, 'twui-ready', inRing);
  }

  function updateOverlays(hud, dt, playing) {
    const danger = hud && isNum(hud.danger) && playing ? TW.saturate(hud.danger) : 0;
    const vq = Math.round(danger * 40);
    if (L.vig !== vq) { L.vig = vq; E.vig.style.opacity = (vq / 40 * 0.9).toFixed(3); }
    if (flash > 0) flash = Math.max(0, flash - dt * 1.9);
    const fq = Math.round(flash * 30);
    if (L.flash !== fq) { L.flash = fq; E.flash.style.opacity = (fq / 30).toFixed(3); }
    const fade = hud && isNum(hud.fade) ? TW.saturate(hud.fade) : 0;
    const bq = Math.round(fade * 60);
    if (L.fade !== bq) { L.fade = bq; E.fade.style.opacity = (bq / 60).toFixed(3); }
    if (fadeMsgOn) {
      fadeMsgT -= dt;
      if (fadeMsgT <= 0) { fadeMsgOn = false; E.fadeTxt.classList.remove('twui-on'); }
    }
  }
  function showFadeMsg(text, secs) {
    E.fadeTxt.textContent = text; fadeMsgOn = true; fadeMsgT = secs; E.fadeTxt.classList.add('twui-on');
  }
  function updateQueues(dt) {
    // hints: one at a time, ~5 s each
    if (hintState === 0) {
      if (hints.length) { E.hint.textContent = hints.shift(); E.hint.classList.add('twui-on'); hintState = 1; hintT = 5.2; }
    } else {
      hintT -= dt;
      if (hintT <= 0) {
        if (hintState === 1) { E.hint.classList.remove('twui-on'); hintState = 2; hintT = 1.2; } else hintState = 0;
      }
    }
    // beacon banners
    if (bannerState === 0) {
      if (banners.length && banners[0].delay > 0) { banners[0].delay -= dt; }
      else if (banners.length) { const b = banners.shift(); E.bannerName.textContent = b.name; E.bannerSub.textContent = b.sub; E.banner.classList.add('twui-on'); root.classList.add('twui-bannering'); bannerState = 1; bannerT = b.secs || 5.5; bannerLit = !!b.lit; bannerAge = 0; }
    } else {
      bannerT -= dt; bannerAge += dt;
      if (bannerT <= 0) {
        if (bannerState === 1) { E.banner.classList.remove('twui-on'); root.classList.remove('twui-bannering'); bannerState = 2; bannerT = 1.7; } else bannerState = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Phase transitions
  // ---------------------------------------------------------------------------
  function setPhase(phase) {
    const prev = lastPhase; lastPhase = phase;
    const playing = phase === 'sailing' || phase === 'free';
    if (demo && playing) demo.prev = phase;
    root.classList.toggle('twui-play', playing);
    root.setAttribute('data-phase', phase);
    E.title.classList.toggle('twui-off', phase !== 'title');
    E.hud.classList.toggle('twui-on', playing || phase === 'paused' || phase === 'ending');
    E.hud.classList.toggle('twui-leaving', phase === 'ending');
    E.pause.classList.toggle('twui-on', phase === 'paused');
    root.classList.toggle('twui-quiet', phase === 'paused');
    if (phase === 'paused') { E.pause.classList.remove('twui-confirming'); try { E.resumeBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    else if (prev === 'paused') focusGame();
    if (phase === 'ending') { if (!endActive) { endActive = true; endT = 0; endShown = false; } }
    else if (phase !== 'paused') { endActive = false; endShown = false; E.end.classList.remove('twui-on'); }
    if (!playing) { toggleChart(false); resetTouch(); }
    else if (touchMode && E.stickRest && stick.id === null) E.stickRest();
    if (phase === 'title') resetRun();
    L.obj = undefined;
  }

  // ---------------------------------------------------------------------------
  // Demo fabrication (?uidemo=…) — never touches TW.state
  // ---------------------------------------------------------------------------
  function makeDemoWorld() {
    const isl = [
      { name: 'Grande-Terre', x: -640, z: -520, r: 175 }, { name: 'La Désirade', x: 560, z: -660, r: 215 }, { name: 'Marie-Galante', x: 880, z: 230, r: 150 },
      { name: 'Terre-de-Haut', x: -900, z: 330, r: 140 }, { name: 'Terre-de-Bas', x: -170, z: 840, r: 195 }, { name: 'Basse-Terre', x: 70, z: -70, r: 125 }];
    const bn = ['Pointe des Châteaux — Saint-François', 'Pointe Doublé — La Désirade', 'Grand-Bourg — Marie-Galante', 'Bourg des Saintes — Terre-de-Haut', 'Terre-de-Bas — Les Saintes', 'Vieux-Fort — Basse-Terre'];
    const heightAt = (x, z) => {
      let best = -95;
      for (let i = 0; i < isl.length; i++) {
        const I = isl[i], d = Math.hypot(x - I.x, z - I.z) / I.r; if (d > 2.6) continue;
        const n = TW.fbm2(x * 0.007 + i * 9.1, z * 0.007 - i * 4.3, 4, 31 + i), v = 1 - d * (0.62 + 0.8 * n);
        const hh = v > 0 ? v * 85 * (0.5 + n) : v * 46;
        if (hh > best) best = hh;
      }
      return best;
    };
    const rnd = TW.rng(99), rocks = [];
    for (let i = 0; i < 46; i++) { const a = rnd() * TAU, r = 200 + rnd() * 1000; rocks.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, r: 6, h: 8 }); }
    return {
      heightAt, islands: isl, rocks, vortex: { x: 250, z: 150, r: 105 },
      beacons: isl.map((I, i) => { const a = i * 1.9 + 0.6; return { id: i, name: bn[i], x: I.x + Math.sin(a) * I.r * 0.42, z: I.z + Math.cos(a) * I.r * 0.42, dock: { x: I.x + Math.sin(a) * I.r * 1.05, z: I.z + Math.cos(a) * I.r * 1.05, r: 30 }, isHeart: i === 5 }; }),
    };
  }
  function initDemo(name) {
    const map = { title: 'title', hud: 'sailing', kindle: 'sailing', chart: 'sailing', pause: 'paused', lanternout: 'sailing', ending: 'ending', free: 'free' };
    demo = { name, phase: map[name] || 'sailing', prev: 'sailing', kindled: [true, true, true, false, false, false], fired: false, fireAt: 0.3, map, ci: -1 };
    if (name === 'cycle') { demo.cycle = TW.qs('states', 'hud,kindle,chart,pause,lanternout,ending').split(','); demo.step = TW.qf('step', 4000); demo.t0 = performance.now(); demo.name = demo.cycle[0]; demo.phase = map[demo.name] || 'sailing'; }
    if (!TW.world || TW.world.stub) demoWorld = makeDemoWorld();
  }
  function demoTick() {
    const g = game(); if (!g) return;
    if (demo.cycle) {   // debug only: step through screens on wall time so one headless run can capture them all
      const ci = Math.min(demo.cycle.length - 1, Math.floor((performance.now() - demo.t0) / demo.step));
      if (ci !== demo.ci) { if (demo.ci >= 0) resetRun(); demo.ci = ci; demo.name = demo.cycle[ci]; demo.phase = demo.map[demo.name] || 'sailing'; demo.fired = false; demo.fireAt = clock + 0.05; demo.kindled = [true, true, true, false, false, false]; }
    }
    const S = TW.state, W = world(), n = demo.name;
    const hud = g.hud || (g.hud = {});
    if (!g.stats) g.stats = { time: 641, floats: 7, floatsTotal: 12, knocks: 3, respawns: 1, distance: 5120 };
    const tb = W.beacons[3] || W.beacons[0], dx = tb.dock.x - S.boat.x, dz = tb.dock.z - S.boat.z;
    hud.oil = n === 'lanternout' ? 0.04 : n === 'kindle' ? 0.16 : 0.62; hud.hull = n === 'kindle' ? 0.3 : 0.82;
    hud.speed = S.boat.speed; hud.sail = 0.75; hud.heading = S.boat.heading;
    hud.windAngle = Math.atan2(S.wind.dirX, S.wind.dirZ); hud.windSpeed = S.wind.speed;
    hud.inIrons = n === 'hud' && TW.q.has('irons'); hud.pointOfSail = 'beam';
    hud.target = { index: 3, name: tb.name, dist: n === 'kindle' ? 24 : Math.hypot(dx, dz), bearing: n === 'hud' ? S.boat.heading + 0.42 : Math.atan2(dx, dz), isHeart: false };
    hud.ring = n === 'kindle' || n === 'ring' ? { index: 3, inRing: true, progress: 0.64 } : null;
    hud.objective = n === 'free' ? '' : 'Twa limyè ka limé. Pòté flanm-la jis koté Terre-de-Haut.';
    hud.lit = 3; hud.total = 6; hud.heartOpen = false;
    hud.danger = n === 'lanternout' ? 0.9 : n === 'kindle' ? 0.5 : 0.08; hud.fade = n === 'lanternout' ? 0.94 : 0;
    if (!demo.fired && clock > demo.fireAt) {
      demo.fired = true;
      if (n === 'hud' || n === 'ring') TW.emit('hint', { text: 'Vè-tanpèt ka floté toujou é ni on ti luil adan yo. Dirijé bato-la dèyè limyè a-yo.' });
      if (n === 'kindle') { demo.kindled[3] = true; TW.emit('beaconLit', { index: 3, count: 4, total: 6, isHeart: false }); }
      if (n === 'lanternout') TW.emit('lanternOut');
      if (n === 'chart') toggleChart(true);
      if (n === 'ending') { endActive = true; endT = 12; }
    }
  }

  // ---------------------------------------------------------------------------
  // init / update
  // ---------------------------------------------------------------------------
  function init() {
    if (built) return;
    const host = document.getElementById('tw-ui');
    if (!host) return;
    const dn = TW.qs ? TW.qs('uidemo', '') : '';
    if (dn) initDemo(dn);
    const style = document.createElement('style');
    style.setAttribute('data-twui', ''); style.textContent = CSS + '\n.twui-sponsor-row{display:flex;align-items:center;gap:.55em;margin:0;pointer-events:none}.twui-sponsor-title,.twui-sponsor-championship{width:64px;height:25px;padding:2px 5px;border:1px solid rgba(233,239,230,.18);background:rgba(10,17,24,.58)}.twui-sponsor-hud{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));left:auto;z-index:6;width:64px;height:25px;padding:2px 5px;background:rgba(10,17,24,.58);border:1px solid rgba(233,239,230,.18);opacity:.82;pointer-events:none}.twui-sponsor-racepanel{width:46px;height:18px;margin-left:auto;opacity:.82}.twui-sponsor-leaderboard{display:flex;width:58px;height:18px;margin:3px auto 0;opacity:.75}.twui-sponsor-chart{position:absolute;left:14px;right:auto;top:14px;z-index:4;width:70px;height:26px;padding:2px 5px;background:rgba(10,17,24,.62);border:1px solid rgba(233,239,230,.2);pointer-events:none}.twui-sponsor-pause{width:72px;height:28px;margin:12px auto 0;opacity:.85}.twui-sponsor-title img,.twui-sponsor-title canvas,.twui-sponsor-championship img,.twui-sponsor-championship canvas,.twui-sponsor-hud img,.twui-sponsor-hud canvas,.twui-sponsor-chart img,.twui-sponsor-chart canvas{max-width:100%;max-height:100%;object-fit:contain}@media (max-width:899px),(max-height:519px){.twui-root .twui-sponsor-hud{right:max(12px,env(safe-area-inset-right));bottom:calc(90px + env(safe-area-inset-bottom))}}';
    document.head.appendChild(style);
    root = el('div', 'twui-root');
    try { muted = localStorage.getItem('tidewright.muted') === '1'; } catch (e) { muted = false; }
    if (TW.audio && TW.audio.muted) muted = true;
    const pp = postParams();
    if (pp && isNum(pp.painterly)) { painterlyOn = pp.painterly > 0; painterlyVal = pp.painterly > 0 ? pp.painterly : 1; }

    E.vig = el('div', 'twui-vig'); E.flash = el('div', 'twui-flash');
    root.appendChild(E.vig); root.appendChild(E.flash);
    root.appendChild(buildHud());
    buildTouch(root);
    E.fade = el('div', 'twui-fade'); root.appendChild(E.fade);
    root.appendChild(E.banner);
    E.fadeTxt = el('div', 'twui-fadetxt'); E.fadeTxt.setAttribute('role', 'status'); root.appendChild(E.fadeTxt);
    root.appendChild(buildTitle());
    root.appendChild(buildChart());
    root.appendChild(buildEnding());
    root.appendChild(buildPause());
    host.appendChild(root);
    built = true;

    let coarse = false;
    try { coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { /* ignore */ }
    setTouchMode(!!TW.isTouch || coarse || (TW.q && TW.q.has('uitouch')));
    syncToggles();
    if (muted) { try { if (TW.audio && TW.audio.setMuted) TW.audio.setMuted(true); } catch (e) { /* ignore */ } }

    // ---- game events ------------------------------------------------------
    TW.on('hint', (d) => { const t = d && d.text ? String(d.text) : ''; if (t && hints.indexOf(t) < 0 && !(hintState === 1 && E.hint.textContent === t)) { if (hints.length >= 4) hints.shift(); hints.push(t); } if (hintState === 1 && hintT > 1.5) hintT = 1.5; });
    TW.on('gust', () => { if (TW.state && TW.state.phase === 'sailing') showNavCue('RAFALE · VENT RENFORCÉ', 'alert'); });
    TW.on('sailing:maneuver', (d) => { if (TW.state && TW.state.phase === 'sailing') showNavCue(d && d.kind === 'gybe' ? 'EMPANNAGE' : 'VIREMENT DE BORD', 'sail'); });
    TW.on('race:checkpoint', (d) => {
      if (!d || d.id !== 'player' || !E.raceNotice) return;
      const gate = d.checkpoint === 'finish' ? 'ARRIVÉE' : String(d.checkpoint || 'PORTE').replace(/[-_]/g, ' ').toUpperCase();
      E.raceNotice.textContent = (d.checkpoint === 'finish' ? 'RÉGATE TERMINÉE' : 'PORTE VALIDÉE · ' + gate) + ' · ' + raceClock(d.time);
      E.raceNotice.classList.remove('twui-racenotice--show');
      void E.raceNotice.offsetWidth;
      E.raceNotice.classList.add('twui-racenotice--show');
    });
    TW.on('beaconLit', (d) => {
      d = d || {};
      const W = world(), b = W && W.beacons && W.beacons[d.index];
      const name = (b && b.name) || (d.isHeart ? 'Limyè-Kè-la' : 'Baliz-la');
      const sub = d.isHeart ? 'ka limé — é Gwo Van-la ka kase' : 'ka limé ankò' + (isNum(d.count) && isNum(d.total) ? '  ·  ' + d.count + ' asi ' + d.total : '');
      const nb = { name, sub, secs: d.isHeart ? 7 : 5.5, lit: true, delay: d.isHeart ? 7.0 : 4.2 };   // let the ignition play before any lettering
      root.classList.add('twui-bannering');
      for (let i = banners.length - 1; i >= 0; i--) if (banners[i].lit) banners.splice(i, 1);   // a burst of lightings shows only the latest
      if (bannerState === 1 && bannerLit && bannerAge < 0.75) { E.bannerName.textContent = name; E.bannerSub.textContent = sub; bannerT = nb.secs; bannerAge = 0; }
      else banners.push(nb);
    });
    TW.on('heartOpen', () => banners.push({ name: 'Senk limyè ka limé', sub: 'Limyè-Kè-la ké pran flanm-la.', secs: 6.5 }));
    TW.on('bump', (d) => { const s = d && isNum(d.strength) ? d.strength : 0.5; flash = Math.max(flash, 0.3 + 0.7 * TW.saturate(s)); });
    TW.on('lanternOut', () => showFadeMsg('Flanm-la ka fébli. Fènwa-la ka pran kontwòl…', 14));
    TW.on('wreck', () => showFadeMsg('Lanmè-la ka pran ti bato-la…', 14));
    TW.on('respawn', () => showFadeMsg('…ou ka lévé anba on limyè ka limé.', 3.6));
    TW.on('ending', () => { endActive = true; endT = 0; endShown = false; toggleChart(false); });
    TW.on('restart', resetRun);
    TW.on('resize', () => { chart.dirty = true; if (touchMode && E.stickRest && stick.id === null) E.stickRest(); });

    // ---- input --------------------------------------------------------------
    let gestured = false;
    const firstGesture = () => { if (gestured) return; gestured = true; audioStart(); };
    window.addEventListener('pointerdown', (ev) => {
      firstGesture();
      if (ev.pointerType === 'touch' && !touchMode) setTouchMode(true);
    }, true);
    window.addEventListener('keydown', (ev) => {
      firstGesture();
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const code = ev.code, a = document.activeElement, onBtn = !!(a && root.contains(a) && a.tagName === 'BUTTON');
      if (touchMode && !TW.isTouch && /^(Key[WASD]|Arrow)/.test(code)) setTouchMode(false);
      if (code === 'KeyM') { if (!ev.repeat) { setMuted(!muted); click(); } return; }
      if (code === 'KeyC') { if (!ev.repeat) { toggleChart(); click(); } return; }
      if (code === 'Escape' && chart.open) { toggleChart(false); ev.stopPropagation(); ev.preventDefault(); return; }
      if (code === 'Escape' && E.pause.classList.contains('twui-confirming')) { E.pause.classList.remove('twui-confirming'); ev.stopPropagation(); ev.preventDefault(); return; }
      if (lastPhase === 'title' && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) {
        if (onBtn && a !== E.startBtn) return;       // let a focused toggle act natively
        ev.preventDefault(); if (!ev.repeat) { click(); doStart(); }
      }
    }, true);
    window.addEventListener('blur', () => resetTouch());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') resetTouch(); });
  }

  function update(dt) {
    if (!built) return;
    const S = TW.state;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    clock += dt;
    if (demo) demoTick();
    const phase = demo ? demo.phase : S.phase;
    if (phase !== lastPhase) setPhase(phase);
    const g = game(), hud = (g && g.hud) || null;
    const playing = phase === 'sailing' || phase === 'free';
    if (phase !== 'title') updateHud(hud, S, phase, dt);
    updateOverlays(hud, dt, playing || phase === 'paused');
    if (phase !== 'title') updateQueues(dt);
    if (endActive && phase === 'ending') {
      endT += dt;
      if (!endShown && endT >= 12) { endShown = true; fillStats(); E.end.classList.add('twui-on'); }
    }
    if (chart.open && (chart.dirty || (S.frame & 3) === 0)) drawChart();
    if (!playing) { const t = g && g.touch; if (stick.id !== null || kindleId !== null || (t && (t.steer || t.trim || t.kindle))) resetTouch(); }
  }

  TW.ui = { init, update, openChart: () => toggleChart(true), closeChart: () => toggleChart(false) };
  // debug only (with ?uidemo=…): jump straight to a demo screen / force touch layout from a test harness
  TW.ui.demoSet = (name, touch) => {
    if (!demo || !built) return false;
    resetRun(); demo.cycle = null; demo.name = name; demo.phase = demo.map[name] || 'sailing'; demo.fired = false; demo.fireAt = clock; demo.kindled = [true, true, true, false, false, false];
    if (touch !== undefined) setTouchMode(!!touch);
    return true;
  };
})();
