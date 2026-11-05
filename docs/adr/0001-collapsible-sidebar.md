# ADR 0001 — Collapsible right sidebar (adopted, v6)

- Status: adopted (v6, 2026-11-05). v1 (2026-11-04) withdrawn after the 7-point
  review found an internal contradiction in Decision #2; v2 (2026-11-04) fixed
  §§1–7. v3 (2026-11-04) addressed the round-2 follow-up (3 more blocking
  points: missing active-state feedback in the strip, the `<span>` markup
  assumption, and an unrunnable test plan). v4 (2026-11-04) fixed the
  round-3 finding on the mobile state model. v5 (2026-11-05) addressed the
  round-4 residual — the CSS rail geometry wasn't driven from media state
  on mobile — by moving the 36px rules into the `(max-width:900px)` media
  block so they apply independently of the persisted `qt-side-collapsed`
  key. v6 (2026-11-05) folds in pi-agent's round-5 sign-off
  recommendation: on <900px `#sideToggle` is a **drawer** toggle (not a
  class toggle, which would have been a no-op on the always-36px mobile
  rail). See "Revision history" at the end.

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
   Desktop (≥ 900px) — rail is a *state*, gated on the persisted
   `qt-side-collapsed` key: `.side.collapsed { width: 36px }`,
   `.side.collapsed #sideBody { display: none }`, labels hidden
   (`.side.collapsed .tabs button:not(#sideToggle) span { display: none }`).
   Mobile (< 900px) — the same 36px rail is the *baseline* geometry,
   driven by `@media (max-width: 900px)` media state, not by the
   `.side.collapsed` class — so it is present on first load regardless of
   the persisted flag (round-4 fix). In the 36px strip the tab buttons
   render **icon-only**; each tab button carries an inline SVG (matching
   the style of the existing `#bottomToggle` icon and the nine other
   `<svg viewBox="0 0 24 24">` icons already in the app). Each icon sits
   in a 36px cell; the four tab icons stack vertically, with `#sideToggle`
   at the bottom of the strip. The chart grid (`.grid`, `flex: 1`) takes
   the released 264px (desktop) or its full half (mobile, since the rail
   is only 36px wide in both modes).
   **No `width: 0`, no `overflow: hidden` on the `<aside>`** — that
   combination makes the reopen path invisible (v1's error, fixed here).
   **Active-tab feedback in the strip (required, v3).** Collapsed state
   must not be a dead-end: the four tab icons each carry `data-tab`, and
   the currently-selected one stays highlighted exactly as it does when
   expanded (the existing `.tabs .active` rule already covers the strip —
   re-use it, don't add a second selector). A click on a collapsed tab
   icon therefore (a) shows the active state immediately and (b) — if the
   user has it open as the overlay drawer on < 900px — switches the
   drawer's pane. On desktop ≥ 900px a click on a collapsed tab icon
   also expands the sidebar to that tab (re-open shortcut), so a
   collapsed strip is a working control, not an inert rail.

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
   State model (v4): **`qt-side-collapsed` is the ONLY persisted state
   key; `qt-side-drawer-open` is a per-session transient that is
   reset to "0" on every page load and on every breakpoint
   crossing.** No third key, no cross-session drawer intent.
   - ≥ 900px: `qt-side-collapsed == "1"` ⇔ `.side.collapsed` present.
   - < 900px: the 4-tab strip is ALWAYS visible in the 36px icon-only rail
     geometry. That geometry is driven by the `(max-width:900px)` media
     state, **not** by `qt-side-collapsed` / `.side.collapsed`, so a
     fresh mobile user (default state) gets the rail on first load — the
     persisted key is irrelevant below the breakpoint. The old
     `@media (max-width: 900px) { .side { display: none } }` is *dropped*.
     Tapping any strip icon
     or `#sideToggle` opens a transient **overlay drawer** (slide-in
     `position: fixed; right: 0; top: 0; bottom: 0; width: 300px;
     z-index: 40; transform: translateX(100%) → 0` with `transition:
     transform 160ms ease-out`). A translucent backdrop
     (`.side-drawer-backdrop`, `z-index: 39`) closes it on tap; an
     explicit X button (`.side-drawer-close`, top-right of the drawer)
     also closes it. The transient flag `qt-side-drawer-open`
     (`"1"` / `"0"`, in-memory only, default `"0"`, NOT written to
     localStorage) records which state we're in. Tapping a tab icon
     in the strip while the drawer is open switches the drawer's
     active pane *and* closes the drawer (tap-to-reveal pattern, no
     lingering overlay).
   - Crossing 900px in either direction: the `matchMedia` handler
     calls a single writer `applyViewportState()` which (a) sets
     `qt-side-drawer-open="0"`, (b) closes the `.side-drawer-open`
     class and the backdrop if present, (c) re-projects
     `qt-side-collapsed` to the `.side.collapsed` class. One handler owns the cross-breakpoint transition; no other code path touches the drawer flag after creation. A future `classList.remove("collapsed")` in a third-party script cannot silently re-open the strip because the strip's visibility is gated on the `matchMedia` state, not on the persisted key alone.

5. **Alerts while collapsed.** No auto-expand (avoids jarring state
   changes mid-trade, especially on mobile). When an alert fires:
   - Desktop (collapsed): set a `data-dot="1"` attribute on the `.alerts`
     tab button inside the collapsed strip; style it as a 6px red dot via
     `@media (min-width:900px) { .side.collapsed button[data-dot="1"]::after
     { … } }`. Clearing the dot happens when the Alerts tab is *opened and
     focused* — clicking that tab opens the sidebar on the Alerts pane and
     removes the dot.
   - Mobile (< 900px, drawer closed): same dot, but the selector needs the
     media query, not `.side.collapsed`, since the rail is the baseline:
     `@media (max-width:900px) { .side button[data-dot="1"]::after { … } }`.
     Backdrop is *not* shown; dot stays on the icon strip.
   - Drawer already open with Alerts tab active: normal behavior, no dot
     (already looking at it).

## Consequences / implementation surface

Files touched (all `public/`):

- `public/index.html` (lines 141-149) —
  - **Required markup (blocking, v3).** Today the four tab labels are bare
    text nodes (`index.html:143-146`). Wrap each in `<span class="label">`
    **and** insert the per-tab `<svg class="ico" viewBox="0 0 24 24">…</svg>`
    as the first child of each button. `data-tab` is already present on
    each button — keep it. This markup change is a **hard requirement**,
    not an optional nicety: the collapse CSS
    (`.side.collapsed .tabs button:not(#sideToggle) span { display: none }`)
    and the `data-icon`/`.active` styling depend on it. The `index.html`
    diff that leaves the labels as bare text is a failed implementation,
    even if the CSS looks right.
  - Append `<button id="sideToggle" class="icon"
    aria-expanded="false" aria-controls="sideBody"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`
    as the fifth child of `.tabs`.
  - After `#sideBody`, add `<div class="side-drawer-backdrop"
    hidden></div>` and `<button class="side-drawer-close"
    aria-label="Close panels">&times;</button>` for the < 900px overlay.

- `public/css/app.css` —
  - **Desktop (≥ 900px) — rail is a *state*, gated on the persisted key:**
    - `@media (min-width: 900px) {
        .side.collapsed { width: 36px }
        .side.collapsed #sideBody { display: none }
        .side.collapsed .tabs button:not(#sideToggle) span { display: none }
        .side.collapsed .tabs { flex-direction: column; }
        .side.collapsed #sideToggle svg { transform: rotate(180deg) }
      }`
  - **Mobile (< 900px) — rail is the *baseline*, driven by media state,
    not the `.side.collapsed` class (so a fresh user with the default
    `qt-side-collapsed="0"` still gets the rail):**
    - `@media (max-width: 900px) {
        .side { width: 36px }
        .side #sideBody { display: none }
        .side .tabs button:not(#sideToggle) span { display: none }
        .side .tabs { flex-direction: column; }
      }`
    - The old rule `.side { display: none }` inside the same media
      block is **removed** (was at `app.css:950-953`).
    - `@media (max-width: 900px)`: add fixed-drawer rules
      (`.side-drawer-open` slide-in, `.side-drawer-close` shown,
      `.side-drawer-backdrop` styles) — these fire only when the
      transient `qt-side-drawer-open="1"` is set, independent of the
      persisted key.

- **`public/lib/sidebar-state.js` (new, small ESM, zero DOM/window/localStorage
  imports at module scope)** — the pure state logic, extracted so `node --test`
  can import it (see "Test plan"). This matches the repo's established test
  pattern: `test/*.test.js` import from **`public/lib/`** (backtest, indicators,
  series, quant), never from `public/js/`. `panels.js` cannot be imported under
  node anyway — it runs `window.LightweightCharts` and `document` at module
  top-level (`panels.js:26,28`). Exports:
  - `parseCollapsed(raw)` — `boolean`; tolerant of `null`/`"1"`/`"0"`/`true`.
  - `readCollapsed(storage, key="qt-side-collapsed")` — reads the key, returns
    `boolean`; safe when `storage` is absent (returns `false`).
  - `readTab(storage, validTabs, key="qt-side-tab")` — reads the tab id; on
    missing/empty/unknown value returns `validTabs[0]`. Pure — the caller
    passes the tab list, this function never touches the DOM.
  - `writeCollapsed(storage, next, key="qt-side-collapsed")` — writes
    `"1"`/`"0"`; tolerant of `storage` throwing (private/incognito mode).
  - `ariaFor(next)` → `"true" | "false"` — single source of the aria-expanded
    literal so writer and test agree.
  - `reducer(state, action)` — pure reducer over the
    `{activeTab, stripWidth: 'wide' | 'narrow'}` tuple for
    `"toggle" | "openDrawer" | "closeDrawer" | "select:<tab>"`. `panels.js`
    owns the live state object and commits the result; node tests drive every
    transition with plain objects, no `document`.

- `public/js/panels.js` — thin importer/wiring only:
  - `import * as side from "../lib/sidebar-state.js";`
  - `setCollapsed(next)` wrapper (desktop only): `side.writeCollapsed(localStorage, next)` →
    `sideEl.classList.toggle("collapsed", next)` →
    `#sideToggle.setAttribute("aria-expanded", side.ariaFor(next))` →
    `#sideBody.setAttribute("aria-hidden", String(next))`. **This is the
    single write path for the desktop collapsed state** — key, class, and
    aria all change together (prevents the class/flag drift the reviewer
    flagged in round 1 §3). It does NOT open the mobile drawer; on < 900px
    it only re-projects the strip (which is always visible) and, if the
    drawer is open, closes it via `closeDrawer()`.
  - `openDrawer()` / `closeDrawer()` (mobile only, DOM-side): toggle the
    `qt-side-drawer-open` transient flag, the `.side-drawer-open` class,
    and `.side-drawer-backdrop` visibility, move focus, and clear the
    "unseen alerts" dot on drawer open.
  - `applyViewportState()` (single writer for cross-breakpoint
    transitions): `matchMedia("(max-width:900px)").addEventListener("change",
    onBp)` calls this. It resets `qt-side-drawer-open="0"`, removes the
    drawer class and backdrop, then re-projects `qt-side-collapsed` to the
    `.side.collapsed` class. This is the only place the drawer flag is
    touched by a breakpoint change, so a resize never leaves the strip and
    the drawer in an inconsistent state.
  - `#sideToggle.onclick` → branch on `matchMedia("(max-width:900px)").matches`:
    - ≥ 900px: `setCollapsed(!isCollapsed())` (toggles the persisted key + class).
    - < 900px: `toggleDrawer()` (toggles `qt-side-drawer-open` transient;
      drawer open ⇔ `closeDrawer()`, closed ⇔ `openDrawer()`). **Not** a
      no-op — on the v5 mobile baseline, the strip is always 36px and a
      class-based toggle would have nothing to toggle. `aria-expanded`
      reflects the branch it took (persisted collapse on desktop, transient
      drawer open state on mobile).
    - Same chevron, same rotation, same idiom as `#bottomToggle`.
  - `#sideDrawerClose.onclick` + `.side-drawer-backdrop.onclick` →
    `closeDrawer()` + `clearUnseenAlerts()`.
  - **Re-open shortcut (Decision #2, v3):** a tab-button click while
    collapsed sets `activeTab` (via `reducer`) and calls `setCollapsed(false)`
    — expanding straight to that tab. If the drawer is already open it only
    changes the active tab (no class flip). The existing `.tabs button.active`
    rule (`app.css:464-467`) already provides visible selection feedback for
    the strip, so no new selector is needed.
  - Guard: `renderSide` (`panels.js:249`) no-ops when collapsed *or* when the
    drawer is closed on < 900px (mirror of the `renderBottom` guard at
    `panels.js:257`).
  - Alert hook: in the existing alert-render path, if collapsed (or drawer
    closed) set `data-dot="1"` on the `.alerts` tab; clear on open + focus.
  - Boot:
    ```js
    const collapsed = side.readCollapsed(localStorage);
    const activeTab = side.readTab(localStorage,
      ["watchlist","alerts","calendar","news"]);
    setCollapsed(collapsed);
    showSide(activeTab);   // existing showSide(), panels.js:229
    ```
    The invalid-tab fallback is unit-tested where the function lives
    (`sidebar-state.js`), not here.

Not touched: `server.js`, `lib/` (the backend), `data/` (state files),
fork-only files (`ovr-banner.js`, `ovr.js`, `ovr.css`), no new dependencies,
no build step. (The one new `public/lib/sidebar-state.js` module is the pure
logic home — it *is* in the touched list above; "not touched" does not claim
`public/lib/` is off-limits, only that no backend or fork files change.)

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
  - Mobile (< 900px): strip is *always* visible (no media `display:none`).
    Tapping a strip icon opens the overlay drawer (backdrop + X both close
    it); state persists across reload only for the *strip* semantic — the
    drawer itself is a per-session transient and does NOT reopen after a
    full page reload.
  - Resize from 800 → 1200 and back: the strip persists, the drawer is
    closed by the crossing, `qt-side-collapsed` does not change during
    the resize; the state at 1200px matches the pre-resize state at
    1200px (no silent reset, no lingering overlay, no ghost "drawer
    open" class leaking into the wide layout).
  - Alert fires while collapsed on desktop: dot appears on the Alerts
    icon in the strip; clicking it opens the sidebar on the Alerts pane
    and clears the dot.
  - Side + bottom collapse states remain independent (collapsing one
    doesn't affect the other).
  - **Mobile `#sideToggle` is not a no-op.** On <900px, first tap opens
    the overlay drawer (`.side-drawer-open` + backdrop visible,
    `aria-expanded="true"`); second tap closes it (drawer class +
    backdrop removed, `aria-expanded="false"`, strip returns to the
    36px baseline). `qt-side-collapsed` is unchanged by either tap
    (it's a desktop affordance and should not be written on mobile).
    The chevron rotation reflects the drawer state, not the collapsed
    class.

**Test plan** (revised per reviewer §4 and the round-2 point 3):
- **`test/sidebar-state.test.js` (node:test) — the authoritative unit
  suite.** Imports **`../public/lib/sidebar-state.js`** (not `panels.js`),
  matching the repo's existing pattern where `test/*.js` import from
  `public/lib/` (backtest, indicators, series, quant). `panels.js` is not
  importable under node — it references `window.LightweightCharts` (line 26)
  and `document` (line 28) at module top-level, so testing it directly would
  require a DOM shim; we do not add jsdom/happy-dom (zero-deps rule). Cases:
  - `readCollapsed` — `null` → `false`; `"1"` → `true`; `"0"` → `false`;
    missing key → `false`.
  - `readTab` — valid id returned as-is; empty string / unknown id / missing
    key → `validTabs[0]`.
  - `writeCollapsed` — writes `"1"` and `"0"` correctly; `storage.getItem`
    reflects the write; a throwing storage (private-mode simulation) does not
    propagate.
  - `reducer` — each action (`toggle`, `openDrawer`, `closeDrawer`,
    `select:<tab>`) from each initial state yields the expected tuple;
    idempotent actions (e.g., `toggle` twice → same state).
  - `ariaFor` — `true` → `"true"`, `false` → `"false"`.
- **DoD browser checklist** (not a test, just the manual proof):
  collapse → expand round-trip on desktop; 1200 → 800 → 1200 resizes with
  no state loss; mobile overlay drawer open/close + backdrop click;
  `.active` highlight visible in the collapsed strip (round-2 point 1);
  clicking a collapsed tab icon expands to that tab (the re-open shortcut);
  alert dot appears/clears on the Alerts icon per state.

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
- **v3 (2026-11-04).** Follow-up to pi-agent's 3-point review of v2.
  All three points accepted after independent verification of the
  reviewer's premises against the tree.
  - **Point 1 (blocking — collapsed strip was a dead-end).** v2 hid
    the tab labels *and* `#sideBody` without specifying any selection
    feedback in the strip, so clicking an icon gave no visible response
    — a real v2 regression vs. the old 4-button row. Verified
    `.tabs button.active { background: var(--hover) }` already exists
    (`app.css:464-467`), so the fix is: re-use that rule (no new
    selector) so the selected icon stays highlighted in the strip, and
    add the **re-open shortcut** — a collapsed tab click both sets the
    active tab and expands the sidebar to that tab (on < 900px it just
    switches the open drawer's pane). The strip is now a working
    control, not an inert rail.
  - **Point 2 (blocking — the `<span>` wrapper was a CSS assumption,
    not a spec).** The v2 selector hides text via `span`, but
    `index.html:143-146` labels are bare text nodes — the markup the
    CSS depends on was never required. Made the `<span class="label">`
    wrapper + first-child `<svg class="ico">` a **hard requirement**
    in the `index.html` consequences block: an `index.html` diff that
    leaves the labels as bare text is a failed implementation even if
    the CSS looks right.
  - **Point 3 (blocking — the test plan was unrunnable as written).**
    Correct. Verified `panels.js:26` (`window.LightweightCharts`) and
    `panels.js:28` (`document`) execute at module top-level, so
    `node --test` cannot `import` `panels.js`; and `package.json` has
    no DOM shim, so `document`/`window`/`matchMedia` are undefined.
    Replaced the fake-document approach with one that matches the
    repo's actual pattern: extract the pure state logic to a new
    `public/lib/sidebar-state.js` (DOM-free, ESM) and let
    `test/sidebar-state.test.js` import *it* — the same
    `public/lib/*` import path `test/*.js` already use for
    backtest/indicators/series/quant. `panels.js` becomes a thin
    importer/wiring layer on top of that module. This also removes
    the implicit "add a DOM shim to `public/js`" scope creep the v2
    plan carried.


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

- **v4 (2026-11-04).** Round-3 finding: the sub-900px state model was
  self-contradictory. v3's Decision #4 treated `qt-side-collapsed` as
  the mobile state key — "collapsed==1 ⇒ not rendered at all,
  collapsed==0 ⇒ overlay drawer." Pi-agent's point: with the strip
  *always* visible on mobile, `qt-side-collapsed` no longer has a
  meaningful mobile semantic; two keys with no defined precedence is
  incoherent. Accepted — v4 redefines the mobile state model:
  - `qt-side-collapsed` is the ONLY persisted key (single source of
    truth on both breakpoints).
  - `qt-side-drawer-open` is an in-memory transient, reset to "0" on
    every page load and on every breakpoint crossing. It is NOT
    written to `localStorage`.
  - The old `@media (max-width: 900px) { .side { display: none } }`
    is dropped — the 4-tab strip is always visible on mobile, same
    36px geometry as desktop collapsed.
  - Tapping a strip icon on mobile opens the overlay drawer (or
    switches panes if already open). Tapping any tab to close the
    drawer is the tap-to-reveal pattern; no lingering overlay.
  - `matchMedia("(max-width: 900px)")` handler calls one
    `applyViewportState()` writer that resets the transient, re-
    projects `qt-side-collapsed`, and removes the drawer class —
    so resize crossings never leave the strip and the drawer in
    an inconsistent state.
  - State tuple in `public/lib/sidebar-state.js` updated to
    `{activeTab, stripWidth: 'wide' | 'narrow'}` (the drawer flag
    is owned by `panels.js` and is DOM-side only, so it is not
    part of the pure reducer state).
  - DoD browser checklist: add "resize from 800px → 1200px and
    back: strip persists, drawer never lingers, `qt-side-collapsed`
    does not change during the resize."

- **v5 (2026-11-05).** Round-4 residual: the 36px rail geometry was
  gated on `.side.collapsed`, which only exists when the persisted
  `qt-side-collapsed=="1"` — so a fresh mobile user would have seen a
  300px inline sidebar, not the promised 36px icon rail. The reviewer's
  option 1 (drive the rail geometry from the `(max-width: 900px)` media
  state, independent of the persisted key) is adopted. Changes:
  - Decision #2 (rail spec) split into explicit desktop vs mobile.
    Desktop rail is a *state* — `.side.collapsed {…}` gated on the
    persisted flag. Mobile rail is the *baseline* — `@media
    (max-width:900px) { .side { width:36px; … } }`, no `.collapsed`
    class required.
  - Decision #4 (mobile state model) reworded to make the
    media-state-vs-key distinction explicit.
  - Decision #5 (alerts) alert-dot selector split into two media
    blocks: `@media (min-width:900px) .side.collapsed button[data-dot]`
    and `@media (max-width:900px) .side button[data-dot]`.
  - CSS file list rewritten with the two media blocks explicitly
    spelled out. `@media (max-width:900px) { .side { display: none } }`
    is removed (was at `app.css:950-953`); the new baseline mobile rail
    rules and the drawer-only conditional rules replace it.
  - H1 and status updated to `v5`, date 2026-11-05.

- **v6 (2026-11-05).** Round-5 sign-off: the review passed (both round-4
  findings verified resolved in the committed tree), plus one design
  clarity recommendation. Adopting it because it's correct: the ADR's
  toggle section said `#sideToggle` always toggles `qt-side-collapsed` →
  `.side.collapsed`. But on <900px the rail is the *baseline* (v5), so a
  class toggle there is a no-op tap — a button that does nothing is worse
  than no button (same "coherent on the page, broken at the state that
  matters" class as prior rounds). Changes:
  - `#sideToggle.onclick` now branches on `matchMedia("(max-width:900px)")`:
    ≥900px toggles the persisted collapse; <900px toggles the **drawer**
    (`qt-side-drawer-open` / `.side-drawer-open`). `aria-expanded` reflects
    whichever state it toggled.
  - DoD gains: "Mobile `#sideToggle` is not a no-op" (first tap opens
    drawer, second closes back to the 36px rail baseline, no
    `qt-side-collapsed` write on either tap).
  - H1 and status updated to `v6`.
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
