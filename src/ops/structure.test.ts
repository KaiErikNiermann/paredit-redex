import { describe, expect, it } from "vitest";
import {
  dragBackward,
  dragForward,
  joinSexps,
  splitSexp,
  transposeSexps,
} from "./structure";
import { run } from "./testing";

describe("splitSexp", () => {
  it.each([
    ["splits at the caret", "(a b‸ c d)", "(a b) ‸(c d)"],
    ["keeps the bracket shape on both halves", "[a b‸ c]", "[a b] ‸[c]"],
    ["normalises the whitespace it absorbs", "(a b  ‸  c)", "(a b) ‸(c)"],
    ["repeats a prefixed open on the new list", "#hash(a‸ b)", "#hash(a) ‸#hash(b)"],
  ])("%s", (_name, before, after) => {
    expect(run(splitSexp, before)).toBe(after);
  });

  it("does nothing at the top level", () => {
    expect(run(splitSexp, "a ‸b")).toBe("<no-op>");
  });
});

describe("joinSexps", () => {
  it.each([
    ["joins two lists", "(a b) ‸(c d)", "(a b ‸c d)"],
    ["joins across a line break", "(a)\n‸(b)", "(a ‸b)"],
  ])("%s", (_name, before, after) => {
    expect(run(joinSexps, before)).toBe(after);
  });

  it("does nothing unless a closer meets an opener", () => {
    expect(run(joinSexps, "(a b ‸c d)")).toBe("<no-op>");
    expect(run(joinSexps, "(a) ‸b")).toBe("<no-op>");
  });
});

describe("transposeSexps", () => {
  it.each([
    ["swaps two atoms", "(a ‸b)", "(b a‸)"],
    ["swaps an atom and a list", "(a ‸(b c))", "((b c) a‸)"],
    ["swaps two lists", "((a) ‸(b))", "((b) (a)‸)"],
  ])("%s", (_name, before, after) => {
    expect(run(transposeSexps, before)).toBe(after);
  });

  it("does nothing with nothing to swap", () => {
    expect(run(transposeSexps, "(‸a)")).toBe("<no-op>");
  });
});

describe("drag", () => {
  it.each([
    ["forward past an atom", "(‸a b c)", "(b ‸a c)"],
    ["forward past a list", "(‸a (b c) d)", "((b c) ‸a d)"],
    ["backward past an atom", "(a ‸b c)", "(‸b a c)"],
  ])("moves the datum %s", (_name, before, after) => {
    const operation = _name.startsWith("forward") ? dragForward : dragBackward;
    expect(run(operation, before)).toBe(after);
  });

  it("does nothing at the ends of a list", () => {
    expect(run(dragForward, "(a ‸b)")).toBe("<no-op>");
    expect(run(dragBackward, "(‸a b)")).toBe("<no-op>");
  });
});
