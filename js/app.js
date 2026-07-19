'use strict';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clone=x=>JSON.parse(JSON.stringify(x));
const fmt=n=>new Intl.NumberFormat().format(Math.round(n));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let last=null;
let baseline=null;
let working={ingredients:clone(LAB_INGREDIENTS),regions:clone(LAB_REGIONS),searchAreas:clone(LAB_SEARCH_AREAS),config:clone(LAB_CONFIG)};
let keptChanges=[];
let focusedRuns=[];
let focusedRunCounter=0;

let profileRuns=[];
let profileRunCounter=0;
let activeProfile=null;

function applyCurrentDesignDraft(model){
 const regionNames={
  'Brackwater Wetlands':'The Brackwater Wetlands','Coastal Highlands':'The Coastal Highlands',
  'Gale Fields':'The Gale Fields','Gift of Shuritashi':'The Gift of Shuritashi',
  'Land of Hot Water':'The Land of Hot Water','Shallows':'The Shallows'
 };
 const areaNames={'Shrine':'Sacred Site','Cliffside':'Rocky Terrain'};
 const renameRegion=x=>regionNames[x]||x;
 const renameArea=x=>areaNames[x]||x;
 model.ingredients.forEach(i=>{
  i.regions=(i.regions||[]).map(renameRegion);
  i.associated_search_areas=[...new Set((i.associated_search_areas||[]).map(renameArea))];
 });
 model.regions.forEach(r=>{
  r.name=renameRegion(r.name);
  r.adjacent_regions=(r.adjacent_regions||[]).map(renameRegion);
  r.search_areas=[...new Set((r.search_areas||[]).map(renameArea))];
  if(r.trade_regions)Object.keys(r.trade_regions).forEach(k=>r.trade_regions[k]=r.trade_regions[k].map(renameRegion));
 });
 model.searchAreas.forEach(a=>{
  a.name=renameArea(a.name);
  a.related_search_areas=[...new Set((a.related_search_areas||[]).map(renameArea))];
  if(a.name==='Sacred Site'||a.name==='Ruins')a.civilization=3.0;
 });
 // Sacred Sites are an island-wide umbrella: groves, shrines, temples, springs, and altars.
 model.regions.forEach(r=>{if(!(r.search_areas||[]).includes('Sacred Site'))r.search_areas.push('Sacred Site')});
 // Directly supported sacred-site associations from the setting text discussed during design.
 const sacred=['Hakuma Sapwood','Kojo Root','Ube','Giant Koi Fish Scale'];
 model.ingredients.forEach(i=>{if(sacred.includes(i.name)&&!i.associated_search_areas.includes('Sacred Site'))i.associated_search_areas.push('Sacred Site')});
 // Preserve the design rule that Market affinities remain inside Yatamon.
 const market=model.searchAreas.find(a=>a.name==='Market');
 if(market)market.related_search_areas=(market.related_search_areas||[]).filter(x=>['City Streets','Subway','Sacred Site','Ruins'].includes(x));
 return model;
}
working=applyCurrentDesignDraft(working);

$('#run').onclick=()=>runAnalysis();
$('#resetModel').onclick=resetModel;

function currentOverrides(){return clone(working)}
function setProgress(done,total,text=''){
 const p=Math.min(100,total?done/total*100:0);
 $('#bar').style.width=p+'%';
 $('#progressText').textContent=text||`${p.toFixed(0)}% complete — ${fmt(done)} of ${fmt(total)} searches`;
}

function runWorker(payload,onProgress=()=>{}){
 return new Promise((resolve,reject)=>{
  let w=null,started=false,timer=null;
  const fallback=()=>{
   if(w){w.terminate();w=null}
   runMainThread(payload,onProgress).then(resolve).catch(reject);
  };
  try{
   const url=URL.createObjectURL(new Blob([LAB_WORKER_SOURCE],{type:'text/javascript'}));
   w=new Worker(url);URL.revokeObjectURL(url);
   timer=setTimeout(()=>{if(!started)fallback()},1800);
   w.onmessage=e=>{
    started=true;clearTimeout(timer);
    if(e.data.type==='progress')onProgress(e.data);
    if(e.data.type==='complete'){w.terminate();resolve(e.data.result)}
   };
   w.onerror=()=>{clearTimeout(timer);fallback()};
   w.postMessage(payload);
  }catch(err){fallback()}
 });
}

async function runMainThread({trials=5000,dc=18,degreeOfSuccess=5,overrides={}},onProgress=()=>{}){
 const eng=ObojimaLabEngine.createEngine(overrides),scenarios=[];
 let done=0;const total=eng.regions.reduce((s,r)=>s+r.search_areas.length,0)*trials,batch=100;
 for(const r of eng.regions){for(const area of r.search_areas){
  const counts={},ref=[0,0,0,0,0,0],rarity={},fit={direct:0,related:0,none:0},geo={};let finds=0;
  for(let start=0;start<trials;start+=batch){
   for(let t=start;t<Math.min(trials,start+batch);t++){
    for(const x of eng.runHaul({region:r.name,area,dc,degreeOfSuccess})){
     counts[x.name]=(counts[x.name]||0)+1;ref[Math.round(x.refinementRelationship.ingredientValue)]++;
     rarity[x.rarity]=(rarity[x.rarity]||0)+1;fit[x.habitatRelationship]++;geo[x.regionRelationship]=(geo[x.regionRelationship]||0)+1;finds++;
    }done++;
   }
   onProgress({done,total});await new Promise(res=>setTimeout(res,0));
  }
  const avg=ref.reduce((s,n,i)=>s+n*i,0)/(finds||1);
  scenarios.push({region:r.name,area,civilization:+(eng.areas.find(a=>a.name===area)||{}).civilization||1,trials,finds,averageRefinement:avg,counts,refinementCounts:ref,rarityCounts:rarity,fitCounts:fit,geographyCounts:geo});
 }}
 return{trials,dc,degreeOfSuccess,scenarios,ingredients:eng.ingredients.map(x=>({name:x.name,rarity:x.rarity,refinement:x.refinement,forageable:x.forageable,areas:x.associated_search_areas,regions:x.regions}))};
}

async function runAnalysis({trials=+$('#trials').value,overrides=currentOverrides(),renderResult=true,label='Running full analysis…'}={}){
 $('#run').disabled=true;$('#modelStatus').textContent='Running';setProgress(0,1,label);
 try{
  const result=await runWorker({trials,dc:18,degreeOfSuccess:5,overrides},p=>setProgress(p.done,p.total));
  if(renderResult){last=result;if(!baseline)baseline=clone(result);render(result)}
  $('#run').disabled=false;$('#modelStatus').textContent='Analysis complete';$('#bar').style.width='100%';
  $('#progressText').textContent=`Finished ${fmt(result.scenarios.length*result.trials)} simulated searches.`;
  return result;
 }catch(err){console.error(err);$('#run').disabled=false;$('#modelStatus').textContent='Could not run';$('#progressText').textContent='The analysis stopped unexpectedly. Reload the page and try Quick analysis.';throw err}
}

