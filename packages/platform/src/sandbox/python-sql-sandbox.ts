import {
  canonicalizeJson,
  computeOrderedSandboxSqlParametersHash,
  computePostgresqlExecutionSettingsHash,
  computeSandboxCanonicalMultisetHash,
  computeSandboxOrderedResultHash,
  deriveOrderedSandboxSqlParameters,
  postgresqlExecutionSettingsSchema,
  sandboxOrderedSqlParametersSchema,
  sandboxSqlParametersSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  computeExecutionGrantHash,
  computeSandboxExecutionOutcomeChecksum,
  computeSnapshotDescriptorHash,
  type ExecutionGrant,
  executionGrantSchema,
  type SandboxExecutionOutcome,
  sandboxExecutionOutcomeSchema,
} from "@data-agent/contracts/server";
import { z } from "zod";
import {
  type SingleExecutionNdjsonProcess,
  startSingleExecutionNdjsonProcess,
} from "./ndjson-process.internal.js";
import { assertPostgresqlSandboxSqlPolicy } from "./postgresql-sql-policy.internal.js";

const SQL_SANDBOX_WIRE_PROTOCOL_VERSION = "data-agent-sql-sandbox@1.0.0";

const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const scopeSchema = z.strictObject({
  app_id: z.uuid(),
  tenant_id: z.uuid(),
  environment: z.string().min(1).max(64),
});
const relationManifestEntrySchema = z.strictObject({
  schema_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/),
  relation_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/),
  relation_oid: z.number().int().positive(),
  schema_hash: contentHashSchema,
  data_hash: contentHashSchema,
});
const snapshotPlanBase = {
  scope: scopeSchema,
  run_id: z.uuid(),
  principal_id: z.string().min(1).max(256),
  datasource_id: z.uuid(),
} as const;
const pythonSnapshotPlanSchema = z.discriminatedUnion("strategy", [
  z.strictObject({
    ...snapshotPlanBase,
    strategy: z.literal("NONE"),
    snapshot_token: z.null(),
    schema_name: z.null(),
    schema_manifest_hash: z.null(),
    data_manifest_hash: z.null(),
    fixture_manifest_hash: z.null(),
    relations: z.tuple([]),
  }),
  z
    .strictObject({
      ...snapshotPlanBase,
      strategy: z.literal("CONTROLLED_REVISION"),
      snapshot_token: z.string().min(1).max(255),
      schema_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/),
      schema_manifest_hash: contentHashSchema,
      data_manifest_hash: contentHashSchema,
      fixture_manifest_hash: contentHashSchema,
      relations: z.array(relationManifestEntrySchema).min(1),
    })
    .superRefine((plan, ctx) => {
      const relationKeys = plan.relations.map(
        (relation) => `${relation.schema_name}\u0000${relation.relation_name}`,
      );
      const sortedKeys = [...relationKeys].sort();
      const relationOids = plan.relations.map((relation) => relation.relation_oid);
      if (
        relationKeys.some((key, index) => key !== sortedKeys[index]) ||
        new Set(relationKeys).size !== relationKeys.length ||
        new Set(relationOids).size !== relationOids.length ||
        plan.relations.some((relation) => relation.schema_name !== plan.schema_name)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Controlled Revision Relations 必须排序、唯一且属于同一个 sealed schema。",
          path: ["relations"],
        });
      }
    }),
]);

const pythonSqlOperationSchema = z.strictObject({
  dialect: z.literal("postgresql"),
  datasource_id: z.uuid(),
  schema_version: z.string().min(1).max(255),
  sql_artifact_hash: contentHashSchema,
  query: z.string().min(1).max(100_000),
  parameters: sandboxSqlParametersSchema,
  ordered_parameters: sandboxOrderedSqlParametersSchema,
  query_hash: contentHashSchema,
});

const pythonSandboxSettingsSchema = postgresqlExecutionSettingsSchema.safeExtend({
  idle_in_transaction_session_timeout_ms: z.number().int().positive().max(3_600_000),
});

