const {
  computeAntiClumpNudges, shouldDetachFromNursery, platformBreatheOffset,
  dayNightBrightness, celestialArcPosition,
} = require('./forces-final.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

// ---- anti-clump ----
{
  const cluster = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 110, y: 100 }, { id: 'c', x: 105, y: 108 }];
  const nudges = computeAntiClumpNudges(cluster, {});
  ok('a genuine 3-body cluster produces a nudge for every member', nudges.length === 3);
  ok('every nudge is a finite, nonzero push', nudges.every(n => Number.isFinite(n.fx) && Number.isFinite(n.fy) && Math.hypot(n.fx, n.fy) > 0));

  const pairOnly = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 110, y: 100 }];
  ok('just two neighboring bodies (not a real cluster) get no nudge', computeAntiClumpNudges(pairOnly, {}).length === 0);

  const spread = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 500, y: 0 }, { id: 'c', x: 1000, y: 0 }];
  ok('well-separated bodies get no nudge at all', computeAntiClumpNudges(spread, {}).length === 0);
}

// ---- nursery ----
{
  ok('does not detach before the hold duration elapses', shouldDetachFromNursery(1000, 1000 + 9999, 10000) === false);
  ok('detaches exactly once the hold duration has elapsed', shouldDetachFromNursery(1000, 1000 + 10000, 10000) === true);
  ok('detaches (stays detached) well past the hold duration too', shouldDetachFromNursery(1000, 1000 + 50000, 10000) === true);
}

// ---- breathing platforms ----
{
  const amp = 5;
  let maxAbs = 0;
  for (let t = 0; t < 20000; t += 137) maxAbs = Math.max(maxAbs, Math.abs(platformBreatheOffset(t, 0, amp, 4200)));
  ok('breathing offset never exceeds the configured amplitude', maxAbs <= amp + 1e-9);
  ok('different phase seeds produce different offsets at the same instant (platforms don\'t breathe in lockstep)', platformBreatheOffset(1000, 0, amp, 4200) !== platformBreatheOffset(1000, 2.5, amp, 4200));
}

// ---- day/night brightness ----
{
  ok('daytime brightness is always higher than nighttime brightness at the equivalent point in its cycle', dayNightBrightness(0.5, false) > dayNightBrightness(0.5, true));
  ok('brightness peaks at the midpoint of the half-cycle (frac=0.5), for day', dayNightBrightness(0.5, false) > dayNightBrightness(0.02, false));
  ok('brightness peaks at the midpoint of the half-cycle (frac=0.5), for night too (least dark at "midnight" is actually a design choice, not required -- check monotonic shape instead)',
    dayNightBrightness(0.5, true) >= dayNightBrightness(0.02, true) && dayNightBrightness(0.5, true) >= dayNightBrightness(0.98, true));
  ok('brightness is always within a sane [0,1] range', [0, 0.25, 0.5, 0.75, 1].every(f => [true, false].every(n => { const b = dayNightBrightness(f, n); return b >= 0 && b <= 1; })));
}

// ---- celestial arc ----
{
  const w = 900, h = 600;
  const start = celestialArcPosition(0, w, h);
  const mid = celestialArcPosition(0.5, w, h);
  const end = celestialArcPosition(1, w, h);
  ok('arc moves left-to-right in x from start to end', end.x > start.x);
  ok('the peak (frac=0.5) is meaningfully higher on screen (smaller y) than either horizon endpoint', mid.y < start.y - 20 && mid.y < end.y - 20);
  ok('start and end sit at roughly the same horizon height (a real arc, not a lopsided one)', Math.abs(start.y - end.y) < 5);
}

console.log(`forces (part 2, revision-round-2 additions): ${pass} assertions passed`);