function regression(points){
 const n=points.length,mx=points.reduce((s,p)=>s+p.x,0)/n,my=points.reduce((s,p)=>s+p.y,0)/n;
 const sxx=points.reduce((s,p)=>s+(p.x-mx)**2,0),sxy=points.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0),syy=points.reduce((s,p)=>s+(p.y-my)**2,0);
 const slope=sxx?sxy/sxx:0,intercept=my-slope*mx,r=(sxx&&syy)?sxy/Math.sqrt(sxx*syy):0;
 return{slope,intercept,r,predict:x=>intercept+slope*x};
}
function assess(r){
 const reg=regression(r.scenarios.map(s=>({x:s.civilization,y:s.averageRefinement}))),issues=[];
 const allCounts={},rarityTotals={},fitTotals={direct:0,related:0,none:0};
 r.scenarios.forEach(s=>{
  Object.entries(s.counts).forEach(([k,v])=>allCounts[k]=(allCounts[k]||0)+v);
  Object.entries(s.rarityCounts).forEach(([k,v])=>rarityTotals[k]=(rarityTotals[k]||0)+v);
  Object.keys(fitTotals).forEach(k=>fitTotals[k]+=s.fitCounts[k]||0);
  s.expectedRefinement=reg.predict(s.civilization);s.residual=s.averageRefinement-s.expectedRefinement;
  const fit=((s.fitCounts.direct||0)+(s.fitCounts.related||0))/(s.finds||1);
  if(Math.abs(s.residual)>.42)issues.push({type:'areaResidual',severity:Math.abs(s.residual)>.7?'high':'medium',scenario:s,direction:s.residual>0?'high':'low',score:Math.abs(s.residual)*100});
  if(fit<.85)issues.push({type:'lowFit',severity:fit<.7?'high':'medium',scenario:s,fit,score:(1-fit)*80});
  const top=Object.entries(s.counts).sort((a,b)=>b[1]-a[1])[0];if(top&&top[1]/s.finds>.20)issues.push({type:'dominance',severity:'medium',scenario:s,item:top[0],share:top[1]/s.finds,score:top[1]/s.finds*70});
 });
 const avgByArea={};r.scenarios.forEach(s=>(avgByArea[s.area]??=[]).push(s.averageRefinement));
 const areaMeans=Object.fromEntries(Object.entries(avgByArea).map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/v.length]));
 if(areaMeans.Market&&areaMeans.Town&&areaMeans.Market-areaMeans.Town<.3)issues.push({type:'similar',severity:'medium',a:'Market',b:'Town',gap:areaMeans.Market-areaMeans.Town,score:45});
 const eligible=r.ingredients.filter(i=>i.forageable!==false&&String(i.rarity).toLowerCase()!=='rare');
 const never=eligible.filter(i=>!allCounts[i.name]);if(never.length)issues.push({type:'never',severity:'high',items:never,score:90});
 const rare=rarityTotals.rare||0;if(rare)issues.unshift({type:'rare',severity:'critical',count:rare,score:1000});
 issues.sort((a,b)=>b.score-a.score);
 const totalFinds=r.scenarios.reduce((s,x)=>s+x.finds,0);
 const coverage=(eligible.length-never.length)/eligible.length;
 const fitRate=(fitTotals.direct+fitTotals.related)/(totalFinds||1);
 const health=Math.max(0,Math.min(100,Math.round(55+reg.r*25+coverage*10+fitRate*10-(rare?50:0)-Math.min(15,issues.filter(x=>x.severity==='high').length*2))));
 return{reg,issues,allCounts,rarityTotals,fitTotals,rare,eligible,never,coverage,fitRate,health,areaMeans,totalFinds};
}

function render(r){
 const a=assess(r);r.assessment=a;$('#summary').classList.remove('hidden');
 $('#health').textContent=a.health+'%';$('#healthLabel').textContent=a.health>=90?'Strong':a.health>=80?'Healthy with a few concerns':'Needs review';
 $('#correlation').textContent=a.reg.r.toFixed(2);$('#locations').textContent=r.scenarios.length;$('#searches').textContent=fmt(r.scenarios.length*r.trials);
 $('#rare').textContent=a.rare?fmt(a.rare):'0 ✓';renderExecutive(a);renderRecommendations(a,r);renderTable(r,a);renderCoverage(a);renderFit(a);
}
function renderExecutive(a){
 const trend=a.reg.r>=.9?'very strong':a.reg.r>=.75?'strong':a.reg.r>=.55?'moderate':'weak';
 const top=a.issues[0];let concern='No major concern stands out.';
 if(top?.type==='rare')concern='Rare ingredients appeared in normal foraging and should be fixed before any other tuning.';
 else if(top?.type==='never')concern=`${top.items.length} eligible ingredient${top.items.length===1?' never appears':'s never appear'} in the tested model.`;
 else if(top?.type==='areaResidual')concern=`${top.scenario.area} in ${top.scenario.region} differs most from the pattern established by the rest of the model.`;
 else if(top?.type==='lowFit')concern=`${top.scenario.area} in ${top.scenario.region} relies too heavily on ingredients without a direct or related Search Area match.`;
 $('#executiveSummary').innerHTML=`<p><strong>The model shows a ${trend} relationship between Civilization and the refinement of generated ingredients.</strong> As places become more shaped by sapient activity, their results generally become more refined.</p><p>${esc(concern)}</p><p>${a.fitRate>=.9?'Most selections come from direct or related Search Area matches, so the location data is doing meaningful work.':'A noticeable share of selections does not have a direct or related Search Area match. Those scenarios deserve a closer look.'}</p>`;
}

function recommendationHTML(x,idx){
 const id=`rec-${idx}`;
 if(x.type==='rare')return `<article class="recommendation critical"><h3>Rare ingredients are entering normal foraging.</h3><p><strong>${fmt(x.count)}</strong> Rare results appeared. This is a rules failure, not a balancing preference.</p><p><strong>Do this:</strong> review the Rare exclusions and forageable flags before changing any weighting.</p></article>`;
 if(x.type==='never')return `<article class="recommendation high"><h3>Some eligible ingredients can never be found.</h3><p>${x.items.slice(0,10).map(i=>esc(i.name)).join(', ')}${x.items.length>10?'…':''}</p><p><strong>Do this:</strong> open each ingredient in the Model Workshop and make sure at least one assigned Search Area exists in one of its Regions.</p></article>`;
 if(x.type==='areaResidual'){
  const s=x.scenario,change=x.direction==='high'?0.2:-0.2,desired=x.direction==='high'?'slightly more civilized':'slightly wilder';
  return `<article class="recommendation ${x.severity==='high'?'high':''}" id="${id}"><h3>${esc(s.area)} in ${esc(s.region)} is producing ${x.direction==='high'?'more refined':'less refined'} results than comparable places.</h3><p>Observed average: <strong>${s.averageRefinement.toFixed(2)}</strong>. Expected from the model-wide pattern: <strong>${s.expectedRefinement.toFixed(2)}</strong>.</p><p><strong>Try this:</strong> make ${esc(s.area)} feel ${desired}. The Lab will move its Civilization value from ${s.civilization.toFixed(1)} to ${(s.civilization+change).toFixed(1)} and retest.</p><div class="actions"><button data-test-area="${esc(s.area)}" data-change="${change}">Test this suggestion</button></div><div class="test-result" hidden></div></article>`;
 }
 if(x.type==='similar')return `<article class="recommendation" id="${id}"><h3>Markets and Towns are not distinct enough.</h3><p>Their average refinements differ by only <strong>${x.gap.toFixed(2)}</strong>.</p><p><strong>Try this:</strong> make Markets feel a little more dominated by manufactured goods, without changing Towns.</p><div class="actions"><button data-test-area="Market" data-change="0.2">Test this suggestion</button></div><div class="test-result" hidden></div></article>`;
 if(x.type==='lowFit'){
  const s=x.scenario;return `<article class="recommendation ${x.severity==='high'?'high':''}"><h3>${esc(s.area)} in ${esc(s.region)} is leaning too much on weak location matches.</h3><p>Only <strong>${(x.fit*100).toFixed(0)}%</strong> of its results directly match the Search Area or a related Search Area.</p><p><strong>Do this:</strong> review the most common ingredients in this scenario and add ${esc(s.area)} only where the ingredient descriptions make that location believable. This is better handled as an ingredient-data decision than a blanket mathematical adjustment.</p></article>`;
 }
 if(x.type==='dominance')return `<article class="recommendation"><h3>${esc(x.item)} dominates ${esc(x.scenario.area)} in ${esc(x.scenario.region)}.</h3><p>It accounts for <strong>${(x.share*100).toFixed(1)}%</strong> of all finds there.</p><p><strong>Consider:</strong> verify that the assignment is intentional. If it is, no change is necessary. If not, remove that Search Area from the ingredient or add other plausible ingredients to increase variety.</p></article>`;
 return '';
}
function renderRecommendations(a){
 const box=$('#recommendations');const list=a.issues.slice(0,8);
 box.innerHTML=list.length?list.map(recommendationHTML).join(''):'<article class="recommendation good"><h3>No major problems detected</h3><p>The model is producing a clear refinement gradient, broad ingredient coverage, and no forbidden Rare results.</p></article>';
 $$('[data-test-area]').forEach(b=>b.onclick=()=>testAreaSuggestion(b));
}

