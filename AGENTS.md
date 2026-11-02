# AGENTS.md

Read this first. It's written for a coding agent (Hermes, Claude Code, Codex) that's going to
change code in `quant-terminal`. Keep it accurate: if a rule here becomes stale, fix it in the
same PR as the change that made it stale.

## What this is

A single-file Node.js 18+ trading terminal that runs locally. **Zero runtime dependencies, no
`npm install`, no build step.** `server.js` (563 lines) serves the UI in `public/` and a small
localhost HTTP API. `lib/` is the backend. `public/lib/` is the indicator/backtest/quant engine.
`public/js/` is the UI. `data/` holds user state (watchlists, alerts, paper account) as plain
JSON — gitignored, read/written only through `lib/store.js`.

This is a **modified copy of Lewis Jackson's Quant Terminal** (MIT). Read `MODIFICATIONS.md` and
`NOTICE` before touching UI: we replaced the top banner with an **IMIT OVR** banner + Playbook
window (`ovr-banner.js`, `public/js/ovr.js`, `public/css/ovr.css`). Everything else is the
upstream MIT app. Do not break the TradingView attribution logo — the LICENSE in
`public/vendor/lightweight-charts.LICENSE` requires it.

## Non-negotiables

- **No new runtime deps.** No `npm install`. No build step. If an edit would tempt you to add a
  package, stop and reconsider. The whole selling point is "no account, no subscription, no
  install".
- **Stay ESM.** Everything is `"type": "module"`. Imports use explicit `.js` extensions.
- **Keep it local.** The server answers only to this machine (`allowed()` in `server.js:96`).
  **Writes need the `x-qt: 1` header**; reads don't. `Origin` must match `Host` on writes. Do not
  add open CORS, a remote-exec flag, or an admin surface.
