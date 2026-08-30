/**
 * The resumable lexer mode.
 *
 * This is the same role that `mode` plays for Racket's `racket-lexer*` and that
 * `ScannerState` plays for Calva: the lexer is line-at-a-time, and this is
 * everything it needs to carry from the end of one line to the start of the next.
 *
 * Keeping it small and comparable is what makes incremental relexing cheap — the
 * document store stops rescanning as soon as a recomputed line-start state equals
 * the one it had stored, and for the overwhelmingly common `default` case that
 * comparison is a pointer compare against the interned singleton.
 */

/** Which flavour of string literal is open, purely for token classification. */
export type StringFlavor = "string" | "byte" | "regexp" | "byte-regexp";

export type LexState =
  | { readonly kind: "default" }
  | { readonly kind: "block-comment"; readonly depth: number }
  | { readonly kind: "string"; readonly flavor: StringFlavor }
  | { readonly kind: "here-string"; readonly tag: string }
  | { readonly kind: "bar" };

/**
 * The state at the start of a line of ordinary code.
 *
 * Interned: the incremental store's stop condition compares against this by
 * identity on the hot path.
 */
export const DEFAULT_STATE: LexState = { kind: "default" };

export function statesEqual(a: LexState, b: LexState): boolean {
  if (a === b) {
    return true;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "default":
    case "bar": {
      return true;
    }
    case "block-comment": {
      return b.kind === "block-comment" && a.depth === b.depth;
    }
    case "string": {
      return b.kind === "string" && a.flavor === b.flavor;
    }
    case "here-string": {
      return b.kind === "here-string" && a.tag === b.tag;
    }
  }
}
