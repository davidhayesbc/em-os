export type EvidenceStatus = "proposed" | "approved" | "rejected" | "superseded";
export type Consent = "granted" | "withheld" | "unknown";

export interface EvidenceSource {
  recordId: string;
  url?: string;
  anchor: string;
  available: boolean;
}

export interface EvidenceRecord {
  id: string;
  subjectId: string;
  competency: string[];
  observation: string;
  impact: string;
  context: string;
  observedAt: string;
  source: EvidenceSource;
  consent: Consent;
  author: string;
  status: EvidenceStatus;
  supersedesId?: string;
}

export interface ReviewRubric {
  id: string;
  targetLevel: string;
  competencies: readonly string[];
  suppliedBy: string;
}

export interface PacketClaim {
  text: string;
  evidenceIds: readonly string[];
  citations: readonly EvidenceSource[];
}

export interface ReviewPacket {
  id: string;
  subjectId: string;
  rubric: ReviewRubric;
  claims: readonly PacketClaim[];
  gaps: readonly string[];
  counterEvidence: readonly string[];
  reviewer?: string;
  signedAt?: string;
  signed: boolean;
}

export interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  entityId: string;
  detail: string;
}

export interface SensitiveExport {
  packet: ReviewPacket;
  exportedAt: string;
  auditId: string;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function utc(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || !value.endsWith("Z")) throw new Error("timestamp must be UTC ISO-8601");
  return date.toISOString();
}

/** In-memory domain service; persistence adapters can mirror its append-only audit semantics. */
export class EvidenceReviewService {
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly packets = new Map<string, ReviewPacket>();
  private readonly deleted = new Set<string>();
  private readonly auditLog: AuditEvent[] = [];

  addEvidence(input: Omit<EvidenceRecord, "status"> & { status?: EvidenceStatus }): EvidenceRecord {
    if (input.status && input.status !== "proposed") throw new Error("evidence must start proposed");
    requireText(input.id, "evidence id");
    requireText(input.subjectId, "subject");
    requireText(input.observation, "observation");
    requireText(input.impact, "impact");
    requireText(input.context, "context");
    requireText(input.author, "author");
    if (!input.source || typeof input.source !== "object") throw new Error("source is required");
    requireText(input.source.recordId, "source record id");
    requireText(input.source.anchor, "source anchor");
    const source: EvidenceSource = { ...input.source as EvidenceSource };
    const record: EvidenceRecord = { ...input, source, observedAt: utc(input.observedAt), status: "proposed" };
    if (this.evidence.has(record.id)) throw new Error("evidence id already exists");
    this.evidence.set(record.id, record);
    this.audit("create", record.id, record.author, "proposed evidence");
    return { ...record, competency: [...record.competency], source: { ...record.source } };
  }

  transitionEvidence(id: string, to: Exclude<EvidenceStatus, "proposed">, actor: string, reason: string, at: string): EvidenceRecord {
    const record = this.getLive(id);
    requireText(actor, "actor"); requireText(reason, "reason");
    if (record.status !== "proposed") throw new Error("terminal review state cannot transition");
    record.status = to;
    this.audit(`transition:${record.status}`, id, actor, reason, at);
    return { ...record, competency: [...record.competency], source: { ...record.source } };
  }

  correctEvidence(id: string, correction: Omit<EvidenceRecord, "id" | "status" | "supersedesId">, actor: string): EvidenceRecord {
    const old = this.getLive(id);
    requireText(actor, "actor");
    const discriminator = this.nextCorrectionDiscriminator(id);
    const corrected = this.addEvidence({ ...correction, id: `${id}:correction:${discriminator}`, status: "proposed", supersedesId: id });
    this.audit("correction", id, actor, `corrected by ${corrected.id}`);
    old.status = "superseded";
    this.invalidatePacketsReferencing(id, `superseded evidence: ${id}`);
    this.audit("transition:superseded", id, actor, `superseded by ${corrected.id}`);
    return { ...corrected, competency: [...corrected.competency], source: { ...corrected.source } };
  }

