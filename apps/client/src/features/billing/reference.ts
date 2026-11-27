// 05 §3.7 (B10, H1-20; QA BUG-27, 2026-11-28): the payment reference field — 1–60 characters. Leading spaces are dropped
// as typed (they would eat the limit), the counter shows the trimmed length against 60, and the text is sent trimmed.
export const REFERENCE_MAX = 60;

/** The field's value after a keystroke: leading white space never stays. */
export const typedReference = (raw: string): string => raw.replace(/^\s+/, '');

/** The counter's figure: what will be sent (trimmed). */
export const referenceLength = (value: string): number => value.trim().length;
