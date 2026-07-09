// Runtime smoke test: executes the ACTUAL <script> contents of ecosystem.html
// inside a minimal stubbed browser environment (Node vm module), with a
// realistic localStorage fixture, and manually drives the rAF loop for a
// simulated ~90 seconds (long enough to see spawning, a full day/night
// flip, and lifecycle timers) — catching runtime errors that a plain
// `node --check` syntax pass cannot (undefined refs, wrong method names,
// null derefs, etc.), without needing a real browser.
const vm = require('vm');
const fs = require('fs');

// ---- realistic harmodex: fixture -----------------------------------------
const progressions = [
  { id:'p1', name:'A', chords:[
    { root:0, intervals:[0,10,18] }, { root:5, intervals:[0,10,18] }, { root:0, intervals:[0,4,10,18,24] },
  ]},
  { id:'p2', name:'B', chords:[
    { root:5, intervals:[0,10,18] }, { root:23, intervals:[0,10,18] }, { root:5, intervals:[0,4,10,18,24] },
  ]},
  { id:'p3', name:'C', chords:[
    { root:0, intervals:[0,10] }, { root:12, intervals:[0,7,14,21] }, { root:2, intervals:[0,3,9,15,20,26] },
  ]},
  { id:'p4', name:'D', chords: [
    { root:0, intervals:[0,10,18] }, { root:5, intervals:[0,10,18] }, { root:0, intervals:[0,4,10,18,24] },
  ]},
];
const fakeLocalStorage = {
  _data: {
    'harmodex:progressions': JSON.stringify(progressions),
    'harmodex:nicknames': JSON.stringify({ '0.10.18': 'Home triad' }),
    'harmodex:chordTags': JSON.stringify({}),
    'harmodex:octaveEquivalence': JSON.stringify(false),
    'harmodex:interpretationSettings': JSON.stringify({ generalPitch: 0, progressionsTabTimbre: 'guitar' }),
  },
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._data,k) ? this._data[k] : null; },
  setItem(k,v){ this._data[k] = String(v); },
  removeItem(k){ delete this._data[k]; },
};

// ---- minimal DOM stubs -----------------------------------------------------
function makeClassList(){
  const set = new Set();
  return { add:(...c)=>c.forEach(x=>set.add(x)), remove:(...c)=>c.forEach(x=>set.delete(x)),
    toggle:(c,f)=>{ if(f===undefined) f=!set.has(c); if(f) set.add(c); else set.delete(c); return f; },
    contains:(c)=>set.has(c), _set:set };
}
function makeElement(id){
  const listeners = {};
  return {
    id, style:{}, _text:'', _html:'',
    classList: makeClassList(),
    set textContent(v){ this._text=v; }, get textContent(){ return this._text; },
    set innerHTML(v){ this._html=v; }, get innerHTML(){ return this._html; },
    addEventListener(type, fn){ (listeners[type]=listeners[type]||[]).push(fn); },
    removeEventListener(){},
    _fire(type, ev){ (listeners[type]||[]).forEach(fn=>fn(ev)); },
    querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { left:0, top:0, width:800, height:600 }; },
    getContext(){ return make2dContext(); },
    get width(){ return this._w||800; }, set width(v){ this._w=v; },
    get height(){ return this._h||600; }, set height(v){ this._h=v; },
  };
}
function make2dContext(){
  const grad = { addColorStop(){} };
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(target, prop){
      if(prop==='createLinearGradient' || prop==='createRadialGradient') return () => grad;
      // Real canvas measureText returns a TextMetrics-like object; the zone
      // divider's hover-tooltip hit-rects (ECO.zoneLabelRects) depend on a
      // numeric .width, so this stub must return one rather than falling
      // through to the generic noop (which would yield undefined.width).
      if(prop==='measureText') return (str) => ({ width: (str ? String(str).length : 8) * 6 });
      if(prop in target) return target[prop];
      return noop;
    },
    set(target, prop, value){ target[prop]=value; return true; },
  });
  return ctx;
}
const elements = {};
function getElementById(id){ if(!elements[id]) elements[id] = makeElement(id); return elements[id]; }

