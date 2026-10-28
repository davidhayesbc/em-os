import { command, useConnection } from "./bridge.js";
import { CommitmentsSection } from "./commitments-alpha/CommitmentsSection.js";
import { WidgetGrid } from "./grid/WidgetGrid.js";

export function App() {
  const connection = useConnection();

  if (connection === "unavailable") {
    return (
      <main class="shell">
        <div role="alert" class="unavailable">
          <h1>Service unavailable</h1>
          <p>EM OS could not reach its local service.</p>
          <button type="button" onClick={() => command("emos.reconnect")}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (connection === "connecting") {
    return (
      <main class="shell">
        <p class="muted" role="status">
          Connecting…
        </p>
      </main>
    );
  }

  return (
    <main class="shell">
      <h1 class="visually-hidden">EM OS dashboard</h1>
      <CommitmentsSection />
      <WidgetGrid />
    </main>
  );
}
