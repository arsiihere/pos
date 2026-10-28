# 01b — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` added for 01b (§8) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). Task 50b filled `ur.ts` from the 01b `*Urdu.html` screens (`docs/design/handoff/01b/screens`); the keys below have no Urdu in those designs (no error state and no approval help text is drawn in Urdu). `apps/client/src/i18n/i18n.test.ts` checks that every 01b key is either in `ur.ts` or listed here. Tasks 51–55 append their view keys.

143 keys.

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
| `staff.left_on` | Left on {date} |
| `staff.empty_title` | Add your first staff member |
| `staff.empty_body` | Each person gets a name on the sign-in screen, one or more roles, the branches they work at, and a PIN. |
| `staff.empty_roles` | {n} roles are ready: {names}. You can change them in Roles. |
| `staff.no_match` | Nobody matches “{q}” |
| `staff.no_match_body` | Check the spelling, or look under Left. |
| `staff.branch_empty` | Nobody works at {branch} yet |
| `staff.branch_empty_body` | Add staff, or give someone this branch under Works at. |
| `staff.left_empty` | Nobody has left |
| `staff.saved` | {name} saved. Changes reach each branch within about a minute. |
| `staff.moved` | {name} marked as left. {n} people now report to someone else. |
| `staff.new_title` | New staff member |
| `staff.name_required` | Type a name, up to 40 letters. |
| `staff.roles_required` | Pick at least one role. |
| `staff.works_at_required` | Pick at least one branch. |
| `staff.nobody` | Nobody |
| `staff.no_floors` | This branch has no floors yet. |
| `staff.pin_none` | No PIN yet. They are not on the sign-in screens until one is set. |
| `staff.never_pick` | Permission to block |
| `staff.never_remove` | Allow {permission} again |
| `staff.status_left` | Left. Can’t sign in anywhere. |
| `staff.bring_back` | Bring back |
| `staff.bring_back_role` | Their only role was archived. Pick another role, then save. |
| `staff.left_title` | Mark {name} as left? |
| `staff.left_body` | They can’t sign in anywhere, and their phone is removed from their branches within about a minute. Their name stays on old orders. You can bring them back later. |
| `staff.left_moves` | {names} at {branch} will report to {lead} instead. |
| `staff.left_moves_nobody` | {names} at {branch} will report to nobody. |
| `staff.left_blocked_title` | {name} can’t be marked as left |
| `staff.left_offline` | Marking as left needs the internet. Nothing changed. |
| `staff.fix_count` | {n} things to fix |
| `staff.fix_one` | 1 thing to fix |
| `staff.stale_body` | Reload shows the current version. Your changes here are not saved. |
| `staff.reload` | Reload |
| `staff.offline` | Can’t save — no internet. Your changes are kept on this page. |
| `staff.can_fewer` | Show fewer |
| `staff.grant.allowed` | Allowed |
| `staff.grant.requires_approval` | Needs approval |
| `staff.grant.not_granted` | Not allowed |
| `staff.grant.denied` | Never |
| `staff.grant.from` | from {roles} |
| `staff.grant.approved_by` | approved by {roles} |
| `staff.grant.no_role` | no role gives it |
| `staff.grant.blocked` | blocked for this person |
| `staff.scope.branch` | at the branch |
| `staff.scope.my_floors` | on their floors |
| `staff.scope.my_team` | for their team |
| `staff.scope.my_stations` | at their stations |
| `staff.scope.own_tables` | at tables they open |
| `staff.or` | or |
| `staff.not_found` | This person no longer exists. |
| `staff.not_found_body` | Someone removed them, or the link is old. |
| `staff.pin.new` | New PIN |
| `staff.pin.help` | 4 to 6 digits. Two people may have the same PIN. |
| `staff.pin.again` | Type it again |
| `staff.pin.short` | PIN is 4 to 6 digits. |
| `staff.pin.mismatch` | The two PINs are different. Type them again. |
| `staff.pin.signs_out` | {name} is signed out on every device when you save. Anything they haven’t sent stays on the device. |
| `staff.pin.save` | Save PIN |
| `staff.pin.saving` | Saving… |
| `staff.pin.saved_title` | {name}’s PIN is saved |
| `staff.pin.saved_body` | It works at {branches} in about a minute. Tell {name} the new PIN. |
| `staff.pin.first` | They now appear on the sign-in screens at {branches}. |
| `staff.pin.done` | Done |
| `staff.pin.offline` | A new PIN needs the internet. Nothing changed. |
| `staff.pin.offline_body` | {name}’s old PIN still works. Try again when you are online. |
| `staff.pin.try_again` | Try again |
| `staff.pin.left` | {name} was marked as left, so a PIN can’t be set. |
| `staff.pin.left_body` | Bring them back from Staff › Left first. |
| `staff.pin.hand_back` | Hand the phone back to {name}. |
| `staff.pin.phone_saved_body` | It works at {branches} in about a minute. Tell {name} the new PIN. Take the phone back. |
| `roles.nobody_has` | nobody has it |
| `roles.archived_on` | Archived {date} |
| `roles.idle_range` | 1 to 240 minutes |
| `roles.idle_saving` | Saving… |
| `roles.idle_not_saved` | Not saved |
| `roles.archive` | Archive |
| `roles.restore` | Restore |
| `roles.restore_explain` | A restored role has nobody. Give it to people in Staff. |
| `roles.archived_empty` | No archived roles |
| `roles.archived_empty_body` | A role you archive shows here, and you can restore it. |
| `roles.name_taken_restore` | Another active role is called {name}. Rename one first. |
| `roles.archive_title` | Archive {name}? |
| `roles.archive_body` | {n} people have it. They keep their other roles. Their stock counting through this role stops. |
| `roles.archive_body_none` | Nobody has it. You can restore it from Archived. |
| `roles.archive_confirm` | Archive {name} |
| `roles.blocked_title` | {name} can’t be archived |
| `roles.blocked_staff` | {names} would have no role left. |
| `roles.blocked_staff_body` | Give them another role first. |
| `roles.blocked_role` | {name} approves requests for {names}. |
| `roles.blocked_role_body` | Change who approves there first. |
| `roles.open` | Open {name} |
| `roles.ok` | OK |
| `roles.new_title` | New role |
| `roles.name_required` | Type a name, up to 40 letters. |
| `roles.name_taken` | Another role is called {name}. |
| `roles.scope.branch` | Whole branch |
| `roles.scope.my_stations` | Their stations |
| `roles.scope.own_tables` | Tables they open |
| `roles.scope_help.my_stations` | stations set in Stock counting |
| `roles.approver_required` | Pick at least one role to approve. |
| `roles.this_role` | This role |
| `roles.snapped` | Snapped back — see the message |
| `roles.own_admin_title` | You can’t remove your own admin access |
| `roles.last_admin_title` | {name} needs to keep this |
| `roles.last_admin_body` | At least one person at {branches} must be able to open the hub admin and pair screens. |
| `roles.not_found` | This role no longer exists. |
| `roles.not_found_body` | Someone archived or removed it, or the link is old. |
| `teams.count_one` | 1 person |
| `teams.flat` | No reporting lines yet. Set “Reports to” on a person. |
| `teams.empty` | Nobody works at {branch} yet. |
| `teams.empty_body` | Give people {branch} under “Works at” on their page. |
| `teams.loaded_at` | Showing the teams from {time}. |
| `counting.nobody_counts_body` | Its items will show “Not counted today” every morning until someone is chosen. |
| `counting.unsaved_one` | 1 station changed. Save to send it. |
| `counting.unsaved` | {n} stations changed. Save to send them. |
| `counting.unsaved_body` | Saving sends who counts every {branch} station at once. |
| `counting.saved` | Stock counting at {branch} saved. Changes reach each branch within about a minute. |
| `counting.changed` | Something changed. Reload and pick again. |
| `counting.changed_body` | A person left {branch}, or a role or station was archived, since you opened this page. |
| `counting.no_stations` | {branch} has no stations yet. |
| `counting.no_stations_body` | Add them in Setup › Kitchen stations. |
| `counting.open_stations` | Open Kitchen stations |
| `counting.picker_title` | Who counts {station}? |
| `counting.people_at` | People who work at {branch} |
| `counting.roles` | Roles |
| `counting.roles_help` | A role means everyone with that role at {branch}, now and later. |
| `counting.done` | Done |