let rafCallback = null;
let rafCallCount = 0;
function requestAnimationFrame(fn){ rafCallback = fn; rafCallCount++; return rafCallCount; }

const sandbox = {
  console,
  localStorage: fakeLocalStorage,
  window: {
    innerWidth: 900, innerHeight: 600, devicePixelRatio: 1,
    AudioContext: function(){ throw new Error('no AudioContext in smoke test (expected — audio driver should treat this as unavailable)'); },
    addEventListener(){}, removeEventListener(){},
    close(){},
  },
  document: { getElementById, addEventListener(){} },
  performance: { now: () => sandbox.__now },
  requestAnimationFrame,
  Math,
  Date,
  Set, Map, Array, Object, JSON, String, Number, Boolean,
  parseInt, parseFloat, isNaN, Infinity, NaN,
};
sandbox.__now = 0;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync('/sessions/modest-gallant-cray/mnt/outputs/ecofinal.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if(!scriptMatch) throw new Error('could not find <script> block in ecofinal.html');
const scriptSrc = scriptMatch[1];

let pass = 0;
function ok(name, cond){ if(cond){ pass++; } else { throw new Error('FAIL: '+name); } }

// getAudioCtx() will throw inside window.AudioContext by design above (no real
// audio in Node) -- but getAudioCtx() itself guards audioCtx creation in a
// plain if-check with no try/catch around `new AC()`, matching the main
// app's own getAudioCtx(). To smoke-test boot()/loop() without a real Audio
// backend, stub AudioContext as a no-op class instead of throwing.
sandbox.window.AudioContext = function(){
  return { state:'running', resume(){}, currentTime:0,
    createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){}, cancelScheduledValues(){}, value:0 } }; },
    createOscillator(){ return { type:'sine', frequency:{ value:0, setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){ return this; }, start(){}, stop(){}, setPeriodicWave(){} }; },
    createPeriodicWave(){ return {}; },
    createBiquadFilter(){ return { type:'lowpass', frequency:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, value:0 }, Q:{ value:0, setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){ return this; } }; },
    createBuffer(ch,len,rate){ return { getChannelData: () => new Float32Array(len) }; },
    createBufferSource(){ return { buffer:null, connect(){ return this; }, start(){}, stop(){} }; },
    destination: {},
  };
};

vm.runInContext(scriptSrc, sandbox, { filename: 'ecosystem-inline.js' });

// NOTE: top-level `const`/`let` in the executed script live in the vm
// context's global LEXICAL scope, which is not reflected as properties on
// the sandbox object (only `var`/function declarations are) -- so state is
// read back via further vm.runInContext probes against the same context,
// not via sandbox.<name> property access.
function probe(expr){ return vm.runInContext(expr, sandbox); }

// ---- drive it -----------------------------------------------------------
sandbox.__now = 0;
vm.runInContext('boot()', sandbox);
ok('boot() completed without throwing', true);
ok('world created', probe('!!ECO.world'));
ok('5 interactive objects spawned', probe("ECO.world.bodies.filter(b=>b.kind==='object').length") === 5);
ok('species pool computed from fixture data (>=3 shapes)', probe('ECO.species.length') >= 3);
const moonPhase0 = probe('ECO.moonPhase');
ok('moon phase initialized to a value in [0,31)', moonPhase0 >= 0 && moonPhase0 < 31);
ok('zone B gap computed as a real number', typeof probe('ZONE_B_GAP') === 'number');
ok('mostCommonPair computed at boot (null or a real object with sigA/sigB/gap/count)', (function(){ const p = probe('ECO.mostCommonPair'); return p===null || (typeof p==='object' && 'sigA' in p && 'sigB' in p && 'gap' in p && 'count' in p); })());

