// `@emos/api-contract/bridge`: the zod-free surface for webviews — the host <-> webview
// protocol types, the error codes and ApiError. Nothing here may import zod at runtime
// (bridge-entry.test.ts checks); ServerEvent is re-exported as a type only.
export * from "./bridge.js";
export * from "./errors.js";
export type { ServerEvent } from "./events.js";
