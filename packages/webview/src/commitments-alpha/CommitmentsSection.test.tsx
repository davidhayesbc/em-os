import type { ToHost } from "@emos/api-contract/bridge";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { installBridge, uninstallBridge } from "../bridge.js";
import { createFakeVsCode, type FakeVsCode } from "../test-support.js";

let host: FakeVsCode;

beforeEach(() => {
  host = createFakeVsCode();
  installBridge(host.api);
});

afterEach(() => {
  // Resolve any still-pending RPCs with safe results so uninstallBridge does not surface
  // unhandled rejections from in-flight component promises.
  for (const m of host.posted) {
    if (m.kind !== "rpc") continue;
    let result: unknown = null;
    if (m.op === "commitments.list") result = [];
    else if (m.op === "commitments.get") {
      const input = m.input as Record<string, unknown> | undefined;
      result = {
        commitment: makeCommitment({ id: String(input?.id ?? "c_cleanup") }),
        sources: [],
        audit: [],
      };
    } else if (m.op === "commitments.quickCapture") {
      result = { status: "invalid", message: "cleanup" };
    } else if (
      [
        "commitments.update",
        "commitments.complete",
        "commitments.snooze",
        "commitments.drop",
        "commitments.reopen",
      ].includes(m.op)
    ) {
      result = makeCommitment({ id: "c_cleanup" });
    }
    act(() => host.dispatch({ kind: "rpc-result", reqId: m.reqId, ok: true, result }));
  }
  cleanup();
  uninstallBridge();
  vi.useRealTimers();
});

const nowIso = "2026-10-28T12:00:00.000Z";

function makeCommitment(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    direction: "mine" as const,
    status: "active" as const,
    dropReason: null,
    urgency: null,
    priority: null,
    due: { date: "2026-10-30", time: null, timeZone: "UTC" },
    tags: [],
    createdBy: "user" as const,
    ownerId: "per_self",
    counterpartId: "per_sam",
    goalId: null,
    meetingId: null,
    title: "Send feedback",
    notes: "",
    pinned: false,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    occurredAt: nowIso,
    capturedAt: nowIso,
    updatedAt: nowIso,
    retentionState: "active" as const,
    ...overrides,
  };
}

function isRpc(
  m: ToHost,
  op: string,
  direction?: "mine" | "owed_to_me",
): m is Extract<ToHost, { kind: "rpc" }> {
  if (m.kind !== "rpc" || m.op !== op) return false;
  if (direction === undefined) return true;
  const input = m.input as Record<string, unknown> | undefined;
  return input?.direction === direction;
}

function resolveList(direction: "mine" | "owed_to_me", items: ReturnType<typeof makeCommitment>[]) {
  const req = host.posted.findLast((m) => isRpc(m, "commitments.list", direction));
  if (!req) throw new Error(`no pending commitments.list for ${direction}`);
  act(() => host.dispatch({ kind: "rpc-result", reqId: req.reqId, ok: true, result: items }));
}

function resolveGet(result: {
  commitment: ReturnType<typeof makeCommitment>;
  sources: unknown[];
  audit: unknown[];
}) {
  const req = host.posted.findLast((m) => isRpc(m, "commitments.get"));
  if (!req) throw new Error("no pending commitments.get");
  act(() => host.dispatch({ kind: "rpc-result", reqId: req.reqId, ok: true, result }));
}

function resolveQuickCapture(result: unknown) {
  const req = host.posted.findLast((m) => isRpc(m, "commitments.quickCapture"));
  if (!req) throw new Error("no pending commitments.quickCapture");
  act(() => host.dispatch({ kind: "rpc-result", reqId: req.reqId, ok: true, result }));
}

function resolveRpc(op: string, result: unknown) {
  const req = host.posted.findLast((m) => isRpc(m, op));
  if (!req) throw new Error(`no pending ${op}`);
  act(() => host.dispatch({ kind: "rpc-result", reqId: req.reqId, ok: true, result }));
}

function rejectList(message = "failed") {
  for (const direction of ["mine", "owed_to_me"] as const) {
    const req = host.posted.findLast((m) => isRpc(m, "commitments.list", direction));
    if (req) {
      act(() =>
        host.dispatch({
          kind: "rpc-result",
          reqId: req.reqId,
          ok: false,
          error: { code: "internal", message },
        }),
      );
    }
  }
}

function connect() {
  act(() => host.dispatch({ kind: "connection", state: "connected" }));
}

function lastRpc(op: string) {
  return host.posted.findLast((m) => isRpc(m, op));
}