// simulate ~90 seconds at ~60fps by repeatedly invoking whatever loop()
// registered itself as the rAF callback, advancing the fake clock each time.
let frames = 0;
const totalMs = 90000;
let t = 0;
while(t < totalMs){
  t += 16.6667;
  sandbox.__now = t;
  if(rafCallback){ rafCallback(t); frames++; }
}
ok('simulated ~90s of frames without throwing', frames > 5000);

const chordCount = probe("ECO.world.bodies.filter(b=>b.kind==='chord').length");
const totalBodyCount = probe('ECO.world.bodies.length');
ok('chords spawned over time (population grew from 0)', chordCount > 0);
ok('population never exceeds the 20-chord cap', chordCount <= 20);
ok('no NaN in any body position after 90s', probe('ECO.world.bodies.every(b => !Number.isNaN(b.x) && !Number.isNaN(b.y))'));
ok('no body escaped world bounds after 90s', probe('ECO.world.bodies.every(b => b.x>=-1 && b.x<=ECO.world.width+1 && b.y>=-1 && b.y<=ECO.world.height+1)'));
ok('moon phase advanced at least once (day/night actually flipped in 90s of 15s half-cycles)', probe('ECO.moonPhase') !== moonPhase0 || probe('ECO.isNight') === true);
ok('at least one big chord (5+ note shape in fixture) was annotated isBig', probe('ECO.species.some(sp=>sp.isBig)'));
ok('no body dragging flag left stuck true (nothing was ever dragged in this headless run)', probe('ECO.world.bodies.every(b=>!b.dragging)'));

// ---- NEW: every spawned chord carries rawIntervals/qrOffsets consumable by
// computeChordLayout() without throwing, and drawChord's dependencies
// (liveRootRaw, hueForPc) resolve to finite numbers for each one. This is
// the core data path the creature-redesign (Task 14) rendering depends on. ----
ok('every live chord has a rawIntervals array at least as long as intervals', probe(`
  ECO.world.bodies.filter(b=>b.kind==='chord').every(b=>Array.isArray(b.rawIntervals) && b.rawIntervals.length===b.intervals.length)
`));
ok('computeChordLayout() runs without throwing for every live chord and returns one point per interval', probe(`
  ECO.world.bodies.filter(b=>b.kind==='chord').every(b=>{
    const layout = computeChordLayout(b.rawIntervals, b.qrOffsets, b.radius*1.4);
    return Array.isArray(layout) && layout.length===b.rawIntervals.length && layout.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  })
`));
ok('liveRootRaw()/hueForPc() resolve to finite hues for every live chord (root + every note)', probe(`
  ECO.world.bodies.filter(b=>b.kind==='chord').every(b=>{
    const root = liveRootRaw(b);
    if(!Number.isFinite(hueForPc(root))) return false;
    return b.rawIntervals.every(iv=>Number.isFinite(hueForPc(root+iv)));
  })
`));

console.log(`smoke test: ${pass} assertions passed, ${frames} frames simulated, final population: ${chordCount} chords + ${totalBodyCount-chordCount} objects, moon phase ${moonPhase0}->${probe('ECO.moonPhase')}`);

/* ==========================================================================
   PART 2: targeted per-object-type + chord-vs-chord verification, run
   through the REAL boot()/loop() wiring (not the standalone director test
   doubles) — installs a spy driver, forces each collision deterministically
   by repositioning bodies directly, and inspects exactly what fired.
   ========================================================================== */
vm.runInContext(`
  window.__ecoCalls = [];
  var __origCreateRealDriver = createRealDriver;
  createRealDriver = function(getSettings){
    var real = __origCreateRealDriver(getSettings);
    return {
      playOneShot(notes,root,timbre,style){ window.__ecoCalls.push({type:'oneshot', style, notes:notes.slice()}); real.playOneShot(notes,root,timbre,style); },
      playNoise(){ window.__ecoCalls.push({type:'noise'}); real.playNoise(); },
      startSustain(notes,root,timbre){ var h = real.startSustain(notes,root,timbre); window.__ecoCalls.push({type:'startSustain', notes:notes.slice()}); return h; },
      stopSustain(h){ window.__ecoCalls.push({type:'stopSustain'}); real.stopSustain(h); },
    };
  };
`, sandbox);

