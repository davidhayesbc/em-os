import assert from "node:assert/strict";
import { test } from "node:test";
import { EvidenceReviewService } from "./review-packets.js";

const base = {
  subjectId: "person-1", competency: ["technical-leadership"], observation: "Led a safe migration", impact: "Reduced deploy failures", context: "During the synthetic release", observedAt: "2026-10-09T09:00:00.000Z", source: { recordId: "source-1", url: "https://example.invalid/pr/1", anchor: "lines 10-12", available: true }, consent: "granted" as const, author: "manager",
};

function approved(service: EvidenceReviewService, id = "e1") {
  service.addEvidence({ ...base, id });
  service.transitionEvidence(id, "approved", "manager", "verified against source", "2026-10-09T10:00:00.000Z");
}

test("evidence starts proposed and only an audited human transition can approve it", () => {
  const service = new EvidenceReviewService();
  const item = service.addEvidence({ ...base, id: "e1" });
  assert.equal(item.status, "proposed");
  assert.throws(() => service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]), /approved evidence/);
  service.transitionEvidence("e1", "approved", "manager", "verified against source", "2026-10-09T10:00:00.000Z");
  assert.equal(service.getAudit().some((event) => event.action === "transition:approved"), true);
});

test("rubric gaps and source-unavailable citations are explicit", () => {
  const service = new EvidenceReviewService();
  approved(service);
  const packet = service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership", "people-development"], suppliedBy: "manager" }, [{ text: "migration claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1", available: false, url: undefined }] }]);
  assert.deepEqual(packet.gaps, ["people-development"]);
  assert.equal(packet.claims[0].citations[0].url, undefined);
  assert.equal(packet.claims[0].citations[0].anchor, "lines 10-12");
});

test("corrections preserve the original and produce an audited superseding record", () => {
  const service = new EvidenceReviewService();
  approved(service);
  const corrected = service.correctEvidence("e1", { ...base, observation: "Led a reviewed migration", source: { ...base.source, anchor: "lines 20-22" } }, "manager");
  assert.equal(corrected.status, "proposed");
  assert.equal(corrected.supersedesId, "e1");
  assert.equal(service.getAudit().some((event) => event.action === "correction"), true);
  assert.equal(service.getAudit().some((event) => event.action === "transition:superseded" && event.entityId === "e1"), true);
});

test("sensitive export requires authorization and explicit sign-off", () => {
  const service = new EvidenceReviewService();
  approved(service);
  service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  assert.throws(() => service.exportSensitive("p1", "manager", false, "2026-10-09T11:00:00.000Z"), /authorization/);
  assert.throws(() => service.exportSensitive("p1", "manager", true, "2026-10-09T11:00:00.000Z"), /sign-off/);
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  const exported = service.exportSensitive("p1", "reviewer", true, "2026-10-09T11:31:00.000Z");
  assert.equal(exported.auditId.startsWith("export:"), true);
  assert.equal(service.getAudit().some((event) => event.action === "export:sensitive"), true);
});

test("deletion propagates to packet references and leaves a tombstone audit", () => {
  const service = new EvidenceReviewService();
  approved(service);
  service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  service.deleteEvidence("e1", "manager", "2026-10-09T12:00:00.000Z");
  assert.throws(() => service.getEvidence("e1"), /deleted/);
  assert.throws(() => service.exportSensitive("p1", "reviewer", true, "2026-10-09T12:01:00.000Z"), /sign-off/);
  assert.equal(service.getAudit().some((event) => event.action === "delete:tombstone"), true);
});

test("deletion invalidates only packets that referenced the evidence", () => {
  const service = new EvidenceReviewService();
  approved(service, "referenced");
  approved(service, "unrelated");
  const rubric = { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" };
  const referenced = service.buildPacket("p-referenced", "person-1", rubric, [{ text: "claim", evidenceIds: ["referenced"], citations: [{ ...base.source, recordId: "referenced" }] }]);
  const unrelated = service.buildPacket("p-unrelated", "person-1", rubric, [{ text: "claim", evidenceIds: ["unrelated"], citations: [{ ...base.source, recordId: "unrelated" }] }]);
  service.signPacket("p-referenced", "reviewer", "2026-10-09T11:30:00.000Z");
  service.signPacket("p-unrelated", "reviewer", "2026-10-09T11:30:00.000Z");

  service.deleteEvidence("referenced", "manager", "2026-10-09T12:00:00.000Z");

  assert.throws(() => service.exportSensitive("p-referenced", "reviewer", true, "2026-10-09T12:01:00.000Z"), /sign-off/);
  const reexported = service.exportSensitive("p-unrelated", "reviewer", true, "2026-10-09T12:01:00.000Z");
  assert.deepEqual(reexported.packet.claims[0].evidenceIds, ["unrelated"]);
});

test("buildPacket does not mutate caller citation objects", () => {
  const service = new EvidenceReviewService();
  approved(service);
  const citation = { ...base.source, recordId: "e1", available: false, url: "https://example.invalid/stale" };
  const claims = [{ text: "claim", evidenceIds: ["e1"], citations: [citation] }];
  const packet = service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, claims);
  assert.equal(citation.url, "https://example.invalid/stale");
  assert.equal(packet.claims[0].citations[0].url, undefined);
});

