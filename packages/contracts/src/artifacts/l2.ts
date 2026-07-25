import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type ArtifactCommitterCapabilityClaim,
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  l2ArtifactEnvelopeSchema,
} from "./envelope.js";

const questionFrameSchema = z.strictObject({
  artifact_type: z.literal("QuestionFrame"),
  raw_question: z.string().min(1).max(10_000),
  normalized_question: z.string().min(1).max(10_000),
  authorized_datasource_ids: z.array(immutableIdSchema).min(1),
  expected_output: z.string().min(1).max(500),
});

const researchBriefSchema = z.strictObject({
  artifact_type: z.literal("ResearchBrief"),
  question_frame_ref: artifactReferenceFor("QuestionFrame"),
  research_goal: z.string().min(1).max(2_000),
  success_criteria: z.array(z.string().min(1).max(500)).min(1),
  budget: z.strictObject({
    max_steps: z.number().int().positive(),
    max_model_calls: z.number().int().nonnegative(),
    max_sql_executions: z.number().int().nonnegative(),
  }),
});

const hypothesisSetSchema = z
  .strictObject({
    artifact_type: z.literal("HypothesisSet"),
    research_brief_ref: artifactReferenceFor("ResearchBrief"),
    hypotheses: z
      .array(
        z.strictObject({
          hypothesis_id: immutableIdSchema,
          statement: z.string().min(1).max(2_000),
          differentiating_prediction: z.string().min(1).max(2_000),
        }),
      )
      .min(2),
  })
  .superRefine((hypothesisSet, ctx) => {
    const observed = new Set<string>();
    for (const [index, hypothesis] of hypothesisSet.hypotheses.entries()) {
      if (observed.has(hypothesis.hypothesis_id)) {
        ctx.addIssue({
          code: "custom",
          message: "HypothesisSet 中的 hypothesis_id 必须唯一。",
          path: ["hypotheses", index, "hypothesis_id"],
        });
      }
      observed.add(hypothesis.hypothesis_id);
    }
  });

const evidencePlanSchema = z
  .strictObject({
    artifact_type: z.literal("EvidencePlan"),
    hypothesis_set_ref: artifactReferenceFor("HypothesisSet"),
    obligations: z
      .array(
        z.strictObject({
          obligation_id: immutableIdSchema,
          hypothesis_id: immutableIdSchema,
          question: z.string().min(1).max(2_000),
          source_kind: z.enum(["sql", "document", "benchmark"]),
        }),
      )
      .min(1),
  })
  .superRefine((evidencePlan, ctx) => {
    const observed = new Set<string>();
    for (const [index, obligation] of evidencePlan.obligations.entries()) {
      if (observed.has(obligation.obligation_id)) {
        ctx.addIssue({
          code: "custom",
          message: "EvidencePlan 中的 obligation_id 必须唯一。",
          path: ["obligations", index, "obligation_id"],
        });
      }
      observed.add(obligation.obligation_id);
    }
  });

const queryContractSchema = z.strictObject({
  artifact_type: z.literal("QueryContract"),
  evidence_plan_ref: artifactReferenceFor("EvidencePlan"),
  metric: versionIdentifierSchema,
  dimensions: z.array(versionIdentifierSchema),
  grain: versionIdentifierSchema,
  time_range: z.strictObject({
    start: timestampSchema,
    end: timestampSchema,
    timezone: z.string().min(1).max(64),
  }),
  unit: versionIdentifierSchema,
  filters: z.array(
    z.strictObject({
      field: versionIdentifierSchema,
      operator: z.enum(["eq", "neq", "in", "gte", "lte", "between"]),
      value: z.json(),
    }),
  ),
  datasource_id: immutableIdSchema,
  result_contract: z.strictObject({
    columns: z.array(versionIdentifierSchema).min(1),
    invariant_ids: z.array(versionIdentifierSchema),
  }),
});

