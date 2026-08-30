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
  /** Absolute offset of each line start; rebuilt lazily after an edit. */
  #lineStarts: number[] | undefined;

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

  /** Length in characters, counting the newline between each pair of lines. */
  get length(): number {
    return this.#totalLength();
  }

  /** Absolute offset of the first character of `line`. */
  lineStart(line: number): number {
    const starts = (this.#lineStarts ??= this.#computeLineStarts());
    if (line <= 0) {
      return 0;
    }
    return starts[Math.min(line, starts.length - 1)] ?? this.#totalLength();
  }

  offsetAt(position: Position): number {
    const line = Math.max(0, Math.min(position.line, this.#lines.length - 1));
    const character = Math.max(0, Math.min(position.character, this.lineText(line).length));
    return this.lineStart(line) + character;
  }

  positionAt(offset: number): Position {
    const starts = (this.#lineStarts ??= this.#computeLineStarts());
    const clamped = Math.max(0, Math.min(offset, this.#totalLength()));

    // Binary search for the last line starting at or before `clamped`.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= clamped) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low, character: clamped - (starts[low] ?? 0) };
  }

  #computeLineStarts(): number[] {
    const starts: number[] = [];
    let offset = 0;
    for (const line of this.#lines) {
      starts.push(offset);
      offset += line.length + 1;
    }
    return starts;
  }

  #totalLength(): number {
    return this.#lines.reduce((total, line) => total + line.length + 1, -1);
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
    this.#lineStarts = undefined;
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
