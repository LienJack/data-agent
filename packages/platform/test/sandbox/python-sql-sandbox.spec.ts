import { execPath } from "node:process";
import {
  computeOrderedSandboxSqlParametersHash,
  computePostgresqlExecutionSettingsHash,
  computeSandboxCanonicalMultisetHash,
  computeSandboxOrderedResultHash,
  computeSandboxResultBytes,
  deriveOrderedSandboxSqlParameters,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  computeExecutionGrantHash,
  computeSandboxExecutionOutcomeChecksum,
  computeSnapshotDescriptorHash,
  type ExecutionGrant,
  type SandboxExecutionOutcome,
  type SnapshotDescriptor,
  sandboxExecutionOutcomeSchema,
} from "@data-agent/contracts/server";
import { describe, expect, it } from "vitest";
import {
  createPythonSqlSandboxClient,
  PythonSqlSandboxProtocolError,
} from "../../src/sandbox/python-sql-sandbox.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "00000000-0000-4000-8000-00000000aa11",
  run: "00000000-0000-4000-8000-00000000a101",
  principal: "00000000-0000-4000-8000-000000001001",
  datasource: "00000000-0000-4000-8000-00000000d101",
  execution: "00000000-0000-4000-8000-00000000e101",
  attempt: "00000000-0000-4000-8000-00000000b101",
  lease: "00000000-0000-4000-8000-00000000c101",
  transaction: "00000000-0000-4000-8000-00000000f101",
  sql: "00000000-0000-4000-8000-000000000101",
  permit: "00000000-0000-4000-8000-000000000102",
  admission: "00000000-0000-4000-8000-000000000103",
  policy: "00000000-0000-4000-8000-000000000104",
} as const;

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const scope = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
} as const;
const issuedAt = "2026-07-27T00:00:00.000Z";
const leaseExpiresAt = "2026-07-27T00:04:00.000Z";
const permitExpiresAt = "2026-07-27T00:05:00.000Z";
const settings = {
  database_role: "sandbox_reader",
  search_path: ["fixture_snapshot", "pg_catalog"],
  plan_cache_mode: "force_custom_plan",
  statement_timeout_ms: 2_000,
  lock_timeout_ms: 200,
  idle_in_transaction_session_timeout_ms: 3_000,
} as const;
const budget = {
  timeout_ms: 2_000,
  lock_timeout_ms: 200,
  max_rows: 100,
  max_bytes: 65_536,
  max_memory_mb: 64,
} as const;

function reference<
  ArtifactType extends
    | "SqlArtifact"
    | "ExecutionPermit"
    | "ResourceAdmissionReceipt"
    | "PolicyReceipt",
>(artifactType: ArtifactType, artifactId: string, contentHash: string) {
  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: contentHash,
  } as const;
}

