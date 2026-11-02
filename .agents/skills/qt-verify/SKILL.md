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

## Sandbox caveats

- `npm run test:live` is **intentionally excluded** from `npm test` and CI — it needs live
  network. A failure there in the sandbox is expected and not a blocker by itself.
- Data sources vary by machine/region; "which providers answer" is reported, not assumed.

## Before you open a PR

- `npm run check` → READY (or a written justification in the PR if the sandbox can't reach
  providers — state which steps passed).
- No new deps, no `node_modules/` in the diff.
- Feature branch, not `main`.
