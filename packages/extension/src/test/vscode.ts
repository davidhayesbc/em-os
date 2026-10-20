// A hand-written stand-in for the `vscode` module (aliased in vitest.config.mts). It covers only
// the API surface the extension uses; Electron is never loaded in unit tests.
import { vi } from "vitest";

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  readonly event = (fn: Listener<T>) => {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  };
  fire(e: T): void {
    for (const fn of [...this.listeners]) fn(e);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string,
  ) {}
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...segments].join("/"));
  }
  get path(): string {
    return this.fsPath;
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export enum ViewColumn {
  Active = -1,
  One = 1,
}

export enum ExtensionMode {
  Production = 1,
  Development = 2,
  Test = 3,
}

/** A fake webview: records posted messages and lets a test deliver messages from the page. */
export class FakeWebview {
  html = "";
  options: unknown = {};
  readonly cspSource = "https://csp.example.com";
  readonly posted: unknown[] = [];
  private readonly received = new EventEmitter<unknown>();
  readonly onDidReceiveMessage = this.received.event;
  asWebviewUri(uri: Uri): Uri {
    return Uri.file(`/webview${uri.fsPath}`);
  }
  postMessage(msg: unknown): Promise<boolean> {
    this.posted.push(msg);
    return Promise.resolve(true);
  }
  /** Simulates the page calling `vscode.postMessage(msg)`. */
  deliver(msg: unknown): void {
    this.received.fire(msg);
  }
}

export class FakeWebviewPanel {
  readonly webview = new FakeWebview();
  readonly reveal = vi.fn();
  private readonly disposed = new EventEmitter<void>();
  readonly onDidDispose = this.disposed.event;
  constructor(
    readonly viewType: string,
    readonly title: string,
    readonly showOptions: unknown,
    readonly options: Record<string, unknown>,
  ) {}
  dispose(): void {
    this.disposed.fire();
  }
}

export class FakeWebviewView {
  readonly webview = new FakeWebview();
  private readonly disposed = new EventEmitter<void>();
  readonly onDidDispose = this.disposed.event;
  dispose(): void {
    this.disposed.fire();
  }
}

const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  registerCommand: vi.fn((id: string, fn: (...args: unknown[]) => unknown) => {
    commandHandlers.set(id, fn);
    return { dispose: () => commandHandlers.delete(id) };
  }),
  executeCommand: vi.fn(async (id: string, ...args: unknown[]) =>
    commandHandlers.get(id)?.(...args),
  ),
};

export const window = {
  createWebviewPanel: vi.fn(
    (viewType: string, title: string, showOptions: unknown, options: Record<string, unknown>) =>
      new FakeWebviewPanel(viewType, title, showOptions, options),
  ),
  registerWebviewViewProvider: vi.fn((_id: string, _provider: unknown) => ({ dispose() {} })),
  showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
};

/** Clears recorded calls and registered commands between tests. */
export function resetMock(): void {
  commandHandlers.clear();
  commands.registerCommand.mockClear();
  commands.executeCommand.mockClear();
  window.createWebviewPanel.mockClear();
  window.registerWebviewViewProvider.mockClear();
  window.showErrorMessage.mockClear();
}
