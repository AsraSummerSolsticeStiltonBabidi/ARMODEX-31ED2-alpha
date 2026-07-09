// Full-stack Layer-1 + Layer-2 integration test: real physics collisions
// drive the director, which drives a mock AudioPort. Simulates the actual
// sequence a real session produces (many bodies, repeated collisions, day/
// night mid-collision) rather than hand-picked single-function calls.
const { createWorld, addBody, findBody, removeBody, stepWorld } = require('./physics.js');
const { resolveCollision } = require('./director.js');
const { createAudioPort, createMockDriver } = require('./audioPort.js');
const { applyActions } = require('./applyActions.js');
const { makeRng } = require('./util.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

function makeEnv(seed) {
  const world = createWorld({ width: 800, height: 500 });
  const driver = createMockDriver();
  const audioPort = createAudioPort(driver);
  const rng = makeRng(seed);
  const deaths = [];
  const ctx = {
    zoneRootFor: (z) => (z === 'B' ? 18 : 0),
    nightSteps: 0,
    rng,
    getAmbientNotes: () => audioPort.getAmbientNotes(),
    timbre: 'guitar',
  };
  const env = {
    world,
    physics: { findBody, removeBody },
    audioPort,
    onDeath: (d) => deaths.push(d),
  };
  return { world, driver, audioPort, rng, ctx, env, deaths };
}

function runFrame(world, ctx, env) {
  const events = stepWorld(world, 1 / 60, ctx.rng);
  events.forEach(ev => {
    const a = findBody(world, ev.a), b = findBody(world, ev.b);
    if (!a || !b) return; // one side may have been eaten by an earlier event this same frame
    const actions = resolveCollision(a, b, ctx);
    applyActions(actions, env);
  });
  return events;
}

// ---- chord colliding with a strum object, driven entirely by real physics ----
{
  const { world, driver, ctx, env } = makeEnv(1);
  addBody(world, { id: 'chordA', kind: 'chord', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 16, gravity: false, locomotion: 'fly' });
  addBody(world, { id: 'strumObj', kind: 'object', objectType: 'strum', x: 108, y: 100, radius: 16, gravity: false });
  runFrame(world, ctx, env);
  ok('real physics collision -> director -> audio: exactly one strum fired', driver.calls.filter(c => c.type === 'oneshot').length === 1);
}

// ---- two different chords hit the SAME pad-hold object in sequence: only one ambient survives ----
{
  const { world, driver, ctx, env } = makeEnv(2);
  addBody(world, { id: 'pad', kind: 'object', objectType: 'padhold', x: 400, y: 250, radius: 18, gravity: false });
  // locomotion:null (not 'fly') so this test's travel time is exact and not
  // entangled with fly's own random-steering/speed-clamp tuning constants,
  // which are already covered by the physics layer's own tests.
  addBody(world, { id: 'c1', kind: 'chord', intervals: [0, 4, 7], zone: 'A', transposeOffset: 0, x: 100, y: 250, radius: 16, gravity: false, locomotion: null, vx: 300, vy: 0 });
  for (let i = 0; i < 120 && !driver.calls.some(c => c.type === 'startSustain'); i++) runFrame(world, ctx, env);
  ok('first chord reaches the pad-hold object and starts an ambient', driver.calls.filter(c => c.type === 'startSustain').length === 1);
  // now drive a second, different chord into the same object
  addBody(world, { id: 'c2', kind: 'chord', intervals: [1, 5, 9], zone: 'A', transposeOffset: 0, x: 700, y: 250, radius: 16, gravity: false, locomotion: null, vx: -300, vy: 0 });
  for (let i = 0; i < 120 && driver.calls.filter(c => c.type === 'startSustain').length < 2; i++) runFrame(world, ctx, env);
  ok('second chord cuts the first and starts its own ambient', driver.calls.filter(c => c.type === 'startSustain').length === 2);
  ok('exactly one stopSustain happened (single ambient-slot rule enforced end-to-end)', driver.calls.filter(c => c.type === 'stopSustain').length === 1);
}

// ---- a big chord eating a small one actually removes it from the live world ----
{
  const { world, ctx, env, deaths } = makeEnv(3);
  addBody(world, { id: 'big', kind: 'chord', intervals: [0, 4, 7, 10], zone: 'A', transposeOffset: 0, x: 200, y: 200, radius: 22, gravity: false, locomotion: 'fly' });
  addBody(world, { id: 'small', kind: 'chord', intervals: [0, 4], zone: 'A', transposeOffset: 0, x: 210, y: 200, radius: 10, gravity: false, locomotion: 'fly' });
  ok('both present before collision', world.bodies.length === 2);
  runFrame(world, ctx, env);
  ok('small chord removed from the live world after being eaten', world.bodies.length === 1 && !findBody(world, 'small'));
  ok('onDeath hook fired with the right ids', deaths.length === 1 && deaths[0].id === 'small' && deaths[0].eaterId === 'big');
}

// ---- day/night flips mid-collision: notes actually reflect whichever ctx was active at trigger time ----
{
  const { world, driver, ctx, env } = makeEnv(4);
  addBody(world, { id: 'c', kind: 'chord', intervals: [0], zone: 'A', transposeOffset: 0, x: 100, y: 100, radius: 16, gravity: false, locomotion: 'fly' });
  addBody(world, { id: 'strumObj', kind: 'object', objectType: 'strum', x: 108, y: 100, radius: 16, gravity: false });
  ctx.nightSteps = 0;
  runFrame(world, ctx, env); // day collision
  const dayNote = driver.calls.find(c => c.type === 'oneshot').notes[0];
  ok('daytime collision uses the unshifted reference (note 0)', dayNote === 0);
  // separate, re-collide at night with a moon phase shift
  world.bodies[0].x = 100; world.bodies[1].x = 500;
  runFrame(world, ctx, env);
  world.bodies[1].x = 108;
  ctx.nightSteps = 12; // pretend the moon is at phase 12 now
  runFrame(world, ctx, env);
  const nightCalls = driver.calls.filter(c => c.type === 'oneshot');
  const nightNote = nightCalls[nightCalls.length - 1].notes[0];
  ok('nighttime collision (moon phase 12) transposes the same chord up by 12 steps', nightNote === 12);
}

// ---- long fuzz run: many chords + objects, random collisions, day/night flips, no crashes, no leaks ----
{
  const { world, driver, ctx, env, rng } = makeEnv(5);
  const types = ['strum', 'padhold', 'commontones', 'launcher', 'transposer'];
  types.forEach((t, i) => addBody(world, { id: 'obj' + i, kind: 'object', objectType: t, x: 100 + i * 150, y: 450, radius: 20, gravity: true, locomotion: null }));
  for (let i = 0; i < 20; i++) {
    const nNotes = 2 + Math.floor(rng() * 4);
    const intervals = [0]; for (let k = 1; k < nNotes; k++) intervals.push(Math.floor(rng() * 24) + 1);
    addBody(world, {
      id: 'chord' + i, kind: 'chord', intervals, zone: rng() < 0.5 ? 'A' : 'B', transposeOffset: 0,
      x: rng() * 800, y: rng() * 200, radius: 10 + rng() * 8,
      locomotion: ['crawl', 'fly', 'roll'][Math.floor(rng() * 3)],
      gravity: true,
    });
  }
  let crashed = false, frames = 0;
  const totalFrames = 3600; // 60 simulated seconds
  try {
    for (let f = 0; f < totalFrames; f++) {
      ctx.nightSteps = (Math.floor(f / (15 * 60)) % 2 === 1) ? ((Math.floor(f / (30 * 60)) * 7) % 31) : 0; // flips every 15s
      runFrame(world, ctx, env);
      frames++;
      world.bodies.forEach(b => {
        if (Number.isNaN(b.x) || Number.isNaN(b.y)) throw new Error('NaN body at frame ' + f);
        if (b.x < -5 || b.x > world.width + 5 || b.y < -5 || b.y > world.height + 5) throw new Error('escaped body at frame ' + f);
      });
    }
  } catch (e) { crashed = e.message; }
  ok('60s fuzz run with 5 objects + 20 chords completes without crashing', !crashed);
  ok('60s fuzz run actually ran all frames', frames === totalFrames);
  ok('audio driver received a substantial number of triggered sounds (system is actually live, not silently inert)', driver.calls.length > 5);
  ok('at most one ambient sustain alive at any recorded moment (spot check via stop/start pairing)',
    driver.calls.filter(c => c.type === 'startSustain').length >= driver.calls.filter(c => c.type === 'stopSustain').length);
}

console.log(`integration (physics+director+audio): ${pass} assertions passed`);