const groundingPackageSchema = z.strictObject({
  artifact_type: z.literal("GroundingPackage"),
  query_contract_ref: artifactReferenceFor("QueryContract"),
  semantic_release: versionIdentifierSchema,
  source_refs: z.array(artifactReferenceSchema),
  join_bridges: z.array(
    z.strictObject({
      left: versionIdentifierSchema,
      right: versionIdentifierSchema,
      relationship: z.enum(["one-to-one", "one-to-many", "many-to-one"]),
    }),
  ),
});

const semanticQuerySchema = z.strictObject({
  artifact_type: z.literal("SemanticQuery"),
  query_contract_ref: artifactReferenceFor("QueryContract"),
  grounding_package_ref: artifactReferenceFor("GroundingPackage"),
  metric_ref: versionIdentifierSchema,
  dimension_refs: z.array(versionIdentifierSchema),
  filter_expressions: z.array(z.string().min(1).max(2_000)),
});

const logicalOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("scan"),
    source: versionIdentifierSchema,
    alias: versionIdentifierSchema,
  }),
  z.strictObject({
    operation: z.literal("filter"),
    predicate: z.string().min(1).max(10_000),
  }),
  z.strictObject({
    operation: z.literal("join"),
    left_alias: versionIdentifierSchema,
    right_alias: versionIdentifierSchema,
    join_type: z.enum(["inner", "left"]),
    conditions: z
      .array(
        z.strictObject({
          left_field: versionIdentifierSchema,
          right_field: versionIdentifierSchema,
          operator: z.literal("eq"),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    operation: z.literal("aggregate"),
    group_by: z.array(versionIdentifierSchema),
    measures: z
      .array(
        z.strictObject({
          function: z.enum(["sum", "count", "count_distinct", "avg", "min", "max"]),
          field: versionIdentifierSchema,
          alias: versionIdentifierSchema,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    operation: z.literal("project"),
    columns: z
      .array(
        z.strictObject({
          expression: z.string().min(1).max(2_000),
          alias: versionIdentifierSchema,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    operation: z.literal("sort"),
    keys: z
      .array(
        z.strictObject({
          field: versionIdentifierSchema,
          direction: z.enum(["asc", "desc"]),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    operation: z.literal("limit"),
    count: z.number().int().positive().max(100_000),
  }),
]);

const logicalPlanSchema = z.strictObject({
  artifact_type: z.literal("LogicalPlan"),
  semantic_query_ref: artifactReferenceFor("SemanticQuery"),
  operations: z.array(logicalOperationSchema).min(1),
});

const sqlArtifactSchema = z.strictObject({
  artifact_type: z.literal("SqlArtifact"),
  logical_plan_ref: artifactReferenceFor("LogicalPlan"),
  dialect: z.literal("postgresql"),
  sql: z.string().min(1).max(100_000),
  parameters: z.record(z.string(), z.json()),
  query_hash: contentHashSchema,
});

export const TEXT2SQL_GATES = [
  "INTENT",
  "SEMANTIC",
  "STRUCTURAL",
  "POLICY",
  "RESOURCE",
  "EXECUTION",
  "RESULT",
] as const;

const validationReceiptSchema = z
  .strictObject({
    artifact_type: z.literal("ValidationReceipt"),
    sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
    gates: z.array(
      z.strictObject({
        gate: z.enum(TEXT2SQL_GATES),
        verdict: z.enum(["PASS", "FAIL"]),
        reason_code: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z][A-Z0-9_]*$/),
      }),
    ),
  })
  .superRefine((receipt, ctx) => {
    const observed = new Set(receipt.gates.map(({ gate }) => gate));
    if (
      receipt.gates.length !== TEXT2SQL_GATES.length ||
      observed.size !== TEXT2SQL_GATES.length ||
      TEXT2SQL_GATES.some((gate) => !observed.has(gate))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ValidationReceipt 必须且只能包含七道当前 Gate。",
        path: ["gates"],
      });
    }
  });

const executionReceiptSchema = z.strictObject({
  artifact_type: z.literal("ExecutionReceipt"),
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  validation_receipt_ref: artifactReferenceFor("ValidationReceipt"),
  datasource_id: immutableIdSchema,
  schema_version: versionIdentifierSchema,
  snapshot_token: versionIdentifierSchema.nullable(),
  watermark: versionIdentifierSchema.nullable(),
  observed_at: timestampSchema,
  query_hash: contentHashSchema,
  replay_state: z.enum(["REPLAYABLE", "LIMITED", "REPLAY_UNAVAILABLE"]),
  row_count: z.number().int().nonnegative(),
});

const queryEvidenceSchema = z.strictObject({
  artifact_type: z.literal("QueryEvidence"),
  execution_receipt_ref: artifactReferenceFor("ExecutionReceipt"),
  result_hash: contentHashSchema,
  invariant_verdicts: z
    .array(
      z.strictObject({
        invariant_id: versionIdentifierSchema,
        verdict: z.enum(["PASS", "FAIL"]),
      }),
    )
    .min(1),
});

const atomicClaimSchema = z.strictObject({
  artifact_type: z.literal("AtomicClaim"),
  claim_id: immutableIdSchema,
  statement: z.string().min(1).max(5_000),
  evidence_refs: z.array(artifactReferenceFor("QueryEvidence")).min(1),
  support_state: z.enum(["SUPPORTED", "CONFLICTED", "UNSUPPORTED"]),
  limitations: z.array(z.string().min(1).max(2_000)),
});

const evidenceRelationSchema = z.strictObject({
  artifact_type: z.literal("EvidenceRelation"),
  claim_ref: artifactReferenceFor("AtomicClaim"),
  evidence_ref: artifactReferenceFor("QueryEvidence"),
  relation: z.enum(["SUPPORTS", "CONFLICTS", "RELATED_ONLY"]),
});

const analysisReportSchema = z.strictObject({
  artifact_type: z.literal("AnalysisReport"),
  title: z.string().min(1).max(500),
  claim_refs: z.array(artifactReferenceFor("AtomicClaim")).min(1),
  limitations: z.array(z.string().min(1).max(2_000)),
  projection_hash: contentHashSchema,
});

export const L2_REPORT_READY_GATES = [
  "SUPPORT",
  "CONFLICT",
  "FRESHNESS",
  "SOURCE_INDEPENDENCE",
] as const;

const reportReadyCertificateSchema = z
  .strictObject({
    artifact_type: z.literal("ReportReadyCertificate"),
    report_ref: artifactReferenceFor("AnalysisReport"),
    gate_version: versionIdentifierSchema,
    gate_results: z.array(
      z.strictObject({
        gate: z.enum(L2_REPORT_READY_GATES),
        verdict: z.literal("PASS"),
        reason_code: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z][A-Z0-9_]*$/),
      }),
    ),
    evidence_refs: z.array(artifactReferenceFor("QueryEvidence")).min(1),
    decision: z.literal("READY"),
    certificate_hash: contentHashSchema,
  })
  .superRefine((certificate, ctx) => {
    const observed = new Set(certificate.gate_results.map(({ gate }) => gate));
    if (
      certificate.gate_results.length !== L2_REPORT_READY_GATES.length ||
      observed.size !== L2_REPORT_READY_GATES.length ||
      L2_REPORT_READY_GATES.some((gate) => !observed.has(gate))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ReportReadyCertificate 必须且只能包含四道 L2 Evidence Gate 的 PASS。",
        path: ["gate_results"],
      });
    }
  });

export const l2ArtifactPayloadSchema = z.discriminatedUnion("artifact_type", [
  questionFrameSchema,
  researchBriefSchema,
  hypothesisSetSchema,
  evidencePlanSchema,
  queryContractSchema,
  groundingPackageSchema,
  semanticQuerySchema,
  logicalPlanSchema,
  sqlArtifactSchema,
  validationReceiptSchema,
  executionReceiptSchema,
  queryEvidenceSchema,
  atomicClaimSchema,
  evidenceRelationSchema,
  analysisReportSchema,
  reportReadyCertificateSchema,
]);

type L2ArtifactPayload = z.infer<typeof l2ArtifactPayloadSchema>;

type SqlArtifactPayload = Extract<L2ArtifactPayload, { artifact_type: "SqlArtifact" }>;

export async function computeSqlArtifactQueryHash(
  sqlArtifact: Pick<SqlArtifactPayload, "dialect" | "sql" | "parameters">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    dialect: sqlArtifact.dialect,
    sql: sqlArtifact.sql,
    parameters: sqlArtifact.parameters,
  });
}