const pythonSandboxBudgetSchema = z.strictObject({
  timeout_ms: z.number().int().positive().max(300_000),
  lock_timeout_ms: z.number().int().positive().max(300_000),
  max_rows: z.number().int().positive().max(10_000),
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
  max_memory_mb: z.number().int().positive().max(512),
});

const pythonSqlSandboxStartInputSchema = z.strictObject({
  grant: executionGrantSchema,
  sql: pythonSqlOperationSchema,
  snapshot: pythonSnapshotPlanSchema,
  settings: pythonSandboxSettingsSchema,
  budget: pythonSandboxBudgetSchema,
});

const pythonSandboxOutcomeEnvelopeSchema = z.strictObject({
  protocol_version: z.literal(SQL_SANDBOX_WIRE_PROTOCOL_VERSION),
  frame_type: z.literal("OUTCOME"),
  outcome: sandboxExecutionOutcomeSchema,
});

const cancelReasonCodeSchema = z.enum(["USER_CANCELLED", "DEADLINE_EXCEEDED", "AUTHORITY_REVOKED"]);
const timestampSchema = z.iso.datetime({ offset: true });

type PythonSqlSandboxStartInput = z.infer<typeof pythonSqlSandboxStartInputSchema>;
type PythonSnapshotPlan = z.infer<typeof pythonSnapshotPlanSchema>;

export interface PythonSqlSandboxClientOptions {
  readonly command: string;
  /**
   * 由服务端 Datasource Registry 解析出的稳定绑定。Client 会在启动子进程前
   * 精确核对 Grant，并把同一绑定以只读环境变量交给 Python 执行器复核。
   */
  readonly datasource_id: string;
  readonly datasource_fingerprint: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly server_environment?: NodeJS.ProcessEnv;
  readonly protocol_grace_ms?: number;
}

export interface PythonSqlSandboxCancelInput {
  readonly cancel_epoch: number;
  readonly requested_at: string;
  readonly reason_code: z.infer<typeof cancelReasonCodeSchema>;
}

export interface PythonSqlSandboxExecutionHandle {
  readonly grant: ExecutionGrant;
  readonly outcome: Promise<SandboxExecutionOutcome>;
  cancel(input: PythonSqlSandboxCancelInput): void;
  terminate(): void;
}

export interface PythonSqlSandboxClient {
  start(input: unknown): Promise<PythonSqlSandboxExecutionHandle>;
}

export class PythonSqlSandboxProtocolError extends Error {
  override readonly name = "PythonSqlSandboxProtocolError";
  readonly code = "SANDBOX_OUTCOME_BINDING_MISMATCH";
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameExecutionIdentity(
  left: ExecutionGrant["identity"],
  right: ExecutionGrant["identity"],
): boolean {
  return sameJson(
    {
      ...left,
      execution_permit_expires_at: new Date(left.execution_permit_expires_at).toISOString(),
    },
    {
      ...right,
      execution_permit_expires_at: new Date(right.execution_permit_expires_at).toISOString(),
    },
  );
}

function contractExecutionSettings(
  settings: z.infer<typeof pythonSandboxSettingsSchema>,
): z.infer<typeof postgresqlExecutionSettingsSchema> {
  return postgresqlExecutionSettingsSchema.parse({
    database_role: settings.database_role,
    search_path: settings.search_path,
    plan_cache_mode: settings.plan_cache_mode,
    statement_timeout_ms: settings.statement_timeout_ms,
    lock_timeout_ms: settings.lock_timeout_ms,
  });
}

function assertSnapshotPlanBinding(grant: ExecutionGrant, plan: PythonSnapshotPlan): void {
  const descriptor = grant.snapshot_descriptor;
  if (descriptor.strategy !== plan.strategy) {
    throw new PythonSqlSandboxProtocolError("Sandbox Snapshot Plan 与 ExecutionGrant 不匹配。");
  }
  if (
    !sameJson(grant.identity.scope, plan.scope) ||
    grant.identity.run_id !== plan.run_id ||
    grant.identity.principal_id !== plan.principal_id ||
    grant.identity.datasource_id !== plan.datasource_id
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Sandbox Snapshot Plan 的 Scope/Run/Principal/Datasource 与 Grant 不匹配。",
    );
  }
  if (descriptor.strategy === "NONE" && plan.strategy === "NONE") {
    return;
  }
  if (descriptor.strategy !== "CONTROLLED_REVISION" || plan.strategy !== "CONTROLLED_REVISION") {
    throw new PythonSqlSandboxProtocolError("Sandbox Snapshot Strategy 发生换绑。");
  }
  if (
    descriptor.snapshot_token !== plan.snapshot_token ||
    descriptor.schema_manifest_hash !== plan.schema_manifest_hash ||
    descriptor.data_manifest_hash !== plan.data_manifest_hash ||
    descriptor.fixture_manifest_hash !== plan.fixture_manifest_hash ||
    grant.fixture_manifest_hash !== plan.fixture_manifest_hash
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Sandbox Snapshot Plan 的 Token 或完整 Manifest 与 Descriptor 不匹配。",
    );
  }
}

