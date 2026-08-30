import type * as vscode from "vscode";

export interface Logger {
  readonly debug: (message: string, metadata?: Record<string, unknown>) => void;
  readonly error: (message: string, metadata?: Record<string, unknown>) => void;
  readonly info: (message: string, metadata?: Record<string, unknown>) => void;
  readonly warn: (message: string, metadata?: Record<string, unknown>) => void;
}

function formatMessage(
  message: string,
  metadata?: Record<string, unknown>,
): string {
  if (metadata === undefined || Object.keys(metadata).length === 0) {
    return message;
  }
  return `${message} ${JSON.stringify(metadata)}`;
}

export function createLogger(channel: vscode.LogOutputChannel): Logger {
  return {
    debug: (message, metadata) => {
      channel.debug(formatMessage(message, metadata));
    },
    error: (message, metadata) => {
      channel.error(formatMessage(message, metadata));
    },
    info: (message, metadata) => {
      channel.info(formatMessage(message, metadata));
    },
    warn: (message, metadata) => {
      channel.warn(formatMessage(message, metadata));
    },
  };
}
