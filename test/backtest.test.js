import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backtest, EXAMPLE_STRATEGIES, tradesCsv, magnifierTf } from '../public/lib/backtest.js';

const bars = JSON.parse(readFileSync(new URL('./fixtures/btc-1d.json', import.meta.url), 'utf8'));

test('fills on the next bar open, never the signal bar', () => {
  const r = backtest(bars, EXAMPLE_STRATEGIES['EMA cross (9/21)']);
  assert.ok(r.trades.length > 5);
  for (const t of r.trades) {
    const i = bars.findIndex((b) => b.time === t.entryTime);
    assert.ok(i > 0);
    assert.ok(Math.abs(t.entryPrice - bars[i].open * 1.0005) < 1e-6, 'entry = open x (1 + slippage)');
  }
});

test('equity curve accounts for every trade', () => {
  const s = EXAMPLE_STRATEGIES['RSI mean reversion (30/55)'];
  const r = backtest(bars, { ...s, initialCapital: 10000 });
  const sumPnl = r.trades.reduce((a, t) => a + t.pnl, 0);
  assert.ok(Math.abs(10000 + sumPnl - r.equity.at(-1).value) < 1e-6);
  assert.equal(r.stats.totalTrades, r.trades.length);
});

test('stops cap the loss of a losing trade', () => {
  const r = backtest(bars, { ...EXAMPLE_STRATEGIES['EMA cross (9/21)'], stopLossPct: 2, feePct: 0, slippagePct: 0 });
  const stopped = r.trades.filter((t) => t.exitReason === 'Stop');
  assert.ok(stopped.length > 0);
  for (const t of stopped) assert.ok(t.pnlPct >= -2 - 15, 'gap through the stop is the only way past -2%');
});

test('shorts make money when price falls', () => {
  const down = Array.from({ length: 60 }, (_, i) => ({ time: i * 86400, open: 100 - i, high: 101 - i, low: 99 - i, close: 100 - i, volume: 1 }));
  const r = backtest(down, { indicators: {}, entryShort: [{ left: 'close', op: '<', right: 95 }], exitShort: [{ left: 'close', op: '<', right: 50 }], feePct: 0, slippagePct: 0 });
  assert.equal(r.trades[0].side, 'short');
  assert.ok(r.trades[0].pnl > 0);
});

test('every example strategy runs and the trades export to CSV', () => {
  for (const [name, s] of Object.entries(EXAMPLE_STRATEGIES)) {
    const r = backtest(bars, s);
    assert.ok(r.equity.length === bars.length, name);
    assert.ok(tradesCsv(r.trades).startsWith('side,'));
  }
});

import { linePrice, conditionFn } from "../public/lib/backtest.js";
import * as indlib from "../public/lib/indicators.js";

// Register a tiny fixture indicator for the anchor-stop tests: `signal` is the entry pulse
// and `stopLevel` is a fixed price we want used as the stop. Both are flat arrays so the
// hand-computations are trivial.
indlib.registerIndicator({
  id: "custom:anchor-fixture",
  name: "Anchor fixture",
  outputs: [
    { key: "signal", label: "sig" },
    { key: "stopLevel", label: "stop" },
  ],
  calc: (bars, p, ta) => {
    const n = bars.length;
    const s = new Array(n).fill(null);
    const st = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (bars[i].close > (i === 0 ? 1000 : bars[i - 1].close)) s[i] = 1;
      if (p.stopAt != null) st[i] = p.stopAt;
    }
    return { signal: s, stopLevel: st };
  },
});

const noCosts2 = { feePct: 0, slippagePct: 0, spreadPct: 0 };

test('a drawn line gives its price at any time, within its reach', () => {
  const trend = linePrice({ t1: 100, p1: 10, t2: 200, p2: 20, extend: 'none' });
  assert.equal(trend(150), 15);
  assert.ok(Number.isNaN(trend(250)), 'a trend line stops at its second point');
  const ray = linePrice({ t1: 100, p1: 10, t2: 200, p2: 20, extend: 'right' });
  assert.equal(ray(300), 30);
  assert.ok(Number.isNaN(ray(50)), 'a ray has nothing behind its start');
  const ext = linePrice({ t1: 100, p1: 10, t2: 200, p2: 20, extend: 'both' });
  assert.equal(ext(0), 0);
});

