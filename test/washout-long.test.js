import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ind from '../custom/washout-long.js';

const bars = JSON.parse(readFileSync(new URL('./fixtures/btc-1d.json', import.meta.url), 'utf8'));

// Minimal, independent ta shim (mirrors ta.source / ta.lowest we rely on).
function source(barRows, k) { return barRows.map((b) => b[k]); }
function lowest(src, n) {
  const out = new Array(src.length).fill(NaN);
  for (let i = n - 1; i < src.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.min(m, src[j]);
    out[i] = m;
  }
  return out;
}

// Independent, deliberately naive re-implementation of the 5 long-side checks,
// written in a different shape (explicit per-check booleans) from the indicator.
function naiveCalc(barRows, L, WICK, mode) {
  const N = barRows.length;
  const O = barRows.map((b) => b.open), C = barRows.map((b) => b.close);
  const H = barRows.map((b) => b.high), Lo = barRows.map((b) => b.low);
  const V = barRows.map((b) => b.volume);
  const a5 = new Array(N).fill(null), a4 = new Array(N).fill(null);
  const a5x = new Array(N).fill(null), a4x = new Array(N).fill(null);

  const greenClose = (i) => C[i] >= O[i];
  const lowerWick = (i) => { const r = H[i] - Lo[i]; return r > 0 && (Math.min(O[i], C[i]) - Lo[i]) / r >= WICK; };
  const reclaim = (i) => H[i] >= H[i - 1];
  const volUp = (i) => V[i] > V[i - 1];
  const priorTwoRed = (i) => {
    const d1 = (C[i - 1] > O[i - 1] ? 1 : C[i - 1] < O[i - 1] ? -1 : 0) * V[i - 1];
    const d2 = (C[i - 2] > O[i - 2] ? 1 : C[i - 2] < O[i - 2] ? -1 : 0) * V[i - 2];
    return d1 + d2 < 0;
  };
  const kAt = (i) =>
    (greenClose(i) ? 1 : 0) + (lowerWick(i) ? 1 : 0) + (reclaim(i) ? 1 : 0) +
    (volUp(i) ? 1 : 0) + (priorTwoRed(i) ? 1 : 0);

  const wantEarly = mode !== 'Exact (confirmed pivot)';
  if (wantEarly) {
    const ll = lowest(Lo, L + 1);
    for (let i = L + 1; i < N; i++) {
      if (Lo[i] > ll[i]) continue;
      const k = kAt(i);
      if (k === 5) a5[i] = 1; else if (k === 4) a4[i] = 1;
    }
  }
  const wantExact = mode !== 'Early (candidate)';
  if (wantExact) {
    for (let i = L; i <= N - 1 - L; i++) {
      let isPivot = true;
      for (let j = i - L; j <= i + L; j++) if (Lo[i] > Lo[j]) { isPivot = false; break; }
      if (!isPivot) continue;
      const k = kAt(i);
      if (k === 5) a5x[i] = 1; else if (k === 4) a4x[i] = 1;
    }
  }
  return { early5: a5, early4: a4, exact5: a5x, exact4: a4x };
}

function runAll(barRows, L, WICK, mode) {
  const ta = { source, lowest };
  const res = ind.calc(barRows, { pivotLen: L, minWickPct: WICK, mode }, ta);
  return { early5: res.early5, early4: res.early4, exact5: res.exact5, exact4: res.exact4, markers: res.markers };
}

test('Washout Long matches an independent naive implementation (early mode)', () => {
  const L = 4, WICK = 0.4;
  const got = runAll(bars, L, WICK, 'Early (candidate)');
  const want = naiveCalc(bars, L, WICK, 'Early (candidate)');
  assert.deepEqual(got.early5, want.early5);
  assert.deepEqual(got.early4, want.early4);
  // Exact arrays must be untouched in early-only mode.
  assert.deepEqual(got.exact5, new Array(bars.length).fill(null));
  assert.deepEqual(got.exact4, new Array(bars.length).fill(null));
});

test('Washout Long matches an independent naive implementation (exact mode)', () => {
  const L = 4, WICK = 0.4;
  const got = runAll(bars, L, WICK, 'Exact (confirmed pivot)');
  const want = naiveCalc(bars, L, WICK, 'Exact (confirmed pivot)');
  assert.deepEqual(got.exact5, want.exact5);
  assert.deepEqual(got.exact4, want.exact4);
  assert.deepEqual(got.early5, new Array(bars.length).fill(null));
  assert.deepEqual(got.early4, new Array(bars.length).fill(null));
});

test('outputs are arrays the right length with only 0/1-or-null entries', () => {
  const L = 4, WICK = 0.4;
  const got = runAll(bars, L, WICK, 'Both');
  for (const key of ['early5', 'early4', 'exact5', 'exact4']) {
    const arr = got[key];
    assert.equal(Array.isArray(arr), true, `${key} must be an array`);
    assert.equal(arr.length, bars.length, `${key} length must match bars`);
    for (const x of arr) assert.ok(x === null || x === 1, `${key} entries are null or 1, got ${x}`);
  }
});

