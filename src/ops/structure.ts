/**
 * Operations that rearrange siblings within a list: split, join, transpose and
 * drag.
 *
 * Drag has no equivalent in `paredit.el` — it comes from Calva, where it is in
 * practice the most-used structural command of the lot.
 */

import { datumSpanAt, enclosingList, tokenAtOrAfter, tokenAtOrBefore } from "../reader/cursor";
import type { Span } from "../reader/cursor";
import type { TokenizedDocument } from "../reader/document";
import { closerFor, isSkippable } from "../reader/tokens";
import type { Edit, EditPlan } from "./edits";
import { withLeadingSpace, withTrailingSpace } from "./edits";

/**
 * Split the enclosing list in two at the caret.
 *
 * `(a b‸ c d)` becomes `(a b) ‸(c d)`.
 */
export function splitSexp(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const opened = tokenAtOrAfter(document, list.openStart);
  if (opened?.token.kind !== "open") {
    return undefined;
  }

  const text = document.getText();
  const opener = text.slice(list.openStart, list.openEnd);
  const closer = closerFor(opened.token.shape);

  // Absorb the whitespace on both sides of the caret, so the split leaves one
  // space between the two lists rather than however much happened to be there.
  const left = withLeadingSpace(text, { start: offset, end: offset }, list.openEnd).start;
  const right = withTrailingSpace(text, { start: offset, end: offset }, list.closeStart).end;

  const replacement = `${closer} ${opener}`;
  return {
    edits: [{ start: left, end: right, text: replacement }],
    caret: left + closer.length + 1,
  };
}

/**
 * Join the list before the caret with the one after it.
 *
 * `(a b) ‸(c d)` becomes `(a b ‸c d)`.
 */
export function joinSexps(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const left = skipBack(document, offset);
  const right = skipAhead(document, offset);
  if (left?.token.kind !== "close" || right?.token.kind !== "open") {
    return undefined;
  }
  return {
    edits: [{ start: left.start, end: right.end, text: " " }],
    caret: left.start + 1,
  };
}

/**
 * Swap the datum before the caret with the one after it.
 *
 * `(a ‸b)` becomes `(b a‸)`.
 */
export function transposeSexps(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const pair = adjacentPair(document, offset);
  if (pair === undefined) {
    return undefined;
  }
  const text = document.getText();
  return {
    edits: swapEdits(text, pair.left, pair.right),
    caret: pair.right.end,
  };
}

/** Move the datum at the caret one place later among its siblings. */
export function dragForward(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const current = datumSpanAt(document, offset);
  if (current === undefined) {
    return undefined;
  }
  const next = siblingAfter(document, current);
  if (next === undefined) {
    return undefined;
  }
  const text = document.getText();
  // The dragged datum ends up flush against where its new neighbour ends.
  const landing = next.end - (current.end - current.start);
  return {
    edits: swapEdits(text, current, next),
    caret: landing + within(offset, current),
  };
}

/** Move the datum at the caret one place earlier among its siblings. */
export function dragBackward(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const current = datumSpanAt(document, offset);
  if (current === undefined) {
    return undefined;
  }
  const previous = siblingBefore(document, current);
  if (previous === undefined) {
    return undefined;
  }
  const text = document.getText();
  return {
    edits: swapEdits(text, previous, current),
    caret: previous.start + within(offset, current),
  };
}

/**
 * How far into `span` the caret sits, clamped to its extent.
 *
 * The caret need not be inside the datum being dragged — `datumSpanAt` also
 * finds the next one ahead — so this cannot be a plain subtraction.
 */
function within(offset: number, span: Span): number {
  return Math.max(0, Math.min(offset - span.start, span.end - span.start));
}

/** Two edits that exchange the text of two disjoint spans. */
function swapEdits(text: string, left: Span, right: Span): Edit[] {
  return [
    { start: left.start, end: left.end, text: text.slice(right.start, right.end) },
    { start: right.start, end: right.end, text: text.slice(left.start, left.end) },
  ];
}

/** The datum before and the datum after the caret, if both exist in one list. */
function adjacentPair(
  document: TokenizedDocument,
  offset: number,
): { left: Span; right: Span } | undefined {
  const right = datumSpanAt(document, offset);
  if (right === undefined) {
    return undefined;
  }
  const left = siblingBefore(document, right);
  return left === undefined ? undefined : { left, right };
}

/** The next sibling of `span`, or undefined at the end of the list. */
function siblingAfter(document: TokenizedDocument, span: Span): Span | undefined {
  const next = datumSpanAt(document, span.end);
  return next === undefined || next.start < span.end ? undefined : next;
}

/** The previous sibling of `span`, or undefined at the start of the list. */
function siblingBefore(document: TokenizedDocument, span: Span): Span | undefined {
  const previous = skipBack(document, span.start);
  if (previous === undefined || previous.token.kind === "open") {
    return undefined;
  }
  const candidate = datumSpanAt(document, previous.start);
  if (candidate !== undefined && candidate.end <= span.start) {
    return candidate;
  }
  // `previous` is the closing bracket of a list, so back up to where it opens.
  const enclosed = enclosingList(document, previous.start);
  return enclosed === undefined
    ? undefined
    : { start: enclosed.openStart, end: enclosed.closeEnd };
}

function skipAhead(document: TokenizedDocument, offset: number) {
  let located = tokenAtOrAfter(document, offset);
  while (located !== undefined && isSkippable(located.token)) {
    located = tokenAtOrAfter(document, located.end);
  }
  return located;
}

function skipBack(document: TokenizedDocument, offset: number) {
  let located = tokenAtOrBefore(document, offset);
  while (located !== undefined && isSkippable(located.token)) {
    located = tokenAtOrBefore(document, located.start);
  }
  return located;
}
