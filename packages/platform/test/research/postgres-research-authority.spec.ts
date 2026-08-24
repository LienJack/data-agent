import {
  buildAnalysisContextJournalAppend,
  buildAnalysisPythonSourceReceipt,
  buildAnalysisResultStageCommand,
  buildGovernedOperatorResultCommit,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type U6DbResult,
} from "@data-agent/contracts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresResearchAuthority } from "../../src/research/postgres-research-authority.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  owner: "00000000-0000-4000-8000-000000000005",
  analyst: "00000000-0000-4000-8000-000000000006",
  viewer: "00000000-0000-4000-8000-000000000007",
  authority: "00000000-0000-4000-8000-000000000008",
  operation: "00000000-0000-4000-8000-000000000009",
  certificate: "00000000-0000-4000-8000-000000000010",
  grant: "00000000-0000-4000-8000-000000000011",
  consumption: "00000000-0000-4000-8000-000000000012",
  terminal: "00000000-0000-4000-8000-000000000013",
  datasource: "11111111-1111-4111-8111-111111111111",
} as const;

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const scope = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
} as const;

interface SqlCall {
  readonly connection: number;
  readonly text: string;
  readonly values: readonly unknown[];
}

function scriptedPool(
  handle: (
    text: string,
    values: readonly unknown[],
    connection: number,
  ) => SqlQueryResult | undefined,
) {
  const calls: SqlCall[] = [];
  let connections = 0;
  const pool: SqlPool = {
    async connect() {
      connections += 1;
      const connection = connections;
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ connection, text, values });
          const result = handle(text, values, connection);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return {
    calls,
    pool,
    get connections() {
      return connections;
    },
  };
}

function success<T>(value: T): U6DbResult<T> {
  return {
    protocol_version: "u6-db-result@1.0.0",
    ok: true,
    value,
  };
}

function resultRow(value: unknown): SqlQueryResult {
  return { rows: [{ result: value }], rowCount: 1 };
}

function certificateRef() {
  return {
    artifact_id: ids.certificate,
    artifact_type: "ReportReadyCertificate" as const,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: hash("a"),
  };
}

function analysisReportRef() {
  return {
    ...certificateRef(),
    artifact_id: ids.operation,
    artifact_type: "AnalysisReport" as const,
  };
}

function frontierInput(principal_id: string) {
  return {
    schema_version: "1.0.0" as const,
    scope,
    run_id: ids.run,
    principal_id,
    idempotency_key: "frontier-initialize",
    operation_id: ids.operation,
    value: {
      frontier_kind: "DATA" as const,
      data_snapshot: {
        protocol_version: "data-snapshot-binding@1.0.0" as const,
        datasource_id: ids.datasource,
        strategy: "NONE" as const,
        snapshot_token: null,
        schema_manifest_hash: null,
        data_manifest_hash: null,
        fixture_manifest_hash: null,
        replay_state: "REPLAY_UNAVAILABLE" as const,
        binding_hash: "sha256:c22bb0a9ca28bffab126885d66d16a80cfc884192ace1fef47abf69c51f2d3d6",
      },
    },
    expected_frontier_version: null,
    expected_frontier_hash: null,
  };
}

function consumeInput(principal_id: string, purpose: "DOMAIN_TERMINAL" | "REPORT_READ") {
  const base = {
    schema_version: "1.0.0" as const,
    scope,
    run_id: ids.run,
    principal_id,
    idempotency_key: `consume-${purpose.toLowerCase()}`,
    consumption_id: ids.consumption,
    purpose,
    certificate_ref: certificateRef(),
  };
  return purpose === "DOMAIN_TERMINAL"
    ? { ...base, purpose, terminal_id: ids.terminal }
    : { ...base, purpose, grant_id: ids.grant };
}

function grantIssued() {
  return {
    purpose: "REPORT_READ" as const,
    outcome: "GRANT_ISSUED" as const,
    consumption_id: ids.consumption,
    current_state: "CURRENT" as const,
    grant_id: ids.grant,
    state: "ISSUED" as const,
    response: {
      protocol_version: "canonical-response@1.0.0" as const,
      media_type: "application/json; charset=utf-8" as const,
      content_disposition: "inline" as const,
      byte_length: 2,
      response_digest: hash("b"),
    },
  };
}

