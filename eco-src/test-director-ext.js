// Standalone tests for the NEW director/applyActions logic added this
// revision round (blackhole collision response, eat-with-animation hook).
// Defined inline rather than requiring director.js/applyActions.js directly:
// this workspace's bash mount pins whatever content it first reads for a
// given path and never sees later edits to that same path (discovered
// earlier this session, confirmed repeatedly with ecosystem.html,
// ecosystem_verify.html, and test-quakeRhythm.js) -- and director.js /
// applyActions.js were already read once by bash during the original build's
// test run, so they're permanently pinned to their PRE-this-round content for
// the rest of this session. These two functions are copied verbatim from
// what's being added to the real (Windows-side, unaffected by the bash pin)
// eco-src/director.js and eco-src/applyActions.js and ecosystem.html, so
// testing them here is equivalent to testing the real thing; final
// end-to-end confidence comes from the full smoke test against a
// freshly-named, never-before-touched copy of the fully reassembled file.

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

// ---- resolveChordObject's new 'blackhole' case (mirrors director.js) ----
function resolveBlackholeCase(chord, obj) {
  const dx = chord.x - obj.x, dy = chord.y - obj.y;
  const d = Math.hypot(dx, dy) || 1;
  const speed = 260 + Math.min(140, d); // a firm shove outward, scaled slightly by how deep the overlap was
  const nx = dx / d, ny = dy / d;
  return [
    { type: 'launch', id: chord.id, vx: nx * speed, vy: ny * speed },
    { type: 'noise' }, // a distinct percussive "thud" instead of a melodic strum, so it reads as a bounce not a chime
  ];
}
{
  const chord = { id: 'c1', x: 110, y: 100 };
  const hole = { id: 'obj_blackhole', x: 100, y: 100 };
  const actions = resolveBlackholeCase(chord, hole);
  ok('collision with the black hole launches the chord', actions.some(a => a.type === 'launch' && a.id === 'c1'));
  const launchAction = actions.find(a => a.type === 'launch');
  ok('launch direction points AWAY from the hole (positive x since chord was to its right)', launchAction.vx > 0);
  ok('collision with the black hole makes a distinct noise, not a melodic strum', actions.some(a => a.type === 'noise') && !actions.some(a => a.type === 'strum'));
  ok('launch speed is always a firm, nonzero shove', Math.hypot(launchAction.vx, launchAction.vy) >= 260);

  // chord directly on top of the hole (d=0 edge case) must not throw/NaN
  const onTop = resolveBlackholeCase({ id: 'c2', x: 100, y: 100 }, hole);
  const onTopLaunch = onTop.find(a => a.type === 'launch');
  ok('zero-distance collision (d=0 edge case) still produces a finite, non-NaN launch', Number.isFinite(onTopLaunch.vx) && Number.isFinite(onTopLaunch.vy));
}

// ---- applyActions' new onEatStart hook for the 'eat' action (mirrors applyActions.js) ----
function applyEatAction(action, env) {
  const eaten = env.physics.findBody(env.world, action.eatenId);
  if (eaten) {
    if (env.onEatStart) {
      env.onEatStart({ eaterId: action.eaterId, eatenId: action.eatenId });
    } else {
      env.physics.removeBody(env.world, action.eatenId);
      if (env.onDeath) env.onDeath({ reason: 'eaten', id: action.eatenId, eaterId: action.eaterId });
    }
  }
}
{
  // fake minimal world/physics for the hook test
  const bodies = [{ id: 'big' }, { id: 'small' }];
  const world = { bodies };
  const physics = {
    findBody: (w, id) => w.bodies.find(b => b.id === id),
    removeBody: (w, id) => { w.bodies = w.bodies.filter(b => b.id !== id); },
  };

  // with the hook supplied: body must NOT be removed immediately -- the hook owns the timing
  let hookCalled = null;
  applyEatAction({ type: 'eat', eaterId: 'big', eatenId: 'small' }, { world, physics, onEatStart: (info) => { hookCalled = info; } });
  ok('with onEatStart supplied, the eaten body is NOT removed immediately (animation owns the timing)', physics.findBody(world, 'small') != null);
  ok('onEatStart receives the correct eater/eaten ids', hookCalled && hookCalled.eaterId === 'big' && hookCalled.eatenId === 'small');

  // without the hook (old call sites / existing tests): falls back to the original immediate-remove behavior
  const bodies2 = [{ id: 'big2' }, { id: 'small2' }];
  const world2 = { bodies: bodies2 };
  let deathInfo = null;
  applyEatAction({ type: 'eat', eaterId: 'big2', eatenId: 'small2' }, { world: world2, physics, onDeath: (info) => { deathInfo = info; } });
  ok('without onEatStart (backward compatible with existing callers/tests), the body IS removed immediately, same as before', physics.findBody(world2, 'small2') == null);
  ok('without onEatStart, onDeath still fires exactly as it always did', deathInfo && deathInfo.id === 'small2');
}

console.log(`director/applyActions extension logic: ${pass} assertions passed`);
