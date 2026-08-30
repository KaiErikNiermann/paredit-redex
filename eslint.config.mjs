import eslint from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import security from "eslint-plugin-security";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    plugins: { unicorn },
    rules: {
      "unicorn/prefer-node-protocol": "error",
      "unicorn/no-array-push-push": "error",
      "unicorn/no-lonely-if": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-useless-undefined": "error",
      "unicorn/prefer-array-flat-map": "error",
      "unicorn/prefer-array-some": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/prefer-string-starts-ends-with": "error",
      "unicorn/prefer-string-slice": "error",
      "unicorn/prefer-ternary": "warn",
      "unicorn/prefer-optional-catch-binding": "error",
      "unicorn/no-for-loop": "error",
      "unicorn/prefer-number-properties": "error",
      "unicorn/throw-new-error": "error",
      "unicorn/prefer-type-error": "error",
      "unicorn/consistent-function-scoping": "warn",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports"
        }
      ],
      "sonarjs/todo-tag": "warn"
    }
  },
  {
    // The lexer is a character-level state machine: index arithmetic over the
    // source string is the point, and the character classes it tests are the
    // Racket reader's, not user input. These rules fire on every line of it.
    files: ["src/reader/**/*.ts"],
    rules: {
      "security/detect-object-injection": "off",
      "security/detect-unsafe-regex": "off",
      "security/detect-non-literal-regexp": "off"
    }
  },
  {
    // The oracle harness exists to shell out to the local Racket install and
    // read its source tree; resolving `racket` and `find` through PATH and
    // reading paths built at runtime is the job, not an oversight. It never
    // ships — nothing in dist/ imports it.
    files: ["src/**/oracle-corpus.test.ts"],
    rules: {
      "sonarjs/no-os-command-from-path": "off",
      "security/detect-non-literal-fs-filename": "off"
    }
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "eslint.config.mjs",
      "vitest.config.mts",
      "vitest.oracle.mts",
      ".vscode-test.mjs",
      "test/**",
      ".remember/**"
    ]
  }
);