sandbox.__now = 100000; // fresh timeline for this second boot
vm.runInContext('boot()', sandbox);
ok('second boot() (with spy driver) also completes without throwing', true);

function stepOnce(){ sandbox.__now += 16.6667; if(rafCallback) rafCallback(sandbox.__now); }
function stepTwice(){ stepOnce(); stepOnce(); }
stepOnce(); // warm-up frame: loop()'s first call after boot() always has delta=0 by construction
function clearCalls(){ vm.runInContext('window.__ecoCalls.length = 0', sandbox); }
function calls(){ return probe('window.__ecoCalls'); }

// Pin every object at known, well-separated, gravity-free coordinates so
// collisions can be forced deterministically instead of waiting on physics.
probe(`
  (function(){
    var ys = 100;
    ['obj_strum','obj_padhold','obj_commontones','obj_launcher','obj_transposer'].forEach(function(id,i){
      var b = findBody(ECO.world, id);
      b.gravity = false; b.x = 80 + i*160; b.y = ys; b.vx = 0; b.vy = 0;
    });
    // clear out the randomly-spawned population so only OUR test chords collide this run
    ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind !== 'chord'; });
    ECO.targetCount = 0; // stop the spawner from adding more mid-test
  })();
`);

function addTestChord(id, intervals, x, y){
  probe(`addBody(ECO.world, { id:'${id}', kind:'chord', sig:'${id}', intervals:${JSON.stringify(intervals)}, nickname:'', num:1, isBig:false, transposeOffset:0, zone:'A', bornAt:performance.now(), lifespanMs:null, x:${x}, y:${y}, radius:16, gravity:false, locomotion:null, facing:1, hue:120, vx:0, vy:0 });`);
}
function removeTestChord(id){ probe(`removeBody(ECO.world, '${id}')`); }

// ---- 1. Strum object ----
clearCalls();
addTestChord('t1', [0,4,7], 80, 100);
stepTwice();
const strumCalls = calls();
ok('[wired] strum object -> exactly one oneshot with the full 3-note chord', strumCalls.filter(c=>c.type==='oneshot').length===1 && strumCalls[0].notes.length===3);
removeTestChord('t1');

// ---- 2. Pad-hold object ----
clearCalls();
addTestChord('t2', [0,4,7], 240, 100);
stepTwice();
ok('[wired] pad-hold object -> exactly one startSustain', calls().filter(c=>c.type==='startSustain').length===1);
// leave t2 in place/colliding is fine, it's an ambient not a one-shot

// ---- 3. Common-tones object: first with nothing audible (full chord), then with an overlapping ambient ----
probe('ECO.audioPort.stopAmbient()'); // guarantee a clean slate regardless of earlier tests' ordering
clearCalls();
addTestChord('t3a', [1,5,9], 400, 100); // nothing audible right now -> should get the FULL chord
stepTwice();
const ctFallback = calls().filter(c=>c.type==='oneshot');
ok('[wired] common-tones with nothing audible -> strums the full chord', ctFallback.length===1 && ctFallback[0].notes.length===3);
removeTestChord('t3a');
// (re)establish a KNOWN ambient by colliding a fresh chord with the pad-hold
// object directly -- t2's earlier ambient may or may not still be alive
// depending on test ordering, so don't rely on it.
addTestChord('amb', [0,4,7], 240, 100);
stepTwice();
removeTestChord('amb'); // the ambient sound outlives the body that started it, by design
clearCalls();
addTestChord('t3b', [4,8,11], 400, 100); // shares pitch class 4 with the ambient [0,4,7]
stepTwice();
const ctShared = calls().filter(c=>c.type==='oneshot');
ok('[wired] common-tones with an overlapping ambient -> strums ONLY the shared note(s), fewer than the full chord', ctShared.length===1 && ctShared[0].notes.length>=1 && ctShared[0].notes.length<3);
removeTestChord('t3b');
removeTestChord('t2');

