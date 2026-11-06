// Washout Short — the vertical mirror of custom/washout-low.js.
//
// Washout Low buys the dip: a fresh low that got *rejected* (long lower wick)
// right after sellers (net-red prior 2 bars). The exact reverse is to SHORT the
// rip — sell a fresh high that got rejected (long upper wick) right after buyers
// (net-green prior 2 bars). Same 5-check framework, every check mirrored around
// the vertical midpoint (low<->high, green<->red, lower-wick<->upper-wick,
// sellers<->buyers). Volume expansion is symmetric so it is unchanged.
//
// A bar is a "washout short" when:
//   EARLY  mode: high >= highest(high, pivotLen+1) [candidate, fires in-bar]
//   EXACT  mode: pivot high confirmed (h[i] >= h[j] for j in [i-L..i+L]) [late]
// and 4 or 5 of the 5 mirrored checks pass:
//   1. red close (close <= open)
//   2. long upper wick: high - max(open, close) >= minWickPct * (high - low)
//   3. fail to hold prior low: low <= low[-1]
//   4. volume expansion: volume > volume[-1]
//   5. net-green prior 2 bars: sign(c-o)*v [at -1 and -2] sums > 0
//
// Outputs (for alerts; see docs/custom-indicators.md §Alerts):
//   early5, early4  — early (candidate, left-only)
//   exact5, exact4  — exact (pivot confirmed, delayed)
//
// Markers on the price chart (above the high), the mirror of Washout Low:
//   arrow-down (red #ff3b3b) = 5/5
//   circle     (orange)      = 4/5
//   exact-mode markers carry " (X)" in their text.

export default {
  name: "Washout Short",
  overlay: true, // price chart — markers only for the user
  // chart.js:647 — opt every output series out of the pane's autoscale: the
  // alert-facing arrays still hold 0/1 per bar (alerts read res via indResults),
  // but their 0-baseline doesn't compress the price range when you zoom in.
  noAutoscale: true,
  inputs: [
    { key: "pivotLen", label: "pivotLen", type: "int", default: 4, min: 1 },
    { key: "minWickPct", label: "Min upper-wick % of range", type: "float", default: 0.40, min: 0, max: 1 },
    { key: "mode", label: "Signal mode", type: "select", default: "Both",
      options: ["Early (candidate)", "Exact (confirmed pivot)", "Both"] },
  ],
  // Note: output keys must start with a letter (docs/custom-indicators.md), so the
  // Pine names 5of5/4of5 become early5/early4/exact5/exact4. The labels keep "5/5".
  // These arrays are for ALERTS. On the chart they render as zero-height bars
  // (invisible) because noAutoscale is set above, so the price scale keeps its
  // full range.
  outputs: [
    { key: "early5", label: "5/5 S (early)", kind: "histogram", color: "#ff3b3b" },
    { key: "early4", label: "4/5 S (early)", kind: "histogram", color: "#ff8c00" },
    { key: "exact5", label: "5/5 S (exact)", kind: "histogram", color: "#ff3b3b" },
    { key: "exact4", label: "4/5 S (exact)", kind: "histogram", color: "#ff8c00" },
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

    // ---- 1) EARLY (in-bar): high >= highest(high, L+1) and mirrored checks pass ----
    const highestL1 = ta.highest(h, L + 1); // array length N, NaN before index L
    const showEarly = p.mode !== "Exact (confirmed pivot)";
    for (let i = L + 1; i < N; i++) {
      if (!showEarly) break;
      // candidate: this bar's high is the highest of the last (L+1) bars
      if (!(h[i] >= highestL1[i])) continue;
      // check 1: red close
      const c1 = c[i] <= o[i];
      // check 2: upper wick >= WICK * range
      const range = h[i] - l[i];
      const cw = range > 0 ? (h[i] - Math.max(o[i], c[i])) / range >= WICK : false;
      // check 3: fail to hold prior low
      const c3 = l[i] <= l[i - 1];
      // check 4: volume expansion
      const c4 = v[i] > v[i - 1];
      // check 5: net-green prior 2 bars (proxy delta = sign(close-open)*volume)
      const d1 = Math.sign(c[i - 1] - o[i - 1]) * v[i - 1];
      const d2 = Math.sign(c[i - 2] - o[i - 2]) * v[i - 2];
      const c5 = d1 + d2 > 0;
      const k = (c1 ? 1 : 0) + (cw ? 1 : 0) + (c3 ? 1 : 0) + (c4 ? 1 : 0) + (c5 ? 1 : 0);
      if (k === 5) a5[i] = 1;
      else if (k === 4) a4[i] = 1;
    }

    // ---- 2) EXACT (confirmed pivot high): h[i] >= h[j] for j in [i-L..i+L] ----
    // Mirrors Washout Low's inline pivotlow: a pivot at bar i is confirmed once
    // we know L bars after it. We scan i from L to N-1-L and, if confirmed, set
    // the arrays at the *pivot bar i* itself (Pine's offset).
    const showExact = p.mode !== "Early (candidate)";
    for (let i = L; i <= N - 1 - L; i++) {
      let isPivot = true;
      for (let j = i - L; j <= i + L; j++) {
        if (h[i] < h[j]) { isPivot = false; break; }
      }
      if (!isPivot) continue;
      // pivot at bar i; EXACT uses the pivot's own OHLCV and prior bars relative
      // to the pivot (i-1, i-2), NOT relative to the confirm bar.
      const pO = o[i], pC = c[i], pH = h[i], pL = l[i], pV = v[i];
      const c1 = pC <= pO;
      const rng = pH - pL;
      const cw = rng > 0 ? (pH - Math.max(pO, pC)) / rng >= WICK : false;
      const c3 = pL <= l[i - 1];
      const c4 = pV > v[i - 1];
      const d1 = Math.sign(c[i - 1] - o[i - 1]) * v[i - 1];
      const d2 = Math.sign(c[i - 2] - o[i - 2]) * v[i - 2];
      const c5 = d1 + d2 > 0;
      const k = (c1 ? 1 : 0) + (cw ? 1 : 0) + (c3 ? 1 : 0) + (c4 ? 1 : 0) + (c5 ? 1 : 0);
      if (showExact && k === 5) a5x[i] = 1;
      else if (showExact && k === 4) a4x[i] = 1;
    }

    // ---- Markers above the high, the mirror of Washout Low's belowBar markers ----
    const markers = [];
    const put = (i, shape, color, text) =>
      markers.push({ time: bars[i].time, position: "aboveBar", shape, color, text });
    for (let i = 0; i < N; i++) {
      if (a5[i]  === 1) put(i, "arrowDown", "#ff3b3b", "S 5/5");
      if (a4[i]  === 1) put(i, "circle",    "#ff8c00", "S 4/5");
      if (a5x[i] === 1) put(i, "arrowDown", "#ff3b3b", "S 5/5 (X)");
      if (a4x[i] === 1) put(i, "circle",    "#ff8c00", "S 4/5 (X)");
    }

    return { early5: a5, early4: a4, exact5: a5x, exact4: a4x, markers };
  },
};
