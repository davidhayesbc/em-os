// Warns once if a production install is running against the test-only in-memory secret store
// (`EMOS_SECRET_STORE=memory`): nothing is persisted and the token changes on every restart.
import type { OpOutput } from "@emos/api-contract";
import type { ConnectionState, Disposable } from "./connection.js";

export const MEMORY_SECRET_STORE_WARNING =
  "EM OS is using a temporary in-memory secret store (EMOS_SECRET_STORE=memory). Secrets are not saved; unset it for normal use.";

export interface SecretStoreWarningOptions {
  connection: {
    onStateChange(fn: (s: ConnectionState) => void): Disposable;
    call(op: string, input: unknown): Promise<unknown>;
  };
  /** True for `ExtensionMode.Production`; dev and test hosts use the memory store on purpose. */
  production: boolean;
  warn(message: string): void;
}

/** On each connect (until it has warned once), asks `health.get` which secret store is in use. */
export function watchSecretStore(opts: SecretStoreWarningOptions): Disposable {
  if (!opts.production) return { dispose() {} };
  let warned = false;
  let checking = false;
  const sub = opts.connection.onStateChange((state) => {
    if (state !== "connected" || warned || checking) return;
    checking = true;
    opts.connection
      .call("health.get", {})
      .then((h) => {
        if (!warned && (h as Partial<OpOutput<"health.get">>)?.secretStore === "memory") {
          warned = true;
          opts.warn(MEMORY_SECRET_STORE_WARNING);
        }
      })
      .catch(() => undefined) // connection problems are reported elsewhere
      .finally(() => {
        checking = false;
      });
  });
  return { dispose: () => sub.dispose() };
}