function assertSearchPathBinding(
  plan: PythonSnapshotPlan,
  settings: z.infer<typeof pythonSandboxSettingsSchema>,
): void {
  const expected =
    plan.strategy === "CONTROLLED_REVISION"
      ? ([plan.schema_name, "pg_catalog"] as const)
      : (["pg_catalog"] as const);
  if (!sameJson(settings.search_path, expected)) {
    throw new PythonSqlSandboxProtocolError(
      "Sandbox search_path 必须精确绑定 pg_catalog 与当前 sealed Snapshot Schema。",
    );
  }
}

async function validateStartInput(
  input: unknown,
  datasourceBinding: {
    readonly datasource_id: string;
    readonly datasource_fingerprint: string;
  },
): Promise<PythonSqlSandboxStartInput> {
  const parsed = pythonSqlSandboxStartInputSchema.parse(input);
  const { grant, sql, settings, budget } = parsed;
  const appliedSettings = contractExecutionSettings(settings);
  if (
    (await computeExecutionGrantHash(grant)) !== grant.grant_hash ||
    (await computeSnapshotDescriptorHash(grant.snapshot_descriptor)) !==
      grant.snapshot_descriptor.descriptor_hash
  ) {
    throw new PythonSqlSandboxProtocolError(
      "ExecutionGrant 或 SnapshotDescriptor Hash 与规范内容不匹配。",
    );
  }
  const [queryHash, parametersHash, orderedParametersHash, settingsHash] = await Promise.all([
    sha256ContentHash({
      dialect: sql.dialect,
      sql: sql.query,
      parameters: sql.parameters,
    }),
    sha256ContentHash(sql.parameters),
    computeOrderedSandboxSqlParametersHash(sql.parameters),
    computePostgresqlExecutionSettingsHash(appliedSettings),
  ]);
  const orderedParameters = deriveOrderedSandboxSqlParameters(sql.parameters);
  const placeholderNumbers = [...sql.query.matchAll(/\$([1-9][0-9]*)/g)].map((match) =>
    Number(match[1]),
  );
  const parameterNumbers = Object.keys(sql.parameters).map((key) => Number(key.slice(1)));
  const uniquePlaceholders = [...new Set(placeholderNumbers)].sort((left, right) => left - right);
  const uniqueParameters = [...new Set(parameterNumbers)].sort((left, right) => left - right);
  const expectedPlaceholders = Array.from(
    { length: uniquePlaceholders.at(-1) ?? 0 },
    (_, index) => index + 1,
  );
  if (
    sql.datasource_id !== grant.identity.datasource_id ||
    sql.schema_version !== grant.identity.schema_version ||
    sql.sql_artifact_hash !== grant.identity.sql_artifact_ref.content_hash ||
    sql.query_hash !== grant.identity.query_hash ||
    sql.query_hash !== queryHash ||
    grant.identity.parameters_hash !== parametersHash ||
    grant.identity.ordered_parameters_hash !== orderedParametersHash ||
    !sameJson(sql.ordered_parameters, orderedParameters) ||
    grant.identity.settings_hash !== settingsHash ||
    !sameJson(budget, grant.budget) ||
    settings.statement_timeout_ms !== budget.timeout_ms ||
    settings.lock_timeout_ms !== budget.lock_timeout_ms ||
    !sameJson(uniquePlaceholders, uniqueParameters) ||
    !sameJson(uniquePlaceholders, expectedPlaceholders)
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Python SQL Operation 的 SQL、Parameters、Settings 或 Budget 与 Grant 不匹配。",
    );
  }
  if (
    grant.identity.datasource_id !== datasourceBinding.datasource_id ||
    grant.snapshot_descriptor.datasource_fingerprint !== datasourceBinding.datasource_fingerprint
  ) {
    throw new PythonSqlSandboxProtocolError(
      "ExecutionGrant 的 Datasource Identity/Fingerprint 与服务端 Registry 连接配置不匹配。",
    );
  }
  assertSnapshotPlanBinding(grant, parsed.snapshot);
  assertSearchPathBinding(parsed.snapshot, settings);
  await assertPostgresqlSandboxSqlPolicy({
    sql: sql.query,
    allowed_relations: parsed.snapshot.relations,
  });
  return parsed;
}