async function protocolFixture() {
  const sql = {
    dialect: "postgresql" as const,
    datasource_id: ids.datasource,
    schema_version: "commerce@1.0.0",
    sql_artifact_hash: hash("2"),
    query: "select $1::pg_catalog.int4 as result",
    parameters: { $1: 7 },
    ordered_parameters: deriveOrderedSandboxSqlParameters({ $1: 7 }),
    query_hash: await sha256ContentHash({
      dialect: "postgresql",
      sql: "select $1::pg_catalog.int4 as result",
      parameters: { $1: 7 },
    }),
  };
  const descriptorDraft = {
    protocol_version: "postgresql-snapshot@1.0.0",
    scope_hash: await sha256ContentHash(scope),
    run_id: ids.run,
    execution_id: ids.execution,
    principal_id: ids.principal,
    datasource_id: ids.datasource,
    datasource_fingerprint: "fixture-cluster@1",
    schema_version: sql.schema_version,
    strategy: "CONTROLLED_REVISION",
    intent: "RESOLVE",
    snapshot_token: "fixture-snapshot@1.0.0",
    schema_manifest_hash: hash("3"),
    data_manifest_hash: hash("4"),
    fixture_manifest_hash: hash("5"),
    observed_at: issuedAt,
    replay_state: "REPLAYABLE",
    descriptor_hash: hash("0"),
  } as const;
  const descriptor = {
    ...descriptorDraft,
    descriptor_hash: await computeSnapshotDescriptorHash(descriptorDraft),
  } satisfies SnapshotDescriptor;
  const identity = {
    protocol_version: "sandbox-execution-identity@1.0.0",
    scope,
    scope_hash: descriptor.scope_hash,
    run_id: ids.run,
    execution_id: ids.execution,
    principal_id: ids.principal,
    idempotency_key: "python-sandbox-fixture",
    input_hash: hash("1"),
    sql_artifact_ref: reference("SqlArtifact", ids.sql, sql.sql_artifact_hash),
    execution_permit_ref: reference("ExecutionPermit", ids.permit, hash("6")),
    execution_permit_expires_at: permitExpiresAt,
    resource_admission_ref: reference("ResourceAdmissionReceipt", ids.admission, hash("7")),
    policy_receipt_ref: reference("PolicyReceipt", ids.policy, hash("8")),
    query_hash: sql.query_hash,
    parameters_hash: await sha256ContentHash(sql.parameters),
    ordered_parameters_hash: await computeOrderedSandboxSqlParametersHash(sql.parameters),
    datasource_id: ids.datasource,
    schema_version: sql.schema_version,
    settings_hash: await computePostgresqlExecutionSettingsHash({
      database_role: settings.database_role,
      search_path: settings.search_path,
      plan_cache_mode: settings.plan_cache_mode,
      statement_timeout_ms: settings.statement_timeout_ms,
      lock_timeout_ms: settings.lock_timeout_ms,
    }),
    budget,
    snapshot_requirement: { mode: "REQUIRE_REPLAYABLE" },
  } as const;
  const grantDraft = {
    protocol_version: "sandbox-execution-grant@1.0.0",
    identity,
    attempt_id: ids.attempt,
    attempt: 1,
    fencing_token: 7,
    lease_id: ids.lease,
    lease_expires_at: leaseExpiresAt,
    cancel_epoch: 0,
    snapshot_descriptor: descriptor,
    fixture_manifest_hash: descriptor.fixture_manifest_hash,
    budget,
    issued_at: issuedAt,
    grant_hash: hash("0"),
  } as const;
  const grant = {
    ...grantDraft,
    grant_hash: await computeExecutionGrantHash(grantDraft),
  } satisfies ExecutionGrant;
  const snapshot = {
    strategy: "CONTROLLED_REVISION",
    scope,
    run_id: ids.run,
    principal_id: ids.principal,
    datasource_id: ids.datasource,
    snapshot_token: descriptor.snapshot_token,
    schema_name: "fixture_snapshot",
    schema_manifest_hash: descriptor.schema_manifest_hash,
    data_manifest_hash: descriptor.data_manifest_hash,
    fixture_manifest_hash: descriptor.fixture_manifest_hash,
    relations: [
      {
        schema_name: "fixture_snapshot",
        relation_name: "facts",
        relation_oid: 16_401,
        schema_hash: descriptor.schema_manifest_hash,
        data_hash: descriptor.data_manifest_hash,
      },
    ],
  } as const;
  return { budget, grant, settings, snapshot, sql };
}

