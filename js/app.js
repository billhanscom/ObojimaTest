'use strict';
const $=s=>document.querySelector(s);let last=null,worker=null;
const fmt=n=>new Intl.NumberFormat().format(Math.round(n));
$('#run').onclick=()=>run();

function setProgress(done,total){
 const p=Math.min(100,total?done/total*100:0);
 $('#bar').style.width=p+'%';
 $('#progressText').textContent=`${p.toFixed(0)}% complete — ${fmt(done)} of ${fmt(total)} searches`;
}

function finishRun(result,callback){
 last=result;
 $('#run').disabled=false;
 $('#modelStatus').textContent='Analysis complete';
 $('#bar').style.width='100%';
 render(last);
 if(callback)callback(last);
}

function run(overrides={},callback=null){
 if(worker){worker.terminate();worker=null;}
 const trials=+$('#trials').value;
 $('#run').disabled=true;
 $('#modelStatus').textContent='Running';
 $('#bar').style.width='0%';
 $('#progressText').textContent='Preparing all 77 location combinations…';

 // Blob workers are blocked by some browsers when index.html is opened directly
 // from the filesystem. Try the worker first, then fall back automatically to
 // a chunked main-thread simulation that remains fully self-contained.
 try{
  const blobUrl=URL.createObjectURL(new Blob([LAB_WORKER_SOURCE],{type:'text/javascript'}));
  worker=new Worker(blobUrl);
  URL.revokeObjectURL(blobUrl);
  let started=false;
  const fallback=()=>{
   if(!worker)return;
   worker.terminate();worker=null;
   $('#progressText').textContent='Running in compatibility mode…';
   runMainThread({trials,dc:18,degreeOfSuccess:5,overrides},p=>setProgress(p.done,p.total)).then(r=>finishRun(r,callback)).catch(showRunError);
  };
  const timer=setTimeout(()=>{if(!started)fallback()},1500);
  worker.onmessage=e=>{
   started=true;clearTimeout(timer);
   if(e.data.type==='progress')setProgress(e.data.done,e.data.total);
   else if(e.data.type==='complete'){worker.terminate();worker=null;finishRun(e.data.result,callback)}
  };
  worker.onerror=()=>{clearTimeout(timer);fallback()};
  worker.postMessage({trials,dc:18,degreeOfSuccess:5,overrides});
 }catch(err){
  $('#progressText').textContent='Running in compatibility mode…';
  runMainThread({trials,dc:18,degreeOfSuccess:5,overrides},p=>setProgress(p.done,p.total)).then(r=>finishRun(r,callback)).catch(showRunError);
 }
}

function showRunError(err){
 console.error(err);
 $('#run').disabled=false;
 $('#modelStatus').textContent='Could not run';
 $('#progressText').textContent='The analysis stopped because of an unexpected error. Reload the page and try Quick analysis.';
}

async function runMainThread({trials=5000,dc=18,degreeOfSuccess=5,overrides={}},onProgress=()=>{}){
 const eng=ObojimaLabEngine.createEngine(overrides);
 const scenarios=[];
 let done=0;
 const total=eng.regions.reduce((s,r)=>s+r.search_areas.length,0)*trials;
 const batchSize=100;
 for(const r of eng.regions){
  for(const area of r.search_areas){
   const counts={},ref=[0,0,0,0,0,0],rarity={},fit={direct:0,related:0,none:0},geo={};
   let finds=0;
   for(let start=0;start<trials;start+=batchSize){
    const end=Math.min(trials,start+batchSize);
    for(let t=start;t<end;t++){
     for(const x of eng.runHaul({region:r.name,area,dc,degreeOfSuccess})){
      counts[x.name]=(counts[x.name]||0)+1;
      ref[Math.round(x.refinementRelationship.ingredientValue)]++;
      rarity[x.rarity]=(rarity[x.rarity]||0)+1;
      fit[x.habitatRelationship]++;
      geo[x.regionRelationship]=(geo[x.regionRelationship]||0)+1;
      finds++;
     }
     done++;
    }
    onProgress({done,total});
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   const avg=ref.reduce((s,n,i)=>s+n*i,0)/(finds||1);
   scenarios.push({region:r.name,area,civilization:+(eng.areas.find(a=>a.name===area)||{}).civilization||1,trials,finds,averageRefinement:avg,counts,refinementCounts:ref,rarityCounts:rarity,fitCounts:fit,geographyCounts:geo});
  }
 }
 return{trials,dc,degreeOfSuccess,scenarios,ingredients:eng.ingredients.map(x=>({name:x.name,rarity:x.rarity,refinement:x.refinement,forageable:x.forageable,areas:x.associated_search_areas,regions:x.regions}))};
}
function assess(r){const issues=[];for(const s of r.scenarios){const d=s.averageRefinement-s.civilization;if(Math.abs(d)>.85)issues.push({type:'area',area:s.area,region:s.region,direction:d>0?'high':'low',delta:d,scenario:s})}
 const rare=r.scenarios.reduce((n,s)=>n+(s.rarityCounts.rare||0),0);if(rare)issues.unshift({type:'rare',count:rare});
 const avgByArea={};for(const s of r.scenarios)(avgByArea[s.area]??=[]).push(s.averageRefinement);const av=Object.fromEntries(Object.entries(avgByArea).map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/v.length]));if(av.Market&&av.Town&&av.Market-av.Town<.25)issues.push({type:'similar',a:'Market',b:'Town',gap:av.Market-av.Town,averages:av});
 const allCounts={};r.scenarios.forEach(s=>Object.entries(s.counts).forEach(([k,v])=>allCounts[k]=(allCounts[k]||0)+v));const eligible=r.ingredients.filter(i=>i.forageable!==false&&String(i.rarity).toLowerCase()!=='rare');const never=eligible.filter(i=>!allCounts[i.name]);if(never.length)issues.push({type:'never',items:never});return{issues,rare,allCounts,av}}
