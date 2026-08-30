import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OracleToken, Span } from "./oracle-diff";
import {
  coalesce,
  diffSpans,
  lexSourceToSpans,
  oracleClass,
  oracleToSpans,
} from "./oracle-diff";

interface Fixture {
  readonly name: string;
  readonly source: string;
  readonly tokens: readonly OracleToken[];
}

const FIXTURES: readonly Fixture[] = JSON.parse(
  readFileSync(
    join(process.cwd(), "test", "fixtures", "lexer-oracle.json"),
    "utf8",
  ),
) as Fixture[];

function render(span: Span | undefined, source: string): string {
  return span === undefined
    ? "<none>"
    : `${span.cls}[${String(span.start)}..${String(span.end)}] ${JSON.stringify(
        source.slice(span.start, span.end),
      )}`;
}

describe("oracleClass", () => {
  it("splits parentheses by direction and collapses atom flavours", () => {
    expect(oracleClass({ start: 0, end: 6, type: "parenthesis", paren: "(" })).toBe("open");
    expect(oracleClass({ start: 0, end: 1, type: "parenthesis", paren: "]" })).toBe("close");
    expect(oracleClass({ start: 0, end: 1, type: "symbol", paren: null })).toBe("atom");
    // Racket reports the quoting prefixes as constants, not as a class of their own.
    expect(oracleClass({ start: 0, end: 1, type: "constant", paren: null })).toBe("atom");
    expect(oracleClass({ start: 0, end: 4, type: "hash-colon-keyword", paren: null })).toBe(
      "atom",
    );
    expect(oracleClass({ start: 0, end: 2, type: "sexp-comment", paren: null })).toBe("prefix");
  });
});

describe("coalesce", () => {
  it("merges only adjacent spans of equal class", () => {
    expect(
      coalesce([
        { cls: "space", start: 0, end: 1 },
        { cls: "space", start: 1, end: 3 },
        { cls: "atom", start: 3, end: 4 },
        { cls: "space", start: 5, end: 6 },
      ]),
    ).toEqual([
      { cls: "space", start: 0, end: 3 },
      { cls: "atom", start: 3, end: 4 },
      { cls: "space", start: 5, end: 6 },
    ]);
  });
});

describe("differential test against syntax-color/racket-lexer", () => {
  it("has fixtures for every construct that breaks naive bracket matching", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(24);
  });

  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "agrees with Racket on %s",
    (_name, fixture) => {
      const mismatches = diffSpans(
        oracleToSpans(fixture.tokens, fixture.source),
        lexSourceToSpans(fixture.source),
      );
      const report = mismatches
        .map(
          (mismatch) =>
            `at ${String(mismatch.index)}\n  expected ${render(mismatch.expected, fixture.source)}` +
            `\n  actual   ${render(mismatch.actual, fixture.source)}`,
        )
        .join("\n");
      expect(report).toBe("");
    },
  );
});
