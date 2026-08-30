import { defineConfig } from "vitest/config";

/** Config for the on-demand checks that need a local Racket install. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/oracle-corpus.test.ts", "src/**/lexer-fuzz.test.ts"],
    testTimeout: 600_000,
  },
});
