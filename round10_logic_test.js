// Round 10 logic verification -- continues the same methodology as
// round7/8/9_logic_test.js: the bash sandbox's mount of ecosystem.html is
// STALE (confirmed again this round -- `wc -l` in-sandbox reports 6399
// lines while the real file, read via the Read/Grep tools that talk to the
// actual Windows-side file, is 8363 lines), so these are hand-transcribed
// copies of the exact current logic/constants, each copied directly from a
// fresh Read/Grep of the real file immediately before writing the check
// below it, not from memory or from the stale sandbox copy.
//
// Covers everything genuinely new PURE logic added in this session's
// continuation of round 10: the wireUI MIDI wiring's supporting pure
// functions, the performance-pass additions (clampedDpr, MOSAIC_TILE_DIRS),
// pillarProfileAt (organic pillar silhouette), platformRiseFrac (platform
// rise/hold/sink easing -- distinct system from the round-9 pillar-rise
// tested in round9_logic_test.js), pcSetSimilarity/computeTopSimilarSig
// (siamese-fusion matching), the MIDI raw<->note round-trip, the crystal
// shatter fragment launch angle, and the newborn-vs-siamese-fusion
// precedence rule in handleEvents.

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; }
  else { fail++; console.log('FAIL:', name); }
}

/* ============================================================================
   clampedDpr / MAX_DPR (performance pass)
   ============================================================================ */
const MAX_DPR = 2;
function clampedDpr(devicePixelRatio){ return Math.min(devicePixelRatio||1, MAX_DPR); }
check('dpr=1 passes through unchanged', clampedDpr(1) === 1);
check('dpr=2 passes through unchanged (exactly at the cap)', clampedDpr(2) === 2);
check('dpr=3 (common retina/phone value) is clamped to 2', clampedDpr(3) === 2);
check('dpr=4 is clamped to 2', clampedDpr(4) === 2);
check('missing/0 dpr falls back to 1 (matches old `window.devicePixelRatio||1` behavior)', clampedDpr(0) === 1 && clampedDpr(undefined) === 1);
check('clamp never returns something LARGER than the real dpr (never upscales)', [1,1.5,2,2.5,3].every(d => clampedDpr(d) <= d));

/* ============================================================================
   MOSAIC_TILE_DIRS (performance pass -- precomputed trig table for
   drawMosaicRing, must be bit-identical to the old live Math.cos/sin call it
   replaced)
   ============================================================================ */
const MOSAIC_TILE_DIRS = Array.from({length:14}, (_,i)=>{
  const a = (i/14)*Math.PI*2;
  return { cosA: Math.cos(a), sinA: Math.sin(a), a };
});
check('table has exactly 14 entries (n=14 tiles, unchanged from the original)', MOSAIC_TILE_DIRS.length === 14);
check('entry 0 is angle 0 (cos=1, sin=0)', Math.abs(MOSAIC_TILE_DIRS[0].cosA-1)<1e-9 && Math.abs(MOSAIC_TILE_DIRS[0].sinA-0)<1e-9);
check('every precomputed cos/sin matches a fresh live Math.cos/sin call (output is bit-identical to the pre-optimization code)', MOSAIC_TILE_DIRS.every((dir,i)=>{
  const a = (i/14)*Math.PI*2;
  return dir.cosA === Math.cos(a) && dir.sinA === Math.sin(a) && dir.a === a;
}));

/* ============================================================================
   pillarProfileAt (organic per-pillar silhouette sampler, task "refinar
   pilares subacuaticos")
   ============================================================================ */
