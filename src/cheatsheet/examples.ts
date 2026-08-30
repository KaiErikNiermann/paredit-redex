/**
 * Before/after examples, produced by running the commands.
 *
 * Nothing here is written by hand except the "before" string in the catalog.
 * The consequence is that the cheat sheet cannot claim a transform the code does
 * not perform: change an operation and the page changes with it, and the tests
 * fail if an example stops transforming anything at all.
 */

import { applyEdits } from "../ops/edits";
import { formatCaret, parseCaret } from "../ops/caret-notation";
import { MOTIONS } from "../ops/motions";
import { OPERATIONS } from "../ops";
import { TokenizedDocument } from "../reader/document";
import type { CatalogEntry } from "./catalog";

export interface Example {
  readonly before: string;
  readonly after: string;
}

/**
 * Run `entry`'s example, or `undefined` if it has none or the command declines.
 */
export function exampleFor(entry: CatalogEntry): Example | undefined {
  if (entry.example === undefined) {
    return undefined;
  }
  const { source, offset } = parseCaret(entry.example);
  const document = new TokenizedDocument(source);

  switch (entry.kind) {
    case "motion": {
      const target = MOTIONS[entry.command]?.(document, offset);
      return target === undefined
        ? undefined
        : { before: entry.example, after: formatCaret(source, target) };
    }
    case "edit": {
      const plan = OPERATIONS[entry.command]?.(document, offset);
      return plan === undefined
        ? undefined
        : {
            before: entry.example,
            after: formatCaret(applyEdits(source, plan.edits), plan.caret),
          };
    }
    case "panel": {
      return undefined;
    }
  }
}