function capabilities() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.owner,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "OWNER",
      },
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
      {
        subject: ids.viewer,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "VIEWER",
      },
    ],
  );
  const resolve = (subject: string) => {
    const resolved = registry.resolveForDeployment(ids.deployment, { subject });
    if (!resolved.ok) throw new Error(resolved.error.code);
    return {
      app_capability: resolved.value,
      authority_capability_id: ids.authority,
    };
  };
  return {
    authorizer: asTransactionalTestAuthority(registry.authorizer),
    owner: resolve(ids.owner),
    analyst: resolve(ids.analyst),
    viewer: resolve(ids.viewer),
  };
}

describe("PostgreSQL Research Authority Adapter", () => {
  it("uses the unique request-plus-result governed operator RPC and reads its full recovery tuple", async () => {
    const auth = capabilities();
    const receiptPayload = { status: "SUCCEEDED", call_id: "call-1" };
    const receiptHash = await sha256ContentHash(receiptPayload);
    const result = {
      schema_version: "governed-operator-result-ref@1.0.0" as const,
      scope,
      run_id: ids.run,
      node_id: "question-1",
      attempt_id: ids.terminal,
      context_generation: 1,
      call_id: "call-1",
      operator_id: "multiple-testing.bh-fdr@1" as const,
      program_hash: hash("1"),
      request_sha256: hash("2"),
      result_artifact_ref: {
        artifact_id: ids.operation,
        artifact_type: "SandboxResult" as const,
        ...scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("3"),
      },
      result_sha256: hash("3"),
      result_bytes: 2,
      shape: { kind: "MAPPING" as const, keys: 0, bounded_summary: "" },
      receipt_ref: {
        artifact_id: ids.certificate,
        artifact_type: "SandboxExecutionReceipt" as const,
        ...scope,
        run_id: ids.run,
        revision: 1,
        content_hash: receiptHash,
      },
      worker_fence: 7,
    };
    const command = await buildGovernedOperatorResultCommit({
      schema_version: "governed-operator-result-commit@1.0.0",
      principal_id: ids.analyst,
      result,
      idempotency_key: "operator-result:call-1",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      result_receipt_payload: receiptPayload,
      result_receipt_hash: receiptHash,
    });
    const journal = await buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope,
      run_id: ids.run,
      principal_id: ids.analyst,
      node_id: "question-1",
      attempt_id: ids.terminal,
      context_generation: 1,
      worker_fence: 7,
      expected_prev_seq: 1,
      expected_prev_entry_hash: hash("4"),
      runtime_digest: hash("5"),
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      event: { event_type: "OPERATOR_RESULT_COMMITTED", governed_result: result },
    });
    const requestContent = new Uint8Array([1]);
    const resultContent = new TextEncoder().encode("{}");
    const database = scriptedPool((text) => {
      if (text.includes("commit_governed_operator_result")) {
        return resultRow({
          ok: false,
          error_code: "GOVERNED_OPERATOR_REQUEST_CONTENT_HASH_MISMATCH",
        });
      }
      if (text.includes("read_governed_operator_result")) {
        return {
          rows: [
            {
              result: { ok: true },
              result_content: resultContent,
              request_content: requestContent,
              receipt_payload: receiptPayload,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await authority.commitGovernedOperatorResult(
      auth.analyst,
      command,
      journal,
      requestContent,
      resultContent,
    );
    await expect(authority.readGovernedOperatorResult(auth.analyst, result)).resolves.toEqual({
      ok: true,
      result_content: resultContent,
      request_content: requestContent,
      receipt_payload: receiptPayload,
    });

    const commitCall = database.calls.find((call) =>
      call.text.includes("commit_governed_operator_result"),
    );
    expect(commitCall?.text).toContain("$3::bytea");
    expect(commitCall?.values.slice(1)).toEqual([requestContent, resultContent]);
  });
  it("封装 strict U6DbCommand，并解析 strict U6DbResult", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (!text.includes("initialize_research_version_frontier")) return undefined;
      return resultRow(
        success({
          operation_id: ids.operation,
          frontier_kind: "DATA",
          frontier_version: 0,
          frontier_value_hash: hash("c"),
          event_seq: 1,
          cascaded_revocation_operation_id: null,
          committed_at: "2026-07-28T00:00:00.000Z",
        }),
      );
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).resolves.toEqual(
      success({
        operation_id: ids.operation,
        frontier_kind: "DATA",
        frontier_version: 0,
        frontier_value_hash: hash("c"),
        event_seq: 1,
        cascaded_revocation_operation_id: null,
        committed_at: "2026-07-28T00:00:00.000Z",
      }),
    );

    const rpc = database.calls.find((call) =>
      call.text.includes("initialize_research_version_frontier"),
    );
    expect(rpc?.values).toEqual([
      {
        protocol_version: "u6-db-command@1.0.0",
        authority_capability_id: ids.authority,
        command: frontierInput(ids.analyst),
      },
    ]);
    expect(
      database.calls.find((call) => call.text.includes("backend_context_matches"))?.values[3],
    ).toBe(true);
  });

  it("按方法固定 VIEWER 的 READ 与 DOMAIN_TERMINAL 的 WRITE 权限", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (text.includes("consume_current_ready")) {
        return resultRow(success(grantIssued()));
      }
      return undefined;
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      authority.consume(auth.viewer, consumeInput(ids.viewer, "REPORT_READ")),
    ).resolves.toEqual(success(grantIssued()));
    expect(
      database.calls.find((call) => call.text.includes("backend_context_matches"))?.values[3],
    ).toBe(false);

    const connectionsBeforeDeniedWrite = database.connections;
    await expect(
      authority.consume(auth.viewer, consumeInput(ids.viewer, "DOMAIN_TERMINAL")),
    ).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: {
        code: "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
        retryable: false,
      },
    });
    expect(database.connections).toBe(connectionsBeforeDeniedWrite);
  });

  it("Historical Resolver 以 VIEWER READ 权限封装 strict Ref Read Command", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (text.includes("read_historical_l2_research_artifact")) {
        return resultRow(success(null));
      }
      return undefined;
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });
    const reference = {
      ...certificateRef(),
      artifact_id: ids.operation,
      artifact_type: "ReportManifest" as const,
    };

    await expect(authority.readHistorical(auth.viewer, reference)).resolves.toEqual(success(null));

    const rpc = database.calls.find((call) =>
      call.text.includes("read_historical_l2_research_artifact"),
    );
    expect(rpc?.values).toEqual([
      {
        protocol_version: "u6-db-command@1.0.0",
        authority_capability_id: ids.authority,
        command: {
          schema_version: "1.0.0",
          scope,
          run_id: ids.run,
          principal_id: ids.viewer,
          ref: reference,
        },
      },
    ]);
    expect(
      database.calls.find((call) => call.text.includes("backend_context_matches"))?.values[3],
    ).toBe(false);
  });

  it("VIEWER 可消费并响应 Grant，但不能执行 Expiry WRITE", async () => {
    const auth = capabilities();
    const response = {
      protocol_version: "canonical-response@1.0.0" as const,
      media_type: "application/json; charset=utf-8" as const,
      content_disposition: "inline" as const,
      byte_length: 2,
      response_digest: hash("b"),
    };
    const database = scriptedPool((text) => {
      if (text.includes("consume_report_read_grant")) {
        return resultRow(
          success({
            grant_id: ids.grant,
            state: "CONSUMED",
            report_ref: analysisReportRef(),
            response,
            consumed_at: "2026-07-28T00:00:00.000Z",
          }),
        );
      }
      if (text.includes("commit_report_read_response")) {
        return resultRow(
          success({
            grant_id: ids.grant,
            state: "RESPONDED",
            response: { ...response, body_base64url: "e30" },
            responded_at: "2026-07-28T00:00:01.000Z",
          }),
        );
      }
      return undefined;
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });
    const readCommand = {
      schema_version: "1.0.0" as const,
      scope,
      run_id: ids.run,
      principal_id: ids.viewer,
      idempotency_key: "grant-read",
      grant_id: ids.grant,
    };

    await expect(authority.consumeGrant(auth.viewer, readCommand)).resolves.toMatchObject({
      ok: true,
      value: { state: "CONSUMED" },
    });
    await expect(authority.commitResponse(auth.viewer, readCommand)).resolves.toMatchObject({
      ok: true,
      value: { state: "RESPONDED" },
    });
    expect(
      database.calls
        .filter((call) => call.text.includes("backend_context_matches"))
        .map((call) => call.values[3]),
    ).toEqual([false, false]);

    const connectionsBeforeDeniedWrite = database.connections;
    await expect(
      authority.expireGrant(auth.viewer, {
        ...readCommand,
        operation_id: ids.operation,
        expected_state: "CONSUMED",
        reason_code: "REPORT_READ_GRANT_TTL_EXPIRED",
      }),
    ).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: {
        code: "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
        retryable: false,
      },
    });
    expect(database.connections).toBe(connectionsBeforeDeniedWrite);
  });

  it("Release GO 只允许 OWNER，ANALYST 在连接数据库前失败关闭", async () => {
    const auth = capabilities();
    const database = scriptedPool(() => undefined);
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });
    const input = {
      schema_version: "1.0.0" as const,
      scope,
      run_id: ids.run,
      principal_id: ids.analyst,
      idempotency_key: "release-go",
      decision_id: ids.operation,
      decision: "GO" as const,
      certificate_ref: certificateRef(),
      release_manifest_ref: {
        ...certificateRef(),
        artifact_id: ids.operation,
        artifact_type: "ReleaseManifest" as const,
      },
      scorecard_refs: [],
      benchmark_receipt_refs: [],
      sandbox_receipt_refs: [],
      model_certification_receipt_refs: [],
      signed_outcome_refs: [],
      release_policy_version: "release-policy@1.0.0",
      candidate_input_hash: hash("d"),
    };

    await expect(authority.commitGo(auth.analyst, input)).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: {
        code: "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
        retryable: false,
      },
    });
    expect(database.connections).toBe(0);
  });

  it("只对 55P03 使用同一 envelope 做最多三次有界退避", async () => {
    const auth = capabilities();
    let rpcAttempts = 0;
    const envelopes: unknown[] = [];
    const database = scriptedPool((text, values) => {
      if (!text.includes("initialize_research_version_frontier")) return undefined;
      rpcAttempts += 1;
      envelopes.push(values[0]);
      if (rpcAttempts <= 3) {
        throw Object.assign(new Error("lock not available"), { code: "55P03" });
      }
      return resultRow(
        success({
          operation_id: ids.operation,
          frontier_kind: "DATA",
          frontier_version: 0,
          frontier_value_hash: hash("e"),
          event_seq: 1,
          cascaded_revocation_operation_id: null,
          committed_at: "2026-07-28T00:00:00.000Z",
        }),
      );
    });
    const waits: number[] = [];
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
      lock_retry_delays_ms: [1, 2, 3],
      sleep: async (delayMs) => {
        waits.push(delayMs);
      },
    });

    const result = await authority.initialize(auth.analyst, frontierInput(ids.analyst));

    expect(result.ok).toBe(true);
    expect(rpcAttempts).toBe(4);
    expect(waits).toEqual([1, 2, 3]);
    expect(envelopes).toHaveLength(4);
    expect(envelopes.every((value) => JSON.stringify(value) === JSON.stringify(envelopes[0]))).toBe(
      true,
    );
    expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(3);
  });

  it("55P03 退避耗尽后返回冻结的 retryable error", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (text.includes("initialize_research_version_frontier")) {
        throw Object.assign(new Error("lock not available"), { code: "55P03" });
      }
      return undefined;
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
      lock_retry_delays_ms: [0, 0, 0],
      sleep: async () => {},
    });

    await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: {
        code: "RESEARCH_AUTHORITY_LOCK_CONTENDED",
        retryable: true,
      },
    });
    expect(database.connections).toBe(4);
    expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(4);
  });

  it("数据库返回的预期业务拒绝保留 Result 并提交外层事务", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (!text.includes("initialize_research_version_frontier")) return undefined;
      return resultRow({
        protocol_version: "u6-db-result@1.0.0",
        ok: false,
        error: {
          code: "RESEARCH_FRONTIER_CAS_CONFLICT",
          retryable: true,
        },
      });
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: {
        code: "RESEARCH_FRONTIER_CAS_CONFLICT",
        retryable: true,
      },
    });
    expect(database.calls.filter((call) => call.text === "COMMIT")).toHaveLength(1);
    expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(0);
  });

  it("未知 SQL/constraint 故障回滚且不伪装成业务 U6DbResult", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (text.includes("initialize_research_version_frontier")) {
        throw Object.assign(new Error("unknown check"), { code: "23514" });
      }
      return undefined;
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
      lock_retry_delays_ms: [0, 0, 0],
      sleep: async () => {},
    });

    await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).rejects.toThrow(
      /Research Authority/,
    );
    expect(database.connections).toBe(1);
    expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(1);
  });

  it.each([
    {
      sqlstate: "42501",
      marker: "DA_U6_CAPABILITY_REQUIRED",
      expectedCode: "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
    },
    {
      sqlstate: "22023",
      marker: "DA_U6_DB_COMMAND_INVALID",
      expectedCode: "RESEARCH_DATABASE_CONTRACT_INVALID",
    },
  ] as const)(
    "只按精确 SQLSTATE+marker 映射已知数据库拒绝：$sqlstate/$marker",
    async ({ sqlstate, marker, expectedCode }) => {
      const auth = capabilities();
      const database = scriptedPool((text) => {
        if (text.includes("initialize_research_version_frontier")) {
          throw Object.assign(new Error(marker), { code: sqlstate });
        }
        return undefined;
      });
      const authority = createPostgresResearchAuthority({
        pool: database.pool,
        authorizer: auth.authorizer,
      });

      await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).resolves.toEqual(
        {
          protocol_version: "u6-db-result@1.0.0",
          ok: false,
          error: {
            code: expectedCode,
            retryable: false,
          },
        },
      );
      expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(1);
    },
  );

  it.each(["42501", "22023"] as const)(
    "相同 SQLSTATE 的未知 marker 仍回滚并抛出传输异常：%s",
    async (sqlstate) => {
      const auth = capabilities();
      const database = scriptedPool((text) => {
        if (text.includes("initialize_research_version_frontier")) {
          throw Object.assign(new Error("DA_UNRELATED_DATABASE_FAILURE"), { code: sqlstate });
        }
        return undefined;
      });
      const authority = createPostgresResearchAuthority({
        pool: database.pool,
        authorizer: auth.authorizer,
      });

      await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).rejects.toThrow(
        /Research Authority/,
      );
      expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(1);
    },
  );

  it("数据库连接边界映射为冻结的可重试 U6 code", async () => {
    const auth = capabilities();
    const pool: SqlPool = {
      async connect() {
        throw new Error("database unavailable");
      },
    };
    const authority = createPostgresResearchAuthority({
      pool,
      authorizer: auth.authorizer,
    });

    await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: {
        code: "RESEARCH_PERSISTENCE_UNAVAILABLE",
        retryable: true,
      },
    });
  });

  it("拒绝额外 Capability 字段与数据库返回的宽松 Result", async () => {
    const auth = capabilities();
    const database = scriptedPool((text) => {
      if (!text.includes("initialize_research_version_frontier")) return undefined;
      return resultRow({
        ...success({
          operation_id: ids.operation,
          frontier_kind: "DATA",
          frontier_version: 0,
          frontier_value_hash: hash("f"),
          event_seq: 1,
          cascaded_revocation_operation_id: null,
          committed_at: "2026-07-28T00:00:00.000Z",
        }),
        unexpected: true,
      });
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      authority.initialize({ ...auth.analyst, unexpected: true }, frontierInput(ids.analyst)),
    ).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: { code: "RESEARCH_DATABASE_CONTRACT_INVALID", retryable: false },
    });
    expect(database.connections).toBe(0);

    await expect(authority.initialize(auth.analyst, frontierInput(ids.analyst))).resolves.toEqual({
      protocol_version: "u6-db-result@1.0.0",
      ok: false,
      error: { code: "RESEARCH_DATABASE_CONTRACT_INVALID", retryable: false },
    });
    expect(database.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(1);
  });

  it("以同一事务 Capability 和 fence 提交 system analysis artifact", async () => {
    const auth = capabilities();
    const reference = {
      ...certificateRef(),
      artifact_id: ids.operation,
      artifact_type: "SandboxExecutionReceipt" as const,
      content_hash: hash("d"),
    };
    const database = scriptedPool((text) => {
      if (!text.includes("commit_analysis_system_artifact")) return undefined;
      return resultRow({ ok: true, created: true, reference });
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });
    const result = await authority.commitAnalysisSystem(
      auth.analyst,
      {
        schema_version: "1.0.0",
        scope,
        run_id: ids.run,
        principal_id: ids.analyst,
        idempotency_key: "analysis-program:test",
        attempt_id: ids.terminal,
        worker_fence: 7,
        reference,
        payload: { artifact_type: "SandboxExecutionReceipt" },
      },
      null,
    );

    expect(result).toEqual({ ok: true, created: true, reference });
    const rpc = database.calls.find((call) =>
      call.text.includes("commit_analysis_system_artifact"),
    );
    expect(rpc?.values[0]).toMatchObject({
      protocol_version: "u6-db-command@1.0.0",
      authority_capability_id: ids.authority,
      command: { attempt_id: ids.terminal, worker_fence: 7 },
    });
    expect(rpc?.values[1]).toBeNull();
    expect(database.calls.filter((call) => call.text === "COMMIT")).toHaveLength(1);
  });

  it("只向专用 RPC 提交加密的 Analysis Python source", async () => {
    const auth = capabilities();
    const programRef = {
      ...certificateRef(),
      artifact_id: ids.operation,
      artifact_type: "AnalysisProgram" as const,
      content_hash: hash("d"),
    };
    const sourceRef = {
      ...certificateRef(),
      artifact_id: ids.grant,
      artifact_type: "SensitiveExecutionArtifact" as const,
      content_hash: hash("e"),
    };
    const receipt = await buildAnalysisPythonSourceReceipt({
      schema_version: "analysis-python-source-receipt@1.0.0",
      artifact_ref: sourceRef,
      analysis_program_ref: programRef,
      node_id: "falcon24-question-1",
      generation_attempt: 0,
      source_kind: "DEEPSEEK_GENERATED",
      provider_invocation_ref: {
        resource_id: ids.certificate,
        resource_revision: 1,
        resource_hash: hash("f"),
      },
      plaintext_hash: sourceRef.content_hash,
      ciphertext_hash: hash("1"),
      encryption: {
        algorithm: "AES-256-GCM",
        key_id: "analysis-python-source-v1",
        iv_base64: "AQEBAQEBAQEBAQEB",
        auth_tag_base64: "AgICAgICAgICAgICAgICAg==",
      },
      storage: "POSTGRES_ENCRYPTED_BYTEA",
      committed_at: "2026-08-24T00:00:00.000Z",
    });
    const ciphertext = new Uint8Array([1, 2, 3]);
    const database = scriptedPool((text) => {
      if (!text.includes("commit_analysis_python_source")) return undefined;
      return resultRow({ ok: true, created: true, receipt });
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    const result = await authority.commitAnalysisPythonSource(
      auth.analyst,
      {
        schema_version: "analysis-python-source-commit@1.0.0",
        scope,
        run_id: ids.run,
        principal_id: ids.analyst,
        attempt_id: ids.terminal,
        worker_fence: 7,
        idempotency_key: "analysis-python-source:test",
        receipt,
      },
      ciphertext,
    );

    expect(result).toEqual({ ok: true, created: true, receipt });
    const rpc = database.calls.find((call) => call.text.includes("commit_analysis_python_source"));
    expect(rpc?.values[0]).toMatchObject({
      protocol_version: "u6-db-command@1.0.0",
      authority_capability_id: ids.authority,
      command: { attempt_id: ids.terminal, worker_fence: 7 },
    });
    expect(rpc?.values[1]).toBe(ciphertext);
  });

  it("通过一次窄 RPC 原子暂存 Publisher closure 与 Journal", async () => {
    const auth = capabilities();
    const contents = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    const artifacts = contents.map((content, index) => ({
      artifact_name: ["result", "table:trend", "chart:trend"][index]!,
      artifact_kind: (["RESULT", "TABLE", "CHART"] as const)[index]!,
      media_type: "application/json" as const,
      content_sha256: hash(String(index + 1)),
      bytes: content.byteLength,
    }));
    const command = await buildAnalysisResultStageCommand({
      schema_version: "analysis-result-stage-command@1.0.0",
      scope,
      run_id: ids.run,
      principal_id: ids.analyst,
      node_id: "question-1",
      attempt_id: ids.terminal,
      context_generation: 1,
      worker_fence: 7,
      idempotency_key: "analysis-stage:question-1",
      stage_id: ids.grant,
      publish_id: "publish-question-1",
      contract_hash: hash("4"),
      manifest_hash: hash("5"),
      closure_hash: hash("6"),
      analytical_value_hashes: [{ symbol_name: "result_document", value_hash: hash("7") }],
      governed_operator_results: [],
      operator_finalization: {
        schema_version: "statistical-operator-finalization-result@1.0.0",
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        operator_receipts: [],
        operator_receipt_closure_hash: hash("8"),
      },
      execution_snapshot: {
        schema_version: "analysis-result-stage-execution-snapshot@1.0.0",
        request_hash: hash("9"),
        runtime_profile: "CORE_ANALYSIS",
        runtime: {
          agent_image: "agent@sha256:test",
          operator_image: "operator@sha256:test",
          agent_sandbox_id: "agent-1",
          operator_sandbox_id: "operator-1",
          secure_access: true,
        },
        cells: [],
        provider_invocation_refs: [],
        started_at: "2026-08-24T00:00:00.000Z",
        finished_at: "2026-08-24T00:00:01.000Z",
        elapsed_ms: 1_000,
      },
      artifacts,
      expires_at: "2026-08-25T00:00:00.000Z",
    });
    const journal = await buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope,
      run_id: ids.run,
      principal_id: ids.analyst,
      node_id: "question-1",
      attempt_id: ids.terminal,
      context_generation: 1,
      worker_fence: 7,
      expected_prev_seq: 1,
      expected_prev_entry_hash: hash("8"),
      runtime_digest: hash("9"),
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: hash("a"),
      event: {
        event_type: "PUBLISH_STAGE_CREATED",
        stage_id: command.stage_id,
        stage_hash: command.stage_hash,
        closure_hash: command.closure_hash,
      },
    });
    const stage = {
      schema_version: "analysis-result-stage@1.0.0" as const,
      stage_id: command.stage_id,
      stage_hash: command.stage_hash,
      closure_hash: command.closure_hash,
      status: "STAGED" as const,
      created: true,
      expires_at: command.expires_at,
    };
    const journalEntry = {
      ...journal,
      schema_version: "analysis-context-journal-entry@1.0.0" as const,
      seq: 2,
      prev_entry_hash: hash("8"),
      entry_hash: hash("b"),
      created_at: "2026-08-24T00:00:00.000Z",
    };
    const database = scriptedPool((text) => {
      if (!text.includes("stage_analysis_result")) return undefined;
      return resultRow({ ok: true, stage, journal_entry: journalEntry });
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      authority.stageAnalysisResult(auth.analyst, command, journal, contents),
    ).resolves.toEqual({ ok: true, stage, journal_entry: journalEntry });
    const rpc = database.calls.find((call) => call.text.includes("stage_analysis_result"));
    expect(rpc?.values[0]).toMatchObject({
      command: { stage_id: command.stage_id },
      journal_command: { event: { event_type: "PUBLISH_STAGE_CREATED" } },
    });
    expect(rpc?.values[1]).toEqual(
      contents.map((content) => Buffer.from(content).toString("base64")),
    );
    expect(database.calls.filter((call) => call.text === "COMMIT")).toHaveLength(1);
  });

  it("通过独立 cleanup owner RPC 有界回收过期 stage 并返回不可变 receipt", async () => {
    const auth = capabilities();
    const command = {
      schema_version: "analysis-result-stage-cleanup@1.0.0" as const,
      scope,
      principal_id: ids.analyst,
      cleanup_id: ids.operation,
      idempotency_key: "analysis-stage-cleanup:test",
      requested_limit: 100,
    };
    const receipt = {
      schema_version: "analysis-result-stage-cleanup-receipt@1.0.0" as const,
      scope,
      principal_id: ids.analyst,
      cleanup_id: ids.operation,
      idempotency_key: command.idempotency_key,
      requested_limit: command.requested_limit,
      cutoff_at: "2026-08-25T00:00:00.000Z",
      deleted_count: 1,
      deleted_stages: [
        {
          run_id: ids.run,
          node_id: "question-1",
          attempt_id: ids.terminal,
          context_generation: 1,
          stage_id: ids.grant,
          stage_hash: hash("a"),
          expires_at: "2026-08-24T00:00:00.000Z",
        },
      ],
      receipt_hash: hash("b"),
    };
    const database = scriptedPool((text) => {
      if (!text.includes("cleanup_expired_analysis_result_stages")) return undefined;
      return resultRow({ ok: true, receipt });
    });
    const authority = createPostgresResearchAuthority({
      pool: database.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      authority.sweepExpiredAnalysisResultStages(auth.analyst, command),
    ).resolves.toEqual({ ok: true, receipt });
    const rpc = database.calls.find((call) =>
      call.text.includes("cleanup_expired_analysis_result_stages"),
    );
    expect(rpc?.values[0]).toEqual({
      protocol_version: "u6-db-command@1.0.0",
      authority_capability_id: ids.authority,
      command,
    });
    expect(database.calls.filter((call) => call.text === "COMMIT")).toHaveLength(1);
  });
});
