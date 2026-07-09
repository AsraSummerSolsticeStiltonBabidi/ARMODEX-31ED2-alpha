// Standalone test for AudioPort's new arpeggio() method (revision round 2,
// landing-arpeggio feature). Reconstructed inline for the same bash-mount
// pinning reason documented in test-director-ext.js -- audioPort.js was
// already read once by bash during the original build's test-audioPort.js
// run, so it's permanently pinned to its pre-this-round content. This is a
// verbatim copy of the real (Windows-side) createAudioPort/createMockDriver
// with the new arpeggio method included.
function createAudioPort(driver) {
  let ambient = null;
  return {
    strum(rawNotes, root, timbre) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playOneShot(rawNotes.slice(), root, timbre || 'guitar', 'strum');
    },
    noiseTick() { driver.playNoise(); },
    arpeggio(rawNotes, root, timbre, totalDurSec) {
      if (!rawNotes || rawNotes.length === 0) return;
      driver.playArpeggio(rawNotes.slice(), root, timbre || 'guitar', totalDurSec || 2);
    },
    startAmbient(rawNotes, root, timbre) {
      if (ambient) driver.stopSustain(ambient.handle);
      const handle = driver.startSustain(rawNotes.slice(), root, timbre || 'guitar');
      ambient = { notes: rawNotes.slice(), root, handle };
    },
    stopAmbient() { if (ambient) { driver.stopSustain(ambient.handle); ambient = null; } },
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
    startSustain(notes, root, timbre) { const h = 'h' + (handleSeq++); calls.push({ type: 'startSustain', notes, root, timbre, handle: h }); return h; },
    stopSustain(handle) { calls.push({ type: 'stopSustain', handle }); },
  };
}

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

{
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  port.startAmbient([0, 4, 7], 0, 'guitar');
  port.arpeggio([0, 10, 18, 41, 55], 0, 'guitar', 2);
  ok('arpeggio reaches the driver with the right notes/duration', driver.calls.some(c => c.type === 'arpeggio' && c.notes.length === 5 && c.totalDurSec === 2));
  ok('arpeggio does NOT touch the ambient slot (no stopSustain call)', !driver.calls.some(c => c.type === 'stopSustain'));
  ok('the ambient started earlier is still active after an arpeggio plays', port.getAmbientNotes() != null);

  driver.calls.length = 0;
  port.arpeggio([], 0, 'guitar', 2);
  ok('an empty note list is a silent no-op, same convention as strum()', driver.calls.length === 0);

  driver.calls.length = 0;
  port.arpeggio([0], 0, 'guitar', 2);
  port.arpeggio([4], 0, 'guitar', 2);
  ok('multiple arpeggios can overlap freely, just like other one-shots', driver.calls.filter(c => c.type === 'arpeggio').length === 2);
}

console.log(`audioPort extension logic: ${pass} assertions passed`);
