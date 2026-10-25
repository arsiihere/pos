import { createCloudAdmin } from '../../api/cloud-admin';
import { mount } from '../../app/mount';
import { navigate } from '../../app/router';
import { App } from './App';

// §8.1: a refused refresh sends the owner back to login.
const api = createCloudAdmin({ onLoggedOut: () => navigate('/login') });

mount(<App api={api} />);