async function makeOutcome(
  fixture: Awaited<ReturnType<typeof protocolFixture>>,
  options: {
    readonly terminal?: "COMPLETED" | "CANCELLED";
    readonly lease_id?: string;
  } = {},
): Promise<SandboxExecutionOutcome> {
  const cancelled = options.terminal === "CANCELLED";
  const completedResult = {
    columns: [{ name: "result", type: "INTEGER" as const }],
    rows: [[7]],
  };
  const completedResultBytes = computeSandboxResultBytes(completedResult);
  const outcomeDraft = {
    protocol_version: "sandbox-execution-outcome@1.0.0",
    identity: fixture.grant.identity,
    grant_hash: fixture.grant.grant_hash,
    input_hash: fixture.grant.identity.input_hash,
    execution_id: fixture.grant.identity.execution_id,
    attempt_id: fixture.grant.attempt_id,
    execution_fence: fixture.grant.fencing_token,
    lease_id: options.lease_id ?? fixture.grant.lease_id,
    cancel_epoch_at_start: fixture.grant.cancel_epoch,
    cancel_epoch_observed: cancelled ? fixture.grant.cancel_epoch + 1 : fixture.grant.cancel_epoch,
    sql_artifact_hash: fixture.grant.identity.sql_artifact_ref.content_hash,
    snapshot_descriptor_hash: fixture.grant.snapshot_descriptor.descriptor_hash,
    fixture_manifest_hash: fixture.grant.fixture_manifest_hash,
    started_at: issuedAt,
    completed_at: "2026-07-27T00:00:00.010Z",
    resource_facts: {
      elapsed_ms: 10,
      observed_rows: 1,
      observed_bytes: cancelled ? 32 : completedResultBytes,
      peak_memory_mb: 1,
      retained_canonical_bytes: cancelled ? 0 : completedResultBytes,
      current_batch_estimated_bytes: 0,
      process_rss_high_water_bytes: 1_048_576,
      cgroup_memory_limit_enforced: false,
      partial_output_discarded: cancelled,
      cutoff_kind: "NONE",
    },
    cancel_facts: {
      cancel_requested: cancelled,
      query_cancel_dispatched: cancelled,
      query_cancel_confirmed: cancelled,
      cancel_disposition: cancelled ? "QUERY_CANCEL_CONFIRMED" : "NOT_REQUESTED",
      cancel_epoch_at_start: fixture.grant.cancel_epoch,
      cancel_epoch_observed: cancelled
        ? fixture.grant.cancel_epoch + 1
        : fixture.grant.cancel_epoch,
      cancel_requested_at: cancelled ? issuedAt : null,
    },
    rollback_facts: {
      rollback_confirmed: true,
      datasource_terminal: "ROLLED_BACK_CLEAN",
    },
    connection_facts: {
      backend_pid: 123,
      transaction_status: "IDLE",
      connection_reused: true,
    },
    transaction: {
      transaction_id: ids.transaction,
      read_only: true,
      isolation_level: "REPEATABLE_READ",
    },
    applied_execution_settings: {
      database_role: settings.database_role,
      search_path: settings.search_path,
      plan_cache_mode: settings.plan_cache_mode,
      statement_timeout_ms: settings.statement_timeout_ms,
      lock_timeout_ms: settings.lock_timeout_ms,
    },
    manifest_facts: {
      snapshot_descriptor_hash: fixture.grant.snapshot_descriptor.descriptor_hash,
      schema_manifest_hash: fixture.grant.snapshot_descriptor.schema_manifest_hash,
      data_manifest_hash: fixture.grant.snapshot_descriptor.data_manifest_hash,
      fixture_manifest_hash: fixture.grant.snapshot_descriptor.fixture_manifest_hash,
      manifest_revalidated: true,
      revalidated_at: issuedAt,
    },
    canonical_multiset_facts: {
      canonical_multiset_hash: cancelled
        ? null
        : await computeSandboxCanonicalMultisetHash(completedResult.rows),
      ordered_result_hash: cancelled
        ? null
        : await computeSandboxOrderedResultHash(completedResult),
    },
    terminal: cancelled ? ("CANCELLED" as const) : ("COMPLETED" as const),
    reason_code: cancelled
      ? ("SANDBOX_CANCELLED" as const)
      : ("SANDBOX_EXECUTION_COMPLETED" as const),
    result: cancelled ? null : completedResult,
    outcome_checksum: hash("0"),
  };
  return sandboxExecutionOutcomeSchema.parse({
    ...outcomeDraft,
    outcome_checksum: await computeSandboxExecutionOutcomeChecksum(outcomeDraft),
  });
}