async function testAreaSuggestion(btn){
 const area=btn.dataset.testArea,change=+btn.dataset.change,card=btn.closest('.recommendation'),resultBox=card.querySelector('.test-result');
 const proposed=currentOverrides(),row=proposed.searchAreas.find(x=>x.name===area);if(!row)return;
 const before=row.civilization,after=Math.max(1,Math.min(5,before+change));row.civilization=after;
 btn.disabled=true;btn.textContent='Testing…';resultBox.hidden=false;resultBox.textContent='Running the affected model…';
 const tested=await runAnalysis({trials:+$('#trials').value,overrides:proposed,renderResult:false,label:'Testing suggested change…'});
 const oldRows=last.scenarios.filter(x=>x.area===area),newRows=tested.scenarios.filter(x=>x.area===area);
 const avg=rows=>rows.reduce((s,x)=>s+x.averageRefinement,0)/(rows.length||1),oldAvg=avg(oldRows),newAvg=avg(newRows);
 const oldFit=oldRows.reduce((s,x)=>s+(x.fitCounts.direct||0)+(x.fitCounts.related||0),0)/oldRows.reduce((s,x)=>s+x.finds,0);
 const newFit=newRows.reduce((s,x)=>s+(x.fitCounts.direct||0)+(x.fitCounts.related||0),0)/newRows.reduce((s,x)=>s+x.finds,0);
 resultBox.innerHTML=`<strong>Before and after</strong><div class="compare"><span>Civilization<br><b>${before.toFixed(1)} → ${after.toFixed(1)}</b></span><span>Average refinement<br><b>${oldAvg.toFixed(2)} → ${newAvg.toFixed(2)}</b></span><span>Location fit<br><b>${(oldFit*100).toFixed(0)}% → ${(newFit*100).toFixed(0)}%</b></span></div><p>${Math.abs(newAvg-after)<Math.abs(oldAvg-before)?'This moves the results in the intended direction.':'This did not clearly improve the relationship; leave the current model unchanged or test a smaller change.'}</p><div class="actions"><button class="keep-test">Keep this change</button><button class="secondary dismiss-test">Discard</button></div>`;
 resultBox.querySelector('.keep-test').onclick=()=>{working=proposed;keptChanges.push(`${area} Civilization: ${before.toFixed(1)} → ${after.toFixed(1)}`);updateChangeLog();populateEditors();last=tested;render(tested);resultBox.innerHTML='<strong>Change kept in this Lab session.</strong> Download the adjusted data set when you are satisfied.'};
 resultBox.querySelector('.dismiss-test').onclick=()=>{resultBox.hidden=true};btn.disabled=false;btn.textContent='Retest suggestion';
}

function renderTable(r,a){
 const rows=[...r.scenarios].sort((x,y)=>x.civilization-y.civilization||x.area.localeCompare(y.area));
 $('#areaTable').innerHTML='<table><thead><tr><th>Region</th><th>Search Area</th><th>Civilization</th><th>Observed</th><th>Expected</th><th>Difference</th><th>Location fit</th><th>Status</th></tr></thead><tbody>'+rows.map(s=>{
  const d=s.residual,fit=((s.fitCounts.direct||0)+(s.fitCounts.related||0))/(s.finds||1)*100,status=Math.abs(d)<=.25?['Healthy','good']:Math.abs(d)<=.42?['Review','warn']:['Needs attention','bad'];
  return `<tr><td>${esc(s.region)}</td><td>${esc(s.area)}</td><td>${s.civilization.toFixed(1)}</td><td>${s.averageRefinement.toFixed(2)}</td><td>${s.expectedRefinement.toFixed(2)}</td><td>${d>=0?'+':''}${d.toFixed(2)}</td><td><span class="barline"><i style="width:${Math.min(100,fit)}%"></i></span>${fit.toFixed(0)}%</td><td class="flag ${status[1]}">${status[0]}</td></tr>`}).join('')+'</tbody></table>';
}
function renderCoverage(a){const seen=a.eligible.length-a.never.length,pct=a.coverage*100;$('#coverage').innerHTML=`<p><strong>${seen} of ${a.eligible.length}</strong> eligible ingredients appeared at least once (${pct.toFixed(1)}%).</p><div class="progress"><div style="width:${pct}%"></div></div>${a.never.length?`<p class="muted">Missing: ${a.never.slice(0,8).map(i=>esc(i.name)).join(', ')}${a.never.length>8?'…':''}</p>`:''}`}
function renderFit(a){const d=a.fitTotals.direct/a.totalFinds*100,r=a.fitTotals.related/a.totalFinds*100,n=a.fitTotals.none/a.totalFinds*100;$('#fitSummary').innerHTML=`<p><strong>${(d+r).toFixed(1)}%</strong> of results had a direct or related Search Area match.</p><div class="stacked"><i style="width:${d}%" title="Direct"></i><b style="width:${r}%" title="Related"></b><em style="width:${n}%" title="No match"></em></div><p class="legend"><span>Direct ${d.toFixed(1)}%</span><span>Related ${r.toFixed(1)}%</span><span>No match ${n.toFixed(1)}%</span></p>`}

