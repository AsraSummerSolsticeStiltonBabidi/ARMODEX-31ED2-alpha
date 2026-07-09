const { createAudioPort, createMockDriver } = require('./audioPort.js');

let pass = 0;
function ok(name, cond) { if (cond) { pass++; } else { throw new Error('FAIL: ' + name); } }

// ---- one-shots overlap freely, pass straight through ----
{
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  port.strum([0, 4, 7], 0, 'guitar');
  port.strum([12, 16, 19], 12, 'sine'); // a second strum before the first would ever "end" -- fine, overlaps
  port.noiseTick();
  ok('strum calls driver.playOneShot exactly once per call', driver.calls.filter(c => c.type === 'oneshot').length === 2);
  ok('strum passes the right notes through untouched', driver.calls[0].notes.join(',') === '0,4,7');
  ok('noiseTick calls driver.playNoise exactly once', driver.calls.filter(c => c.type === 'noise').length === 1);
}

// ---- ambient: starting a new one always cuts the previous one first ----
{
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  port.startAmbient([0, 10, 18], 0, 'guitar');
  ok('first startAmbient starts a sustain, no stop yet', driver.calls.length === 1 && driver.calls[0].type === 'startSustain');
  ok('getAmbientNotes reflects the first pad', port.getAmbientNotes().join(',') === '0,10,18');

  // "fire two overlapping ambient triggers in sequence" -- the exact scenario the spec calls out
  port.startAmbient([5, 15, 23], 5, 'guitar');
  const types = driver.calls.map(c => c.type);
  ok('second startAmbient stops the first THEN starts the second (in that order)',
    types.join(',') === 'startSustain,stopSustain,startSustain');
  ok('exactly one stopSustain total after two overlapping ambient triggers', driver.calls.filter(c => c.type === 'stopSustain').length === 1);
  ok('exactly one ambient voice survives: getAmbientNotes is the SECOND chord, not the first', port.getAmbientNotes().join(',') === '5,15,23');
  const firstHandle = driver.calls[0].handle, stoppedHandle = driver.calls.find(c => c.type === 'stopSustain').handle;
  ok('the handle that got stopped is the FIRST pad\'s handle (not the new one)', firstHandle === stoppedHandle);
}

// ---- a third overlapping trigger still leaves exactly one alive ----
{
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  port.startAmbient([0], 0, 'guitar');
  port.startAmbient([1], 1, 'guitar');
  port.startAmbient([2], 2, 'guitar');
  ok('three rapid-fire ambient starts -> exactly two stops (each new one cuts the previous)', driver.calls.filter(c => c.type === 'stopSustain').length === 2);
  ok('three rapid-fire ambient starts -> exactly three starts', driver.calls.filter(c => c.type === 'startSustain').length === 3);
  ok('only the last one survives', port.getAmbientNotes().join(',') === '2');
}

// ---- stopAmbient ----
{
  const driver = createMockDriver();
  const port = createAudioPort(driver);
  port.stopAmbient(); // no-op when nothing playing, must not throw or call the driver
  ok('stopAmbient on empty slot is a safe no-op', driver.calls.length === 0);
  port.startAmbient([0, 4, 7], 0, 'guitar');
  port.stopAmbient();
  ok('stopAmbient after a real ambient calls stopSustain once', driver.calls.filter(c => c.type === 'stopSustain').length === 1);
  ok('getAmbientNotes is null after stopAmbient', port.getAmbientNotes() === null);
}

console.log(`audioPort layer: ${pass} assertions passed`);
