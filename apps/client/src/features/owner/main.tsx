import { createCloudAdmin } from '../../api/cloud-admin';
import { mount } from '../../app/mount';
import { navigate } from '../../app/router';
import { App } from './App';

// §8.1: a refused refresh sends the owner back to login; 01b §8: PASSWORD_CHANGE_REQUIRED to the password view.
const api = createCloudAdmin({
  onLoggedOut: () => navigate('/login'),
  onPasswordChangeRequired: () => navigate('/account/password'),
});

mount(<App api={api} />);
