// Washout Long — port of the Pine v6 script
//   h1_washout_low_5of5_4of5.pine  ("H1 Washout Low 5/5 + 4/5 (Early + Exact)")
// Renamed from "Washout Low" → "Washout Long" so the sibling pair reads as
// two directional setups (Washout Long ↔ Washout Short) rather than
// "low" vs "short" (which can sound like overlapping ideas).
// Reference backtest: data/tmp/README.md (H1 washout low from spy_2026-10-15.md §5b).
//
// A bar is a "washout long" when:
//   EARLY  mode: low <= lowest(low, pivotLen+1)  [candidate, fires in-bar]
//   EXACT  mode: ta.pivotlow(low, pivotLen, pivotLen) confirmed  [fires pivotLen bars late]
// and 4 or 5 of the 5 checks pass:
//   1. green close (close >= open)
//   2. long lower wick: min(open, close) - low  >= minWickPct * (high - low)
//   3. reclaim: high >= high[-1]
//   4. volume expansion: volume > volume[-1]
//   5. net-red prior 2 bars: sign(c-o)*v  [at -1 and -2]  sums < 0
//
// Outputs (for alerts; see docs/custom-indicators.md §Alerts):
//   early5, early4  — early (candidate, left-only)
//   exact5, exact4  — exact (ta.pivotlow, delayed by pivotLen)
//   only4           — exactly-4 tier (fires where 4/5 passes but NOT 5/5 — useful for
//                     "4/5 but not 5/5" grid cells so 5/5 and 4/5 rows don't overlap)
//   cc5 / ch5       — 5/5 pulse CONFIRMED one bar later: close[T+1] > close[T] / > high[T]
//   cc4 / ch4       — same, anchored to the 4/5 pulse (fires on 4/5 or 5/5 pulses, Pine parity)
//   triggerLow      — the anchor stop for the strategy: low[i] at every pulse bar (5/5 or 4/5),
//                     NaN elsewhere. The backtester resolves the final stop via stopLoss.refBar:
//                       pulse rows → refBar 'signal' (fires at T)     reads triggerLow[T] = low[T]
//                       cc/ch rows → refBar 'prior'  (fires at T+1)   reads triggerLow[T] = low[T]
//                     i.e. "the low of the trigger (pulse) bar" in both cases, per the spec.
//   (Pine's "5of5/4of5" names can't be output keys here — must start with a letter.)
//
// Markers on the price chart (below the low), the mirror of Washout Short:
//   triangle-up (lime)     = 5/5
//   circle     (orange)    = 4/5
//   exact-mode markers carry " (X)" in their text (matches the Pine original).
//
// Output labels + marker text use "L" (for Long) so the long/short pair
// reads as a directional mirror.

