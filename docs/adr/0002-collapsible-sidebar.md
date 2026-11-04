# ADR 0002 — Collapsible right sidebar (proposal)

- Status: proposed (written 2026-11-04, awaiting review — no code yet)
  Note: written as a proposal in its first revision; flip Status to `accepted`
  when the review passes.

## Context

User's original intent (verbatim): "There's this sidebar (watchlist, alerts,
calendar and news) on the right, so that it is collapsible and hidden with some
kind of UI."

The right sidebar (`.side`: Watchlist / Alerts / Calendar / News) is a fixed
300px column with no collapse mechanism
(`.side { width: 300px }`, `public/css/app.css:293-300`; `<aside class="side">`,
`public/index.html:141-149`). At widths < 900px it is simply hard-hidden —
`@media (max-width: 900px) { .side { display: none } }`
(`public/css/app.css:950-953`) — so on narrow screens its content (watchlist,
alerts) is unreachable, with no way to open it.

The bottom panel already demonstrates the app's collapse idiom and is the
pattern to mirror: `.bottom.collapsed { height: 39px }`, a `#bottomToggle`
chevron that rotates 180°, and rendering suppressed while collapsed
(`public/js/panels.js:221-261`, `public/css/app.css:484-492`).

## Decision (proposal)

1. **Control placement.** One new button `#sideToggle` in the side tabs bar
   (next to the tab buttons in `<aside class="side">`), mirroring
   `#bottomToggle` — chevron rotates 180° when collapsed. No topbar button, no
   drag-resize.
2. **Collapsed state = full hide.** `.side.collapsed` → width 0,
   border-left 0, overflow hidden; the chart grid takes the released space.
   Charts should auto re-fit (lightweight-charts re-fits on size change —
   verify in a browser before implementing; if it doesn't fire, wire a manual
   fit call on the toggle). The tabs bar stays visible as the only reopen
   path on desktop; only the `#sideBody` content pane collapses (not the whole
   `<aside>` including the tab bar), so the reopen control is always reachable.
3. **Persistence.** `localStorage` keys `qt-side-collapsed`
   (`"1"`/`"0"`) and `qt-side-tab` (active tab id), read at boot, with
   try/catch fallback matching the existing `qt-ribbon-hidden-until`
   pattern (`public/js/app.js:721`) so private/incognito mode degrades to a
   no-op rather than throwing.
4. **Mobile (< 900px).** Replace the hard `display: none`. Below 900px the
   sidebar defaults to collapsed and, when opened, renders as an **overlay
   drawer**: slides in over the chart with a translucent backdrop; X or
   backdrop click closes it. ≥ 900px keeps the **push** behavior (chart
   widens when collapsed). One toggle button, two rendering modes behind a
   media query.
5. **Alerts while collapsed.** No auto-expand (avoids jarring state changes
   mid-trade, especially on mobile). The Alerts tab icon shows a badge / red
   dot for new/unseen alerts; clicking the Alerts tab both opens the sidebar
   and switches to it. Badge must update even when the mobile drawer is
   already open.

## Consequences / implementation surface

Files touched (all `public/`):

- `public/index.html` — add `#sideToggle` to the tabs bar; add a drawer close
  (X) button and an overlay backdrop element for the < 900px case.
- `public/css/app.css` — `.side.collapsed` rules; overlay media-query rules
  (position, z-index, backdrop, drawer close button visibility); chevron
  rotate (reuse the bottom-panel pattern).
- `public/js/panels.js` — wire `#sideToggle` click handler (mirror
  `#bottomToggle`); guard `renderSide` so it no-ops while collapsed (mirror
  the `renderBottom` guard at `panels.js:257`); read persisted state on boot;
  hook the existing alert-firing path to set/clear the badge.

Not touched: `server.js`, `lib/`, `public/lib/` (no server-side state change;
`data/` untouched), fork-only files (`ovr-banner.js`, `ovr.js`, `ovr.css`),
no new dependencies, no build step.

## Out of scope (explicitly declined)

- Topbar button as an alternate trigger.
- Drag-to-resize of the sidebar (would need width state in px + a resize
  observer; overkill for the ask).
- A persistent icon rail on desktop (28–48px strip with per-tab icons /
  badge counts) — full-hide was chosen instead.
- Keyboard shortcut (Alt+S).

## Verification / definition of done

- `npm test` green; `npm run check` READY.
- Browser-verified: desktop push (toggle collapses/expands, chart re-fits
  correctly, state persists across reload); mobile (< 900px) overlay/drawer
  (opens over chart, backdrop + X close both work, state persists); badge
  appears/updates when an alert fires while collapsed, on desktop and mobile.
- Side + bottom collapse states remain independent (collapsing one doesn't
  affect the other).

## Open risks

- Instant chart re-fit on a width change driven purely by CSS (no guaranteed
  resize event on every transition — needs the browser check above, not just
  a happy-path "it looked fine").
- `qt-side-tab` persisted value pointing at a tab that doesn't exist (e.g.
  after a future tab refactor) — need a guard/cycle-to-first-valid-tab at
  boot, not a blank pane.
