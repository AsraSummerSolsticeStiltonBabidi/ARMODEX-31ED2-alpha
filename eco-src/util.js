/* ============================================================================
   ECOSYSTEM — SHARED UTIL
   Tiny seeded PRNG (mulberry32) so both tests and the running app can share
   one deterministic-when-seeded random source. Production code seeds it from
   Date.now()/performance.now() (still "effectively random" per spec); tests
   seed it with a fixed number for repeatable assertions.
   ============================================================================ */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRng };
}
