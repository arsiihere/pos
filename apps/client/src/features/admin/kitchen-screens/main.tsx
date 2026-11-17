import '../../../app/ui-kit-admin';
import { mount } from '../../../app/mount';
import { webAudioSink } from '../../alerts/sounds';
import { createKitchenScreensApi } from './api';
import { KitchenScreensApp } from './KitchenScreens';

// 03b §3.8, §8 (Q-43): the /admin/kitchen-screens/ entry. The page shows the roster again on any signed-out answer.
const api = createKitchenScreensApi({ onSignedOut: () => {} });

// "Play on this device" (handoff Q-17): one AudioContext, made on the first tap (browsers allow audio after a gesture).
let audio: AudioContext | null = null;
const sink = webAudioSink(() => {
  try {
    audio ??= new AudioContext();
    return audio;
  } catch {
    return null;
  }
});

mount(<KitchenScreensApp api={api} sink={sink} />);
