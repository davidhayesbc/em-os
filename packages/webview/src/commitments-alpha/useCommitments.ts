import type { AuditEvent, Commitment, SourceItem } from "@emos/api-contract";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { onEvent, rpc } from "../bridge.js";

type CommitmentsLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; mine: Commitment[]; owedToMe: Commitment[] };

export function useCommitments(): [CommitmentsLoad, () => void] {
  const [load, setLoad] = useState<CommitmentsLoad>({ status: "loading" });
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    const generation = ++generationRef.current;
    setLoad({ status: "loading" });
    Promise.all([
      rpc("commitments.list", {
        direction: "mine",
        status: ["proposed", "active", "snoozed", "done", "dropped"],
      }),
      rpc("commitments.list", {
        direction: "owed_to_me",
        status: ["proposed", "active", "snoozed", "done", "dropped"],
      }),
    ]).then(
      ([mine, owedToMe]) => {
        if (generation === generationRef.current) {
          setLoad({ status: "ready", mine, owedToMe });
        }
      },
      (e: unknown) => {
        if (generation === generationRef.current) {
          setLoad({
            status: "error",
            message: e instanceof Error ? e.message : "Could not load commitments",
          });
        }
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    const off = onEvent((e) => {
      if (e.type === "items.changed" && e.entity === "commitment") refresh();
    });
    return () => {
      off();
      ++generationRef.current;
    };
  }, [refresh]);

  return [load, refresh];
}

type DetailLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; commitment: Commitment; sources: SourceItem[]; audit: AuditEvent[] };

export function useCommitment(id: string | null): [DetailLoad, () => void] {
  const [load, setLoad] = useState<DetailLoad>({ status: "loading" });
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    if (!id) return;
    const generation = ++generationRef.current;
    setLoad({ status: "loading" });
    rpc("commitments.get", { id }).then(
      ({ commitment, sources, audit }) => {
        if (generation === generationRef.current) {
          setLoad({ status: "ready", commitment, sources, audit });
        }
      },
      (e: unknown) => {
        if (generation === generationRef.current) {
          setLoad({
            status: "error",
            message: e instanceof Error ? e.message : "Could not load commitment",
          });
        }
      },
    );
  }, [id]);

  useEffect(() => {
    refresh();
    const off = onEvent((e) => {
      if (e.type === "items.changed" && e.entity === "commitment" && e.ids.includes(id ?? ""))
        refresh();
    });
    return () => {
      off();
      ++generationRef.current;
    };
  }, [id, refresh]);

  return [load, refresh];
}