async function withSearchPath(
  fixture: Awaited<ReturnType<typeof protocolFixture>>,
  searchPath: readonly string[],
) {
  const reboundSettings = {
    ...fixture.settings,
    search_path: [...searchPath],
  };
  const identity = {
    ...fixture.grant.identity,
    settings_hash: await computePostgresqlExecutionSettingsHash({
      database_role: reboundSettings.database_role,
      search_path: reboundSettings.search_path,
      plan_cache_mode: reboundSettings.plan_cache_mode,
      statement_timeout_ms: reboundSettings.statement_timeout_ms,
      lock_timeout_ms: reboundSettings.lock_timeout_ms,
    }),
  };
  const grantDraft = {
    ...fixture.grant,
    identity,
    grant_hash: hash("0"),
  };
  return {
    ...fixture,
    settings: reboundSettings,
    grant: {
      ...grantDraft,
      grant_hash: await computeExecutionGrantHash(grantDraft),
    },
  };
}

function nodeClient(source: string, environment?: NodeJS.ProcessEnv) {
  return createPythonSqlSandboxClient({
    command: execPath,
    datasource_id: ids.datasource,
    datasource_fingerprint: "fixture-cluster@1",
    args: ["--input-type=module", "--eval", source],
    ...(environment ? { server_environment: environment } : {}),
  });
}

function outcomeSource(outcome: SandboxExecutionOutcome, waitForCancel = false): string {
  const encoded = JSON.stringify({
    protocol_version: "data-agent-sql-sandbox@1.0.0",
    frame_type: "OUTCOME",
    outcome,
  });
  return `
    import { createInterface } from "node:readline";
    const lines = createInterface({ input: process.stdin });
    const frames = [];
    lines.on("line", (line) => {
      frames.push(JSON.parse(line));
      if (frames.length === ${waitForCancel ? 2 : 1}) {
        process.stdout.write(${JSON.stringify(`${encoded}\n`)});
        process.exit(0);
      }
    });
  `;
}

