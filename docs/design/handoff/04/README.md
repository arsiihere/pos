# Module 04 · Voids and Audit · Pulse design hand-off (VU1 / VU2)

- `PROMPT.md`: the build prompt for the VU1 (Void) and VU2 (Audit log) lanes.
- `CHANGES.md`: design decisions, every string with a proposed i18n key (en, plus ur where an Urdu frame shows it), copy mismatches with spec §8 / §9, Urdu notes and open items.
- `MAPPING.md` / `mapping.json`: screen → frames → components and CSS classes → API fields (void-preview, pending-voids, audit-log, audit-staff), plus "Gaps".
- `INDEX.html`: open it in a browser to see all 40 frames by canvas group.
- `design/`: the frames (`*.dc.html`), `canvas.json`, `css/`, `ds/pos/` (tokens and bundled fonts) and `screens/` (PNG renders).

Spec: `docs/specs/04_Voids_Audit_Spec_v1.0.3.md` §8 and §9. Plan: `docs/plans/04-plan.md` rows VU1 / VU2. Inventory: `docs/design/inventory/04-voids-audit.md`.

## Source
- The owner's claude.ai Design canvas artifact, slug `0cc43196-6531-4725-a859-ad6cfd9a6150`, made 2026-11-17 by Arslan (owner).
- Every file under the artifact's `project/` was copied with its text unchanged and checked against its sha256: 40 frames, `canvas.json` and 10 CSS files (51 files). **Every sha256 matched** (before the plate change below).
- These artifact files were not copied: SKILL.md, the `artifact-type/*` files, and the canvas `index.html` viewer.
- Six CSS files are byte-identical to files already in the repo:
  - `bundle.css` = `01d/design/ds/pos/components/bundle.css`
  - `kit-additions.css`, `pulse.css`, `v-brand.css` and `pulse-01d.css` = the files of the same name in `01d/design/`
  - `pulse-02.css` = `02a/design/pulse-02.css`
- `tokens.css` is 01d's `ds/pos/tokens.css` without its `@font-face` lines.
- New for 04: `pulse-04.css`, `pulse-04-admin.css` and `fonts.css`.

## Paths
- The frames link `css/*.css` relative to `design/`, so they open straight from disk.
- `./support.js`: the frames reference the canvas helper script, but it is **not shipped**, the same as in 01d. The frames are static and render without it.
- **Fonts:** `css/fonts.css` keeps the canvas `/_blob/<id>` URLs exactly as the canvas has them, so those fonts do not load from disk.
  - The same five fonts are bundled in `design/ds/pos/fonts/` (copied from 01d), with `tokens.css` and `tokens.json`.
  - Blob ids: `7b0c…` Figtree, `29f5…` Bricolage Grotesque, `b0a1…` Geist Mono, `5b8b…` / `d280…` Noto Nastaliq Urdu 400 / 700.
  - The build uses the ui-kit's bundled fonts, never a CDN.

## Screenshots
- `design/screens/<frame>__WxH__<lang>.png`: 40 files, one per frame, each at its canvas size, at deviceScaleFactor 1.
- They were rendered with Playwright and Google Chrome. The `/_blob/*` font requests were served from `design/ds/pos/fonts/`, and `support.js` was replaced by an empty script.

## Public-repo check
- No frame contains an email address, a phone number, a token or a secret.
- Sample data only: staff names, items, amounts and a shortened sample ULID (`01JDQ…G7Q2`).
- **Vehicle plates replaced** (owner ruling O8, 2026-11-17): the canvas sample plates are now the placeholders "ABC 123" and "ABC 456". These two frames are the only files that differ from the canvas, and only by the plates; their screenshots were re-rendered. New sha256:
  - `design/VoidKiosk.dc.html` `7c3007f5eacc0132d60ab94457e6e26b627b42ecc25318799262b7d4726d9ef5`
  - `design/DayCloseBlockedMore.dc.html` `b6c82697c143c60a5514434b6467bfeff33af51ebdf16444392c243d988b1631`

## Not in this hand-off
- These inventory screens have no frame because they are outside spec 04 §8:
  - 04-D03 move to stock as its own dialog (the frames fold it into the Void sheet)
  - 04-D04 / 04-D05 returns and resell
  - 04-D07 close-with-pending override
  - 04-S04 audit entry detail
  - 04-S05 ready-stock panel
  - 04-S06 settings
- Other inventory screens are covered by earlier modules:
  - 04-D01 Remove (02b)
  - 04-N01 / 04-N02 / 04-S02 (01d alerts and Requests)
  - 04-C01 (inside the Void sheet)
- MAPPING.md uses the hand-off IDs for the §8 screens.
