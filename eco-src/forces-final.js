/* ============================================================================
   ECOSYSTEM — FORCES (Layer 1b, revision round 2)
   Pure, side-effect-free per-frame steering/trigger helpers. Mirrors physics.js's
   discipline: no DOM, no audio, no direct world mutation -- every function here
   takes plain body-like data in and returns a plain {fx,fy} delta, a decision,
   or a derived list, letting the ecosystem-level loop (in ecosystem.html) apply
   the result to real bodies. This is what keeps black-hole pull, tornado
   turbulence, hunting steering, the summon event, and border-proximity
   detection unit-testable without any mock world/audio context at all.
   ============================================================================ */

function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
function mod31f(n) { return ((n % 31) + 31) % 31; }

/* ---------- Black hole: pull increases sharply at close range, negligible far
   away, capped so it never produces an unbounded/NaN-prone acceleration. ---------- */
function blackHolePull(bodyX, bodyY, holeX, holeY, cfg) {
  cfg = cfg || {};
  const strength = cfg.strength != null ? cfg.strength : 26000; // tuned so only slow/near chords actually reach it
  const minDist = cfg.minDist != null ? cfg.minDist : 40;
  const maxDist = cfg.maxDist != null ? cfg.maxDist : 260;
  const maxAccel = cfg.maxAccel != null ? cfg.maxAccel : 500;
  const d = dist(bodyX, bodyY, holeX, holeY);
  if (d > maxDist || d < 1e-6) return { fx: 0, fy: 0, dist: d };
  const clampedD = Math.max(minDist, d);
  const mag = Math.min(maxAccel, strength / (clampedD * clampedD));
  const nx = (holeX - bodyX) / d, ny = (holeY - bodyY) / d;
  return { fx: nx * mag, fy: ny * mag, dist: d };
}

/* ---------- Tornado: a moving funnel that travels right-to-left across the
   world at a fixed vx, exerting a turbulent (rotating + inward) force on
   anything within its radius; bodies outside the radius feel nothing. ---------- */
function createTornado(startXFrac, worldWidth, worldHeight, nowMs, durationMs, rng) {
  rng = rng || Math.random;
  const groundY = worldHeight * (0.55 + rng() * 0.3);
  return {
    x: worldWidth * (startXFrac != null ? startXFrac : 1.05), // starts just off the right edge
    y: groundY,
    vx: -(40 + rng() * 30), // right-to-left, per spec
    radius: 90 + rng() * 40,
    bornAt: nowMs,
    diesAt: nowMs + durationMs,
  };
}
function tornadoPositionAt(tornado, nowMs) {
  const dtSec = Math.max(0, nowMs - tornado.bornAt) / 1000;
  return { x: tornado.x + tornado.vx * dtSec, y: tornado.y };
}
function tornadoForceOn(bodyX, bodyY, tornadoX, tornadoY, tornadoRadius, cfg) {
  cfg = cfg || {};
  const d = dist(bodyX, bodyY, tornadoX, tornadoY);
  if (d > tornadoRadius || d < 1e-6) return { fx: 0, fy: 0 };
  const inwardMag = cfg.inwardStrength != null ? cfg.inwardStrength : 340;
  const swirlMag = cfg.swirlStrength != null ? cfg.swirlStrength : 520;
  const liftMag = cfg.liftStrength != null ? cfg.liftStrength : 260;
  const falloff = 1 - d / tornadoRadius; // 1 at center, 0 at the edge
  const nx = (tornadoX - bodyX) / d, ny = (tornadoY - bodyY) / d; // inward
  const tx = -ny, ty = nx; // tangential (perpendicular to inward) for the swirl
  return {
    fx: (nx * inwardMag + tx * swirlMag) * falloff,
    fy: (ny * inwardMag + ty * swirlMag - liftMag) * falloff, // net upward bias so things actually fly, not just orbit
  };
}

/* ---------- Hunting: an occasional predatory state for "big" chords -- steer
   toward the nearest chord it would actually eat on collision (a strict
   pitch-class superset by raw interval set, independent of live transposition
   -- a cheap, honest proxy for "would this collision result in an eat",
   since the real eat decision at collision time is still made authoritatively
   by director.js's resolveCollision; this only decides where to steer). ---------- */
