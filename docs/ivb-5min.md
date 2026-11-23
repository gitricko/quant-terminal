# IVB 5min (ORB break/confirm)

The captain's long-only **opening-range-break-and-confirm** model: mark the
first 30 minutes of the regular session, take the first close above that range,
and only after the very next bar confirms above the break bar's whole high.

Long only, one symbol, flat by the session close.

Ported from the captain's Pine version (which stays in the other library) into
this repo's custom-indicator framework. This file is a **signal-marking**
indicator first — it draws the state machine on the chart so the setup can be
audited against the annotated reference charts before any performance number is
trusted. It does not place trades.

> **See also:** `custom/washout-long.js` — the same "hand-built state machine
> with markers" shape, for a pivot-low reversal rather than an ORB break.

## File

`custom/ivb-5min.js`. Indicator id in the app: `custom:ivb-5min`.

## The model

```
Opening range (OR)      every bar whose ET wall clock sits in [orStart, orEnd)
                        (default 09:30–10:00 ET) — time-based, never "bar N of 6"
Break bar (B)           the first post-window bar that CLOSES above OR_high.
                        A bar whose wick pierces OR_high but whose close falls
                        back is NOT a break.
Confirmation bar (C)    the bar right after B. Live only if it closes above
                        B's whole high (wick included). B + 1 is always the
                        confirmation, so a fresh break always takes exactly
                        one bar to judge.
Entry                   C's close.
R (risk)                C's full high-to-low range.
Stop                    entry − R          →  1:1
Target                  entry + R
Failed confirmation     no trade. The symbol stays eligible and re-arms on the
                        next fresh break (C cannot itself be the next break —
                        it closed above OR_high).
Completed trade         entered AND exited (stop, target or session close) →
                        the symbol is DONE FOR THE DAY and the rest of the
                        session is greyed out.
```

Exit resolution runs forward through the session inside the same state
machine: the stop is checked first inside a bar, so a bar that spans both
levels books the loss (pessimistic fill). If neither level prints before the
close, the trade is held to the session close and marked `Flat (close)`.

## Session resolution (the part that is easy to get wrong)

Every time-of-day boundary and the session key itself are resolved in
**America/New_York**, keyed off the ET **calendar date** — the same
`Intl.DateTimeFormat` pattern `public/lib/backtest.js` uses for its time rules
(`timeRuleValue`). Not the UTC date, and never a bar offset:

- 09:30 ET is 13:30Z under EDT and 14:30Z under EST. A UTC-day or
  UTC-wall-clock key picks up the wrong six bars on half the sessions — the
  SPY 5m fixture in `test/fixtures/spy-5m.json` crosses the November DST
  change, and `test/ivb-5min.test.js` asserts against the DST-affected days.
- The OR window is **time-based**, so a partial session that starts late still
  forms its OR from the clock, and an early-close session (2026-11-05 is a
  59-bar day) is handled identically to a full one.
- No look-ahead: the OR levels are drawn from the first post-window bar
  onward, not back-filled across the window itself. At 09:30 the six-bar max
  is not knowable yet.

## Inputs

| Key | Default | Notes |
|---|---|---|
| `orStart` | `09:30` | OR window start, ET wall clock. One of `OR_MARKS`, 09:00–12:00 in 5-minute steps |
| `orEnd` | `10:00` | OR window end, ET wall clock. Same list |
| `source` | `close` | entry source (`close`, `open`, `high`, `low`, `hl2`, …) |

The window boundaries are `select` inputs on purpose: a number field would
invite someone to type `630` for 10:30.

## Outputs (alert-facing)

| Key | Meaning | Where it is set |
|---|---|---|
| `orHigh` / `orLow` | the opening range, drawn from the window's completion | one value per bar from the first post-window bar to the session close |
| `entry` | the confirmation bar's close | from the entry bar through the exit bar |
| `stop` | `entry − R` | same span as `entry` |
| `target` | `entry + R` | same span as `entry` |
| `signal` | `1` on the confirmation bar, `0` elsewhere | alert on `signal > 0` |
| `done` | `1` on every bar after a completed trade | alert on `done > 0` for "flat" |

