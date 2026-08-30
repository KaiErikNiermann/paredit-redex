/**
 * Command registration.
 *
 * Each command is a thin adapter over a pure function from `src/reader/` or
 * `src/ops/`: read the tokenised document, compute per selection, write back.
 * Keeping the semantics on the other side of that boundary is what lets them be
 * tested without an editor.
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
import type { Edit, EditPlan, Operation } from "../ops/edits";
import { OPERATIONS } from "../ops";
import type { Logger } from "../logger";
import type { DocumentStore } from "./document-store";
import { isSupported } from "./languages";

type Motion = (document: TokenizedDocument, offset: number) => number | undefined;

const MOTIONS: Readonly<Record<string, Motion>> = {
  forwardSexp: forwardDatum,
  backwardSexp: backwardDatum,
  forwardUpSexp: forwardUpList,
  backwardUpSexp: backwardUpList,
  forwardDownSexp: downList,
  backwardDownSexp: backwardDownList,
};

export function registerCommands(store: DocumentStore, logger: Logger): vscode.Disposable[] {
  const motions = Object.entries(MOTIONS).map(([name, motion]) =>
    vscode.commands.registerCommand(`paredit-redex.${name}`, () => {
      applyMotion(store, motion);
    }),
  );
  const operations = Object.entries(OPERATIONS).map(([name, operation]) =>
    vscode.commands.registerCommand(`paredit-redex.${name}`, async () => {
      await applyOperation(store, operation, logger);
    }),
  );
  return [...motions, ...operations];
}

/** The active editor, if it holds a document this extension handles. */
function targetEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor !== undefined && isSupported(editor.document.languageId) ? editor : undefined;
}

function applyMotion(store: DocumentStore, motion: Motion): void {
  const editor = targetEditor();
  if (editor === undefined) {
    return;
  }
  const tracked = store.get(editor.document);
  const moved = editor.selections.map((selection) => {
    const target = motion(tracked, editor.document.offsetAt(selection.active));
    if (target === undefined) {
      return selection;
    }
    const position = editor.document.positionAt(target);
    return new vscode.Selection(position, position);
  });

  // Set the selections explicitly rather than letting the editor adjust them:
  // its idea of where the cursor should end up is not paredit's.
  editor.selections = moved;
  reveal(editor);
}

async function applyOperation(
  store: DocumentStore,
  operation: Operation,
  logger: Logger,
): Promise<void> {
  const editor = targetEditor();
  if (editor === undefined) {
    return;
  }
  const tracked = store.get(editor.document);

  // Every plan is computed against the same snapshot, so their offsets are all
  // in the pre-edit coordinate system.
  const plans = editor.selections
    .map((selection) => ({
      selection,
      plan: operation(tracked, editor.document.offsetAt(selection.active)),
    }))
    .filter((entry): entry is { selection: vscode.Selection; plan: EditPlan } =>
      entry.plan !== undefined,
    )
    .sort((a, b) => firstOffset(a.plan) - firstOffset(b.plan));

  if (plans.length === 0) {
    return;
  }

  const edits = plans.flatMap((entry) => entry.plan.edits);
  const applied = await editor.edit(
    (builder) => {
      // Descending, so an earlier edit never shifts a later one's range.
      for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        builder.replace(toRange(editor.document, edit), edit.text);
      }
    },
    // One undo stop per command: a paredit operation is one thing the user did.
    { undoStopBefore: true, undoStopAfter: true },
  );

  if (!applied) {
    logger.warn("editor rejected the structural edit");
    return;
  }

  // Each caret already accounts for its own plan's edits; what remains is the
  // shift from the plans before it.
  let shift = 0;
  const carets: vscode.Selection[] = [];
  for (const { plan } of plans) {
    const position = editor.document.positionAt(plan.caret + shift);
    carets.push(new vscode.Selection(position, position));
    shift += lengthDelta(plan.edits);
  }
  editor.selections = carets;
  reveal(editor);
}

function firstOffset(plan: EditPlan): number {
  return Math.min(...plan.edits.map((edit) => edit.start));
}

function lengthDelta(edits: readonly Edit[]): number {
  return edits.reduce((total, edit) => total + edit.text.length - (edit.end - edit.start), 0);
}

function toRange(document: vscode.TextDocument, edit: Edit): vscode.Range {
  return new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end));
}

function reveal(editor: vscode.TextEditor): void {
  const primary = editor.selections[0];
  if (primary !== undefined) {
    editor.revealRange(primary, vscode.TextEditorRevealType.Default);
  }
}
