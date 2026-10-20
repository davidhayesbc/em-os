import { command, useConnection } from "./bridge.js";

const LABEL = {
  connecting: "Connecting…",
  connected: "Connected",
  unavailable: "Service unavailable",
} as const;

/** Phase 0 placeholder: connection state plus a way into the dashboard. */
export function Sidebar() {
  const connection = useConnection();
  return (
    <main class="sidebar">
      <p class={`connection connection-${connection}`} role="status">
        {LABEL[connection]}
      </p>
      {connection === "unavailable" && (
        <button type="button" onClick={() => command("emos.reconnect")}>
          Retry
        </button>
      )}
      <button type="button" onClick={() => command("emos.openDashboard")}>
        Open dashboard
      </button>
    </main>
  );
}