test('price crossing a drawn line is detected bar by bar', () => {
  const series = [5, 6, 7, 12, 13].map((c, i) => ({ time: i * 10, open: c, high: c, low: c, close: c, volume: 1 }));
  const rising = { line: { t1: 0, p1: 8, t2: 40, p2: 12, extend: 'right' } }; // 8, 9, 10, 11, 12
  const test = conditionFn(series, {})({ left: 'close', op: 'crossesAbove', right: rising });
  assert.deepEqual(series.map((_, i) => test(i)), [false, false, false, true, false]);
});

// Jeff's asks: exit on whichever rule fires first, and a time exit when nothing else has.
const flat = (closes) => closes.map((c, i) => ({ time: 1700000000 + i * 86400, open: c, high: c, low: c, close: c, volume: 1 }));
const noCosts = { feePct: 0, slippagePct: 0 };

test('exitMatch any exits on whichever exit condition fires first; all waits for both', () => {
  const b = flat([100, 100, 120, 130, 125, 90, 80, 80]);
  const s = {
    ...noCosts,
    entryLong: [{ left: 'close', op: '>', right: 110 }],
    exitLong: [{ left: 'close', op: '<', right: 128 }, { left: 'close', op: '<', right: 100 }],
  };
  // Long from bar 3's open (signal on bar 2). Bar 4 closes at 125: only the first rule is true; bar 5 at 90: both.
  assert.equal(backtest(b, { ...s, exitMatch: 'any' }).trades[0].exitTime, b[5].time);
  assert.equal(backtest(b, s).trades[0].exitTime, b[6].time);
  assert.equal(backtest(b, { ...s, exitMatch: 'any' }).trades[0].exitReason, 'Exit long');
});

test('maxBarsInTrade closes a trade after that many bars unless an exit fires first', () => {
  const b = flat(Array.from({ length: 30 }, (_, i) => 100 + i));
  const s = { ...noCosts, entryLong: [{ left: 'close', op: '>', right: 0 }], maxBarsInTrade: 5 };
  const r = backtest(b, s);
  assert.ok(r.trades.length > 2);
  for (const t of r.trades.slice(0, -1)) {
    assert.equal(t.bars, 5);
    assert.equal(t.exitReason, 'Time exit');
  }
  const early = backtest(b, { ...s, exitLong: [{ left: 'close', op: '>=', right: 103 }] }).trades[0];
  assert.equal(early.exitReason, 'Exit long');
  assert.ok(early.bars < 5);
  assert.ok(backtest(b, { ...s, maxBarsInTrade: 0 }).trades.length === 1, '0 turns it off');
});

// @mats8038: real tick and spread simulation.
const day = (i, o, h, l, c) => ({ time: 1700000000 + i * 86400, open: o, high: h, low: l, close: c, volume: 1 });

test('the spread fills buys at the ask and sells at the bid', () => {
  const b = [day(0, 100, 100, 100, 100), day(1, 100, 100, 100, 100), day(2, 100, 100, 100, 100), day(3, 100, 100, 100, 100)];
  const s = { ...noCosts, spreadPct: 0.2, entryLong: [{ left: 'close', op: '>', right: 0 }], exitLong: [{ left: 'close', op: '>', right: 0 }] };
  const t = backtest(b, s).trades[0];
  assert.ok(Math.abs(t.entryPrice - 100.1) < 1e-9);
  assert.ok(Math.abs(t.exitPrice - 99.9) < 1e-9);
  assert.match(backtest(b, s).stats.feesAndSlippage, /0.2% spread/);
});

test("a long's stop triggers on the bid, so the spread can set it off when the mid doesn't", () => {
  const b = [day(0, 100, 100, 100, 100), day(1, 100, 100, 98.15, 99), day(2, 99, 99, 99, 99)];
  const s = { ...noCosts, stopLossPct: 2, entryLong: [{ left: 'close', op: '>', right: 0 }] };
  assert.equal(backtest(b, s).trades[0].exitReason, 'End of data');
  assert.equal(backtest(b, { ...s, spreadPct: 0.2 }).trades[0].exitReason, 'Stop'); // bid 98.05 < stop 98.098
});

