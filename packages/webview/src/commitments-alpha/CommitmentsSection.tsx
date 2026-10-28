import { useCallback, useState } from "preact/hooks";
import { useConnection } from "../bridge.js";
import { CommitmentDetail } from "./CommitmentDetail.js";
import { CommitmentList } from "./CommitmentList.js";
import { QuickCapture } from "./QuickCapture.js";
import { useCommitments } from "./useCommitments.js";

export function CommitmentsSection() {
  const connection = useConnection();
  const [load, refresh] = useCommitments();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onCreated = useCallback(() => {
    refresh();
    setSelectedId(null);
  }, [refresh]);

  const onMutated = useCallback(() => {
    refresh();
  }, [refresh]);

  if (connection !== "connected") {
    return null;
  }

  const mine = load.status === "ready" ? load.mine : undefined;
  const owedToMe = load.status === "ready" ? load.owedToMe : undefined;
  const error = load.status === "error" ? load.message : null;

  return (
    <section class="commitments-alpha" aria-labelledby="commitments-alpha-title">
      <h2 id="commitments-alpha-title" class="commitments-alpha-title">
        Manual commitments
      </h2>

      <QuickCapture onCreated={onCreated} />

      <div class="commitments-lists">
        <CommitmentList
          direction="mine"
          items={mine}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRetry={refresh}
        />
        <CommitmentList
          direction="owed_to_me"
          items={owedToMe}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRetry={refresh}
        />
      </div>

      {selectedId && (
        <CommitmentDetail
          commitmentId={selectedId}
          onMutated={onMutated}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
