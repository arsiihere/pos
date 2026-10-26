import { afterEach, describe, expect, it, vi } from 'vitest';
import { armKeepalive } from './server';

describe('websocket keepalive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[00 §6.17 Q8] pings every 15 s; each pong marks the device seen and resets the 30 s kill timer; no pong → terminate', () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const socket = { ping: vi.fn(), terminate: vi.fn(), on: (event: string, listener: () => void) => void (listeners[event] = listener) };
    const seen = vi.fn();
    const stop = armKeepalive(socket as never, seen);
    vi.advanceTimersByTime(15_000);
    expect(socket.ping).toHaveBeenCalledTimes(1);
    listeners.pong!();
    expect(seen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_000);
    expect(socket.terminate).not.toHaveBeenCalled();
    listeners.pong!();
    expect(seen).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    stop();
  });
});
