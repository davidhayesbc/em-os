import type { OpOutput } from "@emos/api-contract";
import { useCallback, useEffect, useState } from "preact/hooks";
import { onEvent, rpc } from "../bridge.js";

type Health = OpOutput<"health.get">;

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; health: Health };

/** Whole-unit uptime like `3d 4h`, `2h 5m`, `7m`, `<1m`. */
export function formatUptime(startedAt: string, now: number = Date.now()): string {
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const REFRESH_MS = 30_000;

export function ServiceStatus(_props: { size: { w: number; h: number } }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const refresh = useCallback(() => {
    rpc("health.get", {}).then(
      (health) => setLoad({ status: "ready", health }),
      (e: unknown) =>
        setLoad((prev) =>
          // Keep showing the last good data on a transient failure.
          prev.status === "ready"
            ? prev
            : { status: "error", message: e instanceof Error ? e.message : "request failed" },
        ),
    );
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const off = onEvent((e) => {
      if (e.type === "sync.status") refresh();
    });
    return () => {
      clearInterval(timer);
      off();
    };
  }, [refresh]);

  if (load.status === "loading") return <p class="muted">Loading…</p>;
  if (load.status === "error") {
    return (
      <p role="alert" class="error">
        Could not load service status: {load.message}
      </p>
    );
  }

  const { health } = load;
  return (
    <div class="service-status">
      <dl class="kv">
        <dt>API</dt>
        <dd>API v{health.apiVersion}</dd>
        <dt>Service</dt>
        <dd>{health.serviceVersion}</dd>
        <dt>Uptime</dt>
        <dd>{formatUptime(health.startedAt)}</dd>
      </dl>
      <h3 class="subheading">Connectors</h3>
      {health.connectors.length === 0 ? (
        <p class="muted">No connectors yet</p>
      ) : (
        <ul class="connectors">
          {health.connectors.map((c) => (
            <li key={c.id}>
              <span class="connector-id">{c.id}</span>
              <span class={`badge badge-${c.state}`}>{c.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
