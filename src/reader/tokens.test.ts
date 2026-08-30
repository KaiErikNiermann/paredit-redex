import { describe, expect, it } from "vitest";
import type { CloseToken, OpenToken, PrefixToken, Token } from "./tokens";
import {
  closerFor,
  isDatumComment,
  isMatchingPair,
  isQuotingPrefix,
  isSkippable,
  shapeOf,
} from "./tokens";

function open(shape: OpenToken["shape"], text: string): OpenToken {
  return { kind: "open", shape, start: 0, end: text.length };
}

function close(shape: CloseToken["shape"]): CloseToken {
  return { kind: "close", shape, start: 0, end: 1 };
}

function prefix(kind: PrefixToken["prefix"], text: string): PrefixToken {
  return { kind: "prefix", prefix: kind, start: 0, end: text.length };
}

describe("closerFor", () => {
  it("maps each shape to its closing bracket", () => {
    expect(closerFor("(")).toBe(")");
    expect(closerFor("[")).toBe("]");
    expect(closerFor("{")).toBe("}");
  });
});

describe("shapeOf", () => {
  it("reads bare brackets", () => {
    expect(shapeOf("(")).toBe("(");
    expect(shapeOf(")")).toBe("(");
    expect(shapeOf("[")).toBe("[");
    expect(shapeOf("]")).toBe("[");
    expect(shapeOf("{")).toBe("{");
    expect(shapeOf("}")).toBe("{");
  });

  // The whole reason shapeOf takes a lexeme rather than a character: Racket's
  // own lexer folds the prefix into the open-bracket token.
  it("reads prefixed opens, where the bracket is the last character", () => {
    expect(shapeOf("#(")).toBe("(");
    expect(shapeOf("#hash(")).toBe("(");
    expect(shapeOf("#hasheq(")).toBe("(");
    expect(shapeOf("#s(")).toBe("(");
    expect(shapeOf("#[")).toBe("[");
    expect(shapeOf("#hash{")).toBe("{");
  });

  it("returns undefined for non-delimiters", () => {
    expect(shapeOf("foo")).toBeUndefined();
    expect(shapeOf("")).toBeUndefined();
    expect(shapeOf("#\\(")).toBe("("); // NOTE: caller must not hand it a char literal
  });
});

describe("isMatchingPair", () => {
  it("pairs brackets by shape, so a prefixed open still matches a bare close", () => {
    expect(isMatchingPair(open("(", "#hash("), close("("))).toBe(true);
    expect(isMatchingPair(open("[", "["), close("["))).toBe(true);
    expect(isMatchingPair(open("(", "("), close("["))).toBe(false);
  });
});

describe("token predicates", () => {
  const atom: Token = { kind: "atom", start: 0, end: 3 };
  const space: Token = { kind: "whitespace", start: 0, end: 1 };
  const comment: Token = { kind: "comment", start: 0, end: 5 };

  it("treats whitespace and comments as skippable, data as not", () => {
    expect(isSkippable(space)).toBe(true);
    expect(isSkippable(comment)).toBe(true);
    expect(isSkippable(atom)).toBe(false);
    expect(isSkippable(open("(", "("))).toBe(false);
  });

  it("separates #; from the quoting prefixes", () => {
    const datumComment = prefix("datum-comment", "#;");
    const quote = prefix("quote", "'");
    const unquoteSplicing = prefix("unquote-splicing", ",@");

    expect(isDatumComment(datumComment)).toBe(true);
    expect(isQuotingPrefix(datumComment)).toBe(false);

    expect(isQuotingPrefix(quote)).toBe(true);
    expect(isQuotingPrefix(unquoteSplicing)).toBe(true);
    expect(isDatumComment(quote)).toBe(false);

    expect(isDatumComment(atom)).toBe(false);
    expect(isQuotingPrefix(atom)).toBe(false);
  });
});
