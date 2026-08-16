import {
  buildContextReceiptBindingCandidate,
  buildEffectiveRunConfigReceiptCandidate,
  buildRunConfigRequestCandidate,
  buildRunConfigResolutionReceiptCandidate,
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  buildWorkspaceDefaultsRevisionCandidate,
  type RunConfigRequest,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresEffectiveConfigResolver } from "../../src/runs/effective-config-resolver.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  job: "00000000-0000-4000-8000-000000000006",
  command: "00000000-0000-4000-8000-000000000007",
  event: "00000000-0000-4000-8000-000000000008",
  outbox: "00000000-0000-4000-8000-000000000009",
  config: "00000000-0000-4000-8000-00000000000a",
  defaults: "00000000-0000-4000-8000-00000000000b",
  route: "00000000-0000-4000-8000-00000000000c",
  model: "00000000-0000-4000-8000-00000000000d",
  datasource: "00000000-0000-4000-8000-00000000000e",
  semantic: "00000000-0000-4000-8000-00000000000f",
  snapshot: "00000000-0000-4000-8000-000000000010",
  context: "00000000-0000-4000-8000-000000000011",
  egress: "00000000-0000-4000-8000-000000000012",
  safety: "00000000-0000-4000-8000-000000000013",
  receipt: "00000000-0000-4000-8000-000000000014",
  consumer: "00000000-0000-4000-8000-000000000015",
  audit: "00000000-0000-4000-8000-000000000016",
  attempt: "00000000-0000-4000-8000-000000000017",
  file: "00000000-0000-4000-8000-000000000018",
  knowledge: "00000000-0000-4000-8000-000000000019",
  mention: "00000000-0000-4000-8000-00000000001a",
  otherSource: "00000000-0000-4000-8000-00000000001b",
} as const;

const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const H4 = `sha256:${"4".repeat(64)}` as const;
const H5 = `sha256:${"5".repeat(64)}` as const;
const H6 = `sha256:${"6".repeat(64)}` as const;

function access(role: "OWNER" | "ANALYST" | "VIEWER" = "ANALYST") {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.workspace,
        role,
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("fixture authority missing");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  let connectCount = 0;
  const pool: SqlPool = {
    async connect() {
      connectCount += 1;
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const result = handle(text, values);
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
    get connectCount() {
      return connectCount;
    },
    pool,
  };
}

function resource(resource_id: string, resource_revision: number, resource_hash: string) {
  return { resource_id, resource_revision, resource_hash };
}

function authorityBinding() {
  return {
    authz_epoch: 4,
    membership_version: 5,
    workspace_lifecycle_version: 6,
    route_resolution_id: ids.route,
    route_resolution_hash: H2,
    resolver_policy_version: "effective-config-resolver@1",
  } as const;
}

function scope() {
  return {
    app_id: ids.app,
    tenant_id: ids.workspace,
    environment: "test" as const,
    workspace_id: ids.workspace,
    principal_id: ids.principal,
  };
}

function defaultsRef() {
  return { defaults_id: ids.defaults, defaults_revision: 1, defaults_hash: H1 } as const;
}

function defaultsValue() {
  return {
    model: resource(ids.model, 2, H2),
    datasource: resource(ids.datasource, 3, H3),
    files: [],
    knowledge: [],
    mcp_servers: [],
    skills: [],
    semantic_release: resource(ids.semantic, 4, H4),
    schema_snapshot: resource(ids.snapshot, 5, H5),
    context_policy: resource(ids.context, 6, H6),
    egress_policy: resource(ids.egress, 7, H1),
    execution_safety_policy: resource(ids.safety, 8, H2),
  };
}

function defaultsSelection() {
  return {
    model: { resource_id: ids.model, expected_revision: 2 },
    datasource: { resource_id: ids.datasource, expected_revision: 3 },
    files: [],
    knowledge: [],
    mcp_servers: [],
    skills: [],
    semantic_release: { resource_id: ids.semantic, expected_revision: 4 },
    schema_snapshot: { resource_id: ids.snapshot, expected_revision: 5 },
    context_policy: { resource_id: ids.context, expected_revision: 6 },
    egress_policy: { resource_id: ids.egress, expected_revision: 7 },
    execution_safety_policy: { resource_id: ids.safety, expected_revision: 8 },
  };
}

function conversationRef() {
  return { conversation_id: ids.receipt, expected_resource_version: 3 } as const;
}

function availableMandatoryBindings() {
  return [
    {
      resource_kind: "CONTEXT_POLICY" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.context, 6, H6),
      source: "POLICY" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "DATASOURCE" as const,
      mention_id: null,
      requested_resource_id: ids.datasource,
      requested_revision: 3,
      effective_resource: resource(ids.datasource, 3, H3),
      source: "DEFAULT" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "EGRESS_POLICY" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.egress, 7, H1),
      source: "POLICY" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "EXECUTION_SAFETY_POLICY" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.safety, 8, H2),
      source: "POLICY" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "MODEL_PROFILE" as const,
      mention_id: null,
      requested_resource_id: ids.model,
      requested_revision: 2,
      effective_resource: resource(ids.model, 2, H2),
      source: "DEFAULT" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "SCHEMA_SNAPSHOT" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.snapshot, 5, H5),
      source: "ACTIVE_POINTER" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
    {
      resource_kind: "SEMANTIC_RELEASE" as const,
      mention_id: null,
      requested_resource_id: null,
      requested_revision: null,
      effective_resource: resource(ids.semantic, 4, H4),
      source: "ACTIVE_POINTER" as const,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    },
  ];
}

function unavailableMandatoryBindings(
  kind: ReturnType<typeof availableMandatoryBindings>[number]["resource_kind"],
  unavailable_reason:
    | "RESOURCE_NOT_FOUND_OR_FORBIDDEN"
    | "RESOURCE_DISABLED"
    | "SEMANTIC_RELEASE_NOT_PUBLISHED",
) {
  const bindings = availableMandatoryBindings().map((binding) =>
    binding.resource_kind === kind
      ? {
          ...binding,
          effective_resource: null,
          availability: "UNAVAILABLE" as const,
          unavailable_reason,
        }
      : binding,
  );
  return kind === "DATASOURCE"
    ? bindings.filter(
        (binding) =>
          binding.resource_kind !== "SEMANTIC_RELEASE" &&
          binding.resource_kind !== "SCHEMA_SNAPSHOT",
      )
    : kind === "SEMANTIC_RELEASE"
      ? bindings.filter((binding) => binding.resource_kind !== "SCHEMA_SNAPSHOT")
      : bindings;
}

function mandatoryResourceRefs() {
  return [
    resource(ids.model, 2, H2),
    resource(ids.datasource, 3, H3),
    resource(ids.semantic, 4, H4),
    resource(ids.snapshot, 5, H5),
    resource(ids.context, 6, H6),
    resource(ids.egress, 7, H1),
    resource(ids.safety, 8, H2),
  ];
}

async function questionRequest() {
  const request = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "QUESTION_RUN",
    workspace_id: ids.workspace,
    run_id: ids.run,
    conversation_ref: conversationRef(),
    idempotency_key: "effective-config:test",
    defaults_ref: defaultsRef(),
    overrides: {
      model: { mode: "INHERIT_DEFAULT" },
      datasource: { mode: "INHERIT_DEFAULT" },
      files: { mode: "EXPLICIT_NONE" },
      knowledge: { mode: "INHERIT_DEFAULT" },
      mcp_servers: { mode: "EXPLICIT_NONE" },
      skills: { mode: "EXPLICIT_NONE" },
      egress: null,
    },
    mentions: [],
  });
  if (request.operation !== "QUESTION_RUN") throw new Error("QUESTION fixture mismatch");
  return request;
}

