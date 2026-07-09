const { resolveCollision } = require('./director-final.js');
const { applyActions } = require('./applyActions-final.js');
const { createAudioPort, createMockDriver } = require('./audioPort-final.js');
const { createWorld, addBody, findBody, removeBody, stepWorld } = require('./physics-final.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

function makeCtx(overrides) {
  return Object.assign({
    zoneRootFor: (z) => (z === 'B' ? 18 : 0),
    nightSteps: 0,
    rng: () => 0.5,
    getAmbientNotes: () => null,
    timbre: 'guitar',
  }, overrides || {});
}

// ---- blackhole collision: bounces the chord away with a noise, not a strum ----
{
  const world = createWorld({ width: 400, height: 400 });
  const chord = addBody(world, { kind: 'chord', id: 'c1', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 110, y: 100, radius: 15, gravity: false, vx: 0, vy: 0 });
  const hole = addBody(world, { kind: 'object', id: 'obj_blackhole', objectType: 'blackhole', x: 100, y: 100, radius: 20, gravity: false });
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  const actions = resolveCollision(chord, hole, makeCtx());
  applyActions(actions, { world, physics: { findBody, removeBody }, audioPort: port });
  ok('blackhole collision launches the chord (real velocity applied)', Math.hypot(chord.vx, chord.vy) > 0);
  ok('blackhole collision plays a noise, not a melodic strum', driver.calls.some(c => c.type === 'noise') && !driver.calls.some(c => c.type === 'oneshot'));
  ok('blackhole launch direction points away from the hole', chord.vx > 0); // chord was to the right of the hole
}

// ---- common-tones: direct collision no longer triggers any special action ----
{
  const world = createWorld({ width: 400, height: 400 });
  const chord = addBody(world, { kind: 'chord', id: 'c2', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 15, gravity: false });
  const obj = addBody(world, { kind: 'object', id: 'obj_commontones', objectType: 'commontones', x: 105, y: 100, radius: 20, gravity: false });
  const actions = resolveCollision(chord, obj, makeCtx());
  ok('touching common-tones directly no longer produces any game-logic action (it is now a pure area effect)', actions.length === 0);
}

// ---- strum actions now carry chordId, and applyActions threads pitchVarianceCents through as extraCents ----
{
  const world = createWorld({ width: 400, height: 400 });
  const chord = addBody(world, { kind: 'chord', id: 'c3', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 15, gravity: false, pitchVarianceCents: 7.5 });
  const obj = addBody(world, { kind: 'object', id: 'obj_strum', objectType: 'strum', x: 105, y: 100, radius: 20, gravity: false });
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  const actions = resolveCollision(chord, obj, makeCtx());
  ok('strum action from a chord-vs-strum-object collision carries the chord id', actions.some(a => a.type === 'strum' && a.chordId === 'c3'));
  applyActions(actions, { world, physics: { findBody, removeBody }, audioPort: port });
  const oneshot = driver.calls.find(c => c.type === 'oneshot');
  ok('the driver actually receives that chord\'s pitchVarianceCents as extraCents', oneshot && oneshot.extraCents === 7.5);
}
{
  // chord-vs-chord strum also carries a chordId (chord A, by convention)
  const world = createWorld({ width: 400, height: 400 });
  const a = addBody(world, { kind: 'chord', id: 'ca', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 15, gravity: false, pitchVarianceCents: -4 });
  const b = addBody(world, { kind: 'chord', id: 'cb', intervals: [4, 7], zone: 'A', transposeOffset: 0, x: 105, y: 100, radius: 15, gravity: false });
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  const actions = resolveCollision(a, b, makeCtx());
  applyActions(actions, { world, physics: { findBody, removeBody }, audioPort: port });
  const oneshot = driver.calls.find(c => c.type === 'oneshot');
  ok('chord-vs-chord strum also threads the (first) chord\'s pitchVarianceCents through', oneshot && oneshot.extraCents === -4);
}

// ---- startAmbient also threads the source chord's pitchVarianceCents ----
{
  const world = createWorld({ width: 400, height: 400 });
  const chord = addBody(world, { kind: 'chord', id: 'c4', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 15, gravity: false, pitchVarianceCents: 3 });
  const obj = addBody(world, { kind: 'object', id: 'obj_padhold', objectType: 'padhold', x: 105, y: 100, radius: 20, gravity: false });
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  const actions = resolveCollision(chord, obj, makeCtx());
  applyActions(actions, { world, physics: { findBody, removeBody }, audioPort: port });
  const sustain = driver.calls.find(c => c.type === 'startSustain');
  ok('pad-hold ambient also carries the source chord\'s pitchVarianceCents', sustain && sustain.extraCents === 3);
}

// ---- onEatStart hook wired through the real pipeline end to end ----
{
  const world = createWorld({ width: 400, height: 400 });
  const big = addBody(world, { kind: 'chord', id: 'big', intervals: [0, 4, 7, 10], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 20, gravity: false });
  const small = addBody(world, { kind: 'chord', id: 'small', intervals: [0, 4], zone: 'A', transposeOffset: 0, x: 105, y: 100, radius: 12, gravity: false });
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  const actions = resolveCollision(big, small, makeCtx());
  let eatInfo = null;
  applyActions(actions, { world, physics: { findBody, removeBody }, audioPort: port, onEatStart: (info) => { eatInfo = info; } });
  ok('eat action with onEatStart supplied does not remove the body immediately', findBody(world, 'small') != null);
  ok('onEatStart fires with the right eater/eaten', eatInfo && eatInfo.eaterId === 'big' && eatInfo.eatenId === 'small');
}

// ---- arpeggio / blip reach the driver correctly through the port ----
{
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  port.arpeggio([0, 10, 41, 62, 85], 0, 'guitar', 2, 5);
  ok('arpeggio call reaches the driver with notes/duration/extraCents intact', driver.calls.some(c => c.type === 'arpeggio' && c.notes.length === 5 && c.totalDurSec === 2 && c.extraCents === 5));
  port.blip([9], 9, -3);
  ok('blip call reaches the driver distinctly from arpeggio/oneshot', driver.calls.some(c => c.type === 'blip' && c.notes[0] === 9 && c.extraCents === -3));
}

console.log(`integration (revision round 2: director+applyActions+audioPort wiring): ${pass} assertions passed`);
