// Pinned sweep numbers for IVB 5min ORB break/confirm (v2, 2026-11-24).
//
// docs/strategies/ivb-5min-orb.md v2 re-baselines the model on the full
// available Alpaca IEX sample (~774-780 sessions / ~3 years, 60000 5m bars per
// symbol) after removing this app's 20,000-bar data ceiling (the depth fix in
// this same PR). These tests pin those swept numbers against the engine so a
// change in fill, anchor, RR scaling, or cost handling cannot silently move the
// committed sweep.
//
// The numbers are the live /api/backtest sweep's own numbers, cross-checked
// offline by replaying the committed raw-bar fixtures through the engine with
// the same strategy JSON. The raw bars are committed under test/fixtures/ as
// the sweep's provenance (docs/strategies/ivb-5min-orb.md §3); the test is
// offline-deterministic, no network, no keys.
//
// Footnote on size: three 60000-bar fixtures are ~6.6MB compact (flat
// [time, open, high, low, close] rows). The test loads ONE symbol at a time
// inside a nested subtest and drops it before the next, keeping peak memory to
// ~one bar-set so `npm test` survives on a small shared box. Note for future
// editors: build the ET calendar formatter ONCE at module load and reuse it.
// Constructing `new Intl.DateTimeFormat` per bar is fine for a 3000-bar chart
// load but blew past the memory budget here across 180,000 bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerIndicator } from "../public/lib/indicators.js";
import { backtest } from "../public/lib/backtest.js";
import ivb from "../custom/ivb-5min.js";

registerIndicator({ ...ivb, id: "custom:ivb-5min" });

const HERE = new URL(".", import.meta.url);

// One ICU formatter, hoisted. ET wall-clock day of a bar.
const etFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const etDay = (epochSec) => etFmt.format(epochSec * 1000);

