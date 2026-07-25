import { describe, expect, it } from "vitest";
import {
  authorizeExternalAgentAuditReceipt,
  externalAgentAuditReceiptSchema,
  externalAgentCancelConfirmationSchema,
  externalAgentCancelRequestSchema,
  externalAgentRequestSchema,
  isAuthoritativeExternalAgentAuditReceipt,
} from "../src/ports/external-agent.js";
import { environments, hashes, ids, makeArtifactReference } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

const request = externalAgentRequestSchema.parse({
  schema_version: "1.0.0",
  invocation_id: ids.receipt,
  attempt_id: ids.attempt,
  scope,
  run_id: ids.run,
  profile_id: ids.artifact,
  profile_version: "1.0.0",
  adapter: "fixture-agent",
  task_ref: makeArtifactReference("QuestionFrame"),
  context_refs: [],
  workspace_policy: {
    roots: ["/workspace/data-agent"],
    writable: false,
  },
  permission_policy: {
    allowed_tools: ["read-file"],
    allowed_command_ids: [],
  },
  budget: {
    timeout_ms: 30_000,
    max_output_bytes: 4_096,
    max_actions: 2,
  },
});

const expected = {
  invocation: request,
  workspace_policy_hash: hashes.artifact,
  permission_policy_hash: hashes.input,
  action_log_hash: hashes.execution,
  output_hash: `sha256:${"d".repeat(64)}` as const,
  action_count: 1,
  output_bytes: 16,
};

function makeReceipt() {
  return externalAgentAuditReceiptSchema.parse({
    schema_version: "1.0.0",
    receipt_ref: makeArtifactReference("ExternalAgentAuditReceipt"),
    scope,
    run_id: ids.run,
    invocation_id: request.invocation_id,
    attempt_id: request.attempt_id,
    profile_id: request.profile_id,
    profile_version: request.profile_version,
    adapter: request.adapter,
    workspace_policy_hash: expected.workspace_policy_hash,
    permission_policy_hash: expected.permission_policy_hash,
    action_log_hash: expected.action_log_hash,
    output_hash: expected.output_hash,
    action_count: expected.action_count,
    output_bytes: expected.output_bytes,
    process_terminal: "EXITED",
    terminal: "COMPLETED",
    reason_code: "EXTERNAL_AGENT_COMPLETED",
    completed_at: "2026-07-25T00:00:00.000Z",
  });
}

describe("External Agent Audit Receipt Authority", () => {
  it("取消请求必须绑定 attempt_id，旧 Attempt 不能命中新尝试", () => {
    const cancelRequest = {
      schema_version: request.schema_version,
      invocation_id: request.invocation_id,
      attempt_id: request.attempt_id,
      scope: request.scope,
      run_id: request.run_id,
      reason_code: "USER_CANCELLED",
    };

    expect(externalAgentCancelRequestSchema.safeParse(cancelRequest).success).toBe(true);
    const { attempt_id: _attemptId, ...unfencedRequest } = cancelRequest;
    expect(externalAgentCancelRequestSchema.safeParse(unfencedRequest).success).toBe(false);
    expect(
      externalAgentCancelConfirmationSchema.parse({
        cancelled: true,
        attempt_id: cancelRequest.attempt_id,
      }),
    ).toEqual({
      cancelled: true,
      attempt_id: cancelRequest.attempt_id,
    });
    expect(externalAgentCancelConfirmationSchema.safeParse({ cancelled: true }).success).toBe(
      false,
    );
  });

  it("只有已提交且完整绑定调用、Policy、Action Log 与 Output 的 Receipt 才成为权威", async () => {
    const receipt = makeReceipt();
    const authoritative = await authorizeExternalAgentAuditReceipt(receipt.receipt_ref, expected, {
      resolve: async () => receipt,
      verifyCommitted: async () => true,
    });

    expect(isAuthoritativeExternalAgentAuditReceipt(authoritative)).toBe(true);
    await expect(
      authorizeExternalAgentAuditReceipt(receipt.receipt_ref, expected, {
        resolve: async () => ({ ...receipt, output_hash: hashes.artifact }),
        verifyCommitted: async () => true,
      }),
    ).rejects.toMatchObject({
      code: "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE",
    });
  });

  it("拒绝未提交或错误 Revision 的 Receipt", async () => {
    const receipt = makeReceipt();

    await expect(
      authorizeExternalAgentAuditReceipt(receipt.receipt_ref, expected, {
        resolve: async () => receipt,
        verifyCommitted: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE",
    });
    await expect(
      authorizeExternalAgentAuditReceipt(
        { ...receipt.receipt_ref, revision: receipt.receipt_ref.revision + 1 },
        expected,
        {
          resolve: async () => receipt,
          verifyCommitted: async () => true,
        },
      ),
    ).rejects.toMatchObject({
      code: "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE",
    });
  });
});