function render(r){const a=assess(r);last.assessment=a;$('#summary').classList.remove('hidden');$('#locations').textContent=r.scenarios.length;$('#searches').textContent=fmt(r.scenarios.length*r.trials);$('#rare').textContent=a.rare?fmt(a.rare):'0 ✓';const penalty=Math.min(45,a.issues.filter(x=>x.type!=='never').length*5+a.rare*10);$('#health').textContent=Math.max(55,100-penalty)+'%';renderRecs(a,r);renderTable(r);renderCoverage(a,r);$('#progressText').textContent=`Finished ${fmt(r.scenarios.length*r.trials)} simulated searches.`}
function renderRecs(a,r){const box=$('#recommendations');box.innerHTML='';if(!a.issues.length){box.innerHTML='<article class="recommendation good"><h3>No major issues detected</h3><p>The model is producing a sensible refinement gradient and no forbidden Rare ingredients appeared.</p></article>';return}
 a.issues.slice(0,8).forEach((x,idx)=>{const el=document.createElement('article');el.className='recommendation '+(x.type==='rare'?'high':'');let html='';if(x.type==='area'){const verb=x.direction==='high'?'more refined':'less refined', intent=x.direction==='high'?'make this Search Area feel slightly more civilized':'make this Search Area feel slightly wilder', change=x.direction==='high'?0.3:-0.3;html=`<h3>${x.area} in ${x.region} is producing ${verb} results than expected.</h3><p>Its average refinement is <strong>${x.scenario.averageRefinement.toFixed(2)}</strong>, compared with a Civilization value of <strong>${x.scenario.civilization.toFixed(1)}</strong>.</p><p><strong>Try this:</strong> ${intent}. The Lab can test that change without altering your files.</p><div class="actions"><button data-test-area="${x.area}" data-change="${change}">Test this suggestion</button></div><div class="test-result" hidden></div>`}
 else if(x.type==='similar'){html=`<h3>Markets and Towns are behaving too similarly.</h3><p>Their average refinement differs by only <strong>${x.gap.toFixed(2)}</strong>.</p><p><strong>Try this:</strong> make Markets feel a little more shaped by manufactured goods. The Lab will temporarily move Market slightly toward the civilized end of the scale and retest everything.</p><div class="actions"><button data-test-area="Market" data-change="0.3">Test this suggestion</button></div><div class="test-result" hidden></div>`}
 else if(x.type==='rare'){html=`<h3>Rare ingredients appeared in normal foraging.</h3><p>This should never happen under the current rules. <strong>${fmt(x.count)}</strong> Rare results were recorded.</p><p><strong>Recommended action:</strong> check the Rare exclusions and the forageable flags before changing any weights.</p>`}
 else if(x.type==='never'){html=`<h3>${x.items.length} eligible ingredient${x.items.length===1?' never appears':'s never appear'}.</h3><p>${x.items.slice(0,8).map(i=>i.name).join(', ')}${x.items.length>8?'…':''}</p><p><strong>Try this:</strong> review whether these ingredients have at least one Search Area that exists in one of their Regions. This is a data-assignment question, so the Lab will not guess a new habitat automatically.</p>`}el.innerHTML=html;box.appendChild(el)});
 box.querySelectorAll('[data-test-area]').forEach(b=>b.onclick=()=>testSuggestion(b))}
