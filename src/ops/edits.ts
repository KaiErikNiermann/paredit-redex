/**
 * The edit model the structural operations produce.
 *
 * Operations are pure functions from a tokenised document and a caret to an
 * `EditPlan`; nothing here knows about VS Code. That boundary is what makes the
 * whole command set testable as `before -> after` strings, and it is also what
 * lets multi-cursor support be an additive change in the adapter rather than a
 * rewrite of every operation.
 */

import type { TokenizedDocument } from "../reader/document";
import type { Span } from "../reader/cursor";
import { isDelimiterChar, wouldFuse } from "../reader/tokens";

/** Replace the text in `[start, end)` with `text`. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface EditPlan {
  /** Non-overlapping, in ascending order of `start`. */
  readonly edits: readonly Edit[];
  /** Where the caret goes, in offsets of the document *after* the edits. */
  readonly caret: number;
}

/** An operation: the caret is an absolute offset, `undefined` means "no-op". */
export type Operation = (
  document: TokenizedDocument,
  offset: number,
) => EditPlan | undefined;

export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = text;
  // Back to front, so each edit's offsets still refer to the text it sees.
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/** Where `offset` ends up once `edits` have been applied. */
export function mapOffset(offset: number, edits: readonly Edit[]): number {
  let mapped = offset;
  for (const edit of edits) {
    if (edit.end <= offset) {
      mapped += edit.text.length - (edit.end - edit.start);
    } else if (edit.start < offset) {
      // The caret was inside the replaced range; put it at the end of what
      // replaced it rather than somewhere arbitrary inside.
      mapped = edit.start + edit.text.length;
    }
  }
  return mapped;
}

const WHITESPACE = /\s/;

/** Extend `span` backward over whitespace, not past `limit`. */
export function withLeadingSpace(text: string, span: Span, limit: number): Span {
  let start = span.start;
  while (start > limit && WHITESPACE.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  return { start, end: span.end };
}

/** Extend `span` forward over whitespace, not past `limit`. */
export function withTrailingSpace(text: string, span: Span, limit: number): Span {
  let end = span.end;
  while (end < limit && WHITESPACE.test(text[end] ?? "")) {
    end += 1;
  }
  return { start: span.start, end };
}

/** A deletion of `span`, as an edit. */
export function remove(span: Span): Edit {
  return { start: span.start, end: span.end, text: "" };
}

/**
 * Delete `span`, leaving one space where removing it would fuse its neighbours.
 *
 * Without this, forward-slurping in `(a)b` produces `(ab)` — two data silently
 * become one symbol. That is a correctness bug, not a formatting preference.
 */
export function removeSeparating(text: string, span: Span): Edit {
  const before = text[span.start - 1];
  const after = text[span.end];
  const fuses = before !== undefined && after !== undefined && wouldFuse(before, after);
  return { start: span.start, end: span.end, text: fuses ? " " : "" };
}

/**
 * Insert a closing bracket at `offset`, hugging the text to its left.
 *
 * A space follows it when something other than whitespace or another closer is
 * there, which is what makes `(foo)` barf to `() foo` rather than `()foo`. Both
 * read the same; paredit produces the readable one.
 */
export function insertCloser(source: string, offset: number, text: string): Edit {
  const after = source[offset];
  const needsSpace = after !== undefined && !WHITESPACE.test(after) && !isCloser(after);
  return insert(offset, needsSpace ? `${text} ` : text);
}

/** Insert an opening bracket at `offset`, hugging the text to its right. */
export function insertOpener(source: string, offset: number, text: string): Edit {
  const before = source[offset - 1];
  const needsSpace = before !== undefined && !WHITESPACE.test(before) && !isOpener(before);
  return insert(offset, needsSpace ? ` ${text}` : text);
}

function isCloser(char: string): boolean {
  return isDelimiterChar(char) && [")", "]", "}"].includes(char);
}

function isOpener(char: string): boolean {
  return isDelimiterChar(char) && ["(", "[", "{"].includes(char);
}

/** An insertion of `text` at `offset`, as an edit. */
export function insert(offset: number, text: string): Edit {
  return { start: offset, end: offset, text };
}
