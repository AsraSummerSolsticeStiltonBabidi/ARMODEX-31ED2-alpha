const { createWorld, addBody, stepWorld } = require('./physics.js');
const world = createWorld({ width: 400, height: 400, platforms: [{ x: 50, y: 200, w: 300, h: 20 }] });
const body = addBody(world, { x: 150, y: 0, radius: 15, gravity: true, locomotion: 'roll' });
const DT = 1/60;
for (let i = 0; i < 600; i++) {
  stepWorld(world, DT);
  if (i < 40 || i % 50 === 0) console.log(i, body.y.toFixed(2), body.vy.toFixed(2), body.resting);
}
console.log('FINAL', body.x.toFixed(2), body.y.toFixed(2), body.resting);
