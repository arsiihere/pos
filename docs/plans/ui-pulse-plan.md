# UI Pulse plan: modules 00, 01a, 01b, 01c

Source: the four Pulse design hand-offs in `updated-designs/handoff/<module>/`, unzipped from `pos-<module>-handoff.zip`. Each has PROMPT.md, CHANGES.md, MAPPING.md, mapping.json, a brief and `design/`. Status and decisions: `docs/plans/ui-pulse-status.md`.

Scope: client only, changing looks and layout. Backend, API shapes, events and business rules stay as they are. The UI work touches:
- `apps/client`;
- `packages/ui-kit`;
- the hub-served pages in `apps/hub/src` (the page renderers, `lib/page.ts` and `lib/strings.ts`).

`apps/cloud`, `packages/{events,engine,domain}` and the hub's server logic are out of scope.

Authority: the specs win for behaviour, and the frames win for looks (each PROMPT.md). For 01c, the rules are `docs/plans/01c-ui-contract.md` and spec 01c v1.0.1 §8.

## 0. Shared (first, one place)

| Piece | Where | Notes |
|---|---|---|
| Tokens (brand → derived → semantic) | `packages/ui-kit/tokens.css`, `tokens.json` | Copied from the hand-off. The four zips are identical. |
| Components + kit additions | `packages/ui-kit/components/bundle.css` | Hand-off `bundle.css` + 01c `kit-additions.css` (a superset of the 00/01a/01b files). This is the one copy; a legacy block at the end holds the old phone-nav/hero rules until the pages move off them. |
| Fonts | `packages/ui-kit/fonts/` | Figtree, Bricolage Grotesque, Geist Mono, Noto Nastaliq Urdu (400/700). Atkinson removed. Served by the hub `/ui/*`, bundled into each Vite entry. |
| Page layout classes the frames draw with inline styles | `bundle.css`, section "Pulse page layout" (appended per group) | The client forbids `style={…}` (S35 d), so every frame-only layout becomes a named, token-only class in the kit. No per-module CSS file. |
| Shared React pieces | `apps/client/src/components/` | Includes More menu (`.pos-more` + `.pos-menu`), disclosure, phone drawer (`.pos-scrim` + `.pos-sidenav--drawer`), row link and gone block. Added once and reused by every module. |

## 1. Module 00 (hub-served pages, `apps/hub/src`)

| Group | Screens (MAPPING.md) | Files |
|---|---|---|
| 00-A Setup | 00-S01, 00-S02, 00-F06, 00-F07 | `setup/page.ts`, `lib/page.ts`, `lib/strings.ts` |
| 00-B Pair + phone pair | 00-S10, 00-S11, 00-S12–S15, 00-F02, 00-F03, 00-F08 | `auth/pair-page.ts` (+ phone pair page), `lib/global-state.ts` |
| 00-C First admin + Approve | 00-S03–S09 | `auth/admin-bootstrap.ts`, `commands/approve-pairing-request.ts` |
| 00-D Hub admin | 00-S16–S20, 00-D01–D03, 00-F01, 00-F04, 00-F05 | `admin/page.ts` |

## 2. Module 01a (`apps/client`)

| Group | Screens | Files |
|---|---|---|
| 01a-A Owner shell | 01a-S01, 01a-S02 (shell, branch picker, phone drawer), 01a-B04 | `features/owner/{Shell,BranchPicker,cloud,App}.tsx`, `login/LoginView.tsx`, `components/{SideNav,AppBar}.tsx` |
| 01a-B Floors + stations | 01a-S03, 01a-S04, 01a-D01, 01a-D02 | `features/owner/floors/*`, `stations/*`, `BlockedDialog.tsx` |
| 01a-C Menu + item form | 01a-S05, 01a-S06, 01a-S07, 01a-B01–B03, 01a-C01 | `features/owner/menu/*` |
| 01a-D Hub stock page | 01a-S10, 01a-S11, 01a-B10–B18, 01a-D10 | `features/admin/stock/*` |

## 3. Module 01b (`apps/client/src/features/owner`)

| Group | Screens | Files |
|---|---|---|
| 01b-A Staff | 01b-S01, 01b-S02, 01b-C01–C04, 01b-D01, 01b-D02, 01b-B03, 01b-B04 | `staff/*` |
| 01b-B Roles | 01b-S03, 01b-S03a, 01b-S04, 01b-S08, 01b-D03 | `roles/*` |
| 01b-C Rest | 01b-S05, 01b-S06, 01b-S07, 01b-S09, 01b-S10, 01b-D04, 01b-B01, 01b-B02, 01b-B05 | `stock-counting/*`, `branches/*`, `account/*`, `teams/*` |

## 4. Module 01c (`apps/client`; owner views are new, AD-35)

| Group | Screens | Files |
|---|---|---|
| 01c-A Hub stock rows | 01c-B02 (+ 404 banner) | `features/admin/stock/*` |
| 01c-B Size groups + stock items | 01c-S08, 01c-S09, 01c-S06, 01c-S07, 01c-D04, B03, B06 | new `features/owner/size-groups/*`, `stock-items/*`; `api/cloud-admin.ts` (client calls only) |
| 01c-C Item form sections | 01c-S01 (size group, stock, mini-form, weighed), 01a-S05 nesting | `features/owner/menu/*` |
| 01c-D Choice groups | 01c-S02, 01c-S03, 01c-S10, 01c-D02, B04, B05 | new `features/owner/choice-groups/*` |
| 01c-E Deals | 01c-S04, 01c-S05, 01c-S11, 01c-D03 | new `features/owner/deals/*` |

## Per group

1. A fresh implementer works TDD where behaviour is touched.
2. It screenshots each state at the frame size with the harness (Vite + headless Chrome over a fake API) and compares it with `design/screens/*.png`.
3. A fresh reviewer checks the group.
4. I run the full gate.
5. I commit: `ui(pulse): <module> <group>`.