function populateEditors(){
 const areaSel=$('#areaEditor'),ingSel=$('#ingredientEditor'),oldA=areaSel.value,oldI=ingSel.value;
 areaSel.innerHTML=working.searchAreas.slice().sort((a,b)=>a.civilization-b.civilization).map(a=>`<option>${esc(a.name)}</option>`).join('');
 ingSel.innerHTML=working.ingredients.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(i=>`<option>${esc(i.name)}</option>`).join('');
 if(oldA&&working.searchAreas.some(x=>x.name===oldA))areaSel.value=oldA;if(oldI&&working.ingredients.some(x=>x.name===oldI))ingSel.value=oldI;
 loadAreaEditor();loadIngredientEditor();
}
function loadAreaEditor(){
 const row=working.searchAreas.find(x=>x.name===$('#areaEditor').value);if(!row)return;
 $('#areaSlider').value=row.civilization;$('#areaValue').textContent=(+row.civilization).toFixed(1);
 const others=working.searchAreas.map(x=>x.name).filter(x=>x!==row.name).sort((a,b)=>a.localeCompare(b));
 $('#relatedAreaFields').innerHTML=others.map(a=>`<label><input type="checkbox" value="${esc(a)}" ${(row.related_search_areas||[]).includes(a)?'checked':''}> ${esc(a)}</label>`).join('');
}
$('#areaEditor').onchange=loadAreaEditor;$('#areaSlider').oninput=()=>$('#areaValue').textContent=(+$('#areaSlider').value).toFixed(1);
$('#saveArea').onclick=()=>{
 const row=working.searchAreas.find(x=>x.name===$('#areaEditor').value),beforeC=+row.civilization,afterC=+$('#areaSlider').value,beforeR=[...(row.related_search_areas||[])].sort();
 const afterR=$$('#relatedAreaFields input[type=checkbox]:checked').map(x=>x.value).sort();
 row.civilization=afterC;row.related_search_areas=afterR;
 const notes=[];if(beforeC!==afterC)notes.push(`Civilization ${beforeC.toFixed(1)} → ${afterC.toFixed(1)}`);if(JSON.stringify(beforeR)!==JSON.stringify(afterR))notes.push(`related areas ${beforeR.length} → ${afterR.length}`);
 if(notes.length){keptChanges.push(`${row.name}: ${notes.join('; ')}`);updateChangeLog();populateFocusedSelectors()}
};

function loadIngredientEditor(){
 const i=working.ingredients.find(x=>x.name===$('#ingredientEditor').value);if(!i)return;
 const areas=working.searchAreas.map(x=>x.name).sort();
 $('#ingredientFields').innerHTML=`<div class="mini-grid"><label>Refinement<select id="editRefinement">${[1,2,3,4,5].map(n=>`<option ${+i.refinement===n?'selected':''}>${n}</option>`).join('')}</select></label><label>Forageable<select id="editForageable"><option value="true" ${i.forageable!==false?'selected':''}>Yes</option><option value="false" ${i.forageable===false?'selected':''}>No</option></select></label></div><fieldset><legend>Search Areas</legend><div class="checkbox-grid">${areas.map(a=>`<label><input type="checkbox" value="${esc(a)}" ${(i.associated_search_areas||[]).includes(a)?'checked':''}> ${esc(a)}</label>`).join('')}</div></fieldset>`;
}
$('#ingredientEditor').onchange=loadIngredientEditor;
$('#saveIngredient').onclick=()=>{
 const i=working.ingredients.find(x=>x.name===$('#ingredientEditor').value),before={r:i.refinement,f:i.forageable,a:[...(i.associated_search_areas||[])]};
 i.refinement=+$('#editRefinement').value;i.forageable=$('#editForageable').value==='true';i.associated_search_areas=$$('#ingredientFields input[type=checkbox]:checked').map(x=>x.value);
 const changes=[];if(+before.r!==+i.refinement)changes.push(`refinement ${before.r} → ${i.refinement}`);if(before.f!==i.forageable)changes.push(`forageable ${before.f} → ${i.forageable}`);if(JSON.stringify(before.a.sort())!==JSON.stringify([...i.associated_search_areas].sort()))changes.push('Search Areas updated');
 if(changes.length){keptChanges.push(`${i.name}: ${changes.join('; ')}`);updateChangeLog()}
};
function updateChangeLog(){$('#changeLog').innerHTML=keptChanges.length?`<strong>Kept changes (${keptChanges.length})</strong><ol>${keptChanges.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`:'<strong>No temporary changes have been kept.</strong>'}
function resetModel(){working=applyCurrentDesignDraft({ingredients:clone(LAB_INGREDIENTS),regions:clone(LAB_REGIONS),searchAreas:clone(LAB_SEARCH_AREAS),config:clone(LAB_CONFIG)});keptChanges=[];last=null;baseline=null;updateChangeLog();populateEditors();populateFocusedSelectors();populateProfilerSelectors();focusedRuns=[];profileRuns=[];activeProfile=null;renderSavedRuns();$('#focusedResult').classList.add('hidden');$('#summary').classList.add('hidden');$('#modelStatus').textContent='Ready';$('#bar').style.width='0%';$('#progressText').textContent='The original embedded model has been restored.'}

function downloadJSON(filename,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)}
$('#downloadDataset').onclick=()=>downloadJSON('obojima-foraging-model-adjusted.json',{dataVersion:new Date().toISOString(),ingredients:working.ingredients,regions:working.regions,searchAreas:working.searchAreas,config:working.config,changes:keptChanges});
$('#downloadIngredients').onclick=()=>downloadJSON('ingredients.json',working.ingredients);
$('#downloadAreas').onclick=()=>downloadJSON('search_areas.json',working.searchAreas);
$('#downloadConfig').onclick=()=>downloadJSON('foraging_config.json',working.config);
$('#downloadAnalysis').onclick=()=>{if(!last)return;downloadJSON('obojima-foraging-analysis.json',{generated:new Date().toISOString(),modelDataVersion:LAB_DATA_VERSION,settings:{trialsPerLocation:last.trials,dc:last.dc,degreeOfSuccess:last.degreeOfSuccess},summary:{locations:last.scenarios.length,totalSearches:last.scenarios.length*last.trials,rareResults:last.assessment.rare,health:last.assessment.health,correlation:last.assessment.reg.r,recommendations:last.assessment.issues.slice(0,8).map(x=>x.type)},scenarios:last.scenarios})};


function alphaIgnoringThe(a,b){
 const key=x=>String(x).replace(/^The\s+/i,'');
 return key(a).localeCompare(key(b));
}
function populateFocusedSelectors(){
 const region=$('#focusedRegion'),previousRegion=region.value;
 region.innerHTML=working.regions.slice().sort((a,b)=>alphaIgnoringThe(a.name,b.name)).map(r=>`<option>${esc(r.name)}</option>`).join('');
 if(previousRegion&&working.regions.some(r=>r.name===previousRegion))region.value=previousRegion;
 populateFocusedAreas();
}
function populateFocusedAreas(){
 const region=working.regions.find(r=>r.name===$('#focusedRegion').value),area=$('#focusedArea'),previous=area.value;
 const available=(region?.search_areas||[]).slice().sort((a,b)=>a.localeCompare(b));
 area.innerHTML=available.map(a=>`<option>${esc(a)}</option>`).join('');
 if(previous&&available.includes(previous))area.value=previous;
}
$('#focusedRegion').onchange=populateFocusedAreas;

