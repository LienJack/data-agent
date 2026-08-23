import {
  type ContextCapacityItem,
  type ContextCapacityPlan,
  canonicalizeJson,
  type SemanticContextEvidenceSummary,
} from "@data-agent/contracts";

export interface ContextCapacityCandidate {
  readonly item_kind: ContextCapacityItem["item_kind"];
  readonly item_id: string;
  readonly item_hash: string;
  readonly priority: number;
  readonly mandatory: boolean;
  readonly on_demand?: boolean;
  readonly evidence: SemanticContextEvidenceSummary | null;
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(canonicalizeJson(value)).byteLength;
}

function candidateKey(candidate: ContextCapacityCandidate): string {
  return `${String(10_000 - candidate.priority).padStart(5, "0")}:${candidate.item_kind}:${candidate.item_id}:${candidate.item_hash}`;
}

export function applyContextCapacity(input: {
  readonly max_context_tokens: number;
  readonly candidates: readonly ContextCapacityCandidate[];
}): Readonly<{
  plan: ContextCapacityPlan;
  included_evidence: readonly SemanticContextEvidenceSummary[];
  mandatory_exceeded: boolean;
}> {
  const maxBytes = input.max_context_tokens;
  const candidates = [...input.candidates].sort((left, right) =>
    candidateKey(left).localeCompare(candidateKey(right)),
  );
  const mandatoryBytes = candidates
    .filter(({ mandatory }) => mandatory)
    .reduce((total, candidate) => total + byteSize(candidate.evidence ?? candidate), 0);
  let usedBytes = mandatoryBytes;
  let croppedBytes = 0;
  const includedEvidence: SemanticContextEvidenceSummary[] = [];
  const items: ContextCapacityItem[] = candidates.map((candidate) => {
    const size = byteSize(candidate.evidence ?? candidate);
    if (candidate.mandatory) {
      if (candidate.evidence) includedEvidence.push(candidate.evidence);
      return {
        item_kind: candidate.item_kind,
        item_id: candidate.item_id,
        item_hash: candidate.item_hash,
        byte_size: size,
        priority: candidate.priority,
        mandatory: true,
        disposition: "MANDATORY",
        reason_code: candidate.item_kind === "AUTHORITY" ? "AUTHORITY_REQUIRED" : "ROUTE_SELECTED",
      };
    }
    if (candidate.on_demand) {
      return {
        item_kind: candidate.item_kind,
        item_id: candidate.item_id,
        item_hash: candidate.item_hash,
        byte_size: size,
        priority: candidate.priority,
        mandatory: false,
        disposition: "ON_DEMAND",
        reason_code: "DEFERRED_RETRIEVAL",
      };
    }
    if (usedBytes + size <= maxBytes) {
      usedBytes += size;
      if (candidate.evidence) includedEvidence.push(candidate.evidence);
      return {
        item_kind: candidate.item_kind,
        item_id: candidate.item_id,
        item_hash: candidate.item_hash,
        byte_size: size,
        priority: candidate.priority,
        mandatory: false,
        disposition: "INCLUDED",
        reason_code: "WITHIN_CAPACITY",
      };
    }
    croppedBytes += size;
    return {
      item_kind: candidate.item_kind,
      item_id: candidate.item_id,
      item_hash: candidate.item_hash,
      byte_size: size,
      priority: candidate.priority,
      mandatory: false,
      disposition: "CROPPED",
      reason_code: "CAPACITY_EXCEEDED",
    };
  });
  const plan: ContextCapacityPlan = {
    schema_version: "context-capacity-plan@1.0.0",
    policy_version: "utf8-byte-upper-bound@1.0.0",
    max_context_tokens: input.max_context_tokens,
    max_context_bytes: maxBytes,
    mandatory_bytes: mandatoryBytes,
    included_bytes: usedBytes,
    cropped_bytes: croppedBytes,
    items,
  };
  return Object.freeze({
    plan,
    included_evidence: Object.freeze(includedEvidence),
    mandatory_exceeded: mandatoryBytes > maxBytes,
  });
}
