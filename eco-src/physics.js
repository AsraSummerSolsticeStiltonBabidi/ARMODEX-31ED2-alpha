/* ============================================================================
   ECOSYSTEM — PHYSICS LAYER (Layer 1)
   Pure simulation: positions, velocities, gravity, platforms, collisions.
   NO rendering, NO audio, NO DOM. stepWorld() takes an explicit dt and
   returns a plain array of collision events (rising-edge only, i.e. fired
   once when two bodies START overlapping, not every frame while overlapping)
   — callers (the director/audio layer) react to those events. This module
   never calls into audio or rendering code, and never reaches into a body's
   game-specific fields (sig, kind, objectType, etc.) beyond what's listed
   below; it only touches the physical fields it owns.
   ============================================================================ */

// Revision round 2 (user feedback: too much settling/stagnation, wants more
// movement) -- lighter gravity, bouncier walls/bodies, and faster locomotion
// across the board versus the original tuning, so the population glides and
// bounces further before resting instead of piling up quickly.
const DEFAULTS = {
  gravityAccel: 460,      // px/s^2 (was 700)
  flySteer: 60,           // px/s^2 of random steering (was 45)
  flyMaxSpeed: 100,       // px/s (was 75)
  crawlSpeed: 46,         // px/s (was 32)
  rollAccel: 34,          // px/s^2 (was 26)
  rollMaxSpeed: 130,      // px/s (was 95)
  wallRestitution: 0.68,  // was 0.55
  bodyRestitution: 0.8,   // was 0.7
  rollBounce: 0.42,       // was 0.32
  floorThickness: 40,
};

function pairKey(a, b) { return a < b ? a + ' ' + b : b + ' ' + a; }

function createWorld(opts) {
  opts = opts || {};
  const cfg = Object.assign({}, DEFAULTS, opts.config || {});
  return {
    width: opts.width || 800,
    height: opts.height || 500,
    platforms: (opts.platforms || []).slice(), // [{x,y,w,h}], top surface solid
    cfg,
    bodies: [],
    _collidingPairs: new Set(),
    _nextId: 1,
  };
}

// spec: { id?, x, y, vx?, vy?, radius, gravity, locomotion: 'crawl'|'fly'|'roll'|null, ...extra }
// Any extra fields (sig, kind, objectType, ...) are preserved untouched on the
// body object so the director/render layers can attach game-specific data —
// physics only ever reads/writes the physical fields listed here.
function addBody(world, spec) {
  const id = spec.id != null ? spec.id : ('b' + (world._nextId++));
  // NOTE: facing defaults to a fixed value (not Math.random()) so physics.js
  // never touches an unseeded random source itself -- that would silently
  // break the determinism guarantee (same seed -> same trajectory) even
  // when the caller passes a seeded rng into stepWorld(). Callers that want
  // a randomized starting facing should set spec.facing themselves using
  // their own rng (the director/spawn layer does this).
  const body = Object.assign({
    vx: 0, vy: 0, angle: 0, angularVel: 0,
    gravity: true, locomotion: null,
    dragging: false, resting: false,
    facing: 1,
  }, spec, { id });
  world.bodies.push(body);
  return body;
}

function removeBody(world, id) {
  world.bodies = world.bodies.filter(b => b.id !== id);
  const toDelete = [];
  world._collidingPairs.forEach(key => {
    const parts = key.split(' ');
    if (parts[0] === id || parts[1] === id) toDelete.push(key);
  });
  toDelete.forEach(k => world._collidingPairs.delete(k));
}

function findBody(world, id) { return world.bodies.find(b => b.id === id); }

