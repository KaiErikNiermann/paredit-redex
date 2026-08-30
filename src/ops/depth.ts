/**
 * Operations that change the depth of the enclosing list: slurp, barf, splice,
 * raise and wrap.
 *
 * Two invariants run through all of them.
 *
 * Bracket shape is preserved. Racket code is full of `[cond ...]` and
 * `[let ([x 1])]`, so an operation that rebuilt a list with `(` would quietly
 * rewrite the source. The shape is carried on the token, and the closer is
 * reconstructed from it rather than from the character that happened to be
 * there.
 *
 * Positions come from tokens, never from character arithmetic. A delimiter is
 * not one character — `#hash(` is a single open token — so `open.end` is the
 * only correct way to get past one.
 */

import {
  backwardDatum,
  datumSpanAt,
  enclosingList,
  forwardDatum,
  tokenAtOrAfter,
} from "../reader/cursor";
import type { Span } from "../reader/cursor";
import type { TokenizedDocument } from "../reader/document";
import { closerFor } from "../reader/tokens";
import type { BracketShape } from "../reader/tokens";
import type { EditPlan, Operation } from "./edits";
import {
  insert,
  insertCloser,
  insertOpener,
  mapOffset,
  removeSeparating,
  withLeadingSpace,
  withTrailingSpace,
} from "./edits";

function openShape(document: TokenizedDocument, openStart: number): BracketShape | undefined {
  const located = tokenAtOrAfter(document, openStart);
  return located?.token.kind === "open" ? located.token.shape : undefined;
}

/**
 * Move the enclosing list's closing bracket rightward over the next datum.
 *
 * `(foo (bar‸) baz)` becomes `(foo (bar baz‸))`.
 */
export function forwardSlurp(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const shape = openShape(document, list.openStart);
  if (shape === undefined) {
    return undefined;
  }

  // The datum to swallow must be a real datum outside the list, not the closing
  // bracket of whatever encloses it.
  const swallowed = datumSpanAt(document, list.closeEnd);
  if (swallowed === undefined) {
    return undefined;
  }

  const text = document.getText();
  // Take the whitespace that was sitting before the old closer with it, so
  // `(a b ) c` slurps to `(a b c)` rather than leaving a double space.
  const removed = withLeadingSpace(
    text,
    { start: list.closeStart, end: list.closeEnd },
    list.openEnd,
  );
  const edits = [
    removeSeparating(text, removed),
    insert(swallowed.end, closerFor(shape)),
  ];
  return { edits, caret: mapOffset(offset, edits) };
}

/**
 * Move the enclosing list's closing bracket leftward, expelling the last datum.
 *
 * `(foo (bar baz‸))` becomes `(foo (bar‸) baz)`.
 */
export function forwardBarf(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const shape = openShape(document, list.openStart);
  if (shape === undefined) {
    return undefined;
  }

  const expelled = lastDatumIn(document, list);
  if (expelled === undefined) {
    return undefined;
  }

  const text = document.getText();
  const removed = withLeadingSpace(
    text,
    { start: list.closeStart, end: list.closeEnd },
    list.openEnd,
  );
  // The closer lands at the end of what remains, which is a token boundary and
  // so can never be inside a line comment.
  const landing = withLeadingSpace(text, { start: expelled.start, end: expelled.start }, list.openEnd)
    .start;
  const edits = [
    insertCloser(text, landing, closerFor(shape)),
    removeSeparating(text, removed),
  ];
  return { edits, caret: mapOffset(offset, edits) };
}

/**
 * Move the enclosing list's opening bracket leftward over the previous datum.
 *
 * `foo (‸bar)` becomes `(foo ‸bar)`.
 */
export function backwardSlurp(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  // The whole open lexeme moves, `#hash(` included, not just a bracket char.
  const opener = document.getText().slice(list.openStart, list.openEnd);

  const swallowed = datumBefore(document, list.openStart);
  if (swallowed === undefined || swallowed.end > list.openStart) {
    return undefined;
  }

  const text = document.getText();
  const removed = withTrailingSpace(
    text,
    { start: list.openStart, end: list.openEnd },
    list.closeStart,
  );
  const edits = [
    insert(swallowed.start, opener),
    removeSeparating(text, removed),
  ];
  return { edits, caret: mapOffset(offset, edits) };
}

/**
 * Move the enclosing list's opening bracket rightward, expelling the first datum.
 *
 * `(foo ‸bar)` becomes `foo (‸bar)`.
 */
export function backwardBarf(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const opener = document.getText().slice(list.openStart, list.openEnd);

  const first = datumSpanAt(document, list.openEnd);
  if (first === undefined) {
    return undefined;
  }
  const remaining = datumSpanAt(document, first.end);
  if (remaining === undefined) {
    return undefined;
  }

  const text = document.getText();
  const removed = withTrailingSpace(
    text,
    { start: list.openStart, end: list.openEnd },
    list.closeStart,
  );
  const edits = [
    removeSeparating(text, removed),
    insertOpener(text, remaining.start, opener),
  ];
  return { edits, caret: mapOffset(offset, edits) };
}

/**
 * Remove the enclosing list's brackets, raising its contents one level.
 *
 * `(foo (bar ‸baz))` becomes `(foo bar ‸baz)`.
 */
export function splice(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const text = document.getText();
  const edits = [
    removeSeparating(
      text,
      withTrailingSpace(text, { start: list.openStart, end: list.openEnd }, list.closeStart),
    ),
    removeSeparating(
      text,
      withLeadingSpace(text, { start: list.closeStart, end: list.closeEnd }, list.openEnd),
    ),
  ];
  return { edits, caret: mapOffset(offset, edits) };
}

/**
 * Replace the enclosing list with the datum at point.
 *
 * `(foo (bar ‸baz))` becomes `(foo ‸baz)`.
 */
export function raise(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  const datum = datumSpanAt(document, offset);
  if (list === undefined || datum === undefined) {
    return undefined;
  }
  const edits = [
    {
      start: list.openStart,
      end: list.closeEnd,
      text: document.getText().slice(datum.start, datum.end),
    },
  ];
  return { edits, caret: list.openStart };
}

/** Wrap the datum at point in a new pair of brackets, leaving point inside. */
export function wrap(shape: BracketShape): Operation {
  return function wrapWith(
    document: TokenizedDocument,
    offset: number,
  ): EditPlan | undefined {
    const datum = datumSpanAt(document, offset);
    if (datum === undefined) {
      return undefined;
    }
    const edits = [insert(datum.start, shape), insert(datum.end, closerFor(shape))];
    return { edits, caret: datum.start + shape.length };
  };
}

/** The last datum inside `list`, or undefined if it is empty. */
function lastDatumIn(
  document: TokenizedDocument,
  list: { readonly openEnd: number; readonly closeStart: number },
): Span | undefined {
  let candidate: Span | undefined;
  let cursor = list.openEnd;
  for (;;) {
    const datum = datumSpanAt(document, cursor);
    if (datum === undefined || datum.end > list.closeStart) {
      return candidate;
    }
    candidate = datum;
    cursor = datum.end;
  }
}

/** The datum ending at or before `offset`, prefixes included. */
function datumBefore(document: TokenizedDocument, offset: number): Span | undefined {
  const start = backwardDatum(document, offset);
  if (start === undefined) {
    return undefined;
  }
  const end = forwardDatum(document, start);
  return end === undefined ? undefined : { start, end };
}
