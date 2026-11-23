// IVB 5-Minute Entry/Exit Model — JS-native port for this repo's custom-indicator
// framework. Spec: data/ivb-5min-entry-model/rules.md (the captain's annotated
// SQQQ long charts + two rounds of verbal clarification, 2026-11-20). The Pine
// version of this model lives in the other library; this file is the
// Quant-Terminal re-implementation, checked offline by test/ivb-5min.test.js.
//
// The model, in one paragraph: long only, one symbol, flat by the session close.
// The trigger level is the first 30-minute Opening Range (09:30–10:00 ET by
// default). A break bar closes above OR_high for the first time that session;
// the very next bar is the confirmation and the setup is live only if it closes
// above the break bar's whole high (wick included). Entry is the confirmation
// bar's close, R is the confirmation bar's full range, stop = entry − R,
// target = entry + R (1:1). A failed confirmation re-arms on the next fresh
// break; once a trade has been entered AND exited the symbol is done for the
// day and the rest of the session is greyed out.
//
// This is a *signal-marking* indicator first: it does not place trades, it draws
// the state machine so the captain can audit it against the annotated charts
// before any performance number is trusted (spec §11: indicator first).
//
// Everything about the session is keyed off the America/New_York calendar date
// and the ET wall clock — see etDay/etMinute below. Never the UTC date and
// never a bar offset: 09:30 ET is 13:30Z under EDT and 14:30Z under EST, so a
// UTC clock takes the wrong six bars on half the sessions (the SPY 5m fixture
// crosses the November DST change, and 2026-11-05 is a 59-bar early close).

// The settings box renders int/float inputs as number fields and select inputs
// as dropdowns (public/js/app.js openIndicatorSettings), and the indicator
// format refuses any other input type (public/lib/indicators.js INPUT_TYPES).
// The window boundaries are times of day, so each one is a dropdown of ET
// wall-clock marks at 5-minute steps — a number input would invite someone to
// type "630" for 10:30.
const OR_MARKS = Array.from({ length: 37 }, (_, k) => {
  const m = 9 * 60 + k * 5; // 09:00 … 12:00 ET
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const mmOf = (mark) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(mark));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// The etMinute/etDay pair is the same Intl.DateTimeFormat pattern
// public/lib/backtest.js uses for its time rules (timeRuleValue, ~line 52:
// formatToParts against a fixed timeZone, hourCycle h23 so 00:30 reads as 0).
// Two formatters on purpose: one for the session key (ET calendar date), one
// for the wall clock inside the day.
const ET_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ET_CLOCK_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const part = (p, t) => Number(p.find((x) => x.type === t)?.value ?? 0);
// Node 18's month/day parts come back unpadded ("8", not "08"), so zero-fill
// them here or the sessions on either side of September stop comparing equal
// and every session degenerates into a one-bar session. Padded or not, the
// key is still the ET calendar date — that part never changes.
const pad2 = (n) => String(n).padStart(2, "0");
const etDay = (timeSec) => {
  const p = ET_DAY_FMT.formatToParts(new Date(timeSec * 1000));
  return `${part(p, "year")}-${pad2(part(p, "month"))}-${pad2(part(p, "day"))}`;
};
const etMinute = (timeSec) => {
  const p = ET_CLOCK_FMT.formatToParts(new Date(timeSec * 1000));
  return part(p, "hour") * 60 + part(p, "minute");
};

// Marker palette (washout-long uses the same idea: one colour per event).
const C_OR = "#9e9e9e"; // the opening range itself — grey, context
const C_BREAK = "#ff9800"; // break bar — orange
const C_ENTRY = "#26a69a"; // valid confirmation (the entry) — green
const C_INVALID = "#f23645"; // failed confirmation — red
const C_FLAT = "#9e9e9e"; // flat after the trade — grey

export default {
  name: "IVB 5min (ORB break/confirm)",
  overlay: true, // price chart: OR levels, the risk box and the event markers
  // chart.js:637 — opt every output out of the price-pane autoscale. The alert
  // arrays (signal, done) are 0/1 per bar and the OR levels are pre-market
  // scale-free, so their baselines would otherwise drag the price y-axis and
  // compress the candles when you zoom in. Same reason washout-long sets it.
  noAutoscale: true,
  inputs: [
    { key: "orStart", label: "Opening range start (ET)", type: "select", default: "09:30", options: OR_MARKS },
    { key: "orEnd", label: "Opening range end (ET)", type: "select", default: "10:00", options: OR_MARKS },
    { key: "source", label: "Entry source", type: "source", default: "close" },
  ],
  // One array per output, exactly bars.length long, NaN where there is no
  // value (orHigh/orLow/entry/stop/target). signal and done are per-bar flags
  // instead: 0 is "this didn't happen on that bar", not "unknown", so the alert
  // editor's `> 0` form (docs/custom-indicators.md §Alerts) works unchanged.
  // Every named event also lands in `markers` with its text, which is where a
  // chart reader sees "Break" / "Entry" / "No conf" / "Flat TP" — the engine
  // requires output values to be numbers, so text cannot be an output.
  outputs: [
    { key: "orHigh", label: "OR high", kind: "line", color: C_OR },
    { key: "orLow", label: "OR low", kind: "line", color: C_OR },
    { key: "entry", label: "Entry", kind: "line", color: C_ENTRY },
    { key: "stop", label: "Stop (entry − R)", kind: "line", color: C_INVALID },
    { key: "target", label: "Target (entry + R)", kind: "line", color: "#2962ff" },
    { key: "signal", label: "Entry signal", kind: "histogram", color: C_ENTRY },
    { key: "done", label: "Done for the day", kind: "histogram", color: C_FLAT },
  ],
  calc(bars, p, ta) {
    const src = ta.source(bars, p.source);
    const N = bars.length;
    const orHigh = new Array(N).fill(NaN);
    const orLow = new Array(N).fill(NaN);
    const entry = new Array(N).fill(NaN);
    const stop = new Array(N).fill(NaN);
    const target = new Array(N).fill(NaN);
    const signal = new Array(N).fill(0);
    const done = new Array(N).fill(0);
    const markers = [];
    const put = (i, position, shape, color, text) =>
      markers.push({ time: bars[i].time, position, shape, color, text });

    const startMin = mmOf(p.orStart);
    const endMin = mmOf(p.orEnd);
    if (!N || !(endMin > startMin)) return { orHigh, orLow, entry, stop, target, signal, done, markers };

    // One pass over the bars for the session key and the wall-clock mark.
    // Cached in arrays because the per-session loops below ask for both again.
    const dayKey = new Array(N);
    const minute = new Array(N);
    for (let i = 0; i < N; i++) {
      dayKey[i] = etDay(bars[i].time);
      minute[i] = etMinute(bars[i].time);
    }

    // Bars are chronological, so a session is a run of equal ET dates.
    let i = 0;
    while (i < N) {
      const day = dayKey[i];
      let j = i;
      while (j < N && dayKey[j] === day) j++;
      // Session = bars [i, j). Bars outside the regular session simply never
      // happen here: the fixtures are RTH-only, and any bar that does show up
      // is bucketed by its own ET date like everything else.

      // ---- OR window: every bar of the session whose ET clock sits inside
      // [orStart, orEnd). Time-based, not "the first six bars", so a partial or
      // early-close session that starts late still forms its OR from the clock
      // (and a session that ends before orEnd forms no OR at all).
      let hi = -Infinity;
      let lo = Infinity;
      let winLast = -1;
      for (let k = i; k < j && minute[k] < endMin; k++) {
        if (minute[k] < startMin) continue; // pre-window bar (early session)
        hi = Math.max(hi, bars[k].high);
        lo = Math.min(lo, bars[k].low);
        winLast = k;
      }
      // `winLast + 1 < j` too: a truncated session that ends inside its own OR
      // window has no post-window bar to mark or trade, and `first = j` would
      // index past the bars (the session simply has no setup that day).
      if (winLast >= i && winLast + 1 < j) {
        // First bar at/after the window end — setups may only start here, and
        // the prior bar (the window's last close) is always <= OR_high, so the
        // very first bar of the post-window range can itself be a fresh break.
        const first = winLast + 1;
        // OR levels are drawn from the window's completion onward, not
        // back-filled over the window: at 09:30 the six-bar max is not knowable
        // yet, and the no-look-ahead rule (docs/custom-indicators.md) holds for
        // the audit trail as much as for a live signal.
        for (let k = first; k < j; k++) {
          orHigh[k] = hi;
          orLow[k] = lo;
        }
        put(first, "aboveBar", "circle", C_OR, "OR");

        // ---- Daily state machine: scanning → break → confirm → trade → done.
        let state = "scan"; // 'scan' | 'confirm' | 'trade' | 'done'
        let B = -1; // the break bar the pending confirmation belongs to
        for (let k = first; k < j; k++) {
          if (state === "done") {
            done[k] = 1; // greyed out: no re-entry after a completed trade
            continue;
          }
          if (state === "scan") {
            // §3: a fresh cross, judged on the close. A bar whose wick pierces
            // OR_high but whose close falls back is not a break.
            if (src[k] > hi && src[k - 1] <= hi) {
              B = k;
              state = "confirm";
              put(k, "belowBar", "arrowUp", C_BREAK, "Break");
            }
            continue;
          }
          // state === 'confirm': this bar IS the confirmation bar C = B + 1.
          // §4: valid only if it closes above the break bar's whole high.
          if (src[k] > bars[B].high) {
            const e = src[k]; // §5 entry = the confirmation bar's close
            const R = bars[k].high - bars[k].low; // §6 risk = the entry bar's full range
            const st = e - R;
            const tg = e + R;
            signal[k] = 1;
            put(k, "belowBar", "arrowUp", C_ENTRY, "Entry");
            // §8: resolve the plain 1:1 exit forward through the session — the
            // stop is checked first inside a bar, so a bar that spans both
            // levels books the loss (§10.4 pessimistic fill).
            let exit = -1;
            let how = "";
            for (let m = k + 1; m < j; m++) {
              if (bars[m].low <= st) {
                exit = m;
                how = "Flat SL";
                break;
              }
              if (bars[m].high >= tg) {
                exit = m;
                how = "Flat TP";
                break;
              }
            }
            const last = exit >= 0 ? exit : j - 1; // unresolved → held to the close (§8.3)
            for (let m = k; m <= last; m++) {
              entry[m] = e;
              stop[m] = st;
              target[m] = tg;
            }
            if (exit >= 0) put(exit, "aboveBar", "square", C_FLAT, how);
            else if (j - 1 > k) put(j - 1, "aboveBar", "square", C_FLAT, "Flat (close)");
            // §7: entered and exited (or the session closed it out) — done for
            // the day, so jump past the trade and grey out what is left.
            state = "done";
            for (let m = last + 1; m < j; m++) done[m] = 1;
            k = last;
            continue;
          }
          // Failed confirmation: no trade, so the symbol stays eligible.
          // This bar cannot itself be a fresh break (the break bar it failed to
          // confirm closed above OR_high), so the re-arm resumes at the next
          // bar — handled by the 'scan' branch on the next iteration.
          put(k, "aboveBar", "circle", C_INVALID, "No conf");
          state = "scan";
        }
      }
      i = j;
    }

    return { orHigh, orLow, entry, stop, target, signal, done, markers };
  },
};