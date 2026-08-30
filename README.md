# Paredit for Racket

Structural editing for Racket, Scheme and Lisp in VS Code — slurp, barf, splice, raise, wrap,
split, join — with the canonical `paredit.el` keymap.

VS Code has no working paredit for Racket. [Magic Racket][magic-racket] supplies the language id,
grammar and language-server client but contributes no bracket manipulation, and every other
candidate is either Clojure-only or unmaintained since 2020. This fills that gap.

## Keymap

The canonical `paredit.el` bindings, scoped to the `racket`, `scheme`, `lisp` and `commonlisp`
language ids. Everything is also on the command palette under **Paredit**.

| | Key | Command |
|---|---|---|
| **Navigate** | `ctrl+alt+f` / `ctrl+alt+b` | forward / backward over a datum |
| | `ctrl+alt+u` / `ctrl+alt+n` | out of the list, backward / forward |
| | `ctrl+alt+d` / `ctrl+alt+p` | into a list, forward / backward |
| **Depth** | `ctrl+right` or `ctrl+shift+0` | forward slurp |
| | `ctrl+left` or `ctrl+shift+]` | forward barf |
| | `ctrl+alt+left` or `ctrl+shift+9` | backward slurp |
| | `ctrl+alt+right` or `ctrl+shift+[` | backward barf |
| | `alt+s` / `alt+r` | splice / raise |
| | `alt+shift+9` / `alt+[` / `alt+shift+[` | wrap in `()` / `[]` / `{}` |
| **Kill** | `ctrl+alt+k` / `ctrl+alt+backspace` | kill / backward-kill a datum |
| | `alt+up` / `alt+down` | splice, killing backward / forward |
| **Rearrange** | `alt+shift+s` / `alt+shift+j` | split / join |
| | `ctrl+alt+t` | transpose |
| | `ctrl+alt+shift+up` / `ctrl+alt+shift+down` | drag a datum earlier / later |

Two things worth knowing before you turn this on.

**It takes keys VS Code already uses**, inside Lisp files only: `ctrl+left`/`ctrl+right` normally
move by word, and `alt+up`/`alt+down` normally move a line. `paredit.el` claims all four, so this
does too. Rebind them in `keybindings.json` if you would rather keep the defaults.

**The bracket chords assume a US layout.** `C-)` is written `ctrl+shift+0` because that is where `)`
lives on a US keyboard; on a German layout `)` is `shift+9`, and the chord will not be what your
fingers expect. The `ctrl+left`/`ctrl+right` alternates — which `paredit.el` also defines — are
layout-independent, so slurp and barf work regardless; wrap (`alt+shift+9`) is the one that needs
remapping.

`wrap-square` and `wrap-curly` are bound here even though upstream paredit leaves them unbound:
Racket code is full of `cond`, `let` and `match` clauses in `[]`, and racket-mode's own docs tell
Emacs users to hand-bind them for exactly that reason. The drag commands have no paredit equivalent
at all — they come from Calva, where they are the most-used part of the package.

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
- `#<<TAG` here strings, whose body runs to a line equal to `TAG` and whose brackets are text
- `#!` script lines, which are comments rather than data

Known gap: `@`-expressions (Scribble text bodies), where `{...}` delimits text rather than a
datum, are lexed as ordinary data rather than understood.

### Correctness

The lexer is differentially tested against Racket's own `syntax-color/racket-lexer`. An oracle
script drives the real lexer and both streams are projected onto a common set of structural classes,
then compared token for token — every boundary must agree.

`pnpm test:oracle` runs that comparison over **every `.rkt` file in the local Racket installation**
(5290 of them, ~25s) and currently reports no divergence. `pnpm test` runs it over committed
fixtures instead, so neither CI nor a contributor needs Racket installed; `pnpm test:fixtures`
regenerates those from `test/oracle/cases.json`.

The comparison is deliberately not an identity check, because the two token models are not the same
one. Four differences are reconciled rather than treated as failures, each for a stated reason:

| Difference | Why |
|---|---|
| adjacent same-class tokens are coalesced | this lexer is line-at-a-time; Racket reports a multi-line string, comment or whitespace run as one token |
| Racket's atom flavours collapse to one class | `symbol`, `constant`, `other`, `hash-colon-keyword` are distinctions paredit has no use for — and Racket reports the quoting prefixes among them |
| offsets are remapped to UTF-16 | Racket counts code points, JavaScript and VS Code count code units, so any file with an emoji has two offset systems |
| spans Racket calls `error` compare on boundaries only | error recovery is where two independent lexers are entitled to differ |

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
