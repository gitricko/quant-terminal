import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ind from '../custom/washout-short.js';

const bars = JSON.parse(readFileSync(new URL('./fixtures/btc-1d.json', import.meta.url), 'utf8'));

// Minimal, independent ta shim (mirrors ta.source / ta.highest we rely on).
function source(bars, k) { return bars.map((b) => b[k]); }
function highest(src, n) {
  const out = new Array(src.length).fill(NaN);
  for (let i = n - 1; i < src.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.max(m, src[j]);
    out[i] = m;
  }
  return out;
}

// Independent, deliberately naive re-implementation of the mirrored 5 checks,
// written in a different shape (explicit per-check booleans) from calc().
function naiveCalc(bars, L, WICK, mode) {
  const N = bars.length;
  const O = bars.map((b) => b.open), C = bars.map((b) => b.close);
  const H = bars.map((b) => b.high), Lo = bars.map((b) => b.low);
  const V = bars.map((b) => b.volume);
  const a5 = new Array(N).fill(null), a4 = new Array(N).fill(null);
  const a5x = new Array(N).fill(null), a4x = new Array(N).fill(null);

  const priorTwoGreen = (i) => {
    const d1 = (C[i - 1] > O[i - 1] ? 1 : C[i - 1] < O[i - 1] ? -1 : 0) * V[i - 1];
    const d2 = (C[i - 2] > O[i - 2] ? 1 : C[i - 2] < O[i - 2] ? -1 : 0) * V[i - 2];
    return d1 + d2 > 0;
  };
  const redClose = (i) => C[i] <= O[i];
  const upperWick = (i) => { const r = H[i] - Lo[i]; return r > 0 && (H[i] - Math.max(O[i], C[i])) / r >= WICK; };
  const holdFail = (i) => Lo[i] <= Lo[i - 1];
  const volUp = (i) => V[i] > V[i - 1];
  const kAt = (i) =>
    (redClose(i) ? 1 : 0) + (upperWick(i) ? 1 : 0) + (holdFail(i) ? 1 : 0) +
    (volUp(i) ? 1 : 0) + (priorTwoGreen(i) ? 1 : 0);

  const wantEarly = mode !== 'Exact (confirmed pivot)';
  if (wantEarly) {
    const hh = highest(H, L + 1);
    for (let i = L + 1; i < N; i++) {
      if (H[i] < hh[i]) continue;
      const k = kAt(i);
      if (k === 5) a5[i] = 1; else if (k === 4) a4[i] = 1;
    }
  }
  const wantExact = mode !== 'Early (candidate)';
  if (wantExact) {
    for (let i = L; i <= N - 1 - L; i++) {
      let pivot = true;
      for (let j = i - L; j <= i + L; j++) if (H[i] < H[j]) { pivot = false; break; }
      if (!pivot) continue;
      const k = kAt(i);
      if (k === 5) a5x[i] = 1; else if (k === 4) a4x[i] = 1;
    }
  }
  return { early5: a5, early4: a4, exact5: a5x, exact4: a4x };
}

function runAll(bars, L, WICK, mode) {
  const ta = { source, highest };
  const res = ind.calc(bars, { pivotLen: L, minWickPct: WICK, mode }, ta);
  return { early5: res.early5, early4: res.early4, exact5: res.exact5, exact4: res.exact4, markers: res.markers };
}

test('Washout Short matches an independent naive implementation (early mode)', () => {
  const L = 4, WICK = 0.4;
  const got = runAll(bars, L, WICK, 'Early (candidate)');
  const want = naiveCalc(bars, L, WICK, 'Early (candidate)');
  assert.deepEqual(got.early5, want.early5);
  assert.deepEqual(got.early4, want.early4);
  // Exact arrays must be untouched in early-only mode.
  assert.deepEqual(got.exact5, new Array(bars.length).fill(null));
  assert.deepEqual(got.exact4, new Array(bars.length).fill(null));
});

test('Washout Short matches an independent naive implementation (exact mode)', () => {
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

test('a hand-built top bar fires a 5/5 early signal above the bar', () => {
  // b0 green, b1 green, b2 = rejected fresh high: red close, long upper wick,
  // low fails to hold prior low, volume up, prior two bars net-green.
  const top = [
    { time: 0, open: 100, high: 112, low: 99, close: 110, volume: 10 },
    { time: 1, open: 110, high: 122, low: 109, close: 120, volume: 50 },
    { time: 2, open: 120, high: 140, low: 105, close: 115, volume: 51 },
  ];
  const L = 1, WICK = 0.4;
  const got = runAll(top, L, WICK, 'Early (candidate)');
  assert.deepEqual(got.early5, [null, null, 1], 'b2 must be a 5/5 early signal');
  const m = got.markers.find((x) => x.time === 2 && x.text === 'S 5/5');
  assert.ok(m, 'must carry a 5/5 marker at the top bar');
  assert.equal(m.position, 'aboveBar');
  assert.equal(m.shape, 'arrowDown');
  assert.equal(m.color, '#ff3b3b');
});

test('a bar that is a fresh high but NOT bearish does not fire', () => {
  // All "checks" lean bullish (green close, no upper wick) → no 5/5 or 4/5.
  const bull = [
    { time: 0, open: 100, high: 104, low: 99, close: 103, volume: 10 },
    { time: 1, open: 103, high: 107, low: 102, close: 106, volume: 12 },
    { time: 2, open: 106, high: 130, low: 104, close: 129, volume: 9 }, // closes green at the top
  ];
  const L = 1, WICK = 0.4;
  const got = runAll(bull, L, WICK, 'Early (candidate)');
  // redClose false, upperWick: h-max(o,c)=130-129=1 over range 26 → 0.038 < 0.4 false,
  // holdFail: low 104 <= prior low 102? no. volUp: 9 > 12? no. priorTwoGreen: +. k <= 1.
  assert.equal(got.early5[2], null);
  assert.equal(got.early4[2], null);
});
