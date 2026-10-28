# Notifications, requests, table handover and teams: refined stories (draft)

| | |
|---|---|
| Status | **Draft, not yet matured.** Owner requirements from the 2026-10-27 session, written down before any spec. Next step: a brainstorming pass on the open questions (§5), then the specs (§4). |
| Source | Owner, 2026-10-27, while reviewing the 01b design hand-off (`~/Downloads/pos-design-01b-handoff/01b`) |
| README | R21–R24 |
| Owners | **01d** Notifications and requests (new module); **01b** Staff and roles (approvers, reporting lines); **02** Ordering and tables (table handover); **04** Voids and audit (approval requests) |

Story IDs follow `docs/design/inventory/00-index.md`. New IDs: E-NOTIF, E-REQ, E2-HAND, E6-TEAM, E-LOAD, E-FLEX.

---

## 1. Notifications and requests (01d)

### E-NOTIF: a person is told, wherever they are
**As** any staff member, **I need** to be alerted when something needs me, even when my phone is locked or the POS is closed on it, **so that** nothing waits because I didn't look at a screen.

Any staff member can be a target, not only managers: roles are fully custom (R5) and the owner can make any person an approver (E6-TEAM, 01b decision 1A).

**Acceptance criteria**
1. A notification has a target: **one person** (`staff_id`), or **everyone at the branch who holds a permission** (e.g. `approve-void`), or **a person's team** (E6-TEAM).
2. The hub delivers it on every route the target has, at the same time:
   - **R1** an on-screen banner and sound on every POS screen where they are signed in (WebSocket, works today);
   - **R2** a real Android notification with sound on their paired Android phone, even when locked or with the POS closed (thin Android app, §3);
   - **R3** escalation: unanswered after N seconds, it is shown on the branch's always-on screens (cashier, KDS, manager tablet) (Q-N3).
3. Delivery works with **no internet**: every route runs over the restaurant Wi-Fi to the hub.
4. **iPhones:** no locked-phone alert (owner decision R22). An iPhone user sees R1 while the POS page is open; R3 and the in-person fallback (E-REQ AC4) still cover them.
5. The owner is warned when a target has no route that reaches a locked phone, e.g. "No one who can approve voids has the app at Gulberg." (where it is shown: Q-N5).
6. Every notification and every answer is audited (who, when, from which device).

### E-REQ: a request someone else must answer
**As** a staff member, **I need** to send a request (approve a void, accept a table) to the right person and see the answer on my own device, **so that** the approver doesn't have to walk to me.

**Acceptance criteria**
1. A request is a notification with **Approve / Reject** (or **Accept / Decline**) and stays **pending** until answered.
2. The answerer opens it on **their own** device (phone, tablet, cashier), checks the details, and confirms with **their own PIN**.
3. The requester's device shows the answer at once (approved / rejected / declined, by whom).
4. **Fallback that always works:** the answerer can come to the requester's device and confirm there with their PIN (the old in-person path). A request never depends on delivery working.
5. Only a person who holds the right at that moment can answer; the hub checks it when the answer arrives, not when the request was sent.
6. Two people answering at once: the first answer wins, the second sees "Already approved by Imran".
7. Unanswered: no automatic cancel (Q-N1, Q-N2 recommended answers); what it blocks follows the owning module (a pending void blocks closing the bill, foundation §4.5).

## 2. Table handover (02)

### E2-HAND: a table moves only when the receiver accepts
**As** a waiter or order taker, **I need** a table moved to another person or floor only after that person accepts it, **so that** nobody gets a table "blindly" without knowing.

Owner, verbatim: "the other person have to approve it… no one is blindly shifting tables from there end to another without being awared."

