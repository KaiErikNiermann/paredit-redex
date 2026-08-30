/**
 * Operations that delete a datum or part of a list.
 */

import { backwardDatum, enclosingList, forwardDatum } from "../reader/cursor";
import type { Span } from "../reader/cursor";
import type { TokenizedDocument } from "../reader/document";
import { isDelimiterChar } from "../reader/tokens";
import type { EditPlan } from "./edits";
import { mapOffset, remove, removeSeparating, withLeadingSpace } from "./edits";

const SPACE = /\s/;

/**
 * Widen a deletion so that removing a datum does not leave the gap behind.
 *
 * Deleting `b` from `(a b c)` on the nose gives `(a  c)`, and from `(a b)` it
 * gives `(a )`. Emacs leaves both; there is no reason to. The rule is to absorb
 * the whitespace on whichever side would otherwise be doubled or stranded
 * against a bracket.
 */
function tidyKillSpan(text: string, span: Span): Span {
  const before = text[span.start - 1];
  const after = text[span.end];

  if ((before === undefined || SPACE.test(before) || isOpener(before)) && isSpace(after)) {
    let end = span.end;
    while (isSpace(text[end])) {
      end += 1;
    }
    return { start: span.start, end };
  }

  if (before !== undefined && SPACE.test(before) && (after === undefined || isCloser(after))) {
    let start = span.start;
    while (start > 0 && isSpace(text[start - 1])) {
      start -= 1;
    }
    return { start, end: span.end };
  }

  return span;
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && SPACE.test(char);
}

function isOpener(char: string): boolean {
  return isDelimiterChar(char) && ["(", "[", "{"].includes(char);
}

function isCloser(char: string): boolean {
  return isDelimiterChar(char) && [")", "]", "}"].includes(char);
}

/** Delete from the caret through the end of the next datum. */
export function killSexp(
  document: TokenizedDocument,
  offset: number,
): EditPlan | undefined {
  const end = forwardDatum(document, offset);
  if (end === undefined || end <= offset) {
    return undefined;
  }
  const span = tidyKillSpan(document.getText(), { start: offset, end });
  return { edits: [remove(span)], caret: span.start };
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
  const span = tidyKillSpan(document.getText(), { start, end: offset });
  return { edits: [remove(span)], caret: span.start };
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
  // The caret can sit inside the opening bracket itself -- `#hash(` is six
  // characters -- and the two deletions would then overlap.
  const from = Math.max(offset, list.openEnd);
  const text = document.getText();
  const edits = [
    remove({ start: list.openStart, end: from }),
    removeSeparating(
      text,
      withLeadingSpace(text, { start: list.closeStart, end: list.closeEnd }, from),
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
  const from = Math.max(offset, list.openEnd);
  const text = document.getText();
  const edits = [
    removeSeparating(text, { start: list.openStart, end: list.openEnd }),
    remove({ start: from, end: list.closeEnd }),
  ];
  return { edits, caret: mapOffset(from, edits) };
}
