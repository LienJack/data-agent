import { describe, expect, it } from "vitest";
import {
  ArtifactAuthorityError,
  ArtifactIntegrityError,
  type ArtifactReference,
  artifactEnvelopeSchema,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  type CatalogRelationshipContract,
  computeGroundingHash,
  computeL2ArtifactContentHash,
  hasLogicalPlanDataflow,
  isAuthoritativeMetamorphicOracleReceipt,
  isAuthoritativeResultOracleReceipt,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
  l2ArtifactPayloadSchema,
  logicalOperationSchema,
  resultOracleReceiptSchema,
  TEXT2SQL_GATE_EVALUATOR_VERSION,
  TEXT2SQL_GATE_REASON_CODES,
  TEXT2SQL_RUNTIME_SYSTEM_ARTIFACT_TYPES,
  TEXT2SQL_VALIDATION_VERSION,
  verifyL2ArtifactDocument,
} from "../src/artifacts/index.js";
import { canonicalizeJson } from "../src/common/index.js";
import { createAuthoritativeReadyFixture, sealGateReceipt } from "./authority-fixtures.js";
import {
  environments,
  hashes,
  ids,
  makeArtifactEnvelope,
  makeArtifactReference,
} from "./fixtures.js";

function referenceFromDocument(document: L2ArtifactDocument) {
  return artifactReferenceSchema.parse({
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  });
}

async function resolveL2Document(
  authority: L2ArtifactPersistenceAuthority,
  reference: ArtifactReference,
): Promise<L2ArtifactDocument | null> {
  const parsed = l2ArtifactDocumentSchema.safeParse(await authority.resolveL2(reference));
  return parsed.success ? parsed.data : null;
}

function authorityFor(
  document: L2ArtifactDocument,
  options: {
    currentCommitted?: boolean;
    inputsCommitted?: boolean;
    committerAuthorized?: boolean;
    observedReferences?: string[];
  } = {},
): L2ArtifactPersistenceAuthority {
  const currentIdentity = artifactReferenceIdentity(referenceFromDocument(document));
  return {
    principalId: "principal-fixture",
    verifyCommitted: async (reference) => {
      options.observedReferences?.push(
        `${reference.artifact_type}:${reference.artifact_id}:${reference.revision}`,
      );
      return artifactReferenceIdentity(reference) === currentIdentity
        ? (options.currentCommitted ?? true)
        : (options.inputsCommitted ?? true);
    },
    resolveL2: async () => null,
    verifyCommitterCapability: async () => options.committerAuthorized ?? true,
  };
}

