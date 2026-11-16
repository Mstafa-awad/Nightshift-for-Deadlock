/* Nightshift: zero game hooks, no frameworks. All player data is stored on this device. */
'use strict';
const API = 'https://api.deadlock-api.com';
const ART_META = 'https://raw.githubusercontent.com/0xThiagoAmaral/deadlock-open-assets/main/manifests/';
const ART_CDN = 'https://media.githubusercontent.com/media/0xThiagoAmaral/deadlock-open-assets/main/';
const ART_CACHE = 'nightshift-art-v3';
const ART_HOSTS = ['media.githubusercontent.com', 'assets-bucket.deadlock-api.com', 'assets.deadlock-api.com', 'raw.githubusercontent.com'];
// Verified icon paths from the community item manifest; instant preview art.
const KNOWN_ITEM_PATHS={
 headshot_booster:'weapon',healing_rite:'vitality',enduring_speed:'vitality',spirit_shielding:'vitality',weapon_shielding:'vitality',
 warp_stone:'vitality',metal_skin:'vitality',greater_expansion:'spirit',toxic_bullets:'weapon',mystic_reverb:'spirit',
 boundless_spirit:'spirit',leech:'vitality',glass_cannon:'weapon',echo_shard:'spirit',debuff_reducer:'vitality',reactive_barrier:'vitality'
};


