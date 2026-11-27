import { describe, expect, it } from 'vitest';
import { logLines, secretLeaks } from './no-secret';

// L-CLOSE-2: the structural secret check catches real leaks and ignores chance digits in timestamps and ids.
describe('secretLeaks', () => {
  it('finds a PIN key, a value equal to the secret and the secret inside a message', () => {
    expect(secretLeaks({ pin: 'x' }, '1234')).toEqual(['$.pin']);
    expect(secretLeaks({ a: { b: ['1234'] } }, '1234')).toEqual(['$.a.b[0]']);
    expect(secretLeaks({ msg: 'pin 1234 failed' }, '1234')).toEqual(['$.msg']);
    expect(secretLeaks({ err: { message: 'bad 1234' } }, '1234')).toEqual(['$.err.message']);
  });

  it('ignores a timestamp, a seq and an id that merely hold the digits', () => {
    expect(secretLeaks({ time: 1761001234000, seq: 1234, request_id: '01JF1234ABCD', alert_id: 'A1234' }, '1234')).toEqual([]);
  });

  it('logLines parses JSON lines and skips the rest', () => {
    expect(logLines('{"a":1}\nnot json\n{"b":2}\n{"c":')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