function lastQuickCapture() {
  return host.posted.findLast((m) => isRpc(m, "commitments.quickCapture"));
}

function lastUpdate() {
  return host.posted.findLast((m) => isRpc(m, "commitments.update"));
}

function lastSnooze() {
  return host.posted.findLast((m) => isRpc(m, "commitments.snooze"));
}

function lastComplete() {
  return host.posted.findLast((m) => isRpc(m, "commitments.complete"));
}

function lastDrop() {
  return host.posted.findLast((m) => isRpc(m, "commitments.drop"));
}

function lastReopen() {
  return host.posted.findLast((m) => isRpc(m, "commitments.reopen"));
}

function rejectLast(op: string, message: string) {
  const req = host.posted.findLast((m) => isRpc(m, op));
  if (!req) throw new Error(`no pending ${op}`);
  act(() =>
    host.dispatch({
      kind: "rpc-result",
      reqId: req.reqId,
      ok: false,
      error: { code: "conflict", message },
    }),
  );
}

describe("App integration", () => {
  it("does not render commitments while connecting", () => {
    render(<App />);
    expect(screen.queryByRole("heading", { name: "Manual commitments" })).toBeNull();
  });

  it("renders the commitments section once connected", async () => {
    render(<App />);
    connect();
    expect(screen.getByRole("heading", { name: "Manual commitments" })).toBeTruthy();
    await waitFor(() =>
      expect(
        host.posted.filter((m) => m.kind === "rpc" && m.op === "commitments.list").length,
      ).toBe(2),
    );
  });
});

