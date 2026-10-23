/// <reference types="node" />
import { Writable } from 'node:stream';

export function createLogCapture(): { stream: Writable; text(): string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}
