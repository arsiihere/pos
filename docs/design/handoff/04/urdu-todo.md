# 04 — Urdu still to translate

## VU1 (voids)

Keys in `apps/client/src/i18n/en.ts` added by lane VU1 (handoff 04 CHANGES §2.1–§2.8) with no entry in `ur.ts`. They show in English on an Urdu page until translated (01a S49 fallback). The Urdu that frames `VoidSheetUrdu`, `VoidPendingUrdu` and `AnswerVoidUrdu` show is in `ur.ts`. `apps/client/test/voids-i18n.test.ts` checks that every VU1 key is either in `ur.ts` or listed here.

40 keys.

| Key | English | Note |
|---|---|---|
| `void.can_void` | You can void this · comes off the bill now |  |
| `void.deal_portions` | Deal portions |  |
| `void.weighed_whole` | Weighed item — the whole line is voided. |  |
| `void.disposition.other.placeholder` | What happens to it? (required) |  |
| `void.disposition.moved_partly` | Cooked parts to stock, the rest released |  |
| `void.disposition.moved_partly.hint` | Cooking or cooked parts go to ready stock; parts not started are let go |  |
| `void.block.stock_not_tracked` | Stock not tracked for this item |  |
| `void.block.not_movable_stage` | Not cooking or cooked |  |
| `void.block.move_not_granted` | You can't move to stock |  |
| `void.block.day_closed` | Business day closed |  |
| `void.out.staff_meal` | Staff meal |  |
| `void.out.other` | Other |  |
| `void.out.parts_below` | Parts below |  |
| `void.stage.cooked` | Cooked |  |
| `void.note.label` | Why? |  |
| `void.note.count` | {n}/200 |  |
| `void.note.placeholder` | Write why |  |
| `void.note.required` | Write why — needed for Other |  |
| `void.amount.direct` | Leaves the bill and the kitchen at once. |  |
| `void.amount.not_weighed` | Not weighed yet, so nothing is on the bill for it. |  |
| `void.amount.still_answers` | A manager still answers. |  |
| `void.do` | Void |  |
| `void.write_why_first` | Write why first |  |
| `void.comp_waiting` | Comp waiting |  |
| `void.loading` | Reading what this void does… |  |
| `void.err.VOID_PENDING` | A void is already waiting on this item |  |
| `void.err.COMP_PENDING` | A comp is waiting on this item — decide it first |  |
| `void.err.COMP_PENDING.hint` | Ask a manager to answer the comp, or withdraw it from the line. |  |
| `void.err.ITEM_WRONG_STAGE` | Not started — use Remove |  |
| `void.err.ITEM_WRONG_STAGE.hint` | Removing is free and needs no approval. |  |
| `void.err.ORDER_BILLED` | Bill closed — refunds are at the counter |  |
| `void.err.not_allowed.again` | Choose where it goes again. |  |
| `void.err.offline.hint` | Voids need the hub; nothing was sent. |  |
| `void.toast.asked` | Void asked — waiting for approval |  |
| `void.toast.asked.sub` | {item} ×{n} |  |
| `void.toast.voided` | Voided |  |
| `void.toast.voided.sub` | {item} ×{n} · {amount} off the bill |  |
| `comp.needs_manager` | Needs a manager's approval · online only | Frame VoidSheetUrdu: مینیجر کی منظوری چاہیے · صرف آن لائن (02b key, listed in 02b/urdu-todo.md) |
| `comp.units` | Units | Frame VoidSheetUrdu: تعداد (02b key, listed in 02b/urdu-todo.md) |
| `comp.ask` | Ask for approval | Frame VoidSheetUrdu: منظوری مانگیں (02b key, listed in 02b/urdu-todo.md) |

Needs native review as well (in `ur.ts`, no frame shows them): `line.void` (ووئڈ, was منسوخ… for the 02b placeholder).