describe("Python SQL Sandbox client", () => {
  it("accepts one exact contracts Outcome and keeps the DSN out of stdin", async () => {
    const fixture = await protocolFixture();
    const outcome = await makeOutcome(fixture);
    const secretDsn = "postgresql://sandbox-secret-must-stay-in-env";
    const client = nodeClient(
      `
        process.stdin.once("data", (chunk) => {
          if (chunk.toString().includes(process.env.DATA_AGENT_SANDBOX_DSN)) process.exit(9);
          process.stdout.write(${JSON.stringify(
            `${JSON.stringify({
              protocol_version: "data-agent-sql-sandbox@1.0.0",
              frame_type: "OUTCOME",
              outcome,
            })}\n`,
          )});
          process.exit(0);
        });
      `,
      { ...process.env, DATA_AGENT_SANDBOX_DSN: secretDsn },
    );

    const execution = await client.start(fixture);
    await expect(execution.outcome).resolves.toEqual(outcome);
  });

  it("rejects a structurally valid Outcome from another Lease", async () => {
    const fixture = await protocolFixture();
    const staleOutcome = await makeOutcome(fixture, {
      lease_id: "00000000-0000-4000-8000-00000000c999",
    });
    const execution = await nodeClient(outcomeSource(staleOutcome)).start(fixture);

    await expect(execution.outcome).rejects.toBeInstanceOf(PythonSqlSandboxProtocolError);
  });

  it("accepts a bound pre-query failure without claiming Manifest revalidation", async () => {
    const fixture = await protocolFixture();
    const completed = await makeOutcome(fixture);
    const failedDraft = {
      ...completed,
      terminal: "FAILED" as const,
      reason_code: "SANDBOX_SNAPSHOT_AUTHORITY_BREACH" as const,
      result: null,
      resource_facts: {
        ...completed.resource_facts,
        observed_rows: 0,
        observed_bytes: 0,
        retained_canonical_bytes: 0,
        partial_output_discarded: true,
      },
      rollback_facts: {
        rollback_confirmed: false,
        datasource_terminal: "ROLLBACK_UNCONFIRMED" as const,
      },
      connection_facts: {
        backend_pid: null,
        transaction_status: "UNKNOWN" as const,
        connection_reused: false,
      },
      manifest_facts: {
        ...completed.manifest_facts,
        manifest_revalidated: false,
      },
      canonical_multiset_facts: {
        canonical_multiset_hash: null,
        ordered_result_hash: null,
      },
      outcome_checksum: hash("0"),
    };
    const failed = sandboxExecutionOutcomeSchema.parse({
      ...failedDraft,
      outcome_checksum: await computeSandboxExecutionOutcomeChecksum(failedDraft),
    });
    const execution = await nodeClient(outcomeSource(failed)).start(fixture);

    await expect(execution.outcome).resolves.toMatchObject({
      terminal: "FAILED",
      manifest_facts: { manifest_revalidated: false },
    });
  });

  it("derives the duplex cancel frame from the active Grant", async () => {
    const fixture = await protocolFixture();
    const cancelled = await makeOutcome(fixture, { terminal: "CANCELLED" });
    const execution = await nodeClient(outcomeSource(cancelled, true)).start(fixture);

    execution.cancel({
      cancel_epoch: 1,
      requested_at: issuedAt,
      reason_code: "USER_CANCELLED",
    });

    await expect(execution.outcome).resolves.toMatchObject({
      terminal: "CANCELLED",
      cancel_epoch_observed: 1,
    });
    expect(() =>
      execution.cancel({
        cancel_epoch: 2,
        requested_at: issuedAt,
        reason_code: "USER_CANCELLED",
      }),
    ).toThrow(PythonSqlSandboxProtocolError);
  });

  it("rejects SQL parameter substitution before starting a process", async () => {
    const fixture = await protocolFixture();
    const client = createPythonSqlSandboxClient({
      command: "/definitely/not/a/real/sandbox",
      datasource_id: ids.datasource,
      datasource_fingerprint: "fixture-cluster@1",
    });

    await expect(
      client.start({
        ...fixture,
        sql: {
          ...fixture.sql,
          parameters: { $1: 8 },
        },
      }),
    ).rejects.toBeInstanceOf(PythonSqlSandboxProtocolError);
  });

  it("rejects an ordered parameter array that diverges from the frozen SQL map", async () => {
    const fixture = await protocolFixture();
    const client = createPythonSqlSandboxClient({
      command: "/definitely/not/a/real/sandbox",
      datasource_id: ids.datasource,
      datasource_fingerprint: "fixture-cluster@1",
    });

    await expect(
      client.start({
        ...fixture,
        sql: {
          ...fixture.sql,
          ordered_parameters: [8],
        },
      }),
    ).rejects.toBeInstanceOf(PythonSqlSandboxProtocolError);
  });

  it("rejects a Grant wired to another datasource profile before process spawn", async () => {
    const fixture = await protocolFixture();
    const wrongDatasource = createPythonSqlSandboxClient({
      command: "/definitely/not/a/real/sandbox",
      datasource_id: "00000000-0000-4000-8000-00000000d999",
      datasource_fingerprint: "fixture-cluster@1",
    });
    const wrongFingerprint = createPythonSqlSandboxClient({
      command: "/definitely/not/a/real/sandbox",
      datasource_id: ids.datasource,
      datasource_fingerprint: "fixture-cluster@forged",
    });

    await expect(wrongDatasource.start(fixture)).rejects.toBeInstanceOf(
      PythonSqlSandboxProtocolError,
    );
    await expect(wrongFingerprint.start(fixture)).rejects.toBeInstanceOf(
      PythonSqlSandboxProtocolError,
    );
  });

  it("rejects a Controlled Snapshot whose bound search_path can resolve another schema", async () => {
    const fixture = await withSearchPath(await protocolFixture(), [
      "other_schema",
      "pg_catalog",
      "fixture_snapshot",
    ]);
    const client = createPythonSqlSandboxClient({
      command: "/definitely/not/a/real/sandbox",
      datasource_id: ids.datasource,
      datasource_fingerprint: "fixture-cluster@1",
    });

    await expect(client.start(fixture)).rejects.toThrow(
      "Sandbox search_path 必须精确绑定 pg_catalog 与当前 sealed Snapshot Schema。",
    );
  });
});
