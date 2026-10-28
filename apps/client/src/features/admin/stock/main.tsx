import { createHubAdmin } from '../../../api/hub-admin';
import { mount } from '../../../app/mount';
import { StockApp } from './StockApp';

// §8.2: StockApp shows the roster again on any `signed_out` answer, so nothing more is needed here.
const api = createHubAdmin({ onSignedOut: () => {} });

mount(<StockApp api={api} />);
