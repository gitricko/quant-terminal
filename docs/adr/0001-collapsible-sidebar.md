# ADR 0001 — Collapsible right sidebar (adopted, v2)

- Status: adopted (v2, 2026-11-04). v1 (2026-11-04) withdrawn after review
  surfaced a real contradiction in Decision #2 and two genuine design gaps.
  See "Revision history" at the end for the diff.

## Context

User's original intent (verbatim): "There's this sidebar (watchlist, alerts,
calendar and news) on the right, so that it is collapsible and hidden with some
kind of UI."

The right sidebar (`.side`: four tabs — Watchlist / Alerts / Calendar / News) is
a fixed 300px column with no collapse mechanism (`.side { width: 300px }`,
`public/css/app.css:293-300`; `<aside class="side">`,
`public/index.html:141-149`). At widths < 900px it is hard-hidden —
`@media (max-width: 900px) { .side { display: none } }`
(`public/css/app.css:950-953`) — so on narrow screens its content is
unreachable, with no way to open it.

The bottom panel is the app's existing collapse idiom and is the visual
reference — but it is a horizontal bar with a **39px-tall strip that stays
visible** while the body below it hides (`.bottom.collapsed { height: 39px }`,
`.bottom.collapsed .tab-body { display: none }`, `#bottomToggle svg` rotates
180°; `public/css/app.css:484-492`, `public/js/panels.js:221-224`). The
sidebar is the vertical analogue: `.side`'s vertical strip is `.tabs`
(top), the body is `#sideBody` (below). Mirroring means **strip stays,
body hides, strip carries the toggle** — not "collapse the container to zero."

## Decision

1. **Control placement.** One new button `#sideToggle` appended to the existing
   `.tabs` strip in `<aside class="side">` (DOM: `index.html:142-147`),
   mirroring `#bottomToggle` — chevron SVG, rotates 180° when collapsed.
   No topbar button, no drag-resize.

