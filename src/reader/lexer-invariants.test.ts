/**
 * Properties the lexer must hold on *any* input, checked without an oracle.
 *
 * The differential fuzzer is the sharper tool, but it needs a local Racket
 * install and so cannot run in CI. These are the properties that can be stated
 * without a second opinion, and they cover the inputs the oracle path cannot
 * reach anyway: lone surrogates, control characters, and CRLF, which the oracle
 * harness has to normalise away.
 *
 * Totality is the load-bearing one. Every operation downstream — the cursor, the
 * incremental store, every paredit command — assumes the tokens of a line tile
 * it exactly, with no gaps, no overlaps and nothing empty. A lexer that broke
 * that would not fail loudly; it would silently mislocate brackets.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TokenizedDocument } from "./document";
import type { LexState } from "./lex-state";
import { DEFAULT_STATE, statesEqual } from "./lex-state";
import { lexLine } from "./lexer";
import { ROBUSTNESS_FRAGMENTS } from "./testing/fragments";

/** Sources built from reader fragments, with free-form text mixed in. */
const source = fc
  .array(
    fc.oneof(
      { weight: 8, arbitrary: fc.constantFrom(...ROBUSTNESS_FRAGMENTS) },
      { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 6 }) },
      // Arbitrary code points, lone surrogates included: the lexer must not
      // choke on text no oracle run would ever hand it.
      { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 6 }) },
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((parts) => parts.join(""));

const line = source.map((text) => text.replaceAll("\n", ""));

const anyState: fc.Arbitrary<LexState> = fc.oneof(
  fc.constant(DEFAULT_STATE),
  fc.constant({ kind: "bar" } as const),
  fc.constant({ kind: "pending-char" } as const),
  fc.constant({ kind: "script-line" } as const),
  fc.constant({ kind: "atom-continuation" } as const),
  fc.integer({ min: 1, max: 4 }).map((depth) => ({ kind: "block-comment", depth }) as const),
  fc
    .constantFrom("string", "byte", "regexp", "byte-regexp" as const)
    .map((flavor) => ({ kind: "string", flavor }) as const),
  fc.string({ maxLength: 4 }).map((tag) => ({ kind: "here-string", tag }) as const),
);

describe("lexLine is total", () => {
  it("tiles the line exactly, from any starting state", () => {
    fc.assert(
      fc.property(line, anyState, (text, state) => {
        const { tokens } = lexLine(text, state);
        let cursor = 0;
        for (const token of tokens) {
          expect(token.start).toBe(cursor);
          expect(token.end).toBeGreaterThan(token.start);
          cursor = token.end;
        }
        expect(cursor).toBe(text.length);
      }),
      { numRuns: 5000 },
    );
  });

  it("reconstructs the line from its token texts", () => {
    fc.assert(
      fc.property(line, anyState, (text, state) => {
        const { tokens } = lexLine(text, state);
        expect(tokens.map((token) => text.slice(token.start, token.end)).join("")).toBe(text);
      }),
      { numRuns: 5000 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(line, anyState, (text, state) => {
        const first = lexLine(text, state);
        const second = lexLine(text, state);
        expect(second.tokens).toEqual(first.tokens);
        expect(statesEqual(second.stateOut, first.stateOut)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("the incremental store matches a full relex", () => {
  // The store's own suite covers this with hand-written edits; this generates
  // them, and shrinks a failure down to the smallest edit sequence that shows it
  // rather than leaving sixty of them to read through.
  it("holds under generated edit sequences", () => {
    const edit = fc.record({
      startLine: fc.nat({ max: 12 }),
      startCharacter: fc.nat({ max: 20 }),
      lineSpan: fc.nat({ max: 3 }),
      endCharacter: fc.nat({ max: 20 }),
      text: fc.oneof(fc.constantFrom(...ROBUSTNESS_FRAGMENTS), fc.constant("")),
    });

    fc.assert(
      fc.property(source, fc.array(edit, { minLength: 1, maxLength: 25 }), (initial, edits) => {
        const document = new TokenizedDocument(initial);

        for (const step of edits) {
          const startLine = Math.min(step.startLine, document.lineCount - 1);
          const endLine = Math.min(startLine + step.lineSpan, document.lineCount - 1);
          document.applyChange({
            start: {
              line: startLine,
              character: Math.min(step.startCharacter, document.lineText(startLine).length),
            },
            end: {
              line: endLine,
              character: Math.min(step.endCharacter, document.lineText(endLine).length),
            },
            text: step.text,
          });

          const fresh = new TokenizedDocument(document.getText());
          expect(document.getText()).toBe(fresh.getText());
          for (let index = 0; index < fresh.lineCount; index += 1) {
            expect(document.tokens(index)).toEqual(fresh.tokens(index));
            expect(document.stateAt(index)).toEqual(fresh.stateAt(index));
          }
        }
      }),
      { numRuns: 400 },
    );
  }, 120_000);
});