function payloadArtifactReferences(payload: L2ArtifactPayload): ArtifactReference[] {
  switch (payload.artifact_type) {
    case "ResearchBrief":
      return [payload.question_frame_ref];
    case "HypothesisSet":
      return [payload.research_brief_ref];
    case "EvidencePlan":
      return [payload.hypothesis_set_ref];
    case "QueryContract":
      return [payload.evidence_plan_ref];
    case "GroundingPackage":
      return [payload.query_contract_ref, ...payload.source_refs];
    case "SemanticQuery":
      return [payload.query_contract_ref, payload.grounding_package_ref];
    case "LogicalPlan":
      return [payload.semantic_query_ref];
    case "SqlArtifact":
      return [payload.logical_plan_ref];
    case "ValidationReceipt":
      return [payload.sql_artifact_ref];
    case "ExecutionReceipt":
      return [payload.sql_artifact_ref, payload.validation_receipt_ref];
    case "QueryEvidence":
      return [payload.execution_receipt_ref];
    case "AtomicClaim":
      return payload.evidence_refs;
    case "EvidenceRelation":
      return [payload.claim_ref, payload.evidence_ref];
    case "AnalysisReport":
      return payload.claim_refs;
    case "ReportReadyCertificate":
      return [payload.report_ref, ...payload.evidence_refs];
    case "QuestionFrame":
      return [];
  }
}

