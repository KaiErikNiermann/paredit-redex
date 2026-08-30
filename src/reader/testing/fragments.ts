/**
 * The fragment pool the lexer fuzzer draws from.
 *
 * Random bytes would be a poor fuzzer here: nearly every byte is a symbol
 * character, so the generator would spend its whole budget lexing atoms and
 * essentially never produce `#|` immediately followed by `#\"`. What the state
 * machine needs stressed is the *adjacency* of reader constructs, so the
 * generator samples from this pool instead and concatenates.
 *
 * Half of these are deliberately unbalanced. The corpus sweep already covers
 * well-formed code — all 5290 files of it — and a buffer being typed into is
 * exactly what that corpus does not contain.
 */
export const FRAGMENTS: readonly string[] = [
  // Brackets, including the prefixed opens that make a delimiter multi-character.
  "(", ")", "[", "]", "{", "}",
  "#(", "#3(", "#hash(", "#hasheq(", "#hasheqv(", "#hashalw(", "#s(", "#si(",

  // Comments. `#|` nests, so an unmatched one of either kind matters.
  ";", "; trailing", "#|", "|#", "#|#", "|#|", "#;", "#;#;",

  // Strings, in every flavour, opened and closed independently.
  '"', '"a"', '"a', '\\"', '#"', '#rx"', '#px"', '#rx#"', '#px#"', '#rx',

  // Character literals — the classic source of a bracket that is not a bracket.
  "#\\", "#\\(", "#\\)", "#\\;", '#\\"', "#\\|", "#\\space", "#\\a", "#\\ab",
  "#\\u3BB", "#\\101", "#\\a1", "#\\\\",

  // Bar-quoted symbols, which quote brackets and may appear mid-symbol.
  "|", "|a|", "|a(b|", "a|b", "|#|", "||",

  // Backslash escapes inside symbols.
  "\\", "\\(", "\\|", "a\\(b",

  // Reader prefixes.
  "'", "`", ",", ",@", "#'", "#`", "#,", "#,@", "#&",

  // Here strings: the tag is the rest of the line, so a tag that looks like a
  // bracket is a good way to catch a lexer that peeks at characters.
  "#<<", "#<<E", "#<<(", "E", "#<<END", "END",

  // Line-level constructs that only mean something at a line start.
  "#lang racket", "#!/bin/sh", "#! ", "#:kw", "#%app",
  // A script line ending in a backslash, which continues onto the next line.
  "#! x\\", "#!/bin/sh \\",

  // Ordinary data, so the generator produces something recognisable too.
  "a", "abc", "1", "1.0", "#t", "#f", "#x1F", "+inf.0", "#", "#h",

  // Whitespace, and the newline that ends every line-scoped construct.
  " ", "  ", "\t", "\n", "\n\n",

  // Astral characters, where Racket counts one and JavaScript counts two.
  "\u{1F512}", "\u{1D538}", "#\\\u{1D538}",
];

/**
 * Fragments for tests that have no oracle to disagree with.
 *
 * Adds the ones whose *only* known divergence is an artifact of the harness
 * rather than of the lexer: Racket collapses a CRLF pair into a single position
 * when line counting is on, so `\r\n` is normalised out before any comparison.
 * The invariant tests compare the lexer against itself, so they can keep it.
 */
export const ROBUSTNESS_FRAGMENTS: readonly string[] = [
  ...FRAGMENTS,
  "\r\n",
  "\r",
  "\0",
  "​",
  "�",
];
