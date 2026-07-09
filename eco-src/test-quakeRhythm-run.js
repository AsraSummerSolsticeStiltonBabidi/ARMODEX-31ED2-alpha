const { pickVoiceCounts, createQuakeGrid, onsetsInWindow, quantizeForward } = require('./quakeRhythm.js');
const { makeRng } = require('./util.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

// ---- pickVoiceCounts ----
{
  const rng = makeRng(1);
  for (let i = 0; i < 50; i++) {
    const { voiceA, voiceB } = pickVoiceCounts(rng);
    ok('voiceA/voiceB are always distinct (a genuine polyrhythm, never 1-against-1)', voiceA !== voiceB);
    ok('voiceA/voiceB are always positive integers from the small-subdivision set', Number.isInteger(voiceA) && voiceA > 0 && Number.isInteger(voiceB) && voiceB > 0);
  }
}

// ---- createQuakeGrid ----
{
  const rng = makeRng(42);
  const grid = createQuakeGrid(rng, 8000, 2000); // 8s quake, 2s slot -> 4 slots
  ok('grid records the requested duration', grid.durationMs === 8000);
  ok('grid produces at least voiceA+voiceB onsets per slot (4 slots)', grid.onsets.filter(o => o.voice === 'A' || o.voice === 'B').length >= (grid.voiceA + grid.voiceB) * 4 * 0.9);
  ok('all onset times fall within [0, durationMs)', grid.onsets.every(o => o.t >= 0 && o.t < grid.durationMs));
  let sorted = true;
  for (let i = 1; i < grid.onsets.length; i++) if (grid.onsets[i].t < grid.onsets[i - 1].t) sorted = false;
  ok('onsets are pre-sorted ascending by time', sorted);

  const voiceACount = grid.onsets.filter(o => o.voice === 'A').length;
  ok('voice A produces exactly voiceA onsets per slot, across all slots', voiceACount === grid.voiceA * 4);
  const voiceBCount = grid.onsets.filter(o => o.voice === 'B').length;
  ok('voice B produces exactly voiceB onsets per slot, across all slots', voiceBCount === grid.voiceB * 4);
}

// ---- determinism ----
{
  const gridA = createQuakeGrid(makeRng(99), 10000, 1800);
  const gridB = createQuakeGrid(makeRng(99), 10000, 1800);
  ok('same seed produces an identical grid (needed for reproducible tests/debugging)', JSON.stringify(gridA) === JSON.stringify(gridB));
}

// ---- onsetsInWindow ----
{
  const grid = createQuakeGrid(makeRng(5), 6000, 1500);
  const early = onsetsInWindow(grid, 0, 100);
  const all = onsetsInWindow(grid, -1, grid.durationMs);
  ok('scanning the full range returns every onset', all.length === grid.onsets.length);
  ok('a narrow early window returns only onsets that actually fall in it', early.every(o => o.t > 0 && o.t <= 100));
  // Windows must partition cleanly when chained the way the real per-frame
  // caller will chain them: seed the very first call's lower bound at -1 (so
  // a legitimate onset at t=0 isn't missed), then each subsequent call's
  // lower bound is the previous call's upper bound -- exactly the
  // prevElapsedMs -> elapsedMs pattern the ecosystem loop uses every frame.
  const half1 = onsetsInWindow(grid, -1, 3000);
  const half2 = onsetsInWindow(grid, 3000, 6000);
  ok('adjacent windows (chained the way the real per-frame loop uses them) do not double-count or drop any onset', half1.length + half2.length === all.length);
}

// ---- quantizeForward ----
{
  const grid = createQuakeGrid(makeRng(17), 5000, 1000);
  const first = grid.onsets[0];
  ok('quantizing from before the first onset lands exactly on it', quantizeForward(grid, -50).t === first.t);
  const mid = grid.onsets[Math.floor(grid.onsets.length / 2)];
  const found = quantizeForward(grid, mid.t - 0.001);
  ok('quantizing snaps FORWARD to the next onset at/after the given time, never backward', found.t >= mid.t - 0.001);
  ok('quantizing past the end of the grid returns null (quake is over, nothing left to snap to)', quantizeForward(grid, grid.durationMs + 1) === null);
}

console.log(`quake rhythm layer: ${pass} assertions passed`);
