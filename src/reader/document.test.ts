import { describe, expect, it } from "vitest";
import type { TextChange } from "./document";
import { TokenizedDocument } from "./document";
import { DEFAULT_STATE } from "./lex-state";

function render(document: TokenizedDocument): string {
  const out: string[] = [];
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineText(line);
    out.push(
      document
        .tokens(line)
        .map((token) => `${token.kind}:${text.slice(token.start, token.end)}`)
        .join(" "),
    );
  }
  return out.join("\n");
}

/** Both the text and every token must match a document built from scratch. */
function expectMatchesFullRelex(document: TokenizedDocument): void {
  const fresh = new TokenizedDocument(document.getText());
  expect(document.getText()).toBe(fresh.getText());
  expect(render(document)).toBe(render(fresh));
  for (let line = 0; line < fresh.lineCount; line += 1) {
    expect(document.stateAt(line)).toEqual(fresh.stateAt(line));
  }
}

function change(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  text: string,
): TextChange {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    text,
  };
}

describe("TokenizedDocument", () => {
  it("tokenises a fresh document line by line", () => {
    const document = new TokenizedDocument('(a "b\nc" d)');
    expect(document.lineCount).toBe(2);
    expect(document.stateAt(0)).toEqual(DEFAULT_STATE);
    expect(document.stateAt(1)).toEqual({ kind: "string", flavor: "string" });
    expect(render(document)).toBe(
      ['open:( atom:a whitespace:  string:"b', 'string:c" whitespace:  atom:d close:)'].join("\n"),
    );
  });

  it("applies an insertion within one line", () => {
    const document = new TokenizedDocument("(foo bar)");
    document.applyChange(change(0, 5, 0, 5, "baz "));
    expect(document.getText()).toBe("(foo baz bar)");
    expectMatchesFullRelex(document);
  });

  it("applies a multi-line insertion", () => {
    const document = new TokenizedDocument("(a b)");
    document.applyChange(change(0, 3, 0, 3, "\n  c\n  "));
    expect(document.getText()).toBe("(a \n  c\n  b)");
    expectMatchesFullRelex(document);
  });

  it("applies a deletion spanning lines", () => {
    const document = new TokenizedDocument("(a\n b\n c)");
    document.applyChange(change(0, 2, 2, 2, ""));
    expect(document.getText()).toBe("(a)");
    expectMatchesFullRelex(document);
  });

  // The cascade case: an unterminated quote changes the meaning of every later
  // line, and the store has to notice rather than trust its cached states.
  it("relexes to the end when an opening quote is typed at the top", () => {
    const document = new TokenizedDocument('(a)\n(b)\n(c)');
    document.applyChange(change(0, 0, 0, 0, '"'));
    expect(document.stateAt(2)).toEqual({ kind: "string", flavor: "string" });
    expectMatchesFullRelex(document);
  });

  it("recovers when that quote is closed again", () => {
    const document = new TokenizedDocument('"(a)\n(b)\n(c)');
    document.applyChange(change(0, 4, 0, 4, '"'));
    expect(document.stateAt(2)).toEqual(DEFAULT_STATE);
    expectMatchesFullRelex(document);
  });

  it("stops early instead of relexing the tail", () => {
    const document = new TokenizedDocument("(a)\n(b)\n(c)\n(d)");
    const before = document.tokens(3);
    document.applyChange(change(0, 2, 0, 2, "xyz"));
    // Untouched lines keep their exact token arrays, not merely equal ones.
    expect(document.tokens(3)).toBe(before);
    expectMatchesFullRelex(document);
  });

  it("handles nested block comment depth across an edit", () => {
    const document = new TokenizedDocument("#| a\n#| b\n|# c\n|# (d)");
    expect(document.stateAt(2)).toEqual({ kind: "block-comment", depth: 2 });
    document.applyChange(change(1, 0, 1, 2, ""));
    expect(document.getText()).toBe("#| a\n b\n|# c\n|# (d)");
    expectMatchesFullRelex(document);
  });
});

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Fragments chosen so random splicing produces genuinely state-changing edits:
// half of them can open or close a multi-line construct.
const FRAGMENTS = [
  "(a b)",
  "[c]",
  '"s"',
  '"',
  "#|",
  "|#",
  "#;",
  "|",
  "#\\(",
  "'x",
  ";c",
  "\n",
  "  ",
  "#<<E",
  "E",
  "#(1)",
  ")",
];

describe("incremental relexing is indistinguishable from a full relex", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("holds under random edit sequences (seed %i)", (seed) => {
    const random = mulberry32(seed);
    const pick = <T,>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)] as T;

    const document = new TokenizedDocument(
      Array.from({ length: 8 }, () => pick(FRAGMENTS)).join("\n"),
    );

    for (let step = 0; step < 60; step += 1) {
      const startLine = Math.floor(random() * document.lineCount);
      const startCharacter = Math.floor(random() * (document.lineText(startLine).length + 1));
      const endLine = Math.min(
        document.lineCount - 1,
        startLine + Math.floor(random() * 3),
      );
      const endCharacter =
        endLine === startLine
          ? startCharacter +
            Math.floor(random() * (document.lineText(endLine).length - startCharacter + 1))
          : Math.floor(random() * (document.lineText(endLine).length + 1));

      document.applyChange(
        change(startLine, startCharacter, endLine, endCharacter, random() < 0.6 ? pick(FRAGMENTS) : ""),
      );
      expectMatchesFullRelex(document);
    }
  });
});