// ---- 4. Launcher object ----
clearCalls();
addTestChord('t4', [0,3], 560, 100);
const beforeVel = probe("(function(){var b=findBody(ECO.world,'t4'); return {vx:b.vx,vy:b.vy};})()");
stepTwice();
const afterVel = probe("(function(){var b=findBody(ECO.world,'t4'); return b ? {vx:b.vx,vy:b.vy} : null;})()");
ok('[wired] launcher object -> chord velocity changes to real force', afterVel && Math.hypot(afterVel.vx,afterVel.vy) > 100);
ok('[wired] launcher object -> also gives an audible confirmation', calls().some(c=>c.type==='oneshot'));
removeTestChord('t4');

// ---- 5. Transposer object ----
clearCalls();
addTestChord('t5', [0,3], 720, 100);
stepTwice();
const transposeOffset = probe("(function(){var b=findBody(ECO.world,'t5'); return b ? b.transposeOffset : null;})()");
ok('[wired] transposer object -> chord transposeOffset becomes a nonzero step', transposeOffset !== null && transposeOffset !== 0);
ok('[wired] transposer object -> also gives an audible confirmation', calls().some(c=>c.type==='oneshot'));
removeTestChord('t5');

// ---- 6. Chord vs chord: shared notes + strict superset -> strum shared AND eat ----
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);
clearCalls();
addTestChord('big', [0,4,7,10], 400, 300);
addTestChord('small', [0,4], 405, 300);
const countBefore = probe('ECO.world.bodies.length');
stepTwice();
const countAfter = probe('ECO.world.bodies.length');
ok('[wired] chord-vs-chord superset -> strums the shared subset', calls().some(c=>c.type==='oneshot' && c.notes.length===2));
ok('[wired] chord-vs-chord superset -> the smaller chord is actually eaten (removed) from the live world', countAfter === countBefore - 1 && !probe("!!findBody(ECO.world,'small')"));

// ---- 7. Chord vs chord: disjoint -> noise tick, nobody eaten ----
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);
clearCalls();
addTestChord('x1', [0,3], 600, 300);
addTestChord('x2', [15,18], 605, 300); // disjoint pitch classes from x1
stepTwice();
ok('[wired] chord-vs-chord disjoint -> a noise tick, no strum', calls().some(c=>c.type==='noise') && !calls().some(c=>c.type==='oneshot'));
ok('[wired] chord-vs-chord disjoint -> both survive (no eat when nothing is shared)', probe("!!findBody(ECO.world,'x1') && !!findBody(ECO.world,'x2')"));

console.log(`smoke test part 2 (wired per-object verification): ${pass} total assertions passed so far`);

/* ==========================================================================
   PART 3: day/night pitch shift, zone re-anchoring, big-chord lifecycle
   expiry, and whitelist filtering -- each verified directly through the
   real wired file.
   ========================================================================== */

// ---- 7. Day/night: night transposes the reference by the current moon phase ----
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);
probe('ECO.isNight = false;');
clearCalls();
addTestChord('day1', [0], 80, 100); // sits on the strum object (pinned at 80,100 in part 2)
stepTwice();
const dayNote = calls().find(c=>c.type==='oneshot').notes[0];
removeTestChord('day1');
probe('ECO.isNight = true; ECO.moonPhase = 9;');
clearCalls();
addTestChord('night1', [0], 80, 100);
stepTwice();
const nightNote = calls().find(c=>c.type==='oneshot').notes[0];
removeTestChord('night1');
ok('[wired] day reference is unshifted (note 0 plays as raw 0)', dayNote === 0);
ok('[wired] night transposes the same chord up by the current moon phase (9 steps)', nightNote === 9);
probe('ECO.isNight = false;');