export const l2ArtifactDocumentSchema = z
  .strictObject({
    envelope: l2ArtifactEnvelopeSchema,
    payload: l2ArtifactPayloadSchema,
  })
  .superRefine((document, ctx) => {
    if (document.envelope.artifact_type !== document.payload.artifact_type) {
      ctx.addIssue({
        code: "custom",
        message: "Envelope 与 Payload 的 artifact_type 必须一致。",
        path: ["payload", "artifact_type"],
      });
    }

    const declaredInputReferences = new Set(
      document.envelope.input_refs.map(artifactReferenceIdentity),
    );
    for (const [index, reference] of payloadArtifactReferences(document.payload).entries()) {
      if (
        reference.app_id !== document.envelope.app_id ||
        reference.tenant_id !== document.envelope.tenant_id ||
        reference.environment !== document.envelope.environment ||
        reference.run_id !== document.envelope.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Payload Reference 必须与 Envelope 属于同一 App/Tenant/Environment/Run。",
          path: ["payload", index],
        });
      }

      if (!declaredInputReferences.has(artifactReferenceIdentity(reference))) {
        ctx.addIssue({
          code: "custom",
          message: "Payload Reference 必须在 Envelope input_refs 中声明。",
          path: ["payload", index],
        });
      }
    }
  });

function artifactIntegrityMaterial(document: L2ArtifactDocument) {
  const {
    content_hash: _contentHash,
    created_at: _createdAt,
    status: _status,
    ...versionedEnvelope
  } = document.envelope;

  return {
    envelope: versionedEnvelope,
    payload: document.payload,
  };
}

export async function computeL2ArtifactContentHash(
  document: L2ArtifactDocument,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(artifactIntegrityMaterial(document));
}

