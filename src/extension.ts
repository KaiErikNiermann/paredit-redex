import * as vscode from "vscode";
import { createLogger } from "./logger";
import { CheatSheetPanel } from "./vscode/cheatsheet-panel";
import { registerCommands } from "./vscode/commands";
import { DocumentStore } from "./vscode/document-store";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Paredit", { log: true });
  const logger = createLogger(output);
  const store = new DocumentStore(logger);
  const cheatSheet = new CheatSheetPanel();

  context.subscriptions.push(
    output,
    store,
    cheatSheet,
    ...registerCommands(store, cheatSheet, logger),
  );
  logger.info("paredit-redex activated");
}

export function deactivate(): void {
  // no-op
}
