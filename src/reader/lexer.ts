/**
 * A resumable, line-at-a-time lexer for the Racket reader.
 *
 * Hand-written rather than generated: the token grammar is regular apart from
 * block-comment nesting (one counter), and this runs on the keystroke path.
 *
 * The rules below are transcribed from `syntax-color/racket-lexer`'s own lex
 * abbreviations, so that the differential test against that lexer compares
 * boundaries 1:1. The ones that are easy to get wrong, with their sources:
 *
 * - `list-prefix` is `"" | #hash | #hasheq | #hasheqv | #hashalw | #s | # digit*`,
 *   so `#(`, `#3(`, `#hash(` are each a SINGLE open-bracket token.
 * - `identifier-delims` is `" , ' ` ( ) [ ] { } ;` plus whitespace. `#` is NOT a
 *   delimiter, so `a#b` is one symbol.
 * - A character literal is `#\` followed by three octal digits, or `u`/`U` and
 *   hex, or two-or-more alphabetics, or exactly one character — tried in that
 *   order, because the reference lexer takes the longest match. This is what
 *   makes `#\(` three characters and `#\a1` three rather than four.
 * - Strings, block comments and bar-quoted symbols all span lines, which is why
 *   each has a resumable state.
 */

import type { LexState, StringFlavor } from "./lex-state";
import { DEFAULT_STATE } from "./lex-state";
import type { BracketShape, PrefixKind, Token } from "./tokens";
import { isDelimiterChar, shapeOf } from "./tokens";

export interface LexedLine {
  readonly tokens: readonly Token[];
  readonly stateOut: LexState;
}

const WHITESPACE = /\s+/y;
const OPEN_BRACKET = /[([{]/y;
const PREFIXED_OPEN = /#(?:hash(?:eqv|eq|alw)?|s|\d+)?[([{]/y;
const CLOSE = /[)\]}]/y;
// The `u` flag is load-bearing: without it the final alternative matches a
// single UTF-16 code unit, which splits `#\\𝔸` across its surrogate pair and
// reports a three-unit character literal followed by a stray half.
const CHARACTER =
  /#\\(?:[0-3][0-7][0-7]|u[\da-fA-F]{1,4}|U[\da-fA-F]{1,8}|\p{Alphabetic}{2,}|[^])/uy;
const STRING_OPEN = /(?:#(?:rx|px)#?|#)?"/y;
/**
 * `#lang` plus a space, then the language name up to the next whitespace.
 *
 * The name is not restricted to identifier characters: Racket lexes
 * `#lang racket(` as one token to the end of the line rather than as `#lang
 * racket` followed by an opening bracket. Nor is it quoted -- in `#lang x|y z`
 * the bar is an ordinary character and the token still ends at the space.
 *
 * The space is required. Without one there is no directive and the text is an
 * ordinary symbol that stops at delimiters -- `#lang}` really is `#lang`
 * followed by a closing brace, and appears as such in Racket's own source.
 */
const LANG_DIRECTIVE = /#lang \S*/y;
const SCRIPT_LINE = /#![ /]/y;
/** `#<<` opens a here string whose terminator is the rest of the line. */
const HERE_STRING_OPEN = "#<<";

/** Reader prefixes, longest first so that `,@` wins over `,`. */
const PREFIXES: readonly (readonly [string, PrefixKind])[] = [
  ["#,@", "unsyntax-splicing"],
  ["#,", "unsyntax"],
  ["#'", "syntax"],
  ["#`", "quasisyntax"],
  ["#&", "box"],
  ["#;", "datum-comment"],
  [",@", "unquote-splicing"],
  [",", "unquote"],
  ["'", "quote"],
  ["`", "quasiquote"],
];

function matchAt(pattern: RegExp, text: string, index: number): string | undefined {
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0];
}

function stringFlavor(opener: string): StringFlavor {
  const rx = opener.includes("rx") || opener.includes("px");
  const byte = opener.endsWith('#"');
  if (rx) {
    return byte ? "byte-regexp" : "regexp";
  }
  return byte ? "byte" : "string";
}

