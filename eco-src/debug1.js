const { createWorld, addBody, stepWorld } = require('./physics.js');
const { makeRng } = require('./util.js');

const rng = makeRng(12345);
const world = createWorld({ width: 800, height: 500, platforms: [{ x: 100, y: 300, w: 200, h: 20 }] });
for (let i = 0; i < 20; i++) {
  const loc = ['crawl', 'fly', 'roll'][Math.floor(rng() * 3)];
  addBody(world, {
    x: rng() * 800, y: rng() * 300, radius: 12 + rng() * 10,
    vx: (rng() - 0.5) * 200, vy: (rng() - 0.5) * 200,
    locomotion: loc,
    gravity: loc !== 'fly',
  });
}
const DT = 1/60;
outer:
for (let step = 0; step < 3000; step++) {
  stepWorld(world, DT, rng);
  for (const b of world.bodies) {
    if (b.x < -1 || b.x > world.width + 1 || b.y < -1 || b.y > world.height + 1) {
      console.log('ESCAPE at step', step, JSON.stringify({id:b.id, loc:b.locomotion, x:b.x, y:b.y, vx:b.vx, vy:b.vy, radius:b.radius, resting:b.resting, gravity:b.gravity}));
      break outer;
    }
  }
}