`orHigh`/`orLow`/`entry`/`stop`/`target` are `NaN` where there is no value;
`signal` and `done` are per-bar flags (`0`, not `NaN`) so the alert editor's
`> 0` form works unchanged.

## Markers on the chart

| Text | Shape / position | Color | Meaning |
|---|---|---|---|
| `OR` | circle, aboveBar | grey `#9e9e9e` | the opening range is complete |
| `Break` | arrowUp, belowBar | orange `#ff9800` | fresh close above OR_high |
| `Entry` | arrowUp, belowBar | green `#26a69a` | valid confirmation — the entry |
| `No conf` | circle, aboveBar | red `#f23645` | failed confirmation; re-arms |
| `Flat SL` / `Flat TP` | square, aboveBar | grey `#9e9e9e` | stopped out / target hit |
| `Flat (close)` | square, aboveBar | grey `#9e9e9e` | neither level printed — held to the close |

## Deviations from the Pine original

- **No Pine constructs survive**: `session`, `time`, `ta.*` equivalents, the
  `varip` state, and the marker labels are all hand-written JS here. The
  state machine is one pass over each session's bars.
- **No `ta` dependencies**: the indicator uses only `ta.source` (for the
  configurable entry price); everything else is plain math, so it also runs
  in the browser with no imports inside `calc`.
- **`noAutoscale: true`** (see `chart.js:637`) — `signal` and `done` are 0/1
  per bar and the OR levels are pre-market scale-free, so their baselines
  would otherwise drag the price y-axis. Same reason `custom/washout-long.js`
  sets it.
- **Marker palette is JS hex, not Pine color constants** — see the table
  above.
- **No alertcondition** — alerts read outputs (see the table).

## Verification (ran 2026-11-23)

- `node --test test/ivb-5min.test.js` — 16/16 pass
- `npm test` — all suites pass (test wired into the `test` script in
  `package.json` and into `scripts/check.js`)
- `npm run check` — READY
- Covered by the test suite:
  - the indicator matches an independent naive re-implementation (a
    per-session event table) bar-for-bar over all 60 SPY 5m sessions.
  - OR computed from the ET window on a DST-affected day (2026-11-04) and on
    the 59-bar early-close day (2026-11-05).
  - a synthetic session with the first bars stripped, where a positional
    "first 6 bars" OR provably differs from the clock-based one.
  - a fresh break fires `signal`; a wick-only cross does not.
  - a failed confirmation re-arms on the next fresh break.
  - a completed trade greys out the rest of the session (`done = 1`, levels
    cleared).
  - a hand-built mini-session with by-hand OR, entry, R, stop and target.
  - the configurable window (`orEnd = 09:45`, `orStart = 09:40`) and the
    inert reversed-window case.

## How to extend

- **A different R definition** (e.g. ATR-based risk): replace the `R` line in
  the confirmation branch of `calc()`.
- **Both-levels-armed exits**: the forward exit scan already checks the stop
  first inside a bar; a "whichever is hit first, same bar" rule is one extra
  comparison.
- **A grey-out that still allows re-entry** (spec §7 variant): drop the
  `state = "done"` after the trade and keep `state = "scan"`.
- **Extra output (e.g. `orRange`)**: add an `outputs[]` entry + a new array,
  write into it where the OR is computed, include it in the `return`.

## Related

- `docs/custom-indicators.md` — full contract for inputs, outputs, markers,
  alert wiring.
- `custom/washout-long.js` + `docs/washout-long.md` — the same shape, a
  pivot-low reversal instead of an ORB break.
- `test/fixtures/spy-5m.json` — 4,661 SPY 5m bars, 60 sessions, crossing the
  November DST change and the 2026-11-05 early close.