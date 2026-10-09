import * as vscode from "vscode";

const messages: Readonly<Record<string, string>> = {
  "em-os.sync": "EM OS sync is synthetic-only; no network connector is configured.",
  "em-os.openInbox": "EM OS inbox is available through the local CLI scaffold.",
  "em-os.whatNext": "Run the synthetic PR attention demo with npm run demo.",
  "em-os.draftWeeklyUpdate": "Weekly drafting is not configured; no model request was made.",
  "em-os.captureEvidence": "Evidence capture is not configured in the scaffold.",
};

export function activate(context: vscode.ExtensionContext): void {
  for (const [command, message] of Object.entries(messages)) {
    context.subscriptions.push(vscode.commands.registerCommand(command, () => vscode.window.showInformationMessage(message)));
  }
}

export function deactivate(): void {}