function stepWorld(world, dt, rng) {
  rng = rng || Math.random;
  const cfg = world.cfg;
  const W = world.width, H = world.height;
  const events = [];

  world.bodies.forEach(b => {
    if (b.dragging) { b.resting = false; return; } // position driven externally; still eligible for collisions below

    const wasBottom = b.y + b.radius;

    // 'fly' is intrinsically gravity-immune regardless of the body's own
    // `gravity` flag — a caller mistake (spawning a fly body with
    // gravity:true) must not be able to make it accelerate forever without
    // ever landing, since fly bodies also never consult the platform-landing
    // check below. Caught by the layer-1 fuzz test.
    if (b.gravity && b.locomotion !== 'fly') b.vy += cfg.gravityAccel * dt;

    if (b.locomotion === 'fly') {
      b.vx += (rng() - 0.5) * cfg.flySteer * dt * 60;
      b.vy += (rng() - 0.5) * cfg.flySteer * dt * 60;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > cfg.flyMaxSpeed) { b.vx = b.vx / speed * cfg.flyMaxSpeed; b.vy = b.vy / speed * cfg.flyMaxSpeed; }
    } else if (b.locomotion === 'crawl' && b.resting) {
      b.vx = b.facing * cfg.crawlSpeed;
    } else if (b.locomotion === 'roll' && b.resting) {
      b.vx += b.facing * cfg.rollAccel * dt;
      b.vx = Math.max(-cfg.rollMaxSpeed, Math.min(cfg.rollMaxSpeed, b.vx));
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.locomotion === 'roll') { b.angularVel = b.vx / Math.max(1, b.radius); b.angle += b.angularVel * dt; }

    b.resting = false;

    // world bounds (bouncy walls, solid ceiling; floor handled as a platform below)
    if (b.x - b.radius < 0) { b.x = b.radius; b.vx = Math.abs(b.vx) * cfg.wallRestitution; b.facing = 1; }
    if (b.x + b.radius > W) { b.x = W - b.radius; b.vx = -Math.abs(b.vx) * cfg.wallRestitution; b.facing = -1; }
    if (b.y - b.radius < 0) { b.y = b.radius; b.vy = Math.abs(b.vy) * cfg.wallRestitution; }

    if (b.gravity && b.locomotion !== 'fly') {
      const surfaces = world.platforms.concat([{ x: 0, y: H - cfg.floorThickness, w: W, h: cfg.floorThickness }]);
      for (let i = 0; i < surfaces.length; i++) {
        const pf = surfaces[i];
        const withinX = b.x + b.radius > pf.x && b.x - b.radius < pf.x + pf.w;
        const bottom = b.y + b.radius;
        if (withinX && b.vy >= 0 && wasBottom <= pf.y + 1 && bottom >= pf.y) {
          b.y = pf.y - b.radius;
          b.vy = (b.locomotion === 'roll') ? -b.vy * cfg.rollBounce : 0;
          b.resting = true;
          break; // landed on the first qualifying surface this step
        }
      }
    }
  });

  // circle-circle collisions (rising edge events only)
  const currentPairs = new Set();
  for (let i = 0; i < world.bodies.length; i++) {
    for (let j = i + 1; j < world.bodies.length; j++) {
      const a = world.bodies[i], b = world.bodies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.radius + b.radius;
      if (dist < minDist) {
        const key = pairKey(a.id, b.id);
        currentPairs.add(key);
        if (!a.dragging && !b.dragging) {
          const overlap = minDist - dist || 0.01;
          const nx = dist > 1e-4 ? dx / dist : 1, ny = dist > 1e-4 ? dy / dist : 0;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
          b.x += nx * overlap / 2; b.y += ny * overlap / 2;
          const relVx = b.vx - a.vx, relVy = b.vy - a.vy;
          const rel = relVx * nx + relVy * ny;
          if (rel < 0) {
            const bounce = -rel * cfg.bodyRestitution;
            a.vx -= nx * bounce / 2; a.vy -= ny * bounce / 2;
            b.vx += nx * bounce / 2; b.vy += ny * bounce / 2;
          }
        }
        if (!world._collidingPairs.has(key)) {
          events.push({ type: 'collision', a: a.id, b: b.id });
        }
      }
    }
  }
  world._collidingPairs = currentPairs;

  // Final hard safety net: collision-separation can shove a body a large
  // distance in one step (e.g. two bodies spawned almost exactly on top of
  // each other), which can tunnel it through the world bounds faster than
  // the gradual velocity-based landing check above can catch. This clamp
  // runs after everything else and guarantees no body ever ends up outside
  // the bounded space, regardless of how it got displaced. It does NOT
  // protect against clipping through an internal floating platform under
  // similarly extreme overlap — only the true outer bounds — since bodies
  // can legitimately exist underneath a floating platform.
  world.bodies.forEach(b => {
    const minX = b.radius, maxX = W - b.radius;
    const minY = b.radius, maxY = H - b.radius;
    if (b.x < minX) { b.x = minX; if (b.vx < 0) b.vx = -b.vx * cfg.wallRestitution; }
    if (b.x > maxX) { b.x = maxX; if (b.vx > 0) b.vx = -b.vx * cfg.wallRestitution; }
    if (b.y < minY) { b.y = minY; if (b.vy < 0) b.vy = -b.vy * cfg.wallRestitution; }
    if (b.y > maxY) {
      b.y = maxY;
      b.vy = (b.locomotion === 'roll') ? -b.vy * cfg.rollBounce : 0;
      if (b.gravity) b.resting = true;
    }
  });

  return events;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createWorld, addBody, removeBody, findBody, stepWorld, pairKey, DEFAULTS };
}
