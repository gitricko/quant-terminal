---
name: qt-verify
description: The canonical verification path for quant-terminal changes, and how to read a FAIL. Use before declaring any code change done, and to triage a failing check/smoke/doctor.
---

# Verify a change

`npm run check` (`scripts/check.js`) runs, in order, with per-step timeouts:
1. **Offline tests** — 10 `node:test` files (indicators, series, backtest, server, reference,
   providers, feeds, imports, ptq, quant). Timeout 15 min.
2. **Data-source doctor** — `scripts/doctor.js`: which of Binance/Coinbase/Kraken/Nasdaq/Yahoo/FX
   this machine can reach. Timeout 5 min.
3. **Live smoke test** — `scripts/smoke.js`: starts a real server and pulls real data. Timeout
   5 min.

It prints a `PASS/FAIL` per step and a final `READY` / `NOT READY` line. **Definition of done for
any code change: all three PASS.**

## Run it

```
npm run check
```
For a faster loop while developing, run just the relevant slice:
```
npm test                 # offline math/logic
node --test test/indicators.test.js   # one file
```

## Reading a FAIL

- **Offline tests FAIL** → a real regression in code you (or upstream) changed. Reproduce with the
  single failing file, read the assertion, fix the root cause. Do not weaken the test to make it
  pass unless the assertion itself is provably wrong.
- **doctor FAIL** → usually *environment*, not code: this sandbox can't reach some exchange.
  `npm run doctor` alone shows exactly which sources timed out. In a network-restricted CI/sandbox
  this can fail even with correct code — check other runners before concluding a regression.
- **smoke FAIL** → the server started but a real data round-trip failed. Often downstream of a
  doctor failure (no reachable provider), or a server.js crash. Read the server's stdout/stack.
- **ETIMEDOUT / "ran for over N minutes"** → a hang. The timeout guard is there so a stuck test
  becomes a FAIL, not an infinite wait. Find the un-awaited promise or infinite loop.

## Browser-verified UI changes (when you touch `public/js/`, `public/css/`, or `public/index.html`)

`npm run check` can be READY while the feature is still broken in a real browser. Four rules
(full CDP recipe in `references/browser-ui.md`):

1. **`element.click()` in a synthetic test is a lie for delegated handlers.** It sets
   `e.target === element`, so a handler reading `e.target.dataset.x` passes — but a real user's
   pointer lands on a child (`<svg>`, `<span>`) without `dataset.x` and the handler no-ops.
   Handlers must resolve via `e.target.closest("button[...]")`, and verification must dispatch a
   real CDP mouse event at the *child's* coordinate, never `button.click()`.
2. **Measure every button against its container, in every state.** "Panel opened to 300px" can
   still be broken if the five buttons inside total 401px (last two silently clipped). The
   state-transition check (opened/closed/width=X) proves nothing about which children are
   visible. `getBoundingClientRect()` each button and assert it fits the panel's left/right
   band in expanded, rail, mobile-rail, and mobile-drawer states.
3. **Base CSS placed after an `@media` block overrides it** (equal specificity, last-wins).
   A "fix" for the mobile rail silently reverts if the base rule sits below the `(max-width:900px)`
   block. New base rules go *above* the media block, or the browser's computed style will
   disagree with your source order.
4. **Record ADR geometry divergence as a new revision entry, never a silent number swap.**
   If the shipped rail/drawer is 72px but the signed ADR says 36px, add a vN revision entry
   stating the reason, the new number, and the commit SHA — a silent change voids the prior
   reviewer's sign-off.

## Sandbox caveats

- `npm run test:live` is **intentionally excluded** from `npm test` and CI — it needs live
  network. A failure there in the sandbox is expected and not a blocker by itself.
- Data sources vary by machine/region; "which providers answer" is reported, not assumed.

## Before you open a PR

- `npm run check` → READY (or a written justification in the PR if the sandbox can't reach
  providers — state which steps passed).
- No new deps, no `node_modules/` in the diff.
- **ADR consistency**: if the implementation's geometry diverges from the last signed ADR
  revision (widths, selector scope, layout direction), add a new `vN` revision entry stating
  the old number, the new number, the reason, and the commit SHA. A silent number swap voids
  the prior reviewer's sign-off.
- Feature branch, not `main`.
