const { createWorld, addBody, stepWorld, DEFAULTS } = require('./physics-final.js');
const { makeRng } = require('./util.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

const DT = 1 / 60;

function fractionResting(cfgOverride, seed) {
  const rng = makeRng(seed);
  const world = createWorld({ width: 800, height: 500, platforms: [{ x: 100, y: 300, w: 200, h: 20 }], config: cfgOverride });
  for (let i = 0; i < 16; i++) {
    const loc = ['crawl', 'fly', 'roll'][Math.floor(rng() * 3)];
    addBody(world, {
      x: rng() * 800, y: rng() * 300, radius: 12 + rng() * 10,
      vx: (rng() - 0.5) * 200, vy: (rng() - 0.5) * 200,
      locomotion: loc, gravity: loc !== 'fly',
    });
  }
  let restingFrames = 0, totalFrames = 0;
  for (let step = 0; step < 3600; step++) { // 60 simulated seconds
    stepWorld(world, DT, rng);
    world.bodies.forEach(b => { totalFrames++; if (b.resting) restingFrames++; });
  }
  return restingFrames / totalFrames;
}

// ---- 1. core invariants still hold under the new (lighter-gravity, bouncier) tuning ----
{
  const rng = makeRng(555);
  const world = createWorld({ width: 800, height: 500, platforms: [{ x: 100, y: 300, w: 200, h: 20 }] });
  for (let i = 0; i < 20; i++) {
    const loc = ['crawl', 'fly', 'roll'][Math.floor(rng() * 3)];
    addBody(world, {
      x: rng() * 800, y: rng() * 300, radius: 12 + rng() * 10,
      vx: (rng() - 0.5) * 200, vy: (rng() - 0.5) * 200,
      locomotion: loc, gravity: loc !== 'fly',
    });
  }
  let sawNaN = false, sawEscape = false;
  for (let step = 0; step < 3000; step++) {
    stepWorld(world, DT, rng);
    world.bodies.forEach(b => {
      if (Number.isNaN(b.x) || Number.isNaN(b.y) || Number.isNaN(b.vx) || Number.isNaN(b.vy)) sawNaN = true;
      if (b.x < -1 || b.x > world.width + 1 || b.y < -1 || b.y > world.height + 1) sawEscape = true;
    });
  }
  ok('no NaN under the new lighter/bouncier tuning over 50s of random sim', !sawNaN);
  ok('no body escapes world bounds under the new tuning over 50s of random sim', !sawEscape);
}

// ---- 2. determinism preserved ----
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
    return world.bodies.map(b => `${b.x.toFixed(6)},${b.y.toFixed(6)}`).join('|');
  }
  ok('determinism still holds under the new tuning (same seed -> identical trajectory)', runSim(42) === runSim(42));
}

// ---- 3. the actual point of this retune: bodies rest LESS of the time than under the old constants ----
{
  const oldCfg = { gravityAccel: 700, flySteer: 45, flyMaxSpeed: 75, crawlSpeed: 32, rollAccel: 26, rollMaxSpeed: 95, wallRestitution: 0.55, bodyRestitution: 0.7, rollBounce: 0.32 };
  const oldFrac = fractionResting(oldCfg, 2024);
  const newFrac = fractionResting({}, 2024); // {} -> real DEFAULTS export, i.e. the actual shipped tuning
  ok('the new default tuning keeps bodies resting a meaningfully smaller fraction of the time than the old tuning (less stagnation)', newFrac < oldFrac - 0.03);
  console.log(`  (resting fraction: old=${oldFrac.toFixed(3)} new=${newFrac.toFixed(3)})`);
}

console.log(`physics (part 2, revision-round-2 retune): ${pass} assertions passed`);
