import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OracleToken, Span } from "./oracle-diff";
import { adoptErrorClasses, coalesce, compareLexers, oracleClass } from "./oracle-diff";

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

describe("adoptErrorClasses", () => {
  // `#\#|(` is the case that motivated this: both lexers split at 0..3 and
  // 3..5, but Racket calls the trailing `|(` an error where this lexer calls it
  // an atom. Without alignment that name difference becomes a shape difference,
  // because coalescing then merges this lexer's two atoms and not Racket's pair.
  it("lets an error span take this lexer's name for the same region", () => {
    expect(
      adoptErrorClasses(
        [
          { cls: "atom", start: 0, end: 3 },
          { cls: "error", start: 3, end: 5 },
        ],
        [
          { cls: "atom", start: 0, end: 3 },
          { cls: "atom", start: 3, end: 5 },
        ],
      ),
    ).toEqual([
      { cls: "atom", start: 0, end: 3 },
      { cls: "atom", start: 3, end: 5 },
    ]);
  });

  it("leaves every other class alone", () => {
    const spans = [
      { cls: "open", start: 0, end: 1 },
      { cls: "string", start: 1, end: 4 },
    ] as const;
    expect(adoptErrorClasses(spans, [{ cls: "atom", start: 0, end: 4 }])).toEqual(spans);
  });

  it("keeps the error name when this lexer has nothing there", () => {
    expect(adoptErrorClasses([{ cls: "error", start: 0, end: 2 }], [])).toEqual([
      { cls: "error", start: 0, end: 2 },
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
      const mismatches = compareLexers(fixture.source, fixture.tokens);
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