const SEED = [[6,'Abrams'],[77,'Apollo'],[15,'Bebop'],[72,'Billy'],[16,'Calico'],[81,'Celeste'],[78,'Deadman Danny'],[64,'Drifter'],[11,'Dynamo'],[76,'Graves'],[17,'Grey Talon'],[13,'Haze'],[14,'Holliday'],[1,'Infernus'],[20,'Ivy'],[12,'Kelvin'],[4,'Lady Geist'],[31,'Lash'],[8,'McGinnis'],[63,'Mina'],[52,'Mirage'],[18,'Mo & Krill'],[87,'Nurse Harrow'],[67,'Paige'],[10,'Paradox'],[50,'Pocket'],[84,'Rat King'],[79,'Rem'],[2,'Seven'],[19,'Shiv'],[80,'Silver'],[60,'Sinclair'],[85,'Solomon'],[69,'The Doorman'],[65,'Venator'],[66,'Victor'],[3,'Vindicta'],[35,'Viscous'],[58,'Vyper'],[25,'Warden'],[7,'Wraith'],[27,'Yamato']].sort((a,b)=>a[1].localeCompare(b[1]));
const DEMO_ITEMS = [
 [5,'Headshot Booster',800,'weapon'],[210,'Healing Rite',800,'vitality'],[303,'Enduring Speed',1600,'vitality'],[310,'Spirit Shielding',1600,'vitality'],[315,'Weapon Shielding',1600,'vitality'],[412,'Warp Stone',3200,'vitality'],[422,'Metal Skin',3200,'vitality'],[431,'Greater Expansion',3200,'spirit'],[490,'Toxic Bullets',3200,'weapon'],[501,'Mystic Reverb',6400,'spirit'],[502,'Boundless Spirit',6400,'spirit'],[503,'Leech',6400,'vitality'],[504,'Glass Cannon',6400,'weapon'],[505,'Echo Shard',6400,'spirit'],[506,'Debuff Reducer',1600,'vitality'],[507,'Reactive Barrier',1600,'vitality']
];
const STATE = {snapshotManifest:null,hero:6,enemies:[],stage:'early',budget:0,mode:'demo',pickMode:'self',items:new Map(),heroStats:new Map(),matchup:new Map(),resultSource:'',lastMatch:null,loading:false,requestSeq:0,heroArt:new Map(),itemArt:new Map(),artReady:false};
const $ = id=>document.getElementById(id);
const nowSeconds = ()=>Math.floor(Date.now()/1000);
const recentStart = ()=>nowSeconds()-30*86400;
const store = (k,v)=>{try{localStorage.setItem('nightshift:'+k,JSON.stringify(v))}catch(e){console.warn('Local cache is full',e)}};
const read = (k,fallback=null)=>{try{const v=localStorage.getItem('nightshift:'+k);return v===null?fallback:JSON.parse(v)}catch{return fallback}};
const lookupHero=id=>STATE.heroes.find(x=>String(x.id)===String(id))||{id:Number(id),name:`Hero ${id}`};
const number=(n)=>Number.isFinite(Number(n))?Number(n):0;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const rate=(n)=>{if(n===null||n===undefined||n==='')return null;const x=Number(n);if(!Number.isFinite(x))return null;return clamp(x>1?x/100:x,0,1)};
const txt=(str)=>String(str??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const compact=n=>Number(n).toLocaleString('en-US');
const phases={early:[0],mid:[1],late:[2,3]};
const STATE_KEY='app_state_v2';
STATE.heroes=SEED.map(([id,name])=>({id,name}));
const saved=read(STATE_KEY,{});
if(STATE.heroes.some(x=>x.id===saved.hero))STATE.hero=saved.hero;
if(Array.isArray(saved.enemies))STATE.enemies=saved.enemies.filter(id=>STATE.heroes.some(x=>x.id===id)&&id!==STATE.hero).slice(0,6);
if(['early','mid','late'].includes(saved.stage))STATE.stage=saved.stage;
STATE.budget=number(saved.budget);
if(typeof saved.playerId==='string')$('playerId').value=saved.playerId;
// Preview is always the first-load mode. Real mode may be explicitly chosen on later visits.
if(saved.mode==='real')STATE.mode='real';
function savePrefs(){store(STATE_KEY,{hero:STATE.hero,enemies:STATE.enemies,stage:STATE.stage,budget:STATE.budget,mode:STATE.mode,playerId:$('playerId').value.trim()})}
function inform(message,kind='info',dismiss=false){$('notice').hidden=false;$('noticeText').textContent=message;$('notice').style.borderColor=kind==='error'?'#9d5b52':kind==='success'?'#526e48':'#66553b';$('noticeIcon').textContent=kind==='error'?'!':kind==='success'?'✓':'ⓘ';if(dismiss){setTimeout(()=>$('notice').hidden=true,6500)}}
function showStatus(message,cls=''){$('matchStatus').textContent=message;$('matchStatus').className='match-status '+cls}
function setOnline(){const online=navigator.onLine;$('connection').className='connection '+(online?'ok':'bad');$('connection').innerHTML=`<i></i> ${online?'NETWORK READY':'OFFLINE'}`}
function itemType(val){const str=String(val??'').toLowerCase();if(str.includes('spirit'))return 'spirit';if(str.includes('weapon'))return 'weapon';return 'vitality'}
function projectItem(x){const obj={id:number(x.id??x.item_id),name:String(x.name??x.display_name??x.item_name??`Item ${x.id}`),cost:number(x.cost??x.shop_cost??x.price??x.tier_cost??0),type:itemType(x.item_slot_type??x.slot_type??x.slot??x.shop_category??x.type??x.upgrade_type??x.category)};const direct=assetURL(x.image_webp??x.shop_image_webp??x.shop_image??x.image??x.image_url??x.icon_image??x.icon??x.images?.icon_hero_card);if(direct)obj.image=direct;return obj;}
function loadCatalog(raw){const list=Array.isArray(raw)?raw:(Array.isArray(raw.items)?raw.items:Object.values(raw.items||{}));let count=0;for(const rec of list){if(!rec||typeof rec!=='object')continue;const item=projectItem(rec);if(!item.id)continue;STATE.items.set(item.id,item);count++}return count}
async function fetchJSON(url,timeout=17000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);try{const res=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});if(!res.ok)throw Error(`HTTP ${res.status}${res.status===429?' (rate limited)':''}`);return await res.json()}finally{clearTimeout(timer)}}
// Artwork metadata is tiny compared with full match dumps. Images are requested only when shown.
function artName(name){return String(name??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}
function assetURL(input){if(input&&typeof input==='object')input=input.src??input.url??input.webp??input.png??null;if(typeof input!=='string'||!input)return null;
 if(input.startsWith('images/deadlock/'))return ART_CDN+input;
 try{const url=new URL(input);return url.protocol==='https:'&&ART_HOSTS.includes(url.hostname)?url.href:null}catch{return null}}
function imgTag(url,alt,extra=''){return url?`<img src="${txt(url)}" alt="${txt(alt)}" ${extra}>`:''}
function heroArt(hero){const key=artName(hero.name);if(STATE.heroArt.has(key))return STATE.heroArt.get(key);const known=new Set(['abrams','haze','bebop','infernus','seven','lady_geist','yamato','wraith','lash','paradox','warden','mirage','kelvin','grey_talon','ivy','pocket','dynamo','viscous']);return known.has(key)?ART_CDN+'images/deadlock/heroes_card/'+key+'.png':null}
function itemArt(item){const key=artName(item.name),cat=KNOWN_ITEM_PATHS[key];return STATE.itemArt.get(key)||item.image||STATE.items.get(item.id)?.image||(cat?ART_CDN+'images/deadlock/items/'+cat+'/'+key+'.png':null)}
function paintArt(){renderHero();if($('heroDialog').open)filterPicker();renderItems()}
function parseHeroArt(payload,prefer=false){const arr=Array.isArray(payload)?payload:Object.values(payload?.heroes||{});
 for(const entry of arr){if(!entry||typeof entry!=='object')continue;const key=artName(entry.display_name||entry.name);if(!key)continue;
 const images=entry.images||{};
 const possibilities=[images.icon_hero_card_webp,images.icon_hero_card,images.icon_hero_card_small_webp,images.icon_hero_card_small,images.hero_vertical,images.icon_hero_mini_webp,images.icon_hero_mini,images.path_card,images.path_sm,entry.image];
 const url=possibilities.map(assetURL).find(Boolean);
 // Some community aliases incorrectly pair a hero name with a different hero's image.
 // Only accept an image whose filename agrees with the actual displayed hero.
 const pictureSlug=url?.split('/').pop()?.replace(/\.(png|webp|jpg|jpeg)$/i,'');
 const accepted=new Set([key,key.replace(/^the_/,''),key.replace(/^mo_krill$/,'mo_and_krill')]);
 if(url&&(!url.startsWith(ART_CDN)||accepted.has(pictureSlug))&&(prefer||!STATE.heroArt.has(key)))STATE.heroArt.set(key,url);
 }}
function parseItemArt(payload,prefer=false){const list=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:Object.values(payload?.items||{});
 for(const entry of list){if(!entry||typeof entry!=='object')continue;
 const name=artName(entry.name||entry.display_name);const image=assetURL(entry.image_webp??entry.shop_image_webp??entry.shop_image??entry.image??entry.icon??entry.image_url);
 if(name&&image&&(prefer||!STATE.itemArt.has(name)))STATE.itemArt.set(name,image);
 }}
async function loadArtManifest(file,fn){const cacheKey='art_'+file;const old=read(cacheKey);if(old?.data){fn(old.data);paintArt();}
 if(old?.updated&&Date.now()-Date.parse(old.updated)<7*86400*1000)return;
 try{const data=await fetchJSON(ART_META+file+'.json',15000);fn(data,true);store(cacheKey,{updated:new Date().toISOString(),data});paintArt();}catch(err){console.warn('Art manifest unavailable:',file,err.message)}}
async function initArt(){await Promise.allSettled([loadArtManifest('heroes',parseHeroArt),loadArtManifest('items',parseItemArt),fetchJSON(`${API}/v1/assets/heroes`,12000).then(data=>{parseHeroArt(data,true);paintArt()}).catch(()=>{})]);STATE.artReady=true;updateArtCacheStatus();}
async function updateArtCacheStatus(){if(!$('imageCacheStatus'))return;
 if(!('caches' in window)){ $('imageCacheStatus').textContent='Artwork uses the normal browser image cache in this quick HTML test. Install the HTTPS PWA for reliable offline image caching.';return;}
 try{const cache=await caches.open(ART_CACHE);const keys=await cache.keys();$('imageCacheStatus').textContent=`${keys.length} illustrations cached for offline reuse. Artwork loads once per URL; new or changed assets need another download.`;}catch{$('imageCacheStatus').textContent='Artwork is fetched as needed and cached whenever browser permissions allow.'}}
async function preloadArt(){const button=$('preloadImages');button.disabled=true;button.textContent='SAVING…';let count=0;
 try{if(!('caches' in window))throw Error('Image CacheStorage is unavailable here');const urls=[...STATE.heroArt.values(),...STATE.itemArt.values(),...STATE.heroes.map(heroArt),...DEMO_ITEMS.map(([id,name,cost,type])=>itemArt({id,name,cost,type})),...[...STATE.items.values()].map(itemArt)];
 const targets=[...new Set(urls)].filter(url=>assetURL(url));const cache=await caches.open(ART_CACHE);
 for(let i=0;i<targets.length;i+=6){await Promise.all(targets.slice(i,i+6).map(async url=>{try{if(await cache.match(url))return;const response=await fetch(url,{mode:'no-cors'});if(response.ok||response.type==='opaque'){await cache.put(url,response);count++}}catch{}}));button.textContent=`SAVED ${count} / ${targets.length}`;}
 inform(`Saved ${count} new illustrations for offline use. Already-cached images are reused.`, 'success',true);
 }catch(e){inform(`Art caching unavailable (${e.message}). Open this as an HTTPS PWA.`, 'error')}finally{button.disabled=false;button.textContent='SAVE ALL KNOWN ART';updateArtCacheStatus()}}
async function clearArt(){try{if('caches' in window)await caches.delete(ART_CACHE);inform('Cached artwork cleared. Pictures will reload online when needed.','success',true)}catch(e){inform('Could not clear art cache: '+e.message,'error')}updateArtCacheStatus()}
async function ensureCatalog(){if(STATE.items.size>40)return;const savedItems=read('catalog');if(savedItems&&Array.isArray(savedItems.items)&&savedItems.items.length){loadCatalog(savedItems.items);return}
 let data;try{data=await fetchJSON('data/catalog.json');loadCatalog(data);parseItemArt(data,true);if(STATE.items.size){store('catalog',{items:[...STATE.items.values()],updated:new Date().toISOString()});return}}catch{}
 try{data=await fetchJSON(`${API}/v1/assets/items/by-type/upgrade`);loadCatalog(data);parseItemArt(data,true);if(!STATE.items.size)throw Error('Missing upgrade item metadata');store('catalog',{items:[...STATE.items.values()],updated:new Date().toISOString()})}catch(e){console.warn('Item catalog is unavailable',e)} }
async function hasSnapshot(id){
 if(STATE.snapshotManifest===null){
   try{const manifest=await fetchJSON('data/manifest.json',6500);const available=Array.isArray(manifest.heroes_available)?manifest.heroes_available:manifest.heroes_updated;STATE.snapshotManifest=new Set(Array.isArray(available)?available.map(String):[])}
   catch(e){STATE.snapshotManifest=new Set();console.warn('Snapshot manifest unavailable; falling back to the API:',e.message)}
 }
 return STATE.snapshotManifest.has(String(id))
}
function parseFlow(raw){if(!raw||!Array.isArray(raw.nodes))throw Error('Item-flow response did not contain nodes');let nodes=[];for(const n of raw.nodes){const stage=Number(n.column??n.phase??n.phase_index??n.stage??n.column_index);const id=number(n.item_id??n.item?.id??n.id);const matches=number(n.matches??n.purchases??n.players??n.match_count);const wins=number(n.wins??n.win_count);if(!Number.isInteger(stage)||stage<0||stage>3||!id||matches<1)continue;const adjusted=rate(n.adjusted_win_rate);const rawRate=rate(n.win_rate)??(n.wins!==undefined?clamp(wins/matches,0,1):null);nodes.push({stage,id,matches,wins,adjusted,raw:rawRate,pick:rate(n.pick_rate??n.purchase_rate),avgTime:number(n.avg_buy_time_s??n.avg_purchase_time_s??0)});
 } if(nodes.length===0)throw Error('The API returned no usable item-flow records');const baseline=raw.reached_per_column||[];const baselineWins=raw.reached_wins_per_column||[];return {nodes,baseline,baselineWins,updated:new Date().toISOString()}}
function cacheValid(data){return data?.updated&&Date.now()-Date.parse(data.updated)<48*3600*1000}
async function loadRealHero(id,force=false){const key=String(id);const cached=read('flow_'+key);if(!force&&STATE.heroStats.has(key))return STATE.heroStats.get(key);if(!force&&cacheValid(cached)){STATE.heroStats.set(key,cached);STATE.resultSource='LOCAL CACHE';return cached}
 // Only request snapshots explicitly listed in the published manifest. This avoids 404s
 // while the database has not yet been generated (e.g. a fresh local installation).
 if(!force&&await hasSnapshot(key)){try{const snap=await fetchJSON(`data/heroes/${key}.json`);if(snap&&Array.isArray(snap.nodes)&&snap.nodes.length){STATE.heroStats.set(key,snap);STATE.resultSource='MONTHLY SNAPSHOT';store('flow_'+key,snap);return snap}}catch(e){console.warn('Snapshot listed but not available; using API instead:',e.message)}}
 try{const q=new URLSearchParams({hero_ids:key,game_mode:'normal',min_unix_timestamp:String(recentStart()),min_matches:'25'});const raw=await fetchJSON(`${API}/v1/analytics/item-flow-stats?${q}`,23000);const parsed=parseFlow(raw);STATE.heroStats.set(key,parsed);STATE.resultSource='LIVE API · LAST 30 DAYS';store('flow_'+key,parsed);return parsed}catch(e){if(cached&&cached.nodes?.length){STATE.heroStats.set(key,cached);STATE.resultSource='STALE LOCAL CACHE';inform('The live service is unavailable. Showing previously saved results.', 'error');return cached}throw e}
}
function parseCounter(raw){if(!Array.isArray(raw))throw Error('Unexpected counter statistics');const obj={};for(const n of raw){const id=number(n.item_id);const matches=number(n.matches);if(!id||matches<20)continue;obj[id]={matches,wins:number(n.wins),rate:matches?number(n.wins)/matches:null}}return obj}
async function loadMatchup(force=false){if(!STATE.enemies.length){STATE.counterData=null;return}const key=`${STATE.hero}_${[...STATE.enemies].sort((a,b)=>a-b).join('_')}`;const cached=read('counter_'+key);if(!force&&cacheValid(cached)){STATE.counterData=cached.data;return}
 try{const params=new URLSearchParams({hero_id:String(STATE.hero),enemy_hero_ids:STATE.enemies.join(','),game_mode:'normal',min_unix_timestamp:String(recentStart()),min_matches:'20'});const raw=await fetchJSON(`${API}/v1/analytics/item-stats?${params}`,18000);const data=parseCounter(raw);STATE.counterData=data;store('counter_'+key,{updated:new Date().toISOString(),data})}catch(e){STATE.counterData=cached?.data||null;console.warn('Counter data unavailable',e)} }
function deterministic(seed){let n=Math.sin(seed*37.291)*43758.5453;return n-Math.floor(n)}
function demoRows(){const stage=phases[STATE.stage][0];return DEMO_ITEMS.map(([id,name,cost,type],i)=>{const jitter=deterministic(STATE.hero*17+id*3+stage*23);const heroBias=deterministic(STATE.hero*9+i);const matches=Math.round(1800+35000*jitter);const raw=clamp(.48+(jitter-.5)*.11+(heroBias-.5)*.04+(STATE.enemies.length?Math.sin(STATE.enemies.reduce((a,b)=>a+b,0)+i)*.018:0),.38,.65);const time=cost===800?0:cost===1600?1:cost===3200?2:3;return {id,name,cost,type,matches,raw,adjusted:clamp(raw-.006,.35,.68),pick:clamp(.06+jitter*.28,0,1),stage:time,score:raw+Math.log(matches)*.002-(Math.abs(time-stage))*.065};}).filter(x=>STATE.stage==='late'?x.stage>=2:STATE.stage==='mid'?x.stage>=1&&x.stage<=2:x.stage<=1).filter(x=>!STATE.budget||x.cost<=STATE.budget).sort((a,b)=>b.score-a.score)}
function rankRows(data){let baseRate=null;const columns=phases[STATE.stage];if(data.baseline&&data.baselineWins){let matches=0,wins=0;for(const col of columns){matches+=number(data.baseline[col]);wins+=number(data.baselineWins[col])}if(matches>0)baseRate=wins/matches}
 return data.nodes.filter(n=>columns.includes(n.stage)&&n.matches>=20).map(n=>{const item=STATE.items.get(n.id)||{id:n.id,name:`Item #${n.id}`,cost:0,type:'vitality'};const reference=n.adjusted??n.raw;const confidence=Math.min(1,Math.log1p(n.matches)/Math.log1p(2000));const comparison=baseRate===null?.5:baseRate;const matchup=STATE.counterData?.[n.id];const matchupConfidence=matchup?Math.min(.4,matchup.matches/(matchup.matches+4000)):.0;const matchBonus=matchup?.rate==null?0:(matchup.rate-comparison)*matchupConfidence;const score=(reference===null?-.2:(reference-comparison)*confidence)+matchBonus+.021*(n.pick??0)+Math.min(.01,Math.log1p(n.matches)/1800);return {...item,matches:n.matches,raw:n.raw,adjusted:n.adjusted,pick:n.pick,score,matchup:!!matchup,matchMatches:matchup?.matches||0}})
 .filter(n=>!STATE.budget||!n.cost||n.cost<=STATE.budget).sort((a,b)=>b.score-a.score)}
function renderItems(){const list=$('recommendations'),empty=$('emptyResults');let rows=[];if(STATE.mode==='demo'){rows=demoRows();STATE.resultSource='SAMPLE DATA'}else{const data=STATE.heroStats.get(String(STATE.hero));if(data)rows=rankRows(data)}
 $('resultSubtitle').textContent=`${STATE.mode==='demo'?'Preview gear':'Statistical gear'} · ${lookupHero(STATE.hero).name}${STATE.enemies.length?' vs '+STATE.enemies.length+' enemies':''}`;
 $('sourceBadge').textContent=STATE.mode==='demo'?'● SAMPLE DATA':`● ${STATE.resultSource||'NOT LOADED'}`;$('sourceBadge').className='source-badge'+(STATE.mode==='real'?' real':'');
 $('modeHint').textContent=STATE.mode==='demo'?'Sample numbers — visual test only':'Historical stats · saved on device';
 $('demoMode').classList.toggle('mode-active',STATE.mode==='demo');$('realMode').classList.toggle('mode-active',STATE.mode==='real');
 $('methodText').textContent=STATE.mode==='demo'?'PREVIEW ONLY — all win rates, item grades and match counts are simulated. The images are real game art when available, but the advice is not real.':'Rankings balance item-flow adjusted win rate, baseline, sample size, purchase frequency and limited enemy matchup samples. Observed wins do not establish that buying an item caused victory.';
 if(STATE.loading){list.innerHTML='<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">◌</div><strong>LOADING THE CATALOG…</strong><p>Fetching compact statistics, not raw match files.</p></div>';empty.hidden=true;return}
 if(!rows.length){list.innerHTML='';$('weakPicks').hidden=true;empty.hidden=false;$('emptyMessage').textContent=STATE.mode==='real'?'No usable real stats available yet. Press UPDATE, or switch to PREVIEW.':'Nothing at this budget. Change SOUL BUDGET to ANY COST.';return}empty.hidden=true;
 const weakest=rows.length>4?[...rows].filter(x=>x.matches>=100).sort((a,b)=>a.score-b.score).slice(0,3):[];
 $('weakPicks').hidden=weakest.length===0;
 $('weakRows').innerHTML=weakest.map(n=>`<div class="weak-row"><span class="mini-item">${imgTag(itemArt(n),n.name,'loading="lazy"')}</span><strong>${txt(n.name)} <small>· ${STATE.mode==='demo'?'sample':compact(n.matches)+' purchases'}</small></strong><span>${n.adjusted===null?'—':(n.adjusted*100).toFixed(1)+'%'}</span></div>`).join('');
 rows=rows.slice(0,7);
 list.innerHTML=rows.map((n,i)=>{
 const icon=n.type==='weapon'?'⌖':n.type==='spirit'?'✧':'✚';
 const adjusted=n.adjusted===null?'—':(n.adjusted*100).toFixed(1)+'%';
 const desc=STATE.mode==='demo'?'SIMULATED EXAMPLE':n.matchup?'Enemy-matchup sample included':'Recent hero purchase sample';
 const price=n.cost?compact(n.cost):'—';const art=itemArt(n);
 return `<article class="item-card ${i===0?'item-featured':''}" data-type="${txt(n.type)}">
   <div class="card-art"><span class="item-rank">${i+1}</span><span class="icon-fallback">${icon}</span>${imgTag(art,n.name,`loading="${i===0?'eager':'lazy'}"`)}</div>
   <div class="item-info"><strong>${txt(n.name)}</strong><div class="item-price">${price}</div><div class="stat-strip"><strong>${adjusted}</strong><small>${STATE.mode==='demo'?'EXAMPLE':'ADJUSTED'}<br>WIN RATE</small></div>${STATE.mode==='demo'?'<span class="sample-marker">SIMULATED STATS</span>':''}</div>
   <details class="item-detail"><summary>DETAILS</summary><p>${txt(desc)} · ${compact(n.matches)} ${STATE.mode==='demo'?'sample games':'purchases'}. ${i===0?'Top-ranked in the current selection.':''}</p></details>
 </article>`;
 }).join('');
}
function renderHero(){const hero=lookupHero(STATE.hero);$('heroInitial').textContent=hero.name.split(' ').map(w=>w[0]).slice(0,2).join('');
 const portrait=heroArt(hero);if(portrait)$('heroInitial').insertAdjacentHTML('beforeend',imgTag(portrait,hero.name,'loading="eager"'));
 $('heroName').textContent=hero.name;$('heroSub').textContent=STATE.mode==='demo'?'Preview build selection':'Historical match recommendations';$('enemyCounter').textContent=`${STATE.enemies.length} / 6`;$('addEnemy').disabled=STATE.enemies.length>=6;
 const chips=STATE.enemies.map(id=>{const h=lookupHero(id);return `<button class="enemy-chip" data-remove="${id}" title="Remove ${txt(h.name)}" aria-label="Remove ${txt(h.name)}"><span class="enemy-fallback">${txt(h.name[0])}</span>${imgTag(heroArt(h),h.name,'loading="lazy"')}<span class="enemy-x">×</span><span class="enemy-name">${txt(h.name)}</span></button>`});
 while(chips.length<6)chips.push('<div class="enemy-slot" aria-hidden="true">+</div>');
 $('enemyChips').innerHTML=chips.join('');
 document.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>{STATE.enemies=STATE.enemies.filter(x=>x!==Number(btn.dataset.remove));STATE.counterData=null;savePrefs();renderHero();onChoiceChanged()});$('clearEnemies').disabled=!STATE.enemies.length;renderItems()}
