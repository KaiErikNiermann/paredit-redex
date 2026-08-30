/**
 * Every operation, at every offset, over every fixture source.
 *
 * The fixtures are the adversarial ones: unterminated strings, unclosed block
 * comments, dangling bar symbols, here strings, astral characters. An operation
 * is allowed to decline any of them, but it is not allowed to throw, to produce
 * overlapping or out-of-range edits, or to leave the caret outside the document.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from ".";
import { TokenizedDocument } from "../reader/document";
import { applyEdits } from "./edits";

interface Fixture {
  readonly name: string;
  readonly source: string;
}

const SOURCES: readonly Fixture[] = (
  JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "lexer-oracle.json"), "utf8"),
  ) as Fixture[]
).map((fixture) => ({ name: fixture.name, source: fixture.source }));

describe("operations are total over adversarial input", () => {
  it.each(Object.keys(OPERATIONS))("%s never misbehaves", (name) => {
    const operation = OPERATIONS[name];
    expect(operation).toBeDefined();

    for (const { name: fixture, source } of SOURCES) {
      const document = new TokenizedDocument(source);
      for (let offset = 0; offset <= source.length; offset += 1) {
        const where = `${name} at ${String(offset)} of ${fixture}`;
        const plan = operation?.(document, offset);
        if (plan === undefined) {
          continue;
        }

        let previousEnd = -1;
        for (const edit of [...plan.edits].sort((a, b) => a.start - b.start)) {
          expect(edit.start, where).toBeGreaterThanOrEqual(0);
          expect(edit.end, where).toBeLessThanOrEqual(source.length);
          expect(edit.start, where).toBeLessThanOrEqual(edit.end);
          // Non-overlapping, or applying them would depend on their order.
          expect(edit.start, where).toBeGreaterThanOrEqual(previousEnd);
          previousEnd = edit.end;
        }

        const result = applyEdits(source, plan.edits);
        expect(plan.caret, where).toBeGreaterThanOrEqual(0);
        expect(plan.caret, where).toBeLessThanOrEqual(result.length);
      }
    }
  });
});