function runTemporary(overrides,callback){const w=new Worker(URL.createObjectURL(new Blob([LAB_WORKER_SOURCE],{type:'text/javascript'})));w.onmessage=e=>{if(e.data.type==='complete'){w.terminate();callback(e.data.result)}};w.postMessage({trials:+$('#trials').value,dc:18,degreeOfSuccess:5,overrides})}
function testSuggestion(btn){const area=btn.dataset.testArea,change=+btn.dataset.change,result=btn.closest('.recommendation').querySelector('.test-result');btn.disabled=true;btn.textContent='Testing…';const searchAreas=JSON.parse(JSON.stringify(LAB_SEARCH_AREAS));const row=searchAreas.find(x=>x.name===area);const before=row.civilization;row.civilization=Math.max(1,Math.min(5,before+change));runTemporary({searchAreas},r=>{const oldSc=lastOriginal().filter(x=>x.area===area),newSc=r.scenarios.filter(x=>x.area===area);const oldAvg=oldSc.reduce((s,x)=>s+x.averageRefinement,0)/oldSc.length,newAvg=newSc.reduce((s,x)=>s+x.averageRefinement,0)/newSc.length;result.hidden=false;result.innerHTML=`<strong>Test result</strong><br>${area} Civilization: ${before.toFixed(1)} → ${row.civilization.toFixed(1)}<br>Average result refinement: ${oldAvg.toFixed(2)} → ${newAvg.toFixed(2)}<br><span class="muted">This was temporary. No project file was changed.</span>`;btn.disabled=false;btn.textContent='Retest suggestion';})}
let baselineScenarios=null;function lastOriginal(){return baselineScenarios||last.scenarios}
function renderTable(r){if(!baselineScenarios)baselineScenarios=r.scenarios;const rows=[...r.scenarios].sort((a,b)=>a.civilization-b.civilization||a.area.localeCompare(b.area));$('#areaTable').innerHTML='<table><thead><tr><th>Region</th><th>Search Area</th><th>Civilization</th><th>Avg. refinement</th><th>Difference</th><th>Direct/related fit</th><th>Status</th></tr></thead><tbody>'+rows.map(s=>{const d=s.averageRefinement-s.civilization,fit=((s.fitCounts.direct||0)+(s.fitCounts.related||0))/(s.finds||1)*100,status=Math.abs(d)<=.5?['Healthy','good']:Math.abs(d)<=.85?['Review','warn']:['Needs attention','bad'];return `<tr><td>${s.region}</td><td>${s.area}</td><td>${s.civilization.toFixed(1)}</td><td>${s.averageRefinement.toFixed(2)}</td><td>${d>=0?'+':''}${d.toFixed(2)}</td><td><span class="barline"><i style="width:${Math.min(100,fit)}%"></i></span>${fit.toFixed(0)}%</td><td class="flag ${status[1]}">${status[0]}</td></tr>`}).join('')+'</tbody></table>'}
function renderCoverage(a,r){const eligible=r.ingredients.filter(i=>i.forageable!==false&&String(i.rarity).toLowerCase()!=='rare'),seen=eligible.filter(i=>a.allCounts[i.name]),pct=seen.length/eligible.length*100;$('#coverage').innerHTML=`<p><strong>${seen.length} of ${eligible.length}</strong> eligible ingredients appeared at least once (${pct.toFixed(1)}%).</p><div class="progress"><div style="width:${pct}%"></div></div>`}
$('#exportReport').onclick=()=>{if(!last)return;const a=last.assessment;const report={generated:new Date().toISOString(),modelDataVersion:LAB_DATA_VERSION,settings:{trialsPerLocation:last.trials,dc:last.dc,degreeOfSuccess:last.degreeOfSuccess},summary:{locations:last.scenarios.length,totalSearches:last.scenarios.length*last.trials,rareResults:a.rare,issues:a.issues.map(x=>x.type)},scenarios:last.scenarios};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),ael=document.createElement('a');ael.href=url;ael.download='obojima-foraging-analysis.json';ael.click();URL.revokeObjectURL(url)};
