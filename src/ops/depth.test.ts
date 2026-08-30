import { describe, expect, it } from "vitest";
import {
  backwardBarf,
  backwardSlurp,
  forwardBarf,
  forwardSlurp,
  raise,
  splice,
  wrap,
} from "./depth";
import { run } from "./testing";

describe("forwardSlurp", () => {
  // The caret stays with the text around it rather than following the bracket,
  // which is what paredit does: (foo (bar |baz) quux) -> (foo (bar |baz quux)).
  it.each([
    ["pulls the next datum in", "(foo (bar‸) baz)", "(foo (bar‸ baz))"],
    ["pulls in a whole list", "(foo (bar‸) (baz qux))", "(foo (bar‸ (baz qux)))"],
    ["keeps a square bracket square", "(foo [bar‸] baz)", "(foo [bar‸ baz])"],
    ["keeps a prefixed open whole", "(#hash(a‸) b)", "(#hash(a‸ b))"],
    ["takes a quoted datum with its prefix", "(foo (bar‸) '(baz))", "(foo (bar‸ '(baz)))"],
    ["tidies the space the closer left behind", "(foo (bar ‸) baz)", "(foo (bar‸ baz))"],
    ["keeps two atoms apart", "(a‸)b", "(a‸ b)"],
  ])("%s", (_name, before, after) => {
    expect(run(forwardSlurp, before)).toBe(after);
  });

  it("does nothing with no datum to slurp", () => {
    expect(run(forwardSlurp, "(foo (bar‸))")).toBe("<no-op>");
    expect(run(forwardSlurp, "‸(foo)")).toBe("<no-op>");
  });

  // A closer is only ever placed at a datum boundary, and a datum boundary is
  // never inside a comment — so slurping past a comment cannot comment it out.
  it("does not bury the closer in a line comment", () => {
    // The closer lands after `b` on the second line, not inside `; note`.
    expect(run(forwardSlurp, "(a‸) ; note\nb")).toBe("(a‸ ; note\nb)");
    expect(run(forwardSlurp, "(a‸)\n; note\nb")).toBe("(a‸\n; note\nb)");
  });
});

describe("forwardBarf", () => {
  it.each([
    ["expels the last datum", "(foo (bar ‸baz) quux)", "(foo (bar) ‸baz quux)"],
    ["expels a whole list", "(foo (bar ‸(baz)) quux)", "(foo (bar) ‸(baz) quux)"],
    ["keeps a square bracket square", "[foo ‸bar]", "[foo] ‸bar"],
    ["expels the only datum", "(‸foo)", "() ‸foo"],
  ])("%s", (_name, before, after) => {
    expect(run(forwardBarf, before)).toBe(after);
  });

  it("does nothing outside a list or in an empty one", () => {
    expect(run(forwardBarf, "foo ‸bar")).toBe("<no-op>");
    expect(run(forwardBarf, "(‸)")).toBe("<no-op>");
  });
});

describe("backwardSlurp", () => {
  it.each([
    ["pulls the previous datum in", "(foo bar (‸baz))", "(foo (bar ‸baz))"],
    ["keeps a square bracket square", "(foo bar [‸baz])", "(foo [bar ‸baz])"],
    ["keeps a prefixed open whole", "(a #hash(‸b))", "(#hash(a ‸b))"],
  ])("%s", (_name, before, after) => {
    expect(run(backwardSlurp, before)).toBe(after);
  });

  it("does nothing when the list is already first", () => {
    expect(run(backwardSlurp, "((‸a) b)")).toBe("<no-op>");
  });
});

describe("backwardBarf", () => {
  it.each([
    ["expels the first datum", "(foo (bar ‸baz) quux)", "(foo bar (‸baz) quux)"],
    ["keeps a square bracket square", "[foo ‸bar]", "foo [‸bar]"],
  ])("%s", (_name, before, after) => {
    expect(run(backwardBarf, before)).toBe(after);
  });

  it("does nothing when only one datum remains", () => {
    expect(run(backwardBarf, "(‸foo)")).toBe("<no-op>");
  });
});

describe("splice", () => {
  it.each([
    ["removes the enclosing brackets", "(foo (bar ‸baz))", "(foo bar ‸baz)"],
    ["removes square brackets too", "(foo [bar ‸baz])", "(foo bar ‸baz)"],
    ["removes a prefixed open whole", "(a #hash(b ‸c))", "(a b ‸c)"],
    ["tidies the space it exposes", "( ‸foo )", "‸foo"],
  ])("%s", (_name, before, after) => {
    expect(run(splice, before)).toBe(after);
  });

  it("does nothing at the top level", () => {
    expect(run(splice, "foo ‸bar")).toBe("<no-op>");
  });
});

describe("raise", () => {
  it.each([
    ["replaces the list with the datum at point", "(foo (bar ‸baz))", "(foo ‸baz)"],
    ["raises a whole list", "(foo (bar ‸(baz qux)))", "(foo ‸(baz qux))"],
    ["raises from inside an atom", "(foo (bar ba‸z))", "(foo ‸baz)"],
    ["takes a reader prefix with the datum", "(foo (bar ‸'baz))", "(foo ‸'baz)"],
  ])("%s", (_name, before, after) => {
    expect(run(raise, before)).toBe(after);
  });

  it("does nothing at the top level", () => {
    expect(run(raise, "‸foo")).toBe("<no-op>");
  });
});

describe("wrap", () => {
  it.each([
    ["round", "(", "(foo ‸bar)", "(foo (‸bar))"],
    ["square", "[", "(foo ‸bar)", "(foo [‸bar])"],
    ["curly", "{", "(foo ‸bar)", "(foo {‸bar})"],
  ] as const)("wraps the next datum in %s brackets", (_name, shape, before, after) => {
    expect(run(wrap(shape), before)).toBe(after);
  });

  it("wraps a whole list, and takes a prefix with it", () => {
    expect(run(wrap("("), "(foo ‸(bar baz))")).toBe("(foo (‸(bar baz)))");
    expect(run(wrap("("), "(foo ‸'bar)")).toBe("(foo (‸'bar))");
  });

  it("does nothing with no datum ahead", () => {
    expect(run(wrap("("), "(foo‸)")).toBe("<no-op>");
  });
});
