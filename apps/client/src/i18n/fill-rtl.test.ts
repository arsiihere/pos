import { describe, expect, it } from 'vitest';
import { fill } from './en';

// ⚠️ 02b-TK L-CLIENT-6b item 1 (QA "AM 7", "Usman پر AM 12:30", "QA Pickup · 10 Token"): a Latin value inside an Urdu
// sentence goes in as a first-strong isolate, so the bidi algorithm keeps it whole; English and bare numbers unchanged.
describe('[02b-TK L-CLIENT-6b item 1] fill in Urdu sentences', () => {
  it('isolates a time, a name and money in an Urdu sentence; never in English; never a bare number', () => {
    expect(fill('{t} پر {who} نے لیا', { t: '12:30 AM', who: 'Usman' })).toBe('⁨12:30 AM⁩ پر ⁨Usman⁩ نے لیا');
    expect(fill('{time} پر کھلی · فلوٹ {money}', { time: '7:02 AM', money: 'Rs 5,000' })).toBe('⁨7:02 AM⁩ پر کھلی · فلوٹ ⁨Rs 5,000⁩');
    expect(fill('{n} اور نئے', { n: '16' })).toBe('16 اور نئے');
    expect(fill('{name} نے', { name: 'ثنا' })).toBe('ثنا نے');
    expect(fill('Placed {t} by {who}', { t: '12:30 AM', who: 'Usman' })).toBe('Placed 12:30 AM by Usman');
  });
});