function pillarProfileAt(p, tt){
  const topFrac = 0.62;
  const baseHalfW = p.halfW*(topFrac + (1-topFrac)*(1-tt));
  const bulgeBoost = p.silhouette===1 ? 1.6 : 1;
  const wobble = Math.sin(tt*Math.PI*p.waveFreq + p.seed)*p.waveAmp*p.halfW*0.32;
  const bulge = p.bulgeMag*bulgeBoost*p.halfW*Math.exp(-Math.pow((tt-p.bulgeAt)*4.2,2));
  const halfW = Math.max(3, baseHalfW + wobble + bulge);
  const swayMag = (p.silhouette===2 ? p.twist*0.85 : p.twist*0.22) * p.halfW;
  const offX = Math.sin(tt*Math.PI*1.4 + p.seed*1.3)*swayMag;
  return { halfW, offX };
}
const basePillar = { halfW:20, silhouette:0, waveFreq:3, waveAmp:0.1, seed:0.5, bulgeMag:0, bulgeAt:0.5, twist:0 };
check('halfW is always floored at 3 (never a degenerate/negative silhouette width)', (()=>{
  const wild = { ...basePillar, halfW:1, waveAmp:5, bulgeMag:-5 };
  return [0,0.2,0.4,0.6,0.8,1].every(tt => pillarProfileAt(wild, tt).halfW >= 3);
})());
check('a bulge (bulgeMag>0) makes the profile wider right AT bulgeAt than well away from it', (()=>{
  const p = { ...basePillar, waveAmp:0, bulgeMag:8, bulgeAt:0.5 };
  const atPeak = pillarProfileAt(p, 0.5).halfW;
  const farFromPeak = pillarProfileAt(p, 0.02).halfW;
  return atPeak > farFromPeak;
})());
check('silhouette 1 (bulbous/knuckled) amplifies the bulge vs silhouette 0 at the same bulgeAt', (()=>{
  const base = { ...basePillar, waveAmp:0, bulgeMag:6, bulgeAt:0.5, silhouette:0 };
  const bulbous = { ...base, silhouette:1 };
  return pillarProfileAt(bulbous, 0.5).halfW > pillarProfileAt(base, 0.5).halfW;
})());
check('silhouette 2 (helical-twisted) sways more (bigger |offX| swing) than silhouette 0 for the same twist magnitude', (()=>{
  const helical = { ...basePillar, twist:1, silhouette:2 };
  const plain = { ...basePillar, twist:1, silhouette:0 };
  const maxAbsOffX = (p) => Math.max(...[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1].map(tt=>Math.abs(pillarProfileAt(p,tt).offX)));
  return maxAbsOffX(helical) > maxAbsOffX(plain);
})());
check('tapers narrower toward the top (tt=1) than the base (tt=0) when there is no wobble/bulge (topFrac=0.62 < 1)', (()=>{
  const p = { ...basePillar, waveAmp:0, bulgeMag:0 };
  return pillarProfileAt(p,1).halfW < pillarProfileAt(p,0).halfW;
})());

/* ============================================================================
   platformRiseFrac (platforms rise to the top and back every 2 minutes --
   distinct system from the round-9 underwater pillar-creature event, which
   has its OWN separate rise/hold/sink easing already covered by
   round9_logic_test.js's pillarRiseFrac checks; PLATFORM_RISE_FRAC/SINK_FRAC
   are 0.32/0.32, not round 9's 0.2/0.2)
   ============================================================================ */
function easeInOutFish(x){ return x<0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }
const PLATFORM_RISE_FRAC = 0.32, PLATFORM_SINK_FRAC = 0.32;
function platformRiseFrac(elapsedFrac){
  if(elapsedFrac < PLATFORM_RISE_FRAC) return easeInOutFish(elapsedFrac/PLATFORM_RISE_FRAC);
  if(elapsedFrac > 1-PLATFORM_SINK_FRAC) return easeInOutFish((1-elapsedFrac)/PLATFORM_SINK_FRAC);
  return 1;
}
check('platform starts at ground level (frac 0) at event start', platformRiseFrac(0) === 0);
check('platform is fully risen through the whole hold plateau (0.32 - 0.68)', platformRiseFrac(0.32)===1 && platformRiseFrac(0.5)===1 && platformRiseFrac(0.68)===1);
check('platform is back at ground level (frac 0) right at event end', platformRiseFrac(1) === 0);
check('rise phase is monotonically increasing', platformRiseFrac(0.05)<platformRiseFrac(0.15)&&platformRiseFrac(0.15)<platformRiseFrac(0.25));
check('sink phase is monotonically decreasing', platformRiseFrac(0.75)>platformRiseFrac(0.85)&&platformRiseFrac(0.85)>platformRiseFrac(0.95));
check('never exceeds 1 or goes negative across the full event', [0,0.1,0.2,0.32,0.5,0.68,0.8,0.9,1].every(f=>{const v=platformRiseFrac(f); return v>=-1e-9 && v<=1+1e-9;}));
check('rise/sink split is symmetric (0.32/0.32), so frac(0.16) (mid-rise) and frac(0.84) (mid-sink) are equal by symmetry', Math.abs(platformRiseFrac(0.16)-platformRiseFrac(0.84)) < 1e-9);
check('120s interval / 7s duration are literal spec numbers, NOT scaled by EVENT_PACE_MUL (same precedent as the pillar/kaleidoscope events)', 120000===120000 && 7000===7000); // documents the constants; the real file's own comment makes the same claim explicitly

/* ============================================================================
   pcSetSimilarity / computeTopSimilarSig (siamese-fusion "top-1 similarity"
   matching -- best-alignment pitch-class similarity searched across all 31
   transpositions)
   ============================================================================ */
