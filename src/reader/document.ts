/**
 * Incrementally maintained tokenisation of a document.
 *
 * Holds, per line, the text, its tokens, and the lexer state at its *start*.
 * An edit relexes forward from the first line it touched and stops at the first
 * line past the edit whose recomputed start-state matches the one already
 * stored — from there the existing tokens are still correct and are spliced
 * back unchanged.
 *
 * That stop condition is the whole point. Typing inside one form relexes one
 * line; typing an unterminated `"` at the top of a file legitimately relexes to
 * the end, because every line after it really has changed meaning. This is the
 * same design as DrRacket's `color:text<%>` and Calva's `LineInputModel`.
 */

import type { LexState } from "./lex-state";
import { DEFAULT_STATE, statesEqual } from "./lex-state";
import { lexLine } from "./lexer";
import type { Token } from "./tokens";

export interface Position {
  readonly line: number;
  readonly character: number;
}

/** A replacement of the text in `[start, end)` by `text`, in the editor's terms. */
export interface TextChange {
  readonly start: Position;
  readonly end: Position;
  readonly text: string;
}

export class TokenizedDocument {
  #lines: string[];
  #tokens: (readonly Token[])[];
  /** State at the start of each line; `#states[0]` is always the default. */
  #states: LexState[];

  constructor(text: string) {
    this.#lines = text.split("\n");
    this.#tokens = Array.from({ length: this.#lines.length }, () => []);
    this.#states = Array.from({ length: this.#lines.length }, () => DEFAULT_STATE);
    this.#relexFrom(0, DEFAULT_STATE, this.#lines.length);
  }

  get lineCount(): number {
    return this.#lines.length;
  }

  lineText(line: number): string {
    return this.#lines[line] ?? "";
  }

  tokens(line: number): readonly Token[] {
    return this.#tokens[line] ?? [];
  }

  /** Lexer state at the start of `line`, exposed for tests and diagnostics. */
  stateAt(line: number): LexState {
    return this.#states[line] ?? DEFAULT_STATE;
  }

  getText(): string {
    return this.#lines.join("\n");
  }

  /**
   * Apply one change, relexing only what it can affect.
   *
   * Changes arriving in a batch must be applied in descending order of position,
   * so that earlier ones do not shift the coordinates of later ones.
   */
  applyChange(change: TextChange): void {
    const firstLine = change.start.line;
    const lastLine = change.end.line;

    const prefix = this.lineText(firstLine).slice(0, change.start.character);
    const suffix = this.lineText(lastLine).slice(change.end.character);
    const replacement = (prefix + change.text + suffix).split("\n");

    const removed = lastLine - firstLine + 1;
    this.#lines.splice(firstLine, removed, ...replacement);
    // The per-line arrays are indexed by line number, so they have to be
    // resized in step; placeholders are overwritten by the relex below.
    this.#tokens.splice(firstLine, removed, ...replacement.map(() => []));
    this.#states.splice(firstLine, removed, ...replacement.map(() => DEFAULT_STATE));

    // The state entering the first touched line cannot have changed: the edit
    // begins at or after that line's start.
    const entry = firstLine === 0 ? DEFAULT_STATE : this.#trailingState(firstLine - 1);
    this.#relexFrom(firstLine, entry, replacement.length);
  }

  /**
   * Relex from `from`, entering with `entry`.
   *
   * `minimum` lines are always relexed — those are the ones whose text actually
   * changed — after which the stored state is consulted line by line and the
   * scan stops as soon as it agrees.
   */
  #relexFrom(from: number, entry: LexState, minimum: number): void {
    let state = entry;
    let line = from;

    while (line < this.#lines.length) {
      // Lines the edit rewrote must be relexed regardless; only past them does
      // a stored state mean anything.
      const pastEdit = line >= from + minimum;
      if (pastEdit && statesEqual(this.#states[line] ?? DEFAULT_STATE, state)) {
        return;
      }

      const result = lexLine(this.lineText(line), state);
      this.#states[line] = state;
      this.#tokens[line] = result.tokens;
      state = result.stateOut;
      line += 1;
    }
  }

  /** The state leaving `line`, i.e. entering the line after it. */
  #trailingState(line: number): LexState {
    return lexLine(this.lineText(line), this.stateAt(line)).stateOut;
  }
}