function pcSetFromIntervals(intervals) { return new Set(intervals.map(mod31f)); }
function isStrictSupersetSet(big, small) {
  if (big.size <= small.size) return false;
  for (const x of small) if (!big.has(x)) return false;
  return true;
}
function pickHuntTarget(hunter, candidates) {
  const hunterPcs = pcSetFromIntervals(hunter.intervals);
  let best = null, bestDist = Infinity;
  candidates.forEach(c => {
    if (c.id === hunter.id) return;
    const cPcs = pcSetFromIntervals(c.intervals);
    if (!isStrictSupersetSet(hunterPcs, cPcs)) return;
    const d = dist(hunter.x, hunter.y, c.x, c.y);
    if (d < bestDist) { bestDist = d; best = c; }
  });
  return best;
}
function huntSteer(hunterX, hunterY, targetX, targetY, cfg) {
  cfg = cfg || {};
  const mag = cfg.strength != null ? cfg.strength : 60;
  const d = dist(hunterX, hunterY, targetX, targetY);
  if (d < 1e-6) return { fx: 0, fy: 0 };
  return { fx: (targetX - hunterX) / d * mag, fy: (targetY - hunterY) / d * mag };
}

/* ---------- Summon event: pick two distinct live chords at random and pull
   them toward each other so they collide 1-3 times before releasing. ---------- */
function pickSummonPair(chordBodies, rng) {
  rng = rng || Math.random;
  if (chordBodies.length < 2) return null;
  const i = Math.floor(rng() * chordBodies.length);
  let j = Math.floor(rng() * (chordBodies.length - 1));
  if (j >= i) j++;
  return [chordBodies[i], chordBodies[j]];
}
function summonPull(fromX, fromY, toX, toY, cfg) {
  cfg = cfg || {};
  const mag = cfg.strength != null ? cfg.strength : 190;
  const d = dist(fromX, fromY, toX, toY);
  if (d < 1e-6) return { fx: 0, fy: 0 };
  return { fx: (toX - fromX) / d * mag, fy: (toY - fromY) / d * mag };
}

/* ---------- Zone-border proximity: a quick blip as a chord nears the divider,
   and a one-shot "arrived" chime the instant it actually crosses. Both are
   edge-triggered (fire once per approach/crossing) so a chord idling right at
   the threshold doesn't spam either sound every frame. ---------- */
function borderProximityState(chordX, midX, nearThreshold) {
  return Math.abs(chordX - midX) <= nearThreshold;
}
// prevSide/newSide: 'A'|'B'. Returns true exactly on the frame the side flips.
function didCrossBorder(prevSide, newSide) {
  return !!prevSide && !!newSide && prevSide !== newSide;
}

/* ---------- Common-tones AREA trigger: given every chord currently within the
   object's detection radius, the pitch classes shared by ALL of them (empty
   if fewer than 2 are in range, or if nothing is common to every one). ---------- */
function chordsWithinRadius(objX, objY, radius, chordBodies) {
  return chordBodies.filter(c => dist(objX, objY, c.x, c.y) <= radius);
}
function sharedPitchClassesAcross(chordBodiesRawNotes) {
  // chordBodiesRawNotes: array of raw-note arrays (already resolved to live
  // absolute pitch, i.e. post zone/transpose/night), one per chord in range.
  if (chordBodiesRawNotes.length < 2) return [];
  const sets = chordBodiesRawNotes.map(notes => new Set(notes.map(mod31f)));
  let shared = sets[0];
  for (let i = 1; i < sets.length; i++) {
    shared = new Set([...shared].filter(x => sets[i].has(x)));
    if (shared.size === 0) break;
  }
  return Array.from(shared);
}

/* ---------- Landing arpeggio: remap a chord's pitch-class set into a strictly
   ascending sequence spanning raw octave 3 (steps [0,31)) up through octave 5
   (steps [62,93)), so "lowest in octave 3 ... highest in octave 5" holds
   regardless of how many distinct notes the chord has (1 note -> just octave
   3; many notes -> spread evenly across the 3-octave span, each successive
   note strictly higher than the last since pitch classes are pre-sorted and
   octave assignment is monotonic non-decreasing). ---------- */
function arpeggioRawNotesOctave3to5(intervals) {
  const uniq = Array.from(new Set(intervals.map(mod31f))).sort((a, b) => a - b);
  const n = uniq.length;
  if (n === 0) return [];
  if (n === 1) return [uniq[0]];
  return uniq.map((pc, i) => {
    const octave = Math.round((i / (n - 1)) * 2); // 0,1,2 -> octave 3,4,5
    return pc + octave * 31;
  });
}

/* ---------- Per-chord pitch micro-variation: a small deterministic-per-chord
   cents offset (some chords read a bit higher, some a bit lower) purely for
   sonic variety -- derived from the rng at spawn time and stored on the body,
   this helper just documents/bounds the acceptable range so callers don't
   drift into "out of tune" territory. ---------- */
function pickPitchVarianceCents(rng) {
  rng = rng || Math.random;
  return (rng() - 0.5) * 24; // +/-12 cents: audible character, not mistuning
}