test('fills inside a bar: cautious, TradingView path, and the bar magnifier', () => {
  // Bar 1 touches both the 2% stop (98) and the 2% target (102); its high is nearer the open than its low.
  const b = [day(0, 100, 100, 100, 100), day(1, 100, 102.5, 97, 100), day(2, 100, 100, 100, 100)];
  const s = { ...noCosts, stopLossPct: 2, takeProfitPct: 2, entryLong: [{ left: 'close', op: '>', right: 0 }] };
  assert.equal(backtest(b, s).trades[0].exitReason, 'Stop');
  assert.equal(backtest(b, { ...s, intrabar: 'ohlc' }).trades[0].exitReason, 'Target');
  // The real lower-timeframe bars show it fell first.
  const subBars = [
    { time: b[1].time, open: 100, high: 100, low: 97, close: 97.5 },
    { time: b[1].time + 43200, open: 97.5, high: 102.5, low: 97.5, close: 100 },
  ];
  const m = backtest(b, { ...s, intrabar: 'magnifier' }, { subBars });
  assert.equal(m.trades[0].exitReason, 'Stop');
  assert.equal(m.trades[0].exitPrice, 98);
  assert.equal(m.stats.intrabarCovered, 1);
  assert.match(m.stats.fills, /inside 1 of 3 bars, the rest on the OHLC path/);
  // Rising first inside the bar: the target fills.
  const up = [
    { time: b[1].time, open: 100, high: 102.5, low: 100, close: 101 },
    { time: b[1].time + 43200, open: 101, high: 101, low: 97, close: 100 },
  ];
  assert.equal(backtest(b, { ...s, intrabar: 'magnifier' }, { subBars: up }).trades[0].exitReason, 'Target');
});

test('a bar that opens past the stop fills at the open on every fill setting', () => {
  const b = [day(0, 100, 100, 100, 100), day(1, 100, 100, 99, 99), day(2, 95, 96, 94, 95), day(3, 95, 95, 95, 95)];
  const s = { ...noCosts, stopLossPct: 2, entryLong: [{ left: 'close', op: '>', right: 0 }] };
  for (const intrabar of ['worst', 'ohlc', 'magnifier']) {
    const t = backtest(b, { ...s, intrabar }).trades[0];
    assert.equal(t.exitReason, 'Stop');
    assert.equal(t.exitPrice, 95, intrabar);
  }
});

test('the magnifier picks the finest timeframe that covers the test in 20,000 bars', () => {
  assert.equal(magnifierTf(14400, 1000 * 14400).tf, '15m');
  assert.equal(magnifierTf(86400, 1000 * 86400).tf, '4h');
  assert.equal(magnifierTf(3600, 300 * 3600).tf, '1m');
  assert.equal(magnifierTf(3600, 500 * 3600).tf, '5m');
  assert.equal(magnifierTf(60, 1000 * 60), null);
});

// ---------------------------------------------------------------------------
// New: anchor stop (strategy.stopLoss object), R:R multiples, time operands,
// and forced-flat session discipline. All hand-computed to close the gap a
// regression in openPos's stop/target math would leave.
// ---------------------------------------------------------------------------

// Hand-computed: entry fires on bar 0 (close 110 > 1000-sentinel → 110>110? no, on bar 1: 110 > 110? no;
// the fixture sets signal[i] when close[i] > close[i-1]; bar 2 close=111 > bar 1=110 → signal at i=2,
// fill at bar 3 open). Stop is the fixed `stopAt` price. We pick a path where a stop is touched
// before a target so the fill price is exactly the stop.
test('anchor stop: strategy.stopLoss object sets a FIXED price as the stop', () => {
  const b = [
    { time: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 1 }, // i=0: baseline
    { time: 1700000000 + 86400, open: 100, high: 101, low: 99, close: 100, volume: 1 }, // i=1
    { time: 1700000000 + 2 * 86400, open: 100, high: 101, low: 99, close: 101, volume: 1 }, // i=2: close 101 > 100 → signal; next open is bar 3
    { time: 1700000000 + 3 * 86400, open: 101.5, high: 102, low: 101.2, close: 101.8, volume: 1 }, // i=3: fill at 101.5
    { time: 1700000000 + 4 * 86400, open: 101.8, high: 102, low: 95, close: 96, volume: 1 }, // i=4: low 95 ≤ stop → stop fills
  ];
  const r = backtest(b, {
    ...noCosts2,
    indicators: { sig: { id: "custom:anchor-fixture", params: { stopAt: 96.5 } } },
    entryLong: [{ left: "sig.signal", op: ">", right: 0 }],
    stopLoss: { indicator: "sig", output: "stopLevel" }, // 96.5
  });
  const t = r.trades[0];
  assert.equal(t.side, "long");
  assert.equal(t.entryPrice, 101.5, "entry at bar 3 open (no costs)");
  assert.equal(t.exitReason, "Stop");
  assert.equal(t.exitPrice, 96.5, "stop = fixed anchor price 96.5");
});