async function controlledOptionalQuestionRequest() {
  const request = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "QUESTION_RUN",
    workspace_id: ids.workspace,
    run_id: ids.run,
    conversation_ref: conversationRef(),
    idempotency_key: "effective-config:controlled-optionals",
    defaults_ref: defaultsRef(),
    overrides: {
      model: { mode: "INHERIT_DEFAULT" },
      datasource: { mode: "INHERIT_DEFAULT" },
      files: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.file, expected_revision: 2 }],
      },
      knowledge: { mode: "INHERIT_DEFAULT" },
      mcp_servers: { mode: "EXPLICIT_NONE" },
      skills: { mode: "EXPLICIT_NONE" },
      egress: null,
    },
    mentions: [
      {
        mention_id: ids.mention,
        resource_kind: "KNOWLEDGE",
        resource_id: ids.knowledge,
        expected_revision: 3,
      },
    ],
  });
  if (request.operation !== "QUESTION_RUN") throw new Error("QUESTION fixture mismatch");
  return request;
}

async function mandatoryOverrideQuestionRequest() {
  const request = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "QUESTION_RUN",
    workspace_id: ids.workspace,
    run_id: ids.run,
    conversation_ref: conversationRef(),
    idempotency_key: "effective-config:mandatory-overrides",
    defaults_ref: defaultsRef(),
    overrides: {
      model: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.model, expected_revision: 2 }],
      },
      datasource: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.datasource, expected_revision: 3 }],
      },
      files: { mode: "EXPLICIT_NONE" },
      knowledge: { mode: "INHERIT_DEFAULT" },
      mcp_servers: { mode: "EXPLICIT_NONE" },
      skills: { mode: "EXPLICIT_NONE" },
      egress: null,
    },
    mentions: [],
  });
  if (request.operation !== "QUESTION_RUN") throw new Error("QUESTION fixture mismatch");
  return request;
}

async function controlledBootstrapRequest() {
  const request = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "SEMANTIC_BOOTSTRAP_JOB",
    workspace_id: ids.workspace,
    job_id: ids.job,
    trigger_question_run_id: ids.run,
    idempotency_key: "effective-config:bootstrap-controlled",
    defaults_ref: defaultsRef(),
    overrides: {
      model: { mode: "EXPLICIT_NONE" },
      datasource: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.datasource, expected_revision: 3 }],
      },
      files: {
        mode: "RESOURCE_IDS",
        resources: [{ resource_id: ids.file, expected_revision: 2 }],
      },
      knowledge: { mode: "INHERIT_DEFAULT" },
      mcp_servers: { mode: "EXPLICIT_NONE" },
      skills: { mode: "EXPLICIT_NONE" },
      egress: null,
    },
    mentions: [
      {
        mention_id: ids.mention,
        resource_kind: "KNOWLEDGE",
        resource_id: ids.knowledge,
        expected_revision: 3,
      },
    ],
  });
  if (request.operation !== "SEMANTIC_BOOTSTRAP_JOB") {
    throw new Error("Bootstrap fixture mismatch");
  }
  return request;
}

function unavailableOptionalBinding(input: {
  resource_kind: "FILE" | "KNOWLEDGE" | "MCP_SERVER" | "SKILL";
  resource_id: string;
  resource_revision: number;
  source: "OVERRIDE" | "MENTION";
  mention_id?: string;
}) {
  return {
    resource_kind: input.resource_kind,
    mention_id: input.mention_id ?? null,
    requested_resource_id: input.resource_id,
    requested_revision: input.resource_revision,
    effective_resource: null,
    source: input.source,
    availability: "UNAVAILABLE" as const,
    unavailable_reason: "RESOURCE_NOT_FOUND_OR_FORBIDDEN" as const,
  };
}

function canonicalBindings<
  T extends {
    resource_kind: string;
    requested_resource_id: string | null;
    effective_resource: { resource_id: string } | null;
  },
