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
