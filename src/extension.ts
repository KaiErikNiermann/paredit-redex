import * as vscode from "vscode";
import { createLogger } from "./logger";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Paredit", { log: true });
  const logger = createLogger(output);

  context.subscriptions.push(output);
  logger.info("paredit-redex activated");
}

export function deactivate(): void {
  // no-op
}
