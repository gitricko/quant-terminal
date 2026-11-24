# IVB 5min ORB break/confirm on QQQ / TQQQ / SQQQ — strategy spec (v2, swept 2026-11-24)

Status: **built, swept on ~3 years, and left OPEN** (captain, 2026-11-24: the model is not
parked; this PR is the record of the research and the next step is to keep building on it).
The long-only ORB break-and-confirm model, exactly as marked by `custom/ivb-5min.js` (merged
in PR #8), is wired into the strategy tester and backtested on QQQ, TQQQ and SQQQ at 5m with
costs. **The numbers are the tester's own numbers — no hand adjustments.**

What changed from v1, and why every number below differs from v1's:

1. **Data depth.** v1's "~300 sessions" was a *ceiling*, not a sample: the app clamped candle
   requests at 20,000 bars and Alpaca paging stopped at 12 pages, so ~1 year of 5m bars was
   all any chart or backtest could ever see. This PR removes both
   (`lib/providers.js` clamps at `QT_MAX_BARS`, default 60000; `lib/feeds.js` derives its page
   bound from the request; `public/js/app.js` raises the settings cap to 60000). On the full
   available Alpaca IEX sample the sweep is **60000 5m bars / ~774–780 sessions / ~3 years**
   per symbol, and everything here is re-baselined on that.
2. **RR as a research axis.** v1 swept only the model's plain 1:1. The re-baseline also sweeps
   RR 1.5 / 2 / 3 (the committed RR3 variant is `strategies/ivb-5min-rr3.json`) across three
   cost models, because on a wider sample the 1:1's edge is thin and the question "is the edge
   real, or is 1:1 just the wrong reward/risk?" is unavoidable.
3. **Honest cost columns.** v1 ran one cost model (the conservative ETF triple). v2 runs three
   and states which is which: **zero** (gross, shows the model's raw signal), **live** (the
   captain's near-free retail model), and **old** (v1's conservative ETF triple, kept for
   continuity). The honest verdict depends on the model, so both are printed.
4. **Time split.** Splitting the sample at a fixed calendar date (2025-11-05, ~264 sessions on
   each side) shows the edge is **not flat**: it is concentrated in the recent bull regime.
   See §6.

`results/ivb-or-break-backtest.csv` is the committed sweep (111 rows: headline, per-year,
per-quarter, RR × cost grid, time-split). This doc is the human record. Every number in it is
reproducible from what the repo ships — see §10.

## 1. The model (what is being tested)

From `docs/ivb-5min.md`, unchanged from v1:

- **OR**: the high/low of every 5m bar whose ET clock sits in 09:30–10:00 (default window).
- **Break (B)**: first post-window bar that *closes* above OR_high. A wick-only pierce is not a break.
- **Confirmation (C = B+1)**: live only if it *closes* above B's whole high. **Entry = C's close.**
- **R = C's full high−low range.** **Stop = entry − R. Target = entry + R (plain 1:1).**
- **One trade per day**: a failed confirmation re-arms on the next fresh break; a completed
  trade (stopped, targeted, or carried to the close) makes the symbol done for the day.
- **Flat by the session close** (the model's 16:00 ET rule — see §8 for how the tester honours it).

Long-only. One symbol at a time. No re-entry after the trade.

## 2. The strategy JSON (loads as-is into the tester's "Edit as JSON")

Committed copy: `strategies/ivb-5min.json`. The RR3 research variant is
`strategies/ivb-5min-rr3.json` — identical except `rrMultiple: 3`.

```json
{
  "name": "IVB 5min ORB break/confirm",
  "indicators": { "ivb": { "id": "custom:ivb-5min", "params": {} } },
  "entryLong": [{ "left": "ivb.signal", "op": ">", "right": 0 }],
  "exitLong": [],
  "exitMatch": "all",
  "stopLoss": { "indicator": "ivb", "output": "stop", "refBar": "prior" },
  "rrMultiple": 1,
  "initialCapital": 10000,
  "positionPct": 100,
  "feePct": 0.03,
  "slippagePct": 0.03,
  "spreadPct": 0.01,
  "intrabar": "worst"
}
```

- **entry** — the single rule `ivb.signal > 0`. The indicator's 0/1 confirmation pulse is the
  whole state machine: one-trade-per-day, re-arm on failed confirmation, and the
  done-for-the-day grey-out are all baked into `signal` (see `calc()` in `custom/ivb-5min.js`).
  The engine therefore fills at the confirmation bar's *next open* — the model's entry,
  executed. Verified against the indicator's own outputs on the swept sample before the run was
  trusted (§9): all 375/359/287 tester entries sit on a signal bar's next open and nowhere else.
- **stop** — the engine's **anchor stop** reads the indicator's `stop` series with
  `refBar: "prior"`: at the fill bar (C+1) the engine looks one bar back, i.e. at the
  confirmation bar, where `stop = C.close − R` is exactly the model's stop. **`rrMultiple: 1`**
  makes the target `entry + (entry − stop)`.
- **Costs** — three models, identical JSON except the three cost fields:

  | model | `feePct` | `slippagePct` | `spreadPct` | what it represents |
  |-------|---------:|--------------:|------------:|--------------------|
  | `zero` | 0 | 0 | 0 | gross: the model's raw signal, no execution at all |
  | `live` | 0 | 0.01 | 0.005 | the captain's near-free retail execution: no commission, 0.01% slippage + 0.005% half-spread a side (limit entry at the confirm close ≈ 0 cost) |
  | `old`  | 0.03 | 0.03 | 0.01 | v1's conservative ETF triple, kept for continuity |

  All per side, per round trip entered plus exited. No `stopLossPct`/`takeProfitPct` — the anchor
  stop owns both levels.
- **Intrabar** — `intrabar: "worst"`, the engine's pessimistic default: when a bar touches both
  the stop and the target, the **stop books first** (the model's look-ahead rule). The engine
  reports this back as `fills: "Stop first when a bar touches both"`.

## 3. Data provenance

- **Source**: this repo's own `/api/candles` endpoint, Alpaca (IEX feed), split-adjusted,
  RTH-only. The Alpaca key lives in the operational copy's `data/feeds.json` (gitignored, never
  committed); the server was started with `QT_DATA_DIR` pointed at a scratch dir holding a copy
  of that `feeds.json`, so the key was read at runtime and never entered the worktree.
- **Per-symbol request**: `GET /api/candles?symbol={QQQ|TQQQ|SQQQ}&tf=5m&limit=60000`
  (accepted only after the depth fix in this PR).
- **Resulting window, per symbol** (all three end at the same last session):

  | symbol | bars | sessions | first session | last session |
  |--------|-----:|---------:|---------------|--------------|
  | QQQ  | 60000 | 774 | 2023-10-23 | 2026-11-23 |
  | TQQQ | 60000 | 777 | 2023-10-18 | 2026-11-23 |
  | SQQQ | 60000 | 780 | 2023-10-13 | 2026-11-23 |

  The first session of each is a partial fetch window (paging walks backwards from the last bar,
  so the oldest page is clipped mid-session); the clock-based OR handles it and it is included.
  The bar series are committed verbatim as `test/fixtures/{qqq,tqqq,sqqq}-5m-60000.json`
  (flat `[time, open, high, low, close]` rows, ~6.6MB total) — that is the sweep's provenance.
- **Sweep date**: 2026-11-24 (live `/api/backtest` runs, artifact timestamps 12:29–12:39 UTC;
  the last session inside the bars is 2026-11-23 ET).
- **Backtest call**: `POST /api/backtest` with `{symbol, tf: "5m", limit: 60000, strategy}`,
  one request per symbol × RR × cost model: 3 symbols × 4 RR × 3 cost models = 36 headline runs,
  plus the per-symbol time splits.

## 4. Headline — the model as specified (RR1, all three cost models)

Trades per session is the sanity line: the model is at most one a day and usually zero, so
0.3–0.5 trades/session is healthy, and anything near 0 or above 1 would be degenerate.

| symbol | sessions | trades | /session | win % | net % `zero` | net % `live` | net % `old` | profit factor | max DD % | buy-and-hold % |
|--------|---------:|-------:|---------:|------:|-------------:|-------------:|------------:|--------------:|---------:|---------------:|
| **QQQ**  | 774 | 375 | 0.484 | 47.2 | **+2.97** | **−4.98** | **−37.73** | 1.11 | 3.99 | **+82.62** |
| **TQQQ** | 777 | 359 | 0.462 | 45.96 | **+6.86** | **−4.55** | **−31.54** | 1.09 | 17.68 | **+160.28** |
| **SQQQ** | 780 | 287 | 0.368 | 43.9 | **+0.44** | **−5.56** | **−27.56** | 1.01 | 16.09 | **−90.48** |

(Sharpe, annualised: QQQ 0.37, TQQQ 0.32, SQQQ 0.06. Exit mix at RR1 zero-cost: QQQ 198 stop /
177 target, TQQQ 194/165, SQQQ 161/126 — the rest are the §8 held trades.)

Read: at **zero cost the model is a small net winner on QQQ and TQQQ and a coin-flip on
SQQQ**; under the **`live` retail cost model all three go net negative**; under the **`old`
conservative-ETF triple all three are heavily negative**. Against buy-and-hold over the same
three years, the strategy is not close: QQQ +82.6%, TQQQ +160.3% (a 3×-levered bull), and even
SQQQ's −90.5% is a *different* risk profile, not a comparable one. **The model's edge is thin
and cost-sensitive — that is the honest v2 headline.**

Per-year (RR1, zero cost; `avg_trade_pct` is the arithmetic mean per trade, `net %` needs the
full run, so per-year net% lives in the CSV's split rows):

| symbol | 2023 (partial) | 2024 | 2025 | 2026 |
|--------|----------------|------|------|------|
| QQQ  | 24 tr, 41.7% win, avg −0.042% | 123 tr, 41.5%, avg +0.016% | 126 tr, 50.0%, avg −0.005% | 102 tr, 52.0%, avg +0.027% |
| TQQQ | 20 tr, 40.0%, avg −0.121% | 113 tr, 48.7%, avg +0.064% | 130 tr, 40.8%, avg −0.073% | 96 tr, 51.0%, avg +0.132% |
| SQQQ | 18 tr, 55.6%, avg +0.062% | 93 tr, 43.0%, avg +0.049% | 97 tr, 42.3%, avg −0.079% | 79 tr, 44.3%, avg +0.041% |

Per-quarter rows for all three symbols are in the CSV (`2023Q4`…`2026Q4`) — useful for spotting
that the win rate itself is roughly flat at ~45% while the *size* of the winners moves with the
regime.

## 5. RR sweep — is 1:1 the wrong R:R, or is the edge thin?

Same bars, same entry, only `rrMultiple` (and therefore the target, since the anchor stop is
fixed). `net profit %`:

| symbol | RR | trades | win % | `zero` | `live` | `old` | max DD % (`zero`) |
|--------|----|-------:|------:|-------:|-------:|------:|------------------:|
| QQQ  | 1 (the model) | 375 | 47.2 | +2.97 | −4.98 | −37.73 | 3.99 |
| QQQ  | 1.5 | 367 | 39.24 | +6.81 | −4.59 | −36.86 | 3.45 |
| QQQ  | 2 | 357 | 30.81 | +1.62 | −8.55 | −38.58 | 7.18 |
| QQQ  | 3 | 352 | 21.88 | +8.09 | +0.41 | −32.15 | 5.51 |
| TQQQ | 1 | 359 | 45.96 | +6.86 | −4.55 | −31.54 | 17.68 |
| TQQQ | 1.5 | 345 | 39.42 | +11.87 | −5.35 | −35.83 | 19.71 |
| TQQQ | 2 | 343 | 31.78 | +9.73 | −2.45 | −31.05 | 19.46 |
| TQQQ | 3 | 335 | 24.18 | **+33.64** | **+23.01** | −14.63 | 13.95 |
| SQQQ | 1 | 287 | 43.9 | +0.44 | −5.56 | −27.56 | 16.09 |
| SQQQ | 1.5 | 286 | 37.41 | +14.04 | +5.27 | −18.37 | 15.01 |
| SQQQ | 2 | 286 | 32.52 | +5.41 | −0.11 | −22.62 | 21.88 |
| SQQQ | 3 | 286 | 28.32 | **+37.97** | **+31.36** | −3.75 | 17.6 |

Read: **wider targets do better than 1:1 — monotonically for the leveraged pair.** TQQQ RR3 is
+33.6% zero-cost and **still +23.0% after the `live` cost model** (SQQQ RR3 is similar, +31.4%),
because the confirmation bar's range is a wide stop on leveraged ETFs and the 1:1 gives back
nearly all of it — the win rate falls from ~46% to ~24% by construction while each winner is 3R.
Under the `old` conservative-ETF triple even RR3 is negative on QQQ (−32%) and only marginally
positive on SQQQ (−3.75%), so the RR finding is *inside the live-cost regime*, not a claim that
costs don't matter. RR3 is shipped as `strategies/ivb-5min-rr3.json` and pinned in
`test/ivb-sweep-pinned.test.js` precisely so this axis can be re-cut when the cost model is
settled. **The model's own 1:1 remains the reference the doc reports against; the RR column is
the open research front (§11), not a promoted variant.**

## 6. Time split — the edge is concentrated in the recent regime

Fixed calendar boundary at **2025-11-05** (not "the Nth session": the three symbols' first
sessions differ, so a fixed date is the comparable split). Each half is a **separate engine
run on that half's own bars** — compounding restarts at the half's first bar, so `net %` is the
engine's own figure for "this half, traded alone", directly comparable to the headline rows.

| symbol | RR | period | sessions | trades | win % | net % | net % + 0.02% stop-exit slippage |
|--------|----|--------|---------:|-------:|------:|------:|---------------------------------:|
| QQQ  | 1 | first half (2023-10-23→2025-11-04) | 510 | 256 | 44.92 | +1.56 | −1.26 |
| QQQ  | 1 | second half (2025-11-05→2026-11-23) | 264 | 119 | 52.10 | +3.68 | +0.24 |
| TQQQ | 1 | first half | 513 | 244 | 44.26 | −0.57 | −3.25 |
| TQQQ | 1 | second half | 264 | 115 | 49.57 | **+7.47** | **+6.22** |
| SQQQ | 1 | first half | 516 | 194 | 42.27 | −6.05 | −8.14 |
| SQQQ | 1 | second half | 264 | 93 | 47.31 | **+6.90** | **+5.86** |
| QQQ  | 3 | first half | 510 | 240 | 21.25 | −1.31 | −4.97 |
| QQQ  | 3 | second half | 264 | 112 | 23.21 | +9.53 | +7.65 |
| TQQQ | 3 | first half | 513 | 228 | 25.44 | +6.96 | +3.37 |
| TQQQ | 3 | second half | 264 | 107 | 21.50 | **+24.95** | **+22.86** |
| SQQQ | 3 | first half | 516 | 193 | 24.87 | +0.59 | −2.29 |
| SQQQ | 3 | second half | 264 | 93 | 35.48 | **+38.27** | **+36.61** |

`+ 0.02% stop-exit slippage` is the captain's "the only real execution cost is stop-exit
slippage" model: the losses carry the drag, the wins do not. It is a hand adjustment to the
trade list (the engine's cost fields are symmetric), labelled as such in the CSV's `cost_model`
column so it can never be read as an engine cost setting.

**Finding: the v1 ~1-year window was entirely inside the good regime.** The first ~2 years are
at or below breakeven on all three symbols at RR1 (QQQ +1.6% over 510 sessions, TQQQ −0.6%,
SQQQ −6.1%, and *negative* once a haircut is put on stop exits); only the recent ~264 sessions
— the 2026 bull — carry the v1-reported numbers and the re-baseline's best rows. A regime
filter is therefore the first open front (§11), not an optional refinement.

## 7. Quant checks — the strategy fails its own quality gates

The app's own `quantChecks()` (walk-forward, Monte Carlo, deflated Sharpe, overfitting, cost
stress) run on the best-looking configuration, **TQQQ RR3** (the strongest zero-cost and
live-cost row in §5), 2000 Monte Carlo runs:

- **Deflated Sharpe: 0.864 — FAIL** (the bar is above 0.95: the probability the edge is real
  after the versions tried). It is not a statistical fluke in the classic sense, but it is not
  significant either.
- **Cost stress: −0.83% with double fees and 0.05% slippage a side — FAIL** (needs above 0).
  The RR3 row survives the `live` model at +23.0% but not a *doubled* live model.
- **Monte Carlo (2000 runs, trade resampling)**: p5 **−20.5%**, p50 **+30.2%**, p95 **+147.4%**;
  drawdown p50 18.6%, **p95 33.4%**; probability of a losing run **20.3%**. The distribution is
  right-skewed and fat-tailed: the median is fine, the tail is a 1-in-5 chance of a loss and a
  1-in-20 chance of −20% or worse.
- Same gates on TQQQ RR1.5 are worse: deflated Sharpe 0.723 FAIL, cost stress **−29.78%** FAIL,
  MC p5 −18.9% / p50 +10.8% / p95 +60.8%, loss probability 30.9%.

Both gates fail on the model's best variant. Stated plainly, per the captain's framing: the
research is not being stopped — this is what the artifact says, and the next step is to build
on it (§11).

## 8. The model's time-stop boundary (stated limitation, no engine feature added)

The model says **flat by 16:00 ET**; if neither level has printed, the trade is closed at the
close (`Flat (close)` marker in the indicator). **The tester's anchor-stop model only exits on
stop/target — it has no time stop, and none was added this pass.** What that costs on the
re-baselined sample (CSV columns `open_at_session_close`, `…_pnl_as_run`, `…_pnl_forced`):

| symbol | trades still open at session close | % of trades | as-run P&L | forced-close P&L | the time stop would have… |
|--------|-----------------------------------:|------------:|-----------:|-----------------:|---------------------------|
| QQQ  | 11 of 375 | 2.9% | **+185.87** | −81.47 | cost ~267 dollars: the held trades were the ones paying for the account |
| TQQQ | 8 of 359 | 2.2% | **+1095.88** | −50.07 | cost ~1146 dollars: mostly one big April gap-through target |
| SQQQ | 4 of 287 | 1.4% | **+303.27** | −99.16 | cost ~402 dollars |

- **On the headline numbers the time stop matters a lot**: strip every trade that closed on a
  later session than it opened and the strategy is net **negative** at both RR multiples on all
  three symbols — the same-day book alone is QQQ +1.01%, TQQQ −4.58%, SQQQ −2.17% at RR1, and
  the overnight holds are QQQ +1.94%, TQQQ +11.98%, SQQQ +2.67% of that (pinned in
  `test/ivb-sweep-pinned.test.js` `held-overnight`). So "the model says flat by 16:00" is
  **not** a small correction — the model and the engine's held-overnight behaviour are two
  different strategies on this data.
- But note *which* trades those are. Two shapes:
  **(a) resolve at the next session's open** — most of them (6 of QQQ's 11, 5 of TQQQ's 8,
  2 of SQQQ's 4, `bars` 1–13): neither level printed inside the session and the next morning's
  first bar gaps to one side, so the exit books at the open rather than at a level the model
  would have reached. That is the `test/ivb-5min-backtest.test.js` 2025-11-28 half-day case's
  mechanic; roughly half go each way (QQQ 4 target / 2 stop, TQQQ 2/3, SQQQ 2/0), so the
  as-run coin is closer to fair than the totals suggest — but it is still a coin the model never
  offered to flip.
  **(b) multi-week holds** — QQQ 2024-02-22→03-01 (503 bars, +2.18%), QQQ 2025-08-22→08-25
  (70 bars, −0.40%), QQQ 2026-04-08→**04-15** (394 bars, **+3.49% / +347 dollars**), TQQQ
  2024-02-22→03-01 (505 bars, +6.38%), TQQQ 2025-08-22→08-25 (70 bars, −1.17%), TQQQ
  2026-04-08→**04-15** (389 bars, **+10.06% / +922 dollars**), SQQQ 2024-02-12→02-13
  (20 bars, +5.22%). **The TQQQ April pair is the single largest contributor to every positive
  TQQQ number in this doc** — 922 dollars of a 1095.88-dollar as-run total. Remove the April
  hold and TQQQ's RR1 zero-cost result is **−2.91%**, i.e. all of TQQQ's edge is two multi-week
  gap-throughs in one regime. The same is true of each symbol's single best trade: drop QQQ's
  April hold (+347.18) and QQQ is **−0.50%**; drop SQQQ's Feb-2024 20-bar hold (+521.52) and
  SQQQ is **−4.54%**. **Every one of the three headline positive numbers is one trade deep.**
- Neither is "the model"; both are reported. The forced-close column exists so the captain can
  read the honest range, and it is the harsher of the two readings in every case.
- Two further column meanings: `fills_on_session_last_bar` (QQQ 2, TQQQ 3, SQQQ 2) counts
  entries the engine took on the session's **last bar** — the model, which needs a
  confirmation bar *and* an execution bar after the break, would not have taken these either.

Because the time stop would have *reduced* the reported result in every case, it is reported
here rather than implemented. No engine feature was added for it this pass; it is open front
§11-i.

## 9. Verification (visual audit, as the model's spec requires)

Before these numbers were trusted, the tester's RR1 zero-cost trade list was checked against
the indicator's own `Break`/`Entry` markers and stop/1R lines over the **whole swept sample**
(774/777/780 sessions × 3 symbols) — done through the app's own `compute()` on the same
committed bars the tester ran on, which is the same data a chart view of the indicator draws:

- **Every tester entry sits on a signal bar's next open, and every signal bar's next open IS a
  tester entry, except where a held trade was still occupying the single position**:
  QQQ 375/379 `Entry` markers filled, TQQQ 359/363, SQQQ 287/287. The eight unfilled markers
  (QQQ 2024-02-22 12:20, 2024-02-28 13:35, 2024-03-01 10:10, 2026-04-13 10:55; TQQQ
  2024-02-22 12:25, 2024-03-01 10:10, 2026-04-09 11:45, 2026-04-13 10:55) are all the §8
  boundary — a position opened the previous session and held past its close was still open at
  the fill bar. The single-position tester refused the entry; the model would have been flat
  and taken it. **No marker mismatch.**
- **Every Break marker resolves inside the session** except when the break lands on the
  session's **last bar** (QQQ 4, TQQQ 3, SQQQ 6 such sessions: 2024-08-30, 2024-09-30,
  2025-05-07, 2025-11-07 / 2023-11-16, 2024-05-28, 2024-08-30 / 2024-05-16, 2025-12-30,
  2026-07-01, 2026-08-25, 2026-09-30, 2026-11-13). The confirmation bar would be the next
  day's first bar; the state machine correctly resets at the boundary, so no marker and no
  trade. That is the model's day-flat rule, not a mismatch.
- **The stop the engine booked is exactly the indicator's `stop` series at the confirmation
  bar** (375/375, 359/359, 287/287 trades: `stop[i] == close[i] − (high[i] − low[i])` at the
  signal bar, to 1e-9). `refBar: "prior"` is reading the right series at the right bar.
- **Discrepancy found, reported not reconciled** (the v1 finding, still standing): the engine's
  **target** is built off the *actual* entry fill (`fill + (fill − anchor)`), while the
  indicator's `target` line is off the confirmation bar's *close* (`close + R`). They coincide
  when the fill open equals the confirmation close; on this data the fill open is within a few
  cents of that close most of the time, so the engine's 1:1 is a **bounded drift from the
  model's 1:1 — at most 2× the fill-bar close-to-open gap** — not a different model. The stop
  side, which is the level that matters for "did the tester trade the model's stop", is exact.
  On RR > 1 the drift compounds with the multiple, which is one more reason the RR rows in §5
  are labelled *engine-1:1*, not *model-RR3*.

Hand-picked spot checks (indicator vs tester trade list) on the re-baselined sample:

- **QQQ** — 2023-11-01 10:05 fill (trade 0: entry 359.18, stop 356.69, `Stop` exit 8 bars
  later), 2026-04-13 (the marker the held 04-08 position blocked, per §8), 2024-03-01 (same).
- **TQQQ** — 2025-12-11 (suppressed second same-day break at 14:00 produced no tester entry),
  2025-12-24 early close, 2026-04-08→04-15 gap-through target (the held trade that dominates
  the §8 table).
- **SQQQ** — 2025-12-30/31, 2026-07-01, 2026-08-24 session-boundary breaks (all correctly
  produce no trade), plus the 2026Q4 stretch (13 trades, 53.8% win) that carries the RR3 row.

## 10. Run instructions

1. **Reproduce the offline sweep** (no keys, no network — this is the provenance proof):
   ```
   node scripts/sweep-ivb-3year.js            # regenerate results/ivb-or-break-backtest.csv
   node scripts/sweep-ivb-3year.js --check    # assert the committed CSV is byte-identical
   ```
   The `--check` mode re-derives all 111 rows from the committed fixtures and the committed
   engine and diffs against the committed CSV; it is the reproducibility contract for this doc.
   (Runs ~30s; it loads one symbol's 60000 bars at a time.)
2. **Reproduce the live sweep** (needs the Alpaca key): point `QT_DATA_DIR` at a dir whose
   `feeds.json` holds the key, then
   ```
   PORT=3788 node server.js
   curl -X POST localhost:3788/api/backtest -H 'x-qt: 1' -H 'Content-Type: application/json' \
     -d '{"symbol":"QQQ","tf":"5m","limit":60000,"strategy":'"$(cat strategies/ivb-5min.json)"'}'
   ```
   `limit: 60000` works only with the depth fix in this PR (§3). The response's `stats` block is
   the CSV's headline row; `trades` is the per-trade list.
3. **Run the pinned tests**: `npm test`. Three files cover this strategy:
   - `test/ivb-5min.test.js` — the indicator's state machine.
   - `test/ivb-5min-backtest.test.js` — the hand-derived geometry test on a six-session TQQQ
     fixture: entry fills at the confirmation bar's next open, stop = entry − R, target =
     entry + R, the one-trade-per-day gate holds (a second same-day break does not open a
     second position), and the held half-day trade's gap-through target fill.
   - `test/ivb-sweep-pinned.test.js` — pins the re-baselined sweep numbers themselves (RR1 and
     RR3 headline stats per symbol, both cost models, the time-split trade counts, the
     overnight-hold decomposition, and the quant-check gates) against the engine on the
     committed fixtures, so a change in fill/anchor/RR/cost handling turns the test red instead
     of silently moving the sweep.

## 11. Open fronts (model stays OPEN — captain, 2026-11-24)

In priority order, for whoever picks this up next:

1. **Regime filter.** §6: the edge is a 2026-bull result; 2023–2025 is flat-to-negative at RR1.
   The cheapest honest next step is a regime gate (e.g. only take breaks when the prior session
   or the OR itself is trending, or when the symbol is above its 50-day) evaluated as a
   *separate* engine variant against the same fixtures, with the unfiltered numbers kept beside
   it so the filter has to earn its place.
2. **Live forward tracking.** The swept result is in-sample and leans on a regime that may end.
   The next commitment is a paper/forward track of the model (and the RR3 variant) against
   today's bars, logged trade-for-trade, so out-of-sample data accumulates from the day this
   ships.
3. **RR as a live parameter.** §5: RR3 dominates on this sample at the `live` cost model, but
   both quant gates still fail (§7). Settle the cost model first (a real fill log decides
   `live` vs `old` far better than either can be argued), then re-cut the RR axis.
4. **Time stop.** §8: implement (or explicitly reject) the model's flat-by-16:00 rule and
   reconcile the held-overnight result; the run-time cost of the missing time stop is quantified
   above but deliberately *not* built this pass.
5. **Target drift on RR > 1.** §9: the engine's target is built off the fill, not the
   confirmation close; on RR3 the drift is 3× the RR1 drift. Either pin the anchor for the
   target as well, or accept the drift with a per-trade measurement of its magnitude.

## 12. Files

- `custom/ivb-5min.js` + `docs/ivb-5min.md` — the indicator (PR #8).
- `strategies/ivb-5min.json`, `strategies/ivb-5min-rr3.json` — the loadable strategy JSON
  (RR1, and the RR3 research variant).
- `docs/strategies/ivb-5min-orb.md` — this spec (v2).
- `results/ivb-or-break-backtest.csv` — the committed sweep: headline + per-year + per-quarter
  + RR × cost grid + time-split rows, with the §8 disclosure columns.
- `scripts/sweep-ivb-3year.js` — the provenance script; `--check` re-derives the CSV from the
  committed fixtures.
- `test/fixtures/{qqq,tqqq,sqqq}-5m-60000.json` — the 3-year raw Alpaca IEX bars the sweep ran
  on (committed as the sweep's provenance; ~6.6MB).
- `test/ivb-5min.test.js`, `test/ivb-5min-backtest.test.js`, `test/ivb-sweep-pinned.test.js` —
  the pinned tests.
- `lib/providers.js`, `lib/feeds.js`, `public/js/app.js`, `test/feeds.test.js` — the data-depth
  fix that made a 3-year 5m sweep possible.