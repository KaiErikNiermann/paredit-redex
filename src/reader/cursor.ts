/**
 * Structural motion over the token stream.
 *
 * Deliberately a cursor rather than a syntax tree. A file being typed into is
 * unbalanced most of the time, and a tree over unbalanced text needs an error
 * recovery policy that then leaks into every operation. Walking tokens with a
 * depth counter is always well defined, needs no invalidation beyond the
 * document's own line states, and expresses every paredit command as a
 * composition of a few motions.
 *
 * Every motion takes and returns an absolute offset, or `undefined` when it
 * cannot move — the caller decides whether that is a no-op or an error. Nothing
 * here mutates.
 */

import type { TokenizedDocument } from "./document";
import type { Token } from "./tokens";
import { isDatumComment, isSkippable } from "./tokens";

/** A token together with its absolute position in the document. */
export interface Located {
  readonly token: Token;
  readonly line: number;
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

function locate(document: TokenizedDocument, line: number, index: number): Located | undefined {
  const token = document.tokens(line)[index];
  if (token === undefined) {
    return undefined;
  }
  const lineStart = document.lineStart(line);
  return { token, line, index, start: lineStart + token.start, end: lineStart + token.end };
}

/** The next token after `from`, crossing line boundaries. */
function after(document: TokenizedDocument, from: Located): Located | undefined {
  const sameLine = locate(document, from.line, from.index + 1);
  if (sameLine !== undefined) {
    return sameLine;
  }
  for (let line = from.line + 1; line < document.lineCount; line += 1) {
    const first = locate(document, line, 0);
    if (first !== undefined) {
      return first;
    }
  }
  return undefined;
}

/** The previous token before `from`, crossing line boundaries. */
function before(document: TokenizedDocument, from: Located): Located | undefined {
  if (from.index > 0) {
    return locate(document, from.line, from.index - 1);
  }
  for (let line = from.line - 1; line >= 0; line -= 1) {
    const count = document.tokens(line).length;
    if (count > 0) {
      return locate(document, line, count - 1);
    }
  }
  return undefined;
}

/** The first token starting at or after `offset`. */
export function tokenAtOrAfter(
  document: TokenizedDocument,
  offset: number,
): Located | undefined {
  const { line } = document.positionAt(offset);
  for (let current = line; current < document.lineCount; current += 1) {
    const tokens = document.tokens(current);
    const lineStart = document.lineStart(current);
    for (const [index, token] of tokens.entries()) {
      if (lineStart + token.end > offset) {
        return locate(document, current, index);
      }
    }
  }
  return undefined;
}

/** The last token ending at or before `offset`. */
export function tokenAtOrBefore(
  document: TokenizedDocument,
  offset: number,
): Located | undefined {
  const { line } = document.positionAt(offset);
  for (let current = Math.min(line, document.lineCount - 1); current >= 0; current -= 1) {
    const tokens = document.tokens(current);
    const lineStart = document.lineStart(current);
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      const token = tokens[index];
      if (token !== undefined && lineStart + token.start < offset) {
        return locate(document, current, index);
      }
    }
  }
  return undefined;
}

function skipForward(document: TokenizedDocument, from: Located | undefined): Located | undefined {
  let current = from;
  while (current !== undefined && isSkippable(current.token)) {
    current = after(document, current);
  }
  return current;
}

function skipBackward(document: TokenizedDocument, from: Located | undefined): Located | undefined {
  let current = from;
  while (current !== undefined && isSkippable(current.token)) {
    current = before(document, current);
  }
  return current;
}

/**
 * Offset just past the list opened by `open`, or `undefined` if it is unclosed.
 *
 * Matching is by depth rather than by shape: while typing, `(a]` is a thing that
 * exists, and refusing to find its end would make every motion in the file fail.
 */
function endOfList(document: TokenizedDocument, open: Located): number | undefined {
  let depth = 0;
  let current: Located | undefined = open;
  while (current !== undefined) {
    if (current.token.kind === "open") {
      depth += 1;
    } else if (current.token.kind === "close") {
      depth -= 1;
      if (depth === 0) {
        return current.end;
      }
    }
    current = after(document, current);
  }
  return undefined;
}

/** Offset of the start of the list closed by `close`, or `undefined` if unopened. */
function startOfList(document: TokenizedDocument, close: Located): number | undefined {
  let depth = 0;
  let current: Located | undefined = close;
  while (current !== undefined) {
    if (current.token.kind === "close") {
      depth += 1;
    } else if (current.token.kind === "open") {
      depth -= 1;
      if (depth === 0) {
        return current.start;
      }
    }
    current = before(document, current);
  }
  return undefined;
}

/**
 * Move forward over one datum.
 *
 * Follows `paredit-forward` rather than Emacs' `forward-sexp`: at the end of a
 * list this moves out of the list instead of failing.
 *
 * `#;` needs no special data structure here. Meeting one, the motion skips the
 * datum it comments and carries on, so stacked `#;#;a b c` falls out of the
 * recursion for free.
 */
export function forwardDatum(document: TokenizedDocument, offset: number): number | undefined {
  let current = skipForward(document, tokenAtOrAfter(document, offset));

  while (current !== undefined) {
    const { token } = current;
    switch (token.kind) {
      case "close": {
        return current.end;
      }
      case "open": {
        return endOfList(document, current);
      }
      case "prefix": {
        current = isDatumComment(token)
          ? pastCommentedDatum(document, current)
          : skipForward(document, after(document, current));
        continue;
      }
      case "atom":
      case "string":
      case "comment":
      case "whitespace":
      case "error": {
        return current.end;
      }
    }
  }

  return undefined;
}

/** The first token past the datum that a `#;` comments out. */
function pastCommentedDatum(
  document: TokenizedDocument,
  prefix: Located,
): Located | undefined {
  const commented = skipForward(document, after(document, prefix));
  if (commented === undefined) {
    return undefined;
  }
  const past = forwardDatum(document, commented.start);
  return past === undefined ? undefined : skipForward(document, tokenAtOrAfter(document, past));
}

/** A half-open range of absolute offsets. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * The datum the caret is in, or failing that the next one ahead.
 *
 * This is what "the sexp at point" means for the editing operations: with the
 * caret inside `fo‸o` the datum is `foo`, and with it in whitespace the datum is
 * whatever comes next. At a closing bracket there is nothing ahead, and the
 * result is undefined rather than the enclosing list.
 */
export function datumSpanAt(document: TokenizedDocument, offset: number): Span | undefined {
  const located = tokenAtOrAfter(document, offset);
  if (located === undefined) {
    return undefined;
  }

  const containing =
    located.start < offset && !isSkippable(located.token) && located.token.kind !== "close"
      ? located
      : undefined;
  const target = containing ?? skipForward(document, located);
  if (target === undefined || target.token.kind === "close") {
    return undefined;
  }

  const end = forwardDatum(document, target.start);
  const start = end === undefined ? undefined : backwardDatum(document, end);
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** Move backward over one datum, including any reader prefixes bound to it. */
export function backwardDatum(document: TokenizedDocument, offset: number): number | undefined {
  const current = skipBackward(document, tokenAtOrBefore(document, offset));
  if (current === undefined) {
    return undefined;
  }

  // A closing bracket means the datum is the whole list it closes; anything
  // else starts where its own token starts.
  const start =
    current.token.kind === "close" ? startOfList(document, current) : current.start;

  return start === undefined ? undefined : withPrefixes(document, start);
}

/** Extend `start` backward over any reader prefixes that bind to the datum there. */
function withPrefixes(document: TokenizedDocument, start: number): number {
  let earliest = start;
  let previous = tokenAtOrBefore(document, earliest);
  while (previous?.token.kind === "prefix" && previous.end === earliest) {
    earliest = previous.start;
    previous = tokenAtOrBefore(document, earliest);
  }
  return earliest;
}

/** Move out of the enclosing list, to before its opening bracket. */
export function backwardUpList(
  document: TokenizedDocument,
  offset: number,
): number | undefined {
  const open = enclosingOpen(document, offset);
  return open === undefined ? undefined : withPrefixes(document, open.start);
}

/** Move out of the enclosing list, to after its closing bracket. */
export function forwardUpList(document: TokenizedDocument, offset: number): number | undefined {
  const open = enclosingOpen(document, offset);
  return open === undefined ? undefined : endOfList(document, open);
}

/** Move into the next list, to just after its opening bracket. */
export function downList(document: TokenizedDocument, offset: number): number | undefined {
  let current = tokenAtOrAfter(document, offset);
  while (current !== undefined && current.token.kind !== "open") {
    if (current.token.kind === "close") {
      return undefined;
    }
    current = after(document, current);
  }
  return current?.end;
}

/** Move into the previous list, to just before its closing bracket. */
export function backwardDownList(
  document: TokenizedDocument,
  offset: number,
): number | undefined {
  let current = tokenAtOrBefore(document, offset);
  while (current !== undefined && current.token.kind !== "close") {
    if (current.token.kind === "open") {
      return undefined;
    }
    current = before(document, current);
  }
  return current?.start;
}

/** The open bracket of the innermost list containing `offset`. */
function enclosingOpen(document: TokenizedDocument, offset: number): Located | undefined {
  let depth = 0;
  let current = tokenAtOrBefore(document, offset);
  while (current !== undefined) {
    if (current.token.kind === "close") {
      depth += 1;
    } else if (current.token.kind === "open") {
      if (depth === 0) {
        return current;
      }
      depth -= 1;
    }
    current = before(document, current);
  }
  return undefined;
}

/** The span of the innermost list containing `offset`, brackets included. */
export interface ListSpan {
  readonly openStart: number;
  readonly openEnd: number;
  readonly closeStart: number;
  readonly closeEnd: number;
}

export function enclosingList(
  document: TokenizedDocument,
  offset: number,
): ListSpan | undefined {
  const open = enclosingOpen(document, offset);
  if (open === undefined) {
    return undefined;
  }
  const closeEnd = endOfList(document, open);
  if (closeEnd === undefined) {
    return undefined;
  }
  const close = tokenAtOrBefore(document, closeEnd);
  if (close === undefined) {
    return undefined;
  }
  return {
    openStart: open.start,
    openEnd: open.end,
    closeStart: close.start,
    closeEnd,
  };
}

/** Whether `offset` lies inside a string literal (not merely at its edge). */
export function withinString(document: TokenizedDocument, offset: number): boolean {
  const located = tokenAtOrAfter(document, offset);
  return located?.token.kind === "string" && located.start < offset;
}

/** Whether `offset` lies inside a comment. */
export function withinComment(document: TokenizedDocument, offset: number): boolean {
  const located = tokenAtOrAfter(document, offset);
  return located?.token.kind === "comment" && located.start < offset;
}
