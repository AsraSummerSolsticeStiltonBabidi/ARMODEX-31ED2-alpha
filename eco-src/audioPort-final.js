/* ============================================================================
   ECOSYSTEM — AUDIO PORT (Layer 2, driver-agnostic half)
   Owns the "one ambient voice at a time" concurrency rule and nothing else.
   One-shots (strum/noise/arpeggio/blip) always just pass through and can
   overlap freely. Ambient (ambient pad/hold) is a single named slot:
   starting a new one always stops whichever was previously playing first.
   This wrapper is identical in tests and production — only the underlying
   `driver` differs (a MockDriver that records calls in tests, a real Web
   Audio driver in ecosystem.html) — so the concurrency rule itself only has
   to be verified once, against the mock, and is trusted from then on.

   Revision round 2 additions: arpeggio() for the landing-arpeggio feature;
   blip() for the zone-border-proximity feature (a very short, fast-release
   tonal tick, distinct from noiseTick's non-tonal filtered noise); strum()
   and startAmbient() both gained an optional trailing extraCents parameter
   (per-chord pitch micro-variation) that passes straight through to the driver.
   ============================================================================ */
function createAudioPort(driver) {
  let ambient = null; // { notes, root, handle }
  return {
    strum(rawNotes, root, timbre, extraCents) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playOneShot(rawNotes.slice(), root, timbre || 'guitar', 'strum', extraCents || 0);
    },
    noiseTick() {
      driver.playNoise();
    },
    arpeggio(rawNotes, root, timbre, totalDurSec, extraCents) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playArpeggio(rawNotes.slice(), root, timbre || 'guitar', totalDurSec || 2, extraCents || 0);
    },
    blip(rawNotes, root, extraCents) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playBlip(rawNotes.slice(), root, extraCents || 0);
    },
    startAmbient(rawNotes, root, timbre, extraCents) {
      if (ambient) driver.stopSustain(ambient.handle);
      const handle = driver.startSustain(rawNotes.slice(), root, timbre || 'guitar', extraCents || 0);
      ambient = { notes: rawNotes.slice(), root, handle };
    },
    stopAmbient() {
      if (ambient) { driver.stopSustain(ambient.handle); ambient = null; }
    },
    getAmbientNotes() { return ambient ? ambient.notes.slice() : null; },
    getAmbientRoot() { return ambient ? ambient.root : null; },
  };
}

function createMockDriver() {
  const calls = [];
  let handleSeq = 1;
  return {
    calls,
    playOneShot(notes, root, timbre, style, extraCents) { calls.push({ type: 'oneshot', notes, root, timbre, style, extraCents }); },
    playNoise() { calls.push({ type: 'noise' }); },
    playArpeggio(notes, root, timbre, totalDurSec, extraCents) { calls.push({ type: 'arpeggio', notes, root, timbre, totalDurSec, extraCents }); },
    playBlip(notes, root, extraCents) { calls.push({ type: 'blip', notes, root, extraCents }); },
    startSustain(notes, root, timbre, extraCents) {
      const handle = 'h' + (handleSeq++);
      calls.push({ type: 'startSustain', notes, root, timbre, extraCents, handle });
      return handle;
    },
    stopSustain(handle) { calls.push({ type: 'stopSustain', handle }); },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAudioPort, createMockDriver };
}