function focusedSnapshot(){
 return {ingredients:clone(working.ingredients),regions:clone(working.regions),searchAreas:clone(working.searchAreas),config:clone(working.config)};
}
function pct(n,d){return d?100*n/d:0}
function summarizeFocused(run){
 const total=run.totalFinds||1;
 const refinementAverage=Object.entries(run.refinementCounts).reduce((s,[k,v])=>s+(+k)*v,0)/total;
 const direct=(run.fitCounts.direct||0),related=(run.fitCounts.related||0),none=(run.fitCounts.none||0);
 const uncommon=run.rarityCounts.uncommon||0;
 return {avgFinds:run.totalFinds/run.trials,refinementAverage,directPct:pct(direct,total),relatedPct:pct(related,total),nonePct:pct(none,total),uncommonPct:pct(uncommon,total)};
}
async function runFocusedTest(){
 const button=$('#runFocused'),trials=+$('#focusedTrials').value,region=$('#focusedRegion').value,area=$('#focusedArea').value,dc=+$('#focusedDc').value,degreeOfSuccess=+$('#focusedDos').value;
 if(!region||!area)return;
 button.disabled=true;$('#focusedStatus').textContent='Running';$('#focusedResult').classList.add('hidden');$('#focusedBar').style.width='0%';
 const engine=ObojimaLabEngine.createEngine(focusedSnapshot()),counts={},fitCounts={direct:0,related:0,none:0},rarityCounts={},regionCounts={},refinementCounts={1:0,2:0,3:0,4:0,5:0};
 let totalFinds=0;const batch=250;
 for(let start=0;start<trials;start+=batch){
  for(let i=start;i<Math.min(trials,start+batch);i++){
   const haul=engine.runHaul({region,area,dc,degreeOfSuccess});
   for(const x of haul){
    const row=counts[x.name]||(counts[x.name]={count:0,name:x.name,rarity:x.rarity,refinement:x.ingredient.refinement,forageable:x.ingredient.forageable!==false,associatedAreas:[...(x.ingredient.associated_search_areas||[])],regions:[...(x.ingredient.regions||[])],habitatRelationship:x.habitatRelationship,regionRelationship:x.regionRelationship});
    row.count++;totalFinds++;fitCounts[x.habitatRelationship]=(fitCounts[x.habitatRelationship]||0)+1;rarityCounts[x.rarity]=(rarityCounts[x.rarity]||0)+1;regionCounts[x.regionRelationship]=(regionCounts[x.regionRelationship]||0)+1;refinementCounts[Math.round(x.ingredient.refinement)]=(refinementCounts[Math.round(x.ingredient.refinement)]||0)+1;
   }
  }
  const done=Math.min(trials,start+batch);$('#focusedBar').style.width=(done/trials*100)+'%';$('#focusedProgress').textContent=`${fmt(done)} of ${fmt(trials)} searches complete`;await new Promise(r=>setTimeout(r,0));
 }
 const areaRow=working.searchAreas.find(x=>x.name===area)||{};
 const label=$('#focusedLabel').value.trim()||`${area} in ${region}`;
 const run={id:++focusedRunCounter,label,created:new Date().toISOString(),trials,region,area,dc,degreeOfSuccess,civilization:+areaRow.civilization,relatedAreas:[...(areaRow.related_search_areas||[])],counts:Object.values(counts).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),totalFinds,fitCounts,rarityCounts,regionCounts,refinementCounts,modelSnapshot:focusedSnapshot()};
 focusedRuns.push(run);renderFocusedRun(run);renderSavedRuns();
 $('#focusedStatus').textContent='Complete';$('#focusedProgress').textContent=`Finished ${fmt(trials)} searches and recorded ${fmt(totalFinds)} ingredient appearances.`;button.disabled=false;
}
$('#runFocused').onclick=runFocusedTest;

