import { defineConfig } from "vitest/config";

/** Config for the on-demand differential sweep against a local Racket install. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/oracle-corpus.test.ts"],
    testTimeout: 600_000,
  },
});
