import * as vscode from "vscode";
import { createLogger } from "./logger";
import { registerCommands } from "./vscode/commands";
import { DocumentStore } from "./vscode/document-store";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Paredit", { log: true });
  const logger = createLogger(output);
  const store = new DocumentStore(logger);

  context.subscriptions.push(output, store, ...registerCommands(store, logger));
  logger.info("paredit-redex activated");
}

export function deactivate(): void {
  // no-op
}
