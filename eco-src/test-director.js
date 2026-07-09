const { resolveCollision, computeChordRawNotes, randomNonZeroInt } = require('./director.js');
const { makeRng } = require('./util.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

function baseCtx(overrides) {
  return Object.assign({
    zoneRootFor: (zone) => (zone === 'B' ? 18 : 0),
    nightSteps: 0,
    rng: makeRng(7),
    getAmbientNotes: () => null,
    timbre: 'guitar',
  }, overrides || {});
}
function chord(id, intervals, extra) {
  return Object.assign({ kind: 'chord', id, intervals, transposeOffset: 0, zone: 'A' }, extra || {});
}
function obj(id, objectType, extra) {
  return Object.assign({ kind: 'object', id, objectType }, extra || {});
}

// ---- chord vs chord: sharing notes -> strum just the shared subset ----
{
  const a = chord('a', [0, 10, 18]); // pcs {0,10,18}
  const b = chord('b', [0, 10]);     // pcs {0,10} -- subset of a, so also triggers eat
  const actions = resolveCollision(a, b, baseCtx());
  const strum = actions.find(x => x.type === 'strum');
  ok('shared notes -> a strum action exists', !!strum);
  ok('strum contains exactly the shared pitch classes (0 and 10, not 18)', new Set(strum.notes).size === 2 && strum.notes.includes(0) && strum.notes.includes(10) && !strum.notes.includes(18));
  const eat = actions.find(x => x.type === 'eat');
  ok('b is a strict subset of a -> eat action with a as eater', !!eat && eat.eaterId === 'a' && eat.eatenId === 'b');
}

// ---- chord vs chord: no shared notes -> noise tick, no eat ----
{
  const a = chord('a', [0, 10, 18]);      // pcs {0,10,18}
  const b = chord('b', [3, 9], { zone: 'A' }); // pcs {3,9} -- disjoint
  const actions = resolveCollision(a, b, baseCtx());
  ok('disjoint chords -> exactly a noise action, no strum, no eat', actions.length === 1 && actions[0].type === 'noise');
}

// ---- chord vs chord: identical pitch-class sets -> strum everything, but NOT eat (not a STRICT superset) ----
{
  const a = chord('a', [0, 10, 18]);
  const b = chord('b', [0, 10, 18]);
  const actions = resolveCollision(a, b, baseCtx());
  const strum = actions.find(x => x.type === 'strum');
  ok('identical chords share all 3 notes', strum && new Set(strum.notes).size === 3);
  ok('identical chords do NOT eat each other (equal is not strictly bigger)', !actions.find(x => x.type === 'eat'));
}

// ---- zone anchoring actually changes which notes sound ----
{
  const a = chord('a', [0, 10], { zone: 'A' });
  const b = chord('b', [0, 10], { zone: 'B' }); // zone B root = 18 in this ctx
  const notesA = computeChordRawNotes(a, baseCtx());
  const notesB = computeChordRawNotes(b, baseCtx());
  ok('zone A chord anchors at root 0', JSON.stringify(notesA) === JSON.stringify([0, 10]));
  ok('zone B chord anchors at the zone-B root (18), not 0', JSON.stringify(notesB) === JSON.stringify([18, 28]));
}

// ---- night transposition shifts everything by the moon phase step count ----
{
  const a = chord('a', [0, 10], { zone: 'A' });
  const notesNight = computeChordRawNotes(a, baseCtx({ nightSteps: 5 }));
  ok('night steps shift the whole chord', JSON.stringify(notesNight) === JSON.stringify([5, 15]));
}

// ---- 1. Strum object ----
{
  const c = chord('c', [0, 4, 7]);
  const actions = resolveCollision(c, obj('o1', 'strum'), baseCtx());
  ok('strum object -> exactly one strum action with the full chord', actions.length === 1 && actions[0].type === 'strum' && actions[0].notes.length === 3);
  // order shouldn't matter
  const actions2 = resolveCollision(obj('o1', 'strum'), c, baseCtx());
  ok('collision order (object first) gives the same result', JSON.stringify(actions2) === JSON.stringify(actions));
}

// ---- 2. Pad-hold object ----
{
  const c = chord('c', [0, 4, 7]);
  const actions = resolveCollision(c, obj('padA', 'padhold'), baseCtx());
  ok('padhold -> exactly one startAmbient action', actions.length === 1 && actions[0].type === 'startAmbient');
  ok('startAmbient carries the full chord notes', actions[0].notes.length === 3);
  ok('startAmbient remembers which object/chord produced it (for UI)', actions[0].objectId === 'padA' && actions[0].sourceChordId === 'c');
}

// ---- 3. Common-tones object ----
{
  const c = chord('c', [0, 4, 7]); // pcs {0,4,7}
  const withOverlap = resolveCollision(c, obj('ct', 'commontones'), baseCtx({ getAmbientNotes: () => [7, 11] })); // ambient pcs {7,11}
  ok('common-tones with overlap -> strums only the shared note (7)', withOverlap.length === 1 && withOverlap[0].type === 'strum' && JSON.stringify(withOverlap[0].notes) === JSON.stringify([7]));

  const nothingAudible = resolveCollision(c, obj('ct', 'commontones'), baseCtx({ getAmbientNotes: () => null }));
  ok('common-tones with nothing audible -> strums the FULL chord', nothingAudible.length === 1 && nothingAudible[0].type === 'strum' && nothingAudible[0].notes.length === 3);

  const zeroOverlap = resolveCollision(c, obj('ct', 'commontones'), baseCtx({ getAmbientNotes: () => [1, 2] })); // pcs {1,2}, disjoint from {0,4,7}
  ok('common-tones with audible-but-zero-overlap -> noise tick (mirrors chord-vs-chord rule)', zeroOverlap.length === 1 && zeroOverlap[0].type === 'noise');
}

// ---- 4. Launcher object ----
{
  const c = chord('c', [0, 4, 7]);
  const actions = resolveCollision(c, obj('L', 'launcher'), baseCtx());
  const launch = actions.find(x => x.type === 'launch');
  ok('launcher -> a launch action targeting the chord', !!launch && launch.id === 'c');
  ok('launch has a nonzero velocity (real force, not a nudge)', Math.hypot(launch.vx, launch.vy) > 100);
  ok('launcher also gives an audible confirmation strum', !!actions.find(x => x.type === 'strum'));
  // random direction: different rng draws should (almost always) give different angles
  const a2 = resolveCollision(chord('c2', [0]), obj('L', 'launcher'), baseCtx({ rng: makeRng(999) })).find(x => x.type === 'launch');
  ok('launcher direction is randomized (different seed -> different vector)', a2.vx !== launch.vx || a2.vy !== launch.vy);
}

// ---- 5. Transposer object ----
{
  const c = chord('c', [0, 4, 7]);
  const actions = resolveCollision(c, obj('T', 'transposer'), baseCtx());
  const tr = actions.find(x => x.type === 'setTransposeOffset');
  ok('transposer -> a setTransposeOffset action', !!tr && tr.id === 'c');
  ok('transpose amount is a nonzero integer step', Number.isInteger(tr.transposeOffset) && tr.transposeOffset !== 0);
  const strum = actions.find(x => x.type === 'strum');
  ok('transposer confirmation strum reflects the NEW transposed pitch, not the old one', strum.notes[0] === tr.transposeOffset + 0);
}
{
  // randomNonZeroInt itself: never zero, always within span, both signs reachable
  const rng = makeRng(2024);
  let sawNeg = false, sawPos = false, sawZero = false;
  for (let i = 0; i < 500; i++) {
    const v = randomNonZeroInt(rng, 31);
    if (v === 0) sawZero = true;
    if (v < 0) sawNeg = true;
    if (v > 0) sawPos = true;
    if (v < -31 || v > 31) throw new Error('out of span: ' + v);
  }
  ok('randomNonZeroInt never returns 0 across 500 draws', !sawZero);
  ok('randomNonZeroInt reaches both negative and positive values', sawNeg && sawPos);
}

// ---- object vs object: no game logic, empty actions ----
{
  const actions = resolveCollision(obj('o1', 'strum'), obj('o2', 'launcher'), baseCtx());
  ok('object-vs-object collision yields no director actions', actions.length === 0);
}

console.log(`director layer: ${pass} assertions passed`);