export class ArtifactIntegrityError extends Error {
  override readonly name = "ArtifactIntegrityError";
  readonly code = "ARTIFACT_CONTENT_HASH_MISMATCH";
}

export class ArtifactAuthorityError extends Error {
  override readonly name = "ArtifactAuthorityError";
  readonly code = "ARTIFACT_NOT_AUTHORITATIVE";
}

export class ArtifactInputAuthorityError extends Error {
  override readonly name = "ArtifactInputAuthorityError";
  readonly code = "ARTIFACT_INPUT_NOT_COMMITTED";
}

export class ArtifactSemanticAuthorityError extends Error {
  override readonly name = "ArtifactSemanticAuthorityError";
  readonly code = "ARTIFACT_SEMANTIC_AUTHORITY_INVALID";
}

declare const authoritativeArtifactDocument: unique symbol;
// 该品牌只证明当前进程中的 resolver 已完成持久化与语义核验，不是可序列化的跨进程真值。
const authorizedArtifactDocuments = new WeakSet<object>();

export type AuthoritativeL2ArtifactDocument = L2ArtifactDocument & {
  readonly [authoritativeArtifactDocument]: true;
};

export interface L2ArtifactAuthorityContext {
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveL2(reference: ArtifactReference): Promise<AuthoritativeL2ArtifactDocument | null>;
}

export interface L2ArtifactPersistenceAuthority extends L2ArtifactAuthorityContext {
  verifyCommitterCapability(claim: ArtifactCommitterCapabilityClaim): Promise<boolean>;
}

function artifactReferenceFromDocument(document: L2ArtifactDocument): ArtifactReference {
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  };
}

async function resolveAuthoritativeL2(
  reference: ArtifactReference,
  authority: L2ArtifactAuthorityContext,
): Promise<AuthoritativeL2ArtifactDocument> {
  const document = await authority.resolveL2(reference);
  if (
    !document ||
    !isAuthoritativeL2ArtifactDocument(document) ||
    artifactReferenceIdentity(artifactReferenceFromDocument(document)) !==
      artifactReferenceIdentity(reference)
  ) {
    throw new ArtifactSemanticAuthorityError(
      `Artifact ${reference.artifact_type} 没有匹配的权威 L2 文档。`,
    );
  }
  return document;
}

function requireArtifactType<T extends L2ArtifactPayload["artifact_type"]>(
  document: AuthoritativeL2ArtifactDocument,
  artifactType: T,
): Extract<L2ArtifactPayload, { artifact_type: T }> {
  if (document.payload.artifact_type !== artifactType) {
    throw new ArtifactSemanticAuthorityError(
      `期望 ${artifactType}，实际解析到 ${document.payload.artifact_type}。`,
    );
  }
  return document.payload as Extract<L2ArtifactPayload, { artifact_type: T }>;
}

function requirePassingValidationReceipt(
  receipt: Extract<L2ArtifactPayload, { artifact_type: "ValidationReceipt" }>,
): void {
  if (receipt.gates.some(({ verdict }) => verdict !== "PASS")) {
    throw new ArtifactSemanticAuthorityError(
      "ExecutionReceipt 只能消费七道 Gate 全部 PASS 的验证单。",
    );
  }
}

async function requirePassingEvidence(
  evidenceReference: ArtifactReference,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const evidence = requireArtifactType(
    await resolveAuthoritativeL2(evidenceReference, authority),
    "QueryEvidence",
  );
  if (evidence.invariant_verdicts.some(({ verdict }) => verdict !== "PASS")) {
    throw new ArtifactSemanticAuthorityError(
      "SUPPORTED Claim 不能消费不变量失败的 QueryEvidence。",
    );
  }

  const execution = requireArtifactType(
    await resolveAuthoritativeL2(evidence.execution_receipt_ref, authority),
    "ExecutionReceipt",
  );
  await verifyExecutionReceiptSemantics(execution, authority);
}

