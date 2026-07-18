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
function loadAreaEditor(){const row=working.searchAreas.find(x=>x.name===$('#areaEditor').value);if(!row)return;$('#areaSlider').value=row.civilization;$('#areaValue').textContent=(+row.civilization).toFixed(1)}
$('#areaEditor').onchange=loadAreaEditor;$('#areaSlider').oninput=()=>$('#areaValue').textContent=(+$('#areaSlider').value).toFixed(1);
$('#saveArea').onclick=()=>{const row=working.searchAreas.find(x=>x.name===$('#areaEditor').value),before=+row.civilization,after=+$('#areaSlider').value;if(before===after)return;row.civilization=after;keptChanges.push(`${row.name} Civilization: ${before.toFixed(1)} → ${after.toFixed(1)}`);updateChangeLog()};

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
function resetModel(){working={ingredients:clone(LAB_INGREDIENTS),regions:clone(LAB_REGIONS),searchAreas:clone(LAB_SEARCH_AREAS),config:clone(LAB_CONFIG)};keptChanges=[];last=null;baseline=null;updateChangeLog();populateEditors();$('#summary').classList.add('hidden');$('#modelStatus').textContent='Ready';$('#bar').style.width='0%';$('#progressText').textContent='The original embedded model has been restored.'}

function downloadJSON(filename,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)}
$('#downloadDataset').onclick=()=>downloadJSON('obojima-foraging-model-adjusted.json',{dataVersion:new Date().toISOString(),ingredients:working.ingredients,regions:working.regions,searchAreas:working.searchAreas,config:working.config,changes:keptChanges});
$('#downloadIngredients').onclick=()=>downloadJSON('ingredients.json',working.ingredients);
$('#downloadAreas').onclick=()=>downloadJSON('search_areas.json',working.searchAreas);
$('#downloadConfig').onclick=()=>downloadJSON('foraging_config.json',working.config);
$('#downloadAnalysis').onclick=()=>{if(!last)return;downloadJSON('obojima-foraging-analysis.json',{generated:new Date().toISOString(),modelDataVersion:LAB_DATA_VERSION,settings:{trialsPerLocation:last.trials,dc:last.dc,degreeOfSuccess:last.degreeOfSuccess},summary:{locations:last.scenarios.length,totalSearches:last.scenarios.length*last.trials,rareResults:last.assessment.rare,health:last.assessment.health,correlation:last.assessment.reg.r,recommendations:last.assessment.issues.slice(0,8).map(x=>x.type)},scenarios:last.scenarios})};

populateEditors();