function renderPhases(){document.querySelectorAll('[data-stage]').forEach(btn=>{const active=btn.dataset.stage===STATE.stage;btn.classList.toggle('active',active);btn.setAttribute('aria-selected',String(active))});$('budget').value=String(STATE.budget);renderItems()}
async function onChoiceChanged(){if(STATE.mode==='real'){await refreshData()}else renderItems()}
async function refreshData(force=false){if(STATE.mode==='demo'){renderItems();return}const sequence=++STATE.requestSeq;STATE.loading=true;STATE.resultSource='LOADING';renderItems();try{await ensureCatalog();await loadRealHero(STATE.hero,force);if(sequence!==STATE.requestSeq)return;await loadMatchup(force);if(sequence!==STATE.requestSeq)return;inform('Real historical match statistics are loaded. Rankings are statistical guidance, not guarantees.','success',true)}catch(e){if(sequence!==STATE.requestSeq)return;STATE.resultSource='UNAVAILABLE';inform(`Could not load real statistics: ${e.message}. Check your network or switch to Preview.`, 'error')}finally{if(sequence===STATE.requestSeq){STATE.loading=false;renderItems()}}}
function setMode(mode){STATE.mode=mode;STATE.requestSeq++;STATE.loading=false;savePrefs();renderHero();renderItems();if(mode==='real')refreshData();else inform('Preview mode is using simulated data. No sample statistic represents actual Deadlock match results.')}
function chooseHero(id){if(STATE.pickMode==='self'){STATE.hero=id;STATE.enemies=STATE.enemies.filter(x=>x!==id);STATE.counterData=null}else if(id!==STATE.hero){if(STATE.enemies.includes(id))STATE.enemies=STATE.enemies.filter(x=>x!==id);else if(STATE.enemies.length<6)STATE.enemies.push(id);STATE.counterData=null}savePrefs();renderHero();if(STATE.pickMode==='self'||STATE.enemies.length>=6)$('heroDialog').close();else filterPicker();onChoiceChanged()}
function showPicker(mode){STATE.pickMode=mode;$('dialogTitle').textContent=mode==='self'?'Choose your hero':'Choose an enemy hero';$('heroSearch').value='';filterPicker();$('heroDialog').showModal();setTimeout(()=>$('heroSearch').focus(),50)}
function filterPicker(){const query=$('heroSearch').value.trim().toLowerCase();const arr=STATE.heroes.filter(h=>h.name.toLowerCase().includes(query)&&(STATE.pickMode==='self'||h.id!==STATE.hero));
 $('heroGrid').innerHTML=arr.map(h=>`<button class="pick-hero ${(STATE.pickMode==='self'?STATE.hero===h.id:STATE.enemies.includes(h.id))?'selected':''}" data-id="${h.id}" title="${txt(h.name)}"><span class="mini-icon">${txt(h.name.slice(0,1))}${imgTag(heroArt(h),h.name,'loading="lazy"')}</span><span class="pick-name">${txt(h.name)}</span></button>`).join('')||'<p class="help-text">No heroes found</p>';
 document.querySelectorAll('.pick-hero').forEach(btn=>btn.onclick=()=>chooseHero(Number(btn.dataset.id)))}
