/**
 * Sweeps this lexer against Racket's own over every `.rkt` file in the local
 * Racket installation, which is the corpus that actually contains the reader
 * edge cases. Skipped when `racket` is not on PATH, so CI does not need it —
 * `oracle-diff.test.ts` covers the same ground from committed fixtures.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OracleToken, Span } from "./oracle-diff";
import { compareLexers } from "./oracle-diff";

const CORPUS_ROOTS = ["/usr/share/racket/pkgs", "/usr/share/racket/collects"];
const MAX_FILES = 10_000;

function hasRacket(): boolean {
  try {
    execFileSync("racket", ["--version"], { stdio: "ignore" });
    return CORPUS_ROOTS.some((root) => existsSync(root));
  } catch {
    return false;
  }
}

function corpusFiles(): string[] {
  const roots = CORPUS_ROOTS.filter((root) => existsSync(root));
  const found = execFileSync("find", [...roots, "-name", "*.rkt", "-type", "f"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return found.split("\n").filter(Boolean).slice(0, MAX_FILES);
}

interface OracleRecord {
  readonly file: string;
  readonly tokens: readonly OracleToken[];
}

function runOracle(files: readonly string[]): OracleRecord[] {
  const output = execFileSync("racket", ["test/oracle/lex.rkt", ...files], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OracleRecord);
}

function describeSpan(span: Span | undefined, source: string): string {
  if (span === undefined) {
    return "<none>";
  }
  return `${span.cls}[${String(span.start)}..${String(span.end)}] ${JSON.stringify(
    source.slice(span.start, span.end).slice(0, 40),
  )}`;
}

describe.skipIf(!hasRacket())("differential sweep against syntax-color/racket-lexer", () => {
  it("agrees on every token boundary and class across the local Racket corpus", () => {
    const files = corpusFiles();
    expect(files.length).toBeGreaterThan(100);

    const failures: string[] = [];
    let compared = 0;

    // Batched so one Racket startup covers many files, but not so large that
    // the argument list overflows.
    for (let offset = 0; offset < files.length; offset += 400) {
      for (const record of runOracle(files.slice(offset, offset + 400))) {
        // Matches the normalisation lex.rkt applies; see the note there.
        const source = readFileSync(record.file, "utf8").replaceAll("\r\n", "\n");
        const mismatches = compareLexers(source, record.tokens);
        compared += 1;
        if (mismatches.length > 0 && failures.length < 20) {
          const first = mismatches[0];
          failures.push(
            `${record.file}\n    expected ${describeSpan(first?.expected, source)}` +
              `\n    actual   ${describeSpan(first?.actual, source)}`,
          );
        }
      }
    }

    expect(compared).toBeGreaterThan(100);
    expect(failures.join("\n")).toBe("");
  }, 600_000);
});
