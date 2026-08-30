import { describe, expect, it } from "vitest";
import {
  backwardKillSexp,
  killSexp,
  spliceKillingBackward,
  spliceKillingForward,
} from "./kill";
import { run } from "./testing";

describe("killSexp", () => {
  it.each([
    ["deletes the next datum", "(foo ‸bar baz)", "(foo ‸ baz)"],
    ["deletes a whole list", "(foo ‸(bar baz) qux)", "(foo ‸ qux)"],
    ["deletes a quoted datum with its prefix", "(foo ‸'(bar) baz)", "(foo ‸ baz)"],
    ["deletes to the end of the atom the caret is in", "(foo ba‸r baz)", "(foo ba‸ baz)"],
    ["deletes a string whole", '(foo ‸"a (b" c)', "(foo ‸ c)"],
  ])("%s", (_name, before, after) => {
    expect(run(killSexp, before)).toBe(after);
  });

  it("does nothing at the end of input", () => {
    expect(run(killSexp, "(foo)‸")).toBe("<no-op>");
  });
});

describe("backwardKillSexp", () => {
  it.each([
    ["deletes the previous datum", "(foo bar‸ baz)", "(foo ‸ baz)"],
    ["deletes a whole list", "(foo (bar baz)‸ qux)", "(foo ‸ qux)"],
    ["takes a reader prefix with it", "(foo '(bar)‸ baz)", "(foo ‸ baz)"],
  ])("%s", (_name, before, after) => {
    expect(run(backwardKillSexp, before)).toBe(after);
  });

  it("does nothing at the start of input", () => {
    expect(run(backwardKillSexp, "‸(foo)")).toBe("<no-op>");
  });
});

describe("spliceKilling", () => {
  it("kills backward and splices", () => {
    expect(run(spliceKillingBackward, "(foo (bar ‸baz) quux)")).toBe("(foo ‸baz quux)");
  });

  it("kills forward and splices", () => {
    expect(run(spliceKillingForward, "(foo (bar‸ baz) quux)")).toBe("(foo bar‸ quux)");
  });

  it("does nothing at the top level", () => {
    expect(run(spliceKillingBackward, "foo ‸bar")).toBe("<no-op>");
    expect(run(spliceKillingForward, "foo ‸bar")).toBe("<no-op>");
  });
});