function requireSameReference(
  left: ArtifactReference,
  right: ArtifactReference,
  message: string,
): void {
  if (artifactReferenceIdentity(left) !== artifactReferenceIdentity(right)) {
    throw new ArtifactSemanticAuthorityError(message);
  }
}

async function verifyEvidencePlanSemantics(
  evidencePlan: Extract<L2ArtifactPayload, { artifact_type: "EvidencePlan" }>,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const hypothesisSet = requireArtifactType(
    await resolveAuthoritativeL2(evidencePlan.hypothesis_set_ref, authority),
    "HypothesisSet",
  );
  const hypothesisIds = new Set(hypothesisSet.hypotheses.map(({ hypothesis_id }) => hypothesis_id));
  const coveredHypothesisIds = new Set<string>();
  for (const obligation of evidencePlan.obligations) {
    if (!hypothesisIds.has(obligation.hypothesis_id)) {
      throw new ArtifactSemanticAuthorityError(
        `EvidencePlan obligation ${obligation.obligation_id} 引用了不属于上游 HypothesisSet 的 hypothesis_id。`,
      );
    }
    coveredHypothesisIds.add(obligation.hypothesis_id);
  }
  if (
    hypothesisSet.hypotheses.some(({ hypothesis_id }) => !coveredHypothesisIds.has(hypothesis_id))
  ) {
    throw new ArtifactSemanticAuthorityError(
      "EvidencePlan 必须为上游 HypothesisSet 的每个竞争假设定义至少一项证据义务。",
    );
  }
}

async function verifySemanticQueryLineage(
  semanticQuery: Extract<L2ArtifactPayload, { artifact_type: "SemanticQuery" }>,
  authority: L2ArtifactAuthorityContext,
): Promise<Extract<L2ArtifactPayload, { artifact_type: "QueryContract" }>> {
  const [queryContract, groundingPackage] = await Promise.all([
    resolveAuthoritativeL2(semanticQuery.query_contract_ref, authority).then((document) =>
      requireArtifactType(document, "QueryContract"),
    ),
    resolveAuthoritativeL2(semanticQuery.grounding_package_ref, authority).then((document) =>
      requireArtifactType(document, "GroundingPackage"),
    ),
  ]);
  requireSameReference(
    groundingPackage.query_contract_ref,
    semanticQuery.query_contract_ref,
    "SemanticQuery 与 GroundingPackage 必须绑定同一 QueryContract。",
  );
  return queryContract;
}

async function verifySqlArtifactLineage(
  sqlArtifact: SqlArtifactPayload,
  authority: L2ArtifactAuthorityContext,
): Promise<Extract<L2ArtifactPayload, { artifact_type: "QueryContract" }>> {
  const observedQueryHash = await computeSqlArtifactQueryHash(sqlArtifact);
  if (observedQueryHash !== sqlArtifact.query_hash) {
    throw new ArtifactSemanticAuthorityError(
      "SqlArtifact.query_hash 与 dialect/sql/parameters 的规范内容不匹配。",
    );
  }
  const logicalPlan = requireArtifactType(
    await resolveAuthoritativeL2(sqlArtifact.logical_plan_ref, authority),
    "LogicalPlan",
  );
  const semanticQuery = requireArtifactType(
    await resolveAuthoritativeL2(logicalPlan.semantic_query_ref, authority),
    "SemanticQuery",
  );
  return verifySemanticQueryLineage(semanticQuery, authority);
}

