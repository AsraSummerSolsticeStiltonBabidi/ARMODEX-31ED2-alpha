/* ============================================================================
   ECOSYSTEM — ACTION APPLIER (Layer 2 glue)
   Executes the plain-data actions resolveCollision() produces against a real
   (or test) world + AudioPort. This is the ONLY place that mutates physics
   bodies in response to game logic and the ONLY place that calls AudioPort
   methods in response to a collision -- physics.js and director.js never
   call each other or audio code directly, exactly per the "sections talk
   through small, explicit function calls" requirement.

   Revision round 2: 'eat' now supports an optional onEatStart hook so the
   eaten body can shrink into the eater's center over a short animation
   instead of vanishing instantly (backward compatible -- without the hook,
   behavior is identical to before). 'strum'/'startAmbient' now look up the
   originating chord (via action.chordId / action.sourceChordId) to pass its
   per-chord pitchVarianceCents through to AudioPort as an extra tuning
   offset, for the "some chords sound a bit higher/lower" feature.
   ============================================================================ */
function applyActions(actions, env) {
  // env: { world, physics: {findBody, removeBody}, audioPort, onDeath?, onAmbientStart?, onEatStart? }
  actions.forEach(action => {
    switch (action.type) {
      case 'strum': {
        const srcChord = action.chordId ? env.physics.findBody(env.world, action.chordId) : null;
        const extraCents = srcChord ? (srcChord.pitchVarianceCents || 0) : 0;
        env.audioPort.strum(action.notes, action.root, action.timbre, extraCents);
        break;
      }
      case 'noise':
        env.audioPort.noiseTick();
        break;
      case 'startAmbient': {
        const srcChord = action.sourceChordId ? env.physics.findBody(env.world, action.sourceChordId) : null;
        const extraCents = srcChord ? (srcChord.pitchVarianceCents || 0) : 0;
        env.audioPort.startAmbient(action.notes, action.root, action.timbre, extraCents);
        if (env.onAmbientStart) env.onAmbientStart(action);
        break;
      }
      case 'launch': {
        const body = env.physics.findBody(env.world, action.id);
        if (body) { body.vx = action.vx; body.vy = action.vy; body.resting = false; }
        break;
      }
      case 'setTransposeOffset': {
        const body = env.physics.findBody(env.world, action.id);
        if (body) body.transposeOffset = action.transposeOffset;
        break;
      }
      case 'eat': {
        const eaten = env.physics.findBody(env.world, action.eatenId);
        if (eaten) {
          // When an onEatStart hook is supplied, it OWNS the removal timing
          // (revision round 2: the eaten chord shrinks into the eater's
          // center over a short animation instead of vanishing instantly) --
          // callers that don't supply it (older code, existing tests) keep
          // getting the original immediate-remove-and-onDeath behavior
          // unchanged, so nothing that already depends on instant removal breaks.
          if (env.onEatStart) {
            env.onEatStart({ eaterId: action.eaterId, eatenId: action.eatenId });
          } else {
            env.physics.removeBody(env.world, action.eatenId);
            if (env.onDeath) env.onDeath({ reason: 'eaten', id: action.eatenId, eaterId: action.eaterId });
          }
        }
        break;
      }
      default:
        break;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyActions };
}
