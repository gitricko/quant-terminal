#!/usr/bin/env node
// Grid sweep for the Washout Long SPY strategy (docs/strategies/washout-long-spy.md).
// 3 tiers × 3 confirmation variants × 6 exits × 4 timeframes — no trend filter yet.
//
// Zero runtime deps. Reads fixtures from test/fixtures; writes results.csv + prints a table.
//
//   node scripts/sweep-washout-spy.js
//   node scripts/sweep-washout-spy.js --top 25 --min-trades 4 --sort sharpe

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  compute,
  registerIndicator,
  INDICATORS,
} from "../public/lib/indicators.js";
import washoutLong from "../custom/washout-long.js";
import { backtest } from "../public/lib/backtest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "test", "fixtures");

registerIndicator({ ...washoutLong, id: "custom:washout-long" });

// ------------------------------------------------------------------ arg parse
const argv = process.argv.slice(2);
const arg = (n, dflt) => {
  const i = argv.indexOf(`--${n}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`arg --${n} needs a value`);
  return v;
};
const TOP = parseInt(arg("top", "25"), 10);
const MIN_TRADES = parseInt(arg("min-trades", "3"), 10);
const SORT = arg("sort", "sharpe"); // sharpe | pf | pnl

// Fixed costs (per spec: leave as variable to adjust).
// SPY at a retail broker with no-commission + slippage + half-spread.
const COSTS = { feePct: 0.03, slippagePct: 0.03, spreadPct: 0.03 };
// Session close rule per spec: flatten any long before 4pm Eastern; no entries after 3pm.
const SESSION = { forcedFlatTime: "16:00" };

// ------------------------------------------------------------------ grid
// Tier grid. `refBar` is no longer needed — the engine's anchor stop now scans
// backward from the fill bar up to 4 bars for the nearest non-NaN triggerLow
// (backtest.js anchorStopAt, refBar 'signal' default), which covers both the
// pulse rows (fill at T+1) and the cc/ch rows (fill at T+2) uniformly.
const TIERS = [
  { name: "early5", output: "early5" },
  { name: "early4", output: "early4" },
  { name: "only4", output: "only4" },
  { name: "5confirm", output: "cc5" },
  { name: "5confhigh", output: "ch5" },
  { name: "4confirm", output: "cc4" },
  { name: "4confhigh", output: "ch4" },
];
const EXITS = [
  { name: "stop-only", stopLoss: "anchor",  rr: 0   },
  { name: "trail-4%",  stopLoss: "anchor",  trailPct: 4 },
  { name: "trail-8%",  stopLoss: "anchor",  trailPct: 8 },
  { name: "rr-1.0",    stopLoss: "anchor",  rr: 1.0 },
  { name: "rr-1.25",   stopLoss: "anchor",  rr: 1.25 },
  { name: "rr-1.5",    stopLoss: "anchor",  rr: 1.5 },
  { name: "rr-2.0",    stopLoss: "anchor",  rr: 2.0 },
];
const TFS = ["1m", "5m", "15m", "30m"];

const INDICATOR_PARAMS = {
  pivotLen: 4,
  minWickPct: 0.40,
  mode: "Early (candidate)",
};

// ------------------------------------------------------------------ run
function makeStrategy(tier, exit) {
  return {
    name: `washout-long | ${tier.name} | ${exit.name}`,
    indicators: {
      "custom:washout-long": { id: "custom:washout-long", params: INDICATOR_PARAMS },
    },
    entryLong: [
      {
        left: `custom:washout-long.${tier.output}`,
        // `> 0` not `crossesAbove 0`: cc/ch outputs are NaN (not 0) between pulses,
        // and the engine's crossesAbove rejects NaN in the prior bar (backtest.js
        // conditionFn early-return). `> 0` works uniformly on all outputs.
        op: ">",
        right: 0,
      },
    ],
    exitLong: [],
    exitMatch: "any",
    forcedFlatTime: "16:00",
    ...COSTS,
    ...(exit.stopLoss === "anchor"
      ? {
          stopLoss: {
            indicator: "custom:washout-long",
            output: "triggerLow",
            refBar: tier.refBar,
          },
        }
      : {}),
    ...(exit.rr ? { rrMultiple: exit.rr } : {}),
    ...(exit.trailPct ? { trailingStopPct: exit.trailPct } : {}),
  };
}

function barsFor(tf) {
  const f = join(FIX, `spy-${tf}.json`);
  try {
    const raw = JSON.parse(readFileSync(f, "utf8"));
    // Our fixtures are wrapped ({ source, symbol, bars: [...] }) but the engine wants
    // a bare OHLCV array. BTC fixture is unwrapped — accept both.
    return Array.isArray(raw) ? raw : raw?.bars;
  } catch (e) {
    throw new Error(`fixture missing: ${f} — run node scripts/fetch-spy.js`);
  }
}

const rows = [];
const errors = [];

for (const tf of TFS) {
  let bars;
  try {
    bars = barsFor(tf);
  } catch (e) {
    errors.push({ tf, err: e.message });
    continue;
  }
  for (const tier of TIERS) {
    for (const exit of EXITS) {
      const strat = makeStrategy(tier, exit);
      let r;
      try {
        r = backtest(bars, strat);
      } catch (e) {
        errors.push({ tf, tier: tier.name, exit: exit.name, err: e.message });
        continue;
      }
      const s = r.stats;
      rows.push({
        tf,
        tier: tier.name,
        exit: exit.name,
        trades: s.totalTrades,
        winRate: s.winRatePct,
        pf: s.profitFactor,
        pnl: s.netProfit,
        pnlPct: s.netProfitPct,
        maxDD: s.maxDrawdownPct,
        sharpe: s.sharpe,
        sortino: s.sortino,
        avgWin: s.avgWinPct,
        avgLoss: s.avgLossPct,
        largestLoss: s.largestLoss,
        exposure: s.exposurePct,
        bars: bars.length,
      });
    }
  }
}

if (!rows.length) {
  console.error("No results (all grid rows errored)");
  for (const e of errors) console.error("  ", e);
  process.exit(2);
}

// ------------------------------------------------------------------ print
const by = {
  sharpe: (a) => (a.sharpe == null ? -Infinity : a.sharpe),
  by     : (a) => (a.pf     == null ? -Infinity : a.pf),
  pnl:    (a) => (a.pnl    == null ? -Infinity : a.pnl),
}[SORT];
const sorted = [...rows].sort((a, b) => by(b) - by(a));
const eligible = sorted.filter((x) => (x.trades ?? 0) >= MIN_TRADES);
const head = eligible.length ? eligible.slice(0, TOP) : sorted.slice(0, Math.min(TOP, 10));

const fmt = (v) => (v == null ? "-" : v);
const cols = [
  ["tf", 4], ["tier", 11], ["exit", 9], ["trade", 6], ["win%", 5],
  ["pf", 6], ["pnl%", 6], ["dd%", 5], ["sharpe", 6], ["avgW%", 6], ["avgL%", 6], ["exp%", 5],
];
const line = (c, sep, w) => c.padEnd(sep) + c.repeat(w).slice(0, w).padEnd(w);
function header() {
  return cols.map(([l, w]) => l).join(" ") + "  " + "bars" + "   note";
}
const sep = cols.map(([l, w]) => "-".repeat(w)).join(" ") + "  " + "-".repeat(5) + "  " + "-".repeat(20);
console.log(`sort=${SORT}, min_trades=${MIN_TRADES}, top=${TOP}, costs=${JSON.stringify(COSTS)}`);
console.log(header());
console.log(sep);
for (const r of head) {
  let note = "";
  if (r.trades < MIN_TRADES) note = "thin (n<min)";
  const cells = [
    [r.tf, 4], [r.tier, 11], [r.exit, 9],
    [String(fmt(r.trades)), 5],
    [fmt(r.winRate), 4],
    [fmt(r.pf), 4],
    [fmt(r.pnlPct), 5],
    [fmt(r.maxDD), 4],
    [fmt(r.sharpe), 5],
    [fmt(r.avgWin), 5],
    [fmt(r.avgLoss), 5],
    [fmt(r.exposure), 4],
  ].map(([v, w]) => String(v ?? "-")).map((x, i) => x.padEnd(cols[i][1]));
  console.log([...cells, String(r.bars).padEnd(5), note].join("   "));
}
if (errors.length) {
  console.log(`\n${errors.length} row(s) errored:`);
  for (const e of errors.slice(0, 8)) console.log("  ", e.tier, e.exit, e.err);
}

// ------------------------------------------------------------------ csv
const out = join(HERE, "..", "results");
try { mkdirSync(out, { recursive: true }); } catch {}
const csvPath = join(out, "washout-spy-sweep.csv");
const csv = [
  "tf,tier,exit,trades,winrate,profit_factor,pnl_pct,max_dd_pct,sharpe,sortino,avg_win_pct,avg_loss_pct,largest_loss,exposure_pct,bars",
  ...rows.map((r) =>
    [r.tf, r.tier, r.exit, r.trades, r.winRate, r.pf, r.pnlPct, r.maxDD, r.sharpe,
     r.sortino, r.avgWin, r.avgLoss, r.largestLoss, r.exposure, r.bars]
      .map((v) => (v == null ? "" : v))
      .join(",")
  ),
].join("\n");
try { writeFileSync(csvPath, csv); console.log(`\nCSV → ${csvPath}`); } catch (e) { console.log("csv write failed:", e.message); }
