const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
const manifest=JSON.parse(fs.readFileSync(__dirname + '/../extension/manifest.json','utf8'));
const source=fs.readFileSync(__dirname + '/../extension/reader-appearance.js','utf8');
let count=0;
function test(n,f){f();count++;console.log('PASS '+n);}
function harness({dark=true,theme='theme-kobo-light',panel=false,error=false,ready=true,engine=true,visible=true,origin='https://readnow.kobo.com'}={}){
 let clicks=0,opens=0,closes=0,cb=null;const timers=new Map(),events={},observers=[];let serial=0;
 const preference={matches:dark,addEventListener:(n,f)=>events.media=f};
 const body={classList:{contains:s=>s===theme}};
 const popup={contains:()=>false,querySelector:s=>s.includes('closeIcon')?{click(){closes++;panel=false;}}:s.includes('backgroundModeTheme')?{click(){clicks++;theme=preference.matches?'theme-kobo-dark':'theme-kobo-light';}}:null};
 const document={body,visibilityState:visible?'visible':'hidden',activeElement:body,getElementById:()=>({}),querySelector:s=>s.includes('footerBar-pageNumber')||s.includes('footerBar-chapterName-text')?(engine?{textContent:'1'}:null):s.includes('iframe[data-chapterurl]')?(engine?{contentDocument:{readyState:'complete',body:{childElementCount:1}}}:null):s.includes('popUp')?(panel?popup:null):s.includes('aria-modal')?(error?{}:null):s.includes('headerBar-readingSettings')&&ready?{click(){opens++;panel=true;}}:null,addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]};
 class Observer{constructor(f){cb=f;this.active=true;observers.push(this);}observe(){}disconnect(){this.active=false;}}
 const window={addEventListener:(n,f)=>events[n]=f};window.top=window;
 vm.runInNewContext(source,{document,window,location:{origin},matchMedia:()=>preference,MutationObserver:Observer,setTimeout(f,ms){assert([250,10000].includes(ms));const id=++serial;timers.set(id,{f,ms});return id;},clearTimeout(id){timers.delete(id);}});
 const drain=()=>{for(let i=0;i<6;i++){if(observers.at(-1)?.active)cb();for(const [id,t] of timers)if(t.ms===250){timers.delete(id);t.f();}}};
 return{drain,observers,get stats(){return{clicks,opens,closes,theme,timer:timers.size>0};},change(d){preference.matches=d;events.media?.();drain();},show(){document.visibilityState='visible';events.visibilitychange?.();drain();},expire(){for(const t of [...timers.values()])if(t.ms===10000)t.f();},engineReady(){engine=true;events.load?.({target:{matches:()=>true}});drain();}};
}
test('Only exact Kobo hosts covered',()=>{assert.deepEqual([...new Set(manifest.content_scripts.flatMap(s=>s.matches))].sort(),['https://kobo.com/*','https://readnow.kobo.com/*','https://www.kobo.com/*']);assert.equal(manifest.permissions,undefined);assert.equal(manifest.background,undefined);});
test('Site is CSS-only; scripts are top-frame',()=>{assert.equal(manifest.content_scripts.find(s=>s.css?.includes('site-theme.css')).js,undefined);for(const s of manifest.content_scripts)assert.equal(s.all_frames,false);});
test('Native dark selection closes owned popup',()=>{const h=harness();h.drain();assert.equal(h.stats.theme,'theme-kobo-dark');assert.deepEqual([h.stats.opens,h.stats.clicks,h.stats.closes],[1,1,1]);assert.equal(h.observers[0].active,false);assert.equal(h.stats.timer,false);});
test('Matching theme creates no observer',()=>{const h=harness({theme:'theme-kobo-dark'});assert.equal(h.observers.length,0);assert.equal(h.stats.opens,0);});
test('System changes select native light and dark',()=>{const h=harness();h.drain();h.change(false);assert.equal(h.stats.theme,'theme-kobo-light');h.change(true);assert.equal(h.stats.theme,'theme-kobo-dark');assert.equal(h.stats.timer,false);});
test('User-opened settings remain open',()=>{const h=harness({panel:true});h.drain();assert.equal(h.stats.clicks,1);assert.equal(h.stats.closes,0);});
test('Hidden tab defers interactions',()=>{const h=harness({visible:false});assert.equal(h.stats.opens,0);h.show();assert.equal(h.stats.theme,'theme-kobo-dark');});
test('Error dialog not disturbed',()=>{const h=harness({error:true});h.drain();assert.equal(h.stats.opens,0);assert.equal(h.observers[0].active,false);});
test('Missing controls have bounded observation',()=>{const h=harness({ready:false});h.expire();assert.equal(h.observers[0].active,false);assert.equal(h.stats.timer,false);});
test('Mounted header cannot trigger theme before engine readiness',()=>{const h=harness({engine:false});h.drain();assert.equal(h.stats.opens,0);assert.equal(h.stats.clicks,0);h.engineReady();assert.equal(h.stats.theme,'theme-kobo-dark');assert.equal(h.stats.clicks,1);});
test('Unrelated origin installs no observer',()=>assert.equal(harness({origin:'https://example.com'}).observers.length,0));
test('No filters, polling, or external assets',()=>{const css=fs.readFileSync(__dirname + '/../extension/site-theme.css','utf8');assert.match(css,/@media \(prefers-color-scheme: dark\)/);assert.doesNotMatch(css,/filter\s*:|animation\s*:|@import|url\(/);assert.doesNotMatch(source,/setInterval|fetch\(/);});
test('All manifest files exist',()=>{for(const entry of manifest.content_scripts)for(const file of [...(entry.js??[]),...(entry.css??[])])assert(fs.existsSync(__dirname + '/../extension/'+file));});
console.log(count+' appearance tests passed (not a browser benchmark).');
