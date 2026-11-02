---
name: add-indicator
description: Implement, test, and register a custom Quant Terminal indicator end-to-end. Use when asked to add/fix a custom indicator in custom/ or a built-in in public/lib/indicators.js.
---

# Add an indicator

Quant Terminal has two kinds of indicators:
- **Custom** — one JS file in `custom/`, loaded at runtime into the indicator list. This is
  the common case for "add an indicator" requests.
- **Built-in** — added to `public/lib/indicators.js` (3000+ lines, 87 existing) and covered by
  `test/indicators.test.js`.

## 1. Read the spec first

- `docs/custom-indicators.md` — the contract: fields, input types, output kinds, `calc` rules.
- `docs/indicator-template.js` — the copy-paste starting point.

Key rules that trip people up:
- It's an **ES module default export**: `{ name, overlay, inputs, outputs, levels, calc }`.
- `overlay: true` → drawn on the price chart. `overlay: false` → own pane (use `levels: [30,70]`
  for dashed guide lines).
- `calc(bars, p, ta)` gets `bars` (oldest first), `p` (your inputs), and `ta` (building blocks:
  `sma, ema, rsi, atr, stdev, crossover, source, compute, ...`).
- **Return one array per output**, each the same length as `bars`, with `NaN` where there's no
  value yet. Object keys must match your `outputs` `key`s.
- **Do not import anything inside `calc`** — it also runs in the browser.
- No new dependencies. Plain math only.

## 2. Write it

```
cp docs/indicator-template.js custom/<slug>.js
```
Fill in `name`, `inputs`, `outputs`, `calc`. Keep it to the task: don't add settings you don't
need. `custom/signal-*.js` filenames are gitignored (treat them as the user's private scripts —
don't commit or commit-intend files matching that pattern).

## 3. Prove the math with a test

Add a case to `test/indicators.test.js` (import your file) — or a new `test/<name>.test.js`:
- Use the fixture `test/fixtures/btc-1d.json`.
- Assert against an **independent, naive re-implementation** of the formula (that's the existing
  style in that file — e.g. `naiveEma`, `naiveRsi`). Don't just assert shape; assert values for a
  few bars where you can compute the answer by hand.
- If you create a new test file, **add it to the `test` script in `package.json`** or CI won't
  run it.

## 4. Register + verify

Custom indicators in `custom/` appear in the indicator list automatically by filename — no
registration step. Verify:
```
npm test          # your new math passes
node server.js &  # optional: spot-check the endpoint that lists indicators
curl -s http://127.0.0.1:3777/api/indicators | head
```
Definition of done: `npm test` green; `npm run check` says READY.

## Pitfalls

- Returning a scalar instead of an array → the whole plot breaks silently.
- Off-by-one: the first `length` bars should be `NaN` for a rolling calc; match how
  `naiveEma`/`ta.sma` seed.
- Forgetting the output object key → a blank pane with no error.
- Editing a built-in without a matching test → you can't tell a regression from an improvement.