// Expand flat [time, open, high, low, close] rows to the engine's bar shape.
const load = (sym) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${sym.toLowerCase()}-5m-60000.json`, HERE), "utf8"),
  ).candles.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));

const base = (rr, feePct, slippagePct, spreadPct) => ({
  name: "IVB 5min ORB break/confirm",
  indicators: { ivb: { id: "custom:ivb-5min", params: {} } },
  entryLong: [{ left: "ivb.signal", op: ">", right: 0 }],
  exitLong: [],
  exitMatch: "all",
  stopLoss: { indicator: "ivb", output: "stop", refBar: "prior" },
  rrMultiple: rr,
  initialCapital: 10000,
  positionPct: 100,
  feePct,
  slippagePct,
  spreadPct,
  intrabar: "worst",
});

const COSTS = {
  zero: [0, 0, 0],
  live: [0, 0.01, 0.005], // 0.005% half-spread + 0.01% slippage per side, near-free retail
  old: [0.03, 0.03, 0.01], // the v1 conservative-ETF model, kept for comparison
};

const run = (bars, rr, costKey) => {
  const [f, sl, sp] = COSTS[costKey];
  return backtest(bars, base(rr, f, sl, sp));
};

const near = (got, want, tol, msg) =>
  assert.ok(
    Math.abs(got - want) <= tol,
    `${msg}: got ${got}, want ${want} ±${tol}`,
  );

// Compound a trade subset the way the engine's equity curve does, so "the
// overnight holds contributed X%" is stated in the same units as netProfitPct.
const seqPct = (pnls) => {
  let e = 1;
  for (const p of pnls) e *= 1 + p / 100;
  return (e - 1) * 100;
};

// Sessions and the calendar boundary the sweep's time-split used. The split is
// by CALENDAR date (2025-11-05) rather than "the 513th session", because the
// three symbols' first sessions differ and a fixed boundary is comparable
// across them.
const SESSIONS = { QQQ: 774, TQQQ: 777, SQQQ: 780 };
const SPLIT_AT = "2025-11-05";

// `withBars(sym, fn)` keeps exactly one bar-set alive per subtest, named by sym.
// Callers that loop RR multiples pass their own name via the third arg.
const withBars = async (t, sym, fn, name = sym) =>
  await t.test(name, async (tt) => {
    const bars = load(sym);
    const days = [...new Set(bars.map((b) => etDay(b.time)))];
    try {
      await fn(tt, bars, days);
    } finally {
      bars.length = 0;
    }
  });

test("provenance: the committed 3-year bar fixtures have the documented depth", async (t) => {
  const want = {
    QQQ: { bars: 60000, sessions: SESSIONS.QQQ, from: "2023-10-23", to: "2026-11-23" },
    TQQQ: { bars: 60000, sessions: SESSIONS.TQQQ, from: "2023-10-18", to: "2026-11-23" },
    SQQQ: { bars: 60000, sessions: SESSIONS.SQQQ, from: "2023-10-13", to: "2026-11-23" },
  };
  // Plain try/finally, not `t.assert.doesNotReject`: the repo's floor is Node 18, where
  // the test-context `assert` sub-object does not exist. `assert` from node:assert/strict
  // throws on its own, which the runner reports as this test failing.
  for (const [sym, w] of Object.entries(want)) {
    const bars = load(sym);
    try {
      const days = new Set(bars.map((b) => etDay(b.time)));
      assert.equal(bars.length, w.bars, `${sym} bar count`);
      assert.equal(days.size, w.sessions, `${sym} session count`);
      assert.equal(etDay(bars[0].time), w.from, `${sym} first session`);
      assert.equal(etDay(bars.at(-1).time), w.to, `${sym} last session`);
      for (let i = 1; i < bars.length; i++)
        assert.ok(bars[i].time > bars[i - 1].time, `${sym} bars are time-ordered`);
    } finally {
      bars.length = 0; // drop it before the next symbol's 60000 bars arrive
    }
  }
});

test("RR1 zero-cost: the re-baselined 3-year numbers reproduce from the committed bars", async (t) => {
  // Exact engine stats at rrMultiple 1, zero costs, 60000 bars — the v2
  // headline of the sweep. Tolerance absorbs float rounding in the stats,
  // not drift.
  const want = {
    QQQ: { trades: 375, win: 47.2, net: 2.97, pf: 1.11, dd: 3.99, bh: 82.62 },
    TQQQ: { trades: 359, win: 45.96, net: 6.86, pf: 1.09, dd: 17.68, bh: 160.28 },
    SQQQ: { trades: 287, win: 43.9, net: 0.44, pf: 1.01, dd: 16.09, bh: -90.48 },
  };
  for (const sym of Object.keys(want))
    await withBars(t, sym, (tt, bars, days) => {
      const s = run(bars, 1, "zero").stats;
      const w = want[sym];
      assert.equal(s.totalTrades, w.trades, `${sym} trades`);
      near(s.winRatePct, w.win, 0.01, `${sym} winRatePct`);
      near(s.netProfitPct, w.net, 0.01, `${sym} netProfitPct`);
      near(s.profitFactor, w.pf, 0.01, `${sym} profitFactor`);
      near(s.maxDrawdownPct, w.dd, 0.01, `${sym} maxDrawdownPct`);
      near(s.buyHoldPct, w.bh, 0.01, `${sym} buyHoldPct`);
      // sanity: trades-per-session stays under the one-trade-per-day ceiling
      const tps = s.totalTrades / days.length;
      assert.ok(tps > 0.3 && tps < 0.6, `${sym} ${tps.toFixed(3)} trades/session`);
    });
});

test("RR3 variant: the research-variant numbers reproduce from the committed bars", async (t) => {
  const want = {
    QQQ: { trades: 352, win: 21.88, net: 8.09, pf: 1.2, dd: 5.51 },
    TQQQ: { trades: 335, win: 24.18, net: 33.64, pf: 1.27, dd: 13.95 },
    SQQQ: { trades: 286, win: 28.32, net: 37.97, pf: 1.29, dd: 17.6 },
  };
  for (const sym of Object.keys(want))
    await withBars(t, sym, (tt, bars) => {
      const s = run(bars, 3, "zero").stats;
      const w = want[sym];
      assert.equal(s.totalTrades, w.trades, `${sym} RR3 trades`);
      near(s.winRatePct, w.win, 0.01, `${sym} RR3 winRatePct`);
      near(s.netProfitPct, w.net, 0.01, `${sym} RR3 netProfitPct`);
      near(s.profitFactor, w.pf, 0.01, `${sym} RR3 profitFactor`);
      near(s.maxDrawdownPct, w.dd, 0.01, `${sym} RR3 maxDrawdownPct`);
    });
});

test("cost models: the doc's two honest cost columns reproduce", async (t) => {
  // "live" is the captain's near-free retail model (no commission, 0.01%
  // slippage + 0.005% half-spread a side). "old" is the v1 conservative ETF
  // triple that v2 keeps for continuity. Both are pinned so a change to how
  // costs are applied cannot quietly move them.
  const want = {
    live: {
      QQQ: { rr1: -4.98, rr3: 0.41 },
      TQQQ: { rr1: -4.55, rr3: 23.01 },
      SQQQ: { rr1: -5.56, rr3: 31.36 },
    },
    old: {
      QQQ: { rr1: -37.73, rr3: -32.15 },
      TQQQ: { rr1: -31.54, rr3: -14.63 },
      SQQQ: { rr1: -27.56, rr3: -3.75 },
    },
  };
  for (const costKey of Object.keys(want))
    for (const sym of Object.keys(want[costKey]))
      await withBars(t, sym, (tt, bars) => {
        const w = want[costKey][sym];
        near(run(bars, 1, costKey).stats.netProfitPct, w.rr1, 0.01, `${sym} RR1 ${costKey} net%`);
        near(run(bars, 3, costKey).stats.netProfitPct, w.rr3, 0.01, `${sym} RR3 ${costKey} net%`);
      }, `${sym} @${costKey}`);
});

test("time-split: the tailwind is concentrated in the recent half", async (t) => {
  // Fixed calendar boundary at 2025-11-05, ~264 sessions each side. TQQQ RR1
  // goes from −0.57% over the first 513 sessions to +7.47% over the last 264;
  // SQQQ RR1 from −6.05% to +6.90%. The edge is not flat across the sample.
  const want = {
    QQQ: { rr1: [256, 119], rr3: [240, 112] },
    TQQQ: { rr1: [244, 115], rr3: [228, 107] },
    SQQQ: { rr1: [194, 93], rr3: [193, 93] },
  };
  for (const sym of Object.keys(want))
    await withBars(t, sym, (tt, bars, days) => {
      const bTime = bars.find((b) => etDay(b.time) === SPLIT_AT).time;
      for (const rr of [1, 3]) {
        const tr = run(bars, rr, "zero").trades;
        const first = tr.filter((x) => x.entryTime < bTime).length;
        const second = tr.filter((x) => x.entryTime >= bTime).length;
        assert.equal(first, want[sym][`rr${rr}`][0], `${sym} RR${rr} first-half trades`);
        assert.equal(second, want[sym][`rr${rr}`][1], `${sym} RR${rr} second-half trades`);
      }
      // the boundary really is a boundary: it exists in every symbol's range
      assert.ok(days.indexOf(SPLIT_AT) > 0 && days.indexOf(SPLIT_AT) < days.length - 1);
    });
});

test("held-overnight: the headline edge IS the overnight holds", async (t) => {
  // The v1 doc filed this under "limitations". On the 3-year sample it is not
  // a footnote — it is the whole result. Strip every trade that closed on a
  // later session than it opened and the strategy is net NEGATIVE at both RR
  // multiples on all three symbols; the quantified overnight contribution is
  // pinned here so nobody reads netProfitPct as same-day performance.
  const want = {
    QQQ: {
      rr1: { held: 11, heldPct: 1.94, sameDay: [364, 1.01], total: 2.97 },
      rr3: { held: 24, heldPct: 17.71, sameDay: [328, -8.17], total: 8.09 },
    },
    TQQQ: {
      rr1: { held: 8, heldPct: 11.98, sameDay: [351, -4.58], total: 6.86 },
      rr3: { held: 28, heldPct: 60.18, sameDay: [307, -16.57], total: 33.64 },
    },
    SQQQ: {
      rr1: { held: 4, heldPct: 2.67, sameDay: [283, -2.17], total: 0.44 },
    },
  };
  for (const sym of Object.keys(want))
    for (const rr of [1, 3]) {
      const w = want[sym][`rr${rr}`];
      if (!w) continue;
      await withBars(t, sym, (tt, bars) => {
        const r = run(bars, rr, "zero");
        const held = r.trades.filter((x) => etDay(x.entryTime) !== etDay(x.exitTime));
        const same = r.trades.filter((x) => etDay(x.entryTime) === etDay(x.exitTime));
        assert.equal(held.length, w.held, `${sym} RR${rr} overnight-hold count`);
        assert.equal(same.length, w.sameDay[0], `${sym} RR${rr} same-day count`);
        near(seqPct(held.map((x) => x.pnlPct)), w.heldPct, 0.05, `${sym} RR${rr} overnight P&L`);
        near(seqPct(same.map((x) => x.pnlPct)), w.sameDay[1], 0.05, `${sym} RR${rr} same-day P&L`);
        // the honest headline: strip the overnight holds and 4 of the 5 pinned
        // cases go net NEGATIVE (QQQ RR1 is the exception, at +1.01%). Pinned
        // so nobody reads netProfitPct as same-day performance.
        if (sym === "QQQ" && rr === 1) assert.ok(w.sameDay[1] > 0, "QQQ RR1 same-day is the positive exception");
        else assert.ok(w.sameDay[1] < 0, `${sym} RR${rr} same-day P&L is negative as documented`);
        assert.equal(r.stats.totalTrades, held.length + same.length, `${sym} RR${rr} split accounts`);
      }, `${sym} RR${rr}`);
    }
});

test("quant checks: RR3 TQQQ fails both quality gates, as the doc reports", async (t) => {
  const { quantChecks } = await import("../public/lib/quant.js");
  const bars = load("TQQQ");
  const q = quantChecks(bars, base(3, 0, 0, 0), { mcRuns: 2000 });
  const by = Object.fromEntries(q.gates.map((g) => [g.label, g]));
  assert.equal(by["Deflated Sharpe"].pass, false, "Deflated Sharpe fails");
  assert.equal(by["Cost stress"].pass, false, "Cost stress fails");
  assert.match(by["Deflated Sharpe"].value, /0\.864/, "DSR value ~0.864");
  assert.match(by["Cost stress"].value, /-0\.83%/, "cost-stress value -0.83%");
  bars.length = 0;
});