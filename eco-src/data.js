/* ============================================================================
   ECOSYSTEM — DATA LAYER
   Pure, side-effect-free functions ported from 31edo-harmonydex_121.html
   (mod31, effectiveIntervals, signatureOf, computeSpecies,
   computeMostCommonChordPair, findSpeciesContains, freqForRaw/REF_FREQ).
   No DOM, no localStorage, no audio in this file — everything here takes
   plain data in and returns plain data out, so it can be unit tested under
   plain Node with zero mocking. localStorage reading lives in loader.js.
   ============================================================================ */

const N_STEPS = 31;

function mod31(n) { return ((n % N_STEPS) + N_STEPS) % N_STEPS; }

// Mirrors 31edo-harmonydex_121.html's effectiveIntervals(): with octave
// equivalence ON, fold every interval into one octave and dedupe; OFF, keep
// the raw (possibly >31 or negative) intervals as originally voiced.
function effectiveIntervals(rawIntervals, octaveEquivalence) {
  if (octaveEquivalence) return Array.from(new Set(rawIntervals.map(mod31))).sort((a, b) => a - b);
  return rawIntervals.slice().sort((a, b) => a - b);
}

function signatureOf(intervals) { return intervals.join('.'); }

// Mirrors computeSpecies(): derives the canonical deduplicated list of
// "shapes" from every chord in every progression, keeping first-seen raw
// intervals plus an occurrence count.
function computeSpecies(progressions, octaveEquivalence) {
  const map = {}; const order = [];
  (progressions || []).forEach(p => {
    (p.chords || []).forEach((c, idx) => {
      const eff = effectiveIntervals(c.intervals, octaveEquivalence);
      const sig = signatureOf(eff);
      if (!map[sig]) {
        // Keep the first occurrence's raw (unfolded) intervals AND its exact
        // hex-map qrOffsets (root-relative {q,r} per raw interval), when the
        // chord was built via the hex map -- this is what lets Ecosystem draw
        // each creature's "limbs" in the same real layout as the main app's
        // hex-map preview, not a generic radial guess. Mirrors computeSpecies
        // in 31edo-harmonydex_121.html exactly.
        const rawIntervals = c.intervals.slice();
        const qrOffsets = (c.qrOffsets && c.qrOffsets.length === rawIntervals.length) ? c.qrOffsets : null;
        map[sig] = { signature: sig, intervals: eff.slice(), rawIntervals, qrOffsets, count: 0, occurrences: [] };
        order.push(sig);
      }
      map[sig].count++;
      map[sig].occurrences.push({ progId: p.id, progName: p.name, idx, root: c.root, label: c.label || '' });
    });
  });
  order.forEach((sig, i) => { map[sig].num = i + 1; });
  return { map, list: order.map(s => map[s]) };
}

// ---- hex-map geometry (ported verbatim from 31edo-harmonydex_121.html) ----
function pitchAt(q, r) { return 8 * q + 3 * r; }
function axialToPixel(q, r, size) { return { x: size * 1.5 * q, y: size * Math.sqrt(3) * (r + q / 2) }; }

// Normalizes a chord's real hex-map layout (from qrOffsets, root-relative)
// into a root-centered pixel skeleton scaled so the farthest note sits
// exactly `targetSpan` px from the root -- same shape/topology as the main
// app's hex-map preview, just uniformly resized to fit a creature body.
// Falls back to an evenly-spaced radial layout when qrOffsets isn't
// available (e.g. a chord never built via the hex map).
function computeChordLayout(rawIntervals, qrOffsets, targetSpan) {
  const rootIdx = rawIntervals.indexOf(0);
  const safeRootIdx = rootIdx >= 0 ? rootIdx : 0;
  if (qrOffsets && qrOffsets.length === rawIntervals.length) {
    const pts = qrOffsets.map(p => axialToPixel(p.q, p.r, 1));
    const rootPt = pts[safeRootIdx] || { x: 0, y: 0 };
    const rel = pts.map(p => ({ x: p.x - rootPt.x, y: p.y - rootPt.y }));
    const maxDist = Math.max(1e-6, ...rel.map(p => Math.hypot(p.x, p.y)));
    const scale = rel.length <= 1 ? 0 : targetSpan / maxDist;
    return rel.map(p => ({ x: p.x * scale, y: p.y * scale }));
  }
  const n = rawIntervals.length;
  const others = Math.max(1, n - 1);
  return rawIntervals.map((iv, i) => {
    if (i === safeRootIdx) return { x: 0, y: 0 };
    const idxAmongOthers = i < safeRootIdx ? i : i - 1;
    const angle = (idxAmongOthers / others) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * targetSpan, y: Math.sin(angle) * targetSpan };
  });
}

