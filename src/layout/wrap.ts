export type Measure = (text: string, fontSize: number) => number;

const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

export interface WrappedLine {
  text: string;
  /** Offset of the line's first character in the wrapped text, so ranges (links) can be mapped onto lines. */
  start: number;
}

/** Greedy wrap with offsets: Latin breaks between words, CJK between characters, `\n` always breaks. */
export function wrapWithOffsets(text: string, fontSize: number, maxW: number, measure: Measure): WrappedLine[] {
  const out: WrappedLine[] = [];
  let paraStart = 0;
  for (const para of text.split('\n')) {
    let line = '';
    let lineStart = paraStart;
    let pos = paraStart;
    for (const tok of para.match(TOKEN) ?? []) {
      const candidate = line + tok;
      if (line.trim() && measure(candidate.trimEnd(), fontSize) > maxW) {
        out.push({ text: line.trimEnd(), start: lineStart });
        const space = /^\s+$/.test(tok);
        line = space ? '' : tok;
        lineStart = space ? pos + tok.length : pos;
      } else {
        if (!line) lineStart = pos;
        line = candidate;
      }
      pos += tok.length;
    }
    out.push({ text: line.trimEnd(), start: lineStart });
    paraStart += para.length + 1;
  }
  return out;
}

/** Greedy wrap: Latin breaks between words, CJK between characters, `\n` always breaks. */
export function wrapText(text: string, fontSize: number, maxW: number, measure: Measure): string[] {
  return wrapWithOffsets(text, fontSize, maxW, measure).map((l) => l.text);
}
