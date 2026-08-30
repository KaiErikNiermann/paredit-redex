/**
 * Test support for the operation tables.
 *
 * Operations are written as `before -> after` strings with the caret marked, the
 * way paredit.el's own test suite does it.
 */

import { TokenizedDocument } from "../reader/document";
import { CARET, formatCaret, parseCaret } from "./caret-notation";
import type { Operation } from "./edits";
import { applyEdits } from "./edits";

export { CARET };

/** Run `operation` on a caret-marked source, returning the result caret-marked. */
export function run(operation: Operation, marked: string): string {
  const { source, offset } = parseCaret(marked);
  const plan = operation(new TokenizedDocument(source), offset);
  if (plan === undefined) {
    return "<no-op>";
  }
  return formatCaret(applyEdits(source, plan.edits), plan.caret);
}
