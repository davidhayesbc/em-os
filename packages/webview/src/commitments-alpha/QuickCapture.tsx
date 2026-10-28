import type { OpOutput, Person } from "@emos/api-contract";
import { useCallback, useRef, useState } from "preact/hooks";
import { rpc } from "../bridge.js";

export interface QuickCaptureProps {
  onCreated: () => void;
}

type CaptureResult = OpOutput<"commitments.quickCapture">;

export function QuickCapture({ onCreated }: QuickCaptureProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const submit = useCallback(
    async (counterpartId?: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      try {
        const capture = await rpc("commitments.quickCapture", { text, counterpartId });
        if (capture.status === "created") {
          setText("");
          setResult(null);
          setSelectedPersonId(null);
          onCreated();
        } else {
          setResult(capture);
          if (capture.status === "needs_person") setSelectedPersonId(null);
        }
      } catch (e) {
        setResult({
          status: "invalid",
          message: e instanceof Error ? e.message : "Request failed",
        });
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [text, onCreated],
  );

  const onSelectCandidate = useCallback((person: Person) => {
    setSelectedPersonId(person.id);
    // No write happens here; the user must still press Submit.
  }, []);

  const onTextInput = useCallback((value: string) => {
    setText(value);
    // The candidate list and any explicit selection belong to the previous text;
    // invalidate them so the next submission is resolved against the current text.
    setResult(null);
    setSelectedPersonId(null);
  }, []);

  return (
    <section class="commitments-quick-capture" aria-labelledby="quick-capture-title">
      <h2 id="quick-capture-title" class="commitments-heading">
        Quick capture
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(selectedPersonId ?? undefined);
        }}
      >
        <div class="commitments-field-row">
          <input
            type="text"
            aria-label="New commitment"
            placeholder="Send report @Sam !fri"
            value={text}
            disabled={pending}
            onInput={(e) => onTextInput(e.currentTarget.value)}
          />
          <button type="submit" disabled={pending || !text.trim()} aria-busy={pending}>
            Capture
          </button>
        </div>
      </form>

      <p class="commitments-syntax">
        Use <code>@person</code> and <code>!date</code> (<code>!mon</code>, <code>!+3d</code>,{" "}
        <code>!2026-11-04</code>). Start with <code>wait</code> for commitments owed to you.
      </p>

      {result?.status === "invalid" && (
        <p role="alert" class="commitments-error">
          {result.message}
        </p>
      )}

      {result?.status === "needs_person" && (
        <fieldset aria-label="Choose a person" class="commitments-candidates">
          <p class="commitments-hint">Multiple people match. Choose one, then submit again.</p>
          <ul class="commitments-candidate-list">
            {result.candidates.length === 0 ? (
              <li class="commitments-candidate-none">
                No matching person. Add them in People first.
              </li>
            ) : (
              result.candidates.map((person: Person) => (
                <li key={person.id}>
                  <label class="commitments-candidate-label">
                    <input
                      type="radio"
                      name="counterpart"
                      value={person.id}
                      checked={selectedPersonId === person.id}
                      onChange={() => onSelectCandidate(person)}
                      disabled={pending}
                    />
                    {person.displayName}
                  </label>
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setSelectedPersonId(null);
            }}
            disabled={pending}
          >
            Cancel
          </button>
        </fieldset>
      )}
    </section>
  );
}
