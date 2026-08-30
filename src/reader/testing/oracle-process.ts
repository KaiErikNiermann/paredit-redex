/**
 * A warm `racket-lexer` process, for tests that need many small lexings.
 *
 * The batch mode in `lex.rkt` is right for sweeping thousands of files, but
 * property-based shrinking asks for hundreds of lexings of ever-smaller inputs
 * one at a time, and 130ms of Racket startup each would make shrinking take
 * longer than the search that found the failure. This keeps one process alive
 * and speaks a line per request to it.
 *
 * Test support only: nothing in `dist/` imports it, and the extension never
 * needs Racket at runtime.
 */

import { execFileSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import type { OracleToken } from "../oracle-diff";

/** Whether a local Racket install is available to act as the oracle. */
export function racketAvailable(): boolean {
  try {
    execFileSync("racket", ["--version"], { stdio: "ignore" });
    return existsSync("test/oracle/lex.rkt");
  } catch {
    return false;
  }
}

export class OracleProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending: ((tokens: OracleToken[]) => void)[] = [];
  #buffer = "";

  constructor() {
    this.#child = spawn("racket", ["test/oracle/lex.rkt", "--server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => {
      this.#absorb(chunk);
    });
  }

  /** Tokens for `source`, as Racket's own lexer sees them. */
  async lex(source: string): Promise<OracleToken[]> {
    return new Promise<OracleToken[]>((resolve) => {
      this.#pending.push(resolve);
      this.#child.stdin.write(`${JSON.stringify(source)}\n`);
    });
  }

  dispose(): void {
    this.#child.stdin.end();
    this.#child.kill();
  }

  /** One reply per line, in the order the requests were written. */
  #absorb(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#pending.shift()?.(JSON.parse(line) as OracleToken[]);
      newline = this.#buffer.indexOf("\n");
    }
  }
}
