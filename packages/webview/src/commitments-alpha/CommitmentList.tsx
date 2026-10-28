import type { Commitment, Direction } from "@emos/api-contract";
import { DIRECTION_LABEL, formatDue, isOverdue, STATUS_LABEL } from "./utils.js";

export interface CommitmentListProps {
  direction: Direction;
  items: Commitment[] | undefined;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function CommitmentList({
  direction,
  items,
  error,
  selectedId,
  onSelect,
  onRetry,
}: CommitmentListProps) {
  const label = DIRECTION_LABEL[direction];

  return (
    <section
      class={`commitments-list commitments-list-${direction}`}
      aria-labelledby={`commitments-list-title-${direction}`}
    >
      <h3 id={`commitments-list-title-${direction}`} class="commitments-list-title">
        {label} {items !== undefined && <span class="commitments-count">{items.length}</span>}
      </h3>

      {error && (
        <div class="commitments-list-error" role="alert">
          <p class="commitments-error">{error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {items === undefined && !error && (
        <p class="commitments-loading" role="status">
          Loading…
        </p>
      )}

      {items !== undefined && items.length === 0 && (
        <p class="commitments-empty" role="status">
          Nothing here yet.
        </p>
      )}

      {items !== undefined && items.length > 0 && (
        <ul class="commitments-items">
          {items.map((c) => {
            const overdue = isOverdue(c.due);
            return (
              <li key={c.id} class="commitments-item">
                <button
                  type="button"
                  class={`commitments-item-button${c.id === selectedId ? " commitments-item-selected" : ""}`}
                  aria-pressed={c.id === selectedId}
                  aria-label={`${c.title}, ${STATUS_LABEL[c.status]}, ${formatDue(c.due)}${overdue ? ", overdue" : ""}`}
                  onClick={() => onSelect(c.id)}
                >
                  <span class="commitments-item-title">{c.title}</span>
                  <span class="commitments-item-meta">
                    <span class={`commitments-status commitments-status-${c.status}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                    {overdue && <span class="commitments-overdue">Overdue</span>}
                    <span class="commitments-due">{formatDue(c.due)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
