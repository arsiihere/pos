import { describe, expect, it } from 'vitest';
import { parseEvent } from './codecs';
import './index';
import { anItemAdded } from './testing';

// 02b v1.0.20 §4.5 (STAB-5 phase 1, test 37): ItemAdded.part_of is optional at v1 (additive, no upcaster) — the first
// part's order_item_id on every part of a split line; absent on an unsplit line and on every stored event.
describe('[02b v1.0.20 §4.5] ItemAdded.part_of', () => {
  it('[02b #37] parses with part_of; without it the payload has none; an empty part_of is refused', () => {
    const base = anItemAdded();
    const withPart = parseEvent({ ...base, payload: { ...base.payload, order_item_id: 'K-p2', part_of: 'K' } });
    expect((withPart.payload as { part_of?: string }).part_of).toBe('K');
    const plain = parseEvent(base);
    expect('part_of' in (plain.payload as object)).toBe(false);
    expect(() => parseEvent({ ...base, payload: { ...base.payload, part_of: '' } })).toThrow();
  });
});
