const { createWorld, addBody, removeBody, findBody, stepWorld } = require('./physics.js');
const { makeRng } = require('./util.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

const DT = 1 / 60;

// ---- 1. random initial conditions stay in bounds over many steps ----
{
  const rng = makeRng(12345);
  const world = createWorld({ width: 800, height: 500, platforms: [{ x: 100, y: 300, w: 200, h: 20 }] });
  for (let i = 0; i < 20; i++) {
    const loc = ['crawl', 'fly', 'roll'][Math.floor(rng() * 3)];
    addBody(world, {
      x: rng() * 800, y: rng() * 300, radius: 12 + rng() * 10,
      vx: (rng() - 0.5) * 200, vy: (rng() - 0.5) * 200,
      locomotion: loc,
      gravity: loc !== 'fly', // matches real spawn logic in the director layer
    });
  }
  let sawNaN = false, sawEscape = false;
  for (let step = 0; step < 3000; step++) { // 50 simulated seconds
    stepWorld(world, DT, rng);
    world.bodies.forEach(b => {
      if (Number.isNaN(b.x) || Number.isNaN(b.y) || Number.isNaN(b.vx) || Number.isNaN(b.vy)) sawNaN = true;
      if (b.x < -1 || b.x > world.width + 1 || b.y < -1 || b.y > world.height + 1) sawEscape = true;
    });
  }
  ok('no NaN positions/velocities over 50s of random sim', !sawNaN);
  ok('no body escapes world bounds over 50s of random sim', !sawEscape);
}

// ---- 2. collision detection fires on overlap (rising edge, not every frame) ----
{
  const world = createWorld({ width: 400, height: 400 });
  const a = addBody(world, { id: 'a', x: 100, y: 100, radius: 20, gravity: false });
  const b = addBody(world, { id: 'b', x: 110, y: 100, radius: 20, gravity: false }); // overlapping immediately
  const ev1 = stepWorld(world, DT);
  ok('collision fires the instant two circles overlap', ev1.some(e => e.type === 'collision' && ((e.a === 'a' && e.b === 'b') || (e.a === 'b' && e.b === 'a'))));
  const ev2 = stepWorld(world, DT);
  ok('collision does NOT re-fire every frame while still overlapping', !ev2.some(e => e.a === 'a' || e.a === 'b' || e.b === 'a' || e.b === 'b'));
  // separate them, then bring back together -> should fire again (new rising edge)
  a.x = 100; b.x = 500; b.y = 500;
  stepWorld(world, DT);
  b.x = 108; b.y = 100;
  const ev3 = stepWorld(world, DT);
  ok('collision fires again after bodies separate and re-touch', ev3.some(e => e.type === 'collision'));
}

// ---- 3. removed (eaten) bodies actually disappear and don't ghost-collide ----
{
  const world = createWorld({ width: 400, height: 400 });
  addBody(world, { id: 'big', x: 200, y: 200, radius: 30, gravity: false });
  addBody(world, { id: 'small', x: 210, y: 200, radius: 10, gravity: false });
  stepWorld(world, DT); // establishes the colliding pair
  ok('both bodies present before removal', world.bodies.length === 2);
  removeBody(world, 'small');
  ok('removed body gone from world.bodies', world.bodies.length === 1 && !findBody(world, 'small'));
  const evAfter = stepWorld(world, DT);
  ok('no ghost collision events reference the removed body', !evAfter.some(e => e.a === 'small' || e.b === 'small'));
  // stepping further must not throw despite the stale pair having existed
  for (let i = 0; i < 10; i++) stepWorld(world, DT);
  ok('world still steps cleanly after a removal', true);
}

// ---- 4a. an inert (locomotion:null) gravity body — models an interactive
// object — settles on a platform and stays resting motionless indefinitely ----
{
  const world = createWorld({ width: 400, height: 400, platforms: [{ x: 50, y: 200, w: 300, h: 20 }] });
  const body = addBody(world, { x: 150, y: 0, radius: 15, gravity: true, locomotion: null });
  for (let i = 0; i < 300; i++) stepWorld(world, DT); // 5s, plenty of time to land
  ok('inert body lands on the platform (not floor)', Math.abs(body.y - (200 - 15)) < 1);
  ok('inert body marked resting after landing', body.resting === true);
  const yAfterSettle = body.y, xAfterSettle = body.x;
  for (let i = 0; i < 300; i++) stepWorld(world, DT); // another 5s
  ok('settled inert body does not sink/jitter through the platform', Math.abs(body.y - yAfterSettle) < 1);
  ok('settled inert body does not drift horizontally on its own', Math.abs(body.x - xAfterSettle) < 1);
}

// ---- 4b. a 'roll' chord keeps moving once resting (per spec: "rotate as
// they move") rather than settling motionless — it should roll off a finite
// platform's edge, fall, and land again on the surface below, all without
// ever escaping world bounds or going NaN. This exercises a second
// landing after leaving the first surface, not just a hand-picked single drop. ----
{
  const world = createWorld({ width: 400, height: 400, platforms: [{ x: 50, y: 200, w: 300, h: 20 }] });
  const body = addBody(world, { x: 150, y: 0, radius: 15, gravity: true, locomotion: 'roll', facing: 1 });
  let sawPlatformLanding = false, sawFloorLanding = false, sawEscape = false;
  for (let i = 0; i < 1200; i++) { // 20s: land on platform, roll off, land on floor
    stepWorld(world, DT);
    if (body.x < -1 || body.x > world.width + 1 || body.y < -1 || body.y > world.height + 1) sawEscape = true;
    if (body.resting && Math.abs(body.y - (200 - 15)) < 1) sawPlatformLanding = true;
    if (body.resting && Math.abs(body.y - (400 - 40 - 15)) < 1) sawFloorLanding = true;
  }
  ok('rolling body lands on the platform first', sawPlatformLanding);
  ok('rolling body eventually rolls off the edge and lands on the floor below', sawFloorLanding);
  ok('rolling body never escapes bounds while transitioning between surfaces', !sawEscape);
}

// ---- 5. fly bodies ignore gravity and never rest ----
{
  const world = createWorld({ width: 400, height: 400 });
  const rng = makeRng(999);
  const body = addBody(world, { x: 200, y: 200, radius: 15, gravity: false, locomotion: 'fly' });
  let everRested = false;
  for (let i = 0; i < 600; i++) { stepWorld(world, DT, rng); if (body.resting) everRested = true; }
  ok('fly body never lands/rests', !everRested);
  ok('fly body does not free-fall (stays near vertical center, not pinned to floor)', body.y < world.height - 20);
}

// ---- 6. determinism: same seed -> identical trajectory ----
{
  function runSim(seed) {
    const rng = makeRng(seed);
    const world = createWorld({ width: 600, height: 400, platforms: [{ x: 0, y: 250, w: 600, h: 20 }] });
    for (let i = 0; i < 8; i++) {
      addBody(world, {
        x: rng() * 600, y: rng() * 200, radius: 10 + rng() * 8,
        vx: (rng() - 0.5) * 150, vy: (rng() - 0.5) * 150,
        locomotion: ['crawl', 'fly', 'roll'][Math.floor(rng() * 3)],
      });
    }
    for (let i = 0; i < 500; i++) stepWorld(world, DT, rng);
    return world.bodies.map(b => `${b.x.toFixed(6)},${b.y.toFixed(6)},${b.vx.toFixed(6)},${b.vy.toFixed(6)}`).join('|');
  }
  const run1 = runSim(42), run2 = runSim(42);
  ok('identical seed produces byte-identical trajectory', run1 === run2);
  const run3 = runSim(43);
  ok('different seed produces a different trajectory (sanity: rng is actually used)', run1 !== run3);
}

// ---- 7. framerate independence on a simple no-collision case ----
{
  function freeFall(steps, dt) {
    const world = createWorld({ width: 400, height: 100000 }); // tall enough to never hit the floor
    const body = addBody(world, { x: 200, y: 0, radius: 10, gravity: true, locomotion: null });
    for (let i = 0; i < steps; i++) stepWorld(world, dt);
    return body.y;
  }
  const y60 = freeFall(60, 1 / 60);   // 1.0s in 60 steps
  const y30 = freeFall(30, 1 / 30);   // 1.0s in 30 steps
  const y120 = freeFall(120, 1 / 120); // 1.0s in 120 steps
  const tol = Math.max(y60, y30, y120) * 0.05; // simple semi-implicit Euler differs slightly by step size; must stay close
  ok('1s of free-fall lands within 5% regardless of step size (60 vs 30 vs 120 Hz)',
    Math.abs(y60 - y30) < tol && Math.abs(y60 - y120) < tol);
}

console.log(`physics layer: ${pass} assertions passed`);