async function verifyExecutionReceiptSemantics(
  execution: Extract<L2ArtifactPayload, { artifact_type: "ExecutionReceipt" }>,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  const validation = requireArtifactType(
    await resolveAuthoritativeL2(execution.validation_receipt_ref, authority),
    "ValidationReceipt",
  );
  requirePassingValidationReceipt(validation);
  requireSameReference(
    validation.sql_artifact_ref,
    execution.sql_artifact_ref,
    "ExecutionReceipt 与 ValidationReceipt 必须绑定同一 SqlArtifact。",
  );
  const sqlArtifact = requireArtifactType(
    await resolveAuthoritativeL2(execution.sql_artifact_ref, authority),
    "SqlArtifact",
  );
  const queryContract = await verifySqlArtifactLineage(sqlArtifact, authority);
  if (execution.query_hash !== sqlArtifact.query_hash) {
    throw new ArtifactSemanticAuthorityError(
      "ExecutionReceipt.query_hash 必须与已验证 SqlArtifact.query_hash 一致。",
    );
  }
  if (execution.datasource_id !== queryContract.datasource_id) {
    throw new ArtifactSemanticAuthorityError(
      "ExecutionReceipt.datasource_id 必须与上游 QueryContract.datasource_id 一致。",
    );
  }
}

async function verifyArtifactSuccessSemantics(
  document: L2ArtifactDocument,
  authority: L2ArtifactAuthorityContext,
): Promise<void> {
  switch (document.payload.artifact_type) {
    case "ResearchBrief":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.question_frame_ref, authority),
        "QuestionFrame",
      );
      return;
    case "HypothesisSet":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.research_brief_ref, authority),
        "ResearchBrief",
      );
      return;
    case "EvidencePlan":
      await verifyEvidencePlanSemantics(document.payload, authority);
      return;
    case "QueryContract":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.evidence_plan_ref, authority),
        "EvidencePlan",
      );
      return;
    case "GroundingPackage":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.query_contract_ref, authority),
        "QueryContract",
      );
      return;
    case "SemanticQuery":
      await verifySemanticQueryLineage(document.payload, authority);
      return;
    case "LogicalPlan":
      requireArtifactType(
        await resolveAuthoritativeL2(document.payload.semantic_query_ref, authority),
        "SemanticQuery",
      );
      return;
    case "SqlArtifact":
      await verifySqlArtifactLineage(document.payload, authority);
      return;
    case "ValidationReceipt":
      await verifySqlArtifactLineage(
        requireArtifactType(
          await resolveAuthoritativeL2(document.payload.sql_artifact_ref, authority),
          "SqlArtifact",
        ),
        authority,
      );
      return;
    case "ExecutionReceipt":
      await verifyExecutionReceiptSemantics(document.payload, authority);
      return;
    case "QueryEvidence":
      await verifyExecutionReceiptSemantics(
        requireArtifactType(
          await resolveAuthoritativeL2(document.payload.execution_receipt_ref, authority),
          "ExecutionReceipt",
        ),
        authority,
      );
      return;
    case "AtomicClaim": {
      if (document.payload.support_state === "SUPPORTED") {
        await Promise.all(
          document.payload.evidence_refs.map((reference) =>
            requirePassingEvidence(reference, authority),
          ),
        );
      } else {
        await Promise.all(
          document.payload.evidence_refs.map((reference) =>
            resolveAuthoritativeL2(reference, authority).then((evidence) =>
              requireArtifactType(evidence, "QueryEvidence"),
            ),
          ),
        );
      }
      return;
    }
    case "EvidenceRelation":
      await Promise.all([
        resolveAuthoritativeL2(document.payload.claim_ref, authority).then((claim) =>
          requireArtifactType(claim, "AtomicClaim"),
        ),
        resolveAuthoritativeL2(document.payload.evidence_ref, authority).then((evidence) =>
          requireArtifactType(evidence, "QueryEvidence"),
        ),
      ]);
      return;
    case "AnalysisReport":
      await Promise.all(
        document.payload.claim_refs.map((reference) =>
          resolveAuthoritativeL2(reference, authority).then((claim) =>
            requireArtifactType(claim, "AtomicClaim"),
          ),
        ),
      );
      return;
    case "ReportReadyCertificate": {
      const report = requireArtifactType(
        await resolveAuthoritativeL2(document.payload.report_ref, authority),
        "AnalysisReport",
      );
      const claims = await Promise.all(
        report.claim_refs.map(async (reference) =>
          requireArtifactType(await resolveAuthoritativeL2(reference, authority), "AtomicClaim"),
        ),
      );
      if (claims.some(({ support_state }) => support_state !== "SUPPORTED")) {
        throw new ArtifactSemanticAuthorityError(
          "ReportReadyCertificate 不能覆盖 CONFLICTED 或 UNSUPPORTED Claim。",
        );
      }
      const certificateEvidence = new Set(
        document.payload.evidence_refs.map(artifactReferenceIdentity),
      );
      const claimEvidence = claims.flatMap(({ evidence_refs }) => evidence_refs);
      if (
        claimEvidence.some(
          (reference) => !certificateEvidence.has(artifactReferenceIdentity(reference)),
        )
      ) {
        throw new ArtifactSemanticAuthorityError(
          "ReportReadyCertificate 必须覆盖 Report 中全部 Claim Evidence。",
        );
      }
      await Promise.all(
        claimEvidence.map((reference) => requirePassingEvidence(reference, authority)),
      );
      return;
    }
    case "QuestionFrame":
      return;
  }
}

