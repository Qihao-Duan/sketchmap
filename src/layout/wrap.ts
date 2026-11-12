export type Measure = (text: string, fontSize: number) => number;

const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

/** Greedy wrap: Latin breaks between words, CJK between characters, `\n` always breaks. */
export function wrapText(text: string, fontSize: number, maxW: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = para.match(TOKEN) ?? [];
    let line = '';
    for (const tok of tokens) {
      const candidate = line + tok;
      if (line.trim() && measure(candidate.trimEnd(), fontSize) > maxW) {
        out.push(line.trimEnd());
        line = /^\s+$/.test(tok) ? '' : tok;
      } else {
        line = candidate;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
