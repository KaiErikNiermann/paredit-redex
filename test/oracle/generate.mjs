#!/usr/bin/env node
/**
 * Regenerates test/fixtures/lexer-oracle.json from Racket's own lexer.
 *
 * Each case in cases.json is written to a temporary file, lexed by
 * test/oracle/lex.rkt, and stored alongside its source so that the differential
 * test can run with no Racket installed. Run it with `pnpm test:fixtures`
 * whenever a case is added, and commit the result.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "paredit-oracle-"));

try {
  const paths = cases.map((testCase, index) => {
    const path = join(scratch, `${String(index).padStart(3, "0")}.rkt`);
    writeFileSync(path, testCase.source, "utf8");
    return path;
  });

  const output = execFileSync("racket", [join(here, "lex.rkt"), ...paths], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const byPath = new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const record = JSON.parse(line);
        return [record.file, record.tokens];
      }),
  );

  const fixtures = cases.map((testCase, index) => {
    const tokens = byPath.get(paths[index]);
    if (tokens === undefined) {
      throw new Error(`racket produced no tokens for case ${testCase.name}`);
    }
    return { name: testCase.name, source: testCase.source, tokens };
  });

  const destination = join(root, "test", "fixtures", "lexer-oracle.json");
  writeFileSync(destination, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
  console.log(`wrote ${fixtures.length} fixtures to ${destination}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
