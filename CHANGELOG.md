# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: TypeScript (strict), esbuild bundling, ESLint flat config, vitest, husky pre-push.
- Token model for the Racket reader (`src/reader/tokens.ts`).
- Resumable line-at-a-time lexer for the Racket reader (`src/reader/lexer.ts`), covering nested
  block comments, datum comments, character literals, bar-quoted symbols, every string flavour,
  here strings and prefixed open brackets.
- Differential test against Racket's own `syntax-color/racket-lexer`, run over committed fixtures
  by `pnpm test` and over the whole local Racket installation by `pnpm test:oracle`.