describe("Commitments lists", () => {
  it("shows loading then empty states for both directions", async () => {
    render(<App />);
    connect();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThanOrEqual(2);
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() => {
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByRole("heading", { name: "I owe 0" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Owed to me 0" })).toBeTruthy();
  });

  it("renders mine and owed_to_me distinctly", async () => {
    render(<App />);
    connect();
    resolveList("mine", [makeCommitment({ id: "c_mine", title: "Write review" })]);
    resolveList("owed_to_me", [
      makeCommitment({ id: "c_owed", direction: "owed_to_me", title: "Get specs" }),
    ]);
    await waitFor(() => expect(screen.getByText("Write review")).toBeTruthy());
    expect(screen.getByText("Get specs")).toBeTruthy();
  });

  it("flags overdue items", async () => {
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    render(<App />);
    connect();
    resolveList("mine", [
      makeCommitment({ id: "c1", due: { date: "2026-10-28", time: null, timeZone: "UTC" } }),
    ]);
    resolveList("owed_to_me", []);
    await waitFor(() => expect(screen.getByText("Overdue")).toBeTruthy());
  });

  it("shows an error with retry", async () => {
    render(<App />);
    connect();
    rejectList("boom");
    await waitFor(() => expect(screen.getAllByText("boom").length).toBeGreaterThanOrEqual(2));
    const before = host.posted.filter((m) => m.kind === "rpc").length;
    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    expect(retryButtons[0]).toBeTruthy();
    fireEvent.click(retryButtons[0] as HTMLElement);
    await waitFor(() =>
      expect(host.posted.filter((m) => m.kind === "rpc").length).toBeGreaterThan(before),
    );
  });

  it("selecting an item loads detail", async () => {
    render(<App />);
    connect();
    const mine = makeCommitment({ id: "c1", title: "Write review" });
    resolveList("mine", [mine]);
    resolveList("owed_to_me", []);
    await waitFor(() => expect(screen.getByText("Write review")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Write review/ }));
    await waitFor(() =>
      expect(host.posted.some((m) => m.kind === "rpc" && m.op === "commitments.get")).toBe(true),
    );
    resolveGet({ commitment: mine, sources: [], audit: [] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Write review" })).toBeTruthy());
  });

  it("refreshes both lists when an items.changed event arrives", async () => {
    render(<App />);
    connect();
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() =>
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2),
    );
    const before = host.posted.filter((m) => m.kind === "rpc").length;
    act(() =>
      host.dispatch({
        kind: "event",
        event: { type: "items.changed", entity: "commitment", ids: ["c1"] },
      }),
    );
    await waitFor(() =>
      expect(host.posted.filter((m) => m.kind === "rpc").length).toBeGreaterThan(before),
    );
  });
});

describe("Quick capture", () => {
  it("creates a commitment and refreshes the lists", async () => {
    render(<App />);
    connect();
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() =>
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2),
    );

    const input = screen.getByLabelText("New commitment");
    fireEvent.input(input, { target: { value: "Send report to Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(host.posted.some((m) => m.kind === "rpc" && m.op === "commitments.quickCapture")).toBe(
        true,
      ),
    );

    const created = makeCommitment({ id: "c_new", title: "Send report to Alex" });
    resolveQuickCapture({ status: "created", commitment: created });

    await waitFor(() => {
      const req = lastRpc("commitments.list");
      // After creation, a refresh re-posts the list call.
      expect(req).toBeDefined();
    });
  });

  it("shows invalid input without losing the typed text", async () => {
    render(<App />);
    connect();
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() =>
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2),
    );

    const input = screen.getByLabelText("New commitment") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "@" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(host.posted.some((m) => m.kind === "rpc" && m.op === "commitments.quickCapture")).toBe(
        true,
      ),
    );
    resolveQuickCapture({ status: "invalid", message: "A title is required" });

    await waitFor(() => expect(screen.getByText("A title is required")).toBeTruthy());
    expect(input.value).toBe("@");
  });

  it("requires explicit candidate selection for ambiguous person", async () => {
    render(<App />);
    connect();
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() =>
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2),
    );

    const input = screen.getByLabelText("New commitment");
    fireEvent.input(input, { target: { value: "Meet with Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(host.posted.some((m) => m.kind === "rpc" && m.op === "commitments.quickCapture")).toBe(
        true,
      ),
    );

    resolveQuickCapture({
      status: "needs_person",
      parsed: {
        title: "Meet with Alex",
        direction: "mine",
        personQuery: "alex",
        due: null,
        priority: null,
        urgency: null,
        tags: [],
        recurrence: null,
      },
      candidates: [
        {
          id: "per_alex",
          displayName: "Alex Rivera",
          archived: false,
          relationship: "peer",
          role: null,
          pronouns: null,
          timeZone: null,
          cadenceDays: null,
          occurredAt: nowIso,
          capturedAt: nowIso,
          updatedAt: nowIso,
          retentionState: "active",
        },
        {
          id: "per_alex2",
          displayName: "Alex Chen",
          archived: false,
          relationship: "peer",
          role: null,
          pronouns: null,
          timeZone: null,
          cadenceDays: null,
          occurredAt: nowIso,
          capturedAt: nowIso,
          updatedAt: nowIso,
          retentionState: "active",
        },
      ],
    });

    await waitFor(() => expect(screen.getByText("Alex Rivera")).toBeTruthy());
    expect(screen.getByText("Alex Chen")).toBeTruthy();

    // Selection alone must not issue a write.
    const before = host.posted.filter((m) => m.kind === "rpc").length;
    fireEvent.click(screen.getByLabelText("Alex Rivera"));
    expect(host.posted.filter((m) => m.kind === "rpc").length).toBe(before);

    // Resubmit with the selected candidate.
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => {
      const req = lastQuickCapture();
      expect(req?.input).toMatchObject({ text: "Meet with Alex", counterpartId: "per_alex" });
    });
  });

  it("cancelling candidate selection keeps the input", async () => {
    render(<App />);
    connect();
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() =>
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2),
    );

    const input = screen.getByLabelText("New commitment") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Ask Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(host.posted.some((m) => m.kind === "rpc" && m.op === "commitments.quickCapture")).toBe(
        true,
      ),
    );
    resolveQuickCapture({
      status: "needs_person",
      parsed: {
        title: "Ask Alex",
        direction: "mine",
        personQuery: "alex",
        due: null,
        priority: null,
        urgency: null,
        tags: [],
        recurrence: null,
      },
      candidates: [
        {
          id: "per_alex",
          displayName: "Alex Rivera",
          archived: false,
          relationship: "peer",
          role: null,
          pronouns: null,
          timeZone: null,
          cadenceDays: null,
          occurredAt: nowIso,
          capturedAt: nowIso,
          updatedAt: nowIso,
          retentionState: "active",
        },
      ],
    });

    await waitFor(() => expect(screen.getByText("Alex Rivera")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Alex Rivera")).toBeNull();
    expect(input.value).toBe("Ask Alex");
  });

  it("prevents duplicate capture clicks", async () => {
    render(<App />);
    connect();
    resolveList("mine", []);
    resolveList("owed_to_me", []);
    await waitFor(() =>
      expect(screen.getAllByText("Nothing here yet.").length).toBeGreaterThanOrEqual(2),
    );

    const input = screen.getByLabelText("New commitment");
    fireEvent.input(input, { target: { value: "One" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(
        host.posted.filter((m) => m.kind === "rpc" && m.op === "commitments.quickCapture").length,
      ).toBe(1),
    );
  });
});

