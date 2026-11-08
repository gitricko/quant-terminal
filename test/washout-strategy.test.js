// Pinned strategy test for the washout Long setup on SPY 5m.
//
// Unlike the indicator unit tests (which pin the signal math), this pins the
// STRATEGY engine: signal -> next-open fill -> anchor stop -> exit priority.
// Expected fills are worked out BY HAND from the fixture OHLCV (not from the
// engine), so a regression in entry-fill, anchor-stop assignment, or stop-vs-
// target exit ordering turns this red.
//
// Cost triple + session rule mirror the saved UI strategy in
// scripts/sweep-washout-spy.js: fee 0.03%, slippage 0.03%, half-spread 0.03%,
// intrabar 'worst', flatten at 16:00 ET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerIndicator, compute } from '../public/lib/indicators.js';
import { backtest } from '../public/lib/backtest.js';
import ind from '../custom/washout-long.js';

registerIndicator({ ...ind, id: 'custom:washout-long' });

const bars = JSON.parse(
  readFileSync(new URL('./fixtures/spy-5m.json', import.meta.url), 'utf8'),
).bars;

const P = { pivotLen: 4, minWickPct: 0.4, mode: 'Early (candidate)' };
const res = compute('custom:washout-long', bars, P);

// Every early4 pulse (signal), index >= 3 so the indicator window is warm.
const fires = [];
for (let i = 3; i < bars.length; i++) if (res.early4[i] === 1) fires.push(i);
assert.ok(fires.length > 0, 'fixture produced at least one early4 signal');

// Engine cost knobs (as ratios).
const FEE = 0.0003, SLIP = 0.0003, HALF = 0.00015; // HALF = spreadPct/200
const IND = 'custom:washout-long';
const base = {
  indicators: { [IND]: { id: IND, params: P } },
  entryLong: [{ left: IND + '.early4', op: '>', right: '0' }],
  stopLoss: { indicator: IND, output: 'triggerLow' },
  initialCapital: 10000, positionPct: 100,
  feePct: 0.03, slippagePct: 0.03, spreadPct: 0.03,
  intrabar: 'worst', forcedFlatTime: '16:00',
};

// The hand-computed anchor for a signal at k. The engine's anchorStopAt() reads
// indicator 'triggerLow' scanning back from the fill bar (k+1); the indicator
// sets triggerLow[k] = the signal bar's own low, so the anchor is bars[k].low.
const anchorAt = (k) => bars[k].low;
// 'worst' entry fill: ask (half-spread) then slippage, both against a +1 long.
const entryFill = (open) => open * (1 + HALF) * (1 + SLIP);
// 'worst' exit fill for a long: bid (slippage) off the stop/target level.
const exitFill = (level) => level * (1 - SLIP);
// positionPct 100 over full cash: qty = alloc / (fill * (1 + fee)).
const qtyAt = (fill) => 10000 / (fill * (1 + FEE));

// forced-flat (16:00 ET, highest-priority exit) closes at the bar's CLOSE — not a
// stop/target level. A pinned case must NOT end on the session-close bar, else the
// hand math is wrong. isCloseBar mirrors backtest.js.
const etMin = (t) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false, minute: "2-digit" }).formatToParts(new Date(t * 1000));
  const g = (x) => Number(parts.find((q) => q.type === x)?.value ?? 0);
  return g("hour") * 60 + g("minute");
};
const etDay = (t) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t * 1000));
  return parts.map((x) => x.value).join("-");
};
const isCloseBar = (i) => {
  if (i === bars.length - 1) return true;
  const m = etMin(bars[i].time);
  if (m >= 960) return false; // 16:00 = 960 min
  return etMin(bars[i + 1].time) >= 960 || etDay(bars[i].time) !== etDay(bars[i + 1].time);
};

const relClose = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));