// ---- 8. Zones: crossing the midpoint re-anchors playback root ----
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);
const midX = probe('ECO.world.width/2');
clearCalls();
addTestChord('zoneA', [0], 80, 100); // zone A (left half) -- collides with strum object, root should be 0
stepTwice();
const zoneANote = calls().find(c=>c.type==='oneshot').notes[0];
removeTestChord('zoneA');
// move the strum object itself into zone B territory momentarily isn't needed --
// instead spawn the test chord already on the B side, colliding with a copy
// placed there, to confirm the ROOT used reflects zone B (ZONE_B_GAP), not zone A.
probe(`(function(){ var b = findBody(ECO.world,'obj_strum'); b.__savedX = b.x; b.x = ${JSON.parse(JSON.stringify(1))} * (ECO.world.width - 100); })();`); // temporarily move strum obj to the far right (zone B)
clearCalls();
const bx = probe("findBody(ECO.world,'obj_strum').x");
addTestChord('zoneB', [0], bx, 100);
probe("findBody(ECO.world,'zoneB').zone = findBody(ECO.world,'zoneB').x < ECO.world.width/2 ? 'A' : 'B';"); // updateZones() also runs every physics step and will confirm/overwrite this
stepTwice();
const zoneBNote = calls().find(c=>c.type==='oneshot').notes[0];
removeTestChord('zoneB');
probe(`(function(){ var b = findBody(ECO.world,'obj_strum'); b.x = b.__savedX; })();`); // restore
ok('[wired] zone A collision plays at root 0', zoneANote === 0);
ok('[wired] zone B collision re-anchors to the zone-B root (ZONE_B_GAP), not 0', zoneBNote === probe('ZONE_B_GAP') && zoneBNote !== 0);

// ---- 9. Lifecycle: a "big" chord expires after its lifespan even without being eaten ----
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);
probe(`addBody(ECO.world, { id:'bigOld', kind:'chord', sig:'bigOld', intervals:[0,4,7,10], nickname:'', num:1, isBig:true, transposeOffset:0, zone:'A', bornAt: performance.now()-60001, lifespanMs:60000, x:500, y:500, radius:16, gravity:false, locomotion:null, facing:1, hue:1, vx:0, vy:0 });`);
probe(`addBody(ECO.world, { id:'smallOld', kind:'chord', sig:'smallOld', intervals:[0,4], nickname:'', num:2, isBig:false, transposeOffset:0, zone:'A', bornAt: performance.now()-60001, lifespanMs:null, x:520, y:500, radius:12, gravity:false, locomotion:null, facing:1, hue:1, vx:0, vy:0 });`);
ok('[wired] both present before the lifecycle sweep', probe("!!findBody(ECO.world,'bigOld') && !!findBody(ECO.world,'smallOld')"));
probe('updateLifecycle(performance.now())');
ok('[wired] the "big" chord is removed once its 1-minute lifespan elapses', !probe("!!findBody(ECO.world,'bigOld')"));
ok('[wired] a non-big chord with the same age is NOT removed (no lifespan timer)', probe("!!findBody(ECO.world,'smallOld')"));
probe(`removeBody(ECO.world,'smallOld');`);

