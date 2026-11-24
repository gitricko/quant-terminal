#!/usr/bin/env node
// Re-baseline results/ivb-or-break-backtest.csv on the 3-year, 60000-bar sweep.
//
// This is the provenance script for the IVB 5min ORB break/confirm sweep documented in
// docs/strategies/ivb-5min-orb.md (§3 data provenance, §4 results). It regenerates every
// number in that CSV from the COMMITTED raw Alpaca IEX bars in test/fixtures/, offline, with
// no keys and no network, so the committed CSV is reproducible from what the repo ships.
//
//   node scripts/sweep-ivb-3year.js            # write results/ivb-or-break-backtest.csv
//   node scripts/sweep-ivb-3year.js --check    # regenerate to memory, diff against the
//                                              # committed CSV, exit 1 on any difference
//
// The cycle that produced the CSV: the live /api/backtest sweep (limit 60000) ran first and
// its numbers were written out by this script from its own engine replay; a second run with
// --check is the reproducibility proof, and test/ivb-sweep-pinned.test.js pins the same
// headline numbers against the engine so a later change in fill/anchor/RR/cost handling turns
// the test red instead of silently moving the sweep.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerIndicator } from "../public/lib/indicators.js";
import { backtest } from "../public/lib/backtest.js";
import ivb from "../custom/ivb-5min.js";

registerIndicator({ ...ivb, id: "custom:ivb-5min" });

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = join(ROOT, "test", "fixtures");
const OUT = join(ROOT, "results", "ivb-or-break-backtest.csv");
const CHECK = process.argv.includes("--check");

const etFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const etDay = (t) => etFmt.format(t * 1000);
const etYear = (t) => etDay(t).slice(0, 4);
const etQuarter = (t) =>
  `${etYear(t)}Q${Math.floor((Number(etDay(t).slice(5, 7)) - 1) / 3) + 1}`;

// The three cost models, exactly as the sweep ran them (see docs §2 for the JSON).
const COSTS = {
  zero: { feePct: 0, slippagePct: 0, spreadPct: 0 },
  // the captain's near-free retail execution: limit entry at the confirm close (~0 cost),
  // 0.01% slippage + 0.005% half-spread a side, no commission
  live: { feePct: 0, slippagePct: 0.01, spreadPct: 0.005 },
  // the v1 conservative-ETF model, kept for continuity with the 1-year sweep
  old: { feePct: 0.03, slippagePct: 0.03, spreadPct: 0.01 },
};
const strategy = (rr, ck) => ({
  name: `IVB 5min ORB break/confirm RR${rr} ${ck}`,
  indicators: { ivb: { id: "custom:ivb-5min", params: {} } },
  entryLong: [{ left: "ivb.signal", op: ">", right: 0 }],
  exitLong: [],
  exitMatch: "all",
  stopLoss: { indicator: "ivb", output: "stop", refBar: "prior" },
  rrMultiple: rr,
  initialCapital: 10000,
  positionPct: 100,
  ...COSTS[ck],
  intrabar: "worst",
});

// Compound a set of per-trade pct returns the way the equity curve does, so the
// stop-slippage rows are stated in the same units as netProfitPct (positionPct 100,
// compounding). Accepts trade objects OR bare numbers.
const seqPct = (xs) => {
  let e = 1;
  for (const x of xs) e *= 1 + (typeof x === "number" ? x : (x.pnlPct ?? 0)) / 100;
  return (e - 1) * 100;
};
// The sweep's PF definition (sum of pnlPct wins over sum of pnlPct losses), used for the
// hand-adjusted rows so they stay comparable to the sweep's own figures. The engine's
// `stats()` uses gross win dollars over gross loss dollars on a compounding path — a
// different definition, not a different answer; the headline CSV rows use the engine's.
const pfOf = (pnls) => {
  const w = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const l = Math.abs(pnls.filter((p) => p <= 0).reduce((a, b) => a + b, 0));
  return l > 0 ? w / l : 0;
};

const SYMS = ["QQQ", "TQQQ", "SQQQ"];
// Fixed calendar boundary (not "the Nth session"): the three symbols' first sessions
// differ, and a fixed date is the comparable split across them. 2025-11-05 lands 513/264
// on QQQ's 774 sessions and 264 on the other side of every symbol.
const SPLIT_AT = "2025-11-05";

const rows = [];

