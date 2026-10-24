/// <reference types="node" />
import type { FastifyInstance } from 'fastify';

const DEFAULT_HOST = '192.168.10.2:3000';

interface InjectWS {
  (
    path: string,
    upgrade: { headers?: Record<string, string>; socket?: { remoteAddress?: string } },
    options?: { onOpen?: (socket: LiveSocket) => void },
  ): Promise<LiveSocket>;
}

interface LiveSocket {
  send(data: string): void;
  close(): void;
  terminate(): void;
  on(event: 'message', cb: (data: Buffer | string) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
}

export interface WsClient {
  messages: unknown[];
  send(body: unknown): void;
  close(): void;
  untilClose(ms?: number): Promise<{ code: number; reason: string }>;
  untilCount(count: number, ms?: number): Promise<void>;
}

export async function connectWs(
  app: FastifyInstance,
  o?: { path?: string; headers?: Record<string, string>; remoteAddress?: string },
): Promise<WsClient> {
  await app.ready();
  const injectWS = (app as FastifyInstance & { injectWS?: InjectWS }).injectWS;
  if (injectWS === undefined) throw new Error('injectWS is not available');
  const messages: unknown[] = [];
  let closed: { code: number; reason: string } | undefined;
  let resolveClose: (value: { code: number; reason: string }) => void = () => undefined;
  const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
    resolveClose = resolve;
  });
  let notify: () => void = () => undefined;
  const ws = await injectWS(
    o?.path ?? '/ws',
    {
      headers: { host: DEFAULT_HOST, ...o?.headers },
      socket: { remoteAddress: o?.remoteAddress ?? '192.168.10.5' },
    },
    {
      onOpen(socket) {
        socket.on('message', (data) => {
          messages.push(JSON.parse(data.toString()));
          notify();
        });
        socket.on('close', (code, reason) => {
          closed = { code, reason: reason.toString() };
          resolveClose(closed);
          notify();
        });
      },
    },
  );
  return {
    messages,
    send(body) {
      ws.send(JSON.stringify(body));
    },
    close() {
      ws.terminate();
    },
    untilClose(ms = 1_000) {
      if (closed !== undefined) return Promise.resolve(closed);
      return withTimeout(closePromise, ms);
    },
    async untilCount(count, ms = 1_000) {
      const steps = Math.ceil(ms / 20);
      for (let i = 0; i < steps && messages.length < count; i += 1) {
        await new Promise<void>((resolve) => {
          notify = resolve;
          setTimeout(resolve, 20);
        });
      }
      if (messages.length < count) throw new Error(`expected ${count} frames, got ${messages.length}`);
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
