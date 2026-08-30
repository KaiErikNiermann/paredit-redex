import { describe, expect, it } from "vitest";
import type { LexState } from "./lex-state";
import { DEFAULT_STATE } from "./lex-state";
import { lexLine } from "./lexer";

/** Render one line's tokens as `kind:lexeme`, which is what the cases assert on. */
function lex(line: string, state: LexState = DEFAULT_STATE): string[] {
  return [...lexLine(line, state).tokens].map(
    (t) => `${t.kind}:${line.slice(t.start, t.end)}`,
  );
}

/** Lex a whole source, threading state across lines the way the store will. */
function lexAll(source: string): { rendered: string[][]; final: LexState } {
  let state = DEFAULT_STATE;
  const rendered: string[][] = [];
  for (const line of source.split("\n")) {
    const result = lexLine(line, state);
    rendered.push([...result.tokens].map((t) => `${t.kind}:${line.slice(t.start, t.end)}`));
    state = result.stateOut;
  }
  return { rendered, final: state };
}

describe("brackets", () => {
  it("lexes bare brackets with their shape", () => {
    const { tokens } = lexLine("([{}])", DEFAULT_STATE);
    expect(tokens.map((t) => t.kind)).toEqual([
      "open",
      "open",
      "open",
      "close",
      "close",
      "close",
    ]);
    expect(tokens.map((t) => ("shape" in t ? t.shape : undefined))).toEqual([
      "(",
      "[",
      "{",
      "{",
      "[",
      "(",
    ]);
  });

  // list-prefix from racket-lexer: "" | #hash | #hasheq | #hasheqv | #hashalw | #s | # digit*
  it("folds a list prefix into one open token", () => {
    expect(lex("#(a)")).toEqual(["open:#(", "atom:a", "close:)"]);
    expect(lex("#3(a)")).toEqual(["open:#3(", "atom:a", "close:)"]);
    expect(lex("#hash((a . 1))")).toEqual([
      "open:#hash(",
      "open:(",
      "atom:a",
      "whitespace: ",
      "atom:.",
      "whitespace: ",
      "atom:1",
      "close:)",
      "close:)",
    ]);
    expect(lex("#hasheqv(a)")).toEqual(["open:#hasheqv(", "atom:a", "close:)"]);
    expect(lex("#s(pt 1)")).toEqual([
      "open:#s(",
      "atom:pt",
      "whitespace: ",
      "atom:1",
      "close:)",
    ]);
  });

  it("keeps the shape of a prefixed open as the bare bracket", () => {
    const [token] = lexLine("#hash{", DEFAULT_STATE).tokens;
    expect(token).toEqual({ kind: "open", shape: "{", start: 0, end: 6 });
  });

  it("does not mistake a non-delimiting # form for an open", () => {
    expect(lex("#true")).toEqual(["atom:#true"]);
    expect(lex("#si(")).toEqual(["atom:#si", "open:("]);
  });
});

describe("character literals", () => {
  // The classic killer: a character literal that looks like a delimiter.
  it("swallows a bracket or quote that is the character", () => {
    expect(lex('(#\\( #\\) #\\; #\\")')).toEqual([
      "open:(",
      "atom:#\\(",
      "whitespace: ",
      "atom:#\\)",
      "whitespace: ",
      "atom:#\\;",
      "whitespace: ",
      'atom:#\\"',
      "close:)",
    ]);
  });

  // Found by the fuzzer: matching one UTF-16 code unit split the surrogate
  // pair, giving a three-unit literal and a stray half.
  it("takes an astral character whole", () => {
    expect(lex("(#\\\u{1D538} a)")).toEqual([
      "open:(",
      "atom:#\\\u{1D538}",
      "whitespace: ",
      "atom:a",
      "close:)",
    ]);
  });

  it("takes the longest match, matching racket-lexer's rule order", () => {
    expect(lex("#\\space")).toEqual(["atom:#\\space"]);
    expect(lex("#\\nul")).toEqual(["atom:#\\nul"]);
    expect(lex("#\\u3BB")).toEqual(["atom:#\\u3BB"]);
    expect(lex("#\\101")).toEqual(["atom:#\\101"]);
    // Two-or-more alphabetics is a longer match than one character, so this is
    // a single (invalid) token rather than `#\a` followed by `b`.
    expect(lex("#\\ab")).toEqual(["atom:#\\ab"]);
    // ...but `a1` is not two alphabetics, so this really is `#\a` then `1`.
    expect(lex("#\\a1")).toEqual(["atom:#\\a", "atom:1"]);
  });
});

describe("comments", () => {
  it("runs a line comment to end of line", () => {
    expect(lex("(a) ; not (code)")).toEqual([
      "open:(",
      "atom:a",
      "close:)",
      "whitespace: ",
      "comment:; not (code)",
    ]);
  });

  it("nests block comments", () => {
    expect(lex("#| a #| b |# c |# d")).toEqual([
      "comment:#| a #| b |# c |#",
      "whitespace: ",
      "atom:d",
    ]);
  });

  it("carries block comment depth across lines", () => {
    const { rendered, final } = lexAll("#| a\n#| b\n|# c\n|# d");
    expect(final).toEqual(DEFAULT_STATE);
    expect(rendered[3]).toEqual(["comment:|#", "whitespace: ", "atom:d"]);
    // Still inside the outer comment on line 3, so `c` is comment text.
    expect(rendered[2]).toEqual(["comment:|# c"]);
  });

  it("treats #; as a prefix, leaving the commented datum in the stream", () => {
    // The datum stays lexed as data; skipping it is the cursor's job, which is
    // what makes stacked `#;#;` fall out of recursion.
    expect(lex("#;(a b) c")).toEqual([
      "prefix:#;",
      "open:(",
      "atom:a",
      "whitespace: ",
      "atom:b",
      "close:)",
      "whitespace: ",
      "atom:c",
    ]);
  });
});

