---
name: backtest-strategy
description: Build, run, and judge Quant Terminal strategies with the local backtester and quant checks. Use when asked to backtest an idea, build entry/exit rules, or assess whether a backtest result is real.
---

# Build a backtest strategy

A strategy is a **plain JSON object** — no framework — consumed identically by the UI,
`POST /api/backtest`, and any script. Canonical shape: the comment block at
`public/lib/backtest.js:1-19`. Five examples in `EXAMPLE_STRATEGIES` (same file, `:450`):
EMA cross, RSI mean reversion, Supertrend, MACD + trend filter, Bollinger breakout.

```
{ name,
  indicators: { key: { id: 'ema', params: { length: 9 } } },
  entryLong:  [ { left, op, right } ],   // ALL rules must be true
  exitLong:   [ ... ], entryShort: [], exitShort: [],
  exitMatch: 'all',                        // 'any' = first exit that fires wins
  maxBarsInTrade: 0,                       // time exit; 0 = off
  stopLossPct, takeProfitPct, trailingStopPct,   // all 0 = off
  initialCapital: 10000, positionPct: 100,
  feePct, slippagePct, spreadPct,
  intrabar: 'worst' }                      // 'ohlc' or 'magnifier' (needs subBars)
```

## Operands and ops (the whole DSL)

- **Operand**: a number · a price field (`open high low close volume hl2 hlc3 ohlc4 hlcc4`) ·
  an indicator key declared in `indicators` · an indicator output (`macd.signal`) · a drawn line
  from the chart.
- **Indicator id**: built-in (`ema rsi macd atr bb st ...` — the map in
  `public/lib/indicators.js`) or `custom:<basename>` for `custom/*.js` (e.g.
  `custom:washout-long`). Multi-output customs: name the output — `wlong.early5`.
- **Ops (7)**: `> < >= <= crossesAbove crossesBelow crosses`. A cross needs the relationship
  to be strictly reversed on the previous bar — a NaN→value first appearance never fires.

## Run it

Quick (node, ESM):

```
node --input-type=module -e "
  import { backtest } from './public/lib/backtest.js';
  import { readFileSync } from 'fs';
  const bars = JSON.parse(readFileSync('test/fixtures/btc-1d.json', 'utf8'));
  const r = backtest(bars, STRAT);
  console.log(r.stats, r.trades.slice(0, 3));"
```

`backtest(bars, strat, { subBars })` → `{ trades, equity, stats }`.
- `trades[]`: `side, entryTime, exitTime, entryPrice, exitPrice, qty, pnl, pnlPct, bars,
  entryReason, exitReason` (`Entry/Exit long|short, Stop, Target, Trail, Time exit`).
- `equity`: array of `{time, value}`; final value = `equity.at(-1).value`.
- `stats`: `netProfit, netProfitPct, buyHoldPct, totalTrades, winRatePct, profitFactor,
  maxDrawdownPct, sharpe, sortino, exposurePct, feesAndSlippage, ...`.

## Judge it before believing it

`quantChecks(bars, strat)` in `public/lib/quant.js` — the "gold box" the UI renders via
`public/js/quantui.js`. Re-runs the strategy ~25 times with nearby settings; gates:
walk-forward, PBO (backtest overfitting), deflated Sharpe, probabilistic
Sharpe, cost stress, parameter robustness, Monte Carlo trade reshuffle. Verdict text:
all pass → "paper trade it next"; none pass → "most likely luck or tuned to the past".
Expensive on big series — run it after the numbers look plausible, not as a first probe.

## Test it properly

`test/backtest.test.js` is the pattern: **hand-built bar series** (the `flat()`/`day()` helpers
there), assert exact fills, then fixture-wide checks for the rest. When building strategy
code, follow the repo rule: assert values you can compute by hand; register the test file in
the `test` script in `package.json`.

## Pitfalls

- **Fills lag by one bar.** Signals read on a bar's close, filled at the next bar's open
  (slippage applied). A stop hitting on bar N exits at N+1's open unless
  `intrabar: 'ohlc'|'magnifier'` models it intrabar — so "stop at 2%" can print worse than -2%
  in the default mode; that is a gap, not a bug (see the stops test, `test/backtest.test.js:26`).
- **Long stops trigger on the bid.** With `spreadPct` set, a move can trip a long's stop
  without moving the mid — expected behavior, not an engine fault.
- **`exitMatch: 'all'` is the default**: all exit rules must be true on the same bar. For
  "exit on whichever fires first" you want `'any'` — and each exit must be expressible as the
  *opposite* condition, because only booleans get ANDed.
- **`maxBarsInTrade: N`** closes at the next open after N bars *unless an exit fires first*;
  `0` disables. Don't count it as a signal.
- **Custom-indicator ids** are the filename minus `.js`, prefixed `custom:`. `custom/signal-*.js`
  are gitignored (user-private) — never reference their names in committed code or docs.
- **New test files** must be added to `package.json` *and* the hardcoded list in
  `scripts/check.js` — the `npm run check` list is not derived from `package.json`.
- **No look-ahead by construction**: `crossesAbove/below` and rolling indicators only use past
  bars. A "strategy" that peeks at `bars[i+1]` in a custom indicator is silently broken — the
  backtest still "works", which is the dangerous part.
- **Cost floors in quantChecks**: cost stress is at least 0.05% a side even with `feePct: 0` —
  a zero-cost backtest is not what the gates see.

## Definition of done

Strategy object written (or JSON file under the user's control); a node run or test showing
expected fills; `npm test` green; `npm run check` READY when a test file changed.
Quant-checks verdict reported with its pass count (`n/7`), and the "paper trade it" /
"most likely luck" interpretation, before calling a strategy "good".
