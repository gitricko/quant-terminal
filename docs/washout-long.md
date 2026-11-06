# Washout Long

A pivot-low reversal detector: fires on bars where price prints a fresh low
but the **selling side is exhausted** — the bar itself is green with a long
lower wick, it reclaims the previous high, volume expands, and the two bars
before it were net-red.

Ported from the Pine v6 script
`h1_washout_low_5of5_4of5.pine` ("H1 Washout Low 5/5 + 4/5 (Early + Exact)"),
the reference backtest for which lives in `data/tmp/README.md` (H1 washout
low, from `spy_2026-10-15.md` §5b).

## File

`custom/washout-long.js`. Indicator id in the app: `custom:washout-long`.

## How a signal is decided

```
EARLY:  low  <= lowest(low, pivotLen + 1)          (left-only candidate)
EXACT:  low  is a pivotlow with left = right = pivotLen  (confirms pivotLen
       bars after the pivot; marker drawn back on the pivot bar)
```

Both modes then count how many of these 5 checks pass on the pivot bar and
fire at **k = 4 or k = 5**:

| # | Check | Formula |
|---|-------|---------|
| 1 | green close | `close >= open` |
| 2 | lower wick ≥ threshold | `(min(open, close) − low) / (high − low) ≥ minWickPct` |
| 3 | reclaim prior high | `high >= high[−1]` |
| 4 | volume expansion | `volume > volume[−1]` |
| 5 | net-red prior 2 bars | `sign(c−o)·v[−1] + sign(c−o)·v[−2] < 0` |

Check 5 uses the standard signed-volume proxy `sign(close − open)·volume`
(the same proxy as the reference Python backtest).

## Inputs

| Key | Default | Notes |
|---|---|---|
| `pivotLen` | 4 | window for the pivot test. EARLY uses `pivotLen + 1`; EXACT uses left=right=`pivotLen` |
| `minWickPct` | 0.40 | minimum lower-wick fraction of the bar's range |
| `mode` | `Both` | `Early (candidate)` \| `Exact (confirmed pivot)` \| `Both` |

## Outputs (alert-facing)

Output keys start with a letter (repo rule, see `docs/custom-indicators.md`),
so the Pine names `5of5`/`4of5` map to:

| Key | Meaning |
|---|---|
| `early5` | EARLY mode, 5/5 checks pass |
| `early4` | EARLY mode, 4/5 checks pass |
| `exact5` | EXACT mode, 5/5 checks pass |
| `exact4` | EXACT mode, 4/5 checks pass |

Each is `1` on a signal bar, `null` elsewhere (see note on `noAutoscale`
below). Wire an alert on `early5 > 0` or `exact5 > 0`; the app's alert editor
and the API both expose these keys through the indicator id `custom:washout-long`.

## Markers on the chart

| Shape | Color | Meaning |
|---|---|---|
| upward triangle | lime `#32cd32` | 5/5 (early **or** exact) |
| circle | orange `#ff8c00` | 4/5 (early **or** exact) |
| *(exact-mode variants append `" (X)"` to marker text — matches Pine)* | | |

## Deviations from the Pine original

- **`noAutoscale: true`** (see `chart.js:647`) — the four alert-facing
  outputs still return per-bar values, but the engine skips them in the
  price-pane autoscale. Without this, the flat 0-baseline of a histogram
  series in overlay mode drags the y-axis down to level 0 and compresses
  the price range when you zoom in.
- **Non-signal bars return `null`** instead of `0`. `chart.js:95` skips the
  `value` field for those points, so no visible flat line is drawn.
- **Output keys renamed** `5of5→early5`, `4of5→early4`, `5of5X→exact5`,
  `4of5X→exact4` because the repo requires output keys to start with a
  letter. The legend labels now read "L 5/5 (early)" etc.
- **Indicator renamed** `Washout Low` → `Washout Long` so this file pairs
  as a directional mirror with `custom/washout-short.js` (Washout Short)
- **No `alertcondition`** — this repo has no Pine alertcondition; alerts
  read outputs (see table above).
- **Hand-rolled `ta.pivotlow`** — it's not in the built-in `ta` set, so the
  EXACT branch does the `low[i] <= low[j] for j in [i−L, i+L]` test inline.
  Identical semantics to Pine's `ta.pivotlow(low, L, L)` with left=right=L.

## Verification (ran 2026-11-06, after rename to Washout Long)

- `node --test test/washout-long.test.js` — 7/7 pass
- `npm test` — 222/222 pass
- `npm run check` — READY (offline tests, data sources, live smoke all PASS)
- Covered by the test suite:
  - 5/5 fires at the intended interior pivot; EARLY5 + EXACT5 both fire at the
    same signal bar.
  - 4/5 fires when one check is relaxed — a negative control that drops a
    bar from 5/5 to 4/5.
  - Non-signal bars are `null` so the alert condition does not fire; a
    confirmed pivot low that fails the green-close check stays `null`.

## How to extend

- **More checks**: add to the two loops in `calc()` (EARLY and EXACT each
  have their own `k = …` tally and the `a5`/`a4`/`a5x`/`a4x` writes).
- **New marker shape/color**: edit the `put()` calls at the bottom of
  `calc()`.
- **Extra output (e.g. a 3/5 tier)**: add an `outputs[]` entry + a new
  `aN` array (keep the name starting with a letter), write into it where
  `k === 3`, include in the `return` object. Alerts on `a3 > 0` will work
  with no other change.

## Related

- `custom/ema-ribbon-squeeze.js` — same shape (marker + lines).
- `docs/custom-indicators.md` — full contract for inputs, outputs, markers,
  alert wiring.
- `data/tmp/README.md` — the Python backtest (`pivot_cdv_backtest.py`)
  that motivated this setup; H1 washout low is the H1 hypothesis there.
