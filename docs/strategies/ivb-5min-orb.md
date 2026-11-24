# IVB 5min ORB break/confirm on QQQ / TQQQ / SQQQ — strategy spec (v1, swept 2026-11-24)

Status: **built and swept.** The long-only ORB break-and-confirm model, exactly as marked by
`custom/ivb-5min.js` (merged in PR #8), is wired into the strategy tester and backtested on
QQQ, TQQQ and SQQQ at 5m with costs. The numbers are the tester's own numbers — no hand
adjustments. `results/ivb-or-break-backtest.csv` is the committed sweep; this doc is the
human record.

## 1. The model (what is being tested)

From `docs/ivb-5min.md`, unchanged here:

- **OR**: the high/low of every 5m bar whose ET clock sits in 09:30–10:00 (default window).
- **Break (B)**: first post-window bar that *closes* above OR_high. A wick-only pierce is not a break.
- **Confirmation (C = B+1)**: live only if it *closes* above B's whole high. **Entry = C's close.**
- **R = C's full high−low range.** **Stop = entry − R. Target = entry + R (plain 1:1).**
- **One trade per day**: a failed confirmation re-arms on the next fresh break; a completed
  trade (stopped, targeted, or carried to the close) makes the symbol done for the day.
- **Flat by the session close** (the model's 16:00 ET rule — see §5 for how the tester honours it).

Long-only. One symbol at a time. No re-entry after the trade.

## 2. The strategy JSON (loads as-is into the tester's "Edit as JSON")

Committed copy: `strategies/ivb-5min.json`.

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
  whole state machine: one-trade-per-day, re-arm on failed confirmation, and the done-for-the-day
  grey-out are all baked into `signal` (see `calc()` in `custom/ivb-5min.js`). The engine therefore
  fills at the confirmation bar's *next open* — the model's entry, executed.
- **stop** — the engine's **anchor stop** reads the indicator's `stop` series with
  `refBar: "prior"`: at the fill bar (C+1) the engine looks one bar back, i.e. at the
  confirmation bar, where `stop = C.close − R` is exactly the model's stop. **`rrMultiple: 1`**
  makes the target `entry + (entry − stop)`.
- **Costs** — conservative ETF costs: `feePct 0.03` + `slippagePct 0.03` + `spreadPct 0.01`
  (half-spread) per side. No `stopLossPct`/`takeProfitPct` — the anchor stop owns both levels.
- **Intrabar** — `intrabar: "worst"`, the engine's pessimistic default: when a bar touches both
  the stop and the target, the **stop books first** (the model's look-ahead rule).

## 3. Data provenance

- **Source**: this repo's own `/api/candles` endpoint, Alpaca (IEX feed), split-adjusted, RTH-only.
  The Alpaca key lives in the operational copy's `data/feeds.json` (gitignored, never committed);
  the server was started with `QT_DATA_DIR` pointed at a scratch dir holding a copy of that
  `feeds.json`, so the key was read at runtime and never entered the worktree.
- **Fetch date**: 2026-11-23.
- **Per-symbol request**: `GET /api/candles?symbol={QQQ|TQQQ|SQQQ}&tf=5m&limit=20000`.
- **Resulting window** (all three identical): **2025-11-13 09:30 → 2026-11-23 15:55 ET**,
  **258 sessions**, 20,000 bars. The first session is a partial fetch window (QQQ starts at 15:05,
  TQQQ at 14:10, SQQQ at 09:30) and is included — the clock-based OR handles it.

## 4. Results (read from the committed `results/ivb-or-break-backtest.csv`)

Headline, per symbol (258 sessions, 20,000 bars each):

| symbol | trades | /session | win % | net P&L % | profit factor | max DD % | buy-and-hold % |
|--------|-------:|---------:|------:|----------:|--------------:|---------:|---------------:|
| **QQQ**  | 116 | 0.45 | 35.3 | **−12.47** | 0.40 | 12.78 | **+7.16** |
| **TQQQ** | 111 | 0.43 | 46.9 | **−4.25** | 0.87 | 15.36 | −5.26 |
| **SQQQ** | 88  | 0.34 | 46.6 | **−2.41** | 0.92 | 10.12 | −36.0 |

All three are **net losers after costs** on this window. The trade-count sanity lines:
QQQ 0.45, TQQQ 0.43, SQQQ 0.34 trades/session — well inside the model's "at most one a day,
often zero", and none of them is degenerate (zero trades or >2/day).

Per-year (from the CSV's `Y*` rows):

| symbol | 2025 (partial) | 2026 |
|--------|----------------|------|
| QQQ  | 14 trades, 28.6% win, avg −0.221%/tr | 102 trades, 36.3% win, avg −0.099%/tr |
| TQQQ | 15 trades, 33.3% win, avg −0.451%/tr | 96 trades, 49.0% win, avg +0.032%/tr |
| SQQQ | 9 trades, 77.8% win, avg +0.401%/tr | 79 trades, 43.0% win, avg −0.074%/tr |

Read: on the full 2026 year the TQQQ row is **breakeven-ish (+0.032%/trade avg)** but still
net −4.25% for the year once the partial-2025 drag and the compounding cost load are in. QQQ is
the worst in absolute net terms. The model's edge is not showing in the net-of-costs number on
any of the three symbols over this ~1-year window.

## 5. The model's time-stop boundary (stated limitation, not an engine feature)

The model says **flat by 16:00 ET**; if neither level has printed, the trade is closed at the
close (`Flat (close)` marker in the indicator). **The tester's anchor-stop model only exits on
stop/target — it has no time stop, and none was added this pass.** What that costs:

- The CSV's `open_at_session_close` column counts the trades the engine still held at the
  session's last bar, and `…_pnl_forced` is what closing them at that close would have done.
- **QQQ: 6 such trades** — as-run P&L −19.16, forced-close −100.39 (the time-stop would have
  helped: −81.2). **TQQQ: 4** — as-run +343.51, forced −210.21 (the time-stop would have hurt
  by −553.7, mostly one big April gap-through target). **SQQQ: 0** — its trades all resolved
  inside the session.
- Net effect of imposing the model's 16:00 flat on these numbers: **QQQ ≈ −13.3%**,
  **TQQQ ≈ −9.8%**, **SQQQ unchanged (−2.4%)**. The QQQ verdict is the same either way; the TQQQ
  row is the one the time-stop flips, and the captain should read that as the honest range, not a
  single number. No engine feature was added for this.

## 6. Verification (visual audit, as the model's spec requires)

Before the sweep numbers were trusted, the tester's trade list was checked against the
indicator's own `Break`/`Entry` markers and the stop/1R lines — done through the app's own API
(`compute()` on the same bars the tester ran on), which is the same data a chart view of the
indicator would draw, cross-checked by hand on spot sessions per symbol:

- **QQQ** — 2025-11-21 13:40 fill (trade 0), 2025-11-26, 2026-09-18: tester entries sit on the
  confirmation bar's next open; the engine's stop level is exactly the indicator's `stop` series
  value at the confirmation bar.
- **TQQQ** — 2025-12-11 (suppressed second same-day break at 14:00 produced no tester entry,
  as the `done` marker says), 2025-12-24 early close, 2026-04-08 gap-through target.
- **SQQQ** — 2025-12-30/31, 2026-07-01, 2026-08-24 session-boundary breaks.

Full-session audit (all 258 sessions × 3 symbols, markers vs trade list):

- **Every `Entry` marker produced a tester fill, except one per QQQ and two per TQQQ, all
  blocked by the model's time-stop boundary, not a marker mismatch.** QQQ: 116 of 117
  `Entry` markers filled (2026-04-13 10:55 ET did not — a position opened 2026-04-08 and
  held past its session close, because its target didn't print until 2026-04-15, was still
  open, so the single-position tester refused the 4-13 entry). TQQQ: 111 of 113 — the same
  held 4-08→4-15 trade blocked the 4-09 11:45 and 4-13 10:55 entries. SQQQ: 88/88, no held
  trade at all. These three missed entries are exactly the §5 boundary: the model would have
  been flat by 16:00 each prior session and taken them; the engine held the position
  overnight. None is a state-machine error.
- Every `Break` marker is followed by exactly one confirmation verdict (`Entry` or `No conf`)
  **within the session** — 260/260 (QQQ), 258/258 (TQQQ), 236/241 (SQQQ). The five SQQQ
  exceptions are breaks that land on their session's **last bar** (2025-12-30, 2026-07-01,
  2026-08-25, 2026-09-30, 2026-11-13, all 15:55 ET), where the confirmation bar would be the
  next day's first bar; the state machine correctly resets at the boundary, so no marker and
  no trade. That is the model's day-flat rule, not a mismatch.
- **Every tester entry sits on a signal bar's next open** (116/116, 111/111, 88/88), and
  each entry bar's predecessor has `signal[i-1] === 1`.

**Discrepancy found, reported not reconciled** (this is the finding the audit was meant to
surface): the stop level matches the indicator's `stop` series exactly (that is what
`refBar: "prior"` reads at the fill bar), but the engine's **target** is built off the
*actual* entry fill (`entry + (entry − anchor)`), while the indicator's `target` line is off
the confirmation bar's *close* (`close + R`). They coincide when the fill open equals the
confirmation close; in this data set the fill open is within a few cents of that close most of
the time, so the engine's 1:1 is a **bounded drift from the model's 1:1, not a different
model** — the drift is at most 2× the fill-bar close-to-open gap. The stop side, which is the
level that matters for "did the tester trade the model's stop", is exact.

## 7. Run instructions

1. **Reproduce the sweep**: point `QT_DATA_DIR` at a dir whose `feeds.json` holds the Alpaca
   key, `PORT=3788 node server.js`, then for each symbol:
   ```
   curl -X POST localhost:3788/api/backtest -H 'x-qt: 1' -H 'Content-Type: application/json' \
     -d "{\"symbol\":\"QQQ\",\"tf\":\"5m\",\"limit\":20000,\"strategy\":$(cat strategies/ivb-5min.json)}"
   ```
   The response's `stats` block is the row of the CSV; `trades` is the per-trade list.
2. **Run the pinned test**: `npm test` (or just `node --test test/ivb-5min-backtest.test.js`).
   It loads `test/fixtures/tqqq-5m.json` — six real TQQQ 5m sessions covering a valid day, a
   failed-confirmation day, and an early-close day — and asserts by hand that the entry fills at
   the confirmation bar's next open, the stop is `entry − R`, the target is `entry + R`, and the
   one-trade-per-day gate holds (a second same-day break does not open a second position).

## 8. Files

- `strategies/ivb-5min.json` — the loadable strategy JSON.
- `docs/strategies/ivb-5min-orb.md` — this spec.
- `results/ivb-or-break-backtest.csv` — the committed sweep (headline + per-year + per-quarter
  rows, with the time-stop disclosure columns).
- `test/ivb-5min-backtest.test.js` + `test/fixtures/tqqq-5m.json` — the pinned, deterministic
  test.
