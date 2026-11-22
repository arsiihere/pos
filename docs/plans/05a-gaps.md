# 05a gap sweep (plan P0.2)

Read against the stab tip **`fix/stab-tablet-pairing` @ `44112286`** (local ref, 44 commits ahead of `origin`), on 2026-11-23, read-only from `~/pos-05a`. Spec: `05a_Device_Access_Screens_Spec_v1.0.md`. Every file:line the spec cites in §2–§11 was opened at that sha.

## 1. Cites that moved but keep their meaning (plan patched; no ruling needed)

| Spec cite | At the stab tip | Note |
|---|---|---|
| `admin/page.ts:33-34, 880-1025` (Add a phone / Add a tablet views) | `admin/page.ts:34, 132-133, 254, 641-642, 704-708, 930-976` | same STAB-1 pieces; all removed in task 15 |
| `admin/page.ts:932-950` (`#add-tablet`) | `:949-976` | same |
| `pair-page.ts:359-374` (`t` / `d` branch) | `:252-258` (`d` = tablet), `:321-329` (token POST) | same branch |
| `AnswerSheet.tsx:412-415` ("Approve here") | `:6, 41, 244, 314-333` (`InPersonPick`, `herepin`) | same path |
| `void-items.ts:71` (handler passes `ctx.permission.approver_role_ids`) | `voids/commands/void-items.ts:71` (the `requires_approval` test) + `voids/kind.ts:167-170, 206` (the roles passed) | same meaning: roles come from `ctx.permission` |
| `comp-line.ts` | `orders/commands/comp-line.ts:206` | same |
| `kds/device-roles.ts:78-82` (point resolver) | `:77-82` (`POINT_SQL`, `device_type = 'tablet'`) | same |
| `admin/page.ts:774-777` ("Use as Pass tablet") | to re-find in task 33 (grep "Pass tablet") | K-2 |

Every other cite matched at the stab tip as written, or within ±2 lines:
- `approve-pairing-request.ts:15-20, 379-383, 424-428`, `apply-directory.ts:426`;
- `alerts/bindings.ts:99`, `alerts/routes.ts:115-119`, `alerts/targets.ts:441-444, 516-528`;
- `kds/device-roles.ts:36, 64-75`, `kds/commands/device-role.ts:35, 39-44`, `print/routes.ts:109-113`;
- `auth/guards.ts:196, 239-250`, `bootstrap-tokens.ts:9-44` (line 40 `device_id: 'hub'`);
- `commands/route.ts:144-146, 353-373`, `commands/registry.ts:28, 44`, `queries/registry.ts:19, 31, 106, 119`;
- `auth/staff-session.ts:33-35`, `server.ts:36, 92, 177`, `queries/devices.ts:24`, `queries/kds-config.ts:19-21, 89-91`;
- `alerts/raise.ts:98`, `orders/audiences.ts:61`, `db/migrate.ts:66-79`, `projections/registry.ts:71, 99`;
- `socket.ts:90-94`, `StaffApp.tsx:500-510`, `shell/layout.ts:4`, `BindDialog.tsx`, `PassScreen.tsx:130`;
- `billing/kinds/index.ts:53`, and 05 v1.0.34 `:656-657` (`petty_cash`, `shift_variance`).

## 2. G-rows

| # | Finding | Options | Rec | State |
|---|---|---|---|---|
| G-a | A staff device with no profile | — | — | **ruled** (owner R-1, 2026-11-23 03:35 PKT): permissions as `everyone`; sign-in by today's rule. Lands in 05a v1.0.1 §3.3a / §3.5 notes |
| G-b | 05a §4.2 says the audit detail of `device_profile_set` holds `people: display names`. 04's audit rule says the opposite: "names are never part of an entry (joined at read)" (`packages/domain/src/audit.ts:3` at the stab tip; 04 §3.6). Two approved specs disagree | (a) the detail stores `staff_ids`, and `audit-log` joins names from `staff_names` at read, like every other action; 05a §4.2 text corrected in v1.0.1. (b) store names in the detail (changes 04's rule, needs a 04 rule change) | **(a)** | **needs the owner** |
| G-c | PL-2 check: does approved text in 05, 02b or 00 §8 contradict rows B-1 or C-1? | — | — | **no contradiction found**: 05 v1.0.34 has no in-person answer text and no counter rule that 05a changes; `kiosk_home` appears in no spec but 05a; 02b v1.0.24 has no kiosk-home text |
| G-d | `alerts/raise.ts:30` says "`ctx.permission` is never read (01d v0.4 m7)". 05a §3.3a has `raise` read `ctx.permission.masked`. Approved 05a row D-2 covers this change; `CommandCtx` carries `permission`, and a tick ctx never raises a downgraded request | the 01d bump (P0.5) restates the m7 sentence ("read only for `masked === 'downgraded'`, 05a D-2") with a marker | apply under D-2 | **fixable under the approved row** (no ruling needed) |

## 3. Facts checked that the plan relies on

- `mayAnswer` checks `self` first (`targets.ts:517`). Its `holders` branch already requires the answerer's grant `allowed` with a scope covering the requester (`:522-527`), which is what §3.9 rule 1(b) needs.
- `requestPart` (`raise.ts:122-146`) already builds `holders` (permission in `base_permission`) and `named` (receiver). The downgraded raise only picks one of them in place of `approval`.
- `endStaff` already ends `staff` **and** `admin` sessions (`apply-directory.ts:426`).
