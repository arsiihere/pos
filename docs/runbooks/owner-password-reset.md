# Support runbook: owner password reset and owner link

Spec: 01b §7.5 (B5, B7, D-13), §6.14, §6.15a. Both CLIs run on a cloud host with `DATABASE_URL` set.

The owner app shows no support number unless `VITE_SUPPORT_PHONE` is set at build time (01b §8, owner answer Q3).

## 1. Reset the owner's password

### Before you start: a shell with no session logging

The CLI prints the temporary password to stdout (01b M3). Run it **only in a shell with no session logging**:

- not through an AWS SSM session with session logging on;
- not inside `script`, `asciinema` or any terminal recorder;
- clear the scrollback afterwards (`clear && printf '\033[3J'`, or close the terminal).

### Check it is the owner

**Identity check: PENDING owner decision (P-3). Do not reset without the owner's agreed check.**

The questions below are a minimum only, not enough on their own: a former staff member can answer all of them.

1. the e-mail address they sign in to the owner app with;
2. the restaurant's name and the names of its branches;
3. the name on their own sign-in tile on the hub.

Compare the answers with the data (read only):

```sql
SELECT o.user_id, o.email, o.display_name, t.name AS restaurant,
       ARRAY(SELECT b.name FROM branches b WHERE b.tenant_id = o.tenant_id ORDER BY lower(b.name)) AS branches
  FROM owner_users o JOIN tenants t ON t.tenant_id = o.tenant_id
 WHERE lower(o.email) = lower('<email>');
```

If any answer is wrong, stop: do not reset. If they are all right, still do not reset until P-3 is answered and its check is added here.

### Run the reset

```sh
pnpm --filter @pos/cloud reset-owner-password --email <email>
```

It prints two lines:

```
temporary password: XXXX-XXXX-XXXX-XXXX
valid until: <ISO-8601 UTC>
```

- Read the password to the owner **once, on the phone**. Never send it in writing (no SMS, WhatsApp, e-mail or ticket note).
- Tell the owner it **expires in 24 hours** and that the app asks for a new password at the first sign-in.
- Every session the owner had (every device) is signed out.
- If it expires before the owner uses it, run the CLI again; the old one stops working.
- An unknown e-mail exits 1 and writes nothing.

## 2. Owner login not linked

The owner reports: "Your owner login isn't linked to your staff profile".

1. Check it is the owner (section 1).
2. Ask the owner to read **the name on their own sign-in tile on the hub**. That is the staff row to link. Find it (read only):

   ```sql
   SELECT s.staff_id, s.display_name, s.is_active
     FROM staff s JOIN owner_users o ON o.tenant_id = s.tenant_id
    WHERE o.user_id = '<owner_user_id>' AND s.display_name = '<name on the tile>';
   ```

3. Run the CLI once without `--confirm-name`. It prints the target (name, roles, branches) and exits 1; read them to the owner:

   ```sh
   pnpm --filter @pos/cloud link-owner-staff --owner <owner_user_id> --staff <staff_id>
   ```

4. When the owner confirms, run it with `--confirm-name` set to the name **exactly as the CLI printed it** (case, spaces and punctuation; nothing trimmed):

   ```sh
   pnpm --filter @pos/cloud link-owner-staff --owner <owner_user_id> --staff <staff_id> --confirm-name "<display name>"
   ```

5. The row must be a **qualifying admin at every branch** (active, with a PIN, `access-hub-admin` and `manage-devices` allowed). If the CLI lists branches where it is not, the owner gives that row admin access there in the owner app; then run the CLI again.

**Never link another person's row.** That person could then never be marked as left, and their admin access, not the owner's, would be protected.

## 3. Own admin access

The owner calls about "You can't remove your own admin access" (B7).

1. Check it is the owner (section 1).
2. Explain that this is **blocked by design**: there is one owner per restaurant (B8), and the owner's own staff row is the only admin that is guaranteed to exist. Removing it could leave every branch without anyone who can pair or revoke devices.
3. If the owner wants someone else to run the hub: the owner gives that person admin access (a role with `access-hub-admin` and `manage-devices`) in the owner app. The owner's own access stays.

**Support has no override.** No CLI or SQL removes the owner's admin access, and support never edits staff or roles for the owner.

## 4. Correcting a wrong owner link

If support linked the owner's login to the wrong staff row, re-link it with the same CLI and the same rules as a first link (section 2):

```sh
pnpm --filter @pos/cloud link-owner-staff --owner <owner_user_id> --staff <right staff_id> --confirm-name "<display name>"
```

- the owner's real row (the name on their own sign-in tile);
- the exact `--confirm-name`;
- a target that is a qualifying admin (active, with a PIN, `access-hub-admin` and `manage-devices`) at **every branch of the restaurant**.

This is not an override: the linked row is a qualifying admin at every branch before and after, so the own-admin guard still holds everywhere. The re-link is audited with the old and new `staff_id` (`actor_kind 'cli'`).

If the CLI refuses, it lists the branches where the right row does not qualify. Tell the owner to give that row admin access there in the owner app, then run the CLI again.
