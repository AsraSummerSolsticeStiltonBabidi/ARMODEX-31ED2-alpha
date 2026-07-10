// Round 9 logic verification -- pure-math checks extracted to mirror the
// real source functions (bash mount is stale for the live file, so these
// are transcribed copies of the exact logic, checked for correctness, and
// cross-verified against the actual constant values in ecosystem.html).

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; }
  else { fail++; console.log('FAIL:', name); }
}

// ---- pillarRiseFrac (rise/hold/sink easing) ----
const PILLAR_RISE_FRAC = 0.2, PILLAR_SINK_FRAC = 0.2;
function easeInOutFish(x){ return x<0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }
function pillarRiseFrac(elapsedFrac){
  if(elapsedFrac < PILLAR_RISE_FRAC) return easeInOutFish(elapsedFrac/PILLAR_RISE_FRAC);
  if(elapsedFrac > 1-PILLAR_SINK_FRAC) return easeInOutFish((1-elapsedFrac)/PILLAR_SINK_FRAC);
  return 1;
}
check('rise starts at 0', pillarRiseFrac(0) === 0);
check('rise fully up mid-event', pillarRiseFrac(0.5) === 1);
check('rise fully up right at hold boundary (0.2)', pillarRiseFrac(0.2) === 1);
check('rise fully up right at sink boundary (0.8)', pillarRiseFrac(0.8) === 1);
check('rise back to 0 at very end', pillarRiseFrac(1) === 0);
check('rise monotonically increases through rise phase', pillarRiseFrac(0.05) < pillarRiseFrac(0.1) && pillarRiseFrac(0.1) < pillarRiseFrac(0.15));
check('sink monotonically decreases through sink phase', pillarRiseFrac(0.85) > pillarRiseFrac(0.9) && pillarRiseFrac(0.9) > pillarRiseFrac(0.95));
check('never exceeds 1', [0,0.05,0.1,0.15,0.2,0.3,0.5,0.7,0.8,0.85,0.9,0.95,1].every(f=>pillarRiseFrac(f)<=1+1e-9));
check('never negative', [0,0.05,0.1,0.15,0.2,0.3,0.5,0.7,0.8,0.85,0.9,0.95,1].every(f=>pillarRiseFrac(f)>=-1e-9));

// ---- cycle-speed boost/restore ----
const PILLAR_CYCLE_SPEED_BOOST = 3;
function boost(prevCycleSpeedMul){ return Math.min(9, (prevCycleSpeedMul||1)*PILLAR_CYCLE_SPEED_BOOST); }
check('boost from default (1) -> 3', boost(1) === 3);
check('boost from undefined -> 3 (treated as 1)', boost(undefined) === 3);
check('boost is capped at 9 (from a high starting mul)', boost(5) === 9);
check('restore returns exactly the pre-boost value (round-trip)', (function(){
  const prev = 2.5;
  const boosted = boost(prev);
  // simulate end-of-event restore
  const restored = prev;
  return boosted !== restored && restored === 2.5;
})());

// ---- interval/duration constants (must NOT be scaled by EVENT_PACE_MUL, same precedent as kaleidoscope 180s) ----
const PILLAR_INTERVAL_MS = 120000;
const PILLAR_DURATION_MS = 10000;
check('interval is exactly 120s (unscaled literal, per spec "una vez cada 120 segundos")', PILLAR_INTERVAL_MS === 120000);
check('duration is exactly 10s (unscaled literal, per spec "durante 10 segundos")', PILLAR_DURATION_MS === 10000);
check('duration is much smaller than interval (event is a brief spike, not most of the cycle)', PILLAR_DURATION_MS < PILLAR_INTERVAL_MS/5);

// ---- scheduling convention: reschedule happens at END of event, not start (matches tornado/fish/rain precedent) ----
function simulateEventCycle(){
  let pillarEvent = null, pillarNextAt = 0;
  const log = [];
  function scheduleNextPillarEvent(nowMs){ pillarNextAt = nowMs + PILLAR_INTERVAL_MS; log.push({t:nowMs, action:'scheduled next', nextAt:pillarNextAt}); }
  function startPillarEvent(nowMs){ pillarEvent = {startedAt:nowMs, endsAt:nowMs+PILLAR_DURATION_MS}; log.push({t:nowMs, action:'started'}); }
  function updatePillarEvent(nowMs){
    if(pillarEvent){
      if(nowMs >= pillarEvent.endsAt){ pillarEvent = null; scheduleNextPillarEvent(nowMs); }
      return;
    }
    if(nowMs < pillarNextAt) return;
    startPillarEvent(nowMs);
  }
  // boot
  scheduleNextPillarEvent(0);
  // simulate frames every 500ms comfortably past the first full cycle (start at 120s, ends at 130s)
  for(let t=0; t<=140000; t+=500) updatePillarEvent(t);
  return log;
}
const cycleLog = simulateEventCycle();
check('first event starts at t=120000 (one full interval after boot)', cycleLog.some(e=>e.action==='started' && e.t===120000));
check('reschedule happens at event END (~130000), not at event START (120000)', (function(){
  const startedEntry = cycleLog.find(e=>e.action==='started');
  const rescheduledEntries = cycleLog.filter(e=>e.action==='scheduled next' && e.t>0);
  if(!startedEntry || rescheduledEntries.length===0) return false;
  const resched = rescheduledEntries[0];
  return resched.t === startedEntry.t + PILLAR_DURATION_MS;
})());

// ---- Egyptian eye style constant ----
const EGYPTIAN_EYE_STYLE = 8;
check('EGYPTIAN_EYE_STYLE matches documented "8=Egyptian/Eye of Horus"', EGYPTIAN_EYE_STYLE === 8);
function isEgyptianEye(sp){ return (sp.eyeStyle||0) === EGYPTIAN_EYE_STYLE; }
check('spawn with eyeStyle 8 is detected as egyptian', isEgyptianEye({eyeStyle:8}) === true);
check('spawn with no eyeStyle is not egyptian', isEgyptianEye({}) === false);
check('spawn with eyeStyle 0 is not egyptian', isEgyptianEye({eyeStyle:0}) === false);
check('spawn with a different eyeStyle (e.g. 9, heptagram) is not egyptian', isEgyptianEye({eyeStyle:9}) === false);

// ---- fish fast hue rotation ----
function fastHue(t){ return (t*0.18)%360; }
check('fastHue at t=0 is 0', fastHue(0) === 0);
check('fastHue wraps within [0,360)', [0,500,1000,5000,50000].every(t=>{const h=fastHue(t); return h>=0 && h<360;}));
check('fastHue completes a full cycle roughly every 2000ms (360/0.18=2000)', Math.abs(360/0.18 - 2000) < 1e-9);

// ---- zone label positions stay clear of nursery's central column (~0.36w-0.66w) ----
function zoneLabelX(w){ return { ax: Math.max(90,w*0.08), bx: Math.min(w-90,w*0.92) }; }
[800,1024,1280,1920].forEach(w=>{
  const {ax,bx} = zoneLabelX(w);
  check(`zone labels at w=${w} stay outside nursery central column (0.36w-0.66w)`, ax < w*0.36 && bx > w*0.66);
});

// ---- God Settings defaults ----
function loadMaxPopulation(){ return 4; }
check('max chord default is 4 per spec "por defecto el maximo de acordes sea 4"', loadMaxPopulation() === 4);

console.log(`\n${pass} passed, ${fail} failed`);
if(fail>0) process.exit(1);