- **Never commit secrets or user state.** `data/`, `*.tmp`, `video/`, `dist/`, `target/` are
  gitignored. `custom/signal-*.js` is also ignored (user's private signal scripts). If a file
  has API keys, don't commit it.
- **Touch only what the task needs.** No drive-by refactors, no renames, no reformat. Match the
  existing style. The codebase is deliberately dense and comment-rich — keep density and comments
  in the places you touch.
- **Verify with real output before declaring done.** `npm test` must pass; `npm run check` must
  say READY for any change that touches `server.js`, `lib/`, `public/lib/`, `public/js/`, or the
  API. For pure doc/skill changes, `npm test` is the floor.
- **Never push to `main`.** All changes go out as feature-branch PRs. That's a user hardline
  rule and there's a `pre-push` hook that enforces it.

## Layout map

```
quant-terminal/
├── server.js               main server: routes, auth, static, SSE for alerts
├── ovr-banner.js           one-shot idempotent installer for the IMIT OVR banner (fork-only)
├── Makefile                untracked; currently points at a start.sh that doesn't exist
├── start.command / start.bat      documented entry points (Linux start.sh missing)
├── LICENSE, NOTICE, MODIFICATIONS.md, README.md
├── package.json            zero deps; scripts: start, test, doctor, compare, smoke, check,
│                           launch, stop, setup
├── .github/workflows/ci.yml    12-way matrix (3 OS × Node 18/20/22/24) + "install from zip" job
├── AGENTS.md               this file — read first
├── .agents/skills/        reusable agent workflows (see "Skills" below)
├── lib/                    backend
│   ├── store.js            state read/write on data/*.json
│   ├── providers.js        1350 lines: Binance/Coinbase/Kraken/Nasdaq/Yahoo/FX sources
│   ├── feeds.js            news / economic calendar / earnings / dividends
│   ├── imports.js          CSV/JSON imports for watchlists & paper account
│   ├── alerts.js           alert engine + SSE broadcast
│   ├── market-info.js      company info, financials
│   ├── ptq.js              PTQ (Part-Time Quant) integration hooks
│   └── proxy.js            relay/relaunch plumbing for proxy mode
├── public/
│   ├── index.html
│   ├── css/{app.css, ovr.css}
│   ├── js/                chart.js, app.js, api.js, panels.js, quantui.js, research.js,
│   │                      drawings.js, ptq.js, volume-profile.js, ovr.js (fork-only)
│   ├── lib/               engine (runs in browser and in node)
│   │   ├── indicators.js  3041 lines; registerIndicator() + 87 built-ins
│   │   ├── backtest.js    bar-replay backtester + conditionFn + magnifierTf
│   │   ├── quant.js       quantChecks: walk-forward, Monte Carlo, deflated Sharpe,
│   │   │                  overfitting, cost stress — the "gold box"
│   │   ├── series.js      bar/TF utilities, parseTf
│   │   └── seasonals.js
│   └── vendor/            lightweight-charts (Apache-2.0; keep the LICENSE + logo)
├── custom/               user's own indicator JS files (loaded at runtime).
│                         signal-*.js are gitignored (treat as private).
├── data/                 user state JSON. gitignored. Only touch via lib/store.js.
├── docs/
│   ├── api.md                    full local HTTP API reference — source of truth for endpoints
│   ├── custom-indicators.md      custom indicator spec + fields + input/outputs tables
│   ├── indicator-template.js     copy-paste starting point for a custom indicator
│   ├── alert-example.js
│   └── org-prompt.md
├── examples/
│   ├── python/quant_terminal.py
│   └── rust/{main.rs, Cargo.toml, Cargo.lock}
└── test/                   node:test — 10 files (indicators, series, backtest, quant, ptq,
                            reference, providers, feeds, imports, server) + fixtures/
    ├── live.test.js      excluded from `npm test` (needs network); run as `npm run test:live`
    └── fixtures/{btc-1d.json, screener-crypto.json, screener-us.json}
```

## Commands

| What                                        | Command                                     |
|---------------------------------------------|---------------------------------------------|
| Run it                                      | `npm start` (or `node server.js --open`)    |
| Offline unit tests                          | `npm test`                                  |
| Reachable-data-sources probe                | `npm run doctor`                            |
| Live smoke test (real net)                  | `npm run smoke`                             |
| All of the above, one exit code, with timeouts | `npm run check`                          |
| Live tests (excluded from `npm test`)       | `npm run test:live`                         |
| Pick a port                                 | `PORT=4000 npm start`                       |

**Definition of done** for any code change: `npm run check` → all three steps PASS.
For pure math changes, add a test to `test/<name>.test.js` and run `npm test` at minimum.

## How the pieces talk

- **Frontend → server:** HTTP JSON on `http://127.0.0.1:3777/api/*` (see `docs/api.md`). Reads
  need nothing; writes carry `x-qt: 1`.
- **Server → data:** `lib/providers.js` fans out to Binance, Coinbase, Kraken, Nasdaq, Yahoo,
  FX via public endpoints and merges. All providers are optional at runtime —
  `npm run doctor` tells you which ones this machine can reach.
- **Custom indicator contract:** an ES module default-exporting
  `{ name, overlay, inputs, outputs, levels, calc(bars, p, ta) }`. Full spec in
  `docs/custom-indicators.md`; template at `docs/indicator-template.js`. `calc` must return
  one array per output, same length as `bars`, with `NaN` where no value yet. Do not import
  anything inside `calc` — it also runs in a browser context.
- **Alerts:** `lib/alerts.js` fires into the SSE `/api/events` stream; the API can fan out to a
  webhook if configured.

## Conventions

- **Node:** >= 18, no pin beyond that. CI runs 18, 20, 22, 24.
- **JS style:** 2-space, double-quotes for JSON-ish. ESM — always include the `.js` extension
  on relative imports.
- **No TypeScript, no Babel, no bundler.**
- **Errors from the API:** `{"error": "..."}` with 4xx/5xx. Use `httpError()` from
  `server.js` (or throw an object with a `.status` property) — not a raw `throw new Error()`.
- **Tests:** `node:test` + `node:assert/strict`. Fixtures in `test/fixtures/`. Add new test
  files to the `test` script in `package.json` or CI won't run them. `test/live.test.js` is
  separate because it needs network.
- **Style of tests:** `test/indicators.test.js` asserts against an independent, naive
  re-implementation of the formula (e.g. `naiveEma`, `naiveRsi`). Follow that pattern —
  don't assert shape alone, assert values for a few bars where you can work the answer out by
  hand.

## Fork-specific layer (do not drift)

The IMIT OVR banner + Playbook is the only fork-local content. It lives in exactly these files:

- `ovr-banner.js` — idempotent installer. Rewrites `public/index.html` to insert the ribbon +
  `<dialog class="ovr-dialog">` and the Playbook button, and adds the `<link>` to `ovr.css` and
  the `<script>` for `ovr.js`. **Do not hand-edit the banner markup in `public/index.html`.**
  Re-run `node ovr-banner.js` after upstream changes if it needs to be re-applied. The
  `<!-- ovr-banner -->` marker is where the patch anchors.
- `public/js/ovr.js` — opens/closes the dialog (references `#ovr-dialog` and `#ovr-open`;
  keep those IDs stable).
- `public/css/ovr.css` — styles.
- `MODIFICATIONS.md` — the human record of the fork delta. Update it when the fork changes.

Playbook content (the B1/B2/B3/S1 … setup rows) is generated from the `BANNER` and `rows`
arrays at the top of `ovr-banner.js`. Edit those, re-run the installer, and update
`MODIFICATIONS.md`.

## Skills (`.agents/skills/`)

Reusable agent workflows live in `.agents/skills/<name>/SKILL.md`. Load the matching skill
before doing the task. Currently:

- `add-indicator/` — implement, test, and register a custom indicator.
- `add-api-endpoint/` — add or fix an `/api/*` route in `server.js`.
- `qt-verify/` — the canonical verification path + how to read a FAIL.
- `ovr-playbook/` — maintain the IMIT OVR banner + Playbook without breaking upstream.

If you discover a repeated workflow that's missing, add it here (not in `~/.hermes/skills/`)
so it ships with the repo.

## Working against the original

- Keep `LICENSE`, `NOTICE`, `MODIFICATIONS.md` intact (upstream attribution + fork delta).
- Do not scrub the "TradingView Lightweight Charts" attribution in
  `public/vendor/lightweight-charts.LICENSE`.
- Do not add telemetry, analytics, or any remote call beyond what `lib/providers.js` already
  does.
- When in doubt about scope: **this is a personal, local tool.** Smaller is better.

## Known issues (flag, don't patch unless asked)

- `Makefile` (untracked) references `./start.sh`, which does not exist. The documented entry
  points are `npm start` / `start.command` / `start.bat`. Don't delete the Makefile without
  asking; it's likely a leftover.
- `npm run test:live` is excluded from CI on purpose (needs network); a failure locally in the
  sandbox is expected and not a blocker.
- `data/` may not exist on a fresh clone; `lib/store.js` creates it on first write. Don't rely
  on `data/state.json` being present in a clean tree.

## Change checklist

Before you open a PR:

- [ ] `npm test` green.
- [ ] `npm run check` says READY (or justify why it can't in the PR).
- [ ] No new deps, no build step, no `node_modules/` in the diff.
- [ ] `data/` and secrets untouched.
- [ ] Fork-only files (`ovr-banner.js`, `public/js/ovr.js`, `public/css/ovr.css`) only touched
      if the task is about them.
- [ ] Feature branch, not `main`. Single logical change per PR.
