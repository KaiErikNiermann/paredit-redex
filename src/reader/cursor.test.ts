import { describe, expect, it } from "vitest";
import {
  backwardDatum,
  backwardDownList,
  backwardUpList,
  downList,
  enclosingList,
  forwardDatum,
  forwardUpList,
  withinComment,
  withinString,
} from "./cursor";
import { TokenizedDocument } from "./document";

/**
 * Cursor marker for the tables below.
 *
 * paredit.el's own tests use `|`, which cannot work here: in Racket `|` is a
 * bar-quoted symbol delimiter, so `(a |b)` is a legitimate program and marking
 * it up with pipes would be ambiguous exactly in the cases most worth testing.
 */
const CARET = "‸";

type Motion = (document: TokenizedDocument, offset: number) => number | undefined;

/** Run `motion` on a caret-marked source and return the result, caret-marked. */
function move(marked: string, motion: Motion): string {
  const offset = marked.indexOf(CARET);
  expect(offset).toBeGreaterThanOrEqual(0);
  const source = marked.replace(CARET, "");
  const result = motion(new TokenizedDocument(source), offset);
  return result === undefined
    ? "<none>"
    : source.slice(0, result) + CARET + source.slice(result);
}

function documentAt(marked: string): { document: TokenizedDocument; offset: number } {
  const offset = marked.indexOf(CARET);
  return { document: new TokenizedDocument(marked.replace(CARET, "")), offset };
}

describe("forwardDatum", () => {
  it.each([
    ["over an atom", "(‸foo bar)", "(foo‸ bar)"],
    ["from inside an atom, to its end", "(fo‸o bar)", "(foo‸ bar)"],
    ["over a whole list", "(a ‸(b c) d)", "(a (b c)‸ d)"],
    ["over a string, brackets and all", '(‸"a (b" c)', '("a (b"‸ c)'],
    ["out of the list at its end", "(a b‸)", "(a b)‸"],
    ["over a quoted datum, prefix included", "(‸'(a) b)", "('(a)‸ b)"],
    ["over a nested quote stack", "(‸#,@(a) b)", "(#,@(a)‸ b)"],
    ["across lines, skipping whitespace", "(a‸\n  b)", "(a\n  b‸)"],
    ["skipping a line comment", "(a‸ ; note\n b)", "(a ; note\n b‸)"],
    ["skipping a block comment", "(a‸ #| x |# b)", "(a #| x |# b‸)"],
  ])("moves %s", (_name, before, after) => {
    expect(move(before, forwardDatum)).toBe(after);
  });

  // The datum-comment cases are the reason this is a cursor and not a tree:
  // each extra `#;` is one more level of the same recursion.
  it.each([
    ["one commented datum", "(a‸ #;(b c) d)", "(a #;(b c) d‸)"],
    ["two stacked commented data", "(a‸ #;#;b c d)", "(a #;#;b c d‸)"],
    ["a commented datum before a list", "(a‸ #;b (c) d)", "(a #;b (c)‸ d)"],
  ])("skips %s", (_name, before, after) => {
    expect(move(before, forwardDatum)).toBe(after);
  });

  it("reports no move at the end of input", () => {
    expect(move("(a)‸", forwardDatum)).toBe("<none>");
  });
});

describe("backwardDatum", () => {
  it.each([
    ["over an atom", "(foo bar‸)", "(foo ‸bar)"],
    ["over a whole list", "(a (b c)‸ d)", "(a ‸(b c) d)"],
    ["out of the list at its start", "(‸a b)", "‸(a b)"],
    ["over a quoted datum, taking the prefix with it", "(a '(b)‸ c)", "(a ‸'(b) c)"],
    ["over a stacked prefix", "(a #,@(b)‸ c)", "(a ‸#,@(b) c)"],
    ["across lines", "(a\n  b‸)", "(a\n  ‸b)"],
  ])("moves %s", (_name, before, after) => {
    expect(move(before, backwardDatum)).toBe(after);
  });

  it("reports no move at the start of input", () => {
    expect(move("‸(a)", backwardDatum)).toBe("<none>");
  });
});

describe("list motions", () => {
  it.each([
    ["backwardUpList", backwardUpList, "(a (b ‸c) d)", "(a ‸(b c) d)"],
    ["forwardUpList", forwardUpList, "(a (b ‸c) d)", "(a (b c)‸ d)"],
    ["downList", downList, "‸(a (b) c)", "(‸a (b) c)"],
    ["downList into a later list", downList, "(a‸ (b) c)", "(a (‸b) c)"],
    ["backwardDownList", backwardDownList, "(a (b) ‸c)", "(a (b‸) c)"],
  ] as const)("%s", (_name, motion, before, after) => {
    expect(move(before, motion)).toBe(after);
  });

  it("takes a prefixed open bracket as one unit", () => {
    expect(move("‸#hash((a . 1))", downList)).toBe("#hash(‸(a . 1))");
    expect(move("#hash((a . 1‸))", backwardUpList)).toBe("#hash(‸(a . 1))");
  });

  it("reports no move at the top level", () => {
    expect(move("(a) ‸ (b)", backwardUpList)).toBe("<none>");
    expect(move("(a) ‸ (b)", forwardUpList)).toBe("<none>");
  });

  it("declines to descend past a closing bracket", () => {
    expect(move("(a ‸) (b)", downList)).toBe("<none>");
  });
});

describe("enclosingList", () => {
  it("reports the bracket spans, keeping a prefixed open whole", () => {
    const { document, offset } = documentAt("(a #hash(b ‸c) d)");
    expect(enclosingList(document, offset)).toEqual({
      openStart: 3,
      openEnd: 9,
      closeStart: 12,
      closeEnd: 13,
    });
  });

  it("is undefined at the top level and in an unclosed list", () => {
    const top = documentAt("(a) ‸ (b)");
    expect(enclosingList(top.document, top.offset)).toBeUndefined();
    const unclosed = documentAt("(a ‸b");
    expect(enclosingList(unclosed.document, unclosed.offset)).toBeUndefined();
  });

  // While typing, mismatched brackets are normal; motions must still work.
  it("matches by depth, not by shape", () => {
    const { document, offset } = documentAt("(a ‸b]");
    expect(enclosingList(document, offset)).toEqual({
      openStart: 0,
      openEnd: 1,
      closeStart: 4,
      closeEnd: 5,
    });
  });
});

describe("context predicates", () => {
  it("detects being inside a string or comment, but not at its edge", () => {
    const inString = documentAt('(a "b‸c" d)');
    expect(withinString(inString.document, inString.offset)).toBe(true);

    const atStringStart = documentAt('(a ‸"bc" d)');
    expect(withinString(atStringStart.document, atStringStart.offset)).toBe(false);

    const inComment = documentAt("(a) ; no‸te");
    expect(withinComment(inComment.document, inComment.offset)).toBe(true);

    const inCode = documentAt("(a‸ b)");
    expect(withinString(inCode.document, inCode.offset)).toBe(false);
    expect(withinComment(inCode.document, inCode.offset)).toBe(false);
  });
});
