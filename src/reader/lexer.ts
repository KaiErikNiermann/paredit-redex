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
const CHARACTER = /#\\(?:[0-3][0-7][0-7]|[uU][\da-fA-F]{1,8}|[a-zA-Z]{2,}|[^])/y;
const STRING_OPEN = /(?:#(?:rx|px)#?|#)?"/y;
const LANG_DIRECTIVE = /#lang[ \t]+[\w+\-/]*/y;
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
      const end = scanBarBody(line, 0);
      push(tokens, "atom", 0, end.index);
      state = end.closed ? DEFAULT_STATE : state;
      index = end.index;
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
    push(tokens, "comment", start, line.length);
    return { index: line.length };
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
    // `#\` with nothing after it: not a character, but the stream stays total.
    push(tokens, "error", start, line.length);
    return { index: line.length };
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
 * Consume a symbol, number, boolean or keyword.
 *
 * Two escape mechanisms interrupt the plain run to a delimiter: a backslash
 * quotes exactly one following character, and a pipe quotes everything up to the
 * next pipe — including brackets, and including newlines, which is why an
 * unterminated pipe hands back the `bar` state.
 */
function scanAtom(line: string, start: number, tokens: Token[]): ScanResult {
  let index = start;
  while (index < line.length) {
    const char = line[index];
    if (char === "\\") {
      // A backslash at end of line quotes the newline; either way the token
      // cannot extend past the characters this line actually has.
      index = Math.min(index + 2, line.length);
      continue;
    }
    if (char === "|") {
      const body = scanBarBody(line, index + 1);
      if (!body.closed) {
        push(tokens, "atom", start, body.index);
        return { index: body.index, state: { kind: "bar" } };
      }
      index = body.index;
      continue;
    }
    if (char === undefined || isDelimiterChar(char) || /\s/.test(char)) {
      break;
    }
    index += 1;
  }
  // A delimiter in the very first position would otherwise loop forever; the
  // dispatch above has already handled every delimiter that can start a token,
  // so anything reaching here is unreadable input.
  const end = index === start ? start + 1 : index;
  push(tokens, index === start ? "error" : "atom", start, end);
  return { index: end };
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

function push(tokens: Token[], kind: "atom" | "string" | "comment" | "whitespace" | "error", start: number, end: number): void {
  tokens.push({ kind, start, end });
}

function pushBracket(tokens: Token[], kind: "open" | "close", start: number, end: number, lexeme: string): void {
  const shape: BracketShape = shapeOf(lexeme) ?? "(";
  tokens.push(
    kind === "open"
      ? { kind: "open", shape, start, end }
      : { kind: "close", shape, start, end },
  );
}
