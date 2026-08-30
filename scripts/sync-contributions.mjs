#!/usr/bin/env node
/**
 * Regenerates package.json's contributed commands and keybindings from the
 * command catalog.
 *
 * The catalog is the source of truth; this keeps the manifest, the cheat sheet
 * and the README from drifting apart. `catalog.test.ts` fails if they have.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { CATALOG } = await import(join(root, "src", "cheatsheet", "catalog.ts"));
const { commands, keybindings } = contributionsFrom(CATALOG);

const manifestPath = join(root, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.contributes.commands = commands;
manifest.contributes.keybindings = keybindings;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`synced ${commands.length} commands and ${keybindings.length} keybindings`);

/** Shared with the test, which asserts package.json already equals this. */
export function contributionsFrom(catalog) {
  const scope = "editorTextFocus && editorLangId =~ /^(racket|scheme|lisp|commonlisp)$/";
  return {
    commands: catalog.map((entry) => ({
      command: `paredit-redex.${entry.command}`,
      title: entry.title,
      category: "Paredit",
    })),
    keybindings: catalog.flatMap((entry) =>
      entry.keys.map((key) => ({
        command: `paredit-redex.${entry.command}`,
        key,
        // A command that writes must also require a writable editor.
        when: entry.kind === "edit" ? `${scope} && !editorReadonly` : scope,
      })),
    ),
  };
}
