/* ============================================================================
   ECOSYSTEM — QUAKE RHYTHM (Layer 1b, revision round 2)
   Pure grid generation for the "quantized polyrhythm during an earthquake"
   mechanic, modeled after 31edo-harmonydex_121.html's generative
   Auto-articulation (scheduleArticulatedChord / scheduleRandomTopline,
   ~lines 876-943 of the original file): two voices step evenly through a
   repeating slot, one taking `voiceA` subdivisions and the other `voiceB`
   (the classic "3-against-2" polyrhythm feel), plus an optional random
   topline voice. Here the grid is precomputed as a flat, sorted list of
   {timeMs, voice} onsets covering the whole quake duration so the
   ecosystem-level loop can just ask "what's the next onset at/after t?"
   every frame -- no direct audio/timer code in this module at all.
   ============================================================================ */

function pickVoiceCounts(rng) {
  rng = rng || Math.random;
  const choices = [2, 3, 4, 5, 7];
  const a = choices[Math.floor(rng() * choices.length)];
  let b = choices[Math.floor(rng() * choices.length)];
  if (b === a) b = choices[(choices.indexOf(a) + 1) % choices.length]; // guarantee a genuine polyrhythm, not 1-against-1
  return { voiceA: a, voiceB: b };
}

// durationMs: total quake length. slotMs: length of one repeating cycle.
function createQuakeGrid(rng, durationMs, slotMs) {
  rng = rng || Math.random;
  slotMs = slotMs || (1400 + rng() * 900); // ~1.4-2.3s per slot, a comfortable "bar" length
  const { voiceA, voiceB } = pickVoiceCounts(rng);
  const toplineOn = rng() < 0.55;
  const numSlots = Math.max(1, Math.ceil(durationMs / slotMs));
  const onsets = [];
  for (let s = 0; s < numSlots; s++) {
    const base = s * slotMs;
    for (let i = 0; i < voiceA; i++) {
      const t = base + (i / voiceA) * slotMs;
      if (t < durationMs) onsets.push({ t, voice: 'A' });
    }
    for (let i = 0; i < voiceB; i++) {
      const t = base + (i / voiceB) * slotMs;
      if (t < durationMs) onsets.push({ t, voice: 'B' });
    }
    if (toplineOn) {
      // sparse, phrase-like topline ticks -- not every slot, mirroring the
      // original's ~22% whole-slot-rest / partial-subdivision-skip feel.
      const toplineSteps = Math.max(voiceA, voiceB);
      for (let i = 0; i < toplineSteps; i++) {
        if (rng() < 0.32) {
          const t = base + (i / toplineSteps) * slotMs;
          if (t < durationMs) onsets.push({ t, voice: 'topline' });
        }
      }
    }
  }
  onsets.sort((x, y) => x.t - y.t);
  return { slotMs, voiceA, voiceB, toplineOn, durationMs, onsets };
}

// All onsets with t in (fromMs, toMs] -- used once per frame to find exactly
// which grid points were just crossed during this frame's delta, without
// re-scanning the whole grid from the start every time.
function onsetsInWindow(grid, fromMs, toMs) {
  return grid.onsets.filter(o => o.t > fromMs && o.t <= toMs);
}

// Smallest onset time >= fromMs (used to quantize a collision-triggered
// sound forward onto the next available grid point instead of playing it
// immediately). Returns null if the quake ends before any onset remains.
function quantizeForward(grid, fromMs) {
  for (let i = 0; i < grid.onsets.length; i++) {
    if (grid.onsets[i].t >= fromMs) return grid.onsets[i];
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickVoiceCounts, createQuakeGrid, onsetsInWindow, quantizeForward };
}
