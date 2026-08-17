import {
  canonicalizeJson,
  computeSchemaFeaturePacketDigest,
  computeSemanticChangeProposalDigest,
  type SchemaFeaturePacket,
  type SemanticCandidateOperation,
  type SemanticChangeProposal,
} from "@data-agent/contracts";

export interface CandidateProposalValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface CandidateProposalValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CandidateProposalValidationIssue[];
}

export interface ValidateCandidateProposalOptions {
  readonly known_target_keys?: ReadonlySet<string>;
}

function targetKey(operation: SemanticCandidateOperation): string {
  return `${operation.target_type}:${operation.target_id}`;
}

function payloadTargetId(operation: SemanticCandidateOperation): string | null {
  if (operation.payload === null) return null;
  switch (operation.target_type) {
    case "BUSINESS_ENTITY_TYPE":
      return operation.payload.entity_id;
    case "DIMENSION":
      return operation.payload.dimension_id;
    case "METRIC":
      return operation.payload.metric_id;
    case "RELATIONSHIP":
      return operation.payload.relationship_id;
    case "PHYSICAL_BINDING":
      return operation.payload.logical_object_id;
  }
}

export async function validateSemanticChangeProposal(
  proposal: SemanticChangeProposal,
  packet: SchemaFeaturePacket,
  options: ValidateCandidateProposalOptions = {},
): Promise<CandidateProposalValidationResult> {
  const issues: CandidateProposalValidationIssue[] = [];
  const { feature_digest: _featureDigest, ...packetMaterial } = packet;
  const expectedPacketDigest = await computeSchemaFeaturePacketDigest(packetMaterial);
  if (
    expectedPacketDigest !== packet.feature_digest ||
    proposal.feature_digest !== packet.feature_digest
  ) {
    issues.push({
      code: "FEATURE_DIGEST_MISMATCH",
      path: "feature_digest",
      message: "候选提案未绑定当前确定性特征包。",
    });
  }

  const { proposal_digest: _proposalDigest, ...proposalMaterial } = proposal;
  if ((await computeSemanticChangeProposalDigest(proposalMaterial)) !== proposal.proposal_digest) {
    issues.push({
      code: "PROPOSAL_DIGEST_MISMATCH",
      path: "proposal_digest",
      message: "候选提案内容摘要不一致。",
    });
  }

  if (
    proposal.snapshot_id !== packet.snapshot_id ||
    proposal.snapshot_digest !== packet.snapshot_digest ||
    proposal.drift_event_id !== packet.drift_event_id ||
    proposal.drift_digest !== packet.drift_digest ||
    canonicalizeJson(proposal.base_release) !== canonicalizeJson(packet.base_release)
  ) {
    issues.push({
      code: "SOURCE_AUTHORITY_MISMATCH",
      path: "snapshot_id",
      message: "候选提案的快照、漂移或基础发布身份与特征包不一致。",
    });
  }

  const featureByLocator = new Map(
    packet.features.map((feature) => [canonicalizeJson(feature.locator), feature] as const),
  );
  const evidenceById = new Map<string, (typeof proposal.evidence)[number]>();
  for (const [index, evidence] of proposal.evidence.entries()) {
    if (evidenceById.has(evidence.evidence_id)) {
      issues.push({
        code: "DUPLICATE_EVIDENCE_ID",
        path: `evidence[${index}].evidence_id`,
        message: `重复证据 ID: ${evidence.evidence_id}。`,
      });
    }
    evidenceById.set(evidence.evidence_id, evidence);
    if (
      evidence.source_kind !== "PHYSICAL_SCHEMA" ||
      evidence.source_id !== packet.snapshot_id ||
      evidence.source_digest !== packet.snapshot_digest ||
      !featureByLocator.has(canonicalizeJson(evidence.locator))
    ) {
      issues.push({
        code: "UNBOUND_EVIDENCE",
        path: `evidence[${index}]`,
        message: "M3 候选证据必须精确定位到当前物理特征包。",
      });
    }
  }

  const operationIds = new Set<string>();
  const targets = new Set<string>();
  for (const [index, operation] of proposal.operations.entries()) {
    if (operationIds.has(operation.operation_id)) {
      issues.push({
        code: "DUPLICATE_OPERATION_ID",
        path: `operations[${index}].operation_id`,
        message: `重复操作 ID: ${operation.operation_id}。`,
      });
    }
    operationIds.add(operation.operation_id);

    const key = targetKey(operation);
    if (targets.has(key)) {
      issues.push({
        code: "DUPLICATE_TARGET_OPERATION",
        path: `operations[${index}].target_id`,
        message: `同一提案不能多次变更目标 ${key}。`,
      });
    }
    targets.add(key);

    const payloadId = payloadTargetId(operation);
    if (payloadId !== null && payloadId !== operation.target_id) {
      issues.push({
        code: "TARGET_PAYLOAD_ID_MISMATCH",
        path: `operations[${index}].payload`,
        message: "操作目标 ID 必须与类型化 payload 的对象 ID 一致。",
      });
    }

    const known = options.known_target_keys?.has(key);
    if (options.known_target_keys && operation.action === "CREATE" && known) {
      issues.push({
        code: "CREATE_TARGET_EXISTS",
        path: `operations[${index}].action`,
        message: `CREATE 目标 ${key} 已存在于基础发布。`,
      });
    }
    if (
      options.known_target_keys &&
      operation.action !== "CREATE" &&
      !options.known_target_keys.has(key)
    ) {
      issues.push({
        code: "MUTATION_TARGET_MISSING",
        path: `operations[${index}].action`,
        message: `${operation.action} 目标 ${key} 不存在于基础发布。`,
      });
    }

    const operationEvidence = new Set(operation.evidence_refs);
    for (const evidenceId of operationEvidence) {
      if (!evidenceById.has(evidenceId)) {
        issues.push({
          code: "MISSING_OPERATION_EVIDENCE",
          path: `operations[${index}].evidence_refs`,
          message: `操作引用了不存在的证据 ${evidenceId}。`,
        });
      }
    }
    for (const [fieldPath, evidenceIds] of Object.entries(operation.field_evidence)) {
      for (const evidenceId of evidenceIds) {
        if (!operationEvidence.has(evidenceId)) {
          issues.push({
            code: "FIELD_EVIDENCE_OUTSIDE_OPERATION",
            path: `operations[${index}].field_evidence.${fieldPath}`,
            message: `字段证据 ${evidenceId} 未包含在操作证据集合中。`,
          });
        }
      }
    }

    if (operation.confidence < 0.8 && operation.open_questions.length === 0) {
      issues.push({
        code: "LOW_CONFIDENCE_WITHOUT_QUESTION",
        path: `operations[${index}].open_questions`,
        message: "低置信度候选必须明确列出待人工确认的问题。",
      });
    }

    if (operation.target_type === "RELATIONSHIP" && operation.payload) {
      const relationship = operation.payload;
      const proofFeatures = operation.evidence_refs
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter((evidence) => evidence !== undefined)
        .map((evidence) => featureByLocator.get(canonicalizeJson(evidence.locator)))
        .filter((feature) => feature !== undefined);

      if (
        relationship.kind === "physical" &&
        (relationship.proof_kind !== "DDL_ENFORCED" ||
          !proofFeatures.some((feature) => feature.feature_kind === "FOREIGN_KEY"))
      ) {
        issues.push({
          code: "PHYSICAL_RELATIONSHIP_WITHOUT_FK",
          path: `operations[${index}].payload.proof_kind`,
          message: "物理关系候选只能由当前快照中的外键 DDL 证明。",
        });
      }
      if (
        relationship.kind === "analytical" &&
        (relationship.proof_kind !== "SNAPSHOT_CERTIFIED" || !relationship.proof_detail)
      ) {
        issues.push({
          code: "ANALYTICAL_RELATIONSHIP_WITHOUT_SAFETY_PROOF",
          path: `operations[${index}].payload.proof_kind`,
          message: "分析关系必须携带基数与行保留安全证明，不能由外键推断。",
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