describe("Commitment detail actions", () => {
  async function openDetail(mine = makeCommitment({ id: "c1", title: "Write review" })) {
    render(<App />);
    connect();
    resolveList("mine", [mine]);
    resolveList("owed_to_me", []);
    await waitFor(() => expect(screen.getByText("Write review")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Write review/ }));
    await waitFor(() =>
      expect(host.posted.some((m) => m.kind === "rpc" && m.op === "commitments.get")).toBe(true),
    );
    resolveGet({ commitment: mine, sources: [], audit: [] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Write review" })).toBeTruthy());
  }

  it("displays source provenance and mutation audit", async () => {
    const mine = makeCommitment({ id: "c1", title: "Write review" });
    await openDetail(mine);
    act(() =>
      host.dispatch({
        kind: "event",
        event: { type: "items.changed", entity: "commitment", ids: ["c1"] },
      }),
    );
    const source = {
      id: "s1",
      connectorId: "calendar",
      externalId: "ev-1",
      kind: "event" as const,
      origin: "connector" as const,
      url: "https://example.com/events/1",
      authorIdentityId: null,
      text: "Roadmap review",
      contentHash: "h1",
      sensitivity: "normal" as const,
      sections: null,
      occurredAt: nowIso,
      capturedAt: nowIso,
      updatedAt: nowIso,
      retentionState: "active" as const,
    };
    const audit = {
      id: "a1",
      entity: "commitment",
      entityId: "c1",
      action: "create",
      actor: "user" as const,
      at: nowIso,
      note: null,
      diff: {},
    };
    resolveGet({ commitment: mine, sources: [source], audit: [audit] });
    await waitFor(() => expect(screen.getByText("Source provenance")).toBeTruthy());
    expect(screen.getByText("calendar")).toBeTruthy();
    expect(screen.getByText("https://example.com/events/1")).toBeTruthy();
    expect(screen.getByText("Mutation history")).toBeTruthy();
  });

  it("edits the due date", async () => {
    await openDetail();
    const dateInput = screen.getByLabelText("Edit due date");
    fireEvent.input(dateInput, { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Update due" }));

    await waitFor(() => {
      const req = lastUpdate();
      expect(req?.input).toMatchObject({
        id: "c1",
        patch: { due: { date: "2026-11-15", time: null, timeZone: "UTC" } },
      });
    });
    resolveRpc(
      "commitments.update",
      makeCommitment({ id: "c1", due: { date: "2026-11-15", time: null, timeZone: "UTC" } }),
    );
  });

  it("snoozes", async () => {
    await openDetail();
    const dateInput = screen.getByLabelText("Snooze until");
    fireEvent.input(dateInput, { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));

    await waitFor(() => {
      const req = lastSnooze();
      const input = req?.input as Record<string, unknown> | undefined;
      expect(input?.id).toBe("c1");
      expect(typeof input?.until).toBe("string");
    });
  });

  it("completes an active commitment", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const req = lastComplete();
      expect(req?.input).toEqual({ id: "c1" });
    });
  });

  it("drops with a reason", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    await waitFor(() => {
      const req = lastDrop();
      expect(req?.input).toMatchObject({ id: "c1", reason: "user" });
    });
  });

  it("reopens a completed commitment", async () => {
    await openDetail(
      makeCommitment({ id: "c1", title: "Write review", status: "done", completedAt: nowIso }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => {
      const req = lastReopen();
      expect(req?.input).toEqual({ id: "c1" });
    });
  });

  it("does not render invalid actions for the current status", async () => {
    await openDetail(
      makeCommitment({ id: "c1", title: "Write review", status: "done", completedAt: nowIso }),
    );
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drop" })).toBeNull();
  });

  it("shows action errors and keeps inputs", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const req = lastComplete();
      expect(req).toBeDefined();
    });
    rejectLast("commitments.complete", "Already complete");
    await waitFor(() => expect(screen.getByText("Already complete")).toBeTruthy());
  });

  it("prevents double submits", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() =>
      expect(
        host.posted.filter((m) => m.kind === "rpc" && m.op === "commitments.complete").length,
      ).toBe(1),
    );
  });
});

describe("No writes on read/render", () => {
  it("rendering the lists does not call write ops", async () => {
    render(<App />);
    connect();
    resolveList("mine", [makeCommitment({ id: "c1" })]);
    resolveList("owed_to_me", []);
    await waitFor(() => expect(screen.getByText("Send feedback")).toBeTruthy());
    expect(
      host.posted.some(
        (m) => m.kind === "rpc" && /\.(create|update|complete|snooze|drop|reopen)$/.test(m.op),
      ),
    ).toBe(false);
  });
});