export default {
  name: "Washout Long",
  overlay: true, // price chart — markers only for the user
  // chart.js:647 — opt every output series out of the pane's autoscale: the
  // alert-facing arrays still hold 0/1 per bar (alerts read res via indResults),
  // but their 0-baseline doesn't drag the price y-axis down to level 0 and
  // compress the price range when you zoom in.
  noAutoscale: true,
  inputs: [
    { key: "pivotLen", label: "pivotLen", type: "int", default: 4, min: 1 },
    { key: "minWickPct", label: "Min lower-wick % of range", type: "float", default: 0.40, min: 0, max: 1 },
    { key: "mode", label: "Signal mode", type: "select", default: "Both",
      options: ["Early (candidate)", "Exact (confirmed pivot)", "Both"] },
  ],
  // Note: output keys must start with a letter (docs/custom-indicators.md), so the
  // Pine names 5of5/4of5 become early5/early4/exact5/exact4. The labels keep "5/5".
  // These arrays are for ALERTS (see docs/custom-indicators.md §Alerts). On the
  // chart they render as zero-height bars (invisible) because noAutoscale is set
  // above, so the price scale keeps its full range.
  outputs: [
    { key: "early5", label: "L 5/5 (early)", kind: "histogram", color: "#32cd32" },
    { key: "early4", label: "L 4/5 (early)", kind: "histogram", color: "#ff8c00" },
    { key: "exact5", label: "L 5/5 (exact)", kind: "histogram", color: "#32cd32" },
    { key: "exact4", label: "L 4/5 (exact)", kind: "histogram", color: "#ff8c00" },
    { key: "only4", label: "L 4/5 only (no 5/5)", kind: "histogram", color: "#ff8c00" },
    { key: "cc5", label: "L 5/5 (confirmed: close>close)", kind: "histogram", color: "#32cd32" },
    { key: "ch5", label: "L 5/5 (confirmed: close>high)", kind: "histogram", color: "#32cd32" },
    { key: "cc4", label: "L 4/5 (confirmed: close>close)", kind: "histogram", color: "#ff8c00" },
    { key: "ch4", label: "L 4/5 (confirmed: close>high)", kind: "histogram", color: "#ff8c00" },
    { key: "triggerLow", label: "stop: low of the pulse (trigger) bar", kind: "line", color: "#888888" },
  ],
  calc(bars, p, ta) {
    const o = ta.source(bars, "open");
    const c = ta.source(bars, "close");
    const h = ta.source(bars, "high");
    const l = ta.source(bars, "low");
    const v = ta.source(bars, "volume");
    const N = bars.length;
    const L = p.pivotLen;
    const WICK = p.minWickPct;

    const a5 = new Array(N).fill(null), a4 = new Array(N).fill(null);
    const a5x = new Array(N).fill(null), a4x = new Array(N).fill(null);

    // ---- 1) EARLY (in-bar): low <= lowest(low, L+1) and checks pass ----
    const lowestL1 = ta.lowest(l, L + 1); // array length N, NaN before index L
    const showEarly = p.mode !== "Exact (confirmed pivot)";
    for (let i = L + 1; i < N; i++) {
      if (!showEarly) break;
      // candidate: this bar's low is the lowest of the last (L+1) bars
      if (!(l[i] <= lowestL1[i])) continue;
      // check 1: green close
      const c1 = c[i] >= o[i];
      // check 2: lower wick >= WICK * range
      const range = h[i] - l[i];
      const cw = range > 0 ? (Math.min(o[i], c[i]) - l[i]) / range >= WICK : false;
      // check 3: reclaim prior high
      const c3 = h[i] >= h[i - 1];
      // check 4: volume expansion
      const c4 = v[i] > v[i - 1];
      // check 5: net-red prior 2 bars (proxy delta = sign(close-open)*volume)
      const d1 = Math.sign(c[i - 1] - o[i - 1]) * v[i - 1];
      const d2 = Math.sign(c[i - 2] - o[i - 2]) * v[i - 2];
      const c5 = d1 + d2 < 0;
      const k = (c1 ? 1 : 0) + (cw ? 1 : 0) + (c3 ? 1 : 0) + (c4 ? 1 : 0) + (c5 ? 1 : 0);
      if (k === 5) a5[i] = 1;
      else if (k === 4) a4[i] = 1;
    }

    // ---- 2) EXACT (confirmed pivot): ta.pivotlow(l, L, L) ----
    // A pivot at bar i is confirmed once we are L bars past it (i+L); it requires
    // l[i] <= l[j] for j in [i-L..i+L]. We scan i from L to N-1-L and, if confirmed,
    // set the marker arrays at the *pivot bar i* (mirrors Pine's offset=-pivotLen).
    const showExact = p.mode !== "Early (candidate)";
    for (let i = L; i <= N - 1 - L; i++) {
      let isPivot = true;
      for (let j = i - L; j <= i + L; j++) {
        if (l[i] > l[j]) { isPivot = false; break; }
      }
      if (!isPivot) continue;
      // pivot at bar i; Pine's EXACT uses the pivot's own OHLCV (i.e. bars[i]) and
      // prior bars relative to the pivot (i-1, i-2), NOT relative to the confirm bar.
      const pO = o[i], pC = c[i], pH = h[i], pL = l[i], pV = v[i];
      const c1 = pC >= pO;
      const rng = pH - pL;
      const cw = rng > 0 ? (Math.min(pO, pC) - pL) / rng >= WICK : false;
      const c3 = pH >= h[i - 1];
      const c4 = pV > v[i - 1];
      const d1 = Math.sign(c[i - 1] - o[i - 1]) * v[i - 1];
      const d2 = Math.sign(c[i - 2] - o[i - 2]) * v[i - 2];
      const c5 = d1 + d2 < 0;
      const k = (c1 ? 1 : 0) + (cw ? 1 : 0) + (c3 ? 1 : 0) + (c4 ? 1 : 0) + (c5 ? 1 : 0);
      if (showExact && k === 5) a5x[i] = 1;
      else if (showExact && k === 4) a4x[i] = 1;
    }

    // ---- Markers below the low, matching Pine plotshape colors/shapes ----
    const markers = [];
    const put = (i, shape, color, text) =>
      markers.push({ time: bars[i].time, position: "belowBar", shape, color, text });
    for (let i = 0; i < N; i++) {
      if (a5[i]  === 1) put(i, "arrowUp", "#32cd32", "L 5/5");
      if (a4[i]  === 1) put(i, "circle",  "#ff8c00", "L 4/5");
      if (a5x[i] === 1) put(i, "arrowUp", "#32cd32", "L 5/5 (X)");
      if (a4x[i] === 1) put(i, "circle",  "#ff8c00", "L 4/5 (X)");
    }

    // ---- 3) ONLY-4 (exactly 4 of 5 — 5/5 bars excluded). Used by strategy grid
    // cells that want "4/5 but not 5/5" without relying on a tier-exclusivity
    // flag in the backtester. NaN where a5 or a4 don't apply. ----
    const only4 = a4.map((x, i) => (x === 1 && a5[i] !== 1 ? 1 : x)); // x===1 means early4; a5[i]!==1 excludes 5/5

    // ---- 4) Confirmation outputs (T is the pulse bar; these fire at T+1) ----
    // Pine semantics keep `early4` inclusive (k===4 fires for k in {4,5}); so cc4/ch4 are
    // anchored to "any of early5 OR early4" as well — same parity as cc5/ch5. If 5/5 also
    // confirmed, both cc5 and cc4 fire (the caller can prefer cc5 in the grid).
    const cc5 = new Array(N).fill(NaN), ch5 = new Array(N).fill(NaN);
    const cc4 = new Array(N).fill(NaN), ch4 = new Array(N).fill(NaN);
    for (let i = 1; i < N; i++) {
      const T = i - 1;
      const fired5 = a5[T] === 1;
      const firedAny = fired5 || a4[T] === 1;
      if (fired5 && c[i] > c[T]) cc5[i] = 1;
      if (fired5 && c[i] > h[T]) ch5[i] = 1;
      if (firedAny && c[i] > c[T]) cc4[i] = 1;
      if (firedAny && c[i] > h[T]) ch4[i] = 1;
    }

    // ---- 5) triggerLow — single canonical stop series for the strategy's anchor stop ----
    //   triggerLow[i] = low[i] at every pulse bar (5/5 OR 4/5 OR only4). NaN elsewhere.
    //   Strategy's stopLoss spec then picks the right one with the engine's refBar:
    //     pulse rows → { indicator:'washout-long', output:'triggerLow', refBar:'signal' }
    //                    fires AT the pulse bar (T)      → reads triggerLow[T] = low[T] ✓
    //     cc/ch rows → { indicator:'washout-long', output:'triggerLow', refBar:'prior'  }
    //                    fires AT the confirm bar (T+1)  → reads triggerLow[T] = low[T] ✓
    //   In both cases the stop is "the low of the pulse (trigger) bar" — the user's stated
    //   definition. The RR target is computed from this stop distance in backtest.openPos.
    const triggerLow = new Array(N).fill(NaN);
    for (let i = 0; i < N; i++) {
      if (a5[i] === 1 || a4[i] === 1) triggerLow[i] = l[i];
    }

    return {
      early5: a5, early4: a4, exact5: a5x, exact4: a4x,
      only4, cc5, ch5, cc4, ch4, triggerLow,
      markers,
    };
  },
};
