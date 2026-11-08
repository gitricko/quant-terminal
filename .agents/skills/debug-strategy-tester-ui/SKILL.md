---
name: debug-strategy-tester-ui
version: 1
author: codespace
description: "Troubleshoot the Strategy Tester panel: payload, sanitized keys, 'not under indicators', DOM param loss; verify in the real browser."
metadata:
  hermes:
    tags: [quant-terminal, strategy-tester, panels.js, ui-debugging, browser-automation]
    related_skills: [backtest-strategy, add-indicator]
---

# Debugging the Strategy Tester panel (public/js/panels.js)

## When to use
- User runs a strategy in the Strategy Tester and gets a payload error
  ("… is not under indicators", unknown operand, wrong trade count).
- A strategy works via `POST /api/backtest` (curl/node one-liner) but NOT
  through the panel — the panel silently transforms the JSON before handing it
  to the in-page `backtest()`.

## Mental model — the five transform stages
1. **Stored strategy** (data/state.json or EXAMPLE_STRATEGIES): aliases only
   (e.g. `indicators.washout`, `entryLong: [{left: "washout.early4"}]`).
2. **`strategyToUi`** (panels.js): alias → indicator def via `BY_ID`, builds
   `tState.groups`/`tState.raw`, renders the form. `tState.raw = s || {}`
   keeps non-form fields (stopLoss/rrMultiple/forcedFlatTime/costs).
3. **`operandHtml` / `readOperand`**: DOM round-trip. ONLY rendered inputs
   survive. Indicator params carry a `data-params` JSON attribute (set Nov
   2026); `readOperand` restores it, then overlays the one editable `[data-p]`
   input on top.
4. **`compileRules` / `toOperand`**: builds the sanitized identity key
   `id + "_" + Object.values(params).join("_")` with non-alnum squashed to `_`
   → `custom_washout_long_4_0_4_Early__candidate_`. **Param set AND order
   change the key.**
5. **In-page `backtest(bars, strat)`**: the panel NEVER calls /api/backtest.
   Validation resolves `stopLoss.indicator` against the keys of
   `strat.indicators` — a key mismatch is "X is not under indicators".

## Debug procedure (in order)
1. **Reproduce the exact error string** — it names the key the engine could
   not find. Compare it byte-for-byte against the sanitized keys you'd expect
   for each param set (`4`, `4_0.4`, `4_0_4_Early__candidate_`, …). If the
   error key is LONGER than what the panel can produce, some params reached
   the reference but were dropped from the operand (or vice-versa); that pins
   down which transform lost them.
2. **Trace all five stages in code**, reading each function verbatim
   (`strategyToUi` → `operandHtml`/`readOperand` → `compileRules`/`toOperand`
   → `readTester` → `runTester`). Do not infer from memory; the file changes
   across fix attempts — re-read it.
3. **Cross-check vs a working non-UI path**: run the same stored JSON through
   the engine via a node one-liner (see backtest-strategy skill). If the
   direct path works and the UI fails, the loss is in stages 2–4 (panel), not
   stage 5 (engine).
4. **Fix at the transform that drops data** (most common: the DOM round-trip,
   stage 3). Preserve full data through the DOM via a `data-*` attribute
   carrying `esc(JSON.stringify(...))` — `dataset` unescapes it back
   automatically.
5. **Verify in the real browser** (recipe below, step-by-step below). A node
   harness that fakes the DOM will false-positive: it can pass the
   full-params payload while the truncated key still breaks a remap. Only the
   live page is authoritative.

## Browser-verification recipe (no vision provider in this env)
- `js(...)` reads the DOM as text; skip `capture_screenshot` (vision provider
  is not attached here) — read text/attributes instead.
- Toasts are transient and `runTester` is async, so hook `window.app.toast`
  in one call, click, then read it back in a LATER call:
    ```js
    window.__toasts = [];
    const _t = window.app.toast;
    window.app.toast = (m, t) => { window.__toasts.push(String(m).slice(0,300)); return _t(m, t); };
    document.getElementById('tRun').click();
    ```
  Then (separate call, after ~2–3 s): `js("JSON.stringify(window.__toasts || [])")`.
- Success check: `window.app.active.extraMarkers` — entries are
  `text:"Buy"/"Short"` arrows and exits are opposite-side circles with a
  P&L label, so 73 trades = 146 markers.
- Verify the panel's rendered DOM carries full params:
  `document.querySelectorAll('span.operand[data-params]')` and
  `JSON.parse(el.dataset.params)` should equal the full param object of the
  stored strategy.
- Panel flow by selectors: "Strategy tester" button in the panel-picker list
  → `#tPreset` select (`sv:` prefix = saved strategy from data/state.json,
  `ex:` prefix = built-in example) → `#tRun`.

## Pitfalls (each cost a real iteration of the user)
- **Remap iterated a function, not a dict**: an in-scope local `g` shadowed
  the groups dict; `for (const k in g)` over a function is a silent no-op →
  empty alias→key map, no error thrown, wrong key left in place. Iterate the
  stored dict (`tState.groups`), not a shadow.
- **`stopLoss.indicator` must reference the ALIAS under `indicators`** in the
  stored strategy, but after panel sanitize it must reference the sanitized
  key. Remap alias→key using the ACTUAL keys the panel produces, and build
  the map from the same groups object that feeds `compileRules`.
- **Engine field names**: `rrMultiple` (not `rrTarget`); costs are
  `feePct` / `slippagePct` / `spreadPct`; time exit is `forcedFlatTime`
  (a "HH:MM" string, ET). Stored strategies using unknown field names fail
  silently (the engine ignores unknown keys) — the symptom is "wrong trade
  count", not an error.
- **NaN-between-pulses indicators**: `crossesAbove` rejects a NaN prior bar,
  so a pulse indicator that only emits a value at the pulse bar never crosses.
  Gate with `> 0` instead (see backtest-strategy).
- **Node harness false-positives**: harnesses that hand `compileRules` the
  FULL param object skip the DOM stage entirely. If the bug is in
  `operandHtml`/`readOperand`, the harness still reports green. Always close
  the loop in the live browser.
- **`execute_code` corrupting multi-line JS-in-Python-strings** happened
  repeatedly during this incident — write the probe to a file first and
  `js(open(path).read())` from disk, or keep the JS single-line with `\n`
  escapes inside.
- **`patch` rejects truncated absolute paths** ("/workspaces/quant-termi")
  with `Failed to read file` — always use the full
  `/workspaces/quant-terminal/...` path, or route through `execute_code`
  with a variable holding the path.
- **Deduped browser calls**: identical JS strings return a cached
  `dedup:ref sha=...` result. Change the expression (read a different state,
  add a `Date.now()` probe, etc.) to force a fresh evaluation.

## Definition of done
- Live browser run: strategy loads from the dropdown, "Run on chart" fires
  with zero error toast, `extraMarkers.length == 2 × trade count`, entries
  and exits all present with P&L labels.
- `npm test` green (panel changes touch shared code paths).
- If the fix changed the stored-strategy shape, update data/state.json too
  and re-verify BOTH the API path and the UI path.