for (const sym of SYMS) {
  const bars = JSON.parse(readFileSync(`${FIX}/${sym.toLowerCase()}-5m-60000.json`, "utf8")).candles
    .map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
  const byTime = new Map(bars.map((b) => [b.time, b]));
  const lastOfDay = new Map();
  for (const b of bars) lastOfDay.set(etDay(b.time), b.time);
  const days = [...new Set(bars.map((b) => etDay(b.time)))];
  const push = (o) => rows.push(o);

  const runs = {};
  for (const rr of [1, 1.5, 2, 3])
    for (const ck of Object.keys(COSTS)) runs[`rr${rr}@${ck}`] = backtest(bars, strategy(rr, ck));

  const r1 = runs["rr1@zero"];
  const st = r1.stats;
  const t1 = r1.trades;

  // ---- the model's time-stop boundary: trades still open at the session's last bar ----
  // The engine has no time stop, so a trade whose target/stop has not printed by the
  // close keeps running. `held` counts them, `heldRun` is what they actually did, and
  // `heldForced` is what the model's flat-by-16:00 rule would have booked at that close.
  const held = t1.filter((t) => t.exitTime > lastOfDay.get(etDay(t.entryTime)));
  let heldRun = 0,
    heldForced = 0;
  const { feePct: FEE, slippagePct: SLIPPCT, spreadPct: SPREAD } = COSTS.old;
  const fee = FEE / 100,
    slip = SLIPPCT / 100,
    half = SPREAD / 200;
  for (const t of held) {
    const close = byTime.get(lastOfDay.get(etDay(t.entryTime))).close;
    const cost = t.qty * t.entryPrice * (1 + fee);
    heldForced += t.qty * close * (1 - half) * (1 - slip) * (1 - fee) - cost;
    heldRun += t.pnl;
  }
  // late fills: the fill bar IS the session's last bar, so the model would not take them
  const lateFill = t1.filter((t) => t.entryTime >= lastOfDay.get(etDay(t.entryTime)));
  // overnight holds: the v2 finding that the edge IS the holds
  const overnight = t1.filter((t) => etDay(t.entryTime) !== etDay(t.exitTime));

  push({
    symbol: sym,
    period: "ALL",
    rr: 1,
    cost: "zero",
    sessions: days.length,
    from: etDay(bars[0].time),
    to: etDay(bars.at(-1).time),
    bars: bars.length,
    trades: st.totalTrades,
    tps: +(st.totalTrades / days.length).toFixed(3),
    win: st.winRatePct,
    net: st.netProfitPct,
    pf: st.profitFactor,
    dd: st.maxDrawdownPct,
    bh: st.buyHoldPct,
    sharpe: st.sharpe,
    stops: t1.filter((t) => t.exitReason === "Stop").length,
    targets: t1.filter((t) => t.exitReason === "Target").length,
    held: held.length,
    late: lateFill.length,
    heldRun: +heldRun.toFixed(2),
    heldForced: +heldForced.toFixed(2),
    overnight: overnight.length,
    overnightPct: +seqPct(overnight).toFixed(2),
  });

  // RR1 under both cost models: v2 sweeps every RR at every cost model, so the RR1 row of
  // the cost table is backed by CSV rows too and not just by the zero-cost ALL row.
  for (const ck of ["live", "old"]) {
    const g = runs[`rr1@${ck}`].stats;
    push({
      symbol: sym,
      period: "ALL",
      rr: 1,
      cost: ck,
      sessions: days.length,
      from: etDay(bars[0].time),
      to: etDay(bars.at(-1).time),
      bars: bars.length,
      trades: g.totalTrades,
      tps: +(g.totalTrades / days.length).toFixed(3),
      win: g.winRatePct,
      net: g.netProfitPct,
      pf: g.profitFactor,
      dd: g.maxDrawdownPct,
      bh: st.buyHoldPct,
    });
  }

  // per-year / per-quarter of the RR1 zero-cost run (the sweep's default model)
  const bucket = (fn) => {
    const g = {};
    for (const t of t1) {
      const k = fn(t.entryTime);
      g[k] ??= { trades: 0, wins: 0, pnlPct: 0, stop: 0, target: 0 };
      g[k].trades++;
      g[k].wins += t.pnlPct > 0 ? 1 : 0;
      g[k].pnlPct += t.pnlPct;
      g[k][t.exitReason === "Stop" ? "stop" : "target"]++;
    }
    return g;
  };
  for (const [y, g] of Object.entries(bucket(etYear)))
    push({
      symbol: sym,
      period: `Y${y}`,
      rr: 1,
      cost: "zero",
      sessions: "",
      trades: g.trades,
      tps: "",
      win: +((g.wins / g.trades) * 100).toFixed(2),
      net: "",
      pf: "",
      dd: "",
      bh: "",
      sharpe: "",
      stops: g.stop,
      targets: g.target,
      held: "",
      late: "",
      heldRun: "",
      heldForced: "",
      overnight: "",
      overnightPct: "",
      avg: +(g.pnlPct / g.trades).toFixed(3),
    });
  for (const [q, g] of Object.entries(bucket(etQuarter)).sort(([a], [b]) => a.localeCompare(b)))
    push({
      symbol: sym,
      period: q,
      rr: 1,
      cost: "zero",
      sessions: "",
      trades: g.trades,
      tps: "",
      win: +((g.wins / g.trades) * 100).toFixed(2),
      net: "",
      pf: "",
      dd: "",
      bh: "",
      sharpe: "",
      stops: "",
      targets: "",
      held: "",
      late: "",
      heldRun: "",
      heldForced: "",
      overnight: "",
      overnightPct: "",
      avg: "",
    });

  // RR × cost grid rows
  for (const rr of [1.5, 2, 3])
    for (const ck of Object.keys(COSTS)) {
      const g = runs[`rr${rr}@${ck}`].stats;
      push({
        symbol: sym,
        period: `RR${rr}`,
        rr,
        cost: ck,
        sessions: days.length,
        trades: g.totalTrades,
        tps: +(g.totalTrades / days.length).toFixed(3),
        win: g.winRatePct,
        net: g.netProfitPct,
        pf: g.profitFactor,
        dd: g.maxDrawdownPct,
        bh: st.buyHoldPct,
      });
    }

  // time-split rows (RR1 and RR3, zero cost) — the regime finding. Each half is a
  // SEPARATE engine run on the half's own bars, not a trade-list slice: compounding
  // restarts at the half's first bar, so net% is the engine's own figure for "this
  // half traded alone" and is directly comparable to the headline rows.
  const cut = bars.findIndex((b) => etDay(b.time) === SPLIT_AT);
  for (const rr of [1, 3]) {
    for (const [label, part] of [
      ["first_half", bars.slice(0, cut)],
      ["second_half", bars.slice(cut)],
    ]) {
      const half = backtest(part, strategy(rr, "zero"));
      const hs = half.stats;
      const pd = [...new Set(part.map((b) => etDay(b.time)))];
      push({
        symbol: sym,
        period: `RR${rr}_${label}`,
        rr,
        cost: "zero",
        sessions: pd.length,
        from: etDay(part[0].time),
        to: etDay(part.at(-1).time),
        trades: hs.totalTrades,
        tps: +(hs.totalTrades / pd.length).toFixed(3),
        win: hs.winRatePct,
        net: hs.netProfitPct,
        pf: hs.profitFactor,
        dd: hs.maxDrawdownPct,
      });
      // The same half with 0.02% charged on every STOP exit only (the captain's "the only
      // real execution cost is stop-exit slippage" model). The engine's cost fields are
      // symmetric, so this row is the half's trade list adjusted by hand and compounded
      // the same way the equity curve does — labelled in the cost_model column so it can
      // never be read as an engine cost setting.
      const slipRun = backtest(part, strategy(rr, "zero")).trades;
      const all = slipRun.map((t) =>
        t.exitReason === "Stop" ? (t.pnlPct ?? 0) - 0.02 : (t.pnlPct ?? 0),
      );
      push({
        symbol: sym,
        period: `RR${rr}_${label}_stopslip002`,
        rr,
        cost: "zero_plus_0.02pct_stop_exit_slippage",
        sessions: pd.length,
        from: etDay(part[0].time),
        to: etDay(part.at(-1).time),
        trades: hs.totalTrades,
        tps: "",
        win: hs.winRatePct,
        net: +seqPct(all).toFixed(2),
        pf: +pfOf(all).toFixed(2),
      });
    }
  }
  bars.length = 0; // one bar-set alive per symbol, not three
}