async function validateOutcomeBinding(
  outcome: SandboxExecutionOutcome,
  input: PythonSqlSandboxStartInput,
): Promise<SandboxExecutionOutcome> {
  const { grant, settings, budget } = input;
  if (
    !sameExecutionIdentity(outcome.identity, grant.identity) ||
    outcome.grant_hash !== grant.grant_hash ||
    outcome.input_hash !== grant.identity.input_hash ||
    outcome.execution_id !== grant.identity.execution_id ||
    outcome.attempt_id !== grant.attempt_id ||
    outcome.execution_fence !== grant.fencing_token ||
    outcome.lease_id !== grant.lease_id ||
    outcome.cancel_epoch_at_start !== grant.cancel_epoch ||
    outcome.sql_artifact_hash !== grant.identity.sql_artifact_ref.content_hash ||
    outcome.snapshot_descriptor_hash !== grant.snapshot_descriptor.descriptor_hash ||
    outcome.fixture_manifest_hash !== grant.fixture_manifest_hash ||
    !sameJson(budget, grant.budget) ||
    (await computeSandboxExecutionOutcomeChecksum(outcome)) !== outcome.outcome_checksum
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Python Sandbox Outcome 未精确回显当前 Grant 的不可变 Identity。",
    );
  }
  if (
    outcome.terminal === "COMPLETED" &&
    (outcome.canonical_multiset_facts.canonical_multiset_hash !==
      (await computeSandboxCanonicalMultisetHash(outcome.result.rows)) ||
      outcome.canonical_multiset_facts.ordered_result_hash !==
        (await computeSandboxOrderedResultHash(outcome.result)))
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Python Sandbox Outcome 的 canonical multiset 或 ordered result hash 不可信。",
    );
  }
  const appliedSettings = contractExecutionSettings(settings);
  if (
    !sameJson(outcome.applied_execution_settings, appliedSettings) ||
    outcome.resource_facts.observed_rows > budget.max_rows ||
    outcome.resource_facts.observed_bytes > budget.max_bytes ||
    outcome.resource_facts.peak_memory_mb > budget.max_memory_mb ||
    outcome.resource_facts.elapsed_ms > budget.timeout_ms ||
    Date.parse(outcome.completed_at) > Date.parse(grant.lease_expires_at)
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Python Sandbox Outcome 的 Settings、Resource Facts 或 Lease Deadline 不可信。",
    );
  }
  if (
    grant.snapshot_descriptor.strategy === "CONTROLLED_REVISION" &&
    ((outcome.terminal === "COMPLETED" && !outcome.manifest_facts.manifest_revalidated) ||
      outcome.manifest_facts.schema_manifest_hash !==
        grant.snapshot_descriptor.schema_manifest_hash ||
      outcome.manifest_facts.data_manifest_hash !== grant.snapshot_descriptor.data_manifest_hash ||
      outcome.manifest_facts.fixture_manifest_hash !==
        grant.snapshot_descriptor.fixture_manifest_hash ||
      !outcome.transaction.read_only ||
      outcome.transaction.isolation_level !== "REPEATABLE_READ")
  ) {
    throw new PythonSqlSandboxProtocolError(
      "Python Sandbox Outcome 未证明同一 Controlled Revision 的 RR/RO Manifest 复核。",
    );
  }
  return outcome;
}

