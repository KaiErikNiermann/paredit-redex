/**
 * The caret-marked source notation used by the tests and the cheat sheet.
 *
 * paredit.el's own test suite marks the caret with `|`. That cannot work here:
 * in Racket a pipe delimits a bar-quoted symbol, so `(a |b)` is a real program
 * and pipes would be ambiguous in exactly the cases most worth showing.
 */

export const CARET = "‸";

export interface Marked {
  readonly source: string;
  readonly offset: number;
}

export function parseCaret(marked: string): Marked {
  const offset = marked.indexOf(CARET);
  if (offset < 0) {
    throw new Error(`no caret in ${JSON.stringify(marked)}`);
  }
  return { source: marked.replace(CARET, ""), offset };
}

export function formatCaret(source: string, offset: number): string {
  return source.slice(0, offset) + CARET + source.slice(offset);
}