describe("strings", () => {
  it("lexes every prefixed flavour", () => {
    expect(lex('"a" #"b" #rx"c" #px"d" #rx#"e" #px#"f"')).toEqual([
      'string:"a"',
      "whitespace: ",
      'string:#"b"',
      "whitespace: ",
      'string:#rx"c"',
      "whitespace: ",
      'string:#px"d"',
      "whitespace: ",
      'string:#rx#"e"',
      "whitespace: ",
      'string:#px#"f"',
    ]);
  });

  it("ignores brackets and escaped quotes inside a string", () => {
    expect(lex('("a (b) \\" c")')).toEqual([
      "open:(",
      'string:"a (b) \\" c"',
      "close:)",
    ]);
  });

  it("spans lines and resumes", () => {
    const { rendered, final } = lexAll('(a "multi\nline (" b)');
    expect(final).toEqual(DEFAULT_STATE);
    expect(rendered[0]).toEqual(["open:(", "atom:a", "whitespace: ", 'string:"multi']);
    expect(rendered[1]).toEqual([
      'string:line ("',
      "whitespace: ",
      "atom:b",
      "close:)",
    ]);
  });

  it("leaves an unterminated string open at end of line", () => {
    expect(lexLine('"oops', DEFAULT_STATE).stateOut).toEqual({
      kind: "string",
      flavor: "string",
    });
    expect(lexLine('#rx#"oops', DEFAULT_STATE).stateOut).toEqual({
      kind: "string",
      flavor: "byte-regexp",
    });
  });
});

describe("symbols", () => {
  it("lets pipes quote delimiters, including mid-symbol", () => {
    expect(lex("(|a(b| c)")).toEqual([
      "open:(",
      "atom:|a(b|",
      "whitespace: ",
      "atom:c",
      "close:)",
    ]);
    expect(lex("a|b(c|d")).toEqual(["atom:a|b(c|d"]);
  });

  it("lets a backslash quote one delimiter", () => {
    expect(lex("(a\\(b)")).toEqual(["open:(", "atom:a\\(b", "close:)"]);
  });

  // Found by the fuzzer: resuming at the top-level dispatch after the bar
  // closed read `#(` as a vector opening, inventing a bracket inside a symbol.
  it("keeps scanning the symbol after a bar closes on a later line", () => {
    const { rendered, final } = lexAll("|#\n#|#(");
    expect(final).toEqual(DEFAULT_STATE);
    expect(rendered[1]).toEqual(["atom:#|#", "open:("]);
  });

  it("carries an unterminated bar across lines", () => {
    const { rendered, final } = lexAll("(|a\nb| c)");
    expect(final).toEqual(DEFAULT_STATE);
    expect(rendered[0]).toEqual(["open:(", "atom:|a"]);
    expect(rendered[1]).toEqual(["atom:b|", "whitespace: ", "atom:c", "close:)"]);
  });

  it("breaks symbols on delimiters but not on #", () => {
    expect(lex("a#b,c")).toEqual(["atom:a#b", "prefix:,", "atom:c"]);
    expect(lex("a'b")).toEqual(["atom:a", "prefix:'", "atom:b"]);
  });

  it("lexes keywords and #% forms as atoms", () => {
    expect(lex("#:kw #%app")).toEqual([
      "atom:#:kw",
      "whitespace: ",
      "atom:#%app",
    ]);
  });
});

describe("prefixes", () => {
  it("lexes each reader prefix as its own token, longest first", () => {
    expect(lex("'a `b ,c ,@d #'e #`f #,g #,@h #&i")).toEqual([
      "prefix:'",
      "atom:a",
      "whitespace: ",
      "prefix:`",
      "atom:b",
      "whitespace: ",
      "prefix:,",
      "atom:c",
      "whitespace: ",
      "prefix:,@",
      "atom:d",
      "whitespace: ",
      "prefix:#'",
      "atom:e",
      "whitespace: ",
      "prefix:#`",
      "atom:f",
      "whitespace: ",
      "prefix:#,",
      "atom:g",
      "whitespace: ",
      "prefix:#,@",
      "atom:h",
      "whitespace: ",
      "prefix:#&",
      "atom:i",
    ]);
  });
});

describe("totality", () => {
  it("covers every character of the line, in order, with no gaps", () => {
    const line = "#lang racket\n";
    for (const source of [
      "(define (f x) #\\( \"s\" #;(a) #| b |# '(1 . 2))",
      "#hash((|a b| . #rx\"c\"))",
      "((((",
      "))))",
      "\\",
      "|",
      "#",
      "#\\",
      "",
      line,
    ]) {
      for (const text of source.split("\n")) {
        const { tokens } = lexLine(text, DEFAULT_STATE);
        let cursor = 0;
        for (const token of tokens) {
          expect(token.start).toBe(cursor);
          expect(token.end).toBeGreaterThan(token.start);
          cursor = token.end;
        }
        expect(cursor).toBe(text.length);
      }
    }
  });
});
