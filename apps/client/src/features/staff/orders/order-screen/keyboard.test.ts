import { aBranchConfig } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { keyEntries, parseKeyQuery, suggest } from './keyboard';

// 02b-TK A2 item 2 (frame KeyboardMode; MAPPING TK-S02; CHANGES §3 Menu "Keyboard: / focuses search, 4n Enter adds 4
// naan"): the menu search of the keyboard speed mode. A number prefix is the quantity; the rest finds items by name,
// by the start of a word, by the initials of the item / variant names ("hk" = half karahi) or inside a name. The
// exact short codes are Part B (01a v2.11): not here.

function cfg() {
  const base = aBranchConfig();
  const plain = (id: string, name: string, sort: number) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, sort_order: sort });
  return { ...base, items: [...base.items, plain('I5', 'Naan', 5), plain('I6', 'Roghni Naan', 6), plain('I7', 'Roti', 7)] };
}

describe('[02b-TK TK-S02] parseKeyQuery', () => {
  it('a leading number is the quantity, the rest the search ("4n", "4 naan", "12 roti"); no number → no quantity', () => {
    expect(parseKeyQuery('4n')).toEqual({ qty: 4, term: 'n' });
    expect(parseKeyQuery(' 4 naan ')).toEqual({ qty: 4, term: 'naan' });
    expect(parseKeyQuery('12 Roti')).toEqual({ qty: 12, term: 'roti' });
    expect(parseKeyQuery('naan')).toEqual({ qty: null, term: 'naan' });
    expect(parseKeyQuery('4')).toEqual({ qty: 4, term: '' });
    expect(parseKeyQuery('')).toEqual({ qty: null, term: '' });
    // 0 and silly counts are not quantities
    expect(parseKeyQuery('0n')).toEqual({ qty: null, term: 'n' });
    expect(parseKeyQuery('1000n').qty).toBe(99);
  });
});

describe('[02b-TK TK-S02] suggest', () => {
  const entries = keyEntries(cfg());
  const names = (term: string) => suggest(entries, term).map((e) => e.name);

  it('[frame KeyboardMode] "n": the names that start with it first, then a later word (Roghni Naan); a tie in menu order; three at most', () => {
    expect(names('n')).toEqual(['Naan', 'Roghni Naan']);
    expect(names('r')).toEqual(['Roghni Naan', 'Roti']);
    expect(suggest(entries, 'a', 3).length).toBeLessThanOrEqual(3);
  });

  it('[frame KeyboardMode "hk = half karahi"] initials of the variant and item names find the exact variant', () => {
    expect(names('hk')[0]).toBe('Chicken Karahi — Half');
    expect(names('fk')[0]).toBe('Chicken Karahi — Full');
    expect(names('mk')[0]).toBe('Mutton Karahi');
    expect(names('ckh')[0]).toBe('Chicken Karahi — Half');
  });

  it('inside a name (3 letters or more), any case; nothing typed or nothing found → none', () => {
    expect(names('ARAH')).toEqual(['Chicken Karahi — Half', 'Mutton Karahi', 'Chicken Karahi — Full']);
    expect(names('')).toEqual([]);
    expect(names('zzz')).toEqual([]);
  });

  it('a variant entry carries its item id; prices for the row', () => {
    const half = suggest(entries, 'hk')[0]!;
    expect(half).toMatchObject({ kind: 'item', id: 'I1', price_minor: cfg().items.find((i) => i.item_id === 'I1')!.price_minor });
  });
});
