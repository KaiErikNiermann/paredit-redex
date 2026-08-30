/**
 * Keeps a `TokenizedDocument` in step with each open editor document.
 *
 * Changes are applied incrementally, which is the whole reason the store exists;
 * a full relex per keystroke would be wasted work on every file large enough to
 * care about. A cheap length check after each event catches the case where the
 * two have drifted — a change we never saw, an encoding surprise — and rebuilds
 * rather than letting every subsequent motion be quietly wrong.
 */

import * as vscode from "vscode";
import type { TextChange } from "../reader/document";
import { TokenizedDocument } from "../reader/document";
import type { Logger } from "../logger";
import { isSupported } from "./languages";

export class DocumentStore implements vscode.Disposable {
  readonly #documents = new Map<string, TokenizedDocument>();
  readonly #subscriptions: vscode.Disposable[];
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
    this.#subscriptions = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.#onChange(event);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.#documents.delete(document.uri.toString());
      }),
    ];
  }

  /** The tokenised view of `document`, building it on first use. */
  get(document: vscode.TextDocument): TokenizedDocument {
    const key = document.uri.toString();
    const existing = this.#documents.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = new TokenizedDocument(document.getText());
    this.#documents.set(key, fresh);
    return fresh;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    this.#documents.clear();
  }

  #onChange(event: vscode.TextDocumentChangeEvent): void {
    if (!isSupported(event.document.languageId) || event.contentChanges.length === 0) {
      return;
    }
    const key = event.document.uri.toString();
    const tracked = this.#documents.get(key);
    if (tracked === undefined) {
      return;
    }

    // Every range in the event refers to the document as it was before any of
    // them applied, so they have to go in descending order.
    const changes = [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
    for (const change of changes) {
      tracked.applyChange(toTextChange(change));
    }

    if (tracked.length !== documentLength(event.document)) {
      this.#logger.warn("tokenised document drifted from the editor; rebuilding", {
        uri: key,
      });
      this.#documents.set(key, new TokenizedDocument(event.document.getText()));
    }
  }
}

function toTextChange(change: vscode.TextDocumentContentChangeEvent): TextChange {
  return {
    start: { line: change.range.start.line, character: change.range.start.character },
    end: { line: change.range.end.line, character: change.range.end.character },
    text: change.text,
  };
}

/** Length in characters, without materialising the whole text. */
function documentLength(document: vscode.TextDocument): number {
  const last = document.lineAt(document.lineCount - 1);
  return document.offsetAt(last.range.end);
}
