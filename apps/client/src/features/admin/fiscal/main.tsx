import '../../../app/ui-kit-admin';
import { mount } from '../../../app/mount';
import { createFiscalApi } from './api';
import { FiscalApp } from './Fiscal';

// 05 row H-2: the /admin/fiscal/ entry (shell; the page body is task 31a's).
const api = createFiscalApi({ onSignedOut: () => {} });

mount(<FiscalApp api={api} />);
