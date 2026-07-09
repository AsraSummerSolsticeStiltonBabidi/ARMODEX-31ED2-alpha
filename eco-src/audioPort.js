/* ============================================================================
   ECOSYSTEM — AUDIO PORT (Layer 2, driver-agnostic half)
   Owns the "one ambient voice at a time" concurrency rule and nothing else.
   One-shots (strum/noise) always just pass through and can overlap freely.
   Ambient (ambient pad/hold) is a single named slot: starting a new one
   always stops whichever was previously playing first. This wrapper is
   identical in tests and production — only the underlying `driver` differs
   (a MockDriver that records calls in tests, a real Web Audio driver in
   ecosystem.html) — so the concurrency rule itself only has to be verified
   once, against the mock, and is trusted from then on.
   ============================================================================ */
function createAudioPort(driver) {
  let ambient = null; // { notes, root, handle }
  return {
    strum(rawNotes, root, timbre) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playOneShot(rawNotes.slice(), root, timbre || 'guitar', 'strum');
    },
    noiseTick() {
      driver.playNoise();
    },
    // Landing arpeggio (revision round 2): a distinct one-shot burst, spread
    // across `totalDurSec` instead of the tight strum stagger -- overlaps
    // freely with everything else exactly like strum/noise, since it's tied
    // to a specific landing event, not the ambient slot.
    arpeggio(rawNotes, root, timbre, totalDurSec) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playArpeggio(rawNotes.slice(), root, timbre || 'guitar', totalDurSec || 2);
    },
    startAmbient(rawNotes, root, timbre) {
      if (ambient) driver.stopSustain(ambient.handle);
      const handle = driver.startSustain(rawNotes.slice(), root, timbre || 'guitar');
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
    playOneShot(notes, root, timbre, style) { calls.push({ type: 'oneshot', notes, root, timbre, style }); },
    playNoise() { calls.push({ type: 'noise' }); },
    playArpeggio(notes, root, timbre, totalDurSec) { calls.push({ type: 'arpeggio', notes, root, timbre, totalDurSec }); },
    startSustain(notes, root, timbre) {
      const handle = 'h' + (handleSeq++);
      calls.push({ type: 'startSustain', notes, root, timbre, handle });
      return handle;
    },
    stopSustain(handle) { calls.push({ type: 'stopSustain', handle }); },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAudioPort, createMockDriver };
}