// Mirrors findSpeciesContains(): which OTHER cataloged shapes fit inside this
// one as a sub-fragment, always compared by pitch class (fold via mod31)
// regardless of the octave-equivalence setting, exactly like the main app.
function findFragmentContains(Fpc, speciesList, excludeSig) {
  const Fset = new Set(Fpc);
  const contains = [];
  speciesList.forEach(other => {
    if (other.signature === excludeSig) return;
    const Spc = Array.from(new Set(other.intervals.map(mod31)));
    if (Spc.length >= Fpc.length) return; // must be strictly smaller to count as "contains"
    const fits = Fpc.some(d => Spc.every(s => Fset.has(mod31(s + d))));
    if (fits) contains.push(other);
  });
  return contains;
}
function findSpeciesContains(sp, speciesList) {
  const Fpc = Array.from(new Set(sp.intervals.map(mod31)));
  return findFragmentContains(Fpc, speciesList, sp.signature);
}

// Mirrors computeMostCommonChordPair(): the single most frequent
// {shapeA, root-gap, shapeB} relationship between two consecutive chords
// across the whole collection (count must be >=2 to count as "common").
function computeMostCommonChordPair(progressions, octaveEquivalence) {
  const counts = {};
  (progressions || []).forEach(p => {
    for (let i = 0; i < (p.chords || []).length - 1; i++) {
      const cA = p.chords[i], cB = p.chords[i + 1];
      const sigA = signatureOf(effectiveIntervals(cA.intervals, octaveEquivalence));
      const sigB = signatureOf(effectiveIntervals(cB.intervals, octaveEquivalence));
      const gap = cB.root - cA.root;
      const key = sigA + '|' + gap + '|' + sigB;
      if (!counts[key]) counts[key] = { count: 0, sigA, sigB, gap };
      counts[key].count++;
    }
  });
  let best = null;
  Object.values(counts).forEach(c => { if (!best || c.count > best.count) best = c; });
  return (best && best.count >= 2) ? best : null;
}

// Fallback zone-B root when the collection has no repeated pair (best.count>=2
// requirement not met): reuse the same aggregation but accept count>=1, and
// if there are truly no consecutive-chord pairs at all (e.g. no progressions
// with 2+ chords), fall back to a fixed neutral interval of 18 steps
// (~697 cents, close to a 12-tET fifth) so the two zones are still audibly
// distinct. Documented explicitly since this is a judgment call, not spec'd.
const FALLBACK_ZONE_GAP = 18;
function computeZoneBGap(progressions, octaveEquivalence) {
  const strict = computeMostCommonChordPair(progressions, octaveEquivalence);
  if (strict) return strict.gap;
  const counts = {};
  (progressions || []).forEach(p => {
    for (let i = 0; i < (p.chords || []).length - 1; i++) {
      const cA = p.chords[i], cB = p.chords[i + 1];
      const gap = cB.root - cA.root;
      counts[gap] = (counts[gap] || 0) + 1;
    }
  });
  let bestGap = null, bestCount = 0;
  Object.entries(counts).forEach(([gap, count]) => { if (count > bestCount) { bestCount = count; bestGap = parseInt(gap, 10); } });
  return bestGap !== null ? bestGap : FALLBACK_ZONE_GAP;
}

// "Big" chord determination (user's chosen definition: contains many other
// collected chords). containCount = how many other cataloged species fit
// inside this one as sub-fragments (findSpeciesContains). Chords land in the
// top third of the collection by that count are "big" and get the 1-minute
// lifespan timer; everything else lives until eaten. A species with
// containCount 0 is never "big" regardless of where the cutoff falls.
function annotateBigSpecies(speciesList) {
  const withCounts = speciesList.map(sp => ({ sp, containCount: findSpeciesContains(sp, speciesList).length }));
  const sorted = withCounts.slice().sort((a, b) => b.containCount - a.containCount);
  const cutoffIdx = Math.max(0, Math.floor(sorted.length / 3) - 1);
  const cutoffValue = sorted.length ? Math.max(sorted[Math.min(cutoffIdx, sorted.length - 1)].containCount, 1) : 1;
  withCounts.forEach(({ sp, containCount }) => {
    sp.containCount = containCount;
    sp.isBig = containCount > 0 && containCount >= cutoffValue;
  });
  return speciesList;
}

const REF_FREQ = 220; // frequency assigned to raw step 0, mirrors the main app
function freqForRaw(raw, generalPitchCents) {
  return REF_FREQ * Math.pow(2, raw / N_STEPS) * Math.pow(2, (generalPitchCents || 0) / 1200);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    N_STEPS, mod31, effectiveIntervals, signatureOf, computeSpecies,
    findSpeciesContains, computeMostCommonChordPair, computeZoneBGap,
    FALLBACK_ZONE_GAP, annotateBigSpecies, REF_FREQ, freqForRaw,
    pitchAt, axialToPixel, computeChordLayout,
  };
}
