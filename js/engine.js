(function(global){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function createEngine(overrides={}){
 const ingredients=clone(overrides.ingredients||LAB_INGREDIENTS), regions=clone(overrides.regions||LAB_REGIONS), areas=clone(overrides.searchAreas||LAB_SEARCH_AREAS), config=clone(overrides.config||LAB_CONFIG);
 const regionMap=new Map(regions.map(x=>[x.name,x])), areaMap=new Map(areas.map(x=>[x.name,x]));
 const norm=x=>String(x||'').toLowerCase();
 const clamp=(x,f=1)=>Math.min(5,Math.max(1,Number.isFinite(+x)?+x:f));
 const rand=overrides.random||Math.random;
 function weightedChoice(items){let total=items.reduce((s,x)=>s+x.weight,0);if(total<=0)return null;let r=rand()*total;for(const x of items){r-=x.weight;if(r<=0)return x}return items[items.length-1]||null}
 function dcTier(dc){return dc<=15?'10-15':dc<=20?'16-20':'21-25'}
 function dosTier(d){return d>=10?'exceptional':d>=5?'strong':'modest'}
 function count(d){const row=(config.findCountByDos||[]).find(x=>d>=x.min&&d<=x.max)||{counts:[{count:1,weight:1}]};return weightedChoice(row.counts).count}
 function habitats(i){return [...new Set(i.associated_search_areas||[])]}
 function related(area,region){const present=new Set((regionMap.get(region)||{}).search_areas||[]);return ((areaMap.get(area)||{}).related_search_areas||[]).filter(x=>present.has(x))}
 function habitatRel(i,area,region){const hs=habitats(i);if(hs.includes(area))return 'direct';if(related(area,region).some(x=>hs.includes(x)))return 'related';return 'none'}
 function yatTier(i){const t=(regionMap.get('Yatamon')||{}).trade_regions||{},rs=i.regions||[];if(rs.some(x=>(t.local||[]).includes(x)))return'local';if(rs.some(x=>(t.nearby||[]).includes(x)))return'nearby';if(rs.some(x=>(t.distant||[]).includes(x)))return'distant';return'unknown'}
 function regionRel(i,region){if(region==='Yatamon')return yatTier(i);const r=regionMap.get(region)||{},rs=i.regions||[];if(rs.includes(region))return'native';if(rs.some(x=>(r.adjacent_regions||[]).includes(x)))return'nearby';return'far'}
 function regionWeight(i,region){if(region==='Yatamon'){const w=config.yatamonTradeWeights||{local:1,nearby:.75,distant:.45,unknown:.25};return +w[yatTier(i)]||.25}return +(config.regionWeights||{})[regionRel(i,region)]||.1}
 function dcMod(i,region,dc){const rule=(config.dcModifiers||{})[dcTier(dc)]||{}, rarity=norm(i.rarity);let rr=regionRel(i,region);if(region==='Yatamon'){if(rr==='local')rr='native';if(rr==='distant'||rr==='unknown')rr='far'}return (+rule[rarity]||0)*(+rule[rr]||.1)}
 function dosMod(i,region,area,d){const rule=(config.dosModifiers||{})[dosTier(d)]||{};let m=1,rr=regionRel(i,region),hr=habitatRel(i,area,region);if(norm(i.rarity)==='uncommon')m*=+rule.uncommon||1;if(rr==='nearby')m*=+rule.nearby||1;if(rr==='far'||rr==='distant'||rr==='unknown')m*=+rule.far||1;if(hr==='none')m*=+rule.nonHabitat||1;return m}
 function refineRel(i,area){const iv=clamp(i.refinement),av=clamp((areaMap.get(area)||{}).civilization),diff=Math.abs(iv-av),key=String(Math.min(4,Math.round(diff*2)/2));return{ingredientValue:iv,areaValue:av,difference:diff,weight:+((config.refinementCompatibility||{})[key]||.05)}}
 function score(i,region,area,dc,d){const rarity=norm(i.rarity);if(i.forageable===false||(config.excludeRarity||[]).includes(rarity)||(config.excludeIngredients||[]).includes(i.name))return null;const rw=+(config.rarityWeights||{})[rarity]||0;if(!rw)return null;const hr=habitatRel(i,area,region),ref=refineRel(i,area);const w=rw*regionWeight(i,region)*(+(config.habitatWeights||{})[hr]||0)*ref.weight*dcMod(i,region,dc)*dosMod(i,region,area,d);if(!(w>0))return null;return{name:i.name,ingredient:i,rarity,weight:w,regionRelationship:regionRel(i,region),habitatRelationship:hr,refinementRelationship:ref}}
 function rarityTarget(dc,d,n,cands){const rule=(((config.rarityCompositionRules||{})[dcTier(dc)]||{})[dosTier(d)])||{allowUncommon:true,maxUncommon:1,chance:.25};if(!rule.allowUncommon||!cands.some(x=>x.rarity==='uncommon')||rand()>=+rule.chance)return 0;const max=Math.min(+rule.maxUncommon||0,n);return max<=1?max:(rand()<.25?max:1)}
 function select(cands,n,d,targetU){const out=[],used=new Set(),target=+(config.habitatTargetByCount||{})[String(n)]||Math.max(1,n-1),best=Math.max(0,...cands.map(x=>x.weight));const sr=config.surpriseRules||{},surprise=sr.enabled&&n>=(sr.minimumFindCount||2)&&rand()<+((sr.chanceByDos||{})[dosTier(d)]||0);let surpriseUsed=false;
  while(out.length<n){const need=out.filter(x=>x.habitatRelationship!=='none').length<target;let pool=cands.filter(x=>!used.has(x.name));const uc=out.filter(x=>x.rarity==='uncommon').length,remaining=n-out.length,needU=Math.max(0,targetU-uc);if(needU&&remaining===needU)pool=pool.filter(x=>x.rarity==='uncommon');else if(uc>=targetU)pool=pool.filter(x=>x.rarity!=='uncommon');if(need){const p=pool.filter(x=>x.habitatRelationship!=='none');if(p.length)pool=p}let pick=null;if(surprise&&!surpriseUsed&&out.length===n-1){const allowed=new Set(sr.allowedHabitatFits||['related','none']),min=best*(+sr.minimumWeightFraction||.03);let p=cands.filter(x=>!used.has(x.name)&&allowed.has(x.habitatRelationship)&&x.weight>=min);if(uc>=targetU)p=p.filter(x=>x.rarity!=='uncommon');if(p.length){pick=weightedChoice(p);surpriseUsed=!!pick}}if(!pick)pick=weightedChoice(pool);if(!pick)break;out.push(pick);used.add(pick.name)}return out}
 function runHaul({region,area,dc=18,degreeOfSuccess=5}){const c=ingredients.map(i=>score(i,region,area,dc,degreeOfSuccess)).filter(Boolean),n=Math.min(config.maxResults||5,count(degreeOfSuccess)),u=rarityTarget(dc,degreeOfSuccess,n,c);return select(c,n,degreeOfSuccess,u)}
 return{ingredients,regions,areas,config,runHaul,score,dcTier,dosTier,clone};
}
global.ObojimaLabEngine={createEngine};
})(typeof self!=='undefined'?self:window);
