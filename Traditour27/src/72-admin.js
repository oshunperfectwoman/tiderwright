// ===== 72-admin.js =====
// In-game tuning panel. F2 toggles it; weather/wind/sea apply immediately.
(function () {
  'use strict';
  const TW = window.TW, S = TW.settings, DEG = Math.PI / 180;
  let panel = null;
  const css = `#tw-admin{position:fixed;z-index:280;top:14px;right:14px;width:min(380px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:16px 17px 14px;background:rgba(8,17,24,.94);color:#e9efe6;border:1px solid rgba(255,180,90,.5);box-shadow:0 10px 40px rgba(0,0,0,.5);font:12px/1.35 system-ui,sans-serif;letter-spacing:.02em;backdrop-filter:blur(10px);display:none}#tw-admin.tw-open{display:block}#tw-admin h2{margin:0 0 3px;color:#ffb45a;font:600 16px/1.2 Georgia,serif;letter-spacing:.08em;text-transform:uppercase}#tw-admin .tw-admin-sub{margin:0 0 12px;color:#a8bbb6;font-size:11px}#tw-admin .tw-admin-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0 8px}#tw-admin .tw-admin-tab{border:1px solid rgba(168,187,182,.3);background:rgba(32,51,58,.7);color:#a8bbb6;padding:6px 8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}#tw-admin .tw-admin-tab:hover,#tw-admin .tw-admin-tab.tw-on{border-color:rgba(255,180,90,.75);background:#304952;color:#ffe0ae}#tw-admin fieldset{margin:10px 0 0;padding:9px 10px 7px;border:1px solid rgba(168,187,182,.25)}#tw-admin legend{padding:0 5px;color:#ffb45a;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:10px}#tw-admin label{display:grid;grid-template-columns:1fr 76px;gap:7px;align-items:center;margin:7px 0}#tw-admin label span{color:#d9e2d9}#tw-admin output{color:#ffcf8a;text-align:right;font-variant-numeric:tabular-nums}#tw-admin input[type=range]{grid-column:1/-1;width:100%;accent-color:#ffb45a}#tw-admin .tw-admin-note{color:#a8bbb6;font-size:10px;margin:7px 0 2px}#tw-admin .tw-admin-crew{border-color:rgba(255,180,90,.32)}#tw-admin .tw-admin-crew legend{color:#ffe0ae}#tw-admin button{border:1px solid rgba(255,180,90,.65);background:#20333a;color:#ffe0ae;padding:7px 9px;cursor:pointer}#tw-admin button:hover{background:#304952}#tw-admin .tw-admin-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}#tw-admin .tw-admin-close{float:right;background:transparent;border:0;font-size:18px;padding:0;color:#a8bbb6}#tw-admin .tw-admin-badge{position:fixed;z-index:89;top:14px;right:14px;padding:5px 8px;border:1px solid rgba(255,180,90,.42);background:rgba(8,17,24,.72);color:#ffcf8a;font:10px system-ui,sans-serif;letter-spacing:.12em;cursor:pointer}`;
  const el=(tag,attrs,text)=>{const e=document.createElement(tag);Object.keys(attrs||{}).forEach(k=>e.setAttribute(k,attrs[k]));if(text!==undefined)e.textContent=text;return e;};
  const pct=v=>Math.round(v*100)+'%'; const deg=v=>v.toFixed(0)+'°';
  function range(parent,id,label,min,max,step,get,set,fmt){const row=el('label'),name=el('span',{},label),out=el('output',{for:id}),input=el('input',{id,type:'range',min,max,step,value:get()});const render=()=>{const v=parseFloat(input.value);out.value=fmt?fmt(v):String(v);};input.addEventListener('input',()=>{const v=parseFloat(input.value);set(v);render();});row.append(name,out,input);parent.appendChild(row);render();}
  function crewMembers(){
    if (!S.navigation.crew) S.navigation.crew={members:[]};
    if (!Array.isArray(S.navigation.crew.members)) S.navigation.crew.members=[];
    const defaults=[{x:.46,z:.12,scale:.90},{x:-.46,z:.12,scale:.90},{x:0,z:.56,scale:.86}];
    defaults.forEach((d,i)=>{if(!S.navigation.crew.members[i]) S.navigation.crew.members[i]=Object.assign({},d);});
    return S.navigation.crew.members;
  }
  const sponsorCss=`#tw-admin .tw-sponsor-grid{display:grid;grid-template-columns:minmax(100px,.75fr) minmax(160px,1.25fr);gap:10px}#tw-admin .tw-sponsor-list{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto}#tw-admin .tw-sponsor-item{width:100%;text-align:left;font-size:11px}#tw-admin .tw-sponsor-item.tw-on{border-color:#ffb45a;background:#304952;color:#ffe0ae}#tw-admin .tw-sponsor-form label{grid-template-columns:1fr;gap:4px}#tw-admin .tw-sponsor-form input[type=text],#tw-admin .tw-sponsor-form select{box-sizing:border-box;width:100%;padding:6px;background:#12242c;color:#e9efe6;border:1px solid rgba(168,187,182,.35)}#tw-admin .tw-sponsor-form input[type=color]{width:42px;height:28px;padding:1px;background:#12242c;border:0}#tw-admin .tw-sponsor-preview{display:grid;place-items:center;min-height:82px;margin:6px 0;padding:5px;background:rgba(0,0,0,.22);border:1px dashed rgba(168,187,182,.3)}#tw-admin .tw-sponsor-preview img,#tw-admin .tw-sponsor-preview canvas{display:block;max-width:100%;max-height:112px;object-fit:contain}#tw-admin .tw-sponsor-status{min-height:1.5em;color:#a8bbb6;font-size:10px}#tw-admin .tw-sponsor-status.tw-error{color:#ff9d8b}#tw-admin .tw-sponsor-placement{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,1fr);gap:4px 8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(168,187,182,.12)}#tw-admin .tw-sponsor-placement small{grid-column:1/-1;color:#91a5a1;font-size:9px}#tw-admin .tw-sponsor-placement select{min-width:0;padding:5px;background:#12242c;color:#e9efe6;border:1px solid rgba(168,187,182,.3);font-size:10px}#tw-admin .tw-sponsor-state{font-size:9px;color:#a8bbb6;text-align:right}#tw-admin .tw-sponsor-state.tw-connected{color:#82d6a8}#tw-admin .tw-sponsor-state.tw-disabled{color:#ffcf8a}#tw-admin .tw-sponsor-tools{display:flex;gap:5px;flex-wrap:wrap}#tw-admin .tw-sponsor-tools button{font-size:10px;padding:6px}#tw-admin .tw-sponsor-new{display:flex;gap:4px;margin-top:8px}#tw-admin .tw-sponsor-new input{min-width:0;flex:1;padding:5px;background:#12242c;color:#e9efe6;border:1px solid rgba(168,187,182,.35)}`;
  let sponsorSnapshot=null, sponsorSelected=null, sponsorStageId='E1', sponsorStageSelect=null, sponsorRoot=null, sponsorStatusNode=null, sponsorListNode=null, sponsorFormNode=null, sponsorPlacementsNode=null, sponsorStatusText='', sponsorStatusError=false, previewUrl=null, previewRevision=0;
  function sponsorMessage(text,error){sponsorStatusText=text||'';sponsorStatusError=!!error;if(sponsorStatusNode){sponsorStatusNode.textContent=sponsorStatusText;sponsorStatusNode.classList.toggle('tw-error',sponsorStatusError);}}
  function raceStages(){return Array.isArray(TW.races)&&TW.races.length?TW.races.filter(r=>r&&typeof r.id==='string'):[];}
  function sponsorPane(){
    const root=el('section',{class:'tw-admin-pane'});sponsorRoot=root;
    root.appendChild(el('p',{class:'tw-admin-note'},'Les logos et affectations sont conservés dans IndexedDB, indépendamment des réglages de navigation. PNG, JPEG et WebP · 4 Mo max · 4096 × 4096 px max.'));
    const stageLabel=el('label');stageLabel.appendChild(el('span',{},'Étape du championnat'));
    sponsorStageSelect=el('select',{ 'aria-label':'Étape du championnat' });
    const stages=raceStages();
    stages.forEach((stage)=>sponsorStageSelect.appendChild(el('option',{value:stage.id},(stage.id+' · '+(stage.title||stage.route||stage.id)) )));
    if(!stages.some((stage)=>stage.id===sponsorStageId)) sponsorStageId=stages[0]?stages[0].id:'E1';
    sponsorStageSelect.value=sponsorStageId;
    sponsorStageSelect.addEventListener('change',()=>{sponsorStageId=sponsorStageSelect.value||'E1';renderSponsorPane();});
    stageLabel.appendChild(sponsorStageSelect);root.appendChild(stageLabel);
    const grid=el('div',{class:'tw-sponsor-grid'}),left=el('div'),right=el('div',{class:'tw-sponsor-form'});
    sponsorListNode=el('div',{class:'tw-sponsor-list'});left.appendChild(sponsorListNode);
    const newRow=el('div',{class:'tw-sponsor-new'}),newName=el('input',{type:'text',maxlength:'80',placeholder:'Nouveau sponsor','aria-label':'Nom du nouveau sponsor'}),newBtn=el('button',{type:'button'},'Créer');
    newBtn.addEventListener('click',()=>{try{const s=TW.sponsors.createSponsor(newName.value);sponsorSelected=s.id;newName.value='';sponsorMessage('Fiche créée — enregistrez pour la conserver.');renderSponsorPane();}catch(e){sponsorMessage(e.message,true);}});newRow.append(newName,newBtn);left.appendChild(newRow);
    sponsorFormNode=right;
    grid.append(left,right);root.appendChild(grid);
    root.appendChild(el('h3',{},'Emplacements disponibles'));
    root.appendChild(el('p',{class:'tw-admin-note'},'« Intégré » signifie raccordé au rendu réel. Les emplacements déclarés restent désactivés côté rendu tant que leur intégration n’est pas terminée.'));
    sponsorPlacementsNode=el('div');root.appendChild(sponsorPlacementsNode);
    sponsorStatusNode=el('div',{class:'tw-sponsor-status','aria-live':'polite'});root.appendChild(sponsorStatusNode);
    const actions=el('div',{class:'tw-sponsor-tools'}),save=el('button',{type:'button'},'Enregistrer'),cancel=el('button',{type:'button'},'Annuler'),reset=el('button',{type:'button'},'Réaffecter démos'),exportBtn=el('button',{type:'button'},'Exporter'),importBtn=el('button',{type:'button'},'Restaurer');
    const restoreInput=el('input',{type:'file',accept:'application/json,.json','aria-label':'Fichier de sauvegarde sponsoring'});restoreInput.hidden=true;
    save.addEventListener('click',async()=>{try{await TW.sponsors.ready;await TW.sponsors.save();sponsorSnapshot=TW.sponsors.snapshot();sponsorMessage('Sponsoring enregistré dans IndexedDB.');}catch(e){sponsorMessage(e.message||'Échec de la sauvegarde.',true);}});
    cancel.addEventListener('click',()=>{if(!sponsorSnapshot)return;TW.sponsors.restore(sponsorSnapshot);sponsorMessage('Modifications non enregistrées annulées.');});
    reset.addEventListener('click',async()=>{if(!window.confirm('Réaffecter les voiles aux sponsors de démonstration ? Les autres sponsors enregistrés seront conservés.'))return;try{TW.sponsors.resetDemo();await TW.sponsors.save();sponsorSnapshot=TW.sponsors.snapshot();sponsorMessage('Affectations de démonstration rétablies.');}catch(e){sponsorMessage(e.message||'Échec de la réinitialisation.',true);}});
    exportBtn.addEventListener('click',async()=>{try{const text=await TW.sponsors.exportData(),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='traditour-sponsors.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);sponsorMessage('Sauvegarde exportée avec les logos.');}catch(e){sponsorMessage(e.message||'Export impossible.',true);}});
    importBtn.addEventListener('click',()=>restoreInput.click());
    restoreInput.addEventListener('change',async()=>{const f=restoreInput.files&&restoreInput.files[0];restoreInput.value='';if(!f)return;try{await TW.sponsors.importData(await f.text());sponsorSelected=null;sponsorMessage('Sauvegarde chargée en mémoire — cliquez sur Enregistrer pour la conserver.');}catch(e){sponsorMessage(e.message||'Restauration impossible.',true);}});
    actions.append(save,cancel,reset,exportBtn,importBtn,restoreInput);root.appendChild(actions);
    TW.sponsors.onChange(()=>renderSponsorPane());
    TW.sponsors.ready.then(()=>{sponsorSnapshot=TW.sponsors.snapshot();renderSponsorPane();if(!TW.sponsors.storageAvailable)sponsorMessage('IndexedDB indisponible : les changements resteront temporaires. '+TW.sponsors.storageError,true);});
    return root;
  }
  async function showSponsorPreview(box,sponsor){
    const revision=++previewRevision;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}box.replaceChildren();
    if(!sponsor){box.appendChild(el('span',{class:'tw-admin-note'},'Choisissez un sponsor pour afficher son logo.'));return;}
    const preview=await TW.sponsors.getSponsorPreview(sponsor.id);if(revision!==previewRevision||!preview)return;
    if(preview.kind==='canvas'){box.appendChild(preview.source);return;}
    const url=URL.createObjectURL(preview.source);previewUrl=url;const img=el('img',{alt:'Aperçu du logo de '+sponsor.name,src:url});img.onload=()=>{URL.revokeObjectURL(url);if(previewUrl===url)previewUrl=null;};box.appendChild(img);
  }
  function renderSponsorPane(){
    if(!sponsorRoot||!TW.sponsors)return;
    const sponsors=TW.sponsors.getSponsors();if(!sponsorSelected||!sponsors.some((s)=>s.id===sponsorSelected))sponsorSelected=sponsors[0]?sponsors[0].id:null;
    sponsorListNode.replaceChildren();sponsors.forEach((s)=>{const b=el('button',{type:'button',class:'tw-sponsor-item'+(s.id===sponsorSelected?' tw-on':'')},s.name);b.addEventListener('click',()=>{sponsorSelected=s.id;renderSponsorPane();});sponsorListNode.appendChild(b);});
    sponsorFormNode.replaceChildren();const selected=sponsors.find((s)=>s.id===sponsorSelected)||null;
    if(selected){
      const nameLabel=el('label'),nameCaption=el('span',{},'Nom du sponsor'),nameInput=el('input',{type:'text',maxlength:'80',value:selected.name});nameLabel.append(nameCaption,nameInput);nameInput.addEventListener('change',()=>{try{TW.sponsors.updateSponsor(selected.id,{name:nameInput.value});sponsorMessage('Fiche modifiée — enregistrez pour conserver.');}catch(e){nameInput.value=selected.name;sponsorMessage(e.message,true);}});sponsorFormNode.appendChild(nameLabel);
      const colorLabel=el('label'),colorCaption=el('span',{},'Couleur principale (facultative)'),colorInput=el('input',{type:'color',value:/^#[0-9a-f]{6}$/i.test(selected.color||'')?selected.color:'#ffffff'});colorLabel.append(colorCaption,colorInput);colorInput.addEventListener('change',()=>{TW.sponsors.updateSponsor(selected.id,{color:colorInput.value});sponsorMessage('Fiche modifiée — enregistrez pour conserver.');});sponsorFormNode.appendChild(colorLabel);
      const activeLabel=el('label'),active=el('input',{type:'checkbox'});active.checked=selected.active!==false;activeLabel.append(active,el('span',{},'Sponsor actif'));active.addEventListener('change',()=>{TW.sponsors.updateSponsor(selected.id,{active:active.checked});sponsorMessage('Fiche modifiée — enregistrez pour conserver.');});sponsorFormNode.appendChild(activeLabel);
      const fileLabel=el('label'),fileCaption=el('span',{},'Importer ou remplacer le logo'),file=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'});fileLabel.append(fileCaption,file);file.addEventListener('change',async()=>{const f=file.files&&file.files[0];file.value='';if(!f)return;try{await TW.sponsors.importLogo(selected.id,f);sponsorMessage('Logo importé — enregistrez pour le conserver.');}catch(e){sponsorMessage(e.message,true);}});sponsorFormNode.appendChild(fileLabel);
      const preview=el('div',{class:'tw-sponsor-preview'});sponsorFormNode.appendChild(preview);showSponsorPreview(preview,selected);
      const del=el('button',{type:'button'},'Supprimer ce sponsor');del.addEventListener('click',()=>{const assigned=TW.sponsors.getPlacements().filter((p)=>p.assignment&&p.assignment.sponsorId===selected.id);if(assigned.length&&!window.confirm('Ce sponsor est affecté à '+assigned.length+' emplacement(s). Supprimer la fiche et retirer ces affectations ?'))return;if(!assigned.length&&!window.confirm('Supprimer cette fiche sponsor ?'))return;TW.sponsors.deleteSponsor(selected.id);sponsorSelected=null;sponsorMessage('Sponsor supprimé — enregistrez pour conserver.');});sponsorFormNode.appendChild(del);
    }else sponsorFormNode.appendChild(el('p',{class:'tw-admin-note'},'Aucun sponsor enregistré. Créez une fiche ci-dessus.'));
    const placements=TW.sponsors.getPlacements(sponsorStageId),groups=new Map();placements.forEach((p)=>{if(!groups.has(p.category))groups.set(p.category,[]);groups.get(p.category).push(p);});sponsorPlacementsNode.replaceChildren();
    groups.forEach((items,category)=>{
      const field=el('fieldset');field.appendChild(el('legend',{},category));
      items.forEach((p)=>{
        const stageId=p.id.indexOf('stage_')===0?sponsorStageId:undefined,assigned=p.assignment&&sponsors.find((s)=>s.id===p.assignment.sponsorId),disabled=!!(p.assignment&&(p.assignment.active===false||!assigned||assigned.active===false));
        const statusText=!p.connected?'Déclaré · non raccordé':!p.assignment?'Intégré · opérationnel':disabled?'Intégré · sponsor désactivé':'Intégré · actif';
        const row=el('div',{class:'tw-sponsor-placement'}),title=el('span',{},p.name),state=el('span',{class:'tw-sponsor-state'+(p.connected?' tw-connected':'')+(disabled?' tw-disabled':'')},statusText),select=document.createElement('select');
        select.setAttribute('aria-label','Sponsor pour '+p.name);select.appendChild(el('option',{value:''},'Aucun sponsor'));
        sponsors.forEach((s)=>select.appendChild(el('option',{value:s.id},s.name+(s.active?'':' · inactif'))));select.value=p.assignment?p.assignment.sponsorId:'';
        select.addEventListener('change',()=>{try{TW.sponsors.assign(p.id,select.value||null,true,stageId);sponsorMessage('Affectation modifiée — enregistrez pour conserver.');}catch(e){sponsorMessage(e.message,true);}});
        row.append(title,state,select);row.appendChild(el('small',{},p.id+(stageId?' · Étape '+stageId:'')+' · '+p.description));field.appendChild(row);
        if(p.assignment){const checkLabel=el('label'),check=el('input',{type:'checkbox'});check.checked=p.assignment.active!==false;checkLabel.append(check,el('span',{},'Affectation active'));check.addEventListener('change',()=>{TW.sponsors.toggleAssignment(p.id,check.checked,stageId);sponsorMessage('Affectation modifiée — enregistrez pour conserver.');});field.appendChild(checkLabel);}
      });
      sponsorPlacementsNode.appendChild(field);
    });
    if(sponsorStatusNode){sponsorStatusNode.textContent=sponsorStatusText;sponsorStatusNode.classList.toggle('tw-error',sponsorStatusError);}
  }
  function build(){
    const style=el('style');style.textContent=css+sponsorCss;document.head.appendChild(style);
    panel=el('section',{id:'tw-admin','aria-label':'Administration Tidewright'});
    const close=el('button',{class:'tw-admin-close',type:'button','aria-label':'Fermer'},'×');
    panel.append(close,el('h2',{},'Atelier de navigation'),el('p',{class:'tw-admin-sub'},'Réglages en direct — les positions d’équipage sont appliquées après rechargement.'));

    const weather=el('fieldset',{class:'tw-admin-pane'});weather.appendChild(el('legend',{},'Météo'));
    range(weather,'tw-ad-storm','Tempête',0,1,.01,()=>TW.state.storm,v=>{S.runtime.manualWeather=true;S.runtime.storm=v;TW.state.storm=v;},pct);
    range(weather,'tw-ad-rain','Pluie',0,1,.01,()=>TW.state.rain,v=>{S.runtime.manualWeather=true;S.runtime.rain=v;TW.state.rain=v;},pct);
    range(weather,'tw-ad-day','Lumière du jour',0,1,.01,()=>TW.state.daylight,v=>{TW.state.daylight=v;S.weather.daylight=v;},pct);

    const wind=el('fieldset',{class:'tw-admin-pane'});wind.appendChild(el('legend',{},'Vent'));
    range(wind,'tw-ad-wind-dir','Direction vers',-180,180,1,()=>S.runtime.windAngle==null?Math.atan2(TW.state.wind.dirX,TW.state.wind.dirZ)/DEG:S.runtime.windAngle/DEG,v=>{S.runtime.manualWind=true;S.runtime.windAngle=v*DEG;TW.state.wind.dirX=Math.sin(v*DEG);TW.state.wind.dirZ=Math.cos(v*DEG);TW.env.prevailing=v*DEG;TW.env.rebuildWaves();},deg);
    range(wind,'tw-ad-wind-speed','Vitesse',0,30,.1,()=>S.runtime.windSpeed==null?TW.state.wind.speed:S.runtime.windSpeed,v=>{S.runtime.manualWind=true;S.runtime.windSpeed=v;TW.state.wind.speed=v;},v=>v.toFixed(1)+' m/s');

    const sea=el('fieldset',{class:'tw-admin-pane'});sea.appendChild(el('legend',{},'Mer'));
    range(sea,'tw-ad-wave-scale','Amplitude',0,2,.01,()=>S.ocean.waveScale,v=>{S.ocean.waveScale=v;TW.env.rebuildWaves();},v=>v.toFixed(2)+'×');
    range(sea,'tw-ad-swell-dir','Longue houle',-180,180,1,()=>S.ocean.swellDirection/DEG,v=>{S.ocean.swellDirection=v*DEG;TW.env.swellPrevailing=v*DEG;TW.env.rebuildWaves();},deg);

    const land=el('fieldset',{class:'tw-admin-pane'});land.appendChild(el('legend',{},'Terres et relief'));
    range(land,'tw-ad-deep','Profondeur générale',-120,-20,1,()=>S.world.deep,v=>{S.world.deep=v;},v=>v.toFixed(0)+' m');
    range(land,'tw-ad-relief','Échelle du relief',0.2,2,.01,()=>S.world.reliefScale,v=>{S.world.reliefScale=v;},v=>v.toFixed(2)+'×');
    range(land,'tw-ad-chan-w','Largeur canal des Saintes',40,220,1,()=>S.world.channels.saintes.w,v=>{S.world.channels.saintes.w=v;},v=>v.toFixed(0)+' m');
    range(land,'tw-ad-chan-d','Profondeur canal',-100,-10,1,()=>S.world.channels.saintes.depth,v=>{S.world.channels.saintes.depth=v;},v=>v.toFixed(0)+' m');
    land.appendChild(el('p',{class:'tw-admin-note'},'Les terres et le relief deviennent actifs après reconstruction de la carte.'));

    const crew=el('fieldset',{class:'tw-admin-pane'});crew.appendChild(el('legend',{},'Équipage du bateau'));
    crew.appendChild(el('p',{class:'tw-admin-note'},'X : bâbord (+) / tribord (−) · Z : vers la proue (+). Les curseurs sont sauvegardés avec le bouton ci-dessous.'));
    const members=crewMembers();
    ['Équipier 1','Équipier 2','Équipier 3'].forEach((name,i)=>{
      const box=el('fieldset',{class:'tw-admin-crew'});box.appendChild(el('legend',{},name));
      range(box,'tw-ad-crew-'+i+'-x','Latéral',-1.2,1.2,.01,()=>members[i].x,v=>{members[i].x=v;},v=>v.toFixed(2)+' m');
      range(box,'tw-ad-crew-'+i+'-z','Avant / arrière',-0.8,1.8,.01,()=>members[i].z,v=>{members[i].z=v;},v=>v.toFixed(2)+' m');
      range(box,'tw-ad-crew-'+i+'-scale','Taille',.60,1.10,.01,()=>members[i].scale,v=>{members[i].scale=v;},v=>v.toFixed(2)+'×');
      crew.appendChild(box);
    });

    const sponsors=sponsorPane();
    const panes=[['weather','Météo',weather],['wind','Vent',wind],['sea','Mer',sea],['land','Terres',land],['crew','Équipage',crew],['sponsors','Sponsoring',sponsors]];
    const tabs=el('nav',{class:'tw-admin-tabs','aria-label':'Onglets de l’atelier'});
    const select=id=>panes.forEach(([key],i)=>{const button=tabs.children[i],pane=panes[i][2];button.classList.toggle('tw-on',key===id);pane.style.display=key===id?'block':'none';});
    panes.forEach(([key,label])=>{const button=el('button',{type:'button',class:'tw-admin-tab'},label);button.addEventListener('click',()=>select(key));tabs.appendChild(button);});
    panel.appendChild(tabs);
    const actions=el('div',{class:'tw-admin-actions'});
    const reload=el('button',{type:'button'},'Enregistrer et recharger');reload.addEventListener('click',()=>{TW.saveSettings();location.reload();});
    const clear=el('button',{type:'button'},'Réinitialiser les réglages');clear.addEventListener('click',()=>{try{localStorage.removeItem('tidewright.settings');}catch(e){}location.reload();});
    actions.append(reload,clear);panel.append(weather,wind,sea,land,crew,sponsors,actions);document.body.append(panel);select('crew');
    const toggle=force=>{const on=force===undefined?!panel.classList.contains('tw-open'):force;panel.classList.toggle('tw-open',on);};close.addEventListener('click',()=>toggle(false));window.addEventListener('keydown',e=>{if(e.key==='F2'){e.preventDefault();toggle();}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
  TW.admin={toggle:v=>{if(panel)panel.classList.toggle('tw-open',!!v);}};
})();
