/**
 * Token model for the Racket reader.
 *
 * Deliberately mirrors the conventions of Racket's own `syntax-color/racket-lexer`
 * so that the differential test against it is a 1:1 comparison rather than a
 * normalisation exercise. In particular, a *prefixed* open bracket such as `#(`,
 * `#hash(` or `#s(` is a SINGLE token whose text is the whole lexeme and whose
 * `shape` is the bare bracket — exactly what `racket-lexer` reports as its `paren`
 * value.
 *
 * The corollary is the single most important invariant in this file:
 * **delimiters are not single characters.** Any code that derives a position by
 * adding 1 to an open bracket's offset is wrong; use `token.end`.
 *
 * Offsets are relative to the start of the token's own line. Keeping them
 * line-relative is what lets the incremental store splice whole lines in and out
 * without rewriting every token that follows.
 */

/** The three bracket shapes Racket reads as list delimiters. */
export type BracketShape = "(" | "[" | "{";

/** Reader prefixes that bind to the datum immediately following them. */
export type PrefixKind =
  | "quote" //             '
  | "quasiquote" //        `
  | "unquote" //           ,
  | "unquote-splicing" //  ,@
  | "syntax" //            #'
  | "quasisyntax" //       #`
  | "unsyntax" //          #,
  | "unsyntax-splicing" // #,@
  | "datum-comment"; //    #;

export type TokenKind =
  | "open" //       ( [ { and prefixed opens: #( #hash( #s( #&
  | "close" //      ) ] }
  | "atom" //       symbols, numbers, booleans, characters, keywords
  | "string" //     "..." #"..." #rx"..." #px"..."
  | "comment" //    ; ... to end of line, and #| ... |#
  | "prefix" //     see PrefixKind
  | "whitespace"
  | "error"; //     unterminated or unreadable input, kept so the stream stays total

interface TokenBase {
  readonly kind: TokenKind;
  /** Offset of the first character, relative to the start of the line. */
  readonly start: number;
  /** Offset one past the last character, relative to the start of the line. */
  readonly end: number;
}

export interface OpenToken extends TokenBase {
  readonly kind: "open";
  readonly shape: BracketShape;
}

export interface CloseToken extends TokenBase {
  readonly kind: "close";
  readonly shape: BracketShape;
}

export interface PrefixToken extends TokenBase {
  readonly kind: "prefix";
  readonly prefix: PrefixKind;
}

export interface PlainToken extends TokenBase {
  readonly kind: "atom" | "string" | "comment" | "whitespace" | "error";
}

export type Token = OpenToken | CloseToken | PrefixToken | PlainToken;

/** The closing bracket that matches `shape`. */
export function closerFor(shape: BracketShape): ")" | "]" | "}" {
  switch (shape) {
    case "(": {
      return ")";
    }
    case "[": {
      return "]";
    }
    case "{": {
      return "}";
    }
  }
}

/**
 * The bracket shape of a delimiter lexeme.
 *
 * Works for bare brackets and for prefixed opens alike, because in every Racket
 * open-bracket lexeme the bracket is the final character: `#hash(` -> `(`.
 * Returns `undefined` for a lexeme that is not a delimiter.
 */
export function shapeOf(lexeme: string): BracketShape | undefined {
  const last = lexeme.at(-1);
  return last === undefined ? undefined : SHAPE_BY_DELIMITER[last];
}

const SHAPE_BY_DELIMITER: Readonly<Record<string, BracketShape>> = {
  "(": "(",
  ")": "(",
  "[": "[",
  "]": "[",
  "{": "{",
  "}": "{",
};

/** Whether an open and a close token delimit the same list. */
export function isMatchingPair(open: OpenToken, close: CloseToken): boolean {
  return open.shape === close.shape;
}

/** Tokens that structural motion steps over without treating as data. */
export function isSkippable(token: Token): boolean {
  return token.kind === "whitespace" || token.kind === "comment";
}

/**
 * Whether the token is a `#;` datum comment.
 *
 * Distinguished from the quoting prefixes because it has the opposite effect on
 * motion: a quote prefix makes the following datum part of *this* datum, while
 * `#;` makes the following datum vanish from the stream.
 */
export function isDatumComment(token: Token): token is PrefixToken {
  return token.kind === "prefix" && token.prefix === "datum-comment";
}

/** Whether the token binds to the datum that follows it, forming one datum with it. */
export function isQuotingPrefix(token: Token): token is PrefixToken {
  return token.kind === "prefix" && token.prefix !== "datum-comment";
}