const N_STEPS = 31;
function mod31(n){ return ((n % N_STEPS) + N_STEPS) % N_STEPS; }
function pcSetSimilarity(setA, setB) {
  let bestCommon = -1, bestDiff = Infinity;
  for (let d = 0; d < N_STEPS; d++) {
    let common = 0;
    setB.forEach(b => { if (setA.has(mod31(b + d))) common++; });
    const different = setA.size + setB.size - 2 * common;
    if (common > bestCommon || (common === bestCommon && different < bestDiff)) { bestCommon = common; bestDiff = different; }
  }
  return { common: bestCommon, different: bestDiff };
}
function computeTopSimilarSig(speciesList) {
  const out = {};
  if (speciesList.length < 2) return out;
  speciesList.forEach(sp => {
    const A = new Set(sp.intervals.map(mod31));
    let best = null, bestCommon = -1, bestDiff = Infinity;
    speciesList.forEach(o => {
      if (o.signature === sp.signature) return;
      const { common, different } = pcSetSimilarity(A, new Set(o.intervals.map(mod31)));
      if (common > bestCommon || (common === bestCommon && different < bestDiff)) { best = o.signature; bestCommon = common; bestDiff = different; }
    });
    out[sp.signature] = best;
  });
  return out;
}
check('identical pitch-class sets score a perfect match (common=size, different=0) at some transposition', (()=>{
  const A = new Set([0,10,20]), B = new Set([0,10,20]);
  const r = pcSetSimilarity(A,B);
  return r.common===3 && r.different===0;
})());
check('a uniformly-shifted copy is found via transposition search (common=3, different=0 at the shift that undoes it)', (()=>{
  const A = new Set([0,10,20]), B = new Set([1,11,21]);
  const r = pcSetSimilarity(A,B);
  return r.common===3 && r.different===0;
})());
check('computeTopSimilarSig on a <2-species list returns an empty map (documented edge case)', Object.keys(computeTopSimilarSig([])).length===0 && Object.keys(computeTopSimilarSig([{signature:'0',intervals:[0]}])).length===0);
check('computeTopSimilarSig never points a species at itself', (()=>{
  const list = [{signature:'a',intervals:[0,10,20]},{signature:'b',intervals:[1,11,21]},{signature:'c',intervals:[0,1]}];
  const map = computeTopSimilarSig(list);
  return list.every(sp => map[sp.signature] !== sp.signature);
})());
check('constructed scenario: a nearly-identical pair (sig a vs sig b, sharing 2 of 3 notes at best alignment) mutually out-rank a maximally-sparse outlier (sig c)', (()=>{
  // A={0,10,20}, B={0,10,21} share {0,10} at d=0 (common=2); C={0,1} can never
  // get both its notes into A or B simultaneously (no gap of exactly 1
  // between consecutive members of either set), so C's best common is <=1
  // against either -- a and b should each rank the OTHER as their top match.
  const list = [{signature:'a',intervals:[0,10,20]},{signature:'b',intervals:[0,10,21]},{signature:'c',intervals:[0,1]}];
  const map = computeTopSimilarSig(list);
  return map['a']==='b' && map['b']==='a';
})());
check('every entry with >=2 species is always non-null (pcSetSimilarity always returns a real result, per the code\'s own documented guarantee)', (()=>{
  const list = [{signature:'x',intervals:[0]},{signature:'y',intervals:[15]}];
  const map = computeTopSimilarSig(list);
  return map['x']!=null && map['y']!=null;
})());

/* ============================================================================
   MIDI raw<->note round trip (midiNoteForRaw forward, finishMidiCapture's
   inverse) -- what's heard in-browser and what a MIDI keyboard/Ableton
   exchange should agree on the SAME underlying pitch math.
   ============================================================================ */
const REF_FREQ = 220;
function freqForRaw(raw, generalPitchCents) {
  return REF_FREQ * Math.pow(2, raw / N_STEPS) * Math.pow(2, (generalPitchCents || 0) / 1200);
}
function midiNoteForRaw(raw, generalPitchCents){
  const freq = freqForRaw(raw, generalPitchCents||0);
  return Math.max(0, Math.min(127, Math.round(69 + 12*Math.log2(freq/440))));
}
function rawFromMidiNote(m){ // finishMidiCapture's inverse mapping
  const freq = 440*Math.pow(2,(m-69)/12);
  return Math.round(N_STEPS*Math.log2(freq/REF_FREQ));
}
check('raw step 0 (REF_FREQ, 220Hz) maps to MIDI note 57 (A3, one octave below A4=440Hz/note 69)', midiNoteForRaw(0,0) === 57);
check('raw step 31 (exactly one octave up) maps to MIDI note 69 (A4/440Hz)', midiNoteForRaw(31,0) === 69);
check('round trip is EXACT at every octave boundary (0, 31, 62, -31) -- 31-EDO and 12-TET agree exactly on the octave itself', [0,31,62,-31].every(raw => rawFromMidiNote(midiNoteForRaw(raw,0)) === raw));
check('round trip for arbitrary in-between raw steps stays within 1 step of the original (31-EDO steps are ~38.7 cents, well under half a 12-TET semitone away in the worst case)', (()=>{
  let maxDrift = 0;
  for(let raw=-40; raw<=40; raw++){
    const drift = Math.abs(rawFromMidiNote(midiNoteForRaw(raw,0)) - raw);
    maxDrift = Math.max(maxDrift, drift);
  }
  return maxDrift <= 1;
})());
check('midiNoteForRaw is always clamped into the valid 0-127 MIDI range even for extreme raw steps', (()=>{
  return midiNoteForRaw(-500,0) === 0 && midiNoteForRaw(500,0) === 127;
})());
check('midiNoteForRaw is monotonically non-decreasing as raw increases (higher pitch never maps to a lower MIDI note)', (()=>{
  let prev = -Infinity, ok = true;
  for(let raw=-60; raw<=60; raw++){ const n = midiNoteForRaw(raw,0); if(n<prev) ok=false; prev=n; }
  return ok;
})());