test('R:R multiple: target = entry + rr × (entry − anchor) on a long', () => {
  // entry 100, anchor stop 95 → risk = 5. rrMultiple 1 → target 105; rr 1.5 → 107.5; rr 2 → 110.
  const mk = (lastClose) => [
    { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 }, // i=0
    { time: 86400, open: 100, high: 100, low: 100, close: 100, volume: 1 }, // i=1
    { time: 2 * 86400, open: 100, high: 101, low: 100, close: 101, volume: 1 }, // i=2: signal
    { time: 3 * 86400, open: 101, high: 101, low: 101, close: 101, volume: 1 }, // i=3: fill at 101
    { time: 4 * 86400, open: 101, high: 101, low: 101, close: 101, volume: 1 }, // i=4
    { time: 5 * 86400, open: 101, high: 102, low: 101, close: 102, volume: 1 }, // i=5
    { time: 6 * 86400, open: 102, high: 1000, low: 102, close: 102, volume: 1 }, // i=6: big high → hits target
  ];
  const run = (rr) =>
    backtest(mk(), {
      ...noCosts2,
      indicators: { sig: { id: "custom:anchor-fixture", params: { stopAt: 96 } } },
      entryLong: [{ left: "sig.signal", op: ">", right: 0 }],
      stopLoss: { indicator: "sig", output: "stopLevel" },
      rrMultiple: rr,
    }).trades[0];
  const r1 = run(1);
  // entry=101 (open at bar 3), risk = 101-96 = 5 → target = 101 + 1*5 = 106.
  assert.equal(r1.entryPrice, 101);
  assert.equal(r1.exitReason, "Target");
  assert.equal(r1.exitPrice, 106, "1:1 R:R");
  const r15 = run(1.5);
  assert.equal(r15.exitPrice, 108.5, "1.5:1 R:R");
  const r2 = run(2);
  assert.equal(r2.exitPrice, 111, "2:1 R:R");
});

test('forced flat: flattens any open position on the last bar of the day before the cutoff', () => {
  // One realistic 1m RTH day (2026-11-04, DST off → ET = UTC-5): 09:30→15:59 ET, 390 bars.
  // Price is flat at 100 until bar 4, where it crosses above 99.5 (one entry signal).
  // The close bar is the last bar before the 16:00 cutoff = bar 389 (15:59 ET open; the
  // forced-flat closes any open position at THAT bar's close). Expect exactly one trade,
  // exited "Forced flat" — not "End of data".
  const T0 = Math.floor(new Date("2026-11-04T14:30:00Z").getTime() / 1000);
  const N = 390;
  const bars = [];
  for (let i = 0; i < N; i++) {
    const close = i < 4 ? 100 : 102;
    bars.push({ time: T0 + i * 60, open: close, high: close, low: close, close, volume: 1 });
  }
  const r = backtest(bars, {
    ...noCosts2,
    initialCapital: 10000,
    entryLong: [{ left: "close", op: "crossesAbove", right: 100.5 }],
    forcedFlatTime: "16:00",
  });
  assert.equal(r.trades.length, 1, "one trade on the day");
  assert.equal(r.trades[0].side, "long");
  assert.equal(r.trades[0].exitReason, "Forced flat", "the position is flattened on the close bar, not at end-of-data");
  assert.equal(r.trades[0].exitTime, bars[N - 1].time, "exited on the day's final RTH bar");
});

test('time operand: "after HH:MM" / "before HH:MM" compare against ET wall clock', () =>
  import("../public/lib/backtest.js").then((m) => {
    // Fixed reference time: 2026-11-06 16:00 ET (DST off → UTC 21:00).
    const t16 = Math.floor(new Date(Date.UTC(2026, 10, 6, 21, 0, 0)).getTime() / 1000);
    assert.equal(m.timeRuleValue("after 16:00", t16 - 6 * 3600), false, "10:00 ET is not after 16:00");
    assert.equal(m.timeRuleValue("after 16:00", t16), false, "16:00 ET is not STRICTLY after 16:00");
    assert.equal(m.timeRuleValue("after 16:00", t16 + 30 * 60), true, "16:30 ET is after 16:00");
    assert.equal(m.timeRuleValue("before 16:00", t16), false, "16:00 is not before 16:00");
    assert.equal(m.timeRuleValue("before 16:00", t16 - 30 * 60), true, "15:30 ET is before 16:00");
  }));
