import type { PosEvent } from '@pos/events';
import type { SocketCtx } from './catch-up.js';

export type Audience = (event: PosEvent, socket: SocketCtx) => boolean;

const audiences = new Map<string, Audience[]>();

export function registerEventAudience(eventType: string, audience: Audience): () => void {
  const list = audiences.get(eventType) ?? [];
  list.push(audience);
  audiences.set(eventType, list);
  return () => {
    const current = audiences.get(eventType);
    if (current === undefined) return;
    const index = current.lastIndexOf(audience);
    if (index < 0) return;
    current.splice(index, 1);
    if (current.length === 0) audiences.delete(eventType);
  };
}

export function audienceAllows(event: PosEvent, socket: SocketCtx): boolean {
  const list = audiences.get(event.event_type);
  return list !== undefined && list.some((audience) => audience(event, socket));
}

registerEventAudience('ClockAlarm', () => true);
registerEventAudience('SessionEnded', (event, socket) => event.payload.session_id === socket.sessionId);
registerEventAudience('DeviceTokenRotated', (event, socket) => event.payload.device_id === socket.deviceId);
registerEventAudience('DeviceRevoked', (event, socket) => event.payload.device_id === socket.deviceId);
