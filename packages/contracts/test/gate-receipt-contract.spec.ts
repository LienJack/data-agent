import { describe, expect, it } from "vitest";
import {
  computeGateEvaluationHash,
  executionPermitSchema,
  GATE_OBSERVATION_UNAVAILABLE_HASH,
  type GateReceiptPayload,
  gateReceiptSchema,
  l2ArtifactDocumentSchema,
  TEXT2SQL_EXECUTION_PERMIT_TTL_MS,
  TEXT2SQL_GATE_EVALUATOR_VERSION,
  TEXT2SQL_GATE_REASON_CODES,
  TEXT2SQL_GATE_VERDICTS,
  TEXT2SQL_GATES,
  TEXT2SQL_VALIDATION_VERSION,
  type Text2SqlGate,
  validationReceiptSchema,
} from "../src/artifacts/index.js";
import { EXECUTABLE_QUERY_LIMITS, sha256ContentHash } from "../src/common/index.js";
import {
  createAuthoritativeReadyFixture,
  type GateReceiptDraft,
  sealGateReceipt,
} from "./authority-fixtures.js";
import { hashes, ids, makeArtifactReference } from "./fixtures.js";

const evaluatorAuthorityHashes = {
  evaluator_input_hash: hashes.input,
  evaluator_evaluation_hash: hashes.execution,
} as const;

function structuralQueryHash(receipt: GateReceiptPayload): string | null {
  return receipt.gate === "STRUCTURAL" ? receipt.observations.query_hash : null;
}

