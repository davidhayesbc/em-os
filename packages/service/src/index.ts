// @emos/service: the local EM OS service (ADR 0001). Clients find it through the runtime files
// in `<dataDir>/run/` (see `runtimePaths`) and authenticate with the bearer token there.
export { generateToken, isAllowedHost, TOKEN_KEY, tokensEqual } from "./auth.js";
export {
  DEFAULT_PORT,
  parseArgs,
  type RuntimePaths,
  runtimePaths,
  type ServiceConfig,
  type ServiceInfo,
} from "./config.js";
export type { Handler, ServiceContext } from "./context.js";
export { createEventBus, type EventBus } from "./events.js";
export { handlers } from "./handlers/index.js";
export { AlreadyRunningError, isPidAlive, parseLockPid } from "./lockfile.js";
export {
  createKeychainSecretStore,
  createMemorySecretStore,
  isMemorySecretStore,
} from "./secrets.js";
export {
  createStderrLogger,
  type RunningService,
  type StartServiceOptions,
  startService,
} from "./server.js";