function steamToAccount(input){if(!/^\d{1,20}$/.test(input))return null;try{const n=BigInt(input);const base=76561197960265728n;if(n>=base&&n-base<=4294967295n)return String(n-base);if(n>=1n&&n<=4294967295n)return String(n);return null}catch{return null}}
function parseMatch(match,account){const players=Array.isArray(match.players)?match.players:[];const own=players.find(p=>String(p.account_id??p.player_account_id??p.steam_id3??'')===String(account));if(!own)return null;const team=own.team??own.team_id??own.team_number??own.team_num;const ownHero=number(own.hero_id??own.hero?.id);const enemies=team===undefined?[]:players.filter(p=>(p.team??p.team_id??p.team_number??p.team_num)!==team).map(p=>number(p.hero_id??p.hero?.id)).filter(x=>x>0&&x!==ownHero);return {hero:ownHero,enemies:[...new Set(enemies)].slice(0,6),matchId:match.match_id??match.id,elapsed:match.duration_s??null,teamFound:team!==undefined}}
async function findMatch(){const original=$('playerId').value.trim();const account=steamToAccount(original);if(!account){showStatus('Enter a valid numeric SteamID3 or SteamID64. Steam display names are not account IDs.','warn');return}savePrefs();$('findMatch').disabled=true;$('findMatch').textContent='Searching…';$('matchDetails').hidden=true;showStatus('Checking the public Watch-tab feed…');try{const result=await fetchJSON(`${API}/v1/matches/active?account_id=${encodeURIComponent(account)}`,12000);const matches=Array.isArray(result)?result:Array.isArray(result.matches)?result.matches:[];if(!matches.length){showStatus('Not found in the public top-200 Watch-tab matches. This does NOT mean you are offline. Add enemies manually.','warn');return}const match=matches[0];const parsed=parseMatch(match,account);STATE.lastMatch=parsed;if(!parsed){showStatus('A match was found, but its player/team fields could not be read. Select heroes manually.','warn');return}const canApply=parsed.hero&&STATE.heroes.some(h=>h.id===parsed.hero);if(canApply){STATE.hero=parsed.hero;STATE.enemies=parsed.enemies.filter(id=>STATE.heroes.some(h=>h.id===id));STATE.counterData=null;savePrefs();renderHero();onChoiceChanged()}
 showStatus(`Match found! ${canApply?'Applied your hero and '+STATE.enemies.length+' enemies.':'Use manual picks if some heroes are missing.'}`,'success');$('matchDetails').hidden=false;$('matchDetails').innerHTML=`<div class="match-summary"><strong>Match #${txt(parsed.matchId??'unknown')}</strong><p>${parsed.elapsed?Math.floor(parsed.elapsed/60)+' min elapsed · ':''}${parsed.enemies.length} opponent heroes detected</p><p>${parsed.teamFound?'Teams identified from the public feed':'Team field unavailable'}</p></div>`}catch(e){showStatus(`Could not query the Watch-tab service (${e.message}). Manual hero selection still works.`, 'warn')}finally{$('findMatch').disabled=false;$('findMatch').textContent='Find match'}}
