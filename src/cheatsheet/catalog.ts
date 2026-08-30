/**
 * The command catalog: the single source of truth for what this extension
 * contributes.
 *
 * `package.json`'s `contributes.commands` and `contributes.keybindings` are
 * generated from this file by `pnpm sync:contributions`, and a test fails if
 * they drift. The cheat sheet is rendered from it too, and the before/after
 * examples are produced by actually running the operations rather than being
 * written out by hand — so the documentation cannot describe a transform the
 * code does not perform.
 *
 * This file deliberately has no imports. The sync script loads it directly under
 * Node's type stripping, which cannot resolve extensionless relative imports.
 */

export type EntryKind = "motion" | "edit" | "panel";

export type EntryGroup = "Navigate" | "Depth" | "Kill" | "Rearrange" | "Help";

export interface CatalogEntry {
  /** Command id, without the `paredit-redex.` prefix. */
  readonly command: string;
  /** Title as it appears in the command palette, after the `Paredit:` category. */
  readonly title: string;
  readonly keys: readonly string[];
  readonly kind: EntryKind;
  readonly group: EntryGroup;
  /** One line, for the quick reference. */
  readonly summary: string;
  /** A short paragraph, for the guide. */
  readonly detail: string;
  /** Caret-marked source; the "after" is computed by running the command. */
  readonly example?: string;
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    command: "forwardSexp",
    title: "Forward Sexp",
    keys: ["ctrl+alt+f"],
    kind: "motion",
    group: "Navigate",
    summary: "Move past the next datum.",
    detail:
      "Steps over one complete datum, whatever its size: an atom, a string, or a whole nested list. At the end of a list it steps out of the list rather than refusing to move, which is how paredit behaves and where it differs from Emacs' own forward-sexp.",
    example: "(define ‸(f x) body)",
  },
  {
    command: "backwardSexp",
    title: "Backward Sexp",
    keys: ["ctrl+alt+b"],
    kind: "motion",
    group: "Navigate",
    summary: "Move back before the previous datum.",
    detail:
      "The mirror of Forward Sexp. It takes reader prefixes with the datum they belong to, so moving back over '(a b) lands before the quote, not between it and the list.",
    example: "(define (f x)‸ body)",
  },
  {
    command: "backwardUpSexp",
    title: "Backward Up Sexp",
    keys: ["ctrl+alt+u"],
    kind: "motion",
    group: "Navigate",
    summary: "Move out of the enclosing list, backward.",
    detail:
      "Climbs one level of nesting and lands before the opening bracket. This is the workhorse for getting out of somewhere deep without counting parentheses.",
    example: "(a (b ‸c) d)",
  },
  {
    command: "forwardUpSexp",
    title: "Forward Up Sexp",
    keys: ["ctrl+alt+n"],
    kind: "motion",
    group: "Navigate",
    summary: "Move out of the enclosing list, forward.",
    detail:
      "Climbs one level of nesting and lands after the closing bracket — useful for finishing with a form and moving on to whatever follows it.",
    example: "(a (b ‸c) d)",
  },
  {
    command: "forwardDownSexp",
    title: "Forward Down Sexp",
    keys: ["ctrl+alt+d"],
    kind: "motion",
    group: "Navigate",
    summary: "Move into the next list.",
    detail:
      "Descends one level, landing just inside the next opening bracket. A prefixed open such as #hash( counts as one bracket, so you land after the whole thing.",
    example: "(a ‸(b c) d)",
  },
  {
    command: "backwardDownSexp",
    title: "Backward Down Sexp",
    keys: ["ctrl+alt+p"],
    kind: "motion",
    group: "Navigate",
    summary: "Move into the previous list, from its end.",
    detail:
      "Descends into the list before the caret, landing just inside its closing bracket — where you would want to be to start appending to it.",
    example: "(a (b c) ‸d)",
  },

  {
    command: "forwardSlurp",
    title: "Forward Slurp",
    keys: ["ctrl+right", "ctrl+shift+0"],
    kind: "edit",
    group: "Depth",
    summary: "Pull the next datum in through the closing bracket.",
    detail:
      "Moves the enclosing list's closing bracket rightward over the datum that follows it, so that datum becomes the list's last element. This is the command for 'I wrote the form too small' — you keep pressing it until the list contains everything it should. The bracket keeps its shape, so slurping into [cond ...] stays square.",
    example: "(a (b‸) c d)",
  },
  {
    command: "forwardBarf",
    title: "Forward Barf",
    keys: ["ctrl+left", "ctrl+shift+]"],
    kind: "edit",
    group: "Depth",
    summary: "Push the last datum out through the closing bracket.",
    detail:
      "The inverse of Forward Slurp: moves the closing bracket leftward, expelling the list's last element into the enclosing form. Use it when a form swallowed one argument too many.",
    example: "(a (b‸ c) d)",
  },
  {
    command: "backwardSlurp",
    title: "Backward Slurp",
    keys: ["ctrl+alt+left", "ctrl+shift+9"],
    kind: "edit",
    group: "Depth",
    summary: "Pull the previous datum in through the opening bracket.",
    detail:
      "Moves the opening bracket leftward over the datum before it, so that datum becomes the list's first element. Handy for wrapping something you have already written into a call you decided on afterwards.",
    example: "(a b (‸c) d)",
  },
  {
    command: "backwardBarf",
    title: "Backward Barf",
    keys: ["ctrl+alt+right", "ctrl+shift+["],
    kind: "edit",
    group: "Depth",
    summary: "Push the first datum out through the opening bracket.",
    detail:
      "The inverse of Backward Slurp: moves the opening bracket rightward, expelling the list's first element into the enclosing form.",
    example: "(a (b ‸c) d)",
  },
  {
    command: "splice",
    title: "Splice Sexp",
    keys: ["alt+s"],
    kind: "edit",
    group: "Depth",
    summary: "Remove the enclosing brackets, keeping the contents.",
    detail:
      "Dissolves one level of nesting: the enclosing list's brackets go, and everything inside rises into the form around it. The usual way to undo a wrap you no longer want.",
    example: "(a (b ‸c) d)",
  },
  {
    command: "raise",
    title: "Raise Sexp",
    keys: ["alt+r"],
    kind: "edit",
    group: "Depth",
    summary: "Replace the enclosing list with the datum at the caret.",
    detail:
      "The datum under the caret takes the place of the whole list containing it; everything else in that list is discarded. This is how you promote one branch of an expression and throw away the scaffolding around it: put the caret on x in (if test x y) and Raise leaves just x.",
    example: "(a (b ‸c) d)",
  },
  {
    command: "wrapRound",
    title: "Wrap Round",
    keys: ["alt+shift+9"],
    kind: "edit",
    group: "Depth",
    summary: "Wrap the next datum in ( ).",
    detail:
      "Puts a new pair of parentheses around the datum at the caret and leaves the caret inside, ready for you to type the operator. The complement of Splice.",
    example: "(a ‸b c)",
  },
  {
    command: "wrapSquare",
    title: "Wrap Square",
    keys: ["alt+["],
    kind: "edit",
    group: "Depth",
    summary: "Wrap the next datum in [ ].",
    detail:
      "The same, in square brackets. Upstream paredit leaves this unbound; it is bound here because Racket puts cond clauses, let bindings and match patterns in [] and you will want it constantly.",
    example: "(cond ‸(even? n) 1)",
  },
  {
    command: "wrapCurly",
    title: "Wrap Curly",
    keys: ["alt+shift+["],
    kind: "edit",
    group: "Depth",
    summary: "Wrap the next datum in { }.",
    detail: "The same, in curly braces.",
    example: "(a ‸b c)",
  },

  {
    command: "killSexp",
    title: "Kill Sexp",
    keys: ["ctrl+alt+k"],
    kind: "edit",
    group: "Kill",
    summary: "Delete from the caret through the end of the next datum.",
    detail:
      "Deletes one whole datum forward, brackets and all, so you never end up with a stray half of a list. With the caret inside an atom it deletes the rest of that atom.",
    example: "(a ‸b c)",
  },
  {
    command: "backwardKillSexp",
    title: "Backward Kill Sexp",
    keys: ["ctrl+alt+backspace"],
    kind: "edit",
    group: "Kill",
    summary: "Delete from the start of the previous datum to the caret.",
    detail: "The mirror of Kill Sexp, taking any reader prefix along with the datum.",
    example: "(a b‸ c)",
  },
  {
    command: "spliceKillingBackward",
    title: "Splice Killing Backward",
    keys: ["alt+up"],
    kind: "edit",
    group: "Kill",
    summary: "Drop everything before the caret in this list, then splice it.",
    detail:
      "Deletes from the opening bracket up to the caret, then removes the brackets — so what was after the caret is all that survives, one level shallower. The fast way to keep only the tail of a form.",
    example: "(a (b ‸c) d)",
  },
  {
    command: "spliceKillingForward",
    title: "Splice Killing Forward",
    keys: ["alt+down"],
    kind: "edit",
    group: "Kill",
    summary: "Drop everything after the caret in this list, then splice it.",
    detail: "The mirror: what was before the caret survives, one level shallower.",
    example: "(a (b‸ c) d)",
  },

  {
    command: "splitSexp",
    title: "Split Sexp",
    keys: ["alt+shift+s"],
    kind: "edit",
    group: "Rearrange",
    summary: "Cut the enclosing list in two at the caret.",
    detail:
      "Closes the list at the caret and opens a new one of the same shape immediately after, so one form becomes two siblings.",
    example: "(a b‸ c d)",
  },
  {
    command: "joinSexps",
    title: "Join Sexps",
    keys: ["alt+shift+j"],
    kind: "edit",
    group: "Rearrange",
    summary: "Merge the list before the caret with the one after it.",
    detail:
      "The inverse of Split: with the caret between a closing bracket and an opening one, the two lists become a single list containing both sets of elements.",
    example: "(a b) ‸(c d)",
  },
  {
    command: "transposeSexps",
    title: "Transpose Sexps",
    keys: ["ctrl+alt+t"],
    kind: "edit",
    group: "Rearrange",
    summary: "Swap the datum before the caret with the one after it.",
    detail:
      "Exchanges two neighbouring data whole, leaving the caret after the pair. Reorder arguments without selecting anything.",
    example: "(a ‸b c)",
  },
  {
    command: "dragForward",
    title: "Drag Sexp Forward",
    keys: ["ctrl+alt+shift+down"],
    kind: "edit",
    group: "Rearrange",
    summary: "Move the datum at the caret one place later.",
    detail:
      "Swaps the datum with the one after it and carries the caret along, so you can hold the key and walk an element down a list. There is no paredit.el equivalent — this comes from Calva, where it is the most-used structural command of the set.",
    example: "(‸a b c)",
  },
  {
    command: "dragBackward",
    title: "Drag Sexp Backward",
    keys: ["ctrl+alt+shift+up"],
    kind: "edit",
    group: "Rearrange",
    summary: "Move the datum at the caret one place earlier.",
    detail: "The mirror of Drag Sexp Forward, walking the element up the list instead.",
    example: "(a ‸b c)",
  },

  {
    command: "cheatSheet",
    title: "Cheat Sheet",
    keys: [],
    kind: "panel",
    group: "Help",
    summary: "Open this page.",
    detail:
      "Opens the quick reference and the guide in an editor tab. Every before/after below is produced by running the command itself, so it always shows what this build actually does.",
  },
];