const HDR =
  "symbol,rr,cost_model,period,sessions,from,to,bars,trades,trades_per_session,win_rate_pct,net_profit_pct,profit_factor,max_drawdown_pct,buy_hold_pct,sharpe,exit_stop,exit_target,open_at_session_close,fills_on_session_last_bar,open_at_session_close_pnl_as_run,open_at_session_close_pnl_forced,overnight_holds,overnight_pnl_pct,avg_trade_pct";
const line = (r) =>
  [
    r.symbol,
    r.rr ?? "",
    r.cost ?? "",
    r.period,
    r.sessions ?? "",
    r.from ?? "",
    r.to ?? "",
    r.bars ?? "",
    r.trades,
    r.tps,
    r.win,
    r.net,
    r.pf,
    r.dd,
    r.bh,
    r.sharpe,
    r.stops ?? "",
    r.targets ?? "",
    r.held ?? "",
    r.late ?? "",
    r.heldRun ?? "",
    r.heldForced ?? "",
    r.overnight ?? "",
    r.overnightPct ?? "",
    r.avg ?? "",
  ]
    .map((v) => (v == null || v === "" ? "" : v))
    .join(",");

const csv = [HDR, ...rows.map(line)].join("\n") + "\n";
if (CHECK) {
  const have = readFileSync(OUT, "utf8");
  if (have !== csv) {
    console.error("MISMATCH: the committed results/ivb-or-break-backtest.csv is not what");
    console.error("these fixtures and this script produce. Regenerate it (no --check) or");
    console.error("inspect the diff above; the committed sweep must be reproducible.");
    process.exit(1);
  }
  console.log(`OK: ${rows.length} rows reproduce byte-identically from the committed fixtures`);
} else {
  writeFileSync(OUT, csv);
  console.log(`wrote ${rows.length} rows to results/ivb-or-break-backtest.csv`);
}