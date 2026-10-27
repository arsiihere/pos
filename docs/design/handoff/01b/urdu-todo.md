# 01b — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 01b (§8) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). Task 50b filled `ur.ts` from the 01b `*Urdu.html` screens (`docs/design/handoff/01b/screens`); the keys below have no Urdu in those designs (no error state and no approval help text is drawn in Urdu). `apps/client/src/i18n/i18n.test.ts` checks that every 01b key is either in `ur.ts` or listed here. Tasks 51–55 append their view keys.

16 keys.

| Key | English |
|---|---|
| `roles.approval_help` | The request goes to people with these roles. They approve on their own device with their PIN. |
| `errors.ROLE_NOT_FOUND` | This role no longer exists. The page is refreshed. |
| `errors.STAFF_NAME_TAKEN` | Someone working at this branch already has this name. Add a surname or an initial. |
| `errors.LAST_ADMIN_REQUIRED` | Each branch needs someone who can sign in to the hub admin. Give that to someone else first. |
| `errors.OWN_ADMIN_ACCESS` | You can't remove your own admin access. Call support. |
| `errors.OWN_ADMIN_ACCESS_owner_not_linked` | Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support to link it. |
| `errors.STAFF_LINKED_TO_OWNER` | This profile is linked to the owner login and can't be marked as left. |
| `errors.CONFIG_STALE` | Someone changed this since you opened it |
| `errors.PASSWORD_INVALID` | The current password is wrong. |
| `errors.PASSWORD_UNCHANGED` | The new password must be different from the current one. |
| `errors.PASSWORD_CHANGE_REQUIRED` | Change your password to continue. |
| `errors.reference.role_archived` | This role was archived. Pick another one. |
| `errors.reference.not_at_branch` | This person does not work at this branch. |
| `errors.reference.loop` | This would make someone report to a person in their own team. |
| `errors.reference.one_lead_per_branch` | Pick one person they report to at each branch. |
| `errors.reference.scope_not_allowed` | This permission can't be limited that way. |