test('stop exit: entry fill, anchor stop, and stop fill all match hand math', () => {
  // stop-only strategy (no RR target, no trailing): the ONLY exit is the stop.
  const r = backtest(bars, { ...base, stopLossPct: 0, takeProfitPct: 0, rrMultiple: 0 });
  assert.ok(r.trades.length > 0, 'at least one trade');
  const k = fires[0];
  const stop = anchorAt(k);
  const entry = entryFill(bars[k + 1].open);
  const t = r.trades[0];
  assert.equal(t.side, 'long');
  assert.equal(t.entryTime, bars[k + 1].time, 'fills on the bar AFTER the signal');
  assert.ok(relClose(t.entryPrice, entry), 'entry fill = open * (1+half) * (1+slip)');
  // anchor stop is the signal bar low; the stop is the first exit, filled at the
  // bid -> engine exit price must equal stop*(1-slip).
  assert.equal(t.exitReason, 'Stop');
  assert.ok(relClose(t.exitPrice, exitFill(stop)), 'stop fill = anchor low * (1-slip)');
  // independent P&L cross-check (qty, cost, proceeds all hand-computed).
  const q = qtyAt(entry);
  const cost = q * entry * (1 + FEE);
  const proceeds = q * exitFill(stop);
  const pnl = proceeds * (1 - FEE) - cost;
  assert.ok(relClose(t.qty, q), 'qty = alloc / (fill * (1+fee))');
  assert.ok(relClose(t.pnl, pnl), 'pnl = proceeds*(1-fee) - cost');
  assert.ok(t.pnl < 0, 'this pinned stop-loss trade is a (small) loser');
});

test('target exit: 2R target reached before the anchor is honoured at its level', () => {
  const RR = 2;
  const r = backtest(bars, { ...base, rrMultiple: RR });
  assert.ok(r.trades.length > 0, 'at least one trade');
  // Hand-compute each fire's anchor (triggerLow = signal bar low -> entry fill ->
  // 2R target), then confirm the ENGINE actually produces a matching trade. Walk the
  // first trade-touching bar: if it gapped through the target, the engine exits at the
  // open (max(target, open) * (1-slip)), so a clean touch-exit is only a hand-computable
  // case when bar.open <= target (no gap-through) AND the exit bar is not the
  // session's close bar (forced-flat fills at the close, not a level).
  let pick = null, t = null;
  for (const k of fires) {
    const stop = anchorAt(k);
    const entry = entryFill(bars[k + 1].open);
    if (!(stop < entry)) continue;
    const target = entry + RR * (entry - stop);
    let firstExit = -1;
    for (let i = k + 1; i < bars.length; i++) {
      if (bars[i].low <= stop || bars[i].high >= target) { firstExit = i; break; }
    }
    if (firstExit < 0) continue;
    if (bars[firstExit].low <= stop) continue; // stop first -> not a clean target case
    const exitBar = bars[firstExit];
    if (exitBar.open > target) continue;  // gapped through target -> engine fills at open, not level
    if (isCloseBar(firstExit)) continue; // forced-flat fills at close, not the 2R level
    t = r.trades.find(
      (x) =>
        relClose(x.entryPrice, entry) &&
        x.exitReason === 'Target' &&
        relClose(x.exitPrice, exitFill(target)),
    );
    if (t) { pick = { k, stop, entry, target }; break; }
  }
  assert.ok(pick, 'no hand-computable target-exit case in the fixture');
  assert.ok(t, 'engine produced a matching target-exit trade');
  assert.equal(t.entryTime, bars[pick.k + 1].time, 'fills on the bar AFTER the signal');
  assert.ok(relClose(t.entryPrice, pick.entry), 'entry fill = open * (1+HALF) * (1+SLIP)');
  assert.ok(relClose(t.exitPrice, exitFill(pick.target)), 'target fill = 2R level * (1-slip)');
  assert.ok(t.pnl > 0, 'winning a 2R target is a winner (even after costs)');
});
