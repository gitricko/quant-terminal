// Port of pine: h1_washout_low_5of5_4of5 (Pine v6) — "H1 Washout Low 5/5 + 4/5 (Early + Exact)"
// Reference backtest: data/tmp/README.md (H1 washout low from spy_2026-10-15.md §5b).
//
// A bar is an "H1 washout low" when:
//   EARLY  mode: low <= lowest(low, pivotLen+1)  [candidate, fires in-bar]
//   EXACT  mode: ta.pivotlow(low, pivotLen, pivotLen) confirmed  [fires pivotLen bars late]
// and 4 or 5 of the 5 checks pass:
//   1. green close (close >= open)
//   2. long lower wick: min(open, close) - low  >= minWickPct * (high - low)
//   3. reclaim: high >= high[-1]
//   4. volume expansion: volume > volume[-1]
//   5. net-red prior 2 bars: sign(c-o)*v  [at -1 and -2]  sums < 0
//
// Outputs (0/1 per bar, for alerts; see docs/custom-indicators.md §Alerts):
//   early5, early4  — early (candidate, left-only)
//   exact5, exact4  — exact (ta.pivotlow, delayed by pivotLen)
//   (Pine's "5of5/4of5" names can't be output keys here — must start with a letter.)
//
// Markers on the price chart (below the low), matching Pine plotshape:
//   triangle-up (lime)     = 5/5
//   circle     (orange)    = 4/5
//   exact-mode markers carry " (E)" in their text (Pine: offset=-pivotLen puts it
//   on the pivot bar; we do the same by firing on the confirmed bar with the
//   " (E)" text).

export default {
  name: "H1 Washout Low 5/5 + 4/5 (Early + Exact)",
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
    { key: "early5", label: "H1 5/5 (early)", kind: "histogram", color: "#32cd32" },
    { key: "early4", label: "H1 4/5 (early)", kind: "histogram", color: "#ff8c00" },
    { key: "exact5", label: "H1 5/5 (exact)", kind: "histogram", color: "#32cd32" },
    { key: "exact4", label: "H1 4/5 (exact)", kind: "histogram", color: "#ff8c00" },
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
      if (a5[i]  === 1) put(i, "arrowUp", "#32cd32", "H1 5/5");
      if (a4[i]  === 1) put(i, "circle",  "#ff8c00", "H1 4/5");
      if (a5x[i] === 1) put(i, "arrowUp", "#32cd32", "H1 5/5 (E)");
      if (a4x[i] === 1) put(i, "circle",  "#ff8c00", "H1 4/5 (E)");
    }

    return { early5: a5, early4: a4, exact5: a5x, exact4: a4x, markers };
  },
};
