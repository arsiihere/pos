import { describe, expect, it } from 'vitest';
import { WsClientMessage } from './ws';

describe('ws', () => {
  it('[00 §6.21, M12] WsClientMessage accepts auth and ack only', () => {
    expect(WsClientMessage.safeParse({ type: 'auth', device_token: 'd', session_token: 's' }).success).toBe(true);
    expect(WsClientMessage.safeParse({ type: 'ack', last_seq: 1 }).success).toBe(true);
    expect(WsClientMessage.safeParse({ type: 'catch_up', as_of_seq: 1, state: {} }).success).toBe(false);
    expect(WsClientMessage.safeParse({ type: 'error', error: { code: 'X', message: 'm' } }).success).toBe(false);
  });
});
