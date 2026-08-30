/**
 * The structural motions, by command name.
 *
 * Separate from `OPERATIONS` because a motion only moves the caret; it produces
 * no edit. Shared by the command adapter and the cheat sheet so that neither can
 * describe a command the other does not have.
 */

import {
  backwardDatum,
  backwardDownList,
  backwardUpList,
  downList,
  forwardDatum,
  forwardUpList,
} from "../reader/cursor";
import type { TokenizedDocument } from "../reader/document";

export type Motion = (document: TokenizedDocument, offset: number) => number | undefined;

export const MOTIONS: Readonly<Record<string, Motion>> = {
  forwardSexp: forwardDatum,
  backwardSexp: backwardDatum,
  forwardUpSexp: forwardUpList,
  backwardUpSexp: backwardUpList,
  forwardDownSexp: downList,
  backwardDownSexp: backwardDownList,
};
