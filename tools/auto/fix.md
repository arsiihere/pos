You are fixing review findings for batch {{BATCH}} of an unattended run. Nobody is watching; never ask questions. No skills, no subagents.

Read docs/reviews/01a-auto/review-{{BATCH}}.md. Fix every Blocker and Should-fix (Nits only if trivial), following .cursor/rules/pos.mdc and the spec docs/specs/01_Restaurant_Setup_Spec_v1.0.2.md:
- TDD: a failing test first where behaviour changes;
- one commit per finding: "fix(01a): batch {{BATCH}} <finding id> <short> [spec §x]";
- run `pnpm test` and `pnpm lint` at the end; both must be green.

If a finding is wrong (the spec says otherwise), don't change code for it; explain why in the reply file.
If a fix would need a spec change, a file far outside the batch's tasks, or anything risky, write the reason to .auto/STOP and end the session.

Write docs/reviews/01a-auto/fix-{{BATCH}}.md: each finding → fixed (commit) / rejected (reason), plus the final test count. Commit it. Never push; never run git reset, rebase or push --force.
