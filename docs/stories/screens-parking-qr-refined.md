# Screen types / tabs, parking, QR ordering — refined stories (later)

Not part of the 00–05 stabilization. Sections 1–3 are still to be written in a brainstorming session.

## 4. Items found during stabilization

### 4.1 One way to add any device, with a job and the people who may use it (owner, 2026-11-22, from STAB-1)

Today there are three ways to add a device: Approve (cashier kiosk, kitchen screen), Add a phone (one owner), and,
since STAB-1, Add a tablet (shared). The owner finds this confusing. Wanted instead:

- **One pairing flow for every device.** The device opens `/pair` and shows its code; a manager approves it.
- **On approval the manager sets two things:**
  1. **What it does:** Cashier · Kitchen (station) · Assembler (pass point) · Waiter / general.
  2. **Who may use it:** anyone on staff, or only these people (one or several).
- **Both can be changed later** on Devices (add or remove people, change the job) without pairing again.
- A personal phone is then just a device with one person on its list; the Pass tablet is "Assembler, point X".

Points to settle in the spec:

- Kitchen screens have no people list (station session, nobody signs in).
- When the last person on a device's list leaves the staff: lock the device (nobody can sign in) and show it on
  Devices, rather than remove it (today a phone is removed, M38 `owner_removed`).
- Takeover only between people on the list.
- Cost: `devices.owner_staff_id` becomes a list (table, migration, event, command, sign-in check); touches 00, 01b, 03b.