**Acceptance criteria**
1. Moving a table (to another person, or to a floor that is someone else's) creates an E-REQ request to the receiver.
2. The table **does not move** until the receiver accepts. Until then it stays with the sender and shows "Waiting for Bilal to accept".
3. Decline → the table stays with the sender, who is told.
4. The receiver sees the table, its orders and its running bill before accepting.
5. Not answered in N minutes → escalate to the sender's team lead or to whoever holds the right to move tables (Q-H2).
6. Not yet in any story: E2-TBL covers table locks and transfers (D5/D39/D51/D61), but not acceptance. 02's spec must define it on top of the table lock rules.

## 3. The thin Android app (01d)

The only way to get a locked-phone alert with no internet (R22).

1. A small Android shell (Capacitor, already the foundation's Android stack) that opens the **same pages the hub serves**; page updates still come from the hub, no reinstall.
2. One native part: a **background service** that keeps a connection to the hub on the Wi-Fi and raises Android notifications.
3. Installed as an APK during phone pairing (no Play Store). Pairing also switches off battery optimisation for the app, with per-brand steps (Xiaomi, Oppo, Vivo, Realme).
4. Replaces the browser for **Android** staff phones (changes README R14, 00 M38: phones were "browser, no install"). iPhones stay on the browser.
5. Tablets and the cashier station do not need it; their POS page stays open.
6. Rough size: 1–2 weeks with testing on real phones (estimate, not yet specced). Open checks carried from 00 MQ7 (Capacitor cleartext to private addresses).

## 4. Teams and reporting lines (01b data, used by 01d and 02)

### E6-TEAM: a person reports to another person
**As** the owner, **I need** to put people in teams, a person reporting to another person, **so that** instructions and alerts go to the right team and not to everyone.

Owner's example: a manager has a team of cooks, order takers and delivery staff. A floor has 2 order takers, each with 2 waiters under them. Anything about one order taker's work goes to **that** order taker's waiters.

**What we understood (to confirm, Q-T1 to Q-T6)**
1. A reporting line is **person to person** ("Bilal reports to Hamza"), set by the owner in the staff form (01b-S02 gets a **Reports to** field; not in the current design).
2. Roles stay what they are, a set of permissions (R5). A team is not a role, because two waiters with the same role can be in different teams.
3. Teams can nest: waiter → order taker → manager.
4. A notification target can be "my team" (E-NOTIF AC1), and routing uses the line: e.g. an order taker's instruction goes to their waiters, a table handover escalates to the sender's lead.

**Acceptance criteria (draft)**
1. Each staff member has at most one **Reports to** person per branch (Q-T2).
2. No loops (A reports to B reports to A); the server rejects them.
3. A person who leaves: their team is shown to the owner to reassign; until then alerts for that team go to the next person up.
4. The team tree is visible to the owner (01b screen, to be designed).
5. Reporting lines never grant permissions by themselves; only roles do (R5).

## 5. Workload, capacity and staffing stats (owner idea, 2026-10-27)

Owner, in short: teams should give **real** stats on which area gets the most traffic, so the manager can see where adding a person breaks the blockage. If tables are quietly shuffled between people, the real load is never seen. So we need realistic capacity data per person or role (how many tables or guests they can handle). A delivery person can have a **main and a secondary** role and work as a waiter when there's no delivery. A cook who has finished his biryani batch and is free for hours should be shown as free, to be used elsewhere.

### E-LOAD: see the real load per area and per person
**As** the manager or owner, **I need** to see how much load each area, team and person carries compared with what they can handle, **so that** I add or move people where it actually helps.

**Acceptance criteria (draft)**
1. **Capacity is data** (R18): e.g. "a waiter handles up to 4 tables or 16 guests at once". Set per role as a default, and per person as an override (Q-L1).
2. **Real load is measured, not typed:** open tables, guests and orders per person, per team and per floor or area, over the day, from the events the POS already records (table owner, handovers E2-HAND, orders). Kitchen load per station and cook from the timing engine (03a).
3. Every move of a table (E2-HAND) is kept with who moved it and why, so a busy area doesn't look calm because its tables were shuffled away.
4. **Over capacity is shown:** "Ground floor: 9 tables open, capacity 8 (2 waiters × 4)". History shows the busy hours per area, so the owner can plan staffing.
5. Stats come in two places: live for the manager during service, and daily or weekly for the owner (07 Owner View, P2 dashboards).

### E-FLEX: main and secondary roles, and free people
**As** the manager, **I need** people with a second skill to be used when their main job is quiet, **so that** nobody stands idle while another area is overloaded.

**Acceptance criteria (draft)**
1. A person can have a **main** role and one or more **secondary** roles (today a person can already have several roles, but none is marked main).
2. **Availability** per person: on their main job, free, or helping elsewhere (Q-L4: set by the person, by the manager, or detected).
3. The POS **suggests** a move when one area is over capacity and someone with that skill is free: "Ali (delivery) is free. Ground floor is over capacity. Ask Ali to help?" The manager decides; nothing moves on its own (Q-L5).
4. Cooks: when a cook's station has nothing queued for a while (e.g. the biryani batch is done), the POS shows them as free and suggests stations that are behind (03a knows each station's queue).
5. Secondary-role work is counted in the stats separately from main-role work.

### Phasing (suggestion, to confirm)
- **Pilot (P1):** record the data from day one: table owner and every handover, team, main and secondary roles, capacity fields. Without this, stats later can't be rebuilt.
- **Next (P2):** live load and over-capacity view for the manager, daily stats for the owner, "free" suggestions.

## 6. Open questions (to mature before the specs)

Questions that change staff or role data are settled in the 01b spec and live in `docs/design/open-questions/01b-staff-roles.md` (Q17–Q21, including main and secondary roles, E-FLEX AC1). The rest wait for 01d, 02, 03a and 07.

| # | Question | Suggested answer |
|---|---|---|
| Q-N1 | No approver signed in anywhere: what happens? | The request waits ("Waiting for approval, no one online"); in-person PIN fallback (E-REQ AC4). |
| Q-N2 | Does an unanswered request expire? | No; it stays pending, and what it blocks follows the owning module. |
| Q-N3 | Escalation delay before always-on screens show it? | 60 s, a branch setting (data, R18). |
| Q-N4 | Sound and vibration: one sound for all, or per kind (urgent void vs table)? | Two sounds: urgent and normal. |
| Q-N5 | Where is the "no one can be reached" warning shown? | Owner app and hub admin. |
| Q-N6 | Should a notification also be readable later (an inbox)? | Yes, a short list of the last day's notifications per person. |
| Q-H1 | Can a table move to a floor without naming a person (whoever owns the floor)? | Only when the floor has one person; otherwise the sender picks a person. |
| Q-H2 | Handover not answered in N minutes: escalate to whom? | The sender's lead (E6-TEAM), else anyone allowed to move tables. |
| Q-H3 | Can a manager move a table without acceptance (e.g. a waiter went home)? | Yes, with `force-release-table-lock`, audited. |
| Q-T1 | Is the reporting line person → person (as understood), or role → role? | Person → person. **Moved to 01b Q17** (`docs/design/open-questions/01b-staff-roles.md`). |
| Q-T2 | Can someone report to two people (e.g. day and night lead)? | No, one per branch in P1. **Moved to 01b Q18** (`docs/design/open-questions/01b-staff-roles.md`). |
| Q-T3 | Do teams change per shift or per day? | Fixed until the owner changes them in P1. |
| Q-T4 | What exactly is "an order taker's instruction" to their waiters (serve table 5, food ready at the pass, a free-text message)? | Needs examples from the owner. |
| Q-T5 | Should a lead be able to approve only for their own team (a "my team" scope on approvals)? | Needs the owner's answer. **Moved to 01b Q19** (`docs/design/open-questions/01b-staff-roles.md`). |
| Q-T6 | Does a lead see their team's tables and orders? | Needs the owner's answer. |
| Q-A1 | Do any managers or staff use iPhones? | Owner: no one at the restaurant today; iPhones get no locked-phone alert (R22). |
| Q-A2 | The foundation stack says the Android client is "React + Capacitor (bundled assets + local SQLite command queue)"; §3 here says the app loads the hub's pages. Which one? (The foundation is frozen, D64: the 01d spec records the choice as a README decision.) | Load the hub's pages, so every page update ships from the hub with no reinstall; keep the IndexedDB queue the browser clients already use (R15). |
| Q-L1 | Capacity in what unit: tables, guests, open orders, or a mix? Per role, per person, or both? | Tables and guests; a role default with a per-person override. **Moved to 01b Q21** (`docs/design/open-questions/01b-staff-roles.md`). |
| Q-L2 | What is an "area": a floor, part of a floor, delivery, takeaway, a kitchen station? | Floor, plus delivery and takeaway as areas; stations for the kitchen. |
| Q-L3 | How is a cook's capacity measured (items at once, batches per hour)? | From the timing engine's station data in 03a, not typed. |
| Q-L4 | Who marks a person free or busy: themselves, the manager, or the POS by itself? | The POS detects it (no tables, empty station queue); the manager can override. |
| Q-L5 | Should the POS ever move someone or a table by itself? | No; it only suggests, and the manager decides. |
| Q-L6 | Live view in P1, or only data capture in P1 and stats in P2? | Capture in P1, stats in P2 (§5 Phasing). |