2. **Collapsed state = strip, not container.**
   `.side.collapsed { width: 36px }`; `.side.collapsed #sideBody { display: none }`.
   In the 36px strip the tab buttons render **icon-only** (text labels hidden
   via `.side.collapsed .tabs button:not(#sideToggle) span { display: none }`);
   each tab button carries an inline SVG (matching the style of the existing
   `#bottomToggle` icon and the nine other `<svg viewBox="0 0 24 24">`
   icons already in the app). Each icon sits in a 36px cell; the four tab
   icons stack vertically, with `#sideToggle` at the bottom of the strip.
   The chart grid (`.grid`, `flex: 1`) takes the released 264px.
   **No `width: 0`, no `overflow: hidden` on the `<aside>`** — that
   combination makes the reopen path invisible (v1's error, fixed here).

3. **Persistence.** Two `localStorage` keys read at boot:
   - `qt-side-collapsed` = `"1"` | `"0"` — the collapsed flag.
   - `qt-side-tab` = active tab id (`"watchlist"` | `"alerts"` |
     `"calendar"` | `"news"`).
   Use the same try/catch as the existing `qt-ribbon-hidden-until` pattern
   (`public/js/app.js:721-728`) so private/incognito mode degrades to a no-op
   rather than throwing. Guard the tab value at boot: if it points at a
   tab not present in `#sideTabs` (future refactor), fall back to the
   first data-tab id — don't produce a blank pane.

4. **Interaction with the 900px media query — explicit.**
   State model: **`qt-side-collapsed` is the source of truth; the DOM
   class is a projection of it.**
   - ≥ 900px: `qt-side-collapsed == "1"` ⇔ `.side.collapsed` present.
   - < 900px: same key, plus one additional flag — `qt-side-drawer-open`
     (`"1"`/`"0"`, default `"0"`). When `qt-side-collapsed == "1"` the
     sidebar is **not rendered at all** (no push, no overlay). When
     `qt-side-collapsed == "0"`, `#sideToggle` (and the four tab icons,
     since the < 900px strip uses their collapsed geometry) opens an
     **overlay drawer** above the chart: `.side` becomes
     `position: fixed; right: 0; top: 0; bottom: 0; width: 300px; z-index: 40;
     transform: translateX(100%)` with a `transition: transform 160ms ease-out`;
     a translucent backdrop behind it (`.side-drawer-backdrop`, `z-index: 39`)
     closes the drawer on click; an explicit X button (`.side-drawer-close`,
     top-right of the drawer) also closes it. Opening the drawer does
     **not** clear `qt-side-collapsed` — it's an overlay, not a push.
   - Crossing 900px in either direction: the class and the key both stay
     in sync via a single JS reducer (`setCollapsed(next: bool)`), which
     writes both the key and the class together. A `matchMedia("(max-width:
     900px)").addEventListener("change")` handler re-applies the reducer so
     a resize never leaves the class and flag out of sync. That one handler
     is the only place that touches the class/flag, and it is the only place
     a future `classList.remove("collapsed")` can silently reset things —
     which the reviewer's §3 concern called out; centralizing the write path
     is the fix.
   - If `qt-side-collapsed == "1"` when crossing 900px → the sidebar
     disappears in both breakpoints (same "collapsed" semantic; only the
     rendering of the strip changes — in-band 36px strip vs. no strip —
     which is visible to the user and not a state reset).

5. **Alerts while collapsed.** No auto-expand (avoids jarring state
   changes mid-trade, especially on mobile). When an alert fires:
   - Desktop (collapsed): set a `data-dot="1"` attribute on the `.alerts`
     tab button inside the collapsed strip; style it as a 6px red dot via
     `.side.collapsed button[data-dot="1"]::after`. Clearing the dot
     happens when the Alerts tab is *opened and focused* — clicking
     that tab opens the sidebar on the Alerts pane and removes the
     dot.
   - Mobile (< 900px, drawer closed): same dot, plus the backdrop is
     *not* shown (dot stays on the icon strip that's always visible
     under 900px).
   - Drawer already open with Alerts tab active: normal behavior, no dot
     (already looking at it).

## Consequences / implementation surface

Files touched (all `public/`):

- `public/index.html` (lines 141-149) —
  - Inside the four tab buttons, wrap the text in `<span>` so collapse
    can hide it, and add a small inline `<svg viewBox="0 0 24 24">`
    per tab matching the existing icon style.
  - Append `<button id="sideToggle" class="icon"
    aria-expanded="false" aria-controls="sideBody"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`
    as the fifth child of `.tabs`.
  - After `#sideBody`, add `<div class="side-drawer-backdrop"
    hidden></div>` and `<button class="side-drawer-close"
    aria-label="Close panels">&times;</button>` for the < 900px overlay.

- `public/css/app.css` —
  - `.side.collapsed { width: 36px }`
  - `.side.collapsed #sideBody { display: none }`
  - `.side.collapsed .tabs button:not(#sideToggle) span { display: none }`
  - `.side.collapsed .tabs { flex-direction: column; }`
  - `.side.collapsed #sideToggle svg { transform: rotate(180deg) }`
  - `@media (max-width: 900px)`: drop the old `.side { display: none }`;
    add the fixed-drawer rules listed above; show `.side-drawer-close`;
    `.side-drawer-backdrop` styles.

- `public/js/panels.js` —
  - New: `setCollapsed(next: boolean)` — single write path for both the
    key and the class; `aria-expanded` on `#sideToggle` tracks it.
  - New: `matchMedia("(max-width: 900px)").addEventListener("change", apply)`
    re-applies `setCollapsed(readCollapsed())` on breakpoint change.
  - `#sideToggle.onclick` → `setCollapsed(!isCollapsed())`; if
    now-collapsed, also `closeDrawer()` (mobile).
  - `#sideDrawerClose.onclick` and `.side-drawer-backdrop.onclick` →
    `closeDrawer()` + `clearUnseenAlerts()`.
  - Guard: existing `renderSide()` (whichever name the current code uses
    — the current sidebar renders into `#sideBody`) no-ops when
    `.side.collapsed` *or* when the mobile drawer is closed. Follow the
    existing `renderBottom` guard at `panels.js:257`.
  - Alert-firing hook: in the existing alert render path, if
    `isCollapsed()` (or drawer closed) set `dot` on the `.alerts` tab.
    Clear on open+focus.
  - Boot: `isCollapsed = readCollapsed(); setCollapsed(isCollapsed)` —
    and if the saved tab is invalid, fall back to the first `[data-tab]`
    id before rendering.

Not touched: `server.js`, `lib/`, `public/lib/` (no server-side state
change; `data/` untouched), fork-only files (`ovr-banner.js`, `ovr.js`,
`ovr.css`), no new dependencies, no build step.

## Out of scope (explicitly declined)

- Topbar button as an alternate trigger.
- Drag-to-resize of the sidebar (would need width state in px + a manual
  resize observer; overkill for the ask).
- A persistent 28-48px icon *rail with per-tab badge counts* on desktop —
  the 36px icon strip (decision #2) already serves as the reopen affordance;
  badge counts live on the alert dot (decision #5) only.
- Keyboard shortcut (Alt+S).

## Verification / definition of done

- `npm test` green; `npm run check` READY.
- Browser-verified (per scenario):
  - Desktop push (≥ 900px): toggle collapses to 36px icon strip; expand
    restores 300px; chart re-fits (see Risk 1 — `autoSize: true` at
    `public/js/chart.js:176` handles this, but the browser check is the
    proof); state persists across reload.
  - Mobile (< 900px, drawer closed → open): backdrop + X both close the
    drawer; state persists; opening the drawer does *not* clear the
    collapsed flag (verifying the overlay/push distinction).
  - Resize from 1200 → 800 and back: collapse state is the *same* in both
    (same flag, same class) — no silent reset.
  - Alert fires while collapsed on desktop: dot appears on the Alerts
    icon in the strip; clicking it opens the sidebar on the Alerts pane
    and clears the dot.
  - Side + bottom collapse states remain independent (collapsing one
    doesn't affect the other).

**Test plan** (added per reviewer §4):
- `test/side-collapse.test.js` (node:test) — unit-covers the pure logic:
  - `setCollapsed(next)` writes both the `qt-side-collapsed` key and the
    class (using jsdom or a minimal DOM stub — same approach as any
    existing `public/js/` unit test; if no precedent exists, use an
    in-test fake `document` and `localStorage`).
  - `matchMedia change` handler re-applies the flag in both directions.
  - Invalid saved tab value → falls back to the first `[data-tab]` id.
  - `#sideToggle` `aria-expanded` tracks state.
- Chart re-fit is covered by the *existing* `autoSize: true` mechanism
  (`public/js/chart.js:176`) — the browser check (above) is the proof,
  not a unit test. This is the same "verify in a browser" convention
  the codebase uses for CSS/state transitions and matches the reviewer's
  reading of the mechanism.

## Revision history

- **v1 (2026-11-04).** Initial proposal.
- **v2 (2026-11-04).** Adopted after review. Changes from v1, addressing
  each review point:
  - **§1 (contradiction, blocking).** Reversed the collapsed-state spec:
    v1 said `width: 0` on `.side` *and* "tabs bar stays visible" —
    impossible, since `.tabs` is a child of the `<aside>`. v2 adopts the
    strip-stays pattern (matching `.bottom.collapsed`, which leaves a
    39px strip, not a zero-height container). New width: 36px, tab
    icons remain, `#sideBody` is `display: none`. Reviewer verified with
    `app.css:484-489` and `index.html:141-149`.
  - **§2 (geometry of `width: 0` / the "mirrors bottom" claim).** Split
    into an explicit statement: "mirrors the bottom panel's
    strip-stays, body-hides pattern; the collapse target is `#sideBody`,
    not `.side`." Also addressed the "four named buttons don't fit at a
    narrow width" concern: tab buttons render icon-only in the collapsed
    strip (text hidden with CSS, inline SVG — same `<svg viewBox="0 0
    24 24">` style already used nine times in `index.html`).
    Rejected the alternative (single toggle button as the sole
    collapsed-state affordance) — it would drop the four tabs entirely
    and force the user to expand the sidebar to switch between
    Watchlist/Alerts/Calendar/News, which the user's original intent
    ("collapsible *and* hidden with some kind of UI") does not call for.
  - **§3 (900px media query / state across breakpoint).** Centralized
    the write path (`setCollapsed`) and added the `matchMedia` change
    handler, so a class/flag desync is not possible by code review alone.
    Documented the expected behavior at the boundary explicitly.
  - **§4 (test plan / autoSize claim).** Added a `test/side-collapse.test.js`
    plan. Agreed the reviewer's read of `autoSize: true` at
    `public/js/chart.js:176` is correct — the browser-check wording
    in v1 was conservative, not wrong; kept the browser check as the
    proof in the definition of done.
  - **§5 (a11y).** Added: `aria-expanded` on `#sideToggle`,
    `aria-controls="sideBody"`, `aria-hidden` on `#sideBody` when
    collapsed (toggled by `setCollapsed` so the class and the ARIA
    attribute are set atomically), `aria-label` on `.side-drawer-close`,
    and `tabindex="-1"` on the four tab buttons inside the collapsed
    strip so they stay visible for pointer but are skipped by
    Tab-navigation (the user still has a functional path via
    `#sideToggle` and via the expanded-state tab order). Full
    keyboard focus-trap on the < 900px drawer is explicitly out of
    scope — see "Out of scope".
  - **§6 (ADR numbering).** Resolved by **renaming** the file to
    `docs/adr/0001-collapsible-sidebar.md` and updating the H1 to
    `# ADR 0001 — …`. Chose rename over placeholder because there is
    no other ADR content in this repo yet — a stub 0001 would be a
    placeholder for nothing and would itself become a gap. Verified
    no other `0001-*.md` exists in-tree or in `git log --diff-filter=A`
    history, so the rename is unambiguous.
  - **§7 (localStorage convention note).** Added an in-document note
    (see the Sources section) that the `qt-side-*` keys are the first
    `qt-*` localStorage keys owned by the main app under `public/js/`.
    The existing `qt-ribbon-hidden-until` key is written by
    `public/js/app.js:728` inside `showRibbon()` — it is the upstream
    Academy-ribbon feature, **not** the IMIT OVR banner
    (`ovr-banner.js` contains zero references to
    `qt-ribbon-hidden-until`, verified by grep). The convention our
    keys follow — `qt-` prefix, `"1"`/`"0"` value, try/catch around the
    `localStorage` calls, `Number(...) || 0` fallback on read — is
    identical to the ribbon pattern, so both are the same convention
    even though they are independent features.

## Open risks

1. **Instant chart re-fit on a CSS-driven width change.**
   `autoSize: true` (`chart.js:176`) wires lightweight-charts to a
   ResizeObserver, so a `.side` width transition *should* re-fire the
   chart's `autoSize` path. The browser check in the definition of done
   is the guarantee. If the chart visibly lags the transition, the
   fallback is a one-liner in `setCollapsed`: after the class
   change, call `this.chart.applyOptions(this.themeOptions())` — the
   pattern the existing `applyOptions` calls at `chart.js:214` already
   follow. Do not add this speculatively; add it only if the browser
   check shows a lag.
2. **`qt-side-tab` invalid value** (future tab refactor). Guarded at
   boot — see decision #3.
3. **Icon choice per tab.** v2 uses inline SVGs matching the existing
   `<svg viewBox="0 0 24 24">` convention. If the user wants a
   consistent icon set (Feather/Lucide), that's a follow-up and out of
   scope for this ADR — the SVGs are one-path-per-icon, so the visual
   match to the existing inline icons (e.g. the settings gear at
   `index.html:104`) is guaranteed.

## Sources / cross-references

- `public/index.html:141-149` — `.side` DOM structure (`.tabs` +
  `#sideBody`, both inside the `<aside>`).
- `public/index.html:134-136` — `#bottomToggle` markup (single SVG
  chevron, `class="icon"`).
- `public/css/app.css:293-300` — current `.side { width: 300px; ... }`.
- `public/css/app.css:484-492` — `.bottom.collapsed { height: 39px }`
  + `.tab-body { display: none }` + `#bottomToggle.svg rotate(180)`.
- `public/css/app.css:950-953` — current `@media (max-width: 900px)
  { .side { display: none } }`.
- `public/js/panels.js:221-224` — `#bottomToggle.onclick` toggle
  handler.
- `public/js/panels.js:257` — `renderBottom` guard while collapsed (the
  pattern the sidebar `renderSide` guard mirrors).
- `public/js/app.js:721-728` — existing `qt-ribbon-hidden-until`
  `localStorage` pattern (try/catch, `Number(...) || 0` fallback).
- `public/js/chart.js:176` — `autoSize: true` (ResizeObserver-driven
  re-fit; the mechanism the browser check in the definition of done
  verifies).
- `public/js/chart.js:214, 303, 484-502` — existing `applyOptions`
  pattern for the "manual re-fit fallback" in Risk 1.
- `docs/adr/` — this is the first ADR under that directory. It was
  created on `feature/collapsible-sidebar` and, per §6, renamed from
  `0002-` to `0001-collapsible-sidebar.md` to close the numbering
  gap. No other ADR file exists in-tree or in git history.