/* ---------- Anti-clump: a gentle, continuous alternative to waiting for the
   next earthquake -- when several RESTING bodies end up packed closer than
   `minSeparation`, each gets a small outward nudge away from its neighbors'
   centroid, proportional to how crowded that spot is. Deliberately much
   gentler than an earthquake impulse so it reads as "things don't like to
   pile up" rather than another periodic shake. Only considers bodies the
   caller says are resting/settled -- moving bodies are left alone. ---------- */
function computeAntiClumpNudges(bodies, cfg) {
  cfg = cfg || {};
  const minSeparation = cfg.minSeparation != null ? cfg.minSeparation : 70;
  const nudgeStrength = cfg.nudgeStrength != null ? cfg.nudgeStrength : 18;
  const maxNeighbors = cfg.maxNeighbors != null ? cfg.maxNeighbors : 8;
  const nudges = [];
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    let sx = 0, sy = 0, count = 0;
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const o = bodies[j];
      const d = dist(b.x, b.y, o.x, o.y);
      if (d < minSeparation && d > 1e-6) {
        sx += (b.x - o.x) / d; sy += (b.y - o.y) / d;
        count++;
      }
    }
    if (count >= 2) { // only nudge when it's a genuine cluster (3+ bodies), not just two neighbors resting normally side by side
      const crowding = Math.min(1, count / maxNeighbors);
      const mag = Math.hypot(sx, sy) || 1;
      nudges.push({ id: b.id, fx: (sx / mag) * nudgeStrength * crowding, fy: (sy / mag) * nudgeStrength * crowding });
    }
  }
  return nudges;
}

/* ---------- Nursery: a newly-spawned chord can be "planted" (held fixed at a
   stem attachment point, ignoring normal physics) for a fixed hold duration,
   then released into free movement. Pure edge check only -- the actual
   position-pinning happens at the ecosystem level, same division of labor as
   everywhere else in this module. ---------- */
function shouldDetachFromNursery(attachedAtMs, nowMs, holdMs) {
  holdMs = holdMs != null ? holdMs : 10000;
  return (nowMs - attachedAtMs) >= holdMs;
}

/* ---------- Breathing platforms: a small, slow vertical oscillation applied
   uniformly to a platform's y (both its collision surface and its render
   position use the same number, so nothing resting on it clips/floats).
   Bounded amplitude and a per-platform phase offset so a row of platforms
   doesn't all breathe in lockstep. ---------- */
function platformBreatheOffset(nowMs, phaseSeed, amplitude, periodMs) {
  amplitude = amplitude != null ? amplitude : 5;
  periodMs = periodMs != null ? periodMs : 4200;
  return Math.sin((nowMs / periodMs) * Math.PI * 2 + (phaseSeed || 0)) * amplitude;
}

/* ---------- Day/night brightness ramp: a smooth 0..1 scene-brightness
   multiplier that peaks at solar noon and bottoms out at the deepest part of
   the night, instead of the old instant swap at the day/night boundary.
   frac is the 0..1 progress through the current half-cycle (day or night),
   exactly what drawCelestial already computes. ---------- */
function dayNightBrightness(frac, isNight) {
  const clamped = Math.max(0, Math.min(1, frac));
  const curve = Math.sin(clamped * Math.PI); // 0 at both edges, 1 at the midpoint, for EITHER half-cycle
  return isNight ? (0.42 + curve * 0.18) : (0.72 + curve * 0.28); // night stays dim throughout, day brightens toward noon
}

// A real rise-peak-set arc (not just a shallow wobble): starts at one
// horizon (low, small y going toward the bottom of the sky band), climbs to
// a peak well above the midline (smallest y, i.e. highest on screen) at
// frac=0.5, then descends back to the other horizon at frac=1.
function celestialArcPosition(frac, worldW, worldH) {
  const clamped = Math.max(0, Math.min(1, frac));
  const x = worldW * (0.08 + clamped * 0.84); // horizon to horizon, left to right
  const horizonY = worldH * 0.34;
  const arcHeight = worldH * 0.27;
  const y = horizonY - Math.sin(clamped * Math.PI) * arcHeight;
  return { x, y };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dist, mod31f,
    blackHolePull,
    createTornado, tornadoPositionAt, tornadoForceOn,
    pcSetFromIntervals, isStrictSupersetSet, pickHuntTarget, huntSteer,
    pickSummonPair, summonPull,
    borderProximityState, didCrossBorder,
    chordsWithinRadius, sharedPitchClassesAcross,
    arpeggioRawNotesOctave3to5,
    pickPitchVarianceCents,
    computeAntiClumpNudges,
    shouldDetachFromNursery,
    platformBreatheOffset,
    dayNightBrightness, celestialArcPosition,
  };
}