/**
 * Scan a single line, resuming from `stateIn`.
 *
 * `line` must not contain a newline. Token offsets are relative to the start of
 * the line; the newline itself is not a token.
 */
export function lexLine(line: string, stateIn: LexState): LexedLine {
  const tokens: Token[] = [];
  let index = 0;
  let state = stateIn;

  // Finish whatever construct was left open by the previous line before the
  // main scan can resume.
  switch (state.kind) {
    case "string": {
      const end = scanStringBody(line, 0);
      push(tokens, "string", 0, end.index);
      state = end.closed ? DEFAULT_STATE : state;
      index = end.index;
      break;
    }
    case "block-comment": {
      const end = scanBlockCommentBody(line, 0, state.depth);
      push(tokens, "comment", 0, end.index);
      state = end.depth === 0 ? DEFAULT_STATE : { kind: "block-comment", depth: end.depth };
      index = end.index;
      break;
    }
    case "here-string": {
      // The terminator line is part of the string, and ends it.
      push(tokens, "string", 0, line.length);
      state = line === state.tag ? DEFAULT_STATE : state;
      index = line.length;
      break;
    }
    case "bar": {
      const body = scanBarBody(line, 0);
      if (body.closed) {
        // The bar closed, but the symbol it belongs to need not have ended:
        // `|a|b` is one symbol, and so is `|a|#(`, where the `#(` is symbol
        // text rather than a vector opening. Resuming at the top-level dispatch
        // instead would read a bracket that is not there.
        const resumed = scanAtom(line, 0, tokens, body.index);
        state = resumed.state ?? DEFAULT_STATE;
        index = resumed.index;
      } else {
        push(tokens, "atom", 0, body.index);
        index = body.index;
      }
      break;
    }
    case "atom-continuation": {
      const result = continueAtom(line, tokens);
      state = result.state ?? DEFAULT_STATE;
      index = result.index;
      break;
    }
    case "script-line": {
      const result = scriptLine(line, 0, tokens);
      state = result.state ?? DEFAULT_STATE;
      index = result.index;
      break;
    }
    case "pending-char": {
      // The newline this line follows was the character literal's character;
      // this line itself starts clean.
      state = DEFAULT_STATE;
      break;
    }
    case "default": {
      break;
    }
  }

  while (index < line.length) {
    const next = scanToken(line, index, tokens);
    index = next.index;
    if (next.state !== undefined) {
      state = next.state;
    }
  }

  return { tokens, stateOut: state };
}

