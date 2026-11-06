# Washout Short

A pivot-high reversal detector: fires on bars where price prints a fresh high
but the **buying side is exhausted** — the bar itself is red with a long upper
wick, it fails to hold the previous low, volume expands, and the two bars
before it were net-green.

The vertical mirror of [Washout Long](./washout-long.md). Washout Long buys the
dip — a fresh low that got *rejected* (long lower wick) right after sellers.
Washout Short is the exact reverse: it **shorts the rip** — a fresh high that got
*rejected* (long upper wick) right after buyers. Same 5-check framework, every
check mirrored around the vertical midpoint (low↔high, green↔red,
lower-wick↔upper-wick, sellers↔buyers). Volume expansion is symmetric, so that
check is unchanged on both sides.

Unlike Washout Long (which was ported 1:1 from a Pine v6 script), Washout Short
was **built in-repo as a mirror** of `custom/washout-long.js` — that file is the
reference implementation for the long side, and this is its exact opposite.

## File

`custom/washout-short.js`. Indicator id in the app: `custom:washout-short`.

## How a signal is decided

```
EARLY:  high >= highest(high, pivotLen + 1)         (left-only candidate)
EXACT:  high is a pivothigh with left = right = pivotLen (confirms pivotLen
       bars after the pivot; marker drawn back on the pivot bar)
```

Both modes then count how many of these 5 checks pass on the pivot bar and
fire at **k = 4 or k = 5**:

| # | Check | Formula |
|---|-------|---------|
| 1 | red close | `close <= open` |
| 2 | upper wick ≥ threshold | `(high − max(open, close)) / (high − low) ≥ minWickPct` |
| 3 | fail to hold prior low | `low <= low[−1]` |
| 4 | volume expansion | `volume > volume[−1]` |
| 5 | net-green prior 2 bars | `sign(c−o)·v[−1] + sign(c−o)·v[−2] > 0` |

Check 5 uses the standard signed-volume proxy `sign(close − open)·volume`
(the same proxy as the reference Python backtest for the long side), just with
the inequality flipped so a *green* prior two bars counts as pressure.

## Inputs

| Key | Default | Notes |
|---|---|---|
| `pivotLen` | 4 | window for the pivot test. EARLY uses `pivotLen + 1`; EXACT uses left=right=`pivotLen` |
| `minWickPct` | 0.40 | minimum upper-wick fraction of the bar's range |
| `mode` | `Both` | `Early (candidate)` \| `Exact (confirmed pivot)` \| `Both` |

## Outputs (alert-facing)

Output keys start with a letter (repo rule, see
`docs/custom-indicators.md` §Alerts and `custom/indicators.md`), so they can be
referenced by name in the alert UI:

| Key | Meaning |
|---|---|
| `early5` | EARLY candidate, all **5/5** checks passed |
| `early4` | EARLY candidate, exactly **4/5** checks passed |
| `exact5` | EXACT confirmed pivot, all **5/5** checks passed |
| `exact4` | EXACT confirmed pivot, exactly **4/5** checks passed |

Each is an array, same length as `bars`, with `0` on non-firing bars, `1` on
firing bars, and `null` where the check window is not yet warm (early bars of
the series, or bars the mode doesn't evaluate). All four are `noAutoscale: true`
— their 0/1 arrays do not compress the price range when zoomed.

## Markers

Place markers **above** the bar (mirror of `washout-long.js`'s `belowBar` markers):

| Shape | Color | Text (EARLY) | Text (EXACT) |
|---|---|---|---|
| `arrowDown` | red `#ff3b3b` | `S 5/5` | `S 5/5 (X)` |
| `circle` | orange `#ff8c00` | `S 4/5` | `S 4/5 (X)` |

The `S` prefix follows the sibling-pair naming convention (L = Long, S = Short)
so the two indicators read as directional mirrors. Exact-mode markers carry
" (X)" to distinguish a confirmed-pivot fire from a candidate fire.

(See `custom/washout-short.js` marker wiring for the canonical values.)

## How to extend

- **More checks**: add to the two loops in `calc()` (EARLY and EXACT each
  count `k` and compare against 4 and 5), and add a matching row to the table
  above.
- **A third mode** (e.g. "swing confirmed"): add a `p.mode === "..."` branch
  in `calc()`, and add a matching `inputs` entry.
- **Custom colors**: the two marker colors (`#ff3b3b`, `#ff8c00`) are only
  referenced inside `markers()` — change them there or thread them through a
  new input if they should be user-configurable.

## Testing

`test/washout-short.test.js` (6 tests) covers:

- **Early-mode equivalence** with an independent naive re-implementation of the
  5 checks on the full BTC-1D fixture (`test/fixtures/btc-1d.json`, 1,000 bars).
- **Exact-mode equivalence** with the same oracle, on the same fixture.
- **Output array shape** — each of `early5/early4/exact5/exact4` is the
  right length and only contains `0`, `1`, or `null`.
- **Hand-built top-bar** — a bar that fires 5/5 early, asserted for marker
  shape (`arrowDown`), color (`#ff3b3b`), position (`aboveBar`), and text
  (`S 5/5`).
- **Negative no-fire** — a bar that is a fresh high and red but fails one more
  check (k = 3), asserted to stay `null` on all four outputs.
- **Candidate-gate pinning** — a bar that *passes all 5 checks* but is NOT the
  window-max high is suppressed by the EARLY gate `if (!(h[i] >= highestL1[i]))
  continue;` (the guard at `washout-short.js:61`). Pins the one branch the
  naive oracle does not independently exercise.

Run: `node --test test/washout-short.test.js` or `npm test` (both suites are
wired into the `test` script and into `scripts/check.js`).

## Verification (ran 2026-11-06)

- `node --test test/washout-short.test.js` — **6/6 pass**
- `npm test` (full suite) — **222/222 pass**
- `npm run check` — **READY** (offline tests PASS, data-sources PASS, live
  smoke PASS)
- Mutation check: temporarily disabling the EARLY candidate guard makes the
  candidate-gate test **red** (`early5[5]` flips `null` → `1`); restoring it
  returns **green**, file `git diff` clean.

## History

- **PR #5 (merged):** `Washout Short` added as the vertical mirror of the
  then-named-`Washout Low` indicator, with 5 tests. After an adversarial
  review (pi-agent, comment #2 on PR #5), a 6th candidate-gate-pinning test
  was added.
- **PR #6 (current):** `Washout Low` → `Washout Long` rename. Cross-references
  in `washout-short.js` and this doc's sibling framing updated so the pair
  reads as two directional setups (*Washout Long* ↔ *Washout Short*).