/* ============================================================================
   ECOSYSTEM — DIRECTOR (Layer 2, game-logic half)
   Turns a single physics collision event into a list of plain-data actions.
   Pure function: same (entityA, entityB, ctx) always yields the same
   actions, no side effects, no direct audio/physics calls -- a separate
   applyActions() executes them against the real world + AudioPort. This is
   what makes the collision RULES (share->strum, superset->eat, one ambient
   voice, etc.) testable without any mock audio context at all: just call
   resolveCollision() and inspect the returned array.

   Entity shape this module expects (superset of a physics.js body):
     chord:  { kind:'chord', id, intervals, transposeOffset, zone, isBig, ... }
     object: { kind:'object', id, objectType: 'strum'|'padhold'|'launcher'
                                              |'transposer'|'blackhole', ... }

   ctx shape:
     {
       zoneRootFor(zone) -> number,      // raw step, e.g. A:0  B:gap
       nightSteps: number,               // 0 by day, moon phase (0-30) by night
       rng() -> [0,1),
       getAmbientNotes() -> number[]|null,
       timbre: 'sine'|'guitar',
     }

   Revision round 2: added the black-hole bounce case; the common-tones object
   is no longer a point-collision trigger (it's now a continuous AREA effect
   driven from the ecosystem loop, see forces.js's chordsWithinRadius /
   sharedPitchClassesAcross) so it just falls through to the default (pure
   physics bounce, no game-logic action); 'strum' actions now carry a
   `chordId` back-reference so applyActions can look up that specific chord's
   pitchVarianceCents for the per-chord pitch micro-variation feature.
   ============================================================================ */

function mod31_(n) { return ((n % 31) + 31) % 31; }

function computeChordRawNotes(entity, ctx) {
  const base = ctx.zoneRootFor(entity.zone) + (entity.transposeOffset || 0) + (ctx.nightSteps || 0);
  return entity.intervals.map(iv => base + iv);
}
function pcSetOf(rawNotes) { return new Set(rawNotes.map(mod31_)); }
function isStrictSuperset(big, small) {
  if (big.size <= small.size) return false;
  for (const x of small) if (!big.has(x)) return false;
  return true;
}
function sharedRawNotes(notesA, sharedPcs) { return notesA.filter(n => sharedPcs.has(mod31_(n))); }

function randomNonZeroInt(rng, span) { // integer in [-span, span] excluding 0
  let v;
  do { v = Math.floor(rng() * (span * 2 + 1)) - span; } while (v === 0);
  return v;
}

function resolveChordChord(a, b, ctx) {
  const actions = [];
  const notesA = computeChordRawNotes(a, ctx), notesB = computeChordRawNotes(b, ctx);
  const pcA = pcSetOf(notesA), pcB = pcSetOf(notesB);
  const sharedPcs = new Set([...pcA].filter(x => pcB.has(x)));
  if (sharedPcs.size > 0) {
    actions.push({ type: 'strum', notes: sharedRawNotes(notesA, sharedPcs), root: notesA[0], timbre: ctx.timbre, chordId: a.id });
  } else {
    actions.push({ type: 'noise' });
  }
  if (isStrictSuperset(pcA, pcB)) {
    actions.push({ type: 'eat', eaterId: a.id, eatenId: b.id });
  } else if (isStrictSuperset(pcB, pcA)) {
    actions.push({ type: 'eat', eaterId: b.id, eatenId: a.id });
  }
  return actions;
}

function resolveChordObject(chord, obj, ctx) {
  const notes = computeChordRawNotes(chord, ctx);
  const root = notes[0];
  switch (obj.objectType) {
    case 'strum':
      return [{ type: 'strum', notes, root, timbre: ctx.timbre, chordId: chord.id }];
    case 'padhold':
      return [{ type: 'startAmbient', notes, root, timbre: ctx.timbre, sourceChordId: chord.id, objectId: obj.id }];
    // common-tones is no longer a point-collision trigger (revision round 2)
    // -- see the file header comment. Falls through to default.
    case 'launcher': {
      const angle = ctx.rng() * Math.PI * 2;
      const speed = 220 + ctx.rng() * 90;
      return [
        { type: 'launch', id: chord.id, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed },
        { type: 'strum', notes, root, timbre: ctx.timbre, chordId: chord.id }, // audible confirmation of the hit
      ];
    }
    case 'transposer': {
      const delta = randomNonZeroInt(ctx.rng, 31);
      const newOffset = (chord.transposeOffset || 0) + delta;
      const transposedNotes = notes.map(n => n + delta);
      return [
        { type: 'setTransposeOffset', id: chord.id, transposeOffset: newOffset },
        { type: 'strum', notes: transposedNotes, root: transposedNotes[0], timbre: ctx.timbre, chordId: chord.id }, // confirms the new pitch
      ];
    }
    case 'blackhole': {
      // A firm shove directly AWAY from the hole (not toward -- collision
      // means it got too close despite the pull, so it bounces off hard)
      // plus a distinct percussive noise instead of a melodic strum, so a
      // black-hole bounce reads as a physical event, not another chime.
      const dx = chord.x - obj.x, dy = chord.y - obj.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 260 + Math.min(140, d);
      const nx = dx / d, ny = dy / d;
      return [
        { type: 'launch', id: chord.id, vx: nx * speed, vy: ny * speed },
        { type: 'noise' },
      ];
    }
    default:
      return [];
  }
}

// entityA/entityB are the two colliding bodies (order from physics is
// arbitrary); normalizes which is the chord vs the object where relevant.
function resolveCollision(entityA, entityB, ctx) {
  if (entityA.kind === 'chord' && entityB.kind === 'chord') return resolveChordChord(entityA, entityB, ctx);
  if (entityA.kind === 'chord' && entityB.kind === 'object') return resolveChordObject(entityA, entityB, ctx);
  if (entityB.kind === 'chord' && entityA.kind === 'object') return resolveChordObject(entityB, entityA, ctx);
  return []; // object-vs-object: no game logic defined, physics-only bounce
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolveCollision, computeChordRawNotes, pcSetOf, isStrictSuperset, randomNonZeroInt };
}