interface ScanResult {
  readonly index: number;
  readonly state?: LexState;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- a lexer dispatch is a flat table of cases; splitting it would obscure the priority order, which is the thing that has to be read as a whole
function scanToken(line: string, start: number, tokens: Token[]): ScanResult {
  const char = line[start];

  const whitespace = matchAt(WHITESPACE, line, start);
  if (whitespace !== undefined) {
    push(tokens, "whitespace", start, start + whitespace.length);
    return { index: start + whitespace.length };
  }

  if (char === ";") {
    push(tokens, "comment", start, line.length);
    return { index: line.length };
  }

  if (line.startsWith("#|", start)) {
    const body = scanBlockCommentBody(line, start + 2, 1);
    push(tokens, "comment", start, body.index);
    return {
      index: body.index,
      state: body.depth === 0 ? DEFAULT_STATE : { kind: "block-comment", depth: body.depth },
    };
  }

  // Before the generic `#` cases: `#lang` swallows the language name, and a
  // character literal may itself be a bracket or a quote.
  if (matchAt(SCRIPT_LINE, line, start) !== undefined) {
    return scriptLine(line, start, tokens);
  }



  if (line.startsWith(HERE_STRING_OPEN, start)) {
    // Everything after `#<<` on this line is the terminator tag; the body runs
    // until a line equal to it. Brackets inside are text, which is exactly why
    // this cannot be left as an unrecognised atom.
    const tag = line.slice(start + HERE_STRING_OPEN.length);
    if (tag === "") {
      // No terminator can ever match, so the reader rejects it outright rather
      // than swallowing the rest of the file.
      const end = start + HERE_STRING_OPEN.length;
      push(tokens, "error", start, end);
      return { index: end };
    }
    push(tokens, "string", start, line.length);
    return { index: line.length, state: { kind: "here-string", tag } };
  }

  const lang = matchAt(LANG_DIRECTIVE, line, start);
  if (lang !== undefined) {
    push(tokens, "atom", start, start + lang.length);
    return { index: start + lang.length };
  }

  const character = matchAt(CHARACTER, line, start);
  if (character !== undefined) {
    push(tokens, "atom", start, start + character.length);
    return { index: start + character.length };
  }
  if (line.startsWith("#\\", start)) {
    // Nothing follows on this line, so the character is the newline itself.
    // At end of input there is no newline and Racket calls this an error,
    // but the extent is the same either way.
    push(tokens, "atom", start, line.length);
    return { index: line.length, state: { kind: "pending-char" } };
  }

  const stringOpen = matchAt(STRING_OPEN, line, start);
  if (stringOpen !== undefined) {
    const body = scanStringBody(line, start + stringOpen.length);
    push(tokens, "string", start, body.index);
    return {
      index: body.index,
      state: body.closed ? DEFAULT_STATE : { kind: "string", flavor: stringFlavor(stringOpen) },
    };
  }

  const close = matchAt(CLOSE, line, start);
  if (close !== undefined) {
    pushBracket(tokens, "close", start, start + close.length, close);
    return { index: start + close.length };
  }

  // Prefixed first: `#hash(` is one token, and it is longer than the `(` inside it.
  const open =
    matchAt(PREFIXED_OPEN, line, start) ?? matchAt(OPEN_BRACKET, line, start);
  if (open !== undefined) {
    pushBracket(tokens, "open", start, start + open.length, open);
    return { index: start + open.length };
  }

  for (const [text, prefix] of PREFIXES) {
    if (line.startsWith(text, start)) {
      tokens.push({ kind: "prefix", prefix, start, end: start + text.length });
      return { index: start + text.length };
    }
  }

  return scanAtom(line, start, tokens);
}

/**
 * Consume a `#!` script line, which a trailing backslash continues.
 */
function scriptLine(line: string, start: number, tokens: Token[]): ScanResult {
  push(tokens, "comment", start, line.length);
  return line.endsWith("\\")
    ? { index: line.length, state: { kind: "script-line" } }
    : { index: line.length, state: DEFAULT_STATE };
}

/**
 * Consume a symbol, number, boolean or keyword.
 *
 * Two escape mechanisms interrupt the plain run to a delimiter: a backslash
 * quotes exactly one following character, and a pipe quotes everything up to the
 * next pipe — including brackets, and including newlines, which is why an
 * unterminated pipe hands back the `bar` state.
 */
function scanAtom(
  line: string,
  start: number,
  tokens: Token[],
  from: number = start,
): ScanResult {
  const scan = scanAtomBody(line, from);

  if (scan.stop === "unterminated-bar") {
    push(tokens, "atom", start, scan.index);
    return { index: scan.index, state: { kind: "bar" } };
  }

  // A delimiter in the very first position would otherwise loop forever; the
  // dispatch above has already handled every delimiter that can start a token,
  // so anything reaching here is unreadable input.
  const end = scan.index === start ? start + 1 : scan.index;
  push(tokens, scan.index === start ? "error" : "atom", start, end);

  return scan.stop === "escaped-newline"
    ? { index: end, state: { kind: "atom-continuation" } }
    : { index: end };
}

/**
 * Continue a symbol that the previous line's trailing backslash carried over.
 *
 * The dispatch is deliberately not re-entered: mid-symbol, `#lang` and `#<<` are
 * symbol text rather than a directive or a here string, and re-dispatching would
 * read them as the latter.
 */
function continueAtom(line: string, tokens: Token[]): ScanResult {
  const scan = scanAtomBody(line, 0);
  if (scan.index === 0) {
    // The symbol ended at the newline; whatever is here starts a fresh token.
    return { index: 0, state: DEFAULT_STATE };
  }

  push(tokens, "atom", 0, scan.index);
  switch (scan.stop) {
    case "unterminated-bar": {
      return { index: scan.index, state: { kind: "bar" } };
    }
    case "escaped-newline": {
      return { index: scan.index, state: { kind: "atom-continuation" } };
    }
    case "delimiter": {
      return { index: scan.index, state: DEFAULT_STATE };
    }
  }
}

interface AtomScan {
  readonly index: number;
  readonly stop: "delimiter" | "unterminated-bar" | "escaped-newline";
}

/** Advance over symbol characters, honouring both escape mechanisms. */
function scanAtomBody(line: string, from: number): AtomScan {
  let index = from;

  while (index < line.length) {
    const char = line[index];

    if (char === "\\") {
      if (index + 1 >= line.length) {
        // The escaped character is the newline itself, so the symbol runs on
        // past the end of this line.
        return { index: line.length, stop: "escaped-newline" };
      }
      index += 2;
      continue;
    }

    if (char === "|") {
      const body = scanBarBody(line, index + 1);
      if (!body.closed) {
        return { index: body.index, stop: "unterminated-bar" };
      }
      index = body.index;
      continue;
    }

    if (char === undefined || isDelimiterChar(char) || /\s/.test(char)) {
      break;
    }
    index += 1;
  }

  return { index, stop: "delimiter" };
}

interface BodyScan {
  readonly index: number;
  readonly closed: boolean;
}

/** Scan string content from `start`, stopping after the closing quote. */
function scanStringBody(line: string, start: number): BodyScan {
  let index = start;
  while (index < line.length) {
    const char = line[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') {
      return { index: index + 1, closed: true };
    }
    index += 1;
  }
  return { index: line.length, closed: false };
}

/** Scan bar-quoted symbol content from `start`, stopping after the closing bar. */
function scanBarBody(line: string, start: number): BodyScan {
  const close = line.indexOf("|", start);
  return close === -1
    ? { index: line.length, closed: false }
    : { index: close + 1, closed: true };
}

interface CommentScan {
  readonly index: number;
  readonly depth: number;
}

/**
 * Scan block-comment content from `start` at nesting `depth`.
 *
 * Scanning left to right resolves `#|#` the way the reader does: the opener
 * matches first and the trailing `#` is content.
 */
function scanBlockCommentBody(line: string, start: number, depth: number): CommentScan {
  let index = start;
  let level = depth;
  while (index < line.length) {
    if (line.startsWith("#|", index)) {
      level += 1;
      index += 2;
      continue;
    }
    if (line.startsWith("|#", index)) {
      level -= 1;
      index += 2;
      if (level === 0) {
        return { index, depth: 0 };
      }
      continue;
    }
    index += 1;
  }
  return { index: line.length, depth: level };
}

/**
 * Append a token, unless it would be empty.
 *
 * A blank line inside a multi-line string or block comment has nothing to
 * report, and the resume branches would otherwise emit a zero-length token for
 * it. Everything downstream — the cursor's stepping, the differential test's
 * coalescing — assumes tokens are non-empty, and an empty one would not fail
 * loudly, it would just quietly sit there.
 */
function push(
  tokens: Token[],
  kind: "atom" | "string" | "comment" | "whitespace" | "error",
  start: number,
  end: number,
): void {
  if (end > start) {
    tokens.push({ kind, start, end });
  }
}

function pushBracket(tokens: Token[], kind: "open" | "close", start: number, end: number, lexeme: string): void {
  const shape: BracketShape = shapeOf(lexeme) ?? "(";
  tokens.push(
    kind === "open"
      ? { kind: "open", shape, start, end }
      : { kind: "close", shape, start, end },
  );
}