function renderFocusedRun(run){
 const s=summarizeFocused(run),box=$('#focusedResult');box.classList.remove('hidden');
 box.innerHTML=`<div class="section-head"><div><h3>${esc(run.label)}</h3><p class="muted">${esc(run.area)} in ${esc(run.region)} • Civilization ${run.civilization.toFixed(1)} • ${fmt(run.trials)} searches</p></div></div>
 <div class="focused-summary"><article><span>Ingredients per search</span><strong>${s.avgFinds.toFixed(2)}</strong></article><article><span>Average refinement</span><strong>${s.refinementAverage.toFixed(2)}</strong></article><article><span>Direct area matches</span><strong>${s.directPct.toFixed(1)}%</strong></article><article><span>Related area matches</span><strong>${s.relatedPct.toFixed(1)}%</strong></article><article><span>Uncommon appearances</span><strong>${s.uncommonPct.toFixed(1)}%</strong></article></div>
 <p><span class="pill">DC ${run.dc<=15?'10–15':run.dc<=20?'16–20':'21–25'}</span><span class="pill">${run.degreeOfSuccess>=10?'Exceptional':run.degreeOfSuccess>=5?'Strong':'Modest'} success</span><span class="pill">Related: ${run.relatedAreas.length?run.relatedAreas.map(esc).join(', '):'None'}</span></p>
 <div class="result-tools"><button class="secondary" id="downloadFocusedJson">Download this run (JSON)</button><button class="secondary" id="downloadFocusedCsv">Download ingredient table (CSV)</button></div>
 <div class="table-wrap"><table><thead><tr><th>Ingredient</th><th>Appearances</th><th>% of all appearances</th><th>Per 1,000 searches</th><th>Rarity</th><th>Refinement</th><th>Fit</th><th>Region relationship</th><th>Associated Search Areas</th><th>Ingredient Regions</th></tr></thead><tbody>${run.counts.map(x=>`<tr><td>${esc(x.name)}</td><td>${fmt(x.count)}</td><td>${pct(x.count,run.totalFinds).toFixed(2)}%</td><td>${(x.count/run.trials*1000).toFixed(1)}</td><td>${esc(x.rarity)}</td><td>${esc(x.refinement)}</td><td>${esc(x.habitatRelationship)}</td><td>${esc(x.regionRelationship)}</td><td>${x.associatedAreas.map(esc).join(', ')||'—'}</td><td>${x.regions.map(esc).join(', ')||'—'}</td></tr>`).join('')}</tbody></table></div>`;
 $('#downloadFocusedJson').onclick=()=>downloadJSON(`focused-search-${run.id}.json`,run);
 $('#downloadFocusedCsv').onclick=()=>downloadCSV(`focused-search-${run.id}.csv`,run);
}
function downloadCSV(filename,run){
 const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const rows=[['Ingredient','Appearances','Percent of all appearances','Per 1000 searches','Rarity','Refinement','Forageable','Habitat fit','Region relationship','Associated Search Areas','Ingredient Regions'],...run.counts.map(x=>[x.name,x.count,pct(x.count,run.totalFinds).toFixed(4), (x.count/run.trials*1000).toFixed(4),x.rarity,x.refinement,x.forageable,x.habitatRelationship,x.regionRelationship,x.associatedAreas.join('; '),x.regions.join('; ')])];
 const blob=new Blob([rows.map(r=>r.map(quote).join(',')).join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
function renderSavedRuns(){
 const box=$('#savedRuns');if(!focusedRuns.length){box.innerHTML='<p class="muted">Run a focused test to begin.</p>';$('#comparisonResult').innerHTML='';return}
 box.innerHTML=focusedRuns.map(r=>`<div class="saved-run"><input type="checkbox" class="compare-run" value="${r.id}" checked><div><strong>${esc(r.label)}</strong><small>${esc(r.area)} • ${esc(r.region)} • Civilization ${r.civilization.toFixed(1)} • ${fmt(r.trials)} searches</small></div><div class="saved-run-actions"><button class="secondary view-run" data-id="${r.id}">View</button><button class="secondary delete-run" data-id="${r.id}">Remove</button></div></div>`).join('');
 $$('.compare-run').forEach(x=>x.onchange=renderComparison);$$('.view-run').forEach(x=>x.onclick=()=>renderFocusedRun(focusedRuns.find(r=>r.id===+x.dataset.id)));$$('.delete-run').forEach(x=>x.onclick=()=>{focusedRuns=focusedRuns.filter(r=>r.id!==+x.dataset.id);renderSavedRuns()});renderComparison();
}
function renderComparison(){
 const ids=$$('.compare-run:checked').map(x=>+x.value),runs=focusedRuns.filter(r=>ids.includes(r.id)),box=$('#comparisonResult');if(runs.length<2){box.innerHTML='<p class="muted">Select at least two saved runs to compare.</p>';return}
 const all=[...new Set(runs.flatMap(r=>r.counts.map(x=>x.name)))];
 const rows=all.map(name=>({name,values:runs.map(r=>{const x=r.counts.find(y=>y.name===name);return x?x.count/r.trials*1000:0})})).sort((a,b)=>Math.max(...b.values)-Math.max(...a.values)||a.name.localeCompare(b.name));
 const summaries=runs.map(summarizeFocused);
 box.innerHTML=`<h3>Comparison</h3><div class="comparison-note">Ingredient rates are shown per 1,000 searches. This makes different trial counts directly comparable.</div><div class="table-wrap"><table class="comparison-table"><thead><tr><th>Metric</th>${runs.map(r=>`<th>${esc(r.label)}</th>`).join('')}</tr></thead><tbody><tr><td>Search Area / Region</td>${runs.map(r=>`<td>${esc(r.area)} / ${esc(r.region)}</td>`).join('')}</tr><tr><td>Civilization</td>${runs.map(r=>`<td>${r.civilization.toFixed(1)}</td>`).join('')}</tr><tr><td>Related areas</td>${runs.map(r=>`<td>${r.relatedAreas.length}</td>`).join('')}</tr><tr><td>Ingredients per search</td>${summaries.map(s=>`<td>${s.avgFinds.toFixed(2)}</td>`).join('')}</tr><tr><td>Average refinement</td>${summaries.map(s=>`<td>${s.refinementAverage.toFixed(2)}</td>`).join('')}</tr><tr><td>Direct fit</td>${summaries.map(s=>`<td>${s.directPct.toFixed(1)}%</td>`).join('')}</tr><tr><td>Related fit</td>${summaries.map(s=>`<td>${s.relatedPct.toFixed(1)}%</td>`).join('')}</tr><tr><td>Uncommon appearances</td>${summaries.map(s=>`<td>${s.uncommonPct.toFixed(1)}%</td>`).join('')}</tr></tbody></table></div><h3>Ingredient rates per 1,000 searches</h3><div class="table-wrap"><table class="comparison-table"><thead><tr><th>Ingredient</th>${runs.map(r=>`<th>${esc(r.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.name)}</td>${row.values.map(v=>`<td>${v.toFixed(1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
$('#clearRuns').onclick=()=>{focusedRuns=[];renderSavedRuns();$('#focusedResult').classList.add('hidden');$('#focusedProgress').textContent='No focused test has been run.';$('#focusedBar').style.width='0%'};

populateFocusedSelectors();
populateEditors();


// SEARCH AREA PROFILER ------------------------------------------------------
const DC_SCENARIOS=[
 {key:'10-15',dc:12,label:'DC 10–15'},
 {key:'16-20',dc:18,label:'DC 16–20'},
 {key:'21-25',dc:23,label:'DC 21–25'}
];
const DOS_SCENARIOS=[
 {key:'modest',value:2,label:'Modest'},
 {key:'strong',value:7,label:'Strong'},
 {key:'exceptional',value:12,label:'Exceptional'}
];
const REFINEMENT_LABELS={1:'Wild',2:'Cultivated',3:'Prepared',4:'Crafted',5:'Manufactured'};

function populateProfilerSelectors(){
 const region=$('#profilerRegion'),prev=region.value;
 region.innerHTML=working.regions.slice().sort((a,b)=>alphaIgnoringThe(a.name,b.name)).map(r=>`<option>${esc(r.name)}</option>`).join('');
 if(prev&&working.regions.some(r=>r.name===prev))region.value=prev;
 populateProfilerAreas();
}
function populateProfilerAreas(){
 const r=working.regions.find(x=>x.name===$('#profilerRegion').value),sel=$('#profilerArea'),prev=sel.value;
 const areas=(r?.search_areas||[]).slice().sort((a,b)=>a.localeCompare(b));
 sel.innerHTML=areas.map(a=>`<option>${esc(a)}</option>`).join('');
 if(prev&&areas.includes(prev))sel.value=prev;
 else if(areas.includes('Sacred Site'))sel.value='Sacred Site';
}
$('#profilerRegion').onchange=populateProfilerAreas;

async function simulateProfileScenario(engine,{region,area,dc,dos,trials},progress){
 const counts=new Map(),fit={direct:0,related:0,none:0},rarity={},geo={},ref={1:0,2:0,3:0,4:0,5:0};
 let totalFinds=0,searchesWithAny=0;const batch=250;
 for(let start=0;start<trials;start+=batch){
  for(let i=start;i<Math.min(trials,start+batch);i++){
   const haul=engine.runHaul({region,area,dc,degreeOfSuccess:dos});
   if(haul.length)searchesWithAny++;
   const seen=new Set();
   haul.forEach(x=>{
    let row=counts.get(x.name);
    if(!row){row={name:x.name,count:0,searchCount:0,rarity:x.rarity,refinement:+x.ingredient.refinement,forageable:x.ingredient.forageable!==false,associatedAreas:[...(x.ingredient.associated_search_areas||[])],regions:[...(x.ingredient.regions||[])],fitCounts:{direct:0,related:0,none:0},regionCounts:{}};counts.set(x.name,row)}
    row.count++;if(!seen.has(x.name)){row.searchCount++;seen.add(x.name)}
    row.fitCounts[x.habitatRelationship]=(row.fitCounts[x.habitatRelationship]||0)+1;
    row.regionCounts[x.regionRelationship]=(row.regionCounts[x.regionRelationship]||0)+1;
    fit[x.habitatRelationship]=(fit[x.habitatRelationship]||0)+1;
    rarity[x.rarity]=(rarity[x.rarity]||0)+1;geo[x.regionRelationship]=(geo[x.regionRelationship]||0)+1;
    ref[Math.round(+x.ingredient.refinement)]=(ref[Math.round(+x.ingredient.refinement)]||0)+1;totalFinds++;
   });
  }
  await new Promise(r=>setTimeout(r,0));progress(Math.min(trials,start+batch));
 }
 return{region,area,dc,dos,trials,totalFinds,searchesWithAny,counts:[...counts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),fitCounts:fit,rarityCounts:rarity,regionCounts:geo,refinementCounts:ref};
}
function aggregateProfile(profile){
 const agg={totalFinds:0,totalSearches:0,counts:new Map(),fitCounts:{direct:0,related:0,none:0},rarityCounts:{},regionCounts:{},refinementCounts:{1:0,2:0,3:0,4:0,5:0}};
 profile.scenarios.forEach(sc=>{
  agg.totalFinds+=sc.totalFinds;agg.totalSearches+=sc.trials;
  Object.keys(agg.fitCounts).forEach(k=>agg.fitCounts[k]+=sc.fitCounts[k]||0);
  Object.entries(sc.rarityCounts).forEach(([k,v])=>agg.rarityCounts[k]=(agg.rarityCounts[k]||0)+v);
  Object.entries(sc.regionCounts).forEach(([k,v])=>agg.regionCounts[k]=(agg.regionCounts[k]||0)+v);
  Object.entries(sc.refinementCounts).forEach(([k,v])=>agg.refinementCounts[k]=(agg.refinementCounts[k]||0)+v);
  sc.counts.forEach(x=>{
   let row=agg.counts.get(x.name);if(!row){row={...clone(x),count:0,searchCount:0,scenarioRates:[]};agg.counts.set(x.name,row)}
   row.count+=x.count;row.searchCount+=x.searchCount;row.scenarioRates.push({dc:sc.dc,dos:sc.dos,rate:x.count/sc.trials*1000,searchRate:x.searchCount/sc.trials*100});
  });
 });
 agg.counts=[...agg.counts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 agg.averageRefinement=Object.entries(agg.refinementCounts).reduce((s,[k,v])=>s+(+k)*v,0)/(agg.totalFinds||1);
 agg.avgFinds=agg.totalFinds/(agg.totalSearches||1);
 return agg;
}
function profileIdentity(profile){
 const a=profile.aggregate,total=a.totalFinds||1,ref=a.refinementCounts;
 const parts=[];
 const wild=pct((ref[1]||0)+(ref[2]||0),total),made=pct((ref[4]||0)+(ref[5]||0),total),prepared=pct(ref[3]||0,total);
 if(wild>=55)parts.push('strongly natural');else if(wild>=35)parts.push('nature-connected');
 if(prepared>=20)parts.push('rich in prepared materials');
 if(made>=35)parts.push('strongly shaped by sapient activity');else if(made>=18)parts.push('showing a visible crafted presence');
 const direct=pct(a.fitCounts.direct||0,total),related=pct(a.fitCounts.related||0,total);
 if(direct>=55)parts.push('defined by its own ingredients');else if(related>=50)parts.push('strongly influenced by its affinities');
 const top=profile.aggregate.counts.slice(0,5).map(x=>x.name);
 const uncommon=pct(a.rarityCounts.uncommon||0,total);
 let sentence=`${profile.area} is ${parts.length?parts.join(', '):'broadly balanced'}.`;
 sentence+=` Across the full progression, its most characteristic finds are ${top.slice(0,-1).join(', ')}${top.length>1?', and ':''}${top.at(-1)||'not yet established'}.`;
 sentence+=` Uncommon ingredients account for ${uncommon.toFixed(1)}% of appearances across the complete sweep.`;
 return sentence;
}
function compositionRows(obj,total,labels=obj){return Object.entries(labels).map(([k,label])=>({label,value:obj[k]||0,p:pct(obj[k]||0,total)}))}
function barsHtml(title,rows){return `<div class="fingerprint-card"><h4>${esc(title)}</h4>${rows.map(r=>`<div class="fingerprint-row"><span>${esc(r.label)}</span><div class="mini-bar"><i style="width:${Math.min(100,r.p)}%"></i></div><strong>${r.p.toFixed(1)}%</strong></div>`).join('')}</div>`}
function scenarioSummary(sc){
 const avg=Object.entries(sc.refinementCounts).reduce((s,[k,v])=>s+(+k)*v,0)/(sc.totalFinds||1);
 return{avg,finds:sc.totalFinds/sc.trials,uncommon:pct(sc.rarityCounts.uncommon||0,sc.totalFinds),direct:pct(sc.fitCounts.direct||0,sc.totalFinds),related:pct(sc.fitCounts.related||0,sc.totalFinds)};
}
async function runProfiler(){
 const button=$('#runProfiler'),region=$('#profilerRegion').value,area=$('#profilerArea').value,trials=+$('#profilerTrials').value;
 if(!region||!area)return;button.disabled=true;$('#profilerStatus').textContent='Running';$('#profilerResults').classList.add('hidden');
 const engine=ObojimaLabEngine.createEngine(focusedSnapshot()),scenarios=[];let scenarioIndex=0;
 for(const dc of DC_SCENARIOS){for(const dos of DOS_SCENARIOS){
  const base=scenarioIndex*trials;$('#profilerProgress').textContent=`Running ${dc.label} / ${dos.label}…`;
  const sc=await simulateProfileScenario(engine,{region,area,dc:dc.dc,dos:dos.value,trials},done=>{$('#profilerBar').style.width=((base+done)/(trials*9)*100)+'%'});
  sc.dcKey=dc.key;sc.dcLabel=dc.label;sc.dosKey=dos.key;sc.dosLabel=dos.label;scenarios.push(sc);scenarioIndex++;
 }}
 const areaRow=working.searchAreas.find(x=>x.name===area)||{},label=$('#profilerLabel').value.trim()||`${area} — ${region}`;
 const profile={id:++profileRunCounter,label,created:new Date().toISOString(),region,area,trials,civilization:+areaRow.civilization,relatedAreas:[...(areaRow.related_search_areas||[])],scenarios,modelSnapshot:focusedSnapshot()};
 profile.aggregate=aggregateProfile(profile);profileRuns.push(profile);activeProfile=profile;
 renderProfile(profile);button.disabled=false;$('#profilerStatus').textContent='Complete';$('#profilerProgress').textContent=`Finished ${fmt(trials*9)} searches across all nine scenarios.`;$('#profilerBar').style.width='100%';
}
$('#runProfiler').onclick=runProfiler;

function renderProfile(profile){
 $('#profilerResults').classList.remove('hidden');renderProfileOverview(profile);renderProfileProgression(profile);renderProfileIngredients(profile);renderProfileCompare();showProfileTab('overview');
}
function renderProfileOverview(p){
 const a=p.aggregate,total=a.totalFinds||1,top=a.counts.slice(0,8),max=top[0]?.count||1;
 const direct=pct(a.fitCounts.direct||0,total),related=pct(a.fitCounts.related||0,total),outside=pct(a.fitCounts.none||0,total),uncommon=pct(a.rarityCounts.uncommon||0,total);
 $('#profileOverview').innerHTML=`<div class="profile-hero"><div class="identity-card"><p class="eyebrow">IDENTITY REPORT</p><h3>${esc(p.label)}</h3><p>${esc(profileIdentity(p))}</p><div class="identity-tags"><span class="pill">Civilization ${p.civilization.toFixed(1)}</span><span class="pill">${p.relatedAreas.length} affinities</span><span class="pill">${fmt(p.trials)} searches per scenario</span></div><div class="profile-actions"><button class="secondary profile-download" data-id="${p.id}">Download profile JSON</button></div></div><div class="profile-card"><h3>At a glance</h3><div class="profile-summary-grid"><article><span>Finds/search</span><strong>${a.avgFinds.toFixed(2)}</strong></article><article><span>Avg. refinement</span><strong>${a.averageRefinement.toFixed(2)}</strong></article><article><span>Uncommon</span><strong>${uncommon.toFixed(1)}%</strong></article><article><span>Direct fit</span><strong>${direct.toFixed(1)}%</strong></article><article><span>Related fit</span><strong>${related.toFixed(1)}%</strong></article></div><p class="muted">Outside-area appearances: ${outside.toFixed(1)}%</p></div></div>
 <div class="profile-card"><h3>Signature ingredients</h3><div class="signature-list">${top.map(x=>`<div class="signature-row"><strong>${esc(x.name)}</strong><div class="signature-bar"><i style="width:${x.count/max*100}%"></i></div><span>${(x.count/a.totalSearches*1000).toFixed(1)} / 1,000</span></div>`).join('')}</div></div>
 <div class="fingerprint-grid">${barsHtml('Refinement',compositionRows(a.refinementCounts,total,REFINEMENT_LABELS))}${barsHtml('Search Area fit',compositionRows(a.fitCounts,total,{direct:'Direct',related:'Related',none:'Outside'}))}${barsHtml('Rarity',compositionRows(a.rarityCounts,total,{common:'Common',uncommon:'Uncommon'}))}</div>`;
 $$('.profile-download').forEach(b=>b.onclick=()=>{const x=profileRuns.find(r=>r.id===+b.dataset.id);if(x)downloadJSON(`search-area-profile-${x.id}.json`,x)});
}
function renderProfileProgression(p){
 $('#profileProgression').innerHTML=`<h3>DC and Degree of Success progression</h3><p class="muted">Read across a row to see what better Degrees of Success do within a DC tier. Read down a column to see what a more ambitious search changes.</p><div class="scenario-grid">${p.scenarios.map(sc=>{const s=scenarioSummary(sc),top=sc.counts.slice(0,3).map(x=>x.name).join(', ');return `<article class="scenario-card"><p class="eyebrow">${esc(sc.dcLabel)}</p><h4>${esc(sc.dosLabel)}</h4><div class="metric-line"><span>Finds/search</span><strong>${s.finds.toFixed(2)}</strong></div><div class="metric-line"><span>Avg. refinement</span><strong>${s.avg.toFixed(2)}</strong></div><div class="metric-line"><span>Uncommon</span><strong>${s.uncommon.toFixed(1)}%</strong></div><div class="metric-line"><span>Direct / related</span><strong>${s.direct.toFixed(0)}% / ${s.related.toFixed(0)}%</strong></div><p class="scenario-top"><strong>Leading finds:</strong> ${esc(top||'None')}</p></article>`}).join('')}</div>`;
}
function ingredientPattern(row,p){
 const rates=p.scenarios.map(sc=>{const x=sc.counts.find(y=>y.name===row.name);return x?x.count/sc.trials*1000:0});
 const low=(rates[0]+rates[1]+rates[2])/3,high=(rates[6]+rates[7]+rates[8])/3;
 if(low<.1&&high>=.1)return 'Emerges at high DC';if(high>low*1.5&&high-low>1)return 'Becomes more prominent';if(low>high*1.5&&low-high>1)return 'Most prominent at low DC';return 'Stable across progression';
}
function renderProfileIngredients(p,filter=''){
 const rows=p.aggregate.counts.filter(x=>x.name.toLowerCase().includes(filter.toLowerCase()));
 $('#profileIngredients').innerHTML=`<div class="section-head"><div><h3>Ingredient explorer</h3><p class="muted">One row per ingredient across the complete nine-scenario sweep.</p></div></div><div class="ingredient-filter"><label>Find ingredient<input id="profileIngredientFilter" value="${esc(filter)}" placeholder="Type a name"></label></div><div class="table-wrap"><table><thead><tr><th>Ingredient</th><th>Total appearances</th><th>Per 1,000 searches</th><th>Searches containing it</th><th>Pattern</th><th>Rarity</th><th>Refinement</th><th>Associated Search Areas</th><th>Regions</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${fmt(x.count)}</td><td>${(x.count/p.aggregate.totalSearches*1000).toFixed(1)}</td><td>${pct(x.searchCount,p.aggregate.totalSearches).toFixed(2)}%</td><td>${esc(ingredientPattern(x,p))}</td><td>${esc(x.rarity)}</td><td>${x.refinement} — ${esc(REFINEMENT_LABELS[x.refinement]||'')}</td><td>${x.associatedAreas.map(esc).join(', ')||'—'}</td><td>${x.regions.map(esc).join(', ')||'—'}</td></tr>`).join('')}</tbody></table></div>`;
 $('#profileIngredientFilter').oninput=e=>renderProfileIngredients(p,e.target.value);
}
function renderProfileCompare(){
 const box=$('#profileCompare');
 if(!profileRuns.length){box.innerHTML='<div class="profile-empty">Run a profile to begin.</div>';return}
 box.innerHTML=`<h3>Compare saved profiles</h3><p class="muted">Select two or more profiles. Rates are normalized per 1,000 searches.</p><div class="profile-compare-list">${profileRuns.map(x=>`<label class="profile-compare-item"><input type="checkbox" class="profile-compare-check" value="${x.id}" ${activeProfile&&x.id===activeProfile.id?'checked':''}><span><strong>${esc(x.label)}</strong><small>${esc(x.area)} • ${esc(x.region)} • Civilization ${x.civilization.toFixed(1)}</small></span><button type="button" class="secondary profile-view" data-id="${x.id}">View</button></label>`).join('')}</div><div id="profileComparisonOutput"><p class="muted">Select at least two profiles.</p></div>`;
 $$('.profile-compare-check').forEach(x=>x.onchange=renderProfileComparisonOutput);$$('.profile-view').forEach(x=>x.onclick=()=>{activeProfile=profileRuns.find(p=>p.id===+x.dataset.id);renderProfile(activeProfile)});
}
function overlapScore(a,b){
 const ar=new Map(a.aggregate.counts.map(x=>[x.name,x.count/a.aggregate.totalFinds])),br=new Map(b.aggregate.counts.map(x=>[x.name,x.count/b.aggregate.totalFinds]));
 const names=new Set([...ar.keys(),...br.keys()]);let shared=0,total=0;names.forEach(n=>{shared+=Math.min(ar.get(n)||0,br.get(n)||0);total+=Math.max(ar.get(n)||0,br.get(n)||0)});return total?shared/total:0;
}
function renderProfileComparisonOutput(){
 const ids=$$('.profile-compare-check:checked').map(x=>+x.value),runs=profileRuns.filter(x=>ids.includes(x.id)),box=$('#profileComparisonOutput');if(!box)return;
 if(runs.length<2){box.innerHTML='<p class="muted">Select at least two profiles.</p>';return}
 const all=[...new Set(runs.flatMap(r=>r.aggregate.counts.map(x=>x.name)))];
 const rows=all.map(name=>({name,values:runs.map(r=>{const x=r.aggregate.counts.find(y=>y.name===name);return x?x.count/r.aggregate.totalSearches*1000:0})})).sort((a,b)=>Math.max(...b.values)-Math.max(...a.values)||a.name.localeCompare(b.name)).slice(0,40);
 box.innerHTML=`<div class="profile-summary-grid">${runs.map(r=>`<article><span>${esc(r.label)}</span><strong>${r.aggregate.averageRefinement.toFixed(2)}</strong><small>average refinement</small></article>`).join('')}</div>${runs.length===2?`<p><strong>Ingredient-distribution overlap:</strong> ${(overlapScore(runs[0],runs[1])*100).toFixed(1)}%. A lower number means the places have more distinct identities.</p>`:''}<div class="table-wrap"><table><thead><tr><th>Ingredient</th>${runs.map(r=>`<th>${esc(r.label)}<br><small>per 1,000</small></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.name)}</td>${row.values.map(v=>`<td>${v.toFixed(1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function showProfileTab(name){
 $$('.profile-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
 const ids={overview:'#profileOverview',progression:'#profileProgression',ingredients:'#profileIngredients',compare:'#profileCompare'};
 Object.entries(ids).forEach(([k,id])=>$(id).classList.toggle('hidden',k!==name));if(name==='compare')renderProfileCompare();
}
$$('.profile-tab').forEach(b=>b.onclick=()=>showProfileTab(b.dataset.tab));
populateProfilerSelectors();
