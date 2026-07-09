const {
  blackHolePull, createTornado, tornadoPositionAt, tornadoForceOn,
  pcSetFromIntervals, isStrictSupersetSet, pickHuntTarget, huntSteer,
  pickSummonPair, summonPull, borderProximityState, didCrossBorder,
  chordsWithinRadius, sharedPitchClassesAcross, arpeggioRawNotesOctave3to5,
  pickPitchVarianceCents,
} = require('./forces.js');
const { makeRng } = require('./util.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

// ---- blackHolePull ----
{
  const near = blackHolePull(100, 100, 110, 100, {});
  ok('pull points toward the hole (positive x when hole is to the right)', near.fx > 0 && Math.abs(near.fy) < 1e-6);
  const far = blackHolePull(0, 0, 10000, 0, { maxDist: 260 });
  ok('no pull at all beyond maxDist', far.fx === 0 && far.fy === 0);
  const veryClose = blackHolePull(100, 100, 101, 100, { maxAccel: 500 });
  const closeMag = Math.hypot(veryClose.fx, veryClose.fy);
  ok('pull magnitude is capped at maxAccel even extremely close (no singularity blowup)', closeMag <= 500 + 1e-6);
  const d1 = blackHolePull(0, 0, 200, 0, { maxDist: 260, minDist: 1 });
  const d2 = blackHolePull(0, 0, 80, 0, { maxDist: 260, minDist: 1 });
  ok('pull is stronger when closer (monotonic falloff with distance)', Math.hypot(d2.fx, d2.fy) > Math.hypot(d1.fx, d1.fy));
}

// ---- tornado ----
{
  const rng = makeRng(7);
  const t0 = createTornado(1.0, 900, 600, 1000, 15000, rng);
  ok('tornado spawns moving right-to-left (negative vx)', t0.vx < 0);
  const posEarly = tornadoPositionAt(t0, t0.bornAt);
  const posLater = tornadoPositionAt(t0, t0.bornAt + 5000);
  ok('tornado x position decreases over time (moves left)', posLater.x < posEarly.x);
  const insideForce = tornadoForceOn(t0.x + 10, t0.y, t0.x, t0.y, t0.radius, {});
  const outsideForce = tornadoForceOn(t0.x + t0.radius + 500, t0.y, t0.x, t0.y, t0.radius, {});
  ok('a body well outside the tornado radius feels nothing', outsideForce.fx === 0 && outsideForce.fy === 0);
  ok('a body inside the tornado radius feels a nonzero force', Math.hypot(insideForce.fx, insideForce.fy) > 0);
}

// ---- hunting ----
{
  const hunter = { id: 'h', intervals: [0, 4, 7, 10], x: 0, y: 0 };
  const eatable = { id: 'small', intervals: [0, 4], x: 30, y: 0 };
  const notEatable = { id: 'disjoint', intervals: [1, 5], x: 5, y: 0 }; // closer, but not a subset -- must be ignored
  const farEatable = { id: 'far', intervals: [0, 7], x: 500, y: 0 };
  const target = pickHuntTarget(hunter, [hunter, eatable, notEatable, farEatable]);
  ok('hunts the nearest chord it would actually eat, ignoring closer non-eatable ones and itself', target.id === 'small');
  const none = pickHuntTarget(hunter, [notEatable]);
  ok('returns null when nothing in range is eatable', none === null);
  const steer = huntSteer(0, 0, 100, 0, {});
  ok('steers toward the target', steer.fx > 0 && Math.abs(steer.fy) < 1e-6);
}

// ---- summon ----
{
  const rng = makeRng(3);
  const chords = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const pair = pickSummonPair(chords, rng);
  ok('summon picks exactly 2 distinct chords', pair.length === 2 && pair[0].id !== pair[1].id);
  ok('summon returns null with fewer than 2 chords available', pickSummonPair([{ id: 'only' }], rng) === null);
  const pull = summonPull(0, 0, 50, 0, {});
  ok('summon pulls toward the other chord', pull.fx > 0);
}

// ---- border proximity / crossing ----
{
  ok('inside the near threshold counts as close to the border', borderProximityState(495, 500, 12) === true);
  ok('outside the near threshold does not', borderProximityState(300, 500, 12) === false);
  ok('crossing detected when side actually flips', didCrossBorder('A', 'B') === true);
  ok('no crossing when side stays the same', didCrossBorder('A', 'A') === false);
  ok('no crossing when either side is not yet established', didCrossBorder(null, 'B') === false);
}

// ---- common-tones area ----
{
  const objPos = { x: 0, y: 0 };
  const chordsNear = [{ id: 'a', x: 10, y: 0 }, { id: 'b', x: -10, y: 0 }, { id: 'c', x: 500, y: 0 }];
  const inRange = chordsWithinRadius(objPos.x, objPos.y, 50, chordsNear);
  ok('area filter includes only chords within the radius', inRange.length === 2 && inRange.every(c => c.id !== 'c'));

  ok('fewer than 2 chords in range -> no shared notes at all', sharedPitchClassesAcross([[0, 4, 7]]).length === 0);
  const shared = sharedPitchClassesAcross([[0, 4, 7], [4, 7, 11], [4, 15]]);
  ok('shared pitch classes across 3 chords is exactly their common intersection', shared.length === 1 && shared[0] === 4);
  const disjointShared = sharedPitchClassesAcross([[0, 4], [10, 15]]);
  ok('completely disjoint chords in range share nothing', disjointShared.length === 0);
}

// ---- landing arpeggio note mapping ----
{
  const single = arpeggioRawNotesOctave3to5([5]);
  ok('single-note chord: just that pitch class in octave 3', single.length === 1 && single[0] === 5);

  const chord = arpeggioRawNotesOctave3to5([0, 10, 18]);
  ok('multi-note chord: one raw value per distinct pitch class', chord.length === 3);
  ok('first note lands in octave 3 range [0,31)', chord[0] >= 0 && chord[0] < 31);
  ok('last note lands in octave 5 range [62,93)', chord[chord.length - 1] >= 62 && chord[chord.length - 1] < 93);
  let ascending = true;
  for (let i = 1; i < chord.length; i++) if (!(chord[i] > chord[i - 1])) ascending = false;
  ok('sequence is strictly ascending start to finish', ascending);

  const bigChord = arpeggioRawNotesOctave3to5([0, 3, 8, 12, 17, 22, 27]);
  ok('larger chords still span exactly octave3->octave5 ascending', bigChord[0] < 31 && bigChord[bigChord.length - 1] >= 62 && bigChord[bigChord.length - 1] < 93);

  const dupes = arpeggioRawNotesOctave3to5([0, 31, 62, 5]); // 0, 31, 62 all fold to pitch class 0 -- must dedupe
  ok('duplicate pitch classes (from octave-shifted raw intervals) collapse to one entry', dupes.length === 2);
}

// ---- pitch variance ----
{
  const rng = makeRng(11);
  for (let i = 0; i < 200; i++) {
    const c = pickPitchVarianceCents(rng);
    ok('pitch variance stays within a small, non-mistuning +/-12 cent bound', c >= -12 && c <= 12);
  }
}

console.log(`forces layer: ${pass} assertions passed`);
