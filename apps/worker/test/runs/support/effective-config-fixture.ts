import {
  type AppScope,
  buildContextReceiptBindingCandidate,
  buildEffectiveRunConfigReceiptCandidate,
  type EffectiveRunConfigReceiptCandidate,
  type PortResult,
  type RunWorkLease,
} from "@data-agent/contracts";

const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const H4 = `sha256:${"4".repeat(64)}` as const;
const H5 = `sha256:${"5".repeat(64)}` as const;
const H6 = `sha256:${"6".repeat(64)}` as const;

const ids = {
  config: "80000000-0000-4000-8000-000000000080",
  defaults: "80000000-0000-4000-8000-000000000081",
  route: "80000000-0000-4000-8000-000000000082",
  model: "80000000-0000-4000-8000-000000000083",
  datasource: "80000000-0000-4000-8000-000000000084",
  semantic: "80000000-0000-4000-8000-000000000085",
  snapshot: "80000000-0000-4000-8000-000000000086",
  context: "80000000-0000-4000-8000-000000000087",
  egress: "80000000-0000-4000-8000-000000000088",
  safety: "80000000-0000-4000-8000-000000000089",
  conversation: "80000000-0000-4000-8000-00000000008a",
} as const;

function resource(resource_id: string, resource_revision: number, resource_hash: string) {
  return { resource_id, resource_revision, resource_hash };
}

function mandatoryBindings() {
  return (
    [
      ["CONTEXT_POLICY", ids.context, 6, H6, "POLICY"],
      ["DATASOURCE", ids.datasource, 3, H3, "DEFAULT"],
      ["EGRESS_POLICY", ids.egress, 7, H1, "POLICY"],
      ["EXECUTION_SAFETY_POLICY", ids.safety, 8, H2, "POLICY"],
      ["MODEL_PROFILE", ids.model, 2, H2, "DEFAULT"],
      ["SCHEMA_SNAPSHOT", ids.snapshot, 5, H5, "ACTIVE_POINTER"],
      ["SEMANTIC_RELEASE", ids.semantic, 4, H4, "ACTIVE_POINTER"],
    ] as const
  ).map(([resourceKind, resourceId, revision, hash, source]) => {
    return {
      resource_kind: resourceKind,
      mention_id: null,
      requested_resource_id:
        resourceKind === "DATASOURCE" || resourceKind === "MODEL_PROFILE" ? resourceId : null,
      requested_revision:
        resourceKind === "DATASOURCE" || resourceKind === "MODEL_PROFILE" ? revision : null,
      effective_resource: resource(resourceId, revision, hash),
      source,
      availability: "AVAILABLE" as const,
      unavailable_reason: null,
    };
  });
}

function optionalSelectionEvaluations() {
  const defaultsRef = { defaults_id: ids.defaults, defaults_revision: 1, defaults_hash: H1 };
  return (["FILE", "KNOWLEDGE", "MCP_SERVER", "SKILL"] as const).map((resourceKind) => ({
    resource_kind: resourceKind,
    selection_mode: "INHERIT_DEFAULT" as const,
    binding_count: 0,
    defaults_ref: defaultsRef,
  }));
}

export async function buildWorkerEffectiveConfigFixture(input: {
  scope: AppScope;
  workspace_id: string;
  principal_id: string;
  run_id: string;
}): Promise<EffectiveRunConfigReceiptCandidate> {
  return buildEffectiveRunConfigReceiptCandidate({
    schema_version: "effective-run-config-receipt@1.0.0",
    config_id: ids.config,
    config_revision: 1,
    scope: {
      ...input.scope,
      workspace_id: input.workspace_id,
      principal_id: input.principal_id,
    },
    run_id: input.run_id,
    operation: "QUESTION_RUN",
    conversation_binding: { conversation_id: ids.conversation, resource_version: 3 },
    request_hash: H1,
    defaults_ref: { defaults_id: ids.defaults, defaults_revision: 1, defaults_hash: H1 },
    authority_binding: {
      authz_epoch: 1,
      membership_version: 1,
      workspace_lifecycle_version: 1,
      route_resolution_id: ids.route,
      route_resolution_hash: H2,
      resolver_policy_version: "effective-config-resolver@1",
    },
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
    resource_bindings: mandatoryBindings(),
    optional_selection_evaluations: optionalSelectionEvaluations(),
    effective_egress: {
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "RESTRICTED",
    },
  });
}

export function effectiveConfigRef(config: EffectiveRunConfigReceiptCandidate) {
  return {
    config_id: config.config_id,
    config_revision: config.config_revision,
    config_hash: config.config_hash,
  };
}

export function bindEffectiveConfigLease(
  lease: RunWorkLease,
  config: EffectiveRunConfigReceiptCandidate,
): RunWorkLease {
  return {
    ...lease,
    command_kind: "START_L2_RESEARCH",
    payload: {
      kind: "START_L2_RESEARCH",
      effective_config_ref: effectiveConfigRef(config),
    },
  };
}

export function createEffectiveConfigFixtureLoader(
  config: EffectiveRunConfigReceiptCandidate,
): (lease: RunWorkLease) => Promise<PortResult<unknown>> {
  return async (lease) => {
    const contextReceipt = await buildContextReceiptBindingCandidate({
      schema_version: "effective-config-context-receipt@1.0.0",
      receipt_id: lease.attempt_id,
      outbox_id: lease.outbox_id,
      command_id: lease.command_id,
      consumer: "WORKER_START",
      consumer_id: lease.worker_id,
      attempt_id: lease.attempt_id,
      lease_token: lease.lease_token,
      worker_fence: lease.worker_fence,
      scope: config.scope,
      run_id: lease.run_id,
      config_ref: effectiveConfigRef(config),
      semantic_release: config.semantic_release,
      schema_snapshot: config.schema_snapshot,
      context_policy: resource(
        config.context_policy.resource_id,
        config.context_policy.resource_revision,
        config.context_policy.resource_hash,
      ),
      provider: config.model.provider,
      audiences: config.effective_egress.allowed_audiences,
      classification: config.effective_egress.classification,
      resource_refs: mandatoryBindings()
        .map(({ effective_resource }) => effective_resource)
        .toSorted((left, right) => left.resource_id.localeCompare(right.resource_id)),
      consumed_at: "2026-08-16T10:01:00.000Z",
    });
    return {
      ok: true,
      value: {
        schema_version: "effective-config-worker-consumption@1.0.0",
        replayed: false,
        context_receipt: contextReceipt,
        effective_config: config,
      },
    };
  };
}
