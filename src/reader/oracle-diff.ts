/**
 * Differential comparison against Racket's own `syntax-color/racket-lexer`.
 *
 * The two lexers do not produce the same token stream, and are not meant to:
 * this one is line-at-a-time and carries structure Racket's flat type list does
 * not (which prefix a prefix token is, which shape a bracket is), while Racket's
 * runs over the whole port and distinguishes atom flavours this one has no use
 * for. What must agree is the thing paredit depends on — where every token
 * starts and ends, and which of a handful of structural classes it belongs to.
 *
 * So both streams are projected onto a common class and adjacent tokens of equal
 * class are coalesced. Coalescing is what reconciles the line-at-a-time model
 * with the whole-file one: Racket reports `"a\nb"` or a run of blank lines as a
 * single token, and this lexer necessarily reports one per line.
 */

import { DEFAULT_STATE } from "./lex-state";
import { lexLine } from "./lexer";
import type { Token } from "./tokens";

export type DiffClass =
  | "open"
  | "close"
  | "atom"
  | "string"
  | "comment"
  | "prefix"
  | "space"
  | "error";

export interface Span {
  readonly cls: DiffClass;
  readonly start: number;
  readonly end: number;
}

/** One token as reported by `test/oracle/lex.rkt`. */
export interface OracleToken {
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly paren: string | null;
}

const OPEN_PARENS = new Set(["(", "[", "{"]);

/**
 * Project a `racket-lexer` token onto the common class.
 *
 * Every atom flavour Racket distinguishes — `symbol`, `constant`, `other`,
 * `hash-colon-keyword` — collapses to `atom`, including the quoting prefixes,
 * which it reports as `constant` or `other` rather than as a class of their own.
 */
export function oracleClass(token: OracleToken): DiffClass {
  switch (token.type) {
    case "parenthesis": {
      if (token.paren === null) {
        return "atom";
      }
      return OPEN_PARENS.has(token.paren) ? "open" : "close";
    }
    case "white-space": {
      return "space";
    }
    case "comment": {
      return "comment";
    }
    case "sexp-comment": {
      return "prefix";
    }
    case "string": {
      return "string";
    }
    case "error": {
      return "error";
    }
    default: {
      return "atom";
    }
  }
}

/**
 * Project one of this lexer's tokens onto the common class.
 *
 * Only `#;` maps to `prefix`; the quoting prefixes map to `atom`, because that
 * is what Racket calls them and the boundaries are what is under test.
 */
export function ownClass(token: Token): DiffClass {
  switch (token.kind) {
    case "open":
    case "close":
    case "string":
    case "comment":
    case "error": {
      return token.kind;
    }
    case "whitespace": {
      return "space";
    }
    case "atom": {
      return "atom";
    }
    case "prefix": {
      return token.prefix === "datum-comment" ? "prefix" : "atom";
    }
  }
}

/** Merge adjacent spans of equal class. Assumes the input is gap-free and sorted. */
export function coalesce(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous?.cls === span.cls && previous.end === span.start) {
      merged[merged.length - 1] = { cls: span.cls, start: previous.start, end: span.end };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * Lex a whole source with this lexer, in absolute file offsets.
 *
 * Newlines are re-inserted as whitespace spans, since `lexLine` works on lines
 * with the terminator already stripped.
 */
export function lexSourceToSpans(source: string): Span[] {
  const spans: Span[] = [];
  const lines = source.split("\n");
  let state = DEFAULT_STATE;
  let offset = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const result = lexLine(line, state);
    for (const token of result.tokens) {
      spans.push({
        cls: ownClass(token),
        start: offset + token.start,
        end: offset + token.end,
      });
    }
    state = result.stateOut;
    offset += line.length;

    if (lineIndex < lines.length - 1) {
      // The newline itself. Inside a string or block comment it belongs to that
      // construct; otherwise it is whitespace.
      spans.push({ cls: newlineClass(state), start: offset, end: offset + 1 });
      offset += 1;
    }
  }

  return coalesce(spans);
}

function newlineClass(state: typeof DEFAULT_STATE): DiffClass {
  switch (state.kind) {
    case "string":
    case "here-string": {
      return "string";
    }
    case "block-comment": {
      return "comment";
    }
    case "bar": {
      return "atom";
    }
    case "default": {
      return "space";
    }
  }
}

/**
 * Offsets of each code point, in UTF-16 code units, or `undefined` when the two
 * coincide.
 *
 * Racket counts characters; JavaScript — and VS Code's document API, which is
 * what the ops layer ultimately has to agree with — counts UTF-16 code units.
 * Any file containing an astral-plane character (an emoji, or `#\\𝔸`) therefore
 * has two incompatible offset systems, and the reference lexer's must be
 * translated into this one's before anything is compared. Files without
 * surrogate pairs skip the table entirely, which is nearly all of them.
 */
function codePointOffsets(source: string): Int32Array | undefined {
  if (!/[\uD800-\uDBFF]/.test(source)) {
    return undefined;
  }
  const offsets = new Int32Array(source.length + 1);
  let codePoints = 0;
  let index = 0;
  while (index < source.length) {
    offsets[codePoints] = index;
    index += (source.codePointAt(index) ?? 0) > 0xff_ff ? 2 : 1;
    codePoints += 1;
  }
  offsets[codePoints] = source.length;
  return offsets.subarray(0, codePoints + 1);
}

export function oracleToSpans(tokens: readonly OracleToken[], source: string): Span[] {
  const offsets = codePointOffsets(source);
  const at = (position: number): number =>
    offsets === undefined ? position : (offsets[position] ?? source.length);

  return coalesce(
    tokens.map((token) => ({
      cls: oracleClass(token),
      start: at(token.start),
      end: at(token.end),
    })),
  );
}

export interface Mismatch {
  readonly index: number;
  readonly expected: Span | undefined;
  readonly actual: Span | undefined;
}

/**
 * Compare two coalesced span streams.
 *
 * Spans the reference lexer classifies as `error` compare on boundaries only.
 * Error recovery is exactly where two independent lexers are entitled to differ,
 * and paredit's behaviour in malformed regions is best-effort by nature.
 */
export function diffSpans(expected: readonly Span[], actual: readonly Span[]): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const length = Math.max(expected.length, actual.length);

  for (let index = 0; index < length; index += 1) {
    const want = expected[index];
    const got = actual[index];
    if (want === undefined || got === undefined) {
      mismatches.push({ index, expected: want, actual: got });
      continue;
    }
    const boundariesAgree = want.start === got.start && want.end === got.end;
    const classesAgree = want.cls === got.cls || want.cls === "error";
    if (!boundariesAgree || !classesAgree) {
      mismatches.push({ index, expected: want, actual: got });
    }
  }

  return mismatches;
}
