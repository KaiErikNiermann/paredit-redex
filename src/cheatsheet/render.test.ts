import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import { escapeHtml, renderCheatSheet, renderKeys, renderSnippet } from "./render";

describe("escapeHtml", () => {
  it("escapes everything that could close a tag or attribute", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("renderSnippet", () => {
  it("turns the caret marker into a cursor and escapes the rest", () => {
    expect(renderSnippet("(a ‸<b>)")).toBe('(a <span class="caret"></span>&lt;b&gt;)');
  });
});

describe("renderKeys", () => {
  it("renders each part as its own key, with arrows spelled out", () => {
    expect(renderKeys("ctrl+alt+shift+down")).toBe(
      '<kbd>Ctrl</kbd><span class="plus">+</span><kbd>Alt</kbd><span class="plus">+</span>' +
        '<kbd>Shift</kbd><span class="plus">+</span><kbd>↓</kbd>',
    );
  });
});

describe("renderCheatSheet", () => {
  const html = renderCheatSheet("test-nonce");

  it("names every command", () => {
    for (const entry of CATALOG) {
      expect(html).toContain(escapeHtml(entry.title));
    }
  });

  it("shows a before and an after for every command that has an example", () => {
    const panes = [...html.matchAll(/class="label">before</g)];
    expect(panes).toHaveLength(CATALOG.filter((entry) => entry.example !== undefined).length);
  });

  it("locks the content security policy to the nonce it was given", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("style-src 'nonce-test-nonce'");
    expect(html).toContain("script-src 'nonce-test-nonce'");
    // No unnonced style or script may slip in, or the CSP would reject it.
    expect(/<script(?! nonce=)/.exec(html)).toBeNull();
    expect(/<style(?! nonce=)/.exec(html)).toBeNull();
  });

  it("has no unbalanced caret markers left in the output", () => {
    expect(html).not.toContain("‸");
  });
});
