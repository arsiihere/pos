// 03b / 03c admin entries only (/admin/kitchen-screens/, /admin/printers/): the owner kit stack, then the
// 03 admin layer. admin-03.css is not scoped (.pr, .vol, .mode, .paper, …), so it never goes in ui-kit.ts.
import '../../../../packages/ui-kit/tokens.css';
import '../../../../packages/ui-kit/components/bundle.css';
import '../../../../packages/ui-kit/components/admin-03.css';
// IR-25: the printer card anchors its menu (admin-03.css stays a byte copy of the handoff)
import '../../../../packages/ui-kit/components/admin-03-additions.css';
