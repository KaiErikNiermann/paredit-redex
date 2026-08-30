import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../ops";
import { MOTIONS } from "../ops/motions";
import { CATALOG } from "./catalog";
import { exampleFor } from "./examples";

interface Manifest {
  readonly contributes: {
    readonly commands: readonly { command: string; title: string; category: string }[];
    readonly keybindings: readonly { command: string; key: string; when: string }[];
  };
}

const MANIFEST: Manifest = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as Manifest;

const SCOPE = "editorTextFocus && editorLangId =~ /^(racket|scheme|lisp|commonlisp)$/";

describe("the catalog covers exactly what the code implements", () => {
  it("has an entry for every motion and every operation", () => {
    const catalogued = new Set(CATALOG.map((entry) => entry.command));
    for (const name of [...Object.keys(MOTIONS), ...Object.keys(OPERATIONS)]) {
      expect(catalogued, `${name} is implemented but not documented`).toContain(name);
    }
  });

  it("implements every entry it documents", () => {
    for (const entry of CATALOG) {
      const implemented =
        entry.kind === "panel" ||
        (entry.kind === "motion" ? MOTIONS[entry.command] : OPERATIONS[entry.command]) !==
          undefined;
      expect(implemented, `${entry.command} is documented but not implemented`).toBe(true);
    }
  });

  it("gives every command a unique id and every chord a unique binding", () => {
    const commands = CATALOG.map((entry) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);
    const chords = CATALOG.flatMap((entry) => entry.keys);
    expect(new Set(chords).size).toBe(chords.length);
  });
});

// package.json is generated from the catalog by `pnpm sync:contributions`. This
// is what fails when someone edits one of them and forgets the other.
describe("package.json matches the catalog", () => {
  it("contributes the same commands, in the same order", () => {
    expect(MANIFEST.contributes.commands).toEqual(
      CATALOG.map((entry) => ({
        command: `paredit-redex.${entry.command}`,
        title: entry.title,
        category: "Paredit",
      })),
    );
  });

  it("contributes the same keybindings, and only lets editing commands write", () => {
    expect(MANIFEST.contributes.keybindings).toEqual(
      CATALOG.flatMap((entry) =>
        entry.keys.map((key) => ({
          command: `paredit-redex.${entry.command}`,
          key,
          when: entry.kind === "edit" ? `${SCOPE} && !editorReadonly` : SCOPE,
        })),
      ),
    );
  });
});

describe("the documented examples are real", () => {
  it.each(CATALOG.filter((entry) => entry.example !== undefined).map((e) => [e.title, e] as const))(
    "%s actually transforms its example",
    (_title, entry) => {
      const example = exampleFor(entry);
      expect(example, `${entry.command} declined its own example`).toBeDefined();
      // An example that changes nothing teaches nothing.
      expect(example?.after).not.toBe(example?.before);
    },
  );
});