test('a hand-built bottom bar fires a 5/5 early signal below the bar', () => {
  // b0 red, b1 red, b2 = washed-out fresh low: green close, long lower wick,
  // high reclaims prior high, volume up, prior two bars net-red.
  const dip = [
    { time: 0, open: 110, high: 112, low: 99,  close: 100, volume: 50 },
    { time: 1, open: 105, high: 107, low: 96,  close: 99,  volume: 10 },
    { time: 2, open: 100, high: 110, low: 90,  close: 108, volume: 12 },
  ];
  const L = 1, WICK = 0.4;
  const got = runAll(dip, L, WICK, 'Early (candidate)');
  assert.deepEqual(got.early5, [null, null, 1], 'b2 must be a 5/5 early signal');
  const m = got.markers.find((x) => x.time === 2 && x.text === 'L 5/5');
  assert.ok(m, 'must carry a 5/5 marker at the bottom bar');
  assert.equal(m.position, 'belowBar');
  assert.equal(m.shape, 'arrowUp');
  assert.equal(m.color, '#32cd32');
});

test('a bar that is a fresh low but NOT bullish does not fire', () => {
  // All "checks" lean bearish (red close, no lower wick) → no 5/5 or 4/5.
  const bear = [
    { time: 0, open: 100, high: 104, low: 99,  close: 103, volume: 10 },
    { time: 1, open: 103, high: 107, low: 102, close: 106, volume: 12 },
    { time: 2, open: 106, high: 104, low: 78,  close: 79,  volume: 9  }, // closes red at the bottom
  ];
  const L = 1, WICK = 0.4;
  const got = runAll(bear, L, WICK, 'Early (candidate)');
  // greenClose false; lowerWick min(o,c)-low = 79-78 = 1 over range 26 → 0.038 < 0.4 false;
  // reclaim: high 104 >= prior high 107? no; volUp 9>12? no. k <= 1.
  assert.equal(got.early5[2], null);
  assert.equal(got.early4[2], null);
});

test('candidate gate: passes all 5 checks but not the window-min low → suppressed', () => {
  // Pins the one genuine decision branch (custom/washout-long.js EARLY loop):
  //   if (!(low[i] <= lowest(low, L+1))) continue;
  // A bar passing all 5 per-check conditions fires ONLY when it is also the
  // window-min low. Drop the gate and bar 5 leaks a signal; this test turns
  // red even though every per-check test stays green.

  // Window = bars [i-L .. i-1] (lowest(low, pivotLen+1) over that slice).
  // Bars 0-2 are dummies; bars 3,4 are the window fuel (both net-red).
  // Bar 4's LOW (95) is the window-min low; bar 5's low (96) is ABOVE it.
  // Bar 5 still passes all 5 per-check conditions — green close, big lower
  // wick, high reclaims prior high, volume up, prior two net-red — but the
  // gate suppresses it because its low is not the window-min low.
  const rows = [
    { time: 0, open: 110, high: 112, low: 106, close: 111, volume: 10 },
    { time: 1, open: 110, high: 112, low: 106, close: 111, volume: 10 },
    { time: 2, open: 110, high: 112, low: 106, close: 111, volume: 10 },
    { time: 3, open: 100, high: 104, low:  94, close:  95, volume: 10 }, // red (100→95)
    { time: 4, open:  98, high: 101, low:  95, close:  97, volume: 10 }, // red (98→97), window-min low=95
    { time: 5, open: 105, high: 118, low:  96, close: 112, volume: 20 }, // target: all checks pass, low=96 > 95 → GATED
  ];
  //   Bar 5 per-check audit (window = bars 1..4, window-min low = 95):
  //     greenClose  close 112 >= open 105                  → T
  //     lowerWick   (105-96)/(118-96) = 9/22 = 0.409       → T (threshold 0.4)
  //     reclaim     high 118 >= prior high 101             → T
  //     volUp       volume 20 > prior 10                   → T
  //     priorRed    (95-100)*10 + (97-98)*10 = -60 < 0     → T
  //   All 5 pass. Gate: low[5]=96 > window-min-low 95 → gate SUPPRESSES
  //   (not the window-min). exactly the case the test name says.
  //   So got.early5[5] and got.early4[5] must both be null.
  const gotGated = runAll(rows, 4, 0.4, 'Early (candidate)');
  assert.equal(gotGated.early5[5], null, 'bar 5: 5/5 checks but low NOT the window-min → suppressed');
  assert.equal(gotGated.early4[5], null);
});

test('EXACT pivot: a bar that is a confirmed pivot low but NOT bullish does not fire', () => {
  // 7 bars, pivot at bar 3 (L=2). Bar 3 is a red close (not bullish) → no 5/5.
  const piv = [
    { time: 0, open: 105, high: 108, low: 104, close: 106, volume: 10 },
    { time: 1, open: 106, high: 109, low: 105, close: 107, volume: 10 },
    { time: 2, open: 107, high: 110, low: 104, close: 105, volume: 10 },
    { time: 3, open: 102, high: 105, low:  90, close:  98, volume: 12 }, // pivot low, RED close
    { time: 4, open:  98, high: 104, low:  95, close: 103, volume: 10 },
    { time: 5, open: 103, high: 107, low: 101, close: 104, volume: 10 },
    { time: 6, open: 104, high: 108, low: 103, close: 105, volume: 10 },
  ];
  const L = 2, WICK = 0.4;
  const got = runAll(piv, L, WICK, 'Exact (confirmed pivot)');
  // Bar 3 is a confirmed pivot low: low 90 is the min over [1..5] (105, 104, 90, 95, 101).
  // Per-check audit: greenClose 98>=102? NO | lowerWick (98-90)/15 = 0.533 T
  // | reclaim 105>=105 T | volUp 12>10 T | priorTwoRed +10-10 = 0 → F.  k = 3
  // → less than 4/5, so neither exact5[3] nor exact4[3] fires.
  assert.equal(got.exact5[3], null);
  assert.equal(got.exact4[3], null);
});
