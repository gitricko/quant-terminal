# Browser-verified UI changes

For changes touching `public/js/`, `public/css/`, or `public/index.html`, `npm run check`
READYs and the feature still breaks in a real browser. Three failure modes and their fixes,
in the order they usually surface.

## Setup

```
node server.js                # background, port 3777
```

Navigate via `new_tab("http://127.0.0.1:3777/")` + `wait_for_load()`. Call
`localStorage.clear()` between state transitions to reset persisted UI flags.

## 1. `element.click()` is a lie for delegated handlers

`document.getElementById("btn").click()` sets `e.target === btn`, so a handler reading
`e.target.dataset.x` passes — the synthetic click hit the button itself. A real user's
pointer lands on a child (`<svg>`, `<span class="label">`), which has no `dataset.x`, and
the handler catches `undefined` and no-ops. The bug is invisible to
`button.click()`-based tests.

**Code fix:** read with `e.target.closest("button[data-tab]")`, not
`e.target.dataset.tab`. Any delegated handler on a composite control (button with icon +
label, list item with checkbox, etc.) needs the same pattern.

**Verification fix:** dispatch real mouse events at the *child's* own coordinate via CDP.
Pattern (adjust selectors):

```python
# For each interactive child (icon <svg>, label <span>), compute ITS bounding rect center
# and dispatch mousedown/mouseup there — the spot a real user hits.
# element.click() bypasses the delegation path entirely, so it is useless here.

def real_click(sel_child: str):
    r = js(f"document.querySelector('{sel_child}').getBoundingClientRect()")
    x, y = int(r["left"] + r["width"] / 2), int(r["top"] + r["height"] / 2)
    cdp("Input.dispatchMouseEvent", type="mousePressed",
        x=x, y=y, button="left", clickCount=1)
    cdp("Input.dispatchMouseEvent", type="mouseReleased",
        x=x, y=y, button="left", clickCount=1)
    time.sleep(0.2)

# Use on the icon, the label, and the padding area of the same tab, in each state.
```

## 2. Measuring overflow inside a state

"The panel is 300px wide" does not mean all its children are visible. If the panel is 300px
and five buttons inside it total 401px wide *in a row* (or 31×28 in a column that's 36px
wide), the last two are clipped — the user never sees them, no error, no warning. The
state transition check (opened / closed / width matches) proves nothing about which children
render at all.

Measure every child against the container in **every** state:

```python
def fit_check(tag: str, panel_sel: str):
    r = js(f"(function(){{"
           f"  var p = document.querySelector('{panel_sel}').getBoundingClientRect();"
           f"  var btns = [...document.querySelectorAll('{panel_sel} button')]"
           f"              .map(function(b){{ return b.getBoundingClientRect(); }});"
           f"  return {{p: p, b: btns}};"
           f"}})()")
    p = r["p"]
    print(f"{tag}: panel x={p['left']:.0f}..{p['right']:.0f} = {p['width']:.0f}px")
    for i, b in enumerate(r["b"]):
        ok = b["left"] >= p["left"] - 1 and b["right"] <= p["right"] + 1
        print(f"  btn[{i}] x={b['left']:.0f} right={b['right']:.0f} "
              f"({b['width']:.0f}×{b['height']:.0f})  "
              f"{'OK' if ok else 'OVERFLOW'}")

# Call in each state, e.g. for a sidebar:
fit_check("DESKTOP-EXPANDED", ".side")
js("document.getElementById('sideToggle').click()"); time.sleep(0.2)
fit_check("DESKTOP-RAIL", ".side")
# Mobile states: cdp(Emulation.setDeviceMetricsOverride) first, then repeat.
```

Any OVERFLOW in any state = broken. The state-transition check alone is not a DoD gate.

## 3. CSS cascade order: base rules before media blocks

A base block at `app.css:1168` targeting `.side #sideTabs` *after* an
`@media (max-width: 900px) { .side #sideTabs { ... } }` at `app.css:950` wins on mobile
(equal specificity, source order) — the mobile rule is silently reverted. A "fixed"
mobile rail that reverts after a later base block was added is a cascade-order bug, not a
selector bug.

**Rule:** place shared base rules *above* the media block they're meant to override, or
scope them to a selector the media block doesn't also use. Always verify with computed
style in the browser (`getComputedStyle(element)`) that the intended rule wins, because
source-order bugs look identical to selector bugs from the CSS perspective.

## 4. ADR vs. shipped geometry

A review-signed ADR records concrete numbers — rail width, drawer width, selector scope.
If the implementation diverges from those numbers (even by the minimum amount that makes the
feature physically work — say, a 36px target that can't hold five elements), the divergence
must be recorded as a **new revision entry** in the ADR:

```markdown
- **v7 (YYYY-MM-DD).** Post-implementation geometry correction: the ADR's 36px rail number
  is not physically reachable for N elements in the required layout. Now Xpx vertical icon
  column (commit SHA). Prior reviewer's v6 sign-off stands on Decision N; this revision
  does not change that decision, only the implementation geometry.
```

A silent number swap silently voids the prior reviewer's sign-off — the next round will
catch it as drift. Name the old number, the new number, the reason, and the commit SHA so
a later round can reconcile against the shipped tree.

## DoD checklist (paste into PR description before the "Ready" line)

```
[ ] Real-pointer CDP clicks on each interactive child pass (not just button.click())
[ ] Every button fits its panel in expanded, rail, mobile-rail, mobile-drawer states
[ ] CSS: no base rule after an @media block that targets the same selector
[ ] ADR: any geometry divergence from the last signed revision has a vN entry with SHA
[ ] npm run check READY
```
