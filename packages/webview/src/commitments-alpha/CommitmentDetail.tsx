import type { CommitmentStatus } from "@emos/api-contract";
import { useCallback, useRef, useState } from "preact/hooks";
import { rpc } from "../bridge.js";
import { useCommitment } from "./useCommitments.js";
import {
  DIRECTION_LABEL,
  DROP_REASON_LABEL,
  formatDiff,
  formatDue,
  formatInstant,
  STATUS_LABEL,
} from "./utils.js";

export interface CommitmentDetailProps {
  commitmentId: string;
  onMutated: () => void;
  onClose: () => void;
}

const ALLOWED_TRANSITIONS: Record<CommitmentStatus, readonly string[]> = {
  proposed: ["complete", "snooze", "drop"],
  active: ["complete", "snooze", "drop", "editDue"],
  snoozed: ["complete", "snooze", "drop", "editDue"],
  done: ["reopen"],
  dropped: ["reopen"],
};

export function CommitmentDetail({ commitmentId, onMutated, onClose }: CommitmentDetailProps) {
  const [load, refresh] = useCommitment(commitmentId);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [snoozeDate, setSnoozeDate] = useState("");
  const [dropReason, setDropReason] = useState<"user" | "stale">("user");
  const pendingRef = useRef<string | null>(null);

  const run = useCallback(
    async (label: string, makePromise: () => Promise<unknown>) => {
      if (pendingRef.current) return;
      pendingRef.current = label;
      setPending(label);
      setActionError(null);
      try {
        await makePromise();
        onMutated();
        refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Request failed");
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [onMutated, refresh],
  );

  if (load.status === "loading")
    return (
      <p class="commitments-loading" role="status">
        Loading…
      </p>
    );
  if (load.status === "error")
    return (
      <div role="alert" class="commitments-error-block">
        <p class="commitments-error">{load.message}</p>
        <button type="button" onClick={refresh}>
          Retry
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    );

  const { commitment, sources, audit } = load;
  const allowed = ALLOWED_TRANSITIONS[commitment.status];

  return (
    <article class="commitment-detail" aria-labelledby="commitment-detail-title">
      <header class="commitment-detail-header">
        <h3 id="commitment-detail-title" class="commitment-detail-title">
          {commitment.title}
        </h3>
        <button type="button" onClick={onClose} aria-label="Close details">
          Close
        </button>
      </header>

      <dl class="commitment-detail-facts">
        <dt>Direction</dt>
        <dd>{DIRECTION_LABEL[commitment.direction]}</dd>
        <dt>Status</dt>
        <dd>{STATUS_LABEL[commitment.status]}</dd>
        <dt>Due</dt>
        <dd>{formatDue(commitment.due)}</dd>
        {commitment.snoozedUntil && (
          <>
            <dt>Snoozed until</dt>
            <dd>{formatInstant(commitment.snoozedUntil)}</dd>
          </>
        )}
        {commitment.completedAt && (
          <>
            <dt>Completed</dt>
            <dd>{formatInstant(commitment.completedAt)}</dd>
          </>
        )}
        {commitment.dropReason && (
          <>
            <dt>Drop reason</dt>
            <dd>{DROP_REASON_LABEL[commitment.dropReason]}</dd>
          </>
        )}
        {commitment.notes && (
          <>
            <dt>Notes</dt>
            <dd class="commitment-notes">{commitment.notes}</dd>
          </>
        )}
      </dl>

      {actionError && (
        <p role="alert" class="commitments-error">
          {actionError}
        </p>
      )}

      <div class="commitment-actions">
        {allowed?.includes("editDue") && (
          <form
            class="commitment-action"
            onSubmit={(e) => {
              e.preventDefault();
              const tz = commitment.due?.timeZone ?? "UTC";
              const patch = dueDate
                ? { due: { date: dueDate, time: null, timeZone: tz } }
                : { due: null };
              void run("editDue", () => rpc("commitments.update", { id: commitment.id, patch }));
            }}
          >
            <label>
              Edit due date
              <input
                type="date"
                value={dueDate}
                onInput={(e) => setDueDate(e.currentTarget.value)}
                disabled={pending === "editDue"}
              />
            </label>
            <button type="submit" disabled={pending === "editDue"}>
              Update due
            </button>
          </form>
        )}

        {allowed?.includes("snooze") && (
          <form
            class="commitment-action"
            onSubmit={(e) => {
              e.preventDefault();
              if (!snoozeDate) return;
              const until = new Date(`${snoozeDate}T23:59:59`).toISOString();
              void run("snooze", () => rpc("commitments.snooze", { id: commitment.id, until }));
            }}
          >
            <label>
              Snooze until
              <input
                type="date"
                value={snoozeDate}
                onInput={(e) => setSnoozeDate(e.currentTarget.value)}
                disabled={pending === "snooze"}
              />
            </label>
            <button type="submit" disabled={pending === "snooze" || !snoozeDate}>
              Snooze
            </button>
          </form>
        )}

        {allowed?.includes("drop") && (
          <form
            class="commitment-action"
            onSubmit={(e) => {
              e.preventDefault();
              void run("drop", () =>
                rpc("commitments.drop", { id: commitment.id, reason: dropReason }),
              );
            }}
          >
            <label>
              Drop reason
              <select
                value={dropReason}
                onChange={(e) => setDropReason(e.currentTarget.value as "user" | "stale")}
                disabled={pending === "drop"}
              >
                <option value="user">I&apos;m dropping this</option>
                <option value="stale">Stale</option>
              </select>
            </label>
            <button type="submit" disabled={pending === "drop"}>
              Drop
            </button>
          </form>
        )}

        {allowed?.includes("complete") && (
          <button
            type="button"
            class="commitment-action"
            onClick={() =>
              void run("complete", () => rpc("commitments.complete", { id: commitment.id }))
            }
            disabled={pending === "complete"}
          >
            Complete
          </button>
        )}

        {allowed?.includes("reopen") && (
          <button
            type="button"
            class="commitment-action"
            onClick={() =>
              void run("reopen", () => rpc("commitments.reopen", { id: commitment.id }))
            }
            disabled={pending === "reopen"}
          >
            Reopen
          </button>
        )}
      </div>

      <section class="commitment-sources" aria-labelledby="commitment-sources-title">
        <h4 id="commitment-sources-title">Source provenance</h4>
        {sources.length === 0 ? (
          <p class="commitments-empty">No stored sources.</p>
        ) : (
          <ul class="commitment-source-list">
            {sources.map((s) => (
              <li key={s.id}>
                <span class="commitment-source-kind">{s.kind}</span>
                <span class="commitment-source-connector">{s.connectorId}</span>
                {s.url && <span class="commitment-source-url">{s.url}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="commitment-audit" aria-labelledby="commitment-audit-title">
        <h4 id="commitment-audit-title">Mutation history</h4>
        {audit.length === 0 ? (
          <p class="commitments-empty">No mutation history yet.</p>
        ) : (
          <ol class="commitment-audit-list">
            {audit.map((a) => (
              <li key={a.id}>
                <span class="commitment-audit-action">{a.action}</span>{" "}
                <span class="commitment-audit-actor">({a.actor})</span>{" "}
                <span class="commitment-audit-time">{formatInstant(a.at)}</span>
                {Object.keys(a.diff).length > 0 && (
                  <span class="commitment-audit-diff">{formatDiff(a.diff)}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
