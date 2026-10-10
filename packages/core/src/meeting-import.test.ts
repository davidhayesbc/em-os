import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalMeetingNoteImportAdapter, MeetingReviewQueue } from "./meeting-import.js";

const NOW = "2026-10-09T12:00:00.000Z";
const REVIEWED = "2026-10-09T13:00:00.000Z";

async function fixture(note: string) {
  const root = await mkdtemp(join(tmpdir(), "em-os-meeting-"));
  const path = join(root, "planning.synthetic.md");
  await writeFile(path, note, "utf8");
  const queue = new MeetingReviewQueue();
  const adapter = new LocalMeetingNoteImportAdapter({ approvedRoots: [root], queue });
  return { root, path, queue, adapter };
}

test("synthetic local note creates only proposed anchored records and retains no transcript", async () => {
  const note = [
    "# Synthetic planning",
    "- ACTION: [owner=Manager; due=2026-10-12] Review launch checklist",
    "- DECISION: Use the staged rollout for the synthetic service",
    "- EVIDENCE: [subject=Person A] Documented the rollback plan",
    "Private discussion that is not a proposal",
  ].join("\n");
  const { adapter, path, queue } = await fixture(note);
  const result = await adapter.importFile(path, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual({ imported: result.summary.imported, retained: result.summary.retainedRawTranscript }, { imported: 3, retained: false });
  const items = queue.list();
  assert.deepEqual(items.map((item) => item.state), ["proposed", "proposed", "proposed"]);
  assert.deepEqual(items.map((item) => item.source.anchor), ["L2", "L3", "L4"]);
  assert.ok(items.every((item) => item.source.documentUri.startsWith("file://") && item.source.quote.length > 0));
  assert.ok(!JSON.stringify(items).includes("Private discussion"));
});

test("missing quote or document anchor is rejected before entering review queue", () => {
  const queue = new MeetingReviewQueue();
  assert.throws(() => queue.enqueue({
    kind: "decision", text: "Use a synthetic rollout",
    source: { documentId: "doc", documentTitle: "note.md", documentUri: "file:///note.md", anchor: "", quote: "" },
  }, NOW), /quote and document anchor/);
  assert.equal(queue.list().length, 0);
});

test("edits preserve immutable source links and anchors", () => {
  const queue = new MeetingReviewQueue();
  const created = queue.enqueue({
    kind: "action", text: "Review launch checklist", owner: "Manager",
    source: { documentId: "doc", documentTitle: "note.md", documentUri: "file:///note.md", anchor: "L8", quote: "- ACTION: Review launch checklist" },
  }, NOW);
  const edited = queue.edit(created.id, { text: "Review the revised launch checklist", dueAt: "2026-10-12" });
  assert.deepEqual(edited.source, created.source);
  assert.equal(edited.state, "proposed");
  const accepted = queue.accept(created.id, "Manager", "Confirmed in review", REVIEWED);
  assert.equal(accepted.state, "approved");
  assert.deepEqual(accepted.source, created.source);
  assert.throws(() => queue.edit(created.id, { text: "change after approval" }), /immutable/);
});

test("similar proposals require an explicit audited manager merge-or-separate decision", () => {
  const queue = new MeetingReviewQueue();
  const source = (anchor: string) => ({ documentId: "doc", documentTitle: "note.md", documentUri: "file:///note.md", anchor, quote: `ACTION ${anchor}` });
  queue.enqueue({ kind: "action", text: "Review the launch readiness checklist", source: source("L1") }, NOW);
  const duplicate = queue.enqueue({ kind: "action", text: "Review launch readiness checklist with team", source: source("L2") }, NOW);
  assert.equal(duplicate.duplicateSuggestion?.decision, "manager-required");
  assert.throws(() => queue.accept(duplicate.id, "Manager", "Looks right", REVIEWED), /manager must decide/);
  assert.throws(() => queue.decideDuplicate(duplicate.id, "separate", { identity: "  ", role: "manager" }), /identity is required/);
  assert.throws(() => queue.decideDuplicate(duplicate.id, "separate", { identity: "person-1", role: "contributor" }), /requires a manager actor/);
  assert.equal(queue.get(duplicate.id)?.duplicateSuggestion?.decision, "manager-required");
  const resolved = queue.decideDuplicate(duplicate.id, "separate", { identity: "manager-42", role: "manager" });
  assert.deepEqual(resolved.duplicateDecisionActor, { identity: "manager-42", role: "manager" });
  const accepted = queue.accept(duplicate.id, "Manager", "Separate commitments", REVIEWED);
  assert.equal(accepted.state, "approved");
  assert.deepEqual(accepted.duplicateDecisionActor, { identity: "manager-42", role: "manager" });
});

test("manager-selected merge links the duplicate while retaining both source anchors", () => {
  const queue = new MeetingReviewQueue();
  const first = queue.enqueue({
    kind: "decision", text: "Use a staged rollout for launch",
    source: { documentId: "doc-a", documentTitle: "a.md", documentUri: "file:///a.md", anchor: "L2", quote: "DECISION: Use a staged rollout for launch" },
  }, NOW);
  const duplicate = queue.enqueue({
    kind: "decision", text: "Use the staged rollout for the launch",
    source: { documentId: "doc-b", documentTitle: "b.md", documentUri: "file:///b.md", anchor: "L9", quote: "DECISION: Use the staged rollout for the launch" },
  }, NOW);
  const linked = queue.decideDuplicate(duplicate.id, "merge", { identity: "manager-7", role: "manager" });
  assert.equal(linked.mergedIntoProposalId, first.id);
  assert.deepEqual(linked.duplicateDecisionActor, { identity: "manager-7", role: "manager" });
  assert.equal(queue.accept(duplicate.id, "Manager", "Same decision", REVIEWED).state, "approved");
  assert.deepEqual(queue.get(first.id)?.source, first.source);
  assert.deepEqual(queue.get(duplicate.id)?.source, duplicate.source);
});

test("rejection remains terminal and records reviewer rationale", () => {
  const queue = new MeetingReviewQueue();
  const proposal = queue.enqueue({
    kind: "evidence", text: "Drafted a synthetic plan",
    source: { documentId: "doc", documentTitle: "note.md", documentUri: "file:///note.md", anchor: "L4", quote: "EVIDENCE: Drafted a synthetic plan" },
  }, NOW);
  const rejected = queue.reject(proposal.id, "Manager", "Not evidence", REVIEWED);
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.reviewReason, "Not evidence");
  assert.throws(() => queue.accept(proposal.id, "Manager", "Changed mind", REVIEWED), /immutable/);
});

