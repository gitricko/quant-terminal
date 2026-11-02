---
name: ovr-playbook
description: Maintain the IMIT OVR banner + Playbook window (the fork-only UI layer) without breaking upstream. Use when editing the OVR banner, Playbook content, or syncing upstream changes around the banner.
---

# OVR banner + Playbook (fork-only layer)

This repo is a modified copy of Lewis Jackson's Quant Terminal. The **only** fork-local code is
the IMIT OVR banner + Playbook dialog. Keep it isolated so upstream stays cleanly mergeable and
the TradingView/app attribution is never disturbed.

## Where it lives (exactly these files)

| File | Role |
|------|------|
| `ovr-banner.js` | Idempotent installer. Rewrites `public/index.html` to insert the ribbon + `<dialog class="ovr-dialog">` and the Playbook button, and adds the `<link>` to `ovr.css` and `<script>` for `ovr.js`. |
| `public/js/ovr.js` | Opens/closes the dialog (`showModal`, backdrop + ✕ close). Deliberately plain `var`-style browser JS. |
| `public/css/ovr.css` | Styles for `.ovr-btn`, the dialog, tables. |
| `MODIFICATIONS.md` | The human-facing record of what was changed. Update it when the fork delta changes. |
| `public/index.html` | Contains `<!-- ovr-banner -->` marker + injected markup (managed by `ovr-banner.js`). |

## Rules

- **Do not hand-edit the banner markup in `public/index.html`.** Re-run the installer:
  `node ovr-banner.js` (it's idempotent — safe to run again; updates in place).
  - `ovr.js` references `#ovr-dialog` and `#ovr-open`; if those IDs are missing, the script no-ops.
    Keep the IDs stable or fix both sides together.
- **`calc`/engine/indicator code is upstream.** If a Playbook *setup* wants quant output, consume
  it through the existing API/`quant.js` rather than forking math into the banner.
- **Update `MODIFICATIONS.md`** whenever you add/remove/renames the fork-local behavior (banner
  copy, Playbook sections, new fork files).
- Keep the TradingView Lightweight Charts attribution + logo untouched. This is a licence
  requirement, not optional.

## Editing Playbook content

The banner text and Playbook rows are the `BANNER` and `rows` arrays at the top of
`ovr-banner.js` (B1/B2/B3/S1 ... setups with entry/target/exit). To change the Playbook:
1. Edit those arrays in `ovr-banner.js`.
2. Run `node ovr-banner.js` to regenerate `public/index.html`.
3. Verify the marker `<!-- ovr-banner -->` is still present where the patch expects it (the
   script fails clean if `public/index.html` is missing).
4. Run `npm test` (UI-only changes still shouldn't break the server tests) and open the page to
   confirm the ribbon + Playbook render.

## Syncing upstream

If you pull in upstream `public/index.html` changes and the OVR banner gets dropped:
- Re-run `node ovr-banner.js` to re-apply.
- Check `public/js/ovr.js` and `public/css/ovr.css` still load (the link/script tags) and that
  `#ovr-dialog` / `#ovr-open` still exist.
- Don't delete upstream attribution while re-applying.

## Verify

```
node ovr-banner.js     # re-applies cleanly, no error
npm test               # server/engine unaffected
```
And eyeball the page (ribbon visible, Playbook opens, ✕ closes, "Hide for a week" works).
