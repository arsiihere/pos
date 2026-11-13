import '../../../app/ui-kit-admin';
import { mount } from '../../../app/mount';
import { createPrintersApi } from './api';
import { PrintersApp } from './Printers';

// 03c §8 (Q-43): the /admin/printers/ entry. The page shows the roster again on any signed-out answer.
const api = createPrintersApi({ onSignedOut: () => {} });

mount(<PrintersApp api={api} />);