>(bindings: T[]) {
  return bindings.toSorted((left, right) => {
    const leftId = left.effective_resource?.resource_id ?? left.requested_resource_id ?? "NONE";
    const rightId = right.effective_resource?.resource_id ?? right.requested_resource_id ?? "NONE";
    const leftKey = `${left.resource_kind}:${leftId}`;
    const rightKey = `${right.resource_kind}:${rightId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

async function bootstrapRequest() {
  const request = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "SEMANTIC_BOOTSTRAP_JOB",
    workspace_id: ids.workspace,
    job_id: ids.job,
    trigger_question_run_id: ids.run,
    idempotency_key: "effective-config:bootstrap",
    defaults_ref: defaultsRef(),
    overrides: {
      model: { mode: "EXPLICIT_NONE" },
      datasource: { mode: "INHERIT_DEFAULT" },
      files: { mode: "EXPLICIT_NONE" },
      knowledge: { mode: "INHERIT_DEFAULT" },
      mcp_servers: { mode: "EXPLICIT_NONE" },
      skills: { mode: "EXPLICIT_NONE" },
      egress: null,
    },
    mentions: [],
  });
  if (request.operation !== "SEMANTIC_BOOTSTRAP_JOB") {
    throw new Error("Bootstrap fixture mismatch");
  }
  return request;
}

const command = {
  run_id: ids.run,
  command_id: ids.command,
  event_id: ids.event,
  outbox_id: ids.outbox,
  audit_id: ids.audit,
  idempotency_key: "effective-config:test",
  question: "本月收入是多少？",
} as const;

function workerLease(config_ref: {
  config_id: string;
  config_revision: number;
  config_hash: string;
}) {
  return {
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" as const },
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH" as const,
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: ids.consumer,
    lease_token: 7,
    worker_fence: 2,
    expires_at: "2026-08-16T10:05:00.000Z",
    payload: { kind: "START_L2_RESEARCH" as const, effective_config_ref: config_ref },
  };
}

function optionalSelectionEvaluations(request: RunConfigRequest) {
  return (
    [
      ["files", "FILE"],
      ["knowledge", "KNOWLEDGE"],
      ["mcp_servers", "MCP_SERVER"],
      ["skills", "SKILL"],
    ] as const
  ).map(([field, resource_kind]) => {
    const selection = request.overrides[field];
    return {
      resource_kind,
      selection_mode: selection.mode,
      binding_count: selection.mode === "RESOURCE_IDS" ? selection.resources.length : 0,
      defaults_ref: selection.mode === "INHERIT_DEFAULT" ? request.defaults_ref : null,
    };
  });
}

function resolutionBase(request: RunConfigRequest) {
  return {
    schema_version: "run-config-resolution-receipt@1.0.0" as const,
    resolution_id: ids.event,
    scope: scope(),
    request_hash: request.request_hash,
    defaults_ref: defaultsRef(),
    authority_binding: authorityBinding(),
    resource_bindings: availableMandatoryBindings(),
    optional_selection_evaluations: optionalSelectionEvaluations(request),
    resolved_at: "2026-08-16T10:00:00.000Z",
  };
}

async function effectiveReceipt() {
  return buildEffectiveRunConfigReceiptCandidate({
    schema_version: "effective-run-config-receipt@1.0.0",
    config_id: ids.config,
    config_revision: 1,
    scope: scope(),
    run_id: ids.run,
    operation: "QUESTION_RUN",
    conversation_binding: {
      conversation_id: conversationRef().conversation_id,
      resource_version: conversationRef().expected_resource_version,
    },
    request_hash: H1,
    defaults_ref: defaultsRef(),
    authority_binding: authorityBinding(),
    model: {
      ...resource(ids.model, 2, H2),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      profile_version: "profile@2",
    },
    datasource: resource(ids.datasource, 3, H3),
    semantic_release: {
      ...resource(ids.semantic, 4, H4),
      datasource_id: ids.datasource,
      semantic_generation: 7,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      ...resource(ids.snapshot, 5, H5),
      datasource_id: ids.datasource,
      semantic_release_id: ids.semantic,
      semantic_generation: 7,
    },
    context_policy: {
      ...resource(ids.context, 6, H6),
      max_context_tokens: 32_000,
      max_resource_bindings: 64,
    },
    egress_policy: {
      ...resource(ids.egress, 7, H1),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE", "WORKSPACE"],
      classification: "INTERNAL",
    },
    execution_safety_policy: {
      ...resource(ids.safety, 8, H2),
      max_tool_calls: 32,
      max_provider_calls: 8,
      max_elapsed_ms: 300_000,
    },
    resource_bindings: availableMandatoryBindings(),
    optional_selection_evaluations: [
      {
        resource_kind: "FILE",
        selection_mode: "EXPLICIT_NONE",
        binding_count: 0,
        defaults_ref: null,
      },
      {
        resource_kind: "KNOWLEDGE",
        selection_mode: "INHERIT_DEFAULT",
        binding_count: 0,
        defaults_ref: defaultsRef(),
      },
      {
        resource_kind: "MCP_SERVER",
        selection_mode: "EXPLICIT_NONE",
        binding_count: 0,
        defaults_ref: null,
      },
      {
        resource_kind: "SKILL",
        selection_mode: "EXPLICIT_NONE",
        binding_count: 0,
        defaults_ref: null,
      },
    ],
    effective_egress: {
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "RESTRICTED",
    },
  });
}

async function acceptedEffectiveReceipt(
  request: Extract<RunConfigRequest, { operation: "QUESTION_RUN" }>,
  evaluations = optionalSelectionEvaluations(request),
) {
  const { config_hash: _configHash, ...draft } = await effectiveReceipt();
  return buildEffectiveRunConfigReceiptCandidate({
    ...draft,
    config_id: ids.command,
    run_id: request.run_id,
    conversation_binding: {
      conversation_id: request.conversation_ref.conversation_id,
      resource_version: request.conversation_ref.expected_resource_version,
    },
    request_hash: request.request_hash,
    defaults_ref: request.defaults_ref,
    optional_selection_evaluations: evaluations,
  });
}

function questionAcceptanceValue(resolution: unknown, effective_config: unknown = null) {
  return { resolution, effective_config };
}

describe("PostgreSQL effective config resolver", () => {
  it("rejects caller payload/event/hash fields before the atomic QUESTION RPC", async () => {
    const authority = access();
    const request = await questionRequest();
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, {
      request,
      command: { ...command, payload_hash: H1 },
    } as never);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_REQUEST_INVALID", retryable: false },
    });
    expect(scripted.connectCount).toBe(0);
  });

  it("rejects a stale request hash before opening a database transaction", async () => {
    const authority = access();
    const request = { ...(await questionRequest()), request_hash: H6 };
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_REQUEST_HASH_MISMATCH", retryable: false },
    });
    expect(scripted.connectCount).toBe(0);
  });

  it("delegates QUESTION READY resolution and Run acceptance to one narrow RPC", async () => {
    const authority = access();
    const request = await questionRequest();
    const effectiveConfig = await acceptedEffectiveReceipt(request);
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: request.conversation_ref,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: {
        config_id: effectiveConfig.config_id,
        config_revision: effectiveConfig.config_revision,
        config_hash: effectiveConfig.config_hash,
      },
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? {
            rows: [{ value: questionAcceptanceValue(resolution, effectiveConfig) }],
            rowCount: 1,
          }
        : undefined,
    );
    const uppercaseCommand = {
      ...command,
      command_id: command.command_id.toUpperCase(),
      run_id: command.run_id.toUpperCase(),
      event_id: command.event_id.toUpperCase(),
      outbox_id: command.outbox_id.toUpperCase(),
      audit_id: command.audit_id.toUpperCase(),
    };

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command: uppercaseCommand });

    expect(result).toEqual({ ok: true, value: resolution });
    const calls = scripted.calls.filter((call) =>
      call.text.includes("accept_question_run_with_effective_config"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([command, request]);
  });

  it("rejects internally valid but different Resolution and Effective optional evaluations", async () => {
    const authority = access();
    const request = await questionRequest();
    const mismatchedEvaluations = optionalSelectionEvaluations(request).map((evaluation) =>
      evaluation.resource_kind === "KNOWLEDGE"
        ? { ...evaluation, selection_mode: "EXPLICIT_NONE" as const, defaults_ref: null }
        : evaluation,
    );
    const effectiveConfig = await acceptedEffectiveReceipt(request, mismatchedEvaluations);
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: request.conversation_ref,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: {
        config_id: effectiveConfig.config_id,
        config_revision: effectiveConfig.config_revision,
        config_hash: effectiveConfig.config_hash,
      },
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? {
            rows: [{ value: questionAcceptanceValue(resolution, effectiveConfig) }],
            rowCount: 1,
          }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it.each(["OMITTED", "REPLACED", "EXTRA"] as const)(
    "rejects %s controlled optional bindings in a QUESTION Resolution",
    async (variant) => {
      const authority = access();
      const request = await controlledOptionalQuestionRequest();
      const fileBinding = unavailableOptionalBinding({
        resource_kind: "FILE",
        resource_id: variant === "REPLACED" ? ids.otherSource : ids.file,
        resource_revision: 2,
        source: "OVERRIDE",
      });
      const knowledgeBinding = unavailableOptionalBinding({
        resource_kind: "KNOWLEDGE",
        resource_id: ids.knowledge,
        resource_revision: 3,
        source: "MENTION",
        mention_id: ids.mention,
      });
      const optionalBindings =
        variant === "OMITTED"
          ? [fileBinding]
          : variant === "EXTRA"
            ? [
                fileBinding,
                knowledgeBinding,
                unavailableOptionalBinding({
                  resource_kind: "MCP_SERVER",
                  resource_id: ids.otherSource,
                  resource_revision: 1,
                  source: "OVERRIDE",
                }),
              ]
            : [fileBinding, knowledgeBinding];
      const resolution = await buildRunConfigResolutionReceiptCandidate({
        ...resolutionBase(request),
        resource_bindings: canonicalBindings([
          ...availableMandatoryBindings(),
          ...optionalBindings,
        ]),
        optional_selection_evaluations:
          variant === "EXTRA"
            ? optionalSelectionEvaluations(request).map((evaluation) =>
                evaluation.resource_kind === "MCP_SERVER"
                  ? {
                      ...evaluation,
                      selection_mode: "RESOURCE_IDS" as const,
                      binding_count: 1,
                      defaults_ref: null,
                    }
                  : evaluation,
              )
            : optionalSelectionEvaluations(request),
        operation: "QUESTION_RUN",
        run_id: ids.run,
        conversation_ref: request.conversation_ref,
        admission: "READY",
        unavailable_reasons: [],
        effective_config_ref: { config_id: ids.command, config_revision: 1, config_hash: H5 },
        required_action: null,
        bootstrap_job_config: null,
      });
      const scripted = scriptedPool((text) =>
        text.includes("accept_question_run_with_effective_config")
          ? { rows: [{ value: questionAcceptanceValue(resolution) }], rowCount: 1 }
          : undefined,
      );

      const result = await createPostgresEffectiveConfigResolver({
        pool: scripted.pool,
        authorizer: authority.authorizer,
      }).resolveAndAccept(authority.capability, {
        request,
        command: { ...command, idempotency_key: request.idempotency_key },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
      });
    },
  );

  it("rejects a DEFAULT optional binding hidden behind EXPLICIT_NONE in Bootstrap BLOCKED", async () => {
    const authority = access("OWNER");
    const request = await bootstrapRequest();
    const bindings = canonicalBindings([
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 3,
        effective_resource: resource(ids.datasource, 3, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "FILE" as const,
        mention_id: null,
        requested_resource_id: ids.file,
        requested_revision: 2,
        effective_resource: resource(ids.file, 2, H4),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: null,
        source: "ACTIVE_POINTER" as const,
        availability: "UNAVAILABLE" as const,
        unavailable_reason: "SCHEMA_SNAPSHOT_STALE" as const,
      },
    ]);
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      optional_selection_evaluations: optionalSelectionEvaluations(request).map((evaluation) =>
        evaluation.resource_kind === "FILE"
          ? {
              ...evaluation,
              selection_mode: "INHERIT_DEFAULT" as const,
              binding_count: 1,
              defaults_ref: request.defaults_ref,
            }
          : evaluation,
      ),
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      resource_bindings: bindings,
      admission: "BLOCKED",
      unavailable_reasons: ["SCHEMA_SNAPSHOT_STALE"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("resolve_semantic_bootstrap_job_config")
        ? { rows: [{ value: resolution }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("rejects a DEFAULT optional binding added beside an exact RESOURCE_IDS override", async () => {
    const authority = access();
    const request = await controlledOptionalQuestionRequest();
    const optionalBindings = [
      {
        resource_kind: "FILE" as const,
        mention_id: null,
        requested_resource_id: ids.file,
        requested_revision: 2,
        effective_resource: resource(ids.file, 2, H4),
        source: "OVERRIDE" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "FILE" as const,
        mention_id: null,
        requested_resource_id: ids.otherSource,
        requested_revision: 1,
        effective_resource: resource(ids.otherSource, 1, H5),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "KNOWLEDGE" as const,
        mention_id: ids.mention,
        requested_resource_id: ids.knowledge,
        requested_revision: 3,
        effective_resource: resource(ids.knowledge, 3, H6),
        source: "MENTION" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
    ];
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      resource_bindings: canonicalBindings([
        ...availableMandatoryBindings(),
        ...optionalBindings.filter((_binding, index) => index !== 1),
      ]),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: request.conversation_ref,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: { config_id: ids.command, config_revision: 1, config_hash: H5 },
      required_action: null,
      bootstrap_job_config: null,
    });
    const returned = {
      ...resolution,
      resource_bindings: canonicalBindings([...availableMandatoryBindings(), ...optionalBindings]),
    };
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? { rows: [{ value: questionAcceptanceValue(returned) }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, {
      request,
      command: { ...command, idempotency_key: request.idempotency_key },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it.each(["OMITTED", "TAMPERED_COUNT"] as const)(
    "rejects a %s INHERIT_DEFAULT evaluation",
    async (variant) => {
      const authority = access();
      const request = await questionRequest();
      const resolution = await buildRunConfigResolutionReceiptCandidate({
        ...resolutionBase(request),
        operation: "QUESTION_RUN",
        run_id: ids.run,
        conversation_ref: request.conversation_ref,
        admission: "READY",
        unavailable_reasons: [],
        effective_config_ref: { config_id: ids.command, config_revision: 1, config_hash: H5 },
        required_action: null,
        bootstrap_job_config: null,
      });
      const returned = {
        ...resolution,
        optional_selection_evaluations:
          variant === "OMITTED"
            ? resolution.optional_selection_evaluations.filter(
                (evaluation) => evaluation.resource_kind !== "KNOWLEDGE",
              )
            : resolution.optional_selection_evaluations.map((evaluation) =>
                evaluation.resource_kind === "KNOWLEDGE"
                  ? { ...evaluation, binding_count: 1 }
                  : evaluation,
              ),
      };
      const scripted = scriptedPool((text) =>
        text.includes("accept_question_run_with_effective_config")
          ? { rows: [{ value: questionAcceptanceValue(returned) }], rowCount: 1 }
          : undefined,
      );

      const result = await createPostgresEffectiveConfigResolver({
        pool: scripted.pool,
        authorizer: authority.authorizer,
      }).resolveAndAccept(authority.capability, { request, command });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
      });
    },
  );

  it("rejects an INHERIT_DEFAULT evaluation resolved from the wrong binding source", async () => {
    const authority = access();
    const request = await questionRequest();
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: request.conversation_ref,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: { config_id: ids.command, config_revision: 1, config_hash: H5 },
      required_action: null,
      bootstrap_job_config: null,
    });
    const returned = {
      ...resolution,
      resource_bindings: canonicalBindings([
        ...availableMandatoryBindings(),
        {
          resource_kind: "KNOWLEDGE",
          mention_id: null,
          requested_resource_id: ids.knowledge,
          requested_revision: 3,
          effective_resource: resource(ids.knowledge, 3, H6),
          source: "OVERRIDE",
          availability: "AVAILABLE",
          unavailable_reason: null,
        },
      ]),
      optional_selection_evaluations: resolution.optional_selection_evaluations.map((evaluation) =>
        evaluation.resource_kind === "KNOWLEDGE" ? { ...evaluation, binding_count: 1 } : evaluation,
      ),
    };
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? { rows: [{ value: questionAcceptanceValue(returned) }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it.each([
    ["BLOCKED", ["RESOURCE_NOT_FOUND_OR_FORBIDDEN"], null],
    ["BOOTSTRAP_REQUIRED", ["SEMANTIC_RELEASE_NOT_PUBLISHED"], "SEMANTIC_BOOTSTRAP"],
  ] as const)(
    "preserves QUESTION %s without manufacturing a config ref",
    async (admission, reasons, action) => {
      const authority = access();
      const request = await questionRequest();
      const resolution = await buildRunConfigResolutionReceiptCandidate({
        ...resolutionBase(request),
        resource_bindings:
          admission === "BLOCKED"
            ? unavailableMandatoryBindings("DATASOURCE", "RESOURCE_NOT_FOUND_OR_FORBIDDEN")
            : unavailableMandatoryBindings("SEMANTIC_RELEASE", "SEMANTIC_RELEASE_NOT_PUBLISHED"),
        operation: "QUESTION_RUN",
        run_id: ids.run,
        conversation_ref: request.conversation_ref,
        admission,
        unavailable_reasons: reasons,
        effective_config_ref: null,
        required_action: action,
        bootstrap_job_config: null,
      });
      const scripted = scriptedPool((text) =>
        text.includes("accept_question_run_with_effective_config")
          ? { rows: [{ value: questionAcceptanceValue(resolution) }], rowCount: 1 }
          : undefined,
      );

      const result = await createPostgresEffectiveConfigResolver({
        pool: scripted.pool,
        authorizer: authority.authorizer,
      }).resolveAndAccept(authority.capability, { request, command });

      expect(result).toEqual({ ok: true, value: resolution });
      expect(
        scripted.calls.filter((call) =>
          call.text.includes("accept_question_run_with_effective_config"),
        ),
      ).toHaveLength(1);
    },
  );

  it("accepts BLOCKED when missing Semantic Release and controlled optional resources are both real blockers", async () => {
    const authority = access();
    const request = await controlledOptionalQuestionRequest();
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      resource_bindings: canonicalBindings([
        ...unavailableMandatoryBindings("SEMANTIC_RELEASE", "SEMANTIC_RELEASE_NOT_PUBLISHED"),
        unavailableOptionalBinding({
          resource_kind: "FILE",
          resource_id: ids.file,
          resource_revision: 2,
          source: "OVERRIDE",
        }),
        unavailableOptionalBinding({
          resource_kind: "KNOWLEDGE",
          resource_id: ids.knowledge,
          resource_revision: 3,
          source: "MENTION",
          mention_id: ids.mention,
        }),
      ]),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: request.conversation_ref,
      admission: "BLOCKED",
      unavailable_reasons: ["RESOURCE_NOT_FOUND_OR_FORBIDDEN", "SEMANTIC_RELEASE_NOT_PUBLISHED"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? { rows: [{ value: questionAcceptanceValue(resolution) }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, {
      request,
      command: { ...command, idempotency_key: request.idempotency_key },
    });

    expect(result).toEqual({ ok: true, value: resolution });
  });

  it("parses an explicit Bootstrap READY branch without an EffectiveConfigRef", async () => {
    const authority = access("OWNER");
    const request = await bootstrapRequest();
    const bindings = [
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 3,
        effective_resource: resource(ids.datasource, 3, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 5, H5),
        source: "ACTIVE_POINTER" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
    ];
    const bootstrapConfig = {
      schema_version: "semantic-bootstrap-job-config@1.0.0" as const,
      scope: scope(),
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      operation: "SEMANTIC_BOOTSTRAP_JOB" as const,
      request_hash: request.request_hash,
      defaults_ref: defaultsRef(),
      authority_binding: authorityBinding(),
      datasource: resource(ids.datasource, 3, H3),
      semantic_release: null,
      schema_snapshot: { ...resource(ids.snapshot, 5, H5), datasource_id: ids.datasource },
      source_resources: [],
      resource_bindings: bindings,
    };
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      resource_bindings: bindings,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: bootstrapConfig,
    });
    const scripted = scriptedPool((text) =>
      text.includes("resolve_semantic_bootstrap_job_config")
        ? { rows: [{ value: resolution }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request });

    expect(result).toEqual({ ok: true, value: resolution });
    expect(result.ok && result.value.effective_config_ref).toBeNull();
    const calls = scripted.calls.filter((call) =>
      call.text.includes("resolve_semantic_bootstrap_job_config"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([request]);
    expect(
      scripted.calls.some((call) =>
        call.text.includes("accept_question_run_with_effective_config"),
      ),
    ).toBe(false);
  });

  it("rejects Bootstrap source authority that does not exactly match explicit overrides and mentions", async () => {
    const authority = access("OWNER");
    const request = await buildRunConfigRequestCandidate({
      schema_version: "run-config-request@1.0.0",
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      workspace_id: ids.workspace,
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      idempotency_key: "effective-config:bootstrap-sources",
      defaults_ref: defaultsRef(),
      overrides: {
        model: { mode: "EXPLICIT_NONE" },
        datasource: { mode: "INHERIT_DEFAULT" },
        files: {
          mode: "RESOURCE_IDS",
          resources: [{ resource_id: ids.file, expected_revision: 2 }],
        },
        knowledge: { mode: "INHERIT_DEFAULT" },
        mcp_servers: { mode: "EXPLICIT_NONE" },
        skills: { mode: "EXPLICIT_NONE" },
        egress: null,
      },
      mentions: [
        {
          mention_id: ids.mention,
          resource_kind: "KNOWLEDGE",
          resource_id: ids.knowledge,
          expected_revision: 3,
        },
      ],
    });
    if (request.operation !== "SEMANTIC_BOOTSTRAP_JOB") {
      throw new TypeError("Bootstrap source fixture mismatch");
    }
    const bindings = [
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 3,
        effective_resource: resource(ids.datasource, 3, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "FILE" as const,
        mention_id: null,
        requested_resource_id: ids.otherSource,
        requested_revision: 2,
        effective_resource: resource(ids.otherSource, 2, H4),
        source: "OVERRIDE" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "KNOWLEDGE" as const,
        mention_id: ids.mention,
        requested_resource_id: ids.otherSource,
        requested_revision: 3,
        effective_resource: resource(ids.otherSource, 3, H6),
        source: "MENTION" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 5, H5),
        source: "ACTIVE_POINTER" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
    ];
    const bootstrapConfig = {
      schema_version: "semantic-bootstrap-job-config@1.0.0" as const,
      scope: scope(),
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      operation: "SEMANTIC_BOOTSTRAP_JOB" as const,
      request_hash: request.request_hash,
      defaults_ref: defaultsRef(),
      authority_binding: authorityBinding(),
      datasource: resource(ids.datasource, 3, H3),
      semantic_release: null,
      schema_snapshot: { ...resource(ids.snapshot, 5, H5), datasource_id: ids.datasource },
      source_resources: [
        {
          resource_kind: "FILE" as const,
          mention_id: null,
          resource_id: ids.otherSource,
          resource_revision: 2,
          resource_hash: H4,
        },
        {
          resource_kind: "KNOWLEDGE" as const,
          mention_id: ids.mention,
          resource_id: ids.otherSource,
          resource_revision: 3,
          resource_hash: H6,
        },
      ],
      resource_bindings: bindings,
    };
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      resource_bindings: bindings,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: bootstrapConfig,
    });
    const scripted = scriptedPool((text) =>
      text.includes("resolve_semantic_bootstrap_job_config")
        ? { rows: [{ value: resolution }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("preserves an explicit Bootstrap BLOCKED branch without accepting a QUESTION Run", async () => {
    const authority = access("OWNER");
    const request = await bootstrapRequest();
    const bindings = [
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 3,
        effective_resource: resource(ids.datasource, 3, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: null,
        source: "ACTIVE_POINTER" as const,
        availability: "UNAVAILABLE" as const,
        unavailable_reason: "SCHEMA_SNAPSHOT_STALE" as const,
      },
    ];
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      resource_bindings: bindings,
      admission: "BLOCKED",
      unavailable_reasons: ["SCHEMA_SNAPSHOT_STALE"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("resolve_semantic_bootstrap_job_config")
        ? { rows: [{ value: resolution }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request });

    expect(result).toEqual({ ok: true, value: resolution });
    expect(
      scripted.calls.some((call) =>
        call.text.includes("accept_question_run_with_effective_config"),
      ),
    ).toBe(false);
  });

  it.each(["OMITTED", "EXTRA", "TAMPERED_MENTION"] as const)(
    "rejects %s controlled bindings in a Bootstrap BLOCKED resolution",
    async (variant) => {
      const authority = access("OWNER");
      const request = await controlledBootstrapRequest();
      const fileBinding = unavailableOptionalBinding({
        resource_kind: "FILE",
        resource_id: ids.file,
        resource_revision: 2,
        source: "OVERRIDE",
      });
      const knowledgeBinding = unavailableOptionalBinding({
        resource_kind: "KNOWLEDGE",
        resource_id: ids.knowledge,
        resource_revision: 3,
        source: "MENTION",
        mention_id: variant === "TAMPERED_MENTION" ? ids.otherSource : ids.mention,
      });
      const controlledBindings =
        variant === "OMITTED"
          ? [fileBinding]
          : variant === "EXTRA"
            ? [
                fileBinding,
                knowledgeBinding,
                unavailableOptionalBinding({
                  resource_kind: "FILE",
                  resource_id: ids.otherSource,
                  resource_revision: 1,
                  source: "OVERRIDE",
                }),
              ]
            : [fileBinding, knowledgeBinding];
      const bindings = canonicalBindings([
        {
          resource_kind: "DATASOURCE" as const,
          mention_id: null,
          requested_resource_id: ids.datasource,
          requested_revision: 3,
          effective_resource: resource(ids.datasource, 3, H3),
          source: "OVERRIDE" as const,
          availability: "AVAILABLE" as const,
          unavailable_reason: null,
        },
        {
          resource_kind: "SCHEMA_SNAPSHOT" as const,
          mention_id: null,
          requested_resource_id: null,
          requested_revision: null,
          effective_resource: resource(ids.snapshot, 5, H5),
          source: "ACTIVE_POINTER" as const,
          availability: "AVAILABLE" as const,
          unavailable_reason: null,
        },
        ...controlledBindings,
      ]);
      const resolution = await buildRunConfigResolutionReceiptCandidate({
        ...resolutionBase(request),
        optional_selection_evaluations:
          variant === "EXTRA"
            ? optionalSelectionEvaluations(request).map((evaluation) =>
                evaluation.resource_kind === "FILE"
                  ? { ...evaluation, binding_count: 2 }
                  : evaluation,
              )
            : optionalSelectionEvaluations(request),
        operation: "SEMANTIC_BOOTSTRAP_JOB",
        job_id: ids.job,
        trigger_question_run_id: ids.run,
        resource_bindings: bindings,
        admission: "BLOCKED",
        unavailable_reasons: ["RESOURCE_NOT_FOUND_OR_FORBIDDEN"],
        effective_config_ref: null,
        required_action: null,
        bootstrap_job_config: null,
      });
      const scripted = scriptedPool((text) =>
        text.includes("resolve_semantic_bootstrap_job_config")
          ? { rows: [{ value: resolution }], rowCount: 1 }
          : undefined,
      );

      const result = await createPostgresEffectiveConfigResolver({
        pool: scripted.pool,
        authorizer: authority.authorizer,
      }).resolveAndAccept(authority.capability, { request });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
      });
    },
  );

  it.each(["QUESTION_READY", "QUESTION_BLOCKED", "BOOTSTRAP_BLOCKED"] as const)(
    "rejects a replacement mandatory singleton in %s",
    async (variant) => {
      const authority = access("OWNER");
      const request =
        variant === "BOOTSTRAP_BLOCKED"
          ? await controlledBootstrapRequest()
          : await mandatoryOverrideQuestionRequest();
      const isQuestion = request.operation === "QUESTION_RUN";
      const replacementKind = variant === "QUESTION_READY" ? "MODEL_PROFILE" : "DATASOURCE";
      const replacementBinding = {
        resource_kind: replacementKind,
        mention_id: null,
        requested_resource_id: ids.otherSource,
        requested_revision: replacementKind === "MODEL_PROFILE" ? 2 : 3,
        effective_resource: variant === "QUESTION_READY" ? resource(ids.otherSource, 2, H4) : null,
        source: "OVERRIDE" as const,
        availability:
          variant === "QUESTION_READY" ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
        unavailable_reason:
          variant === "QUESTION_READY" ? null : ("RESOURCE_NOT_FOUND_OR_FORBIDDEN" as const),
      };
      const bindings =
        variant === "QUESTION_READY"
          ? canonicalBindings(
              availableMandatoryBindings().map((binding) =>
                binding.resource_kind === "MODEL_PROFILE"
                  ? replacementBinding
                  : binding.resource_kind === "DATASOURCE"
                    ? { ...binding, source: "OVERRIDE" as const }
                    : binding,
              ),
            )
          : variant === "BOOTSTRAP_BLOCKED"
            ? canonicalBindings([
                replacementBinding,
                unavailableOptionalBinding({
                  resource_kind: "FILE",
                  resource_id: ids.file,
                  resource_revision: 2,
                  source: "OVERRIDE",
                }),
                unavailableOptionalBinding({
                  resource_kind: "KNOWLEDGE",
                  resource_id: ids.knowledge,
                  resource_revision: 3,
                  source: "MENTION",
                  mention_id: ids.mention,
                }),
              ])
            : [replacementBinding];
      const resolution = await buildRunConfigResolutionReceiptCandidate({
        ...resolutionBase(request),
        operation: request.operation,
        ...(isQuestion
          ? { run_id: ids.run, conversation_ref: conversationRef() }
          : { job_id: ids.job, trigger_question_run_id: ids.run }),
        resource_bindings: bindings,
        admission: variant === "QUESTION_READY" ? "READY" : "BLOCKED",
        unavailable_reasons:
          variant === "QUESTION_READY" ? [] : ["RESOURCE_NOT_FOUND_OR_FORBIDDEN"],
        effective_config_ref:
          variant === "QUESTION_READY"
            ? { config_id: ids.command, config_revision: 1, config_hash: H5 }
            : null,
        required_action: null,
        bootstrap_job_config: null,
      });
      const scripted = scriptedPool((text) =>
        text.includes(
          isQuestion
            ? "accept_question_run_with_effective_config"
            : "resolve_semantic_bootstrap_job_config",
        )
          ? {
              rows: [{ value: isQuestion ? questionAcceptanceValue(resolution) : resolution }],
              rowCount: 1,
            }
          : undefined,
      );

      const result = await createPostgresEffectiveConfigResolver({
        pool: scripted.pool,
        authorizer: authority.authorizer,
      }).resolveAndAccept(
        authority.capability,
        isQuestion
          ? { request, command: { ...command, idempotency_key: request.idempotency_key } }
          : { request },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
      });
    },
  );

  it("denies Semantic Bootstrap to ANALYST before invoking its RPC", async () => {
    const authority = access("ANALYST");
    const request = await bootstrapRequest();
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request });

    expect(result.ok).toBe(false);
    expect(
      scripted.calls.some((call) => call.text.includes("resolve_semantic_bootstrap_job_config")),
    ).toBe(false);
  });

  it("does not manufacture a Resolution when PostgreSQL Authority is unavailable", async () => {
    const authority = access();
    const request = await questionRequest();
    const pool: SqlPool = {
      async connect() {
        throw new Error("database unavailable");
      },
    };
    const result = await createPostgresEffectiveConfigResolver({
      pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_UNAVAILABLE", retryable: true },
    });
  });

  it("rejects a tampered or request-mismatched Resolution Receipt", async () => {
    const authority = access();
    const request = await questionRequest();
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      resource_bindings: unavailableMandatoryBindings("MODEL_PROFILE", "RESOURCE_DISABLED"),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: request.conversation_ref,
      admission: "BLOCKED",
      unavailable_reasons: ["RESOURCE_DISABLED"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? {
            rows: [
              {
                value: questionAcceptanceValue({ ...resolution, request_hash: H6 }),
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("rejects a validly hashed Resolution for a different Conversation Authority", async () => {
    const authority = access();
    const request = await questionRequest();
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase(request),
      operation: "QUESTION_RUN",
      run_id: ids.run,
      conversation_ref: {
        conversation_id: ids.otherSource,
        expected_resource_version: request.conversation_ref.expected_resource_version,
      },
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: { config_id: ids.command, config_revision: 1, config_hash: H5 },
      required_action: null,
      bootstrap_job_config: null,
    });
    const scripted = scriptedPool((text) =>
      text.includes("accept_question_run_with_effective_config")
        ? { rows: [{ value: questionAcceptanceValue(resolution) }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it.each([
    ["EFFECTIVE_CONFIG_REQUEST_SCOPE_MISMATCH", false],
    ["EFFECTIVE_CONFIG_RESOLUTION_INVALID", false],
    ["EFFECTIVE_CONFIG_RESOURCE_DUPLICATE", false],
    ["EFFECTIVE_CONFIG_RESOURCE_REFERENCE_CONFLICT", false],
    ["EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT", false],
    ["EFFECTIVE_CONFIG_RECEIPT_REVOKED", false],
    ["CONVERSATION_NOT_FOUND_OR_DENIED", false],
    ["CONVERSATION_RESOURCE_VERSION_CONFLICT", true],
    ["CONVERSATION_RESOURCE_MISMATCH", false],
    ["EFFECTIVE_CONFIG_WORKER_FENCE_STALE", true],
    ["EFFECTIVE_CONFIG_WORKER_LEASE_STALE", true],
  ] as const)("maps %s to a stable public failure", async (marker, retryable) => {
    const authority = access();
    const request = await questionRequest();
    const scripted = scriptedPool((text) => {
      if (text.includes("accept_question_run_with_effective_config")) {
        throw Object.assign(new Error(marker), {
          code: marker.includes("FENCE") ? "40001" : "23505",
        });
      }
      return undefined;
    });

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).resolveAndAccept(authority.capability, { request, command });
    expect(result).toMatchObject({ ok: false, error: { code: marker, retryable } });
  });

  it("lets a VIEWER read the exact current Workspace Defaults revision", async () => {
    const authority = access("VIEWER");
    const revision = await buildWorkspaceDefaultsRevisionCandidate({
      schema_version: "workspace-defaults-revision@1.0.0",
      scope: {
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        workspace_id: ids.workspace,
      },
      defaults_id: ids.defaults,
      defaults_revision: 1,
      parent_revision: null,
      parent_hash: null,
      defaults: defaultsValue(),
      created_by_principal_id: ids.principal,
      created_at: "2026-08-16T10:00:00.000Z",
    });
    const value = {
      revision,
      defaults_ref: {
        defaults_id: revision.defaults_id,
        defaults_revision: revision.defaults_revision,
        defaults_hash: revision.defaults_hash,
      },
    };
    const scripted = scriptedPool((text) =>
      text.includes("get_workspace_run_defaults") ? { rows: [{ value }], rowCount: 1 } : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).getWorkspaceDefaults(authority.capability);

    expect(result).toEqual({ ok: true, value });
    expect(
      scripted.calls.filter((call) => call.text.includes("get_workspace_run_defaults")),
    ).toHaveLength(1);
  });

  it("creates the first Workspace Defaults revision and verifies the CAS response", async () => {
    const authority = access("OWNER");
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.defaults,
      workspace_id: ids.workspace,
      expected_defaults_revision: 0,
      idempotency_key: "defaults:first",
      defaults: defaultsSelection(),
    });
    const revision = await buildWorkspaceDefaultsRevisionCandidate({
      schema_version: "workspace-defaults-revision@1.0.0",
      scope: {
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        workspace_id: ids.workspace,
      },
      defaults_id: ids.defaults,
      defaults_revision: 1,
      parent_revision: null,
      parent_hash: null,
      defaults: defaultsValue(),
      created_by_principal_id: ids.principal,
      created_at: "2026-08-16T10:00:00.000Z",
    });
    const value = {
      revision,
      defaults_ref: {
        defaults_id: revision.defaults_id,
        defaults_revision: revision.defaults_revision,
        defaults_hash: revision.defaults_hash,
      },
      request_hash: command.request_hash,
      committed_at: revision.created_at,
      replayed: false,
    };
    const scripted = scriptedPool((text) =>
      text.includes("update_workspace_run_defaults")
        ? { rows: [{ value }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).updateWorkspaceDefaults(authority.capability, command);

    expect(result).toEqual({ ok: true, value });
    const update = scripted.calls.find((call) =>
      call.text.includes("update_workspace_run_defaults"),
    );
    expect(update?.values).toEqual([command]);
  });

  it("accepts a CAS update and same-key/same-hash replay of its exact revision", async () => {
    const authority = access("OWNER");
    const parent = await buildWorkspaceDefaultsRevisionCandidate({
      schema_version: "workspace-defaults-revision@1.0.0",
      scope: {
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        workspace_id: ids.workspace,
      },
      defaults_id: ids.defaults,
      defaults_revision: 1,
      parent_revision: null,
      parent_hash: null,
      defaults: defaultsValue(),
      created_by_principal_id: ids.principal,
      created_at: "2026-08-16T10:00:00.000Z",
    });
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.audit,
      workspace_id: ids.workspace,
      expected_defaults_revision: 1,
      idempotency_key: "defaults:update:one",
      defaults: defaultsSelection(),
    });
    const revision = await buildWorkspaceDefaultsRevisionCandidate({
      schema_version: "workspace-defaults-revision@1.0.0",
      scope: parent.scope,
      defaults_id: ids.defaults,
      defaults_revision: 2,
      parent_revision: 1,
      parent_hash: parent.defaults_hash,
      defaults: defaultsValue(),
      created_by_principal_id: ids.principal,
      created_at: "2026-08-16T10:01:00.000Z",
    });
    const value = {
      revision,
      defaults_ref: {
        defaults_id: revision.defaults_id,
        defaults_revision: revision.defaults_revision,
        defaults_hash: revision.defaults_hash,
      },
      request_hash: command.request_hash,
      committed_at: revision.created_at,
      replayed: true,
    };
    const scripted = scriptedPool((text) =>
      text.includes("update_workspace_run_defaults")
        ? { rows: [{ value }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).updateWorkspaceDefaults(authority.capability, command);

    expect(result).toEqual({ ok: true, value });
  });

  it("rejects a server Defaults Revision that resolves a different resource than the intent", async () => {
    const authority = access("OWNER");
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.defaults,
      workspace_id: ids.workspace,
      expected_defaults_revision: 0,
      idempotency_key: "defaults:wrong-resolution",
      defaults: defaultsSelection(),
    });
    const revision = await buildWorkspaceDefaultsRevisionCandidate({
      schema_version: "workspace-defaults-revision@1.0.0",
      scope: {
        app_id: ids.app,
        tenant_id: ids.workspace,
        environment: "test",
        workspace_id: ids.workspace,
      },
      defaults_id: ids.defaults,
      defaults_revision: 1,
      parent_revision: null,
      parent_hash: null,
      defaults: {
        ...defaultsValue(),
        model: resource(ids.otherSource, 2, H3),
      },
      created_by_principal_id: ids.principal,
      created_at: "2026-08-16T10:00:00.000Z",
    });
    const value = {
      revision,
      defaults_ref: {
        defaults_id: revision.defaults_id,
        defaults_revision: revision.defaults_revision,
        defaults_hash: revision.defaults_hash,
      },
      request_hash: command.request_hash,
      committed_at: revision.created_at,
      replayed: false,
    };
    const scripted = scriptedPool((text) =>
      text.includes("update_workspace_run_defaults")
        ? { rows: [{ value }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).updateWorkspaceDefaults(authority.capability, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it.each([
    ["WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT", true],
    ["WORKSPACE_RUN_DEFAULTS_IDEMPOTENCY_CONFLICT", false],
    ["WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE", false],
    ["WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH", true],
    ["WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH", false],
  ] as const)("maps Defaults %s without manufacturing a revision", async (marker, retryable) => {
    const authority = access("OWNER");
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.defaults,
      workspace_id: ids.workspace,
      expected_defaults_revision: 0,
      idempotency_key: "defaults:conflict",
      defaults: defaultsSelection(),
    });
    const scripted = scriptedPool((text) => {
      if (text.includes("update_workspace_run_defaults")) throw new Error(marker);
      return undefined;
    });
    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).updateWorkspaceDefaults(authority.capability, command);
    expect(result).toMatchObject({ ok: false, error: { code: marker, retryable } });
  });

  it("rejects cross-workspace Defaults and non-OWNER updates", async () => {
    const otherWorkspace = "00000000-0000-4000-8000-000000000019";
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.defaults,
      workspace_id: otherWorkspace,
      expected_defaults_revision: 0,
      idempotency_key: "defaults:cross-workspace",
      defaults: defaultsSelection(),
    });
    for (const authority of [access("OWNER"), access("ANALYST")]) {
      const scripted = scriptedPool(() => undefined);
      const result = await createPostgresEffectiveConfigResolver({
        pool: scripted.pool,
        authorizer: authority.authorizer,
      }).updateWorkspaceDefaults(authority.capability, command);
      expect(result.ok).toBe(false);
      expect(
        scripted.calls.some((call) => call.text.includes("update_workspace_run_defaults")),
      ).toBe(false);
    }
  });

  it("reloads and verifies an exact-scope Effective Config Receipt", async () => {
    const authority = access();
    const receipt = await effectiveReceipt();
    const ref = {
      config_id: receipt.config_id,
      config_revision: receipt.config_revision,
      config_hash: receipt.config_hash,
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_effective_run_config")
        ? { rows: [{ value: receipt }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).getEffectiveConfig(authority.capability, {
      run_id: ids.run,
      config_ref: ref,
      conversation_ref: conversationRef(),
    });

    expect(result).toEqual({ ok: true, value: receipt });
    const load = scripted.calls.find((call) => call.text.includes("load_effective_run_config"));
    expect(load?.values).toEqual([ref.config_id, ref.config_revision, ref.config_hash, ids.run]);
  });

  it("rejects a tampered Effective Config Receipt returned by PostgreSQL", async () => {
    const authority = access();
    const receipt = await effectiveReceipt();
    const ref = {
      config_id: receipt.config_id,
      config_revision: receipt.config_revision,
      config_hash: receipt.config_hash,
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_effective_run_config")
        ? {
            rows: [
              {
                value: {
                  ...receipt,
                  optional_selection_evaluations: receipt.optional_selection_evaluations.map(
                    (evaluation) =>
                      evaluation.resource_kind === "KNOWLEDGE"
                        ? { ...evaluation, binding_count: 1 }
                        : evaluation,
                  ),
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).getEffectiveConfig(authority.capability, {
      run_id: ids.run,
      config_ref: ref,
      conversation_ref: conversationRef(),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("rejects a valid Effective Config Receipt loaded for another Conversation version", async () => {
    const authority = access();
    const receipt = await effectiveReceipt();
    const ref = {
      config_id: receipt.config_id,
      config_revision: receipt.config_revision,
      config_hash: receipt.config_hash,
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_effective_run_config")
        ? { rows: [{ value: receipt }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).getEffectiveConfig(authority.capability, {
      run_id: ids.run,
      config_ref: ref,
      conversation_ref: {
        ...conversationRef(),
        expected_resource_version: conversationRef().expected_resource_version + 1,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("does not let a human capability manufacture Worker lease authority", async () => {
    const authority = access("OWNER");
    const receipt = await effectiveReceipt();
    const ref = {
      config_id: receipt.config_id,
      config_revision: receipt.config_revision,
      config_hash: receipt.config_hash,
    };
    const lease = workerLease(ref);

    const rawPayloadPool = scriptedPool(() => undefined);
    const rawPayload = await createPostgresEffectiveConfigResolver({
      pool: rawPayloadPool.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease: {
        ...lease,
        payload: { ...lease.payload, datasource_id: ids.datasource },
      },
    } as never);
    expect(rawPayload.ok).toBe(false);
    expect(rawPayloadPool.connectCount).toBe(0);

    const wrongPrincipalPool = scriptedPool(() => undefined);
    const wrongPrincipal = await createPostgresEffectiveConfigResolver({
      pool: wrongPrincipalPool.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease: { ...lease, principal_id: ids.audit },
    });
    expect(wrongPrincipal.ok).toBe(false);
    expect(
      wrongPrincipalPool.calls.some((call) =>
        call.text.includes("consume_worker_effective_run_config"),
      ),
    ).toBe(false);

    const inactiveLeasePool = scriptedPool((text) => {
      if (text.includes("consume_worker_effective_run_config")) {
        throw new Error("EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID");
      }
      return undefined;
    });
    const inactiveLease = await createPostgresEffectiveConfigResolver({
      pool: inactiveLeasePool.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease,
    });
    expect(inactiveLease).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID", retryable: false },
    });
  });

  it("revalidates and consumes the exact config before Worker effects", async () => {
    const authority = access();
    const receipt = await effectiveReceipt();
    const ref = {
      config_id: receipt.config_id,
      config_revision: receipt.config_revision,
      config_hash: receipt.config_hash,
    };
    const lease = workerLease(ref);
    const contextReceipt = await buildContextReceiptBindingCandidate({
      schema_version: "effective-config-context-receipt@1.0.0",
      receipt_id: ids.receipt,
      outbox_id: lease.outbox_id,
      command_id: lease.command_id,
      consumer: "WORKER_START",
      consumer_id: lease.worker_id,
      attempt_id: lease.attempt_id,
      lease_token: lease.lease_token,
      worker_fence: lease.worker_fence,
      scope: scope(),
      run_id: ids.run,
      config_ref: ref,
      semantic_release: receipt.semantic_release,
      schema_snapshot: receipt.schema_snapshot,
      context_policy: resource(
        receipt.context_policy.resource_id,
        receipt.context_policy.resource_revision,
        receipt.context_policy.resource_hash,
      ),
      provider: receipt.model.provider,
      audiences: receipt.effective_egress.allowed_audiences,
      classification: receipt.effective_egress.classification,
      resource_refs: mandatoryResourceRefs(),
      consumed_at: "2026-08-16T10:01:00.000Z",
    });
    const workerResult = {
      schema_version: "effective-config-worker-consumption@1.0.0",
      replayed: false,
      context_receipt: contextReceipt,
      effective_config: receipt,
    };
    const scripted = scriptedPool((text) =>
      text.includes("consume_worker_effective_run_config")
        ? { rows: [{ value: workerResult }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease,
    });

    expect(result).toEqual({ ok: true, value: workerResult });
    const consume = scripted.calls.find((call) =>
      call.text.includes("consume_worker_effective_run_config"),
    );
    expect(consume?.values).toEqual([
      ids.receipt,
      ref.config_id,
      ref.config_revision,
      ref.config_hash,
      ids.run,
      ids.consumer,
      ids.attempt,
      ids.consumer,
      7,
      2,
      ids.outbox,
      ids.command,
    ]);

    const { receipt_hash: _receiptHash, ...contextDraft } = contextReceipt;
    const mismatchedContext = await buildContextReceiptBindingCandidate({
      ...contextDraft,
      worker_fence: lease.worker_fence + 1,
    });
    const mismatchedPool = scriptedPool((text) =>
      text.includes("consume_worker_effective_run_config")
        ? {
            rows: [
              {
                value: {
                  ...workerResult,
                  context_receipt: mismatchedContext,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const mismatched = await createPostgresEffectiveConfigResolver({
      pool: mismatchedPool.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease,
    });
    expect(mismatched).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID" },
    });

    const wrongCommandContext = await buildContextReceiptBindingCandidate({
      ...contextDraft,
      command_id: ids.audit,
    });
    const wrongCommandPool = scriptedPool((text) =>
      text.includes("consume_worker_effective_run_config")
        ? {
            rows: [
              {
                value: {
                  ...workerResult,
                  context_receipt: wrongCommandContext,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const wrongCommand = await createPostgresEffectiveConfigResolver({
      pool: wrongCommandPool.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease,
    });
    expect(wrongCommand).toMatchObject({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_DATABASE_CONTRACT_INVALID" },
    });
  });

  it("compares Worker resource refs in resource-ID order, independent of binding-kind order", async () => {
    const authority = access();
    const baseReceipt = await effectiveReceipt();
    const highFileId = "00000000-0000-4000-8000-0000000000ff";
    const lowKnowledgeId = "00000000-0000-4000-8000-000000000018";
    const mandatoryBindings = availableMandatoryBindings();
    const bindings = [
      ...mandatoryBindings.slice(0, 4),
      {
        resource_kind: "FILE" as const,
        mention_id: ids.audit,
        requested_resource_id: highFileId,
        requested_revision: 2,
        effective_resource: resource(highFileId, 2, H5),
        source: "MENTION" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "KNOWLEDGE" as const,
        mention_id: null,
        requested_resource_id: lowKnowledgeId,
        requested_revision: 3,
        effective_resource: resource(lowKnowledgeId, 3, H6),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      ...mandatoryBindings.slice(4),
    ];
    const { config_hash: _oldHash, ...receiptDraft } = baseReceipt;
    const receipt = await buildEffectiveRunConfigReceiptCandidate({
      ...receiptDraft,
      resource_bindings: bindings,
      optional_selection_evaluations: receiptDraft.optional_selection_evaluations.map(
        (evaluation) =>
          evaluation.resource_kind === "KNOWLEDGE"
            ? { ...evaluation, binding_count: 1 }
            : evaluation,
      ),
    });
    const ref = {
      config_id: receipt.config_id,
      config_revision: receipt.config_revision,
      config_hash: receipt.config_hash,
    };
    const lease = workerLease(ref);
    const contextReceipt = await buildContextReceiptBindingCandidate({
      schema_version: "effective-config-context-receipt@1.0.0",
      receipt_id: ids.receipt,
      outbox_id: lease.outbox_id,
      command_id: lease.command_id,
      consumer: "WORKER_START",
      consumer_id: lease.worker_id,
      attempt_id: lease.attempt_id,
      lease_token: lease.lease_token,
      worker_fence: lease.worker_fence,
      scope: scope(),
      run_id: ids.run,
      config_ref: ref,
      semantic_release: receipt.semantic_release,
      schema_snapshot: receipt.schema_snapshot,
      context_policy: resource(
        receipt.context_policy.resource_id,
        receipt.context_policy.resource_revision,
        receipt.context_policy.resource_hash,
      ),
      provider: receipt.model.provider,
      audiences: receipt.effective_egress.allowed_audiences,
      classification: receipt.effective_egress.classification,
      resource_refs: [
        ...mandatoryResourceRefs(),
        resource(lowKnowledgeId, 3, H6),
        resource(highFileId, 2, H5),
      ],
      consumed_at: "2026-08-16T10:01:00.000Z",
    });
    const scripted = scriptedPool((text) =>
      text.includes("consume_worker_effective_run_config")
        ? {
            rows: [
              {
                value: {
                  schema_version: "effective-config-worker-consumption@1.0.0",
                  replayed: false,
                  context_receipt: contextReceipt,
                  effective_config: receipt,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );

    const result = await createPostgresEffectiveConfigResolver({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).revalidateForWorker({
      principal_capability: authority.capability,
      context_receipt_id: ids.receipt,
      lease,
    });

    expect(result).toMatchObject({ ok: true });
  });
});