function storageKeys(){try{return Object.keys(localStorage)}catch{return []}}
function updateCacheStatus(){const flows=storageKeys().filter(k=>k.startsWith('nightshift:flow_'));$('cacheStatus').textContent=`${flows.length} hero statistics cached on this device; refreshed as needed.`}
function downloadBlob(name,text){const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function bind(){setOnline();window.addEventListener('online',setOnline);window.addEventListener('offline',setOnline);$('heroButton').onclick=()=>showPicker('self');$('addEnemy').onclick=()=>showPicker('enemy');$('clearEnemies').onclick=()=>{STATE.enemies=[];STATE.counterData=null;savePrefs();renderHero();onChoiceChanged()};$('heroSearch').oninput=filterPicker;$('closeDialog').onclick=()=>$('heroDialog').close();$('heroDialog').addEventListener('click',e=>{if(e.target===$('heroDialog'))$('heroDialog').close()});$('demoMode').onclick=()=>setMode('demo');$('realMode').onclick=()=>setMode('real');$('dismissNotice').onclick=()=>$('notice').hidden=true;document.querySelectorAll('[data-stage]').forEach(btn=>btn.onclick=()=>{STATE.stage=btn.dataset.stage;savePrefs();renderPhases()});$('budget').onchange=e=>{STATE.budget=number(e.target.value);savePrefs();renderItems()};$('refresh').onclick=()=>refreshData(true);$('emptyRetry').onclick=()=>refreshData(true);$('findMatch').onclick=findMatch;$('playerId').onchange=savePrefs;$('playerId').onkeydown=e=>{if(e.key==='Enter')findMatch()};$('settingsToggle').onclick=()=>{updateCacheStatus();updateArtCacheStatus();$('settingsDialog').showModal()};$('closeSettings').onclick=()=>$('settingsDialog').close();$('settingsDialog').addEventListener('click',e=>{if(e.target===$('settingsDialog'))$('settingsDialog').close()});$('clearCache').onclick=()=>{storageKeys().filter(k=>k.startsWith('nightshift:flow_')||k.startsWith('nightshift:counter_')||k==='nightshift:catalog').forEach(k=>localStorage.removeItem(k));STATE.heroStats.clear();STATE.items.clear();STATE.counterData=null;updateCacheStatus();inform('Stored match statistics cleared. Your hero and player ID settings are unchanged.','success')};$('exportCache').onclick=()=>{const cache={exported:new Date().toISOString(),catalog:read('catalog'),stats:{}};for(const key of storageKeys().filter(k=>k.startsWith('nightshift:flow_')))cache.stats[key.split('flow_')[1]]=JSON.parse(localStorage[key]);downloadBlob('nightshift-data.json',JSON.stringify(cache,null,2))};$('preloadImages').onclick=preloadArt;$('clearImages').onclick=clearArt;$('forgetPlayer').onclick=()=>{$('playerId').value='';savePrefs();inform('Saved player ID cleared.','success')};renderHero();renderPhases();initArt().catch(e=>console.warn('Artwork unavailable:',e));if(STATE.mode==='real')refreshData();if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline registration unavailable',e))}
if(typeof document.addEventListener==='function')document.addEventListener('error',e=>{if(e.target?.tagName==='IMG'){e.target.hidden=true;e.target.dataset.broken='true'}},true);
bind();
