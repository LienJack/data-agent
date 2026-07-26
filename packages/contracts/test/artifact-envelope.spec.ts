import { describe, expect, it } from "vitest";
import {
  ArtifactAuthorityError,
  ArtifactIntegrityError,
  artifactEnvelopeSchema,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  authorizeL2ArtifactDocument,
  computeL2ArtifactContentHash,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
  l2ArtifactPayloadSchema,
} from "../src/artifacts/index.js";
import { canonicalizeJson } from "../src/common/index.js";
import { createAuthoritativeReadyFixture } from "./authority-fixtures.js";
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
        validation_version: "text2sql-validation@1.0.0",
        sealed_at: "2026-07-26T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("Text2SQL 权威链必须按五门禁、执行许可、真实执行、七门禁封口的因果顺序", () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");
    const executionReference = {
      ...makeArtifactReference(),
      artifact_id: "00000000-0000-4000-8000-000000000351",
      artifact_type: "ExecutionReceipt",
    };
    const sandboxReceiptReference = makeArtifactReference(
      "SandboxExecutionReceipt",
      "00000000-0000-4000-8000-000000000352",
    );
    const preExecutionGates = ["INTENT", "SEMANTIC", "STRUCTURAL", "POLICY", "RESOURCE"] as const;
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
          gate_version: "text2sql-gates@1.0.0",
          verdict: "PASS",
          reason_code: "GATE_PASSED",
          evidence_refs: [sqlArtifactReference],
          evaluated_at: "2026-07-26T00:00:00.000Z",
        }).success,
        `第 ${index + 1} 个执行前 GateReceipt 应能独立封存`,
      ).toBe(true);
    }

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ExecutionPermit",
        sql_artifact_ref: sqlArtifactReference,
        gate_receipt_refs: gateReferences.slice(0, 5),
        budget: {
          timeout_ms: 5_000,
          max_rows: 1_000,
          max_bytes: 1_000_000,
        },
        expires_at: "2026-07-26T00:05:00.000Z",
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ExecutionReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_permit_ref: executionPermitReference,
        sandbox_execution_receipt_ref: sandboxReceiptReference,
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
        gate_version: "text2sql-gates@1.0.0",
        verdict: "PASS",
        reason_code: "RESULT_ORACLE_PASSED",
        evidence_refs: [sandboxReceiptReference],
        evaluated_at: "2026-07-26T00:00:02.000Z",
      }).success,
    ).toBe(true);

    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "ValidationReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        gate_receipt_refs: gateReferences,
        validation_version: "text2sql-validation@1.0.0",
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

  it("LogicalPlan 的每类 Operation 使用独立参数契约", () => {
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "LogicalPlan",
        semantic_query_ref: makeArtifactReference("SemanticQuery"),
        operations: [
          {
            operation: "limit",
            join_type: "cross",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      l2ArtifactPayloadSchema.safeParse({
        artifact_type: "LogicalPlan",
        semantic_query_ref: makeArtifactReference("SemanticQuery"),
        operations: [
          {
            operation: "limit",
            count: 100,
          },
        ],
      }).success,
    ).toBe(true);
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
    const authorized = await authorizeL2ArtifactDocument(parsedCommitted, authority);
    expect(authorized).toMatchObject(committed);
    expect(Object.isFrozen(authorized)).toBe(true);
    expect(Object.isFrozen(authorized.payload)).toBe(true);
    await expect(
      authorizeL2ArtifactDocument(
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
      authorizeL2ArtifactDocument(
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
        authorizeL2ArtifactDocument(
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
      authorizeL2ArtifactDocument(committed, authorityFor(committed, { inputsCommitted: false })),
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
      authorizeL2ArtifactDocument(
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
      authorizeL2ArtifactDocument(committed, authorityFor(committed, { currentCommitted: false })),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
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
      authorizeL2ArtifactDocument(
        committed,
        authorityFor(committed, { committerAuthorized: false }),
      ),
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
      },
      unit: "CNY",
      filters: [],
      datasource_id: ids.appA,
      result_contract: {
        columns: ["net_revenue"],
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
      metric_ref: "net_revenue",
      dimension_refs: ["region"],
      filter_expressions: [],
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
      authorizeL2ArtifactDocument(hypothesisDocument, authorityFor(hypothesisDocument)),
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
        ],
        {
          artifact_type: "ExecutionReceipt",
          sql_artifact_ref: fixture.references.sqlArtifact,
          execution_permit_ref: fixture.references.executionPermit,
          sandbox_execution_receipt_ref: fixture.references.sandboxReceipt,
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
        ],
        {
          artifact_type: "ExecutionReceipt",
          sql_artifact_ref: fixture.references.sqlArtifact,
          execution_permit_ref: fixture.references.executionPermit,
          sandbox_execution_receipt_ref: fixture.references.sandboxReceipt,
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
    ).rejects.toThrow("必须与上游 QueryContract.datasource_id 一致");
  });

  it("ExecutionPermit 对缺失或失败的执行前 Gate 一律失败关闭", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const firstPreExecutionGate = fixture.references.preExecutionGates[0];
    if (!firstPreExecutionGate) {
      throw new Error("权威 Fixture 缺少 INTENT GateReceipt。");
    }
    const failedResourceGate = await fixture.commit(
      "GateReceipt",
      "00000000-0000-4000-8000-000000000423",
      [fixture.references.sqlArtifact],
      {
        artifact_type: "GateReceipt",
        sql_artifact_ref: fixture.references.sqlArtifact,
        execution_receipt_ref: null,
        gate: "RESOURCE",
        gate_version: "text2sql-gates@1.0.0",
        verdict: "FAIL",
        reason_code: "ROW_LIMIT_UNBOUNDED",
        evidence_refs: [fixture.references.sqlArtifact],
        evaluated_at: "2026-07-26T00:00:00.000Z",
      },
    );

    await expect(
      fixture.commit(
        "ExecutionPermit",
        "00000000-0000-4000-8000-000000000424",
        [
          fixture.references.sqlArtifact,
          ...fixture.references.preExecutionGates.slice(0, 4),
          failedResourceGate.reference,
        ],
        {
          artifact_type: "ExecutionPermit",
          sql_artifact_ref: fixture.references.sqlArtifact,
          gate_receipt_refs: [
            ...fixture.references.preExecutionGates.slice(0, 4),
            failedResourceGate.reference,
          ],
          budget: {
            timeout_ms: 5_000,
            max_rows: 1_000,
            max_bytes: 1_000_000,
          },
          expires_at: "2026-07-26T00:05:00.000Z",
        },
      ),
    ).rejects.toThrow("五道全部 PASS");

    await expect(
      fixture.commit(
        "ExecutionPermit",
        "00000000-0000-4000-8000-000000000425",
        [
          fixture.references.sqlArtifact,
          ...fixture.references.preExecutionGates.slice(0, 4),
          firstPreExecutionGate,
        ],
        {
          artifact_type: "ExecutionPermit",
          sql_artifact_ref: fixture.references.sqlArtifact,
          gate_receipt_refs: [
            ...fixture.references.preExecutionGates.slice(0, 4),
            firstPreExecutionGate,
          ],
          budget: {
            timeout_ms: 5_000,
            max_rows: 1_000,
            max_bytes: 1_000_000,
          },
          expires_at: "2026-07-26T00:05:00.000Z",
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
    const duplicateExecutionGate = await fixture.commit(
      "GateReceipt",
      "00000000-0000-4000-8000-000000000426",
      [
        fixture.references.sqlArtifact,
        fixture.references.execution,
        fixture.references.sandboxReceipt,
      ],
      {
        artifact_type: "GateReceipt",
        sql_artifact_ref: fixture.references.sqlArtifact,
        execution_receipt_ref: fixture.references.execution,
        gate: "EXECUTION",
        gate_version: "text2sql-gates@1.0.0",
        verdict: "PASS",
        reason_code: "EXECUTION_PASSED",
        evidence_refs: [fixture.references.sandboxReceipt],
        evaluated_at: "2026-07-26T00:00:01.000Z",
      },
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
          validation_version: "text2sql-validation@1.0.0",
          sealed_at: "2026-07-26T00:00:02.000Z",
        },
      ),
    ).rejects.toThrow("七道当前 GateReceipt");

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

  it("Canonical JSON 使用跨 Locale 稳定的 UTF-16 Key 顺序", () => {
    expect(canonicalizeJson({ a: 2, Z: 1 })).toBe('{"Z":1,"a":2}');
  });
});
