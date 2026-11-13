import { Fragment } from 'react';

// 03c-C04 (frames Paper58, Paper80; brief §5.1): the on-screen look of a printed layout — a paper strip in monospace at
// 48 (80 mm) or 32 (58 mm) columns, bold and double-size lines, a dashed cut, and every letter the printer cannot print
// marked "?". The paper text itself is the hub's (03c §3.3, `renderText`); this only draws lines it is given.
// Character set (03c §3.6): mapping first (— – − → "-", × → "x", · → space, curly quotes → straight), then anything
// outside PC437 prints "?" (Urdu script included).

// CP437 0x80–0xFF.
const PC437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const MAPPED: Record<string, string> = { '—': '-', '–': '-', '−': '-', '×': 'x', '·': ' ', '‘': "'", '’': "'", '“': '"', '”': '"' };

function printable(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || PC437_HIGH.includes(ch);
}

/** A line as it prints: runs of kept text and runs of lost letters (each lost letter is one "?"). */
export function paperLine(text: string): Array<{ text: string; lost: boolean }> {
  const runs: Array<{ text: string; lost: boolean }> = [];
  for (const raw of text) {
    const ch = MAPPED[raw] ?? raw;
    const lost = !printable(ch);
    const out = lost ? '?' : ch;
    const last = runs.at(-1);
    if (last !== undefined && last.lost === lost) last.text += out;
    else runs.push({ text: out, lost });
  }
  return runs;
}

export interface PaperLineSpec {
  text: string;
  bold?: boolean;
  /** double size: centred by leading spaces of normal width, each letter 2 columns (brief §5.1) */
  x2?: boolean;
}

function Runs({ text }: { text: string }) {
  return (
    <>
      {paperLine(text).map((r, i) =>
        r.lost ? (
          <span key={i} className="lost">
            {r.text}
          </span>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </>
  );
}

export function PaperPreview({ width, lines }: { width: 58 | 80; lines: readonly PaperLineSpec[] }) {
  const columns = width === 58 ? 32 : 48;
  return (
    <div className="paper">
      <div className={width === 58 ? 'w32' : 'w48'}>
        {lines.map((line, i) => {
          if (line.x2 === true) {
            const letters = [...line.text.trim()];
            const pad = Math.max(0, Math.floor((columns - letters.length * 2) / 2));
            return (
              <span key={i} className="ln">
                <span>{' '.repeat(pad)}</span>
                <span className={`x2${line.bold === true ? ' b' : ''}`}>
                  <Runs text={letters.join('')} />
                </span>
              </span>
            );
          }
          return (
            <span key={i} className={`ln${line.bold === true ? ' b' : ''}`}>
              <Runs text={line.text} />
            </span>
          );
        })}
        <span className="cut" />
      </div>
    </div>
  );
}
