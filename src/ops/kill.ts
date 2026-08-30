/**
 * Operations that delete a datum or part of a list.
 */

import { backwardDatum, enclosingList, forwardDatum } from "../reader/cursor";
import type { TokenizedDocument } from "../reader/document";
import type { EditPlan } from "./edits";
import { mapOffset, remove, removeSeparating, withLeadingSpace } from "./edits";

/** Delete from the caret through the end of the next datum. */
export function killSexp(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const end = forwardDatum(document, offset);
  if (end === undefined || end <= offset) {
    return undefined;
  }
  return { edits: [remove({ start: offset, end })], caret: offset };
}

/** Delete from the start of the previous datum through the caret. */
export function backwardKillSexp(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const start = backwardDatum(document, offset);
  if (start === undefined || start >= offset) {
    return undefined;
  }
  return { edits: [remove({ start, end: offset })], caret: start };
}

/**
 * Kill everything before the caret in the enclosing list, then splice.
 *
 * `(foo (bar ‸baz) quux)` becomes `(foo ‸baz quux)`.
 */
export function spliceKillingBackward(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const text = document.getText();
  const edits = [
    remove({ start: list.openStart, end: offset }),
    removeSeparating(
      text,
      withLeadingSpace(text, { start: list.closeStart, end: list.closeEnd }, offset),
    ),
  ];
  return { edits, caret: list.openStart };
}

/**
 * Kill everything after the caret in the enclosing list, then splice.
 *
 * `(foo (bar‸ baz) quux)` becomes `(foo bar‸ quux)`.
 */
export function spliceKillingForward(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const list = enclosingList(document, offset);
  if (list === undefined) {
    return undefined;
  }
  const text = document.getText();
  const edits = [
    removeSeparating(text, { start: list.openStart, end: list.openEnd }),
    remove({ start: offset, end: list.closeEnd }),
  ];
  return { edits, caret: mapOffset(offset, edits) };
}
