import { describe, expect, expectTypeOf, it } from "vitest";
import {
  computeDataSnapshotBindingHash,
  computeResearchFrontierValueHash,
  createU6DbResultSchema,
  frontierAdvanceInputSchema,
  type ResearchVersionFrontierPort,
  researchDataSnapshotBindingSchema,
  researchFrontierValueSchema,
  U6_ERROR_RETRYABLE,
  u6PlatformErrorSchema,
} from "../src/index.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  run: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  operation: "00000000-0000-4000-8000-000000000005",
  datasource: "11111111-1111-4111-8111-111111111111",
} as const;

const scope = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
} as const;

const noneSnapshotDraft = {
  protocol_version: "data-snapshot-binding@1.0.0",
  datasource_id: ids.datasource,
  strategy: "NONE",
  snapshot_token: null,
  schema_manifest_hash: null,
  data_manifest_hash: null,
  fixture_manifest_hash: null,
  replay_state: "REPLAY_UNAVAILABLE",
} as const;

const noneSnapshot = {
  ...noneSnapshotDraft,
  binding_hash: "sha256:c22bb0a9ca28bffab126885d66d16a80cfc884192ace1fef47abf69c51f2d3d6",
} as const;

describe("U6 Research Platform Contracts", () => {
  it("使用浏览器 WebCrypto 计算冻结的 Snapshot 与 Frontier golden vector", async () => {
    await expect(computeDataSnapshotBindingHash(noneSnapshotDraft)).resolves.toBe(
      noneSnapshot.binding_hash,
    );
    await expect(
      computeResearchFrontierValueHash({
        frontier_kind: "DATA",
        data_snapshot: noneSnapshot,
      }),
    ).resolves.toBe("sha256:af18836a8a1aed1124c83949b1ce22476edfccfc7147b8fe7dae2cfa16caeee9");
  });

  it("拒绝 Snapshot 分支错配与 caller 自报 hash", async () => {
    expect(
      researchDataSnapshotBindingSchema.safeParse({
        ...noneSnapshot,
        replay_state: "REPLAYABLE",
      }).success,
    ).toBe(false);

    await expect(
      computeResearchFrontierValueHash({
        frontier_kind: "DATA",
        data_snapshot: {
          ...noneSnapshot,
          binding_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    ).rejects.toThrow(/binding_hash/);
  });

  it("命令 principal_id 必须是 UUID 且 strict object 不接受额外字段", () => {
    const valid = {
      schema_version: "1.0.0",
      scope,
      run_id: ids.run,
      principal_id: ids.principal,
      idempotency_key: "frontier-advance-1",
      operation_id: ids.operation,
      value: {
        frontier_kind: "DATA",
        data_snapshot: noneSnapshot,
      },
      expected_frontier_version: 0,
      expected_frontier_hash:
        "sha256:af18836a8a1aed1124c83949b1ce22476edfccfc7147b8fe7dae2cfa16caeee9",
    } as const;

    expect(frontierAdvanceInputSchema.safeParse(valid).success).toBe(true);
    expect(
      frontierAdvanceInputSchema.safeParse({ ...valid, principal_id: "browser-user" }).success,
    ).toBe(false);
    expect(frontierAdvanceInputSchema.safeParse({ ...valid, unexpected: true }).success).toBe(
      false,
    );
    expect(
      researchFrontierValueSchema.safeParse({ ...valid.value, unexpected: true }).success,
    ).toBe(false);
  });

  it("冻结完整 retry matrix，并拒绝错误码与 retryable 语义漂移", () => {
    expect(U6_ERROR_RETRYABLE).toEqual({
      RESEARCH_CAPABILITY_SCOPE_MISMATCH: false,
      RESEARCH_DATABASE_AUTHORITY_REQUIRED: false,
      RESEARCH_DATABASE_CONTRACT_INVALID: false,
      RESEARCH_PERSISTENCE_UNAVAILABLE: true,
      RESEARCH_AUTHORITY_LOCK_CONTENDED: true,
      RESEARCH_FRONTIER_OWNER_MISMATCH: false,
      RESEARCH_FRONTIER_CAS_CONFLICT: true,
      READINESS_REVOCATION_PROPAGATION_FAILED: true,
      L2_WIRE_VERSION_WRITE_UNSUPPORTED: false,
      READINESS_PROTOCOL_VERSION_UNSUPPORTED: false,
      AUTHORITY_EVIDENCE_NOT_CURRENT: false,
      AUTHORITY_EVIDENCE_NOT_COMMITTED: false,
      CURRENT_READY_CONSUMPTION_REQUIRED: false,
      RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED: false,
      READINESS_FRONTIER_INCOMPLETE: false,
      READINESS_FRONTIER_STALE: false,
      READINESS_CAS_CONFLICT: true,
      READINESS_IDEMPOTENCY_CONFLICT: false,
      REPORT_READY_CERTIFICATE_TAMPERED: false,
      REPORT_READ_READY_TERMINAL_REQUIRED: false,
      REPORT_READ_GRANT_NOT_CONSUMABLE: false,
      REPORT_READ_GRANT_EXPIRED: false,
      REPORT_READ_RESPONSE_DIGEST_MISMATCH: false,
      REPORT_READ_GRANT_REVOKED: false,
      EVIDENCE_RELATION_IDENTITY_CONFLICT: false,
      RESEARCH_RESOURCE_RESERVATION_CONFLICT: false,
      RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED: true,
      RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE: false,
      RESEARCH_RESOURCE_LIMIT_EXCEEDED: false,
      RESEARCH_INVOCATION_TRANSITION_CONFLICT: false,
      RESEARCH_INVOCATION_TERMINAL_CONFLICT: false,
      RESEARCH_INVOCATION_LATE_TERMINAL_CLOSED: false,
      RESEARCH_SYSTEM_RECORD_NOT_ACTIVE: false,
      RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH: false,
      RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT: false,
      RESEARCH_RESULT_SIZE_EXCEEDED: false,
      RESEARCH_RESULT_DIGEST_MISMATCH: false,
      RESEARCH_RESULT_GOVERNANCE_REJECTED: false,
      RESEARCH_RESULT_TERMINAL_PREPARATION_BUSY: true,
      RESEARCH_RESULT_KEY_ROTATION_CONFLICT: true,
      RESEARCH_RESULT_DECRYPTION_KEY_UNAVAILABLE: false,
      RESEARCH_RESULT_INTEGRITY_FAILURE: false,
      RESEARCH_RESULT_ACCESS_RATE_LIMITED: true,
      REPLAY_SNAPSHOT_UNAVAILABLE: false,
      MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED: false,
      SQL_INVOCATION_NOT_AUTHORIZED: false,
      TOOL_INVOCATION_NOT_AUTHORIZED: false,
      CURRENT_READINESS_REVOKED: false,
      RESEARCH_READY_TERMINAL_REQUIRED: false,
      CURRENT_RELEASE_COMMIT_REQUIRED: false,
      RESEARCH_AUTHORITY_FENCE_MISMATCH: false,
      RESEARCH_STOP_INPUT_INCONSISTENT: false,
      RESEARCH_STOP_INPUT_STALE: false,
    });

    expect(
      u6PlatformErrorSchema.safeParse({
        code: "RESEARCH_AUTHORITY_LOCK_CONTENDED",
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      u6PlatformErrorSchema.safeParse({
        code: "RESEARCH_AUTHORITY_LOCK_CONTENDED",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      u6PlatformErrorSchema.safeParse({
        code: "RESEARCH_AUTHORITY_LOCK_CONTENDED",
        retryable: true,
        message: "数据库 Wire 不接受自由文本字段",
      }).success,
    ).toBe(false);
  });

  it("U6DbResult 是带协议版本的 strict success/error union", () => {
    const schema = createU6DbResultSchema(researchFrontierValueSchema);
    const value = {
      frontier_kind: "DATA",
      data_snapshot: noneSnapshot,
    } as const;

    expect(
      schema.safeParse({
        protocol_version: "u6-db-result@1.0.0",
        ok: true,
        value,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        protocol_version: "u6-db-result@1.0.0",
        ok: false,
        error: {
          code: "READINESS_CAS_CONFLICT",
          retryable: true,
        },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        protocol_version: "u6-db-result@1.0.0",
        ok: true,
        value,
        error: null,
      }).success,
    ).toBe(false);
  });

  it("公开导出 ResearchVersionFrontierPort 的 U6DbResult 方法合同", () => {
    expectTypeOf<ResearchVersionFrontierPort["initialize"]>().toBeFunction();
    expectTypeOf<ResearchVersionFrontierPort["advance"]>().toBeFunction();
  });
});
