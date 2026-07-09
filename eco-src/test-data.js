const assert = require('assert');
const {
  mod31, effectiveIntervals, computeSpecies, findSpeciesContains,
  computeMostCommonChordPair, computeZoneBGap, FALLBACK_ZONE_GAP,
  annotateBigSpecies, freqForRaw,
} = require('./data.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

// ---- mod31 ----
ok('mod31 basic', mod31(0) === 0 && mod31(31) === 0 && mod31(32) === 1);
ok('mod31 negative', mod31(-1) === 30 && mod31(-31) === 0 && mod31(-32) === 30);

// ---- effectiveIntervals ----
ok('effectiveIntervals off keeps raw sorted', JSON.stringify(effectiveIntervals([18, 0, 41], false)) === JSON.stringify([0, 18, 41]));
ok('effectiveIntervals on folds+dedupes', JSON.stringify(effectiveIntervals([0, 18, 31, 49], true)) === JSON.stringify([0, 18]));

// ---- fixture collection ----
// Shape T (triad)      = [0,10,18]         -> occurs 4x (prog1 x2, prog2 x2)
// Shape F (five-note)  = [0,4,10,18,24]    -> occurs 2x (prog1, prog2), contains T and D
// Shape D (dyad)       = [0,10]            -> occurs 1x (prog3), contained by T and F
const prog1 = { id: 'p1', name: 'Prog 1', chords: [
  { root: 0, intervals: [0, 10, 18] },
  { root: 5, intervals: [0, 10, 18] },
  { root: 0, intervals: [0, 4, 10, 18, 24] },
]};
const prog2 = { id: 'p2', name: 'Prog 2', chords: [
  { root: 5, intervals: [0, 10, 18] },
  { root: 23, intervals: [0, 10, 18] },
  { root: 5, intervals: [0, 4, 10, 18, 24] },
]};
const prog3 = { id: 'p3', name: 'Prog 3', chords: [
  { root: 0, intervals: [0, 10] },
]};
const baseProgs = [prog1, prog2, prog3];

const species = computeSpecies(baseProgs, false);
ok('3 distinct species', species.list.length === 3);
const byIvs = sig => species.list.find(sp => sp.signature === sig.join('.'));
const T = byIvs([0, 10, 18]), F = byIvs([0, 4, 10, 18, 24]), D = byIvs([0, 10]);
ok('T,F,D all found', !!T && !!F && !!D);
ok('T count 4', T.count === 4);
ok('F count 2', F.count === 2);
ok('D count 1', D.count === 1);

// ---- findSpeciesContains ----
const containsF = findSpeciesContains(F, species.list).map(s => s.signature).sort();
ok('F contains T and D', JSON.stringify(containsF) === JSON.stringify([D.signature, T.signature].sort()));
const containsT = findSpeciesContains(T, species.list).map(s => s.signature);
ok('T contains D only', JSON.stringify(containsT) === JSON.stringify([D.signature]));
const containsD = findSpeciesContains(D, species.list);
ok('D contains nothing', containsD.length === 0);

// ---- annotateBigSpecies (top-third by containCount, "big" chosen definition) ----
annotateBigSpecies(species.list);
ok('F containCount 2', F.containCount === 2);
ok('T containCount 1', T.containCount === 1);
ok('D containCount 0', D.containCount === 0);
ok('F is big', F.isBig === true);
ok('T is not big', T.isBig === false);
ok('D is not big', D.isBig === false);

// ---- computeMostCommonChordPair: base fixture has no pair repeated >=2x ----
ok('no strict pair in base fixture', computeMostCommonChordPair(baseProgs, false) === null);
// fallback should still return a real, present gap (5), not the neutral default
ok('fallback gap uses most-common-any-count gap (5)', computeZoneBGap(baseProgs, false) === 5);
// truly empty / no-consecutive-chord collection falls all the way back
ok('empty collection uses neutral fallback', computeZoneBGap([{ id: 'x', chords: [{ root: 0, intervals: [0] }] }], false) === FALLBACK_ZONE_GAP);

// ---- augmented fixture: duplicate prog1 so "T -> T @ gap 5" repeats >=2x ----
const prog4 = { id: 'p4', name: 'Prog 4', chords: prog1.chords.map(c => ({ ...c })) };
const augProgs = [prog1, prog2, prog3, prog4];
const best = computeMostCommonChordPair(augProgs, false);
ok('strict pair found once repeated', best !== null && best.count === 2);
ok('strict pair gap is 5', best.gap === 5);
ok('computeZoneBGap matches strict pair', computeZoneBGap(augProgs, false) === 5);

// ---- freqForRaw ----
ok('freqForRaw(0,0) = REF_FREQ', Math.abs(freqForRaw(0, 0) - 220) < 1e-9);
ok('freqForRaw(31,0) = one octave up', Math.abs(freqForRaw(31, 0) - 440) < 1e-9);
ok('freqForRaw(0,1200) = one octave up via cents', Math.abs(freqForRaw(0, 1200) - 440) < 1e-9);
ok('freqForRaw is monotonic in raw', freqForRaw(5, 0) < freqForRaw(6, 0));

// ---- qrOffsets carries through computeSpecies (needed for hex-map creature layout) ----
const progWithQr = { id:'pq', name:'Q', chords:[
  { root:0, intervals:[0,10,18], qrOffsets:[{q:0,r:0},{q:1,r:-1},{q:2,r:-2}] },
  { root:0, intervals:[0,5], qrOffsets:[{q:0,r:0}] }, // mismatched length -> should be discarded (null)
]};
const spQr = computeSpecies([progWithQr], false);
const withQr = spQr.list.find(s=>s.signature==='0.10.18');
const withoutQr = spQr.list.find(s=>s.signature==='0.5');
ok('qrOffsets carried through when length matches rawIntervals', JSON.stringify(withQr.qrOffsets)===JSON.stringify([{q:0,r:0},{q:1,r:-1},{q:2,r:-2}]));
ok('mismatched-length qrOffsets is discarded as null (matches main app behavior)', withoutQr.qrOffsets===null);

// ---- pitchAt / axialToPixel (verbatim port) ----
const { pitchAt, axialToPixel, computeChordLayout } = require('./data.js');
ok('pitchAt(0,0)=0', pitchAt(0,0)===0);
ok('pitchAt(1,0)=8', pitchAt(1,0)===8);
ok('pitchAt(0,1)=3', pitchAt(0,1)===3);
ok('axialToPixel(0,0,size) is always the origin', axialToPixel(0,0,20).x===0 && axialToPixel(0,0,20).y===0);

// ---- computeChordLayout: root always lands at local (0,0); farthest point sits exactly at targetSpan ----
{
  const rawIntervals = [0,10,18];
  const qrOffsets = [{q:0,r:0},{q:1,r:-1},{q:2,r:-2}];
  const layout = computeChordLayout(rawIntervals, qrOffsets, 40);
  ok('layout has one point per interval', layout.length===3);
  ok('root (index of raw 0) sits exactly at local origin', layout[0].x===0 && layout[0].y===0);
  const dists = layout.map(p=>Math.hypot(p.x,p.y));
  ok('farthest point from root is normalized to exactly targetSpan', Math.abs(Math.max(...dists)-40)<1e-9);
  ok('relative shape/topology preserved (point 2 is exactly 2x point 1 distance, matching qr spacing)', Math.abs(dists[2]-2*dists[1])<1e-6);
}
{
  // fallback path: no qrOffsets -> evenly spaced radial, root still at origin, all others at targetSpan
  const layout = computeChordLayout([0,4,7,10], null, 30);
  ok('fallback: root at origin', layout[0].x===0 && layout[0].y===0);
  ok('fallback: every non-root point sits at exactly targetSpan from root', layout.slice(1).every(p=>Math.abs(Math.hypot(p.x,p.y)-30)<1e-9));
  const angles = layout.slice(1).map(p=>Math.atan2(p.y,p.x));
  ok('fallback: non-root points are at distinct angles (spread out, not stacked)', new Set(angles.map(a=>a.toFixed(3))).size===angles.length);
}
{
  // single-note chord (root only) -> no crash, empty spread
  const layout = computeChordLayout([0], null, 30);
  ok('single-note chord: just the root at origin, no others', layout.length===1 && layout[0].x===0 && layout[0].y===0);
}

console.log(`data layer: ${pass} assertions passed`);
