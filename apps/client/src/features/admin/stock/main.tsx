import { createHubAdmin } from '../../../api/hub-admin';
import { mount } from '../../../app/mount';
// 04 B03 (01a v2.5 G-21): the DAY_CLOSE_BLOCKED banner list (owner kit addition, Stock page only), after bundle.css
import '../../../../../../packages/ui-kit/components/pulse-04-admin.css';
import '../../../../../../packages/ui-kit/components/pulse-04-admin-additions.css';
import { StockApp } from './StockApp';

// §8.2: StockApp shows the roster again on any `signed_out` answer, so nothing more is needed here.
const api = createHubAdmin({ onSignedOut: () => {} });

mount(<StockApp api={api} />);