function startProcess(
  options: PythonSqlSandboxClientOptions,
  input: PythonSqlSandboxStartInput,
): SingleExecutionNdjsonProcess<z.infer<typeof pythonSandboxOutcomeEnvelopeSchema>> {
  const protocolGraceMs = options.protocol_grace_ms ?? 5_000;
  if (!Number.isSafeInteger(protocolGraceMs) || protocolGraceMs < 0) {
    throw new TypeError("Sandbox protocol grace 必须是非负安全整数。");
  }
  return startSingleExecutionNdjsonProcess({
    command: options.command,
    ...(options.args ? { args: options.args } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: {
      ...(options.server_environment ?? process.env),
      DATA_AGENT_SANDBOX_DATASOURCE_ID: options.datasource_id,
      DATA_AGENT_SANDBOX_DATASOURCE_FINGERPRINT: options.datasource_fingerprint,
    },
    execute_frame: {
      protocol_version: SQL_SANDBOX_WIRE_PROTOCOL_VERSION,
      frame_type: "EXECUTE",
      ...input,
    },
    parse_outcome: (value) => pythonSandboxOutcomeEnvelopeSchema.parse(value),
    protocol_timeout_ms: input.budget.timeout_ms + protocolGraceMs,
    max_stdout_bytes: input.budget.max_bytes + 16 * 1024 * 1024,
  });
}

export function createPythonSqlSandboxClient(
  options: PythonSqlSandboxClientOptions,
): PythonSqlSandboxClient {
  if (options.command.length === 0) {
    throw new TypeError("Python Sandbox command 不能为空。");
  }
  const datasourceBinding = z
    .strictObject({
      datasource_id: z.uuid(),
      datasource_fingerprint: z.string().min(1).max(255),
    })
    .parse({
      datasource_id: options.datasource_id,
      datasource_fingerprint: options.datasource_fingerprint,
    });
  return {
    async start(input: unknown): Promise<PythonSqlSandboxExecutionHandle> {
      const parsed = await validateStartInput(input, datasourceBinding);
      const process = startProcess(options, parsed);
      let cancelSent = false;
      return {
        grant: parsed.grant,
        outcome: process.outcome.then((envelope) =>
          validateOutcomeBinding(envelope.outcome, parsed),
        ),
        cancel(cancelInput: PythonSqlSandboxCancelInput): void {
          const cancel = z
            .strictObject({
              cancel_epoch: z.number().int().positive(),
              requested_at: timestampSchema,
              reason_code: cancelReasonCodeSchema,
            })
            .parse(cancelInput);
          if (cancelSent || cancel.cancel_epoch !== parsed.grant.cancel_epoch + 1) {
            throw new PythonSqlSandboxProtocolError(
              "U5 单 Execution Cancel 必须且只能把 Grant Epoch 精确增加一次。",
            );
          }
          cancelSent = true;
          process.send({
            protocol_version: SQL_SANDBOX_WIRE_PROTOCOL_VERSION,
            frame_type: "CANCEL",
            grant_hash: parsed.grant.grant_hash,
            execution_id: parsed.grant.identity.execution_id,
            attempt_id: parsed.grant.attempt_id,
            execution_fence: parsed.grant.fencing_token,
            lease_id: parsed.grant.lease_id,
            cancel_epoch: cancel.cancel_epoch,
            requested_at: cancel.requested_at,
            reason_code: cancel.reason_code,
          });
        },
        terminate(): void {
          process.terminate();
        },
      };
    },
  };
}
