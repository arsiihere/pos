import type { PosEvent } from '@pos/events';
import type { SocketCtx } from './catch-up.js';

export type Audience = (event: PosEvent, socket: SocketCtx) => boolean;

const audiences = new Map<string, Audience>();

export function registerEventAudience(eventType: string, audience: Audience): void {
  const prior = audiences.get(eventType);
  if (prior === undefined) {
    audiences.set(eventType, audience);
    return;
  }
  audiences.set(eventType, (event, socket) => prior(event, socket) || audience(event, socket));
}

export function audienceAllows(event: PosEvent, socket: SocketCtx): boolean {
  const audience = audiences.get(event.event_type);
  return audience !== undefined && audience(event, socket);
}

registerEventAudience('ClockAlarm', () => true);
registerEventAudience('SessionEnded', (event, socket) => event.payload.session_id === socket.sessionId);
registerEventAudience('DeviceTokenRotated', (event, socket) => event.payload.device_id === socket.deviceId);
registerEventAudience('DeviceRevoked', (event, socket) => event.payload.device_id === socket.deviceId);
