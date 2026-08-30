/**
 * Test support for the operation tables.
 *
 * Operations are written as `before -> after` strings with the caret marked, the
 * way paredit.el's own test suite does it. The marker is U+2038 rather than `|`
 * because in Racket a pipe delimits a bar-quoted symbol, so `(a |b)` is a real
 * program and pipes would be ambiguous in the cases most worth testing.
 */

import { TokenizedDocument } from "../reader/document";
import type { Operation } from "./edits";
import { applyEdits } from "./edits";

export const CARET = "‸";

/** Run `operation` on a caret-marked source, returning the result caret-marked. */
export function run(operation: Operation, marked: string): string {
  const offset = marked.indexOf(CARET);
  if (offset < 0) {
    throw new Error(`no caret in ${JSON.stringify(marked)}`);
  }
  const source = marked.replace(CARET, "");
  const plan = operation(new TokenizedDocument(source), offset);
  if (plan === undefined) {
    return "<no-op>";
  }
  const result = applyEdits(source, plan.edits);
  return result.slice(0, plan.caret) + CARET + result.slice(plan.caret);
}