function committerCapabilityClaimFromDocument(
  document: L2ArtifactDocument,
): ArtifactCommitterCapabilityClaim {
  return {
    kind: "artifact-committer",
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    attempt_id: document.envelope.attempt_id,
    artifact_type: document.envelope.artifact_type,
    producer_id: document.envelope.producer.id,
    policy_version: document.envelope.policy_version,
  };
}

export async function authorizeL2ArtifactDocument(
  input: unknown,
  authority: L2ArtifactPersistenceAuthority,
): Promise<AuthoritativeL2ArtifactDocument> {
  const document = l2ArtifactDocumentSchema.parse(input);
  if (document.envelope.status !== "COMMITTED") {
    throw new ArtifactAuthorityError(
      `${document.envelope.status} 不是当前权威 Artifact，只有 COMMITTED Revision 可以授权。`,
    );
  }
  const observedHash = await computeL2ArtifactContentHash(document);
  if (observedHash !== document.envelope.content_hash) {
    throw new ArtifactIntegrityError(
      `Artifact ${document.envelope.artifact_id} 的声明 Hash 与规范化内容不匹配。`,
    );
  }
  const currentReference = artifactReferenceFromDocument(document);
  if (!(await authority.verifyCommitted(currentReference))) {
    throw new ArtifactAuthorityError(
      `Artifact ${document.envelope.artifact_id} 的当前 Revision 尚未由持久化 Authority 提交。`,
    );
  }
  if (
    !(await authority.verifyCommitterCapability(committerCapabilityClaimFromDocument(document)))
  ) {
    throw new ArtifactAuthorityError(
      `Artifact ${document.envelope.artifact_id} 的服务端提交者能力无效或不匹配。`,
    );
  }
  const authorityReferences = [
    ...(document.envelope.parent_ref ? [document.envelope.parent_ref] : []),
    ...document.envelope.input_refs,
  ];
  const inputVerdicts = await Promise.all(
    authorityReferences.map((reference) => authority.verifyCommitted(reference)),
  );
  if (inputVerdicts.some((verdict) => !verdict)) {
    throw new ArtifactInputAuthorityError("Artifact 引用了未提交或不存在的输入。");
  }
  await verifyArtifactSuccessSemantics(document, authority);

  authorizedArtifactDocuments.add(document);
  return deepFreeze(document) as AuthoritativeL2ArtifactDocument;
}

export function isAuthoritativeL2ArtifactDocument(
  value: unknown,
): value is AuthoritativeL2ArtifactDocument {
  return typeof value === "object" && value !== null && authorizedArtifactDocuments.has(value);
}

export type { L2ArtifactPayload };
export type L2ArtifactDocument = z.infer<typeof l2ArtifactDocumentSchema>;
