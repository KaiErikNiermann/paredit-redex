/**
 * Command registration.
 *
 * Each command is a thin adapter over a pure motion from `src/reader/`: read the
 * tokenised document, compute a new offset per selection, write the selections
 * back. Keeping the semantics on the other side of that boundary is what lets
 * them be tested without an editor.
 */

import * as vscode from "vscode";
import {
  backwardDatum,
  backwardDownList,
  backwardUpList,
  downList,
  forwardDatum,
  forwardUpList,
} from "../reader/cursor";
import type { TokenizedDocument } from "../reader/document";
import type { Logger } from "../logger";
import type { DocumentStore } from "./document-store";
import { isSupported } from "./languages";

type Motion = (document: TokenizedDocument, offset: number) => number | undefined;

const MOTIONS: readonly (readonly [string, Motion])[] = [
  ["forwardSexp", forwardDatum],
  ["backwardSexp", backwardDatum],
  ["forwardUpSexp", forwardUpList],
  ["backwardUpSexp", backwardUpList],
  ["forwardDownSexp", downList],
  ["backwardDownSexp", backwardDownList],
];

export function registerCommands(store: DocumentStore, logger: Logger): vscode.Disposable[] {
  return MOTIONS.map(([name, motion]) =>
    vscode.commands.registerCommand(`paredit-redex.${name}`, () => {
      applyMotion(store, motion, logger);
    }),
  );
}

function applyMotion(store: DocumentStore, motion: Motion, logger: Logger): void {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || !isSupported(editor.document.languageId)) {
    return;
  }

  const tracked = store.get(editor.document);
  const moved = editor.selections.map((selection) => {
    const offset = editor.document.offsetAt(selection.active);
    const target = motion(tracked, offset);
    if (target === undefined) {
      return selection;
    }
    const position = editor.document.positionAt(target);
    return new vscode.Selection(position, position);
  });

  // Set the selections explicitly rather than letting the editor adjust them:
  // its idea of where the cursor should end up is not paredit's.
  editor.selections = moved;
  const primary = moved[0];
  if (primary !== undefined) {
    editor.revealRange(primary, vscode.TextEditorRevealType.Default);
  }
  logger.debug("structural motion applied", { selections: moved.length });
}