// ---- 10. Whitelist: filtering actually restricts the spawn pool, and persists ----
const totalSpecies = probe('ECO.species.length');
const oneSig = probe('ECO.species[0].signature');
probe(`ECO.whitelist = { active:true, signatures:['${oneSig}'] }; saveWhitelist(ECO.whitelist);`);
ok('[wired] whitelist active + one signature -> effectivePool() shrinks to exactly that one shape', probe('effectivePool().length') === 1 && totalSpecies > 1);
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; }); addTestChord = null;`);
// simulate a reload: read the persisted key back exactly like boot() does
const reloaded = probe('loadWhitelist()');
ok('[wired] whitelist persists to and reloads correctly from ecosystem:whitelist', reloaded.active===true && reloaded.signatures.length===1 && reloaded.signatures[0]===oneSig);
ok('[wired] the persisted key really is namespaced separately from any harmodex: key', probe("localStorage.getItem('ecosystem:whitelist') !== null && Object.keys(localStorage._data).filter(k=>k.indexOf('harmodex:')===0).every(k=>k!=='ecosystem:whitelist')"));
probe(`ECO.whitelist = { active:false, signatures:[] }; saveWhitelist(ECO.whitelist);`); // reset so it doesn't leak into anything else

console.log(`smoke test part 3 (day/night, zones, lifecycle, whitelist): ${pass} total assertions passed so far`);

/* ==========================================================================
   PART 4 (NEW, this revision round): earthquake mechanic, and a render()
   pass exercised directly (not just relied upon implicitly via loop() above)
   to catch any drawing-path exception across a full day AND a full night
   frame, now that drawChord/drawObject/drawPlatform/drawCelestial were all
   substantially rewritten.
   ========================================================================== */
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);

// ---- 11. Earthquake: fires at ~30s in, not immediately; perturbs resting bodies; keeps everything in-bounds ----
probe(`ECO.lastQuakeAt = 0; ECO.quakeShakeUntil = 0;`);
probe(`(function(){ var b = findBody(ECO.world,'obj_strum'); b.gravity=true; b.resting=true; b.vx=0; b.vy=0; b.x=80; b.y=ECO.world.height-60; })();`);
sandbox.__now = 200000; // fresh timeline
probe(`updateEarthquake(${200000 - 1})`); // 1ms before the 30s mark relative to lastQuakeAt=0... use explicit boundary check below instead
// Reset explicitly and check the boundary precisely via the real function, not by re-deriving the constant.
probe(`ECO.lastQuakeAt = 5000; ECO.quakeShakeUntil = 0;`);
ok('[wired] updateEarthquake does NOT fire before 30s have elapsed since the last quake', (function(){
  probe('updateEarthquake(5000 + 29999)');
  return probe('ECO.lastQuakeAt') === 5000;
})());
const restingBefore = probe(`(function(){ var b=findBody(ECO.world,'obj_strum'); return {vx:b.vx, vy:b.vy, resting:b.resting}; })()`);
ok('[wired] updateEarthquake DOES fire once 30s have elapsed, perturbing a resting body', (function(){
  probe('updateEarthquake(5000 + 30000)');
  const after = probe(`(function(){ var b=findBody(ECO.world,'obj_strum'); return {vx:b.vx, vy:b.vy, resting:b.resting}; })()`);
  return probe('ECO.lastQuakeAt') === 35000 && (after.vx !== restingBefore.vx || after.vy !== restingBefore.vy) && after.resting === false;
})());
ok('[wired] earthquake sets a nonzero shake window for the render screen-shake effect', probe('ECO.quakeShakeUntil > ECO.lastQuakeAt'));
// run real steps forward through and past the shake window to confirm nothing goes NaN / out of bounds
for(let i=0;i<40;i++) stepOnce();
ok('[wired] no NaN/escaped bodies in the frames right after an earthquake', probe(`
  ECO.world.bodies.every(b => !Number.isNaN(b.x) && !Number.isNaN(b.y) && b.x>=-1 && b.x<=ECO.world.width+1 && b.y>=-1 && b.y<=ECO.world.height+1)
`));

// ---- 12. render() itself, called directly, does not throw on either a day frame or a night frame (exercises drawChord/drawObject/drawPlatform/drawCelestial/drawZoneDivider end-to-end) ----
probe(`ECO.world.bodies = ECO.world.bodies.filter(function(b){ return b.kind!=='chord'; });`);
addTestChord('renderCheck1', [0,4,7,11,14], 300, 300);
probe('ECO.isNight = false;');
let renderDayThrew = false;
try { probe('render(performance.now())'); } catch(e){ renderDayThrew = e.message; }
ok('[wired] render() does not throw during the day with a live multi-note chord on screen', renderDayThrew === false);
probe('ECO.isNight = true; ECO.moonPhase = 17;');
let renderNightThrew = false;
try { probe('render(performance.now())'); } catch(e){ renderNightThrew = e.message; }
ok('[wired] render() does not throw at night (moon phase 17) with the same chord on screen', renderNightThrew === false);
removeTestChord('renderCheck1');
probe('ECO.isNight = false;');

console.log(`smoke test part 4 (earthquake + direct render pass): ${pass} total assertions passed so far`);