describe("ArtifactEnvelope", () => {
  it("接受首个不可变 Revision 和完整 Version Binding", () => {
    const parsed = artifactEnvelopeSchema.parse(makeArtifactEnvelope());

    expect(parsed.revision).toBe(1);
    expect(parsed.parent_ref).toBeNull();
  });

  it("拒绝跨 App 或 Tenant 的输入引用", () => {
    const envelope = {
      ...makeArtifactEnvelope(),
      input_refs: [
        artifactReferenceSchema.parse({
          artifact_id: ids.inputArtifact,
          artifact_type: "QueryContract",
          app_id: ids.appB,
          tenant_id: ids.tenantB,
          environment: environments.test,
          run_id: ids.run,
          revision: 1,
          content_hash: hashes.input,
        }),
      ],
    };

    expect(artifactEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("拒绝跨 Environment 的输入与父 Revision 引用", () => {
    expect(
      artifactEnvelopeSchema.safeParse({
        ...makeArtifactEnvelope(),
        input_refs: [
          {
            ...makeArtifactReference("QueryContract"),
            environment: environments.staging,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      artifactEnvelopeSchema.safeParse({
        ...makeArtifactEnvelope(),
        revision: 2,
        parent_ref: {
          ...makeArtifactReference("QuestionFrame", ids.artifact),
          environment: environments.staging,
        },
      }).success,
    ).toBe(false);
  });

  it("拒绝断裂的 Revision Ancestry", () => {
    const envelope = {
      ...makeArtifactEnvelope(),
      revision: 3,
      parent_ref: {
        ...makeArtifactReference("QuestionFrame", ids.artifact),
        revision: 1,
      },
    };

    expect(artifactEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("通用 Envelope 支持登记的系统 Artifact，但 L2 Document 仍收窄为 L2", () => {
    const releaseManifestEnvelope = {
      ...makeArtifactEnvelope(),
      artifact_type: "ReleaseManifest",
    };

    expect(artifactEnvelopeSchema.safeParse(releaseManifestEnvelope).success).toBe(true);
    expect(
      l2ArtifactDocumentSchema.safeParse({
        envelope: releaseManifestEnvelope,
        payload: {
          artifact_type: "QuestionFrame",
          raw_question: "收入为什么下降？",
          normalized_question: "解释收入下降原因",
          authorized_datasource_ids: [ids.appA],
          expected_output: "多步研究报告",
        },
      }).success,
    ).toBe(false);
    expect(
      artifactReferenceSchema.safeParse({
        ...makeArtifactReference(),
        artifact_type: "UnknownFutureArtifact",
      }).success,
    ).toBe(false);
  });

  it("拒绝缺失 Version Binding", () => {
    const { semantic_version: _semanticVersion, ...incomplete } = makeArtifactEnvelope();

    expect(artifactEnvelopeSchema.safeParse(incomplete).success).toBe(false);
  });

  it("拒绝可变别名作为权威 ID", () => {
    const envelope = {
      ...makeArtifactEnvelope(),
      artifact_id: "current-artifact",
    };

    expect(artifactEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("概率型 Agent 只能提交 Candidate，不能直接提交权威 Revision", () => {
    const candidate = {
      ...makeArtifactEnvelope(),
      producer: { kind: "agent", id: "research-supervisor" },
      status: "CANDIDATE",
    };

    expect(artifactEnvelopeSchema.safeParse(candidate).success).toBe(true);
    expect(
      artifactEnvelopeSchema.safeParse({
        ...candidate,
        status: "COMMITTED",
      }).success,
    ).toBe(false);
  });
});

describe("L2 Artifact Schema", () => {
  it("解析真实 QuestionFrame Payload 并拒绝未知字段", () => {
    const document = {
      envelope: makeArtifactEnvelope(),
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "2025 年第一季度华南区净收入同比为什么下降？",
        normalized_question: "解释 2025Q1 华南区净收入同比下降的支持证据",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    };

    expect(l2ArtifactDocumentSchema.safeParse(document).success).toBe(true);
    expect(
      l2ArtifactDocumentSchema.safeParse({
        ...document,
        payload: { ...document.payload, hidden_instruction: "扩大权限" },
      }).success,
    ).toBe(false);
  });

  it("拒绝 Payload 内绕过 Envelope Provenance 的跨 Scope Reference", () => {
    const crossScopeReference = artifactReferenceSchema.parse({
      artifact_id: ids.inputArtifact,
      artifact_type: "QuestionFrame",
      app_id: ids.appB,
      tenant_id: ids.tenantB,
      environment: environments.test,
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    });

    expect(
      l2ArtifactDocumentSchema.safeParse({
        envelope: {
          ...makeArtifactEnvelope(),
          artifact_type: "ResearchBrief",
          input_refs: [],
        },
        payload: {
          artifact_type: "ResearchBrief",
          question_frame_ref: crossScopeReference,
          research_goal: "解释收入下降原因",
          success_criteria: ["结论绑定证据"],
          budget: {
            max_steps: 4,
            max_model_calls: 3,
            max_sql_executions: 2,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("ValidationReceipt 必须引用七张不同的 GateReceipt", () => {
    const sqlArtifactReference = artifactReferenceSchema.parse({
      artifact_id: ids.inputArtifact,
      artifact_type: "SqlArtifact",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    });
    const duplicateGateReference = {
      ...makeArtifactReference(),
      artifact_type: "GateReceipt",
    };

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ValidationReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: makeArtifactReference("ExecutionReceipt"),
        gate_receipt_refs: Array.from({ length: 7 }, () => duplicateGateReference),
        validation_version: TEXT2SQL_VALIDATION_VERSION,
        sealed_at: "2026-07-26T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("Text2SQL 权威链必须按五门禁、执行许可、真实执行、七门禁封口的因果顺序", () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");
    const resourceAdmissionReference = makeArtifactReference(
      "ResourceAdmissionReceipt",
      "00000000-0000-4000-8000-000000000350",
    );
    const policyReceiptReference = makeArtifactReference(
      "PolicyReceipt",
      "00000000-0000-4000-8000-000000000349",
    );
    const executionReference = {
      ...makeArtifactReference(),
      artifact_id: "00000000-0000-4000-8000-000000000351",
      artifact_type: "ExecutionReceipt",
    };
    const sandboxReceiptReference = makeArtifactReference(
      "SandboxExecutionReceipt",
      "00000000-0000-4000-8000-000000000352",
    );
    const sandboxResultReference = {
      ...makeArtifactReference("SandboxResult", "00000000-0000-4000-8000-000000000354"),
      content_hash: hashes.artifact,
    };
    const resultOracleReference = makeArtifactReference(
      "ResultOracleReceipt",
      "00000000-0000-4000-8000-000000000355",
    );
    const metamorphicOracleReference = makeArtifactReference(
      "MetamorphicOracleReceipt",
      "00000000-0000-4000-8000-000000000359",
    );
    const preExecutionGates = ["INTENT", "SEMANTIC", "STRUCTURAL", "POLICY", "RESOURCE"] as const;
    const preExecutionObservations = {
      INTENT: {
        query_contract_hash: hashes.input,
        intent_signature_hash: hashes.execution,
      },
      SEMANTIC: {
        logical_plan_hash: hashes.input,
        semantic_hash: hashes.execution,
        grounding_hash: hashes.artifact,
      },
      STRUCTURAL: {
        compiler_version: "postgresql-compiler@1.1.0",
        ast_hash: hashes.artifact,
        query_hash: hashes.execution,
        parameter_count: 1,
        statement_kind: "SELECT",
        read_only: true,
      },
      POLICY: {
        policy_version: "default-policy@1.0.0",
        mandatory_predicate_count: 1,
        resolved_binding_count: 1,
      },
      RESOURCE: {
        estimate_hash: hashes.artifact,
        policy_version: "resource-policy@1.0.0",
        total_cost: 10,
        plan_rows: 100,
        plan_width: 64,
        planned_bytes: 6_400,
        lock_timeout_ms: 1_000,
        timeout_ms: 5_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
        max_memory_mb: 512,
      },
    } as const;
    const gateReferences = [...preExecutionGates, "EXECUTION", "RESULT"].map((_gate, index) => ({
      ...makeArtifactReference(),
      artifact_id: `00000000-0000-4000-8000-${String(360 + index).padStart(12, "0")}`,
      artifact_type: "GateReceipt",
      content_hash: `sha256:${String(index + 1).repeat(64)}`,
    }));
    const executionPermitReference = {
      ...makeArtifactReference(),
      artifact_id: "00000000-0000-4000-8000-000000000353",
      artifact_type: "ExecutionPermit",
    };

    for (const [index, gate] of preExecutionGates.entries()) {
      expect(
        l2ArtifactPayloadSchema.safeParse({
          artifact_type: "GateReceipt",
          sql_artifact_ref: sqlArtifactReference,
          execution_receipt_ref: null,
          gate,
          gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
          evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
          input_hash: hashes.input,
          evaluator_input_hash: hashes.execution,
          evaluator_evaluation_hash: hashes.artifact,
          evaluation_hash: hashes.artifact,
          verdict: "PASS",
          reason_code: TEXT2SQL_GATE_REASON_CODES[gate].PASS[0],
          evidence_refs:
            gate === "RESOURCE"
              ? [sqlArtifactReference, resourceAdmissionReference]
              : [sqlArtifactReference],
          observations: preExecutionObservations[gate],
          evaluated_at: "2026-07-26T00:00:00.000Z",
        }).success,
        `第 ${index + 1} 个执行前 GateReceipt 应能独立封存`,
      ).toBe(true);
    }

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ExecutionPermit",
        sql_artifact_ref: sqlArtifactReference,
        resource_admission_ref: resourceAdmissionReference,
        gate_receipt_refs: gateReferences.slice(0, 5),
        principal_id: "principal-fixture",
        policy_receipt_ref: policyReceiptReference,
        datasource_id: ids.appA,
        schema_version: "retail-schema@1.0.0",
        settings_hash: hashes.input,
        execution_settings: {
          database_role: "analyst",
          search_path: ["app_data_agent", "pg_catalog"],
          plan_cache_mode: "force_custom_plan",
          statement_timeout_ms: 5_000,
          lock_timeout_ms: 1_000,
        },
        budget: {
          timeout_ms: 5_000,
          lock_timeout_ms: 1_000,
          max_rows: 1_000,
          max_bytes: 1_000_000,
          max_memory_mb: 512,
        },
        issued_at: "2026-07-26T00:00:00.000Z",
        expires_at: "2026-07-26T00:05:00.000Z",
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ExecutionReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_permit_ref: executionPermitReference,
        sandbox_execution_receipt_ref: sandboxReceiptReference,
        result_artifact_ref: sandboxResultReference,
        datasource_id: ids.appA,
        schema_version: "1.0.0",
        snapshot_token: "snapshot-1",
        watermark: "watermark-1",
        observed_at: "2026-07-26T00:00:01.000Z",
        query_hash: hashes.execution,
        result_hash: hashes.artifact,
        replay_state: "REPLAYABLE",
        row_count: 1,
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "GateReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        gate: "RESULT",
        gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        input_hash: hashes.input,
        evaluator_input_hash: hashes.execution,
        evaluator_evaluation_hash: hashes.artifact,
        evaluation_hash: hashes.execution,
        verdict: "PASS",
        reason_code: "RESULT_VERIFIED",
        evidence_refs: [sandboxResultReference, metamorphicOracleReference, resultOracleReference],
        observations: {
          result_hash: hashes.artifact,
          oracle_version: "result-oracle@1.0.0",
          invariant_ids: ["non-empty"],
          oracle_evidence_hash: sandboxResultReference.content_hash,
        },
        evaluated_at: "2026-07-26T00:00:02.000Z",
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ValidationReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        gate_receipt_refs: gateReferences,
        validation_version: TEXT2SQL_VALIDATION_VERSION,
        sealed_at: "2026-07-26T00:00:03.000Z",
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "QueryEvidence",
        execution_receipt_ref: executionReference,
        validation_receipt_ref: {
          ...makeArtifactReference(),
          artifact_type: "ValidationReceipt",
        },
        result_hash: hashes.artifact,
        invariant_verdicts: [{ invariant_id: "non-empty", verdict: "PASS" }],
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ValidationReceipt",
        sql_artifact_ref: sqlArtifactReference,
        gates: [...preExecutionGates, "EXECUTION", "RESULT"].map((gate) => ({
          gate,
          verdict: "PASS",
          reason_code: "VALIDATION_PASSED",
        })),
      }).success,
      "旧结构会在执行前伪造 EXECUTION/RESULT PASS，必须拒绝",
    ).toBe(false);
  });

  it("Execution/Evidence/Ready Certificate 不能跳过成功链必需证明", () => {
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ExecutionReceipt",
        sql_artifact_ref: makeArtifactReference("SqlArtifact"),
        sandbox_execution_receipt_ref: makeArtifactReference("SandboxExecutionReceipt"),
        datasource_id: ids.appA,
        schema_version: "1.0.0",
        snapshot_token: "snapshot-1",
        watermark: "watermark-1",
        observed_at: "2026-07-25T00:00:00.000Z",
        query_hash: hashes.execution,
        result_hash: hashes.artifact,
        replay_state: "REPLAYABLE",
        row_count: 1,
      }).success,
    ).toBe(false);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "QueryEvidence",
        execution_receipt_ref: makeArtifactReference("ExecutionReceipt"),
        validation_receipt_ref: makeArtifactReference("ValidationReceipt"),
        result_hash: hashes.execution,
        invariant_verdicts: [],
      }).success,
    ).toBe(false);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ReportReadyCertificate",
        report_ref: makeArtifactReference("AnalysisReport"),
        gate_version: "1.0.0",
        gate_results: [],
        evidence_refs: [makeArtifactReference("QueryEvidence")],
        decision: "READY",
        certificate_hash: hashes.execution,
      }).success,
    ).toBe(false);
  });

  it("LogicalPlan 首版没有 QueryContract order/limit 语义，公开契约拒绝 Sort/Limit", () => {
    expect(
      logicalOperationSchema.safeParse({
        operation: "sort",
        operation_id: "sort_result",
        input_id: "project_result",
        keys: [{ source_id: "metric.net_revenue", direction: "desc" }],
      }).success,
    ).toBe(false);
    expect(
      logicalOperationSchema.safeParse({
        operation: "limit",
        operation_id: "limit_result",
        input_id: "project_result",
        count: 100,
      }).success,
    ).toBe(false);
  });

  it("LogicalPlan Join 按子树 lineage 与 preserved side 接受正常 INNER/LEFT", () => {
    const innerRelationship: CatalogRelationshipContract = {
      relationship_id: "relationship.orders_customers_inner",
      left_table_id: "orders",
      left_column_ids: ["orders.customer_id"],
      right_table_id: "customers",
      right_column_ids: ["customers.id"],
      cardinality: "many-to-one",
      left_row_match: "required",
      right_row_match: "required",
    };
    expect(
      hasLogicalPlanDataflow(
        [
          {
            operation: "scan",
            operation_id: "scan_orders",
            table_id: "orders",
            alias: "orders",
            column_ids: ["orders.customer_id"],
          },
          {
            operation: "scan",
            operation_id: "scan_customers",
            table_id: "customers",
            alias: "customers",
            column_ids: ["customers.id"],
          },
          {
            operation: "join",
            operation_id: "join_customers",
            left_input_id: "scan_orders",
            right_input_id: "scan_customers",
            relationship: innerRelationship,
            join_type: "inner",
          },
        ],
        "orders",
      ),
    ).toBe(true);

    const optionalRelationship: CatalogRelationshipContract = {
      ...innerRelationship,
      relationship_id: "relationship.orders_customers_left",
      left_row_match: "optional",
    };
    expect(
      hasLogicalPlanDataflow(
        [
          {
            operation: "scan",
            operation_id: "scan_orders",
            table_id: "orders",
            alias: "orders",
            column_ids: ["orders.customer_id"],
          },
          {
            operation: "scan",
            operation_id: "scan_customers",
            table_id: "customers",
            alias: "customers",
            column_ids: ["customers.id"],
          },
          {
            operation: "join",
            operation_id: "join_customers",
            left_input_id: "scan_orders",
            right_input_id: "scan_customers",
            relationship: optionalRelationship,
            join_type: "left",
          },
        ],
        "orders",
      ),
    ).toBe(true);
    expect(
      hasLogicalPlanDataflow(
        [
          {
            operation: "scan",
            operation_id: "scan_orders",
            table_id: "orders",
            alias: "orders",
            column_ids: ["orders.customer_id"],
          },
          {
            operation: "scan",
            operation_id: "scan_customers",
            table_id: "customers",
            alias: "customers",
            column_ids: ["customers.id"],
          },
          {
            operation: "join",
            operation_id: "join_customers",
            left_input_id: "scan_orders",
            right_input_id: "scan_customers",
            relationship: optionalRelationship,
            join_type: "inner",
          },
        ],
        "orders",
      ),
      "preserved orders 的匹配可选时不能降级成 INNER JOIN",
    ).toBe(false);
  });

  it("LogicalPlan Dataflow 拒绝重复消费关系后用 endpoint presence 绕过 preserved side", () => {
    const optionalRelationship: CatalogRelationshipContract = {
      relationship_id: "relationship.orders_customers",
      left_table_id: "orders",
      left_column_ids: ["orders.customer_id"],
      right_table_id: "customers",
      right_column_ids: ["customers.id"],
      cardinality: "many-to-one",
      left_row_match: "optional",
      right_row_match: "required",
    };
    expect(
      hasLogicalPlanDataflow(
        [
          {
            operation: "scan",
            operation_id: "scan_orders_a",
            table_id: "orders",
            alias: "orders_a",
            column_ids: ["orders.customer_id"],
          },
          {
            operation: "scan",
            operation_id: "scan_customers_a",
            table_id: "customers",
            alias: "customers_a",
            column_ids: ["customers.id"],
          },
          {
            operation: "join",
            operation_id: "left_subtree_a",
            left_input_id: "scan_orders_a",
            right_input_id: "scan_customers_a",
            relationship: optionalRelationship,
            join_type: "left",
          },
          {
            operation: "scan",
            operation_id: "scan_orders_b",
            table_id: "orders",
            alias: "orders_b",
            column_ids: ["orders.customer_id"],
          },
          {
            operation: "scan",
            operation_id: "scan_customers_b",
            table_id: "customers",
            alias: "customers_b",
            column_ids: ["customers.id"],
          },
          {
            operation: "join",
            operation_id: "left_subtree_b",
            left_input_id: "scan_orders_b",
            right_input_id: "scan_customers_b",
            relationship: optionalRelationship,
            join_type: "left",
          },
          {
            operation: "join",
            operation_id: "endpoint_presence_bypass",
            left_input_id: "left_subtree_a",
            right_input_id: "left_subtree_b",
            relationship: optionalRelationship,
            join_type: "inner",
          },
        ],
        "orders",
      ),
    ).toBe(false);
  });

  it("拒绝 Payload Reference 用错误 artifact_type 冒充已声明输入", () => {
    const declaredReference = artifactReferenceSchema.parse({
      artifact_id: ids.inputArtifact,
      artifact_type: "QuestionFrame",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    });

    expect(
      l2ArtifactDocumentSchema.safeParse({
        envelope: {
          ...makeArtifactEnvelope(),
          artifact_type: "ResearchBrief",
          input_refs: [declaredReference],
        },
        payload: {
          artifact_type: "ResearchBrief",
          question_frame_ref: {
            ...declaredReference,
            artifact_type: "SqlArtifact",
          },
          research_goal: "解释收入下降原因",
          success_criteria: ["结论绑定证据"],
          budget: {
            max_steps: 4,
            max_model_calls: 3,
            max_sql_executions: 2,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("GroundingPackage、SemanticQuery 与 LogicalPlan 只接受 ACL 绑定和类型化 IR", () => {
    const queryContractReference = makeArtifactReference("QueryContract");
    const groundingReference = makeArtifactReference("GroundingPackage");
    const semanticReleaseReference = {
      ...makeArtifactReference(),
      artifact_type: "SemanticRelease",
    };
    const schemaSnapshotReference = {
      ...makeArtifactReference(),
      artifact_type: "SchemaSnapshot",
    };
    const policyReceiptReference = {
      ...makeArtifactReference(),
      artifact_type: "PolicyReceipt",
    };
    const metric = {
      metric_id: "metric.net_revenue",
      aliases: ["净收入"],
      table_id: "orders",
      column_id: "orders.net_amount",
      aggregation: "sum",
      grain: "order",
      unit: "CNY",
      time_column_id: "orders.created_at",
      additivity: "additive",
      null_policy: "coalesce-zero",
      dependency_column_ids: ["orders.net_amount"],
      fanout_policy: "preaggregate",
    };
    const groundingPayload = {
      artifact_type: "GroundingPackage",
      query_contract_ref: queryContractReference,
      semantic_release_ref: semanticReleaseReference,
      schema_snapshot_ref: schemaSnapshotReference,
      policy_receipt_ref: policyReceiptReference,
      catalog_version: "commerce-catalog@1.0.0",
      policy_version: "analyst-policy@1.0.0",
      datasource_id: ids.appA,
      allowed_schema: {
        tables: [
          {
            table_id: "orders",
            physical_name: "orders",
            columns: [
              {
                column_id: "orders.net_amount",
                physical_name: "net_amount",
                data_type: "numeric",
                nullable: true,
                sensitivity: "INTERNAL",
              },
              {
                column_id: "orders.created_at",
                physical_name: "created_at",
                data_type: "timestamptz",
                nullable: false,
                sensitivity: "INTERNAL",
              },
            ],
          },
        ],
      },
      metric,
      dimensions: [],
      required_column_ids: ["orders.created_at", "orders.net_amount"],
      mandatory_predicates: [],
      join_closure: {
        root_table_id: "orders",
        table_ids: ["orders"],
        edges: [],
        preaggregations: [],
      },
      accepted_candidate_ids: ["metric.net_revenue"],
      conflict_set: [],
      grounding_hash: hashes.artifact,
    };
    expect(l2ArtifactPayloadSchema.safeParse(groundingPayload).success).toBe(true);

    const closureRelationship = {
      relationship_id: "relationship.orders_customers",
      left_table_id: "orders",
      left_column_ids: ["orders.customer_id"],
      right_table_id: "customers",
      right_column_ids: ["customers.id"],
      cardinality: "many-to-one",
      left_row_match: "optional",
      right_row_match: "required",
    } as const;
    const groundingWithRelationship = {
      ...groundingPayload,
      join_closure: {
        ...groundingPayload.join_closure,
        table_ids: ["orders", "customers"],
        edges: [closureRelationship],
      },
    };
    expect(l2ArtifactPayloadSchema.safeParse(groundingWithRelationship).success).toBe(true);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        ...groundingWithRelationship,
        join_closure: {
          ...groundingWithRelationship.join_closure,
          edges: [closureRelationship, closureRelationship],
        },
      }).success,
      "同一个 relationship_id 不能作为两条 Join Closure edge 重复授权",
    ).toBe(false);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        ...groundingWithRelationship,
        join_closure: {
          ...groundingWithRelationship.join_closure,
          edges: [
            closureRelationship,
            {
              relationship_id: "relationship.customers_orders_alias",
              left_table_id: closureRelationship.right_table_id,
              left_column_ids: closureRelationship.right_column_ids,
              right_table_id: closureRelationship.left_table_id,
              right_column_ids: closureRelationship.left_column_ids,
              cardinality: "one-to-many",
              left_row_match: closureRelationship.right_row_match,
              right_row_match: closureRelationship.left_row_match,
            },
          ],
        },
      }).success,
      "不同 relationship_id 也不能反向重复授权同一组 Join Key",
    ).toBe(false);

    const semanticPayload = {
      artifact_type: "SemanticQuery",
      query_contract_ref: queryContractReference,
      grounding_package_ref: groundingReference,
      metric,
      dimensions: [],
      predicates: [
        {
          kind: "comparison",
          left: { table_id: "orders", column_id: "orders.created_at" },
          operator: "gte",
          right: { parameter_key: "time.start" },
          authority: "time",
        },
      ],
      time_predicate: {
        field: { table_id: "orders", column_id: "orders.created_at" },
        lower: { parameter_key: "time.start", inclusive: true },
        upper: { parameter_key: "time.end", inclusive: false },
        timezone: "Asia/Shanghai",
      },
      parameters: {
        "time.start": { source: "time", value: "2026-06-01T00:00:00.000+08:00" },
        "time.end": { source: "time", value: "2026-07-01T00:00:00.000+08:00" },
      },
      grounding_hash: hashes.artifact,
      result_contract: {
        columns: ["metric.net_revenue"],
        invariant_ids: ["non_negative_revenue"],
      },
    };
    expect(l2ArtifactPayloadSchema.safeParse(semanticPayload).success).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "SemanticQuery",
        query_contract_ref: queryContractReference,
        grounding_package_ref: groundingReference,
        metric_ref: "metric.net_revenue",
        dimension_refs: [],
        filter_expressions: ["orders.created_at BETWEEN :start AND :end"],
      }).success,
      "自由 SQL Predicate 不能进入权威 SemanticQuery",
    ).toBe(false);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "LogicalPlan",
        semantic_query_ref: makeArtifactReference("SemanticQuery"),
        operations: [
          {
            operation: "scan",
            operation_id: "scan_orders",
            table_id: "orders",
            alias: "t_orders",
            column_ids: ["orders.created_at", "orders.net_amount"],
          },
          {
            operation: "filter",
            operation_id: "filter_time",
            input_id: "scan_orders",
            predicates: semanticPayload.predicates,
          },
          {
            operation: "aggregate",
            operation_id: "aggregate_metric",
            input_id: "filter_time",
            group_by: [],
            measures: [
              {
                metric_id: "metric.net_revenue",
                function: "sum",
                field: { table_id: "orders", column_id: "orders.net_amount" },
                alias: "metric.net_revenue",
                unit: "CNY",
                null_policy: "coalesce-zero",
                distinct: false,
              },
            ],
          },
          {
            operation: "project",
            operation_id: "project_result",
            input_id: "aggregate_metric",
            columns: [
              {
                source_kind: "measure",
                source_id: "metric.net_revenue",
                alias: "metric.net_revenue",
              },
            ],
          },
        ],
        root_operation_id: "project_result",
        parameters: semanticPayload.parameters,
        grounding_hash: hashes.artifact,
        semantic_signature: {
          metric_id: "metric.net_revenue",
          dimension_ids: [],
          grain: "order",
          unit: "CNY",
          time_semantics: "HALF_OPEN",
        },
      }).success,
    ).toBe(true);
  });

  it("确定性授权入口把 content_hash 绑定到 Payload 和 Version Tuple", async () => {
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: makeArtifactEnvelope(),
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "2025 年第一季度华南区净收入同比为什么下降？",
        normalized_question: "解释 2025Q1 华南区净收入同比下降的支持证据",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    });
    const contentHash = await computeL2ArtifactContentHash(draft);
    const committed = {
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: contentHash,
      },
    };

    const parsedCommitted = l2ArtifactDocumentSchema.parse(committed);
    const authority = authorityFor(parsedCommitted);
    const authorized = await verifyL2ArtifactDocument(parsedCommitted, authority);
    expect(authorized).toMatchObject(committed);
    expect(Object.isFrozen(authorized)).toBe(true);
    expect(Object.isFrozen(authorized.payload)).toBe(true);
    await expect(
      verifyL2ArtifactDocument(
        {
          ...committed,
          payload: {
            ...committed.payload,
            normalized_question: "被篡改但复用旧 Hash 的问题",
          },
        },
        authority,
      ),
    ).rejects.toBeInstanceOf(ArtifactIntegrityError);
  });

  it("Candidate 即使 Hash 正确也不能取得权威 Artifact 品牌", async () => {
    const candidate = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        producer: {
          kind: "agent",
          id: "research-supervisor",
        },
        status: "CANDIDATE",
      },
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    });
    const contentHash = await computeL2ArtifactContentHash(candidate);

    await expect(
      verifyL2ArtifactDocument(
        {
          ...candidate,
          envelope: {
            ...candidate.envelope,
            content_hash: contentHash,
          },
        },
        authorityFor(candidate),
      ),
    ).rejects.toThrow("只有 COMMITTED Revision 可以授权");
  });

  it.each(["REJECTED", "SUPERSEDED"] as const)(
    "%s Revision 即使 Hash 正确也不能取得权威品牌",
    async (status) => {
      const document = l2ArtifactDocumentSchema.parse({
        envelope: {
          ...makeArtifactEnvelope(),
          status,
        },
        payload: {
          artifact_type: "QuestionFrame",
          raw_question: "收入为什么下降？",
          normalized_question: "解释收入下降原因",
          authorized_datasource_ids: [ids.appA],
          expected_output: "多步研究报告",
        },
      });
      const contentHash = await computeL2ArtifactContentHash(document);

      await expect(
        verifyL2ArtifactDocument(
          {
            ...document,
            envelope: {
              ...document.envelope,
              content_hash: contentHash,
            },
          },
          authorityFor(document),
        ),
      ).rejects.toThrow("只有 COMMITTED Revision 可以授权");
    },
  );

  it("Hash 正确也不能授权不存在的输入 Artifact", async () => {
    const questionReference = artifactReferenceSchema.parse({
      artifact_id: ids.inputArtifact,
      artifact_type: "QuestionFrame",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    });
    const document = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "ResearchBrief",
        input_refs: [questionReference],
      },
      payload: {
        artifact_type: "ResearchBrief",
        question_frame_ref: questionReference,
        research_goal: "解释收入下降原因",
        success_criteria: ["结论绑定证据"],
        budget: {
          max_steps: 4,
          max_model_calls: 3,
          max_sql_executions: 2,
        },
      },
    });
    const contentHash = await computeL2ArtifactContentHash(document);

    const committed = l2ArtifactDocumentSchema.parse({
      ...document,
      envelope: {
        ...document.envelope,
        content_hash: contentHash,
      },
    });

    await expect(
      verifyL2ArtifactDocument(committed, authorityFor(committed, { inputsCommitted: false })),
    ).rejects.toThrow("未提交或不存在的输入");
  });

  it("后续 Revision 必须验证完整 parent_ref 已提交", async () => {
    const parentReference = artifactReferenceSchema.parse({
      ...makeArtifactReference("QuestionFrame", ids.artifact),
      revision: 1,
    });
    const document = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        revision: 2,
        parent_ref: parentReference,
      },
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    });
    const contentHash = await computeL2ArtifactContentHash(document);
    const observedReferences: string[] = [];

    const committed = l2ArtifactDocumentSchema.parse({
      ...document,
      envelope: {
        ...document.envelope,
        content_hash: contentHash,
      },
    });

    await expect(
      verifyL2ArtifactDocument(
        committed,
        authorityFor(committed, {
          inputsCommitted: false,
          observedReferences,
        }),
      ),
    ).rejects.toThrow("未提交或不存在的输入");
    expect(observedReferences).toEqual([
      `QuestionFrame:${ids.artifact}:2`,
      `QuestionFrame:${ids.artifact}:1`,
    ]);
  });

  it("调用方自报 deterministic/COMMITTED 但当前 Revision 未持久化时拒绝授权", async () => {
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: makeArtifactEnvelope(),
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    });
    const committed = l2ArtifactDocumentSchema.parse({
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: await computeL2ArtifactContentHash(draft),
      },
    });

    await expect(
      verifyL2ArtifactDocument(committed, authorityFor(committed, { currentCommitted: false })),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
  });

  it("单次根校验缓存不能跨调用复用已撤销的持久化结论", async () => {
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: makeArtifactEnvelope(),
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    });
    const committed = l2ArtifactDocumentSchema.parse({
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: await computeL2ArtifactContentHash(draft),
      },
    });
    const persistenceState = { currentCommitted: true };
    const authority = authorityFor(committed, persistenceState);

    await expect(verifyL2ArtifactDocument(committed, authority)).resolves.toEqual(committed);
    persistenceState.currentCommitted = false;
    await expect(verifyL2ArtifactDocument(committed, authority)).rejects.toBeInstanceOf(
      ArtifactAuthorityError,
    );
  });

  it("当前 Revision 已持久化但服务端提交者能力不匹配时拒绝授权", async () => {
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: makeArtifactEnvelope(),
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: [ids.appA],
        expected_output: "多步研究报告",
      },
    });
    const committed = l2ArtifactDocumentSchema.parse({
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: await computeL2ArtifactContentHash(draft),
      },
    });

    await expect(
      verifyL2ArtifactDocument(committed, authorityFor(committed, { committerAuthorized: false })),
    ).rejects.toThrow("服务端提交者能力无效或不匹配");
  });

  it("研究规划 Artifact 要求类型化上游引用以及唯一 ID", () => {
    const researchBriefReference = makeArtifactReference("ResearchBrief");
    const hypothesisSetReference = makeArtifactReference("HypothesisSet");
    const hypothesisId = "00000000-0000-4000-8000-000000000401";
    const obligationId = "00000000-0000-4000-8000-000000000402";

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "HypothesisSet",
        hypotheses: [],
      }).success,
    ).toBe(false);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "HypothesisSet",
        research_brief_ref: researchBriefReference,
        hypotheses: [
          {
            hypothesis_id: hypothesisId,
            statement: "假设 A",
            differentiating_prediction: "预测 A",
          },
          {
            hypothesis_id: hypothesisId,
            statement: "假设 B",
            differentiating_prediction: "预测 B",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "EvidencePlan",
        hypothesis_set_ref: hypothesisSetReference,
        obligations: [
          {
            obligation_id: obligationId,
            hypothesis_id: hypothesisId,
            question: "验证 A",
            source_kind: "sql",
          },
          {
            obligation_id: obligationId,
            hypothesis_id: hypothesisId,
            question: "复核 A",
            source_kind: "document",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("QueryContract 与 SemanticQuery 显式绑定 EvidencePlan 和 GroundingPackage", () => {
    const queryContract = {
      artifact_type: "QueryContract" as const,
      evidence_plan_ref: makeArtifactReference("EvidencePlan"),
      metric: "net_revenue",
      dimensions: ["region"],
      grain: "order",
      time_range: {
        start: "2025-01-01T00:00:00.000+08:00",
        end: "2025-04-01T00:00:00.000+08:00",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      unit: "CNY",
      filters: [],
      datasource_id: ids.appA,
      result_contract: {
        columns: ["region", "net_revenue"],
        invariant_ids: ["non_empty"],
      },
    };
    const { evidence_plan_ref: _evidencePlanRef, ...queryContractWithoutPlan } = queryContract;
    expect(l2ArtifactPayloadSchema.safeParse(queryContract).success).toBe(true);
    expect(l2ArtifactPayloadSchema.safeParse(queryContractWithoutPlan).success).toBe(false);

    const semanticQuery = {
      artifact_type: "SemanticQuery" as const,
      query_contract_ref: makeArtifactReference("QueryContract"),
      grounding_package_ref: makeArtifactReference("GroundingPackage"),
      metric: {
        metric_id: "net_revenue",
        aliases: ["净收入"],
        table_id: "orders",
        column_id: "orders.net_revenue",
        aggregation: "sum",
        grain: "order",
        unit: "CNY",
        time_column_id: "orders.created_at",
        additivity: "additive",
        null_policy: "coalesce-zero",
        dependency_column_ids: ["orders.net_revenue"],
        fanout_policy: "preaggregate",
      },
      dimensions: [
        {
          dimension_id: "region",
          aliases: ["地区"],
          table_id: "orders",
          column_id: "orders.region",
          grain: "order",
        },
      ],
      predicates: [],
      time_predicate: {
        field: { table_id: "orders", column_id: "orders.created_at" },
        lower: { parameter_key: "time.start", inclusive: true },
        upper: { parameter_key: "time.end", inclusive: false },
        timezone: "Asia/Shanghai",
      },
      parameters: {
        "time.start": { source: "time", value: queryContract.time_range.start },
        "time.end": { source: "time", value: queryContract.time_range.end },
      },
      grounding_hash: hashes.artifact,
      result_contract: queryContract.result_contract,
    };
    const { grounding_package_ref: _groundingPackageRef, ...semanticQueryWithoutGrounding } =
      semanticQuery;
    expect(l2ArtifactPayloadSchema.safeParse(semanticQuery).success).toBe(true);
    expect(l2ArtifactPayloadSchema.safeParse(semanticQueryWithoutGrounding).success).toBe(false);
  });

  it("研究链拒绝无法解析的权威上游与不闭合的证据义务", async () => {
    const unresolvedResearchBrief = makeArtifactReference("ResearchBrief");
    const hypothesisDraft = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_id: "00000000-0000-4000-8000-000000000411",
        artifact_type: "HypothesisSet",
        input_refs: [unresolvedResearchBrief],
      },
      payload: {
        artifact_type: "HypothesisSet",
        research_brief_ref: unresolvedResearchBrief,
        hypotheses: [
          {
            hypothesis_id: "00000000-0000-4000-8000-000000000412",
            statement: "假设 A",
            differentiating_prediction: "预测 A",
          },
          {
            hypothesis_id: "00000000-0000-4000-8000-000000000413",
            statement: "假设 B",
            differentiating_prediction: "预测 B",
          },
        ],
      },
    });
    const hypothesisDocument = l2ArtifactDocumentSchema.parse({
      ...hypothesisDraft,
      envelope: {
        ...hypothesisDraft.envelope,
        content_hash: await computeL2ArtifactContentHash(hypothesisDraft),
      },
    });
    await expect(
      verifyL2ArtifactDocument(hypothesisDocument, authorityFor(hypothesisDocument)),
    ).rejects.toThrow("没有匹配的权威 L2 文档");

    const fixture = await createAuthoritativeReadyFixture();
    await expect(
      fixture.commit(
        "EvidencePlan",
        "00000000-0000-4000-8000-000000000414",
        [fixture.references.hypothesisSet],
        {
          artifact_type: "EvidencePlan",
          hypothesis_set_ref: fixture.references.hypothesisSet,
          obligations: [
            {
              obligation_id: "00000000-0000-4000-8000-000000000415",
              hypothesis_id: "00000000-0000-4000-8000-000000000416",
              question: "验证不存在的假设",
              source_kind: "sql",
            },
          ],
        },
      ),
    ).rejects.toThrow("不属于上游 HypothesisSet");
    await expect(
      fixture.commit(
        "EvidencePlan",
        "00000000-0000-4000-8000-000000000417",
        [fixture.references.hypothesisSet],
        {
          artifact_type: "EvidencePlan",
          hypothesis_set_ref: fixture.references.hypothesisSet,
          obligations: [
            {
              obligation_id: "00000000-0000-4000-8000-000000000418",
              hypothesis_id: fixture.hypothesisIds.revenue,
              question: "只覆盖一个竞争假设",
              source_kind: "sql",
            },
          ],
        },
      ),
    ).rejects.toThrow("每个竞争假设定义至少一项证据义务");
  });

  it("QueryContract 只能使用冻结 QuestionFrame 授权的数据源", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const source = await resolveL2Document(fixture.authority, fixture.references.queryContract);
    if (source?.payload.artifact_type !== "QueryContract") {
      throw new Error("测试 Fixture 缺少 QueryContract。");
    }

    await expect(
      fixture.commit(
        "QueryContract",
        "00000000-0000-4000-8000-000000000440",
        [source.payload.evidence_plan_ref],
        {
          ...source.payload,
          datasource_id: ids.appB,
        },
      ),
    ).rejects.toThrow(
      "QueryContract.datasource_id 必须属于上游 QuestionFrame.authorized_datasource_ids",
    );
  });

  it("ExecutionReceipt 必须绑定规范 SQL Hash 与 QueryContract Datasource", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    await expect(
      fixture.commit(
        "SqlArtifact",
        "00000000-0000-4000-8000-000000000420",
        [fixture.references.logicalPlan],
        {
          artifact_type: "SqlArtifact",
          logical_plan_ref: fixture.references.logicalPlan,
          compiler_version: "postgresql-compiler@1.1.0",
          ast_hash: hashes.artifact,
          dialect: "postgresql",
          sql: "SELECT SUM(net_revenue) FROM orders",
          parameters: {},
          query_hash: hashes.artifact,
        },
      ),
    ).rejects.toThrow("与 dialect/sql/parameters 的规范内容不匹配");
    await expect(
      fixture.commit(
        "ExecutionReceipt",
        "00000000-0000-4000-8000-000000000421",
        [
          fixture.references.sqlArtifact,
          fixture.references.executionPermit,
          fixture.references.sandboxReceipt,
          fixture.references.sandboxResult,
        ],
        {
          artifact_type: "ExecutionReceipt",
          sql_artifact_ref: fixture.references.sqlArtifact,
          execution_permit_ref: fixture.references.executionPermit,
          sandbox_execution_receipt_ref: fixture.references.sandboxReceipt,
          result_artifact_ref: fixture.references.sandboxResult,
          datasource_id: ids.appA,
          schema_version: "1.0.0",
          snapshot_token: "snapshot-1",
          watermark: "watermark-1",
          observed_at: "2026-07-25T00:00:00.000Z",
          query_hash: hashes.artifact,
          result_hash: hashes.execution,
          replay_state: "REPLAYABLE",
          row_count: 1,
        },
      ),
    ).rejects.toThrow("必须与已验证 SqlArtifact.query_hash 一致");
    await expect(
      fixture.commit(
        "ExecutionReceipt",
        "00000000-0000-4000-8000-000000000422",
        [
          fixture.references.sqlArtifact,
          fixture.references.executionPermit,
          fixture.references.sandboxReceipt,
          fixture.references.sandboxResult,
        ],
        {
          artifact_type: "ExecutionReceipt",
          sql_artifact_ref: fixture.references.sqlArtifact,
          execution_permit_ref: fixture.references.executionPermit,
          sandbox_execution_receipt_ref: fixture.references.sandboxReceipt,
          result_artifact_ref: fixture.references.sandboxResult,
          datasource_id: ids.appB,
          schema_version: "1.0.0",
          snapshot_token: "snapshot-1",
          watermark: "watermark-1",
          observed_at: "2026-07-25T00:00:00.000Z",
          query_hash: fixture.queryHash,
          result_hash: hashes.execution,
          replay_state: "REPLAYABLE",
          row_count: 1,
        },
      ),
    ).rejects.toThrow(
      "ExecutionReceipt 的 Datasource/Schema 必须与上游 QueryContract 和 ExecutionPermit 一致",
    );
  });

  it("GroundingPackage authority 拒绝与 QueryContract 漂移的 Datasource 和内容 Hash", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const source = await resolveL2Document(fixture.authority, fixture.references.groundingPackage);
    if (source?.payload.artifact_type !== "GroundingPackage") {
      throw new Error("测试 Fixture 缺少 GroundingPackage。");
    }

    await expect(
      fixture.commit(
        "GroundingPackage",
        "00000000-0000-4000-8000-000000000431",
        [
          source.payload.query_contract_ref,
          source.payload.semantic_release_ref,
          source.payload.schema_snapshot_ref,
          source.payload.policy_receipt_ref,
        ],
        {
          ...source.payload,
          datasource_id: ids.appB,
        },
      ),
    ).rejects.toThrow("GroundingPackage.datasource_id");

    await expect(
      fixture.commit(
        "GroundingPackage",
        "00000000-0000-4000-8000-000000000432",
        [
          source.payload.query_contract_ref,
          source.payload.semantic_release_ref,
          source.payload.schema_snapshot_ref,
          source.payload.policy_receipt_ref,
        ],
        {
          ...source.payload,
          accepted_candidate_ids: ["metric.drifted"],
        },
      ),
    ).rejects.toThrow("GroundingPackage.grounding_hash");

    const expandedPayload = {
      ...source.payload,
      allowed_schema: {
        tables: source.payload.allowed_schema.tables.map((table) => ({
          ...table,
          columns: [
            ...table.columns,
            {
              column_id: "orders.secret_salary",
              physical_name: "secret_salary",
              data_type: "numeric" as const,
              nullable: false,
              sensitivity: "SECRET" as const,
            },
          ],
        })),
      },
    };
    const {
      artifact_type: _artifactType,
      query_contract_ref: _queryContractRef,
      semantic_release_ref: _semanticReleaseRef,
      schema_snapshot_ref: _schemaSnapshotRef,
      policy_receipt_ref: _policyReceiptRef,
      grounding_hash: _groundingHash,
      ...expandedGroundingMaterial
    } = expandedPayload;
    await expect(
      fixture.commit(
        "GroundingPackage",
        "00000000-0000-4000-8000-000000000439",
        [
          source.payload.query_contract_ref,
          source.payload.semantic_release_ref,
          source.payload.schema_snapshot_ref,
          source.payload.policy_receipt_ref,
        ],
        {
          ...expandedPayload,
          grounding_hash: await computeGroundingHash(expandedGroundingMaterial),
        },
      ),
    ).rejects.toThrow("Allowed Column");
  });

  it("SemanticQuery authority 拒绝与 GroundingPackage/QueryContract 漂移的语义", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const source = await resolveL2Document(fixture.authority, fixture.references.semanticQuery);
    if (source?.payload.artifact_type !== "SemanticQuery") {
      throw new Error("测试 Fixture 缺少 SemanticQuery。");
    }

    await expect(
      fixture.commit(
        "SemanticQuery",
        "00000000-0000-4000-8000-000000000433",
        [source.payload.query_contract_ref, source.payload.grounding_package_ref],
        {
          ...source.payload,
          metric: {
            ...source.payload.metric,
            metric_id: "metric.drifted",
          },
        },
      ),
    ).rejects.toThrow("SemanticQuery.metric");

    const firstPredicate = source.payload.predicates[0];
    if (firstPredicate?.kind !== "comparison") {
      throw new Error("测试 Fixture 缺少 QueryContract Comparison Predicate。");
    }
    await expect(
      fixture.commit(
        "SemanticQuery",
        "00000000-0000-4000-8000-000000000436",
        [source.payload.query_contract_ref, source.payload.grounding_package_ref],
        {
          ...source.payload,
          predicates: [
            {
              ...firstPredicate,
              left: {
                table_id: "customers",
                column_id: firstPredicate.left.column_id,
              },
            },
          ],
        },
      ),
    ).rejects.toThrow("Field Reference 的 column_id 必须属于其 table_id");
  });

  it("LogicalPlan authority 拒绝与 SemanticQuery 漂移的 Grounding 和结果签名", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const source = await resolveL2Document(fixture.authority, fixture.references.logicalPlan);
    if (source?.payload.artifact_type !== "LogicalPlan") {
      throw new Error("测试 Fixture 缺少 LogicalPlan。");
    }

    await expect(
      fixture.commit(
        "LogicalPlan",
        "00000000-0000-4000-8000-000000000434",
        [source.payload.semantic_query_ref],
        {
          ...source.payload,
          grounding_hash: hashes.input,
        },
      ),
    ).rejects.toThrow("LogicalPlan.grounding_hash");

    await expect(
      fixture.commit(
        "LogicalPlan",
        "00000000-0000-4000-8000-000000000435",
        [source.payload.semantic_query_ref],
        {
          ...source.payload,
          semantic_signature: {
            ...source.payload.semantic_signature,
            unit: "USD",
          },
        },
      ),
    ).rejects.toThrow("LogicalPlan.semantic_signature");

    const aggregate = source.payload.operations.find(
      (operation) => operation.operation === "aggregate",
    );
    if (aggregate?.operation !== "aggregate" || !aggregate.measures[0]) {
      throw new Error("测试 Fixture 缺少 Aggregate Measure。");
    }
    await expect(
      fixture.commit(
        "LogicalPlan",
        "00000000-0000-4000-8000-000000000437",
        [source.payload.semantic_query_ref],
        {
          ...source.payload,
          operations: source.payload.operations.map((operation) =>
            operation.operation === "aggregate"
              ? {
                  ...operation,
                  measures: [
                    {
                      ...operation.measures[0],
                      field: {
                        table_id: "orders",
                        column_id: "orders.created_at",
                      },
                    },
                  ],
                }
              : operation,
          ),
        },
      ),
    ).rejects.toThrow("LogicalPlan Measure");

    const scan = source.payload.operations.find((operation) => operation.operation === "scan");
    if (scan?.operation !== "scan") {
      throw new Error("测试 Fixture 缺少 Scan。");
    }
    await expect(
      fixture.commit(
        "LogicalPlan",
        "00000000-0000-4000-8000-000000000438",
        [source.payload.semantic_query_ref],
        {
          ...source.payload,
          operations: [
            ...source.payload.operations,
            {
              ...scan,
              operation_id: "scan_dead_branch",
            },
          ],
        },
      ),
    ).rejects.toThrow("LogicalPlan DAG");
  });

  it("ExecutionPermit 对缺失或失败的执行前 Gate 一律失败关闭", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const sourcePermit = await resolveL2Document(
      fixture.authority,
      fixture.references.executionPermit,
    );
    if (sourcePermit?.payload.artifact_type !== "ExecutionPermit") {
      throw new Error("权威 Fixture 缺少 ExecutionPermit。");
    }
    const firstPreExecutionGate = fixture.references.preExecutionGates[0];
    if (!firstPreExecutionGate) {
      throw new Error("权威 Fixture 缺少 INTENT GateReceipt。");
    }
    const sqlArtifactReference = artifactReferenceFor("SqlArtifact").parse(
      fixture.references.sqlArtifact,
    );
    const failedResourceGate = await fixture.commit(
      "GateReceipt",
      "00000000-0000-4000-8000-000000000423",
      [sqlArtifactReference],
      await sealGateReceipt({
        artifact_type: "GateReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: null,
        gate: "RESOURCE",
        gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        evaluator_input_hash: hashes.input,
        evaluator_evaluation_hash: hashes.execution,
        verdict: "FAIL",
        reason_code: "RESOURCE_BUDGET_EXCEEDED",
        evidence_refs: [sqlArtifactReference],
        observations: {
          estimate_hash: sqlArtifactReference.content_hash,
          policy_version: "resource-policy@1.0.0",
          total_cost: 10,
          plan_rows: 10_000,
          plan_width: 64,
          planned_bytes: 640_000,
          lock_timeout_ms: 1_000,
          timeout_ms: 5_000,
          max_rows: 1_000,
          max_bytes: 1_000_000,
          max_memory_mb: 512,
        },
        evaluated_at: "2026-07-25T00:00:00.000Z",
      }),
    );

    await expect(
      fixture.commit(
        "ExecutionPermit",
        "00000000-0000-4000-8000-000000000424",
        [
          fixture.references.sqlArtifact,
          sourcePermit.payload.resource_admission_ref,
          sourcePermit.payload.policy_receipt_ref,
          ...fixture.references.preExecutionGates.slice(0, 4),
          failedResourceGate.reference,
        ],
        {
          ...sourcePermit.payload,
          gate_receipt_refs: [
            ...fixture.references.preExecutionGates.slice(0, 4),
            failedResourceGate.reference,
          ],
        },
      ),
    ).rejects.toThrow("五道全部 PASS");

    await expect(
      fixture.commit(
        "ExecutionPermit",
        "00000000-0000-4000-8000-000000000425",
        [
          fixture.references.sqlArtifact,
          sourcePermit.payload.resource_admission_ref,
          sourcePermit.payload.policy_receipt_ref,
          ...fixture.references.preExecutionGates.slice(0, 4),
          firstPreExecutionGate,
        ],
        {
          ...sourcePermit.payload,
          gate_receipt_refs: [
            ...fixture.references.preExecutionGates.slice(0, 4),
            firstPreExecutionGate,
          ],
        },
      ),
    ).rejects.toThrow("不能重复消费同一个 GateReceipt");
  });

  it("最终 Validation 必须消费七种 Gate，QueryEvidence 必须绑定同一结果摘要", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const executionGate = fixture.references.postExecutionGates[0];
    if (!executionGate) {
      throw new Error("权威 Fixture 缺少 EXECUTION GateReceipt。");
    }
    const sqlArtifactReference = artifactReferenceFor("SqlArtifact").parse(
      fixture.references.sqlArtifact,
    );
    const executionReference = artifactReferenceFor("ExecutionReceipt").parse(
      fixture.references.execution,
    );
    const sourceExecutionGate = await resolveL2Document(fixture.authority, executionGate);
    if (
      sourceExecutionGate?.payload.artifact_type !== "GateReceipt" ||
      sourceExecutionGate.payload.gate !== "EXECUTION"
    ) {
      throw new Error("权威 Fixture 缺少 EXECUTION GateReceipt。");
    }
    const {
      input_hash: _inputHash,
      evaluation_hash: _evaluationHash,
      ...sourceExecutionGateDraft
    } = sourceExecutionGate.payload;
    const duplicateExecutionGate = await fixture.commit(
      "GateReceipt",
      "00000000-0000-4000-8000-000000000426",
      [sqlArtifactReference, executionReference, ...sourceExecutionGateDraft.evidence_refs],
      await sealGateReceipt(sourceExecutionGateDraft),
    );

    await expect(
      fixture.commit(
        "ValidationReceipt",
        "00000000-0000-4000-8000-000000000427",
        [
          fixture.references.sqlArtifact,
          fixture.references.execution,
          ...fixture.references.preExecutionGates,
          executionGate,
          duplicateExecutionGate.reference,
        ],
        {
          artifact_type: "ValidationReceipt",
          sql_artifact_ref: fixture.references.sqlArtifact,
          execution_receipt_ref: fixture.references.execution,
          gate_receipt_refs: [
            ...fixture.references.preExecutionGates,
            executionGate,
            duplicateExecutionGate.reference,
          ],
          validation_version: TEXT2SQL_VALIDATION_VERSION,
          sealed_at: "2026-07-25T00:00:00.005Z",
        },
      ),
    ).rejects.toThrow("固定顺序消费七道");

    await expect(
      fixture.commit(
        "QueryEvidence",
        "00000000-0000-4000-8000-000000000428",
        [fixture.references.execution, fixture.references.validation],
        {
          artifact_type: "QueryEvidence",
          execution_receipt_ref: fixture.references.execution,
          validation_receipt_ref: fixture.references.validation,
          result_hash: hashes.artifact,
          invariant_verdicts: [{ invariant_id: "non-empty", verdict: "PASS" }],
        },
      ),
    ).rejects.toThrow("必须与 ExecutionReceipt.result_hash 一致");
  });

  it("Validation 拒绝 RESULT Gate 时间早于 EXECUTION Gate 的倒序链", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const resultGateReference = fixture.references.postExecutionGates[1];
    const executionGateReference = fixture.references.postExecutionGates[0];
    if (!executionGateReference || !resultGateReference) {
      throw new Error("权威 Fixture 缺少执行后 GateReceipt。");
    }
    const sourceResultGate = await resolveL2Document(fixture.authority, resultGateReference);
    if (
      sourceResultGate?.payload.artifact_type !== "GateReceipt" ||
      sourceResultGate.payload.gate !== "RESULT"
    ) {
      throw new Error("权威 Fixture 的第二张执行后 Receipt 必须是 RESULT。");
    }
    const {
      input_hash: _inputHash,
      evaluation_hash: _evaluationHash,
      ...sourceResultGateDraft
    } = sourceResultGate.payload;
    const reversedResultGate = await fixture.commit(
      "GateReceipt",
      "00000000-0000-4000-8000-000000000456",
      [
        fixture.references.sqlArtifact,
        fixture.references.execution,
        ...sourceResultGateDraft.evidence_refs,
      ],
      await sealGateReceipt({
        ...sourceResultGateDraft,
        evaluated_at: "2026-07-25T00:00:00.006Z",
      }),
    );
    const reversedGateReferences = [
      ...fixture.references.preExecutionGates,
      executionGateReference,
      reversedResultGate.reference,
    ].map((reference) => artifactReferenceSchema.parse(reference));

    await expect(
      fixture.commit(
        "ValidationReceipt",
        "00000000-0000-4000-8000-000000000457",
        [fixture.references.sqlArtifact, fixture.references.execution, ...reversedGateReferences],
        {
          artifact_type: "ValidationReceipt",
          sql_artifact_ref: fixture.references.sqlArtifact,
          execution_receipt_ref: fixture.references.execution,
          gate_receipt_refs: reversedGateReferences,
          validation_version: TEXT2SQL_VALIDATION_VERSION,
          sealed_at: "2026-07-25T00:00:00.007Z",
        },
      ),
    ).rejects.toThrow("非递减时间");
  });

  it("QueryEvidence 不变量必须与 QueryContract 精确闭合，伪造 PASS 不能支持 Claim", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const sourceEvidence = await resolveL2Document(fixture.authority, fixture.references.evidence);
    if (sourceEvidence?.payload.artifact_type !== "QueryEvidence") {
      throw new Error("权威 Fixture 缺少 QueryEvidence。");
    }
    const forgedEvidenceId = "00000000-0000-4000-8000-000000000441";
    const forgedPayload = {
      ...sourceEvidence.payload,
      invariant_verdicts: [{ invariant_id: "made_up", verdict: "PASS" as const }],
    };
    const forgedDraft = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_id: forgedEvidenceId,
        artifact_type: "QueryEvidence",
        input_refs: [fixture.references.execution, fixture.references.validation],
      },
      payload: forgedPayload,
    });
    const forgedDocument = l2ArtifactDocumentSchema.parse({
      ...forgedDraft,
      envelope: {
        ...forgedDraft.envelope,
        content_hash: await computeL2ArtifactContentHash(forgedDraft),
      },
    });
    const forgedReference = referenceFromDocument(forgedDocument);

    await expect(
      fixture.commit(
        "QueryEvidence",
        forgedEvidenceId,
        [fixture.references.execution, fixture.references.validation],
        forgedPayload,
      ),
    ).rejects.toThrow("QueryEvidence.invariant_verdicts 必须按顺序逐项匹配权威");

    await expect(
      fixture.commit(
        "QueryEvidence",
        "00000000-0000-4000-8000-000000000442",
        [fixture.references.execution, fixture.references.validation],
        {
          ...forgedPayload,
          invariant_verdicts: [
            { invariant_id: "non_empty", verdict: "PASS" },
            { invariant_id: "made_up", verdict: "PASS" },
          ],
        },
      ),
    ).rejects.toThrow("QueryEvidence.invariant_verdicts 必须按顺序逐项匹配权威");

    await expect(
      fixture.commit(
        "QueryEvidence",
        "00000000-0000-4000-8000-000000000459",
        [fixture.references.execution, fixture.references.validation],
        {
          ...sourceEvidence.payload,
          invariant_verdicts: sourceEvidence.payload.invariant_verdicts.map((verdict) => ({
            ...verdict,
            verdict: "FAIL" as const,
          })),
        },
      ),
    ).rejects.toThrow("QueryEvidence.invariant_verdicts 必须按顺序逐项匹配权威");

    expect(
      l2ArtifactPayloadSchema.safeParse({
        ...forgedPayload,
        invariant_verdicts: [
          { invariant_id: "non_empty", verdict: "PASS" },
          { invariant_id: "non_empty", verdict: "PASS" },
        ],
      }).success,
    ).toBe(false);

    await expect(
      fixture.commit("AtomicClaim", "00000000-0000-4000-8000-000000000443", [forgedReference], {
        artifact_type: "AtomicClaim",
        claim_id: "00000000-0000-4000-8000-000000000443",
        statement: "伪造不变量也能支持结论。",
        evidence_refs: [forgedReference],
        support_state: "SUPPORTED",
        limitations: [],
      }),
    ).rejects.toThrow("未提交或不存在的输入");
  });

  it("STRUCTURAL Gate 的 Compiler 与 AST observations 必须精确绑定权威 SqlArtifact", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const structuralGateReference = fixture.references.preExecutionGates[2];
    if (!structuralGateReference) {
      throw new Error("权威 Fixture 缺少 STRUCTURAL GateReceipt。");
    }
    const source = await resolveL2Document(fixture.authority, structuralGateReference);
    if (source?.payload.artifact_type !== "GateReceipt" || source.payload.gate !== "STRUCTURAL") {
      throw new Error("权威 Fixture 的第三张执行前 Receipt 必须是 STRUCTURAL。");
    }
    const { input_hash: _inputHash, evaluation_hash: _evaluationHash, ...draft } = source.payload;
    const forged = await sealGateReceipt({
      ...draft,
      observations: {
        ...draft.observations,
        compiler_version: "forged-compiler@9.9.9",
        ast_hash: `sha256:${"f".repeat(64)}`,
      },
    });

    await expect(
      fixture.commit(
        "GateReceipt",
        "00000000-0000-4000-8000-000000000458",
        [...draft.evidence_refs],
        forged,
      ),
    ).rejects.toThrow("Compiler/AST/Query/Parameter");
  });

  it("ResultOracleReceipt 与 PostgreSQL 输出契约共同接受前导下划线 Alias", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const source = await fixture.authority.resolveSystemArtifact?.(fixture.references.resultOracle);
    const oracle = resultOracleReceiptSchema.parse(source);

    expect(
      resultOracleReceiptSchema.safeParse({
        ...oracle,
        result_columns: ["_revenue"],
      }).success,
    ).toBe(true);
  });

  it("FixtureMutationRecord 输入只走 System verifier，不要求 generic L2 mirror", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const mutationReference = fixture.references.fixtureMutations[0];
    if (!mutationReference) {
      throw new Error("权威 Fixture 缺少 FixtureMutationRecord。");
    }
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_id: "00000000-0000-4000-8000-000000000459",
        artifact_type: "QuestionFrame",
        input_refs: [mutationReference],
      },
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "验证 FixtureMutationRecord System route",
        normalized_question: "验证 FixtureMutationRecord System route",
        authorized_datasource_ids: [ids.appA],
        expected_output: "route receipt",
      },
    });
    const document = l2ArtifactDocumentSchema.parse({
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: await computeL2ArtifactContentHash(draft),
      },
    });
    const currentIdentity = artifactReferenceIdentity(referenceFromDocument(document));
    const genericTypes: string[] = [];
    const systemTypes: string[] = [];
    const authority = {
      ...fixture.authority,
      verifyCommitted: async (reference: ArtifactReference) => {
        genericTypes.push(reference.artifact_type);
        return artifactReferenceIdentity(reference) === currentIdentity
          ? true
          : fixture.authority.verifyCommitted(reference);
      },
      verifySystemArtifactCommitted: async (reference: ArtifactReference) => {
        systemTypes.push(reference.artifact_type);
        return fixture.authority.verifySystemArtifactCommitted?.(reference) ?? false;
      },
    };

    expect(TEXT2SQL_RUNTIME_SYSTEM_ARTIFACT_TYPES).toContain("FixtureMutationRecord");
    await expect(verifyL2ArtifactDocument(document, authority)).resolves.toBeDefined();
    expect(systemTypes).toContain("FixtureMutationRecord");
    expect(genericTypes).not.toContain("FixtureMutationRecord");
  });

  it("RESULT observed FAIL 仍递归品牌化三证据并拒绝伪造 failure reason", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const resultGateReference = fixture.references.postExecutionGates[1];
    if (!resultGateReference) {
      throw new Error("权威 Fixture 缺少 RESULT GateReceipt。");
    }
    const source = await resolveL2Document(fixture.authority, resultGateReference);
    if (
      source?.payload.artifact_type !== "GateReceipt" ||
      source.payload.gate !== "RESULT" ||
      source.payload.execution_receipt_ref === null
    ) {
      throw new Error("权威 Fixture 缺少 observed RESULT GateReceipt。");
    }
    const {
      input_hash: _inputHash,
      evaluation_hash: _evaluationHash,
      ...gateDraft
    } = source.payload;
    const forgedPayload = await sealGateReceipt({
      ...gateDraft,
      verdict: "FAIL",
      reason_code: "RESULT_METAMORPHIC_FAILED",
    });
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_id: "00000000-0000-4000-8000-000000000460",
        artifact_type: "GateReceipt",
        input_refs: [
          forgedPayload.sql_artifact_ref,
          source.payload.execution_receipt_ref,
          ...forgedPayload.evidence_refs,
        ],
      },
      payload: forgedPayload,
    });
    const document = l2ArtifactDocumentSchema.parse({
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: await computeL2ArtifactContentHash(draft),
      },
    });
    const currentIdentity = artifactReferenceIdentity(referenceFromDocument(document));
    const withCurrentRevision = (authority: L2ArtifactPersistenceAuthority) => ({
      ...authority,
      verifyCommitted: async (reference: ArtifactReference) =>
        artifactReferenceIdentity(reference) === currentIdentity ||
        authority.verifyCommitted(reference),
    });

    await expect(
      verifyL2ArtifactDocument(document, withCurrentRevision(fixture.authority)),
    ).rejects.toThrow("observed verdict/reason/observations");

    const {
      resolveAuthoritativeMetamorphicFixtureReceipt: _fixtureResolver,
      resolveAuthoritativeMetamorphicOracleReceipt: _metamorphicResolver,
      resolveAuthoritativeResultOracleReceipt: _resultResolver,
      ...withoutOracleResolvers
    } = fixture.authority;
    await expect(
      verifyL2ArtifactDocument(document, withCurrentRevision(withoutOracleResolvers)),
    ).rejects.toThrow("MetamorphicOracleReceipt");
  });

  it("权威 Meta/Result FAIL 三证据可按 RESULT_METAMORPHIC_FAILED 持久化", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const failure = await fixture.createAuthoritativeMetamorphicFailureResultGate();
    const metamorphic = await fixture.authority.resolveAuthoritativeMetamorphicOracleReceipt?.(
      failure.metamorphic.receipt_ref,
    );
    if (!metamorphic) {
      throw new Error("测试 Fixture 缺少失败 Meta 品牌。");
    }
    const failedFanOut = metamorphic.relation_samples[0];
    if (failedFanOut.relation_kind !== "FAN_OUT") {
      throw new Error("测试 Fixture 缺少失败 FAN_OUT sample。");
    }
    const failedFanOutResult = await fixture.authority.resolveAuthoritativeSandboxResult?.(
      failedFanOut.follow_up.result_artifact_ref,
    );
    const result = await fixture.authority.resolveAuthoritativeResultOracleReceipt?.(
      failure.result.receipt_ref,
      metamorphic,
    );
    const document = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(failure.gate.reference),
    );

    expect(isAuthoritativeMetamorphicOracleReceipt(metamorphic)).toBe(true);
    expect(isAuthoritativeResultOracleReceipt(result)).toBe(true);
    expect(metamorphic.relation_samples[0]).toMatchObject({ verdict: "FAIL" });
    expect(failedFanOutResult?.rows).toEqual([["华南", 200]]);
    expect(metamorphic.metamorphic_verdict).toBe("FAIL");
    expect(result?.oracle_verdict).toBe("FAIL");
    expect(document.payload).toMatchObject({
      artifact_type: "GateReceipt",
      gate: "RESULT",
      verdict: "FAIL",
      reason_code: "RESULT_METAMORPHIC_FAILED",
      evidence_refs: [
        { artifact_type: "SandboxResult" },
        { artifact_type: "MetamorphicOracleReceipt" },
        { artifact_type: "ResultOracleReceipt" },
      ],
    });
    await expect(verifyL2ArtifactDocument(document, fixture.authority)).resolves.toBeDefined();
  });

  it("Canonical JSON 使用跨 Locale 稳定的 UTF-16 Key 顺序", () => {
    expect(canonicalizeJson({ a: 2, Z: 1 })).toBe('{"Z":1,"a":2}');
  });
});