  buildPacket(id: string, subjectId: string, rubric: ReviewRubric | undefined, claims: readonly PacketClaim[], counterEvidence: readonly string[] = []): ReviewPacket {
    if (!rubric) throw new Error("rubric required; request a target-level rubric");
    if (this.packets.has(id)) throw new Error("packet id already exists");
    requireText(rubric.id, "rubric id"); requireText(rubric.targetLevel, "rubric target level");
    for (const claim of claims) {
      if (!claim.text.trim()) throw new Error("claim text is required");
      for (const id of claim.evidenceIds) {
        const record = this.getLive(id);
        if (record.subjectId !== subjectId) throw new Error("evidence subject mismatch");
        if (record.status !== "approved") throw new Error(`claim requires approved evidence: ${id}`);
      }
      for (const citation of claim.citations) {
        if (!claim.evidenceIds.includes(citation.recordId)) throw new Error("citation is outside claim evidence");
        if (!citation.anchor.trim()) throw new Error("citation anchor is required");
      }
    }
    const competencies = rubric.competencies ? [...rubric.competencies] : [];
    const storedRubric: ReviewRubric = { ...rubric, competencies };
    const gaps = competencies.filter((competency) => !claims.some((claim) => claim.evidenceIds.some((id) => this.getLive(id).competency.includes(competency))));
    const packet: ReviewPacket = { id, subjectId, rubric: storedRubric, claims: claims.map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds], citations: claim.citations.map((citation) => ({ ...citation, url: citation.available ? citation.url : undefined })) })), gaps, counterEvidence: [...counterEvidence], signed: false };
    this.packets.set(id, packet);
    this.audit("packet:create", id, "system", gaps.length ? "rubric gaps present" : "complete rubric coverage");
    return this.copyPacket(packet);
  }

  signPacket(id: string, reviewer: string, signedAt: string): ReviewPacket {
    const packet = this.getPacket(id);
    requireText(reviewer, "reviewer");
    packet.reviewer = reviewer; packet.signedAt = utc(signedAt); packet.signed = true;
    this.audit("packet:sign", id, reviewer, "explicit reviewer sign-off", signedAt);
    return this.copyPacket(packet);
  }

  deleteEvidence(id: string, actor: string, at: string): void {
    const record = this.getLive(id);
    requireText(actor, "actor");
    this.deleted.add(id);
    record.status = "superseded";
    this.invalidatePacketsReferencing(id, `deleted evidence: ${id}`);
    this.audit("delete:tombstone", id, actor, "content removed; packet references and caches propagated", at);
  }

  exportSensitive(packetId: string, actor: string, authorized: boolean, at: string): SensitiveExport {
    if (!authorized) throw new Error("sensitive export authorization required");
    const packet = this.getPacket(packetId);
    if (!packet.signed) throw new Error("packet requires reviewer sign-off before export");
    for (const claim of packet.claims) {
      for (const evidenceId of claim.evidenceIds) {
        const record = this.getLive(evidenceId);
        if (record.status !== "approved") throw new Error(`claim requires approved evidence: ${evidenceId}`);
      }
    }
    const auditId = `export:${this.auditLog.length}`;
    this.audit("export:sensitive", packetId, actor, auditId, at);
    return { packet: this.copyPacket(packet), exportedAt: utc(at), auditId };
  }

  getAudit(): readonly AuditEvent[] { return this.auditLog.map((event) => ({ ...event })); }
  getEvidence(id: string): EvidenceRecord { return { ...this.getLive(id), competency: [...this.getLive(id).competency], source: { ...this.getLive(id).source } }; }

  private getLive(id: string): EvidenceRecord {
    const record = this.evidence.get(id);
    if (!record) throw new Error(`evidence not found: ${id}`);
    if (this.deleted.has(id)) throw new Error(`evidence deleted: ${id}`);
    return record;
  }
  private getPacket(id: string): ReviewPacket { const packet = this.packets.get(id); if (!packet) throw new Error(`packet not found: ${id}`); return packet; }
  private audit(action: string, entityId: string, actor: string, detail: string, at = new Date().toISOString()): void { this.auditLog.push({ action, entityId, actor, detail, at: utc(at) }); }
  private copyPacket(packet: ReviewPacket): ReviewPacket {
    return {
      ...packet,
      rubric: { ...packet.rubric, competencies: [...packet.rubric.competencies] },
      claims: packet.claims.map((claim) => ({
        ...claim,
        evidenceIds: [...claim.evidenceIds],
        citations: claim.citations.map((citation) => ({ ...citation })),
      })),
      gaps: [...packet.gaps],
      counterEvidence: [...packet.counterEvidence],
    };
  }
  private nextCorrectionDiscriminator(id: string): number {
    let n = 0;
    while (this.evidence.has(`${id}:correction:${n}`)) n += 1;
    return n;
  }
  private invalidatePacketsReferencing(evidenceId: string, gap: string): void {
    for (const packet of this.packets.values()) {
      let referenced = false;
      packet.claims = packet.claims.map((claim) => ({
        ...claim,
        evidenceIds: claim.evidenceIds.filter((candidateId) => {
          if (candidateId === evidenceId) referenced = true;
          return candidateId !== evidenceId;
        }),
        citations: claim.citations.filter((citation) => {
          if (citation.recordId === evidenceId) referenced = true;
          return citation.recordId !== evidenceId;
        }),
      }));
      if (referenced && !packet.gaps.includes(gap)) {
        packet.gaps = [...packet.gaps, gap];
        packet.signed = false;
        packet.reviewer = undefined;
        packet.signedAt = undefined;
      }
    }
  }
}
