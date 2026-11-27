import { mapText, type Doc, type DocBlock } from '@pos/domain';

const TOKEN_RU = 'Aap ka token: {token}';
const PAY_RU = 'Paise counter par dein';

interface TakeawaySlipInput {
  reprint: boolean;
  branch_name: string;
  token: number;
  ready_at_text: string | null;
  status_url: null; // Tier 1 injects a statusLink that returns null.
  placed_at_text: string;
  date_text: string;
}

export function printableBranchName(name: string): string | null {
  const trimmed = name.trim().normalize('NFC');
  if (trimmed === '') return null;
  const letters = trimmed.match(/\p{L}/gu) ?? [];
  const unmapped = letters.filter((letter) => mapText(letter) === '?').length;
  return unmapped * 2 > letters.length ? null : mapText(trimmed);
}

/** 03c §3.11: the Tier 1 takeaway token slip. */
export function buildTakeawaySlipDoc(input: TakeawaySlipInput, width_cols: 32 | 48): Doc {
  const { reprint, token, ready_at_text, placed_at_text, date_text } = input;
  const name = printableBranchName(input.branch_name);
  const blocks: DocBlock[] = [];
  if (reprint) blocks.push({ text: 'REPRINT', align: 'center', bold: true });
  if (name !== null) blocks.push({ text: name, align: 'center', bold: true });
  blocks.push(
    { text: 'TAKEAWAY', align: 'center' },
    { text: '='.repeat(width_cols), align: 'center' },
    { text: 'TOKEN', align: 'center', bold: true },
    { text: String(token), size: 2, align: 'center', bold: true },
    { text: TOKEN_RU.replace('{token}', String(token)), align: 'center' },
  );
  if (ready_at_text !== null) {
    blocks.push({ text: `Ready around ${ready_at_text}`, align: 'center', bold: true });
  }
  blocks.push(
    { rule: true },
    { text: 'PAY AT THE COUNTER', align: 'center', bold: true },
    { text: PAY_RU, align: 'center' },
    { rule: true },
    { text: `#${token}  ${placed_at_text}  ${date_text}`, align: 'center' },
    { feed: 1 },
    { cut: true },
  );
  return { width_cols, blocks };
}
