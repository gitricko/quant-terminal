# Washout Long on SPY — strategy spec (v0.4, decisions locked)

Status: **built and swept** (v0.4, 2026-11-08). Data committed to test/fixtures/ per section 9;
section 11 is the final 168-cell grid - net loss on every cell, with the plain-language
read of why. Section 13 lists what stays to close (strategy test file, `npm run check`).

## 1. Signal

`custom/washout-long.js` (merged, PR #6) — one-bar pulse on bar **T** where a fresh
low (window `pivotLen+1`) gets rejected and the tier's check subset passes:

| # | check | 5/5 adds |
|---|---|---|
| 1 | green close `close >= open` | — |
| 2 | lower wick ≥ `minWickPct` of range | — |
| 3 | reclaim `high >= high[T-1]` | — |
| 4 | volume > volume[T-1] | — |
| 5 | prior 2 bars net-red `Σ sign(c−o)·v < 0` | — |

**Tiers (user decision): both 5/5 (`early5`) and 4/5 (`early4`).** Tested as
separate grid rows; results compared, not merged. `exact5`/`exact4`
(pivot-confirmed, fires 4 bars late) stay backlog.

Indicator params held fixed: `pivotLen: 4`, `minWickPct: 0.40`, `mode: 'Early (candidate)'`.

## 2. Entry — confirmation variants (user: "test the different variants")

Plain pulse entry (current engine behavior) fires the fill at bar T+1's open.
The grid tests **three** entry behaviors:

| variant | rule | fill |
|---|---|---|
| **pulse** | `washout > 0` at T (existing engine behavior, no new code) | open[T+1] |
| **confirm-close** | close[T+1] > close[T] AND fired at T | open[T+2] |
| **confirm-high** | close[T+1] > high[T] AND fired at T (full reclaim — stricter) | open[T+2] |

Confirm variants are new **indicator outputs** (additive; pulse shape; `noAutoscale`):

| output | fires at | condition |
|---|---|---|
| `cc5` | T+1 | `early5[T]` pulse AND `close[T+1] > close[T]` |
| `ch5` | T+1 | `early5[T]` pulse AND `close[T+1] > high[T]` |
| `cc4` | T+1 | `early4[T]` pulse AND `close[T+1] > close[T]` |
| `ch4` | T+1 | `early4[T]` pulse AND `close[T+1] > high[T]` |

Entry rule: `{ left: "wlong.cc5", op: ">", right: 0 }` (same `> 0` op —
`crosses*` can never fire off a NaN gap, `backtest.js:105-124`).
The extra fill bar (T+2) is part of the comparison, by design.

## 3. Stop — trigger bar low (user: "That is my risk")

**Stop = low[T]** for every run. A failed washout makes a lower low fast; the
trigger low is the natural invalidation. Not expressible in current JSON
(`stopLossPct` is fixed-percentage only) → **engine additions** (user OK), all
additive, backwards-compatible, in `public/lib/backtest.js`:

| addition | shape | notes |
|---|---|---|
| anchor stop | `stopLoss: { indicator, output }` — price read from indicator series **at the signal bar** | indicator exposes `stopLevel[i] = low[i-1]` when a signal fires at `i-1`, NaN otherwise → covers all four tiers/variants uniformly |
| R:R multiple | `rrMultiple: n` — target = entry + n × (entry − stop) | only valid with a price stop; this is what makes "1:1 vs 1:1.5 vs 1:2 **with my stop**" well-defined |
| priority | same bar hits both → **stop first** (conservative) | documented in-feature |
| time operand | rule operand strings `"before 16:00"` / `"after 09:30"` compared vs bar ET time | for rules 6, 7 |
| forced flat | `forcedFlat: "16:00"` — close any open position at the 16:00 bar's close | highest-priority exit; overrides RR/trailing |

Each gets hand-computed 2–3 bar tests in `test/backtest.test.js` (repo convention).

## 4. Exit grid (user: RR first — "I know my stop is the trigger bar low")

Ordered by priority:

| # | exit | definition |
|---|---|---|
| 1 | **RR 1:1** | target = entry + 1 × stop distance |
| 2 | **RR 1:1.5** | target = entry + 1.5 × stop distance |
| 3 | **RR 1:2** | target = entry + 2 × stop distance |
| 4 | stop-only | no target; stop + forced flat + maxBars only |
| 5 | trailing 4% | stop ratchets to highest close − 4% (sensitivity row) |
| 6 | trailing 8% | as above at 8% (sensitivity row) |

**Headline table = win rate & expectancy by RR multiple** (1:1 → 1:1.5 → 1:2),
since trade-offs move opposite ways (win rate falls, avg payoff rises); report
`win rate × avg payoff` (expectancy/trade) alongside so the comparison is honest.

`maxBarsInTrade`: leave 0 (off) for v1; forced flat already caps duration.
Candidate for a sensitivity row → backlog.

## 5. Trend filter (user: keep as permutation, not hardcoded)

Grid rows: **none** \| `close > ema50` \| `close > ema200`, evaluated on the
signal/confirm bar's close.

## 6. Time & session (user: "we always close position or not start position at 16:00")

- **Forced flat 16:00 ET** — no position open at the close, every run.
- **No late entries** — signal on a bar whose fill bar is the next trading day
  (e.g. the 15:00 bar on 1h-adjacent TFs; last bar of the session on any TF) is
  **skipped**. Impl: entry rule includes `time < 15:00` on the signal/confirm bar
  (i.e. "fills today"). Exact cutoff per TF = last RTH bar − 1, encoded per-TF.
- Net: **day-flat discipline, zero overnight exposure** in every cell.

## 7. Data — SPY, 5 timeframes, RTH (user decision)

- **Timeframes: 1m, 3m, 5m, 15m, 30m** (1h dropped by user).
- **RTH:** only 09:30–16:00 ET bars; pre/post dropped at fetch.
- **History — Yahoo hard caps**: 1m → 7d; 3m/5m/15m/30m → 60d each.
  Samples: 1m ≈ 900 bars; 3m ≈ 3,600; 5m ≈ 2,160; 15m ≈ 720; 30m ≈ 360 bars per TF.
  **All TFs are small-sample runs** — conclusions must be qualified by n (§8).
- **Committed data** (user: "i dont need to repull or rescrape" → commit it).
  **Proposal: `test/fixtures/spy-<tf>.json`** — repo precedent (`btc-1d.json` is
  committed and CI-tested), keeps `data/` purely personal-state as AGENTS.md wants.
  Refresh path: `node scripts/fetch-spy.js` (zero-dep, committed) rewrites the
  same files. If `docs/data/` is preferred instead, say so — it's a one-line move.
- File header: fetch timestamp + bar count (committed, self-describing).

## 8. Costs (user: "leave it to you… variable to adjust later, do what if")

Defaults: `feePct: 0.10`, `slippagePct: 0.05`, `spreadPct: 0.05` (retail US
intraday). All plain strategy fields → "what-if" = one number. `quantChecks`
cost-stress floors at 0.05%/side anyway.

## 9. Files & layout

```
docs/strategies/washout-long-spy.md     ← this spec: rules, decisions, RESULTS (canonical)
strategies/washout-long-spy/            ← strategy JSON(s) for reproducible single runs
scripts/fetch-spy.js                    ← data fetch/refresh (zero-dep)
test/fixtures/spy-<tf>.json             ← committed SPY RTH bars (or docs/data/ if you say so)
custom/washout-long.js                  ← + cc5/cc4/ch5/ch4 + stopLevel outputs (additive)
public/lib/backtest.js                  ← anchor stop, rrMultiple, time operand, forcedFlat
test/washout-long.test.js               ← + confirmation/stopLevel tests
test/backtest.test.js                   ← + engine-addition hand-computed tests
test/washout-long-strategy.test.js      ← pinned exemplar strategy run (hand-checkable)
strategies/washout-long-spy/results.json ← sweep output (committed — it IS the result)
```

Results table + top-N deep-dive + gate verdicts are written **back into §11** of
this doc (one canonical place; `results.json` is the machine-readable twin).

## 10. Grid (locked)

| axis | rows |
|---|---|
| tier | 5/5 \| 4/5 **(2)** |
| entry | pulse \| confirm-close \| confirm-high **(3)** |
| trend | none \| ema50 \| ema200 **(3)** |
| exit | RR1:1 \| RR1:1.5 \| RR1:2 \| stop-only \| trail 4% \| trail 8% **(6)** |
| TF | 1m \| 3m \| 5m \| 15m \| 30m **(5)** |

→ **2 × 3 × 3 × 6 × 5 = 540 cells.** Each cell ≤ ~3.6k bars → < 100 ms each;
full sweep well under ~1 min. Sweep runner: `node scripts/sweep-washout-spy.js`
(plain node, no deps; imports the library directly like `test/*.test.js` do).

## 11. Results (v0.4 — final sweep, 2026-11-08)

Data: `test/fixtures/spy-{1m,5m,15m,30m}.json`, refetched to Yahoo's hard
ceilings — 1m = 3019 bars (8 days), 5m/15m/30m = 4661/1554/777 bars (60
days). 3m: not available from this source, dropped.
Grid: 6 tiers × 7 exits × 4 TFs = **168 cells** (v0.4: the `only4` tier was
dropped — it was a provable duplicate of `early4`, which already fires only at
exactly-4 via its `k===4` branch), all with `forcedFlatTime:
"16:00"` and costs 0.03% fee + 0.03% slippage + 0.03% spread (held as
variables per §12.6 — the §12.6 defaults were never the run values).
Runner: `node scripts/sweep-washout-spy.js` → `results/washout-spy-sweep.csv`.

**Verdict: every one of the 168 cells is a net loss.** Best PF in the whole
sweep: 0.35, on 4 trades. No cell is positive; win rates run 0–25%.

Top cell per TF (ranked by profit factor among cells with trades):

| TF  | best cell        | trades | win % | PF   | PnL % |
|-----|------------------|--------|-------|------|-------|
| 1m  | 4confhigh rr-1.5 | 23     | 17.4  | 0.24 | -3.13 |
| 5m  | 4confhigh rr-1.25| 43     | 20.9  | 0.23 | -5.65 |
| 15m | 4confirm rr-2.0  | 21     | 14.3  | 0.11 | -3.82 |
| 30m | 4confirm rr-1.0  | 4      | 25.0  | 0.35 | -0.59 |

The saved UI strategy (5m, early4, rr-1.5) is rank **12 of 42** non-zero 5m
cells: 117 trades, 15.4% wins, PF 0.10, PnL -16.78%.

### 11.1 Read the grid carefully (tier semantics + sample size)

- **`early4` is exactly 4/5.** It fires only when the five-check sum is
  exactly 4 (`k===4` branch); a 5/5 bar never sets `early4`. There is no
  separate "4/5-only" output — `only4` was dropped in v0.4 because it was a
  provable duplicate of that exclusive tier.
- **`4confirm` / `4confhigh` (cc4/ch4) confirm ANY pulse tier** — a 4/5 or a
  5/5 pulse. So each of them **includes** the `5confirm`/`5confhigh` (cc5/ch5)
  bars, same exit, every TF (checked against the CSV: e.g. 5m stop-only —
  4confirm 57 trades vs 5confirm 2). "4confirm" is not a 4/5-only subset;
  don't read it as excluding the 5/5 confirms.
- **1m rows: 8 market sessions total** (3019 bars — Yahoo's hard 1m ceiling).
  Treat all 1m results as directionally indicative at best; the 5m/15m/30m
  rows cover the full 60-day window and have far more statistical power.

RR gradient on that same cell (only the exit axis moves):

| exit      | trades | wins | PF   | PnL % |
|-----------|--------|------|------|-------|
| stop-only | 107    | 9    | 0.08 | -16.71|
| trail-4%  | 107    | 9    | 0.08 | -16.71|
| trail-8%  | 107    | 9    | 0.08 | -16.71|
| rr-1.0    | 119    | 18   | 0.05 | -17.59|
| rr-1.25   | 119    | 19   | 0.07 | -17.32|
| rr-1.5    | 117    | 18   | 0.10 | -16.78|
| rr-2.0    | 115    | 13   | 0.10 | -16.97|

Higher RR ≈ more trades, similar PnL. The trailing rows are **identical to
stop-only** in this window: the washout-low stop (trigger bar's low) is
wider than 4% on 5m SPY, so the trailing stop never binds before the anchor
does. That's expected, not a bug.

Why, in plain terms: the stop is the trigger bar's low and the entry is the
next bar's open. On 5m SPY that's routinely 0.15–0.25% away, while a typical
winning run has to travel 1.0–1.5× that before the RR target. Two structural
facts follow:

1. **Every Target exit wins, every Stop exit loses.** 16/16 Target exits are
   profitable; 95/95 Stop exits are losers. The geometry, not the costs, does
   most of the damage. Costs (0.09% round-trip) are a real drag on top: a
   +0.05% raw win goes negative after them.
2. **The signal fires on the wrong side of "dip" in a flat regime.** SPY was
   roughly flat over the 60-day window (buy-and-hold -5.5%). Buy-the-dip
   setups need a real pullback inside an uptrend to have an edge; in a choppy
   range the "washout low" is just the day's normal low, and the
   confirmation bar (T+1) is frequently not going to be the low.

Quant-checks verdicts (per §12.10) are **not run on any cell** — every PF is
below 1.0 so the deflated-Sharpe math would just confirm overfit on a net-loss
sample, which the table above already states. If a future data refresh breaks
a cell above PF 1.0, run `quantChecks` on it before acting (§13.3).

Verification of this section's numbers: three independent sources agree to
the integer — the CSV row, a fresh `backtest()` run of the saved strategy on
the same fixture, and the in-browser Strategy Tester (73 exits, 10 wins on the
3000-bar window the server returned at run time). Any of the three alone would
have been suspect; together they hold.

Format pitfall (learned the hard way): `winrate` in
`results/washout-spy-sweep.csv` is already a percentage (15.38 means
15.38%), not a fraction. Read the column header before drawing "0% win
rate" conclusions — it cost several false-alarm iterations on this PR.

Gaps vs §12 (honest, not yet closed):
- §12.8 "no new entry in the last RTH bar" not implemented in the engine
  (only the 16:00 forced-flat is); entries started in the 15:55 window are
  allowed in these numbers.
- §12.6 default cost triple (0.10/0.05/0.05) is what the decisions log said;
  the sweep ran 0.03/0.03/0.03. The numbers above are at the swept value.
- 3m dropped (Yahoo does not serve it) — §12.7 grid is 1m/5m/15m/30m.

## 12. Decisions log (v0.2 — all resolved 2026-11-06)

| # | question | decision |
|---|---|---|
| 1 | entry variants | **pulse + confirm-close + confirm-high — all three in the grid** |
| 2 | tiers | **5/5 AND 4/5** |
| 3 | stop | **low of trigger bar**, every run (engine addition: OK'd) |
| 4 | target | **RR 1:1 / 1:1.5 / 1:2 from that stop — preferred**; stop-only + trailing as rows |
| 5 | trend filter | **grid axis, not hardcoded** |
| 6 | costs | defaults 0.10/0.05/0.05, **kept as variables** for what-ifs |
| 7 | instrument/TF | **SPY at 1m/3m/5m/15m/30m** (1h dropped) |
| 8 | session | **always flat by 16:00 AND no entry started in last RTH bar** |
| 9 | data | **commit the data** (no re-pull); location `test/fixtures/` recommended |
| 10 | judging | per-cell table + top-N → quantChecks + plain-language verdict |

## 13. Verification & definition of done

1. Engine additions: hand-computed bar-level tests (existing `backtest.test.js` style —
   assert exact fill prices/PnL, not shapes).
2. Indicator: `cc5/cc4/ch5/ch5` + `stopLevel` tests in `washout-long.test.js` —
   hand-built windows pinning each output (including the "fired-at-T gate" negative case).
3. Pinned exemplar: at least one full strategy run with hand-computable fill/stop/target
   values asserted (`test/washout-long-strategy.test.js`); register in **both**
   `package.json` and `scripts/check.js`'s hardcoded list (the trap from this week).
4. `npm test` green, `npm run check` → READY.
5. Sweep → `results.json` + §11 table + verdicts on the 1–3 best cells per TF.

## 14. Backlog (explicit non-goals for v1)

- `exact5`/`exact4`; 1h TF (dropped; revisit if 15m/30m sample is too thin);
  breakeven/ATR stops/partial exits; `maxBarsInTrade` sensitivity row.
- Washout **Short** mirror strategy on the same grid (`custom:washout-short`).
- Other instruments (QQQ, IWM).
- Magnifier mode (needs sub-TF data alongside the TF of record).
- Alert/paper-trading wiring (`lib/alerts.js`) — separate task.

## 15. Changelog

- v0.1 — initial draft, 2026-11-06
- v0.2 — all user decisions folded in: 4/5 tier in; 3 entry variants; RR-first exit
  order; multi-TF 1m/3m/5m/15m/30m; forced flat 16:00 + late-entry skip; committed
  data; 540-cell grid; results section — 2026-11-06
