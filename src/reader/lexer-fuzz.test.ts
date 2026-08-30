/**
 * Differential fuzzing of the lexer against `syntax-color/racket-lexer`.
 *
 * The corpus sweep in `oracle-corpus.test.ts` is broad but biased: every one of
 * its 5290 files is valid, committed Racket, and real code essentially never
 * puts `#|` immediately before `#\"` or opens a here string whose tag is `(`.
 * Those adjacencies are exactly where a hand-written state machine and the real
 * reader come apart, and they are also the normal condition of a buffer being
 * typed into. This generates them on purpose.
 *
 * Failures shrink. Without that a counterexample is a few hundred characters of
 * noise; with it you get the handful of characters that actually matter, which
 * is the difference between a bug report and a bug fix. Shrinking asks for many
 * small lexings, which is why the oracle here is a warm process rather than a
 * fresh one per call.
 *
 * Runs from `pnpm test:oracle`, so neither CI nor a contributor needs Racket.
 */

import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "./lex-state";
import { lexLine } from "./lexer";
import type { Token } from "./tokens";
import { compareLexers, lexSourceToSpans } from "./oracle-diff";
import type { Mismatch, Span } from "./oracle-diff";
import { FRAGMENTS } from "./testing/fragments";
import { OracleProcess, racketAvailable } from "./testing/oracle-process";

const HAS_RACKET = racketAvailable();

/** Sources built by concatenating reader fragments, plus the odd free-form atom. */
const source = fc
  .array(
    fc.oneof(
      { weight: 9, arbitrary: fc.constantFrom(...FRAGMENTS) },
      { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 4 }) },
    ),
    { minLength: 1, maxLength: 24 },
  )
  .map((parts) => parts.join(""))
  // A lone CR would only exercise a known artifact of the harness, not the
  // lexer: Racket collapses CRLF to one position when line counting is on, and
  // lex.rkt normalises it away before anything is compared.
  .map((text) => text.replaceAll("\r", ""));

/**
 * The two known divergences, excluded deliberately rather than papered over.
 *
 * Both are confined to malformed `#` forms. The sweep over all 5290 files of the
 * local Racket installation finds no divergence, so no real program is affected,
 * and both exclusions are applied to the generated *input* rather than to the
 * comparison — they cannot hide a disagreement about any other construct.
 *
 * **Quoting inside a boolean atom.** In an atom beginning with `#t`, `#f`, `#T`
 * or `#F`, the two lexers disagree about whether a backslash or a bar quotes
 * what follows:
 *
 *     #t\(      ->  error "#t\"  then a real `(`     (no quoting)
 *     #b\(      ->  error "#b\(" as one token        (quoting)
 *     #t|a(b|   ->  error "#t|a", `(`, error "b|"    (no quoting)
 *     #b|a(b|   ->  error "#b|a(b|" as one token     (quoting)
 *
 * Every other `#` form agrees, `#%` and `#:` included. The difference falls out
 * of how `racket-lexer`'s longest match resolves between its boolean rule and
 * its bad-identifier rule.
 *
 * **A `#!` that is not a shebang.** `#![ /]` is a script line and is handled;
 * anything else beginning `#!` has an extent that follows no rule this lexer
 * could adopt:
 *
 *     #!(      ->  one token, bracket included
 *     #!a(     ->  one token, bracket included
 *     #!\ (    ->  "#!\ " then a real `(`, bracket excluded
 *     #!x| (   ->  one token, the bar swallowing the space
 *
 * A bracket is included after `a` but not after an escaped space, and quoting
 * applies in one case and not the other. Real shebang lines work and are
 * corpus-verified; this is the rest.
 */
function hasKnownDivergence(text: string): boolean {
  let state = DEFAULT_STATE;
  for (const line of text.split("\n")) {
    const result = lexLine(line, state);
    if (result.tokens.some((token) => diverges(token, line))) {
      return true;
    }
    state = result.stateOut;
  }
  return false;
}

function diverges(token: Token, line: string): boolean {
  if (token.kind !== "atom" && token.kind !== "error") {
    return false;
  }
  const text = line.slice(token.start, token.end);
  const booleanQuoting =
    /^#[tTfF]/.test(text) && (text.includes("\\") || text.includes("|"));
  const strayHashBang = text.startsWith("#!");
  return booleanQuoting || strayHashBang;
}

function describeSpan(span: Span | undefined, text: string): string {
  return span === undefined
    ? "<none>"
    : `${span.cls}[${String(span.start)}..${String(span.end)}] ${JSON.stringify(
        text.slice(span.start, span.end),
      )}`;
}

/**
 * A failure message carrying the shrunk input verbatim.
 *
 * It is written to be pasteable straight into `test/oracle/cases.json`, so a
 * fuzz find becomes a permanent fixture that CI can run without Racket.
 */
function report(text: string, mismatches: readonly Mismatch[]): string {
  const first = mismatches[0];
  return (
    `lexed ${JSON.stringify(text)} differently from Racket\n` +
    `  expected ${describeSpan(first?.expected, text)}\n` +
    `  actual   ${describeSpan(first?.actual, text)}`
  );
}

describe.skipIf(!HAS_RACKET)("lexer fuzzing against syntax-color/racket-lexer", () => {
  let oracle: OracleProcess;

  beforeAll(() => {
    oracle = new OracleProcess();
  });
  afterAll(() => {
    oracle.dispose();
  });

  it("agrees with Racket on generated reader soup", async () => {
    await fc.assert(
      fc.asyncProperty(source, async (text) => {
        fc.pre(!hasKnownDivergence(text));
        const mismatches = compareLexers(text, await oracle.lex(text));
        expect(mismatches, report(text, mismatches)).toEqual([]);
      }),
      { numRuns: 30000 },
    );
  }, 600_000);

  // A fuzzer that never opens a block comment is silently testing nothing. This
  // asserts the generator actually drives the machine into every state it has.
  it("drives the lexer through every state and token kind it can reach", () => {
    const statesSeen = new Set<string>();
    const kindsSeen = new Set<string>();

    fc.assert(
      fc.property(source, (text) => {
        for (const span of lexSourceToSpans(text)) {
          kindsSeen.add(span.cls);
        }
        for (const line of linesOf(text)) {
          statesSeen.add(line);
        }
        return true;
      }),
      // Seeded: a coverage assertion that flakes is worse than one that is
      // fixed, and a regression in the generator still shows up here.
      { numRuns: 5000, seed: 20_260_831 },
    );

    expect([...statesSeen].sort((a, b) => a.localeCompare(b))).toEqual([
      "atom-continuation",
      "bar",
      "block-comment",
      "default",
      "here-string",
      "pending-char",
      "script-line",
      "string",
    ]);
    expect([...kindsSeen].sort((a, b) => a.localeCompare(b))).toEqual([
      "atom",
      "close",
      "comment",
      "error",
      "open",
      "prefix",
      "space",
      "string",
    ]);
  }, 120_000);
});

/** The lexer states a source passes through, for the coverage check. */
function linesOf(text: string): string[] {
  const seen: string[] = [];
  let state = DEFAULT_STATE;
  for (const line of text.split("\n")) {
    seen.push(state.kind);
    state = lexLine(line, state).stateOut;
  }
  seen.push(state.kind);
  return seen;
}
