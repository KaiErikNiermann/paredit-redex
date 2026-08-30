import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The corpus sweep needs a local Racket install and takes ~20s over 5000
    // files. It runs from `pnpm test:oracle`; the committed fixtures in
    // oracle-diff.test.ts cover the same ground on every ordinary run.
    exclude: ["**/node_modules/**", "src/**/oracle-corpus.test.ts"],
  },
});
