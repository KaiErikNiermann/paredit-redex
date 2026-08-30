/**
 * The paredit operation set, by command name.
 *
 * Every entry is a pure function of `(document, offset)`; nothing here imports
 * `vscode`. The adapter turns the resulting `EditPlan`s into a single editor
 * edit, which is what keeps undo to one step per command.
 */

import type { Operation } from "./edits";
import {
  backwardBarf,
  backwardSlurp,
  forwardBarf,
  forwardSlurp,
  raise,
  splice,
  wrap,
} from "./depth";
import {
  backwardKillSexp,
  killSexp,
  spliceKillingBackward,
  spliceKillingForward,
} from "./kill";
import { dragBackward, dragForward, joinSexps, splitSexp, transposeSexps } from "./structure";

export const OPERATIONS: Readonly<Record<string, Operation>> = {
  forwardSlurp,
  forwardBarf,
  backwardSlurp,
  backwardBarf,
  splice,
  raise,
  wrapRound: wrap("("),
  wrapSquare: wrap("["),
  wrapCurly: wrap("{"),
  killSexp,
  backwardKillSexp,
  spliceKillingBackward,
  spliceKillingForward,
  splitSexp,
  joinSexps,
  transposeSexps,
  dragForward,
  dragBackward,
};
