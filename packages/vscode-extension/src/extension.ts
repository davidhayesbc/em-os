import * as vscode from "vscode";
import { AttentionQueue, isSnapshotStale, type QueueChange, type QueueItem, type QueueSnapshot, syntheticOfflineSnapshot } from "./attentionQueue";

const STATE_KEY = "em-os.attentionQueue.v1";

type QueueNode = { kind: "status"; id: string; label: string; detail: string; warning?: boolean } | { kind: "item"; item: QueueItem };

class QueueProvider implements vscode.TreeDataProvider<QueueNode> {
  private readonly changed = new vscode.EventEmitter<QueueNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private queue: AttentionQueue) {}

  setQueue(queue: AttentionQueue): void {
    this.queue = queue;
    this.changed.fire(undefined);
  }

  getQueue(): AttentionQueue { return this.queue; }

  getChildren(): QueueNode[] {
    const snapshot = this.queue.snapshot;
    const freshness = isSnapshotStale(snapshot, new Date())
      ? "STALE — cached data is not current"
      : `Current as of ${snapshot.lastSyncAt ?? snapshot.generatedAt}`;
    return [
      { kind: "status", id: "freshness", label: freshness, detail: `Snapshot generated ${snapshot.generatedAt}`, warning: freshness.startsWith("STALE") },
      { kind: "status", id: "sync", label: snapshot.syncError ? "Sync failed / offline" : "Sync available", detail: snapshot.syncError ?? `Last sync ${snapshot.lastSyncAt ?? "never"}`, warning: Boolean(snapshot.syncError) },
      { kind: "status", id: "permissions", label: "Source permissions", detail: snapshot.permissionNotice, warning: true },
      ...this.queue.visible(new Date()).map((item): QueueNode => ({ kind: "item", item })),
    ];
  }

  getTreeItem(node: QueueNode): vscode.TreeItem {
    if (node.kind === "status") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.id = `em-os.status.${node.id}`;
      item.description = node.detail;
      item.tooltip = `${node.label}\n${node.detail}`;
      item.iconPath = new vscode.ThemeIcon(node.warning ? "warning" : "info");
      item.accessibilityInformation = { label: `${node.label}. ${node.detail}`, role: "treeitem" };
      return item;
    }

    const data = node.item;
    const item = new vscode.TreeItem(data.title, vscode.TreeItemCollapsibleState.None);
    item.id = `em-os.item.${data.id}`;
    item.description = `${data.freshness.toUpperCase()} · ${data.status}${data.dueAt ? ` · due ${data.dueAt}` : ""}`;
    item.tooltip = new vscode.MarkdownString([
      `**${data.freshness === "stale" ? "STALE — not current" : "Current"}**`,
      `Status: ${data.status}`,
      data.dueAt ? `Due: ${data.dueAt}` : "Due: not set",
      `Why: ${data.rationale}`,
      `Provenance: ${data.provenance}`,
      `Observed: ${data.observedAt}`,
      `Source: ${data.sourceLabel}`,
    ].join("\n\n"));
    item.iconPath = new vscode.ThemeIcon(data.freshness === "stale" ? "warning" : "circle-large-outline");
    item.contextValue = `em-os.queueItem.${data.status}`;
    item.command = { command: "em-os.openSource", title: "Open source", arguments: [node] };
    item.accessibilityInformation = {
      label: `${data.title}. ${data.freshness}. ${data.status}. ${data.rationale}. ${data.dueAt ? `Due ${data.dueAt}` : "No due date"}. Source ${data.sourceLabel}`,
      role: "treeitem",
    };
    return item;
  }
}

function isQueueNode(value: unknown): value is Extract<QueueNode, { kind: "item" }> {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "item");
}

export function activate(context: vscode.ExtensionContext): void {
  const stored = context.globalState.get<QueueSnapshot>(STATE_KEY);
  const provider = new QueueProvider(new AttentionQueue(stored ?? syntheticOfflineSnapshot(new Date())));
  const view = vscode.window.createTreeView("em-os.attention", { treeDataProvider: provider, showCollapseAll: false });
  context.subscriptions.push(view);

  const save = async (queue: AttentionQueue): Promise<void> => {
    provider.setQueue(queue);
    await context.globalState.update(STATE_KEY, queue.snapshot);
  };

  const mutate = async (change: QueueChange): Promise<void> => {
    try {
      await save(provider.getQueue().change(change));
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseItem = async (value: unknown, title: string): Promise<QueueItem | undefined> => {
    if (isQueueNode(value)) return value.item;
    const picked = await vscode.window.showQuickPick(provider.getQueue().visible(new Date()).map((item) => ({
      label: `${item.freshness === "stale" ? "$(warning) STALE: " : ""}${item.title}`,
      description: item.status,
      detail: `${item.rationale} · ${item.provenance}`,
      item,
    })), { title, placeHolder: "Choose an attention item", matchOnDetail: true });
    return picked?.item;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("em-os.sync", async () => {
      const now = new Date();
      const snapshot = syntheticOfflineSnapshot(now);
      await save(new AttentionQueue(snapshot));
      await view.reveal(provider.getChildren()[0]!, { focus: true, select: true });
      await vscode.window.showWarningMessage(snapshot.syncError ?? "Sync completed");
    }),
    vscode.commands.registerCommand("em-os.openInbox", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.em-os");
      const first = provider.getChildren()[0];
      if (first) await view.reveal(first, { focus: true, select: true });
    }),
    vscode.commands.registerCommand("em-os.whatNext", async () => {
      const items = provider.getQueue().visible(new Date());
      const selected = await vscode.window.showQuickPick(items.map((item) => ({
        label: `${item.freshness === "stale" ? "$(warning) STALE: " : ""}${item.title}`,
        description: item.dueAt ? `Due ${item.dueAt}` : "No due date",
        detail: `${item.rationale} · ${item.provenance}`,
        item,
      })), { title: "EM OS: What Next", placeHolder: "Choose an item; cached items are explicitly marked stale", matchOnDetail: true });
      if (selected) await provider.getQueue().openSource(selected.item.id, { open: async (url) => { await vscode.env.openExternal(vscode.Uri.parse(url)); } });
    }),
    vscode.commands.registerCommand("em-os.openSource", async (node: unknown) => {
      const item = await chooseItem(node, "EM OS: Open Source");
      if (item) await provider.getQueue().openSource(item.id, { open: async (url) => { await vscode.env.openExternal(vscode.Uri.parse(url)); } });
    }),
    vscode.commands.registerCommand("em-os.confirm", async (node: unknown) => {
      const item = await chooseItem(node, "EM OS: Confirm Action");
      if (item) await mutate({ type: "confirm", id: item.id });
    }),
    vscode.commands.registerCommand("em-os.complete", async (node: unknown) => {
      const item = await chooseItem(node, "EM OS: Complete Action");
      if (item) await mutate({ type: "complete", id: item.id });
    }),
    vscode.commands.registerCommand("em-os.snooze", async (node: unknown) => {
      const item = await chooseItem(node, "EM OS: Snooze Action");
      if (!item) return;
      const choice = await vscode.window.showQuickPick([
        { label: "Tomorrow", hours: 24 }, { label: "Next week", hours: 168 },
      ], { title: `Snooze ${item.title}` });
      if (choice) await mutate({ type: "snooze", id: item.id, until: new Date(Date.now() + choice.hours * 3_600_000).toISOString() });
    }),
    vscode.commands.registerCommand("em-os.captureEvidence", async () => {
      const observation = await vscode.window.showInputBox({ title: "EM OS: Capture Evidence", prompt: "Describe a synthetic or locally approved observation. It remains proposed until reviewed.", ignoreFocusOut: true });
      if (!observation) return;
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content: `# Proposed evidence\n\nStatus: proposed (not approved)\nSource: add a permitted source before approval\n\nObservation: ${observation}\n` });
      await vscode.window.showTextDocument(document);
    }),
    vscode.commands.registerCommand("em-os.draftWeeklyUpdate", async () => {
      const snapshot = provider.getQueue().snapshot;
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content: `# Weekly update — draft\n\n> Offline synthetic prototype. Review manually; do not send as-is.\n> Freshness: ${isSnapshotStale(snapshot, new Date()) ? "STALE — cached inputs are not current" : snapshot.generatedAt}\n\n## Verified inputs\n\nNo approved facts are available. No claims were generated.\n` });
      await vscode.window.showTextDocument(document);
    }),
  );
}

export function deactivate(): void {}