function structuralDraft(overrides: Partial<GateReceiptDraft> = {}): GateReceiptDraft {
  const sqlArtifactReference = makeArtifactReference("SqlArtifact");
  return {
    artifact_type: "GateReceipt",
    sql_artifact_ref: sqlArtifactReference,
    execution_receipt_ref: null,
    gate: "STRUCTURAL",
    gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    ...evaluatorAuthorityHashes,
    verdict: "PASS",
    reason_code: "STRUCTURAL_VERIFIED",
    evidence_refs: [sqlArtifactReference],
    observations: {
      compiler_version: "postgresql-compiler@1.0.0",
      ast_hash: hashes.artifact,
      query_hash: hashes.execution,
      parameter_count: 1,
      statement_kind: "SELECT",
      read_only: true,
    },
    evaluated_at: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

function passingObservationsFor(gate: Text2SqlGate): object {
  switch (gate) {
    case "INTENT":
      return {
        query_contract_hash: hashes.input,
        intent_signature_hash: hashes.execution,
      };
    case "SEMANTIC":
      return {
        logical_plan_hash: hashes.input,
        semantic_hash: hashes.execution,
        grounding_hash: hashes.artifact,
      };
    case "STRUCTURAL":
      return {
        compiler_version: "postgresql-compiler@1.0.0",
        ast_hash: hashes.artifact,
        query_hash: hashes.execution,
        parameter_count: 1,
        statement_kind: "SELECT",
        read_only: true,
      };
    case "POLICY":
      return {
        policy_version: "default-policy@1.0.0",
        mandatory_predicate_count: 1,
        resolved_binding_count: 1,
      };
    case "RESOURCE":
      return {
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
      };
    case "EXECUTION":
      return {
        query_hash: hashes.execution,
        sandbox_execution_hash: hashes.artifact,
        elapsed_ms: 10,
        rows: 1,
        bytes: 128,
      };
    case "RESULT":
      return {
        result_hash: hashes.artifact,
        oracle_version: "result-oracle@1.0.0",
        invariant_ids: ["non_empty"],
        oracle_evidence_hash: hashes.execution,
      };
  }
}

function passingReceiptCandidate(gate: Text2SqlGate): Record<string, unknown> {
  const sqlArtifactReference = makeArtifactReference("SqlArtifact");
  const requiresExecution = gate === "EXECUTION" || gate === "RESULT";
  return {
    artifact_type: "GateReceipt",
    sql_artifact_ref: sqlArtifactReference,
    execution_receipt_ref: requiresExecution ? makeArtifactReference("ExecutionReceipt") : null,
    gate,
    gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    input_hash: hashes.input,
    ...evaluatorAuthorityHashes,
    evaluation_hash: hashes.artifact,
    verdict: "PASS",
    reason_code: TEXT2SQL_GATE_REASON_CODES[gate].PASS[0],
    evidence_refs: [sqlArtifactReference],
    observations: passingObservationsFor(gate),
    evaluated_at: "2026-07-26T00:00:00.000Z",
  };
}

describe("GateReceipt persistence contract", () => {
  it("七类 Gate 只接受单源表中对应 Verdict 的 Reason Code", () => {
    const allReasonCodes: string[] = [];
    for (const gate of TEXT2SQL_GATES) {
      for (const verdict of TEXT2SQL_GATE_VERDICTS) {
        allReasonCodes.push(...TEXT2SQL_GATE_REASON_CODES[gate][verdict]);
      }
    }
    expect(new Set(allReasonCodes).size).toBe(allReasonCodes.length);

    for (const gate of TEXT2SQL_GATES) {
      for (const verdict of TEXT2SQL_GATE_VERDICTS) {
        const allowedReasonCodes = TEXT2SQL_GATE_REASON_CODES[gate][verdict];
        for (const reasonCode of allReasonCodes) {
          expect(
            gateReceiptSchema.safeParse({
              ...passingReceiptCandidate(gate),
              verdict,
              reason_code: reasonCode,
            }).success,
            `${gate}/${verdict} 不应接受 ${reasonCode}`,
          ).toBe(allowedReasonCodes.some((allowed) => allowed === reasonCode));
        }
      }
    }
  });

  it("允许 FAIL/UNAVAILABLE 持久化显式 sentinel，但不把 sentinel 当作 PASS", async () => {
    expect(GATE_OBSERVATION_UNAVAILABLE_HASH).toBe(await sha256ContentHash(null));

    const unavailable = await sealGateReceipt(
      structuralDraft({
        verdict: "UNAVAILABLE",
        reason_code: "STRUCTURAL_COMPILER_UNAVAILABLE",
        observations: {
          compiler_version: "UNAVAILABLE",
          ast_hash: GATE_OBSERVATION_UNAVAILABLE_HASH,
          query_hash: GATE_OBSERVATION_UNAVAILABLE_HASH,
          parameter_count: 0,
          statement_kind: "UNAVAILABLE",
          read_only: false,
        },
      }),
    );

    expect(unavailable.verdict).toBe("UNAVAILABLE");
    expect(structuralQueryHash(unavailable)).toBe(GATE_OBSERVATION_UNAVAILABLE_HASH);
    expect(
      gateReceiptSchema.safeParse({
        ...unavailable,
        verdict: "PASS",
        reason_code: "STRUCTURAL_VERIFIED",
      }).success,
    ).toBe(false);
  });

  it("拒绝 Gate 与 observations 类型错配", () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");

    expect(
      gateReceiptSchema.safeParse({
        artifact_type: "GateReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: null,
        gate: "STRUCTURAL",
        gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        input_hash: hashes.input,
        ...evaluatorAuthorityHashes,
        evaluation_hash: hashes.artifact,
        verdict: "FAIL",
        reason_code: "STRUCTURAL_NOT_READ_ONLY",
        evidence_refs: [sqlArtifactReference],
        observations: {
          result_hash: hashes.execution,
          oracle_version: "result-oracle@1.0.0",
          invariant_ids: ["non_empty"],
          oracle_evidence_hash: hashes.artifact,
        },
        evaluated_at: "2026-07-26T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("reset-only breaking contract 明确拒绝旧 v1 payload，不提供迁移兼容", async () => {
    const receipt = await sealGateReceipt(structuralDraft());

    expect(TEXT2SQL_GATE_EVALUATOR_VERSION).toBe("text2sql-gates@2.0.0");
    expect(
      gateReceiptSchema.safeParse({
        ...receipt,
        gate_version: "text2sql-gates@1.0.0",
        evaluator_version: "text2sql-gates@1.0.0",
      }).success,
    ).toBe(false);
  });

  it("拒绝伪造的 Gate/Evaluator Version", async () => {
    const receipt = await sealGateReceipt(structuralDraft());

    expect(
      gateReceiptSchema.safeParse({
        ...receipt,
        evaluator_version: "custom-evaluator@1.0.0",
      }).success,
    ).toBe(false);
  });

  it("ValidationReceipt 只接受 canonical validation version", () => {
    const gateReceiptReferences = Array.from({ length: 7 }, (_, index) =>
      makeArtifactReference(
        "GateReceipt",
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ),
    );
    const receipt = {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: makeArtifactReference("SqlArtifact"),
      execution_receipt_ref: makeArtifactReference("ExecutionReceipt"),
      gate_receipt_refs: gateReceiptReferences,
      validation_version: TEXT2SQL_VALIDATION_VERSION,
      sealed_at: "2026-07-26T00:00:00.000Z",
    };

    expect(TEXT2SQL_VALIDATION_VERSION).toBe("text2sql-validation@1.0.0");
    expect(validationReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(
      validationReceiptSchema.safeParse({
        ...receipt,
        validation_version: "text2sql-validation@1.0.1",
      }).success,
    ).toBe(false);
  });

  it("拒绝执行前 Gate 夹带执行后 Evidence Reference", async () => {
    await expect(
      sealGateReceipt(
        structuralDraft({
          evidence_refs: [makeArtifactReference("ExecutionReceipt")],
        }),
      ),
    ).rejects.toThrow("执行前 GateReceipt");
  });

  it("拒绝 STRUCTURAL PASS 的 read_only=false", async () => {
    const receipt = await sealGateReceipt(
      structuralDraft({
        verdict: "FAIL",
        reason_code: "STRUCTURAL_NOT_READ_ONLY",
        observations: {
          compiler_version: "postgresql-compiler@1.0.0",
          ast_hash: hashes.artifact,
          query_hash: hashes.execution,
          parameter_count: 1,
          statement_kind: "SELECT",
          read_only: false,
        },
      }),
    );

    expect(
      gateReceiptSchema.safeParse({
        ...receipt,
        verdict: "PASS",
        reason_code: "STRUCTURAL_VERIFIED",
      }).success,
    ).toBe(false);
  });

  it("拒绝 RESOURCE observations 缺少 planned_bytes", () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");

    expect(
      gateReceiptSchema.safeParse({
        artifact_type: "GateReceipt",
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: null,
        gate: "RESOURCE",
        gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
        input_hash: hashes.input,
        ...evaluatorAuthorityHashes,
        evaluation_hash: hashes.artifact,
        verdict: "FAIL",
        reason_code: "RESOURCE_ESTIMATE_MISMATCH",
        evidence_refs: [sqlArtifactReference],
        observations: {
          estimate_hash: hashes.execution,
          policy_version: "resource-policy@1.0.0",
          total_cost: 10,
          plan_rows: 100,
          plan_width: 64,
          lock_timeout_ms: 1_000,
          timeout_ms: 5_000,
          max_rows: 1_000,
          max_bytes: 1_000_000,
          max_memory_mb: 512,
        },
        evaluated_at: "2026-07-26T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("拒绝 RESOURCE PASS 的 lock_timeout_ms 大于等于 timeout_ms", async () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");
    const receipt = await sealGateReceipt({
      artifact_type: "GateReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: null,
      gate: "RESOURCE",
      gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      ...evaluatorAuthorityHashes,
      verdict: "FAIL",
      reason_code: "RESOURCE_LIMITS_MISSING",
      evidence_refs: [sqlArtifactReference],
      observations: {
        estimate_hash: hashes.execution,
        policy_version: "resource-policy@1.0.0",
        total_cost: 10,
        plan_rows: 100,
        plan_width: 64,
        planned_bytes: 6_400,
        lock_timeout_ms: 5_000,
        timeout_ms: 5_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
        max_memory_mb: 512,
      },
      evaluated_at: "2026-07-26T00:00:00.000Z",
    });

    expect(
      gateReceiptSchema.safeParse({
        ...receipt,
        verdict: "PASS",
        reason_code: "RESOURCE_VERIFIED",
      }).success,
    ).toBe(false);
  });

  it("拒绝 RESOURCE PASS 的 planned_bytes 与安全乘法不一致", async () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");
    const receipt = await sealGateReceipt({
      artifact_type: "GateReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: null,
      gate: "RESOURCE",
      gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      ...evaluatorAuthorityHashes,
      verdict: "FAIL",
      reason_code: "RESOURCE_ESTIMATE_MISMATCH",
      evidence_refs: [sqlArtifactReference],
      observations: {
        estimate_hash: hashes.execution,
        policy_version: "resource-policy@1.0.0",
        total_cost: 10,
        plan_rows: 100,
        plan_width: 64,
        planned_bytes: 6_399,
        lock_timeout_ms: 1_000,
        timeout_ms: 5_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
        max_memory_mb: 512,
      },
      evaluated_at: "2026-07-26T00:00:00.000Z",
    });

    expect(
      gateReceiptSchema.safeParse({
        ...receipt,
        verdict: "PASS",
        reason_code: "RESOURCE_VERIFIED",
      }).success,
    ).toBe(false);
  });

  it("拒绝 RESOURCE PASS 的 plan_rows*plan_width 安全整数溢出", async () => {
    const sqlArtifactReference = makeArtifactReference("SqlArtifact");
    const receipt = await sealGateReceipt({
      artifact_type: "GateReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: null,
      gate: "RESOURCE",
      gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      ...evaluatorAuthorityHashes,
      verdict: "FAIL",
      reason_code: "RESOURCE_BUDGET_EXCEEDED",
      evidence_refs: [sqlArtifactReference],
      observations: {
        estimate_hash: hashes.execution,
        policy_version: "resource-policy@1.0.0",
        total_cost: 10,
        plan_rows: 100_000,
        plan_width: 90_071_992_548,
        planned_bytes: 100_000_000,
        lock_timeout_ms: 1_000,
        timeout_ms: 5_000,
        max_rows: EXECUTABLE_QUERY_LIMITS.max_rows,
        max_bytes: EXECUTABLE_QUERY_LIMITS.max_bytes,
        max_memory_mb: 512,
      },
      evaluated_at: "2026-07-26T00:00:00.000Z",
    });

    expect(
      gateReceiptSchema.safeParse({
        ...receipt,
        verdict: "PASS",
        reason_code: "RESOURCE_VERIFIED",
      }).success,
    ).toBe(false);
  });

  it("权威核验拒绝 evaluation_hash 未同步的载荷篡改", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const intentGateReference = fixture.references.preExecutionGates[0];
    if (!intentGateReference) {
      throw new Error("权威 Fixture 缺少 INTENT GateReceipt。");
    }
    const source = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(intentGateReference),
    );
    if (source.payload.artifact_type !== "GateReceipt" || source.payload.gate !== "INTENT") {
      throw new Error("权威 Fixture 的第一张执行前 Receipt 必须是 INTENT。");
    }

    await expect(
      fixture.commit(
        "GateReceipt",
        "00000000-0000-4000-8000-000000000451",
        [fixture.references.sqlArtifact],
        {
          ...source.payload,
          verdict: "FAIL",
          reason_code: "INTENT_CONTRACT_MISMATCH",
        },
      ),
    ).rejects.toThrow("evaluation_hash");
  });

  it("权威核验拒绝重算 evaluation_hash 后仍被篡改的 input_hash", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const intentGateReference = fixture.references.preExecutionGates[0];
    if (!intentGateReference) {
      throw new Error("权威 Fixture 缺少 INTENT GateReceipt。");
    }
    const source = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(intentGateReference),
    );
    if (source.payload.artifact_type !== "GateReceipt" || source.payload.gate !== "INTENT") {
      throw new Error("权威 Fixture 的第一张执行前 Receipt 必须是 INTENT。");
    }
    const evaluationInput = {
      artifact_type: "GateReceipt",
      sql_artifact_ref: source.payload.sql_artifact_ref,
      execution_receipt_ref: null,
      gate: "INTENT",
      gate_version: source.payload.gate_version,
      evaluator_version: source.payload.evaluator_version,
      evidence_refs: source.payload.evidence_refs,
      input_hash: hashes.artifact,
      evaluator_input_hash: source.payload.evaluator_input_hash,
      evaluator_evaluation_hash: source.payload.evaluator_evaluation_hash,
      verdict: source.payload.verdict,
      reason_code: source.payload.reason_code,
      observations: source.payload.observations,
      evaluated_at: source.payload.evaluated_at,
    };
    const forged = gateReceiptSchema.parse({
      ...evaluationInput,
      evaluation_hash: await computeGateEvaluationHash(evaluationInput),
    });

    await expect(
      fixture.commit(
        "GateReceipt",
        "00000000-0000-4000-8000-000000000453",
        [fixture.references.sqlArtifact],
        forged,
      ),
    ).rejects.toThrow("input_hash");
  });

  it("权威核验拒绝重新封存但不匹配上游的 PASS observations", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const intentGateReference = fixture.references.preExecutionGates[0];
    if (!intentGateReference) {
      throw new Error("权威 Fixture 缺少 INTENT GateReceipt。");
    }
    const source = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(intentGateReference),
    );
    if (source.payload.artifact_type !== "GateReceipt" || source.payload.gate !== "INTENT") {
      throw new Error("权威 Fixture 的第一张执行前 Receipt 必须是 INTENT。");
    }
    const forged = await sealGateReceipt({
      artifact_type: "GateReceipt",
      sql_artifact_ref: source.payload.sql_artifact_ref,
      execution_receipt_ref: null,
      gate: "INTENT",
      gate_version: source.payload.gate_version,
      evaluator_version: source.payload.evaluator_version,
      evaluator_input_hash: source.payload.evaluator_input_hash,
      evaluator_evaluation_hash: source.payload.evaluator_evaluation_hash,
      verdict: "PASS",
      reason_code: source.payload.reason_code,
      evidence_refs: source.payload.evidence_refs,
      observations: {
        ...source.payload.observations,
        query_contract_hash: hashes.artifact,
      },
      evaluated_at: source.payload.evaluated_at,
    });

    await expect(
      fixture.commit(
        "GateReceipt",
        "00000000-0000-4000-8000-000000000452",
        [fixture.references.sqlArtifact],
        forged,
      ),
    ).rejects.toThrow("权威 QueryContract");
  });

  it("权威核验拒绝 evaluator authority hash 篡改后复用旧 canonical evaluation_hash", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const intentGateReference = fixture.references.preExecutionGates[0];
    if (!intentGateReference) {
      throw new Error("权威 Fixture 缺少 INTENT GateReceipt。");
    }
    const source = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(intentGateReference),
    );
    if (source.payload.artifact_type !== "GateReceipt" || source.payload.gate !== "INTENT") {
      throw new Error("权威 Fixture 的第一张执行前 Receipt 必须是 INTENT。");
    }

    await expect(
      fixture.commit(
        "GateReceipt",
        "00000000-0000-4000-8000-000000000455",
        [fixture.references.sqlArtifact],
        {
          ...source.payload,
          evaluator_input_hash: hashes.artifact,
        },
      ),
    ).rejects.toThrow("evaluation_hash");
  });

  it("ExecutionPermit 拒绝调用者把固定五分钟 TTL 延长一毫秒", () => {
    const issuedAt = "2026-07-26T00:00:00.000Z";
    const permit = {
      artifact_type: "ExecutionPermit",
      sql_artifact_ref: makeArtifactReference("SqlArtifact"),
      resource_admission_ref: makeArtifactReference("ResourceAdmissionReceipt"),
      gate_receipt_refs: Array.from({ length: 5 }, (_, index) =>
        makeArtifactReference(
          "GateReceipt",
          `00000000-0000-4000-8000-${String(index + 460).padStart(12, "0")}`,
        ),
      ),
      principal_id: "principal-fixture",
      policy_receipt_ref: makeArtifactReference("PolicyReceipt"),
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
      issued_at: issuedAt,
      expires_at: "2026-07-26T00:05:00.000Z",
    };

    expect(TEXT2SQL_EXECUTION_PERMIT_TTL_MS).toBe(300_000);
    expect(executionPermitSchema.safeParse(permit).success).toBe(true);
    expect(
      executionPermitSchema.safeParse({
        ...permit,
        expires_at: "2026-07-26T00:05:00.001Z",
      }).success,
    ).toBe(false);
  });

  it("ExecutionPermit Budget 必须与 RESOURCE observations 精确一致", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const sourcePermit = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(fixture.references.executionPermit),
    );
    if (sourcePermit.payload.artifact_type !== "ExecutionPermit") {
      throw new Error("权威 Fixture 缺少 ExecutionPermit。");
    }

    await expect(
      fixture.commit(
        "ExecutionPermit",
        "00000000-0000-4000-8000-000000000454",
        [
          fixture.references.sqlArtifact,
          sourcePermit.payload.resource_admission_ref,
          sourcePermit.payload.policy_receipt_ref,
          ...fixture.references.preExecutionGates,
        ],
        {
          ...sourcePermit.payload,
          execution_settings: {
            ...sourcePermit.payload.execution_settings,
            statement_timeout_ms: 4_000,
          },
          budget: {
            ...sourcePermit.payload.budget,
            timeout_ms: 4_000,
          },
        },
      ),
    ).rejects.toThrow("RESOURCE GateReceipt");
  });
});