test("mutating the object returned by buildPacket cannot bypass sign-off or alter exports", () => {
  const service = new EvidenceReviewService();
  approved(service);
  const packet = service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  packet.signed = true;
  packet.reviewer = "attacker";
  packet.signedAt = "2026-10-09T11:30:00.000Z";
  (packet.claims[0].evidenceIds as unknown as string[]) = [];
  (packet.claims[0].citations as unknown as unknown[]) = [];
  assert.throws(() => service.exportSensitive("p1", "attacker", true, "2026-10-09T11:31:00.000Z"), /sign-off/);
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  const exported = service.exportSensitive("p1", "reviewer", true, "2026-10-09T11:31:00.000Z");
  assert.deepEqual(exported.packet.claims[0].evidenceIds, ["e1"]);
  assert.equal(exported.packet.claims[0].citations.length, 1);
});

test("injecting a rejected evidence id into a returned packet must not reach export", () => {
  const service = new EvidenceReviewService();
  approved(service, "e1");
  service.addEvidence({ ...base, id: "e2" });
  service.transitionEvidence("e2", "rejected", "manager", "insufficient", "2026-10-09T10:01:00.000Z");
  const packet = service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  const mutateableIds = packet.claims[0].evidenceIds as unknown as string[];
  mutateableIds.push("e2");
  // The returned copy is decoupled, so internal state is intact and export gates on sign-off.
  assert.throws(() => service.exportSensitive("p1", "reviewer", true, "2026-10-09T11:31:00.000Z"), /sign-off/);
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  // Internal packet still has only approved evidence; export succeeds with the originally approved set.
  const exported = service.exportSensitive("p1", "reviewer", true, "2026-10-09T11:31:00.000Z");
  assert.deepEqual(exported.packet.claims[0].evidenceIds, ["e1"]);
});

test("export re-validates all evidence is still approved and rejects if a referenced record is superseded", () => {
  const service = new EvidenceReviewService();
  approved(service);
  service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  service.correctEvidence("e1", { ...base, observation: "Led a reviewed migration", source: { ...base.source, anchor: "lines 20-22" } }, "manager");
  assert.throws(() => service.exportSensitive("p1", "reviewer", true, "2026-10-09T12:01:00.000Z"), /sign-off/);
});

test("caller mutation of the rubric object after buildPacket does not change the stored packet", () => {
  const service = new EvidenceReviewService();
  approved(service);
  const competencies: string[] = ["technical-leadership"];
  const rubric = { id: "r1", targetLevel: "L5", competencies: competencies as unknown as readonly string[], suppliedBy: "manager" };
  const packet = service.buildPacket("p1", "person-1", rubric, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  competencies.push("people-development");
  rubric.targetLevel = "L9";
  assert.deepEqual(packet.rubric.competencies, ["technical-leadership"]);
  assert.equal(packet.rubric.targetLevel, "L5");
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  const exported = service.exportSensitive("p1", "reviewer", true, "2026-10-09T11:31:00.000Z");
  assert.deepEqual(exported.packet.rubric.competencies, ["technical-leadership"]);
  assert.equal(exported.packet.rubric.targetLevel, "L5");
});

test("addEvidence without a source throws a domain error mentioning source", () => {
  const service = new EvidenceReviewService();
  const input = { ...base, id: "e1" } as unknown as Omit<typeof base & { id: string }, "source" >;
  assert.throws(() => service.addEvidence({ ...input, source: undefined as unknown as typeof base.source }), /source/);
});

test("supersession invalidates packets that cite the superseded record", () => {
  const service = new EvidenceReviewService();
  approved(service);
  service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }]);
  service.signPacket("p1", "reviewer", "2026-10-09T11:30:00.000Z");
  service.correctEvidence("e1", { ...base, observation: "Led a reviewed migration", source: { ...base.source, anchor: "lines 20-22" } }, "manager");
  assert.throws(() => service.exportSensitive("p1", "reviewer", true, "2026-10-09T12:01:00.000Z"), /sign-off/);
  const afterSign = service.buildPacket("p1-refresh", "person-1", { id: "r1-refresh", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [{ text: "claim", evidenceIds: [], citations: [] }]);
  assert.equal(afterSign.signed, false);
});

test("a citation cannot use evidence owned by another claim", () => {
  const service = new EvidenceReviewService();
  approved(service, "e1");
  approved(service, "e2");
  assert.throws(() => service.buildPacket("p1", "person-1", { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" }, [
    { text: "first", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] },
    { text: "second", evidenceIds: ["e2"], citations: [{ ...base.source, recordId: "e1" }] },
  ]), /citation is outside claim evidence/);
});

test("building a packet with an existing id is rejected", () => {
  const service = new EvidenceReviewService();
  approved(service);
  const rubric = { id: "r1", targetLevel: "L5", competencies: ["technical-leadership"], suppliedBy: "manager" };
  const claims = [{ text: "claim", evidenceIds: ["e1"], citations: [{ ...base.source, recordId: "e1" }] }];
  service.buildPacket("p1", "person-1", rubric, claims);
  assert.throws(() => service.buildPacket("p1", "person-1", rubric, claims), /packet id already exists/);
});