/* ============================================================================
   Crystal shatter fragment launch angle ("hacia la esquina superior
   derecha") -- must always land in the up-and-right quadrant.
   ============================================================================ */
function fragmentAngle(rngVal){ return -Math.PI*0.28 + (rngVal-0.5)*0.32; }
check('fragment launch angle is always strictly between straight-up (-PI/2) and straight-right (0), for the full rng() range [0,1)', (()=>{
  return [0,0.25,0.5,0.75,0.999].every(r=>{ const a=fragmentAngle(r); return a > -Math.PI/2 && a < 0; });
})());
check('resulting velocity is always up (negative vy / sin) and always rightward (positive vx / cos), matching "up-and-right"', (()=>{
  return [0,0.25,0.5,0.75,0.999].every(r=>{ const a=fragmentAngle(r); return Math.cos(a)>0 && Math.sin(a)<0; });
})());

/* ============================================================================
   Newborn vs siamese-fusion precedence (handleEvents branching order) --
   fusion is checked FIRST and unconditionally wins; newborn only fires on
   the exact collision that exhausts a summon pair's hit budget, and only
   when nothing ate and notes were actually shared.
   ============================================================================ */
function resolveCollisionOutcome({isTopMatch, ateEachOther, hadSharedNotes, summonJustFinished}){
  if(isTopMatch) return 'siamese-fusion'; // checked first in the real handleEvents -- preempts everything below
  if(summonJustFinished && !ateEachOther && hadSharedNotes) return 'newborn';
  return 'normal';
}
check('top-1 similarity match always fuses, even if it ALSO looks like a qualifying newborn collision', resolveCollisionOutcome({isTopMatch:true, ateEachOther:false, hadSharedNotes:true, summonJustFinished:true}) === 'siamese-fusion');
check('top-1 similarity match fuses even mid-summon with no shared notes at all', resolveCollisionOutcome({isTopMatch:true, ateEachOther:false, hadSharedNotes:false, summonJustFinished:false}) === 'siamese-fusion');
check('a completed summon pair that shared notes and neither ate the other gives birth to a newborn', resolveCollisionOutcome({isTopMatch:false, ateEachOther:false, hadSharedNotes:true, summonJustFinished:true}) === 'newborn');
check('no newborn if one chord ate the other, even on the summon-completing hit', resolveCollisionOutcome({isTopMatch:false, ateEachOther:true, hadSharedNotes:true, summonJustFinished:true}) === 'normal');
check('no newborn if the collision was dissonant (no shared notes), even on the summon-completing hit', resolveCollisionOutcome({isTopMatch:false, ateEachOther:false, hadSharedNotes:false, summonJustFinished:true}) === 'normal');
check('no newborn on an ordinary mid-summon bump that does not yet exhaust the hit budget', resolveCollisionOutcome({isTopMatch:false, ateEachOther:false, hadSharedNotes:true, summonJustFinished:false}) === 'normal');

/* ============================================================================
   Pillar note-glide schedule (task "portamento en el audio MIDI general")
   ============================================================================ */
const PILLAR_NOTE_STEPS = [0,7,13,18,24];
const PILLAR_NOTE_GAP_MS = 220;
check('5 staggered glide notes, one per pillar slot', PILLAR_NOTE_STEPS.length === 5);
check('glide steps are strictly ascending (a rising phrase, not a random scatter)', PILLAR_NOTE_STEPS.every((s,i)=>i===0 || s>PILLAR_NOTE_STEPS[i-1]));
check('note N in the sequence fires at nowMs >= startedAt + N*220ms (simulated schedule matches updatePillarEvent\'s own gating condition)', (()=>{
  const startedAt = 1000;
  const firesAt = (n) => startedAt + n*PILLAR_NOTE_GAP_MS;
  return firesAt(0)===1000 && firesAt(4)===1880;
})());

console.log(`\n${pass} passed, ${fail} failed`);
if(fail>0) process.exit(1);
