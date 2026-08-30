# Paredit for Racket

Structural editing for Racket, Scheme and Lisp in VS Code — slurp, barf, splice, raise, wrap,
split, join — with the canonical `paredit.el` keymap.

VS Code has no working paredit for Racket. [Magic Racket][magic-racket] supplies the language id,
grammar and language-server client but contributes no bracket manipulation, and every other
candidate is either Clojure-only or unmaintained since 2020. This fills that gap.

## Status

Early. See `CHANGELOG.md` for what actually works today.

## Design

Three layers, strictly separated:

| Layer | Contents | Depends on `vscode`? |
|---|---|---|
| `src/reader/` | resumable line lexer, incremental line-state store, token cursor | no |
| `src/ops/` | paredit command semantics as pure `(doc, selections) -> Edit[]` | no |
| `src/vscode/` | document store, command registration, applying edits | yes |

Keeping `reader` and `ops` free of `vscode` imports is what makes the behaviour testable as plain
unit tests rather than through an editor harness.

### Why a client-side lexer

racket-langserver does compute full bracket structure internally, but it is discarded at the LSP
boundary: the published semantic-token legend is a six-element enum
(`variable function string number regexp comment`) with no punctuation category, and the tokens are
derived from the check-syntax expansion trace — which walks syntax objects, and so has no
parenthesis nodes at all. Bracket structure is not recoverable from the protocol.

Lexing locally also keeps structural commands off the IPC path, which matters when they are bound
to keys you hold down.

### The reader features that matter

Naive bracket matching breaks on Racket in specific, enumerable ways, all of which the lexer
handles:

- `#\(`, `#\)`, `#\;`, `#\"` — character literals that look like delimiters
- `#| ... |#` — block comments, which **nest**
- `#;` — datum comments, which delete the *next datum* from the stream
- `|bar symbols|` — pipes quote everything, including brackets, and may appear mid-symbol
- `#rx"..."`, `#px"..."`, `#"..."` — prefixed string flavours
- `#(`, `#hash(`, `#s(` — prefixed opens, where the delimiter lexeme is longer than one character

Known gaps: `@`-expressions (Scribble text bodies) and here-strings (`#<<EOF`) are lexed as ordinary
data rather than understood.

### Correctness

The lexer is differentially tested against Racket's own `syntax-color/racket-lexer`: an oracle
script drives the real lexer over a corpus and the results are compared token for token. The token
model deliberately copies that lexer's conventions so the comparison needs no normalisation.

## Requirements

An extension providing the `racket` language id — [Magic Racket][magic-racket] is the usual one.
Regenerating the lexer fixtures (`just oracle`) additionally needs `racket` on `PATH`; using the
extension does not.

## Development

```bash
just check         # lint, test, build
just install-local # package a .vsix and install it into VS Code
just oracle        # regenerate lexer fixtures from Racket's own lexer
```

[magic-racket]: https://marketplace.visualstudio.com/items?itemName=evzen-wybitul.magic-racket