test("sensitive text is redacted from proposal fields and bounded source quote", async () => {
  const { adapter, path, queue } = await fixture("- ACTION: [owner=person@example.test] Rotate token=secret-value and contact person@example.test");
  const result = await adapter.importFile(path, NOW);
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(queue.list());
  assert.ok(serialized.includes("[REDACTED_SECRET]"));
  assert.ok(serialized.includes("[REDACTED_EMAIL]"));
  assert.ok(!serialized.includes("secret-value"));
  assert.ok(!serialized.includes("person@example.test"));
});

test("approved roots and imported files use the same canonical namespace", async () => {
  const lexicalRoot = join(tmpdir(), "em-os-lexical-root");
  const lexicalFile = join(lexicalRoot, "planning.synthetic.md");
  const canonicalRoot = join(tmpdir(), "em-os-canonical-root");
  const canonicalFile = join(canonicalRoot, "planning.synthetic.md");
  const queue = new MeetingReviewQueue();
  const resolved = new Map([[lexicalRoot, canonicalRoot], [lexicalFile, canonicalFile]]);
  const adapter = new LocalMeetingNoteImportAdapter({
    approvedRoots: [lexicalRoot],
    queue,
    resolveRealPath: async (path) => resolved.get(path) ?? path,
    readText: async (path) => {
      assert.equal(path, canonicalFile);
      return "- ACTION: Import through a canonicalized approved root";
    },
  });

  const result = await adapter.importFile(lexicalFile, NOW);
  assert.equal(result.ok, true);
  assert.equal(queue.list().length, 1);
});

test("unapproved paths and permission or offline failures are safe and queue nothing", async () => {
  const { root, path } = await fixture("- ACTION: Safe synthetic action");
  const outsideRoot = join(root, "other");
  await mkdir(outsideRoot);
  const outsideQueue = new MeetingReviewQueue();
  const outside = new LocalMeetingNoteImportAdapter({ approvedRoots: [outsideRoot], queue: outsideQueue });
  const denied = await outside.importFile(path, NOW);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "not-approved");
  assert.equal(outsideQueue.list().length, 0);

  for (const failure of [{ code: "EACCES", expected: "permission-denied" }, { code: "OFFLINE", expected: "offline" }] as const) {
    const queue = new MeetingReviewQueue();
    const adapter = new LocalMeetingNoteImportAdapter({
      approvedRoots: [root], queue, resolveRealPath: async () => path,
      readText: async () => { throw Object.assign(new Error("synthetic failure"), { code: failure.code }); },
    });
    const result = await adapter.importFile(path, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, failure.expected);
    assert.equal(queue.list().length, 0);
  }
});

test("notes without extractable anchored markers fail without retaining content", async () => {
  const { adapter, path, queue } = await fixture("General discussion only\nNo structured proposal here");
  const result = await adapter.importFile(path, NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid-note");
  assert.equal(queue.list().length, 0);
});
