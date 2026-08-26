import { describe, expect, it } from "vitest";
import {
  bootstrapJobConfigCandidateSchema,
  buildContextReceiptBindingCandidate,
  buildEffectiveRunConfigReceiptCandidate,
  buildRunConfigRequestCandidate,
  buildRunConfigResolutionReceiptCandidate,
  computeEffectiveRunConfigHash,
  computeRunConfigRequestHash,
  contextReceiptBindingSchema,
  effectiveConfigRunCommandEnvelopeSchema,
  effectiveConfigRunLeasePayloadSchema,
  effectiveRunConfigReceiptCandidateSchema,
  resolveNarrowedEgressPolicy,
  runConfigRequestSchema,
  runConfigResolutionReceiptCandidateSchema,
  runConfigResourceBindingSchema,
  runConfigUnavailableReasonSchema,
  verifyContextReceiptBindingCandidate,
  verifyEffectiveRunConfigReceiptCandidate,
  verifyRunConfigRequestCandidate,
  verifyRunConfigResolutionReceiptCandidate,
} from "../src/runs/effective-config.js";
import {
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  buildWorkspaceDefaultsRevisionCandidate,
  computeWorkspaceDefaultsHash,
  requestedResourceCollectionSchema,
  requestedSingleResourceSchema,
  verifyWorkspaceDefaultsCasUpdateCommand,
  verifyWorkspaceDefaultsRevision,
  workspaceDefaultsCasUpdateCommandSchema,
  workspaceDefaultsRevisionSchema,
} from "../src/workspaces/defaults.js";
import {
  qaRunBindingSchema,
  qaRunStartInputSchema,
  qaRunStartInputV2Schema,
} from "../src/workspaces/qa-resources.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000003",
  workspace: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  config: "00000000-0000-4000-8000-000000000006",
  defaults: "00000000-0000-4000-8000-000000000007",
  model: "00000000-0000-4000-8000-000000000008",
  datasource: "00000000-0000-4000-8000-000000000009",
  file: "00000000-0000-4000-8000-00000000000a",
  semantic: "00000000-0000-4000-8000-00000000000b",
  snapshot: "00000000-0000-4000-8000-00000000000c",
  context: "00000000-0000-4000-8000-00000000000d",
  egress: "00000000-0000-4000-8000-00000000000e",
  safety: "00000000-0000-4000-8000-00000000000f",
  receipt: "00000000-0000-4000-8000-000000000010",
  route: "00000000-0000-4000-8000-000000000011",
  mention: "00000000-0000-4000-8000-000000000012",
  candidate: "00000000-0000-4000-8000-000000000013",
  job: "00000000-0000-4000-8000-000000000014",
} as const;

const H1 = `sha256:${"1".repeat(64)}`;
const H2 = `sha256:${"2".repeat(64)}`;
const H3 = `sha256:${"3".repeat(64)}`;
const H4 = `sha256:${"4".repeat(64)}`;
const H5 = `sha256:${"5".repeat(64)}`;
const H6 = `sha256:${"6".repeat(64)}`;

const resource = (resource_id: string, revision = 1, resource_hash = H1) => ({
  resource_id,
  resource_revision: revision,
  resource_hash,
});

function uppercaseUuids<T>(input: T): T {
  if (typeof input === "string") {
    return (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
        ? input.toUpperCase()
        : input
    ) as T;
  }
  if (Array.isArray(input)) {
    return input.map(uppercaseUuids) as T;
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, uppercaseUuids(value)]),
    ) as T;
  }
  return input;
}

const defaultsDraft = {
  schema_version: "workspace-defaults-revision@1.0.0",
  scope: {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "production",
    workspace_id: ids.workspace,
  },
  defaults_id: ids.defaults,
  defaults_revision: 1,
  parent_revision: null,
  parent_hash: null,
  defaults: {
    model: resource(ids.model),
    datasource: resource(ids.datasource),
    files: [resource(ids.file)],
    knowledge: [],
    mcp_servers: [],
    skills: [],
    semantic_release: resource(ids.semantic, 3, H2),
    schema_snapshot: resource(ids.snapshot, 7, H3),
    context_policy: resource(ids.context, 2, H4),
    egress_policy: resource(ids.egress, 4, H5),
    execution_safety_policy: resource(ids.safety, 6, H6),
  },
  created_by_principal_id: ids.principal,
  created_at: "2026-08-16T10:00:00.000Z",
};

const defaultsSelection = {
  model: { resource_id: ids.model, expected_revision: 1 },
  datasource: { resource_id: ids.datasource, expected_revision: 1 },
  files: [{ resource_id: ids.file, expected_revision: 1 }],
  knowledge: [],
  mcp_servers: [],
  skills: [],
  semantic_release: { resource_id: ids.semantic, expected_revision: 3 },
  schema_snapshot: { resource_id: ids.snapshot, expected_revision: 7 },
  context_policy: { resource_id: ids.context, expected_revision: 2 },
  egress_policy: { resource_id: ids.egress, expected_revision: 4 },
  execution_safety_policy: { resource_id: ids.safety, expected_revision: 6 },
};

const requestDraft = {
  schema_version: "run-config-request@1.0.0",
  operation: "QUESTION_RUN",
  workspace_id: ids.workspace,
  run_id: ids.run,
  conversation_ref: { conversation_id: ids.receipt, expected_resource_version: 3 },
  idempotency_key: "run-config:one",
  defaults_ref: {
    defaults_id: ids.defaults,
    defaults_revision: 1,
    defaults_hash: H1,
  },
  overrides: {
    model: { mode: "INHERIT_DEFAULT" },
    datasource: {
      mode: "RESOURCE_IDS",
      resources: [{ resource_id: ids.datasource, expected_revision: 1 }],
    },
    files: { mode: "EXPLICIT_NONE" },
    knowledge: { mode: "INHERIT_DEFAULT" },
    mcp_servers: { mode: "INHERIT_DEFAULT" },
    skills: { mode: "INHERIT_DEFAULT" },
    egress: {
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE", "WORKSPACE"],
      classification: "RESTRICTED",
    },
  },
  mentions: [
    {
      mention_id: ids.mention,
      resource_kind: "FILE",
      resource_id: ids.file,
      expected_revision: 1,
    },
  ],
};

type OptionalSelectionOverrides = Readonly<
  Record<
    "files" | "knowledge" | "mcp_servers" | "skills",
    Readonly<{ mode: string; resources?: readonly unknown[] }>
  >
>;

function optionalSelectionEvaluations(
  overrides: OptionalSelectionOverrides = requestDraft.overrides,
  defaults_ref = requestDraft.defaults_ref,
  inheritedBindingCounts: Partial<
    Record<"FILE" | "KNOWLEDGE" | "MCP_SERVER" | "SKILL", number>
  > = {},
) {
  return (
    [
      ["files", "FILE"],
      ["knowledge", "KNOWLEDGE"],
      ["mcp_servers", "MCP_SERVER"],
      ["skills", "SKILL"],
    ] as const
  ).map(([field, resource_kind]) => {
    const selection = overrides[field];
    return {
      resource_kind,
      selection_mode: selection.mode,
      binding_count:
        selection.mode === "RESOURCE_IDS"
          ? (selection.resources?.length ?? 0)
          : selection.mode === "INHERIT_DEFAULT"
            ? (inheritedBindingCounts[resource_kind] ?? 0)
            : 0,
      defaults_ref: selection.mode === "INHERIT_DEFAULT" ? defaults_ref : null,
    };
  });
}

function effectiveReceiptDraft() {
  return {
    schema_version: "effective-run-config-receipt@1.0.0",
    config_id: ids.config,
    config_revision: 1,
    scope: {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "production",
      workspace_id: ids.workspace,
      principal_id: ids.principal,
    },
    run_id: ids.run,
    operation: "QUESTION_RUN",
    conversation_binding: { conversation_id: ids.receipt, resource_version: 3 },
    request_hash: H1,
    defaults_ref: {
      defaults_id: ids.defaults,
      defaults_revision: 1,
      defaults_hash: H2,
    },
    authority_binding: {
      authz_epoch: 9,
      membership_version: 3,
      workspace_lifecycle_version: 2,
      route_resolution_id: ids.route,
      route_resolution_hash: H3,
      resolver_policy_version: "effective-config-resolver@1",
    },
    model: {
      ...resource(ids.model, 2, H2),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      profile_version: "profile@2",
    },
    datasource: resource(ids.datasource, 4, H3),
    semantic_release: {
      ...resource(ids.semantic, 3, H4),
      datasource_id: ids.datasource,
      semantic_generation: 8,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      ...resource(ids.snapshot, 7, H5),
      datasource_id: ids.datasource,
      semantic_release_id: ids.semantic,
      semantic_generation: 8,
    },
    context_policy: {
      ...resource(ids.context, 2, H6),
      max_context_tokens: 32_000,
      max_resource_bindings: 64,
    },
    egress_policy: {
      ...resource(ids.egress, 4, H1),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE", "WORKSPACE"],
      classification: "RESTRICTED",
    },
    execution_safety_policy: {
      ...resource(ids.safety, 6, H2),
      max_tool_calls: 32,
      max_provider_calls: 8,
      max_elapsed_ms: 300_000,
    },
    resource_bindings: [
      {
        resource_kind: "CONTEXT_POLICY",
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.context, 2, H6),
        source: "POLICY",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "DATASOURCE",
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 4,
        effective_resource: resource(ids.datasource, 4, H3),
        source: "DEFAULT",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "EGRESS_POLICY",
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.egress, 4, H1),
        source: "POLICY",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "EXECUTION_SAFETY_POLICY",
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.safety, 6, H2),
        source: "POLICY",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "FILE",
        mention_id: ids.mention,
        requested_resource_id: ids.file,
        requested_revision: 1,
        effective_resource: resource(ids.file),
        source: "MENTION",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "MODEL_PROFILE",
        mention_id: null,
        requested_resource_id: ids.model,
        requested_revision: 2,
        effective_resource: resource(ids.model, 2, H2),
        source: "DEFAULT",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT",
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 7, H5),
        source: "ACTIVE_POINTER",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "SEMANTIC_RELEASE",
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.semantic, 3, H4),
        source: "ACTIVE_POINTER",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
    ],
    optional_selection_evaluations: optionalSelectionEvaluations(requestDraft.overrides, {
      defaults_id: ids.defaults,
      defaults_revision: 1,
      defaults_hash: H2,
    }),
    effective_egress: {
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "RESTRICTED",
    },
  };
}

describe("U2 effective run config contracts", () => {
  it("rejects resource binding provenance outside the kind/source authority matrix", () => {
    expect(
      runConfigResourceBindingSchema.safeParse({
        resource_kind: "SEMANTIC_RELEASE",
        mention_id: ids.mention,
        requested_resource_id: ids.semantic,
        requested_revision: 3,
        effective_resource: resource(ids.semantic, 3, H4),
        source: "MENTION",
        availability: "AVAILABLE",
        unavailable_reason: null,
      }).success,
    ).toBe(false);
    expect(
      runConfigResourceBindingSchema.safeParse({
        resource_kind: "CONTEXT_POLICY",
        mention_id: null,
        requested_resource_id: ids.context,
        requested_revision: 2,
        effective_resource: resource(ids.context, 2, H6),
        source: "DEFAULT",
        availability: "AVAILABLE",
        unavailable_reason: null,
      }).success,
    ).toBe(false);
  });

  it("preserves the existing QA v1 wire exactly", () => {
    expect(
      qaRunStartInputSchema.parse({
        schema_version: "qa-run-start@1.0.0",
        question: "本月收入是多少？",
        idempotency_key: "qa:start:1",
      }),
    ).toEqual({
      schema_version: "qa-run-start@1.0.0",
      question: "本月收入是多少？",
      idempotency_key: "qa:start:1",
    });
    expect(
      qaRunBindingSchema.safeParse({
        schema_version: "qa-run-binding@1.0.0",
        workspace_id: ids.workspace,
        run_id: ids.run,
        conversation_id: ids.receipt,
        principal_id: ids.principal,
        datasource_id: ids.datasource,
        datasource_binding_hash: H1,
        model_profile_id: ids.model,
        model_config_version: 1,
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
        created_at: "2026-08-16T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("keeps inherit, explicit-none, and resource IDs distinct and canonical", () => {
    expect(requestedSingleResourceSchema.parse({ mode: "INHERIT_DEFAULT" })).toEqual({
      mode: "INHERIT_DEFAULT",
    });
    expect(requestedSingleResourceSchema.parse({ mode: "EXPLICIT_NONE" })).toEqual({
      mode: "EXPLICIT_NONE",
    });
    expect(
      requestedSingleResourceSchema.safeParse({
        mode: "RESOURCE_IDS",
        resources: [
          { resource_id: ids.model, expected_revision: 1 },
          { resource_id: ids.datasource, expected_revision: 1 },
        ],
      }).success,
    ).toBe(false);

    const reversed = [
      { resource_id: ids.file, expected_revision: 2 },
      { resource_id: ids.datasource, expected_revision: 1 },
    ];
    expect(
      requestedResourceCollectionSchema.safeParse({ mode: "RESOURCE_IDS", resources: reversed })
        .success,
    ).toBe(false);
    expect(
      requestedResourceCollectionSchema.safeParse({
        mode: "RESOURCE_IDS",
        resources: [reversed[1], reversed[0]],
      }).success,
    ).toBe(true);
    expect(
      requestedResourceCollectionSchema.safeParse({
        mode: "RESOURCE_IDS",
        resources: [reversed[0], reversed[0]],
      }).success,
    ).toBe(false);

    const upperFileId = ids.file.toUpperCase();
    expect(
      requestedResourceCollectionSchema.safeParse({
        mode: "RESOURCE_IDS",
        resources: [
          { resource_id: upperFileId, expected_revision: 1 },
          { resource_id: ids.file, expected_revision: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes every U2 UUID before canonical hashing and identity comparison", async () => {
    const upper = (value: string) => value.toUpperCase();
    const uppercaseDraft = {
      ...requestDraft,
      workspace_id: upper(requestDraft.workspace_id),
      run_id: upper(requestDraft.run_id),
      defaults_ref: {
        ...requestDraft.defaults_ref,
        defaults_id: upper(requestDraft.defaults_ref.defaults_id),
      },
      overrides: {
        ...requestDraft.overrides,
        datasource: {
          mode: "RESOURCE_IDS" as const,
          resources: [
            {
              resource_id: upper(ids.datasource),
              expected_revision: 1,
            },
          ],
        },
      },
      mentions: [
        {
          ...requestDraft.mentions[0],
          mention_id: upper(ids.mention),
          resource_id: upper(ids.file),
        },
      ],
    };
    const normalized = await buildRunConfigRequestCandidate(uppercaseDraft);
    const baseline = await buildRunConfigRequestCandidate(requestDraft);
    if (normalized.operation !== "QUESTION_RUN" || baseline.operation !== "QUESTION_RUN") {
      throw new TypeError("Expected QUESTION_RUN candidate");
    }
    expect(normalized.workspace_id).toBe(ids.workspace);
    expect(normalized.run_id).toBe(ids.run);
    expect(normalized.defaults_ref.defaults_id).toBe(ids.defaults);
    expect(normalized.mentions[0]?.mention_id).toBe(ids.mention);
    expect(normalized.mentions[0]?.resource_id).toBe(ids.file);
    expect(normalized.request_hash).toBe(baseline.request_hash);
    expect(await computeWorkspaceDefaultsHash(uppercaseUuids(defaultsDraft))).toBe(
      await computeWorkspaceDefaultsHash(defaultsDraft),
    );
    expect(await computeEffectiveRunConfigHash(uppercaseUuids(effectiveReceiptDraft()))).toBe(
      await computeEffectiveRunConfigHash(effectiveReceiptDraft()),
    );
  });

  it("content-addresses defaults and binds every default revision/hash", async () => {
    const parsed = await buildWorkspaceDefaultsRevisionCandidate(defaultsDraft);
    expect(workspaceDefaultsRevisionSchema.safeParse(parsed).success).toBe(true);
    expect(parsed.defaults_hash).toBe(await computeWorkspaceDefaultsHash(defaultsDraft));
    await expect(verifyWorkspaceDefaultsRevision(parsed)).resolves.toEqual(parsed);
    expect(
      await computeWorkspaceDefaultsHash({
        ...defaultsDraft,
        defaults: {
          ...defaultsDraft.defaults,
          model: resource(ids.model, 2, H2),
        },
      }),
    ).not.toBe(parsed.defaults_hash);
    await expect(
      verifyWorkspaceDefaultsRevision({
        ...parsed,
        created_at: "2026-08-16T10:00:01.000Z",
      }),
    ).rejects.toThrow("WORKSPACE_DEFAULTS_HASH_MISMATCH");
    expect(
      workspaceDefaultsRevisionSchema.safeParse({
        ...parsed,
        scope: { ...parsed.scope, tenant_id: ids.app },
      }).success,
    ).toBe(false);
  });

  it("accepts only ID/revision mentions and rejects client authority, display, secret, and commercial claims", async () => {
    const candidate = await buildRunConfigRequestCandidate(requestDraft);
    const { request_hash } = candidate;
    expect(runConfigRequestSchema.parse(candidate).request_hash).toBe(request_hash);
    await expect(verifyRunConfigRequestCandidate(candidate)).resolves.toEqual(candidate);

    for (const injected of [
      { role: "WORKSPACE_ADMIN" },
      { semantic_release: resource(ids.semantic) },
      { schema_snapshot: resource(ids.snapshot) },
      { effective_model: resource(ids.model) },
      { provider_eligible: true },
      { secret: "sk-should-never-cross-this-boundary" },
      { price: 1 },
      { cost: 1 },
      { credit: 1 },
      { billing: "ENFORCED" },
    ]) {
      expect(
        runConfigRequestSchema.safeParse({ ...requestDraft, request_hash, ...injected }).success,
      ).toBe(false);
    }

    expect(
      runConfigRequestSchema.safeParse({
        ...requestDraft,
        request_hash,
        mentions: [{ ...requestDraft.mentions[0], display_name: "同名文件" }],
      }).success,
    ).toBe(false);

    expect(
      runConfigRequestSchema.safeParse({
        ...candidate,
        mentions: [candidate.mentions[0], { ...candidate.mentions[0], mention_id: ids.candidate }],
      }).success,
    ).toBe(false);
    expect(
      runConfigRequestSchema.safeParse({
        ...candidate,
        overrides: {
          ...candidate.overrides,
          files: {
            mode: "RESOURCE_IDS",
            resources: [{ resource_id: ids.file, expected_revision: 1 }],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only the strict server command envelope and never caller payload/event/hash authority", () => {
    const command = {
      run_id: ids.run,
      command_id: ids.config,
      event_id: ids.receipt,
      outbox_id: ids.route,
      audit_id: ids.mention,
      idempotency_key: requestDraft.idempotency_key,
      question: "本月收入是多少？",
    };
    expect(effectiveConfigRunCommandEnvelopeSchema.parse(uppercaseUuids(command))).toEqual(command);
    for (const injected of [
      { payload: { kind: "START_L2_RESEARCH" } },
      { payload_hash: H1 },
      { event: { event_id: ids.receipt } },
      { event_hash: H2 },
      { effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: H3 } },
      { dispatch_admission: { kind: "EXECUTE" } },
      { shadow_dispatch_plan: null },
    ]) {
      expect(
        effectiveConfigRunCommandEnvelopeSchema.safeParse({ ...command, ...injected }).success,
      ).toBe(false);
    }
    expect(
      effectiveConfigRunLeasePayloadSchema.safeParse({
        kind: "START_L2_RESEARCH",
        effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: H3 },
        datasource_id: ids.datasource,
      }).success,
    ).toBe(false);
    expect(
      effectiveConfigRunCommandEnvelopeSchema.safeParse({ ...command, question: "   \t\n" })
        .success,
    ).toBe(false);
  });

  it("content-addresses strict Workspace Defaults CAS commands", async () => {
    const draft = {
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.receipt,
      workspace_id: ids.workspace,
      expected_defaults_revision: 0,
      idempotency_key: "defaults:first",
      defaults: defaultsSelection,
    };
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate(draft);
    expect(workspaceDefaultsCasUpdateCommandSchema.safeParse(command).success).toBe(true);
    await expect(verifyWorkspaceDefaultsCasUpdateCommand(command)).resolves.toEqual(command);
    await expect(
      verifyWorkspaceDefaultsCasUpdateCommand({
        ...command,
        expected_defaults_revision: 1,
      }),
    ).rejects.toThrow("WORKSPACE_DEFAULTS_REQUEST_HASH_MISMATCH");
    for (const serverOwned of [
      { created_by_principal_id: ids.principal },
      { defaults_hash: H1 },
      { created_at: "2026-08-16T10:00:00.000Z" },
    ]) {
      expect(
        workspaceDefaultsCasUpdateCommandSchema.safeParse({ ...command, ...serverOwned }).success,
      ).toBe(false);
    }
  });

  it("accepts only Defaults selection intent and never client-authored resource authority", () => {
    const selection = {
      model: { resource_id: ids.model, expected_revision: 2 },
      datasource: { resource_id: ids.datasource, expected_revision: 3 },
      files: [{ resource_id: ids.file, expected_revision: 1 }],
      knowledge: [],
      mcp_servers: [],
      skills: [],
      semantic_release: { resource_id: ids.semantic, expected_revision: 4 },
      schema_snapshot: { resource_id: ids.snapshot, expected_revision: 5 },
      context_policy: { resource_id: ids.context, expected_revision: 6 },
      egress_policy: { resource_id: ids.egress, expected_revision: 7 },
      execution_safety_policy: { resource_id: ids.safety, expected_revision: 8 },
    };
    const envelope = {
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: ids.receipt,
      workspace_id: ids.workspace,
      expected_defaults_revision: 0,
      idempotency_key: "defaults:intent",
      defaults: selection,
      request_hash: H1,
    };

    expect(workspaceDefaultsCasUpdateCommandSchema.safeParse(envelope).success).toBe(true);
    expect(
      workspaceDefaultsCasUpdateCommandSchema.safeParse({
        ...envelope,
        defaults: defaultsDraft.defaults,
      }).success,
    ).toBe(false);
    expect(
      workspaceDefaultsCasUpdateCommandSchema.safeParse({
        ...envelope,
        defaults: {
          ...selection,
          model: { ...selection.model, resource_hash: H2 },
        },
      }).success,
    ).toBe(false);
  });

  it("freezes QUESTION conversation authority in request, resolution, and effective receipt hashes", async () => {
    const conversationRef = {
      conversation_id: ids.receipt,
      expected_resource_version: 3,
    };
    expect(
      runConfigRequestSchema.safeParse({
        ...requestDraft,
        conversation_ref: conversationRef,
        request_hash: H1,
      }).success,
    ).toBe(true);
    const { conversation_ref: _conversationRef, ...requestWithoutConversation } = requestDraft;
    expect(
      runConfigRequestSchema.safeParse({ ...requestWithoutConversation, request_hash: H1 }).success,
    ).toBe(false);

    const receiptDraft = {
      ...effectiveReceiptDraft(),
      conversation_binding: {
        conversation_id: conversationRef.conversation_id,
        resource_version: conversationRef.expected_resource_version,
      },
    };
    const baseline = await computeEffectiveRunConfigHash(receiptDraft);
    expect(
      effectiveRunConfigReceiptCandidateSchema.safeParse({
        ...receiptDraft,
        config_hash: baseline,
      }).success,
    ).toBe(true);
    expect(
      await computeEffectiveRunConfigHash({
        ...receiptDraft,
        conversation_binding: { ...receiptDraft.conversation_binding, resource_version: 4 },
      }),
    ).not.toBe(baseline);
  });

  it("rejects stale request hashes at the content-addressed verifier boundary", async () => {
    expect(runConfigRequestSchema.safeParse({ ...requestDraft, request_hash: H6 }).success).toBe(
      true,
    );
    expect(await computeRunConfigRequestHash(requestDraft)).not.toBe(H6);
    await expect(
      verifyRunConfigRequestCandidate({ ...requestDraft, request_hash: H6 }),
    ).rejects.toThrow("RUN_CONFIG_REQUEST_HASH_MISMATCH");
  });

  it("enforces QUESTION_RUN semantic/snapshot presence and exact consistency", async () => {
    const draft = effectiveReceiptDraft();
    const candidate = await buildEffectiveRunConfigReceiptCandidate(draft);
    const { config_hash } = candidate;
    expect(effectiveRunConfigReceiptCandidateSchema.safeParse(candidate).success).toBe(true);
    await expect(verifyEffectiveRunConfigReceiptCandidate(candidate)).resolves.toEqual(candidate);
    await expect(
      verifyEffectiveRunConfigReceiptCandidate({
        ...candidate,
        authority_binding: { ...candidate.authority_binding, authz_epoch: 10 },
      }),
    ).rejects.toThrow("EFFECTIVE_RUN_CONFIG_HASH_MISMATCH");

    for (const invalid of [
      { ...draft, semantic_release: null },
      { ...draft, schema_snapshot: null },
      {
        ...draft,
        schema_snapshot: { ...draft.schema_snapshot, datasource_id: ids.file },
      },
      {
        ...draft,
        schema_snapshot: { ...draft.schema_snapshot, semantic_generation: 9 },
      },
      {
        ...draft,
        semantic_release: { ...draft.semantic_release, publication_status: "CANDIDATE" },
      },
    ]) {
      expect(
        effectiveRunConfigReceiptCandidateSchema.safeParse({ ...invalid, config_hash }).success,
      ).toBe(false);
    }
  });

  it("requires exact mandatory READY bindings and mention identity", async () => {
    const draft = effectiveReceiptDraft();
    const withoutModel = {
      ...draft,
      resource_bindings: draft.resource_bindings.filter(
        (binding) => binding.resource_kind !== "MODEL_PROFILE",
      ),
    };
    await expect(buildEffectiveRunConfigReceiptCandidate(withoutModel)).rejects.toBeDefined();

    const mismatchedDatasource = {
      ...draft,
      resource_bindings: draft.resource_bindings.map((binding) =>
        binding.resource_kind === "DATASOURCE"
          ? { ...binding, effective_resource: resource(ids.datasource, 4, H6) }
          : binding,
      ),
    };
    await expect(
      buildEffectiveRunConfigReceiptCandidate(mismatchedDatasource),
    ).rejects.toBeDefined();

    const missingMentionId = {
      ...draft,
      resource_bindings: draft.resource_bindings.map((binding) =>
        binding.resource_kind === "FILE" ? { ...binding, mention_id: null } : binding,
      ),
    };
    await expect(buildEffectiveRunConfigReceiptCandidate(missingMentionId)).rejects.toBeDefined();
  });

  it("keeps SEMANTIC_BOOTSTRAP_JOB outside EffectiveConfigRef and freezes pre-candidate inputs", () => {
    const bootstrapBindings = [
      {
        resource_kind: "DATASOURCE",
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 4,
        effective_resource: resource(ids.datasource, 4, H3),
        source: "DEFAULT",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT",
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 7, H5),
        source: "ACTIVE_POINTER",
        availability: "AVAILABLE",
        unavailable_reason: null,
      },
    ];
    const draft = {
      schema_version: "semantic-bootstrap-job-config@1.0.0",
      scope: effectiveReceiptDraft().scope,
      job_id: ids.job,
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      request_hash: H1,
      defaults_ref: effectiveReceiptDraft().defaults_ref,
      authority_binding: effectiveReceiptDraft().authority_binding,
      datasource: resource(ids.datasource, 4, H3),
      semantic_release: null,
      schema_snapshot: {
        ...resource(ids.snapshot, 7, H5),
        datasource_id: ids.datasource,
      },
      source_resources: [],
      resource_bindings: bootstrapBindings,
    };
    expect(bootstrapJobConfigCandidateSchema.safeParse(draft).success).toBe(true);
    expect(
      bootstrapJobConfigCandidateSchema.safeParse({
        ...draft,
        bootstrap_candidate_ref: {
          candidate_id: ids.candidate,
          candidate_revision: 1,
          candidate_hash: H6,
        },
      }).success,
    ).toBe(false);
    expect(
      effectiveRunConfigReceiptCandidateSchema.safeParse({ ...draft, config_hash: H1 }).success,
    ).toBe(false);
  });

  it("represents an independent bootstrap request and resolution without an EffectiveConfigRef", async () => {
    const bootstrapRequest = await buildRunConfigRequestCandidate({
      schema_version: "run-config-request@1.0.0",
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      workspace_id: ids.workspace,
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      idempotency_key: "bootstrap:one",
      defaults_ref: requestDraft.defaults_ref,
      overrides: {
        ...requestDraft.overrides,
        model: { mode: "EXPLICIT_NONE" },
        mcp_servers: { mode: "EXPLICIT_NONE" },
        skills: { mode: "EXPLICIT_NONE" },
        egress: null,
      },
      mentions: [],
    });
    expect(bootstrapRequest.operation).toBe("SEMANTIC_BOOTSTRAP_JOB");
    if (bootstrapRequest.operation !== "SEMANTIC_BOOTSTRAP_JOB") {
      throw new TypeError("Expected SEMANTIC_BOOTSTRAP_JOB candidate");
    }
    expect(bootstrapRequest.job_id).toBe(ids.job);
    expect("run_id" in bootstrapRequest).toBe(false);
    expect("bootstrap_candidate_ref" in bootstrapRequest).toBe(false);
    expect(
      runConfigRequestSchema.safeParse({
        ...bootstrapRequest,
        bootstrap_candidate_ref: {
          candidate_id: ids.candidate,
          candidate_revision: 1,
          candidate_hash: H6,
        },
      }).success,
    ).toBe(false);

    const bootstrapBindings = [
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 4,
        effective_resource: resource(ids.datasource, 4, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 7, H5),
        source: "ACTIVE_POINTER" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
    ];

    const bootstrapConfig = {
      schema_version: "semantic-bootstrap-job-config@1.0.0",
      scope: effectiveReceiptDraft().scope,
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      request_hash: bootstrapRequest.request_hash,
      defaults_ref: effectiveReceiptDraft().defaults_ref,
      authority_binding: effectiveReceiptDraft().authority_binding,
      datasource: resource(ids.datasource, 4, H3),
      semantic_release: null,
      schema_snapshot: {
        ...resource(ids.snapshot, 7, H5),
        datasource_id: ids.datasource,
      },
      source_resources: [],
      resource_bindings: bootstrapBindings,
    };
    const resolution = await buildRunConfigResolutionReceiptCandidate({
      schema_version: "run-config-resolution-receipt@1.0.0",
      resolution_id: ids.receipt,
      scope: effectiveReceiptDraft().scope,
      job_id: ids.job,
      trigger_question_run_id: ids.run,
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      request_hash: bootstrapRequest.request_hash,
      defaults_ref: effectiveReceiptDraft().defaults_ref,
      authority_binding: effectiveReceiptDraft().authority_binding,
      resource_bindings: bootstrapBindings,
      optional_selection_evaluations: optionalSelectionEvaluations(
        bootstrapRequest.overrides,
        effectiveReceiptDraft().defaults_ref,
      ),
      resolved_at: "2026-08-16T10:01:00.000Z",
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: bootstrapConfig,
    });
    expect(resolution.operation).toBe("SEMANTIC_BOOTSTRAP_JOB");
    expect(resolution.effective_config_ref).toBeNull();
    expect(runConfigResolutionReceiptCandidateSchema.safeParse(resolution).success).toBe(true);
    expect(
      runConfigResolutionReceiptCandidateSchema.safeParse({
        ...resolution,
        optional_selection_evaluations: resolution.optional_selection_evaluations.slice(0, 3),
      }).success,
    ).toBe(false);
    expect(
      runConfigResolutionReceiptCandidateSchema.safeParse({
        ...resolution,
        optional_selection_evaluations: resolution.optional_selection_evaluations.map(
          (evaluation) =>
            evaluation.resource_kind === "KNOWLEDGE"
              ? { ...evaluation, binding_count: 1 }
              : evaluation,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects Bootstrap inputs the resolver would ignore and forbids semantic authority", async () => {
    const base = {
      schema_version: "run-config-request@1.0.0",
      operation: "SEMANTIC_BOOTSTRAP_JOB",
      workspace_id: ids.workspace,
      job_id: ids.job,
      idempotency_key: "bootstrap:strict",
      defaults_ref: requestDraft.defaults_ref,
      overrides: {
        ...requestDraft.overrides,
        model: { mode: "EXPLICIT_NONE" },
        mcp_servers: { mode: "EXPLICIT_NONE" },
        skills: { mode: "EXPLICIT_NONE" },
        egress: null,
      },
      mentions: [],
    } as const;
    await expect(buildRunConfigRequestCandidate(base)).resolves.toBeDefined();
    await expect(
      buildRunConfigRequestCandidate({
        ...base,
        overrides: { ...base.overrides, model: { mode: "INHERIT_DEFAULT" } },
      }),
    ).rejects.toBeDefined();
    await expect(
      buildRunConfigRequestCandidate({
        ...base,
        mentions: [
          {
            mention_id: ids.mention,
            resource_kind: "MCP_SERVER",
            resource_id: ids.file,
            expected_revision: 1,
          },
        ],
      }),
    ).rejects.toBeDefined();

    const bootstrapBindings = [
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 4,
        effective_resource: resource(ids.datasource, 4, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 7, H5),
        source: "ACTIVE_POINTER" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SEMANTIC_RELEASE" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.semantic, 3, H4),
        source: "ACTIVE_POINTER" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
    ];
    expect(
      bootstrapJobConfigCandidateSchema.safeParse({
        schema_version: "semantic-bootstrap-job-config@1.0.0",
        scope: effectiveReceiptDraft().scope,
        job_id: ids.job,
        operation: "SEMANTIC_BOOTSTRAP_JOB",
        request_hash: H1,
        defaults_ref: effectiveReceiptDraft().defaults_ref,
        authority_binding: effectiveReceiptDraft().authority_binding,
        datasource: resource(ids.datasource, 4, H3),
        semantic_release: null,
        schema_snapshot: {
          ...resource(ids.snapshot, 7, H5),
          datasource_id: ids.datasource,
        },
        source_resources: [],
        resource_bindings: bootstrapBindings,
      }).success,
    ).toBe(false);
  });

  it("closes resolution dependencies and Bootstrap READY resource authority", async () => {
    const base = {
      schema_version: "run-config-resolution-receipt@1.0.0" as const,
      resolution_id: ids.receipt,
      scope: effectiveReceiptDraft().scope,
      run_id: ids.run,
      operation: "QUESTION_RUN" as const,
      conversation_ref: requestDraft.conversation_ref,
      request_hash: H1,
      defaults_ref: effectiveReceiptDraft().defaults_ref,
      authority_binding: effectiveReceiptDraft().authority_binding,
      resolved_at: "2026-08-16T10:01:00.000Z",
      admission: "BLOCKED" as const,
      unavailable_reasons: ["RESOURCE_NOT_FOUND_OR_FORBIDDEN"] as const,
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    };
    const mandatory = effectiveReceiptDraft().resource_bindings;
    const datasourceUnavailable = mandatory.map((binding) =>
      binding.resource_kind === "DATASOURCE"
        ? {
            ...binding,
            effective_resource: null,
            availability: "UNAVAILABLE" as const,
            unavailable_reason: "RESOURCE_NOT_FOUND_OR_FORBIDDEN" as const,
          }
        : binding,
    );
    await expect(
      buildRunConfigResolutionReceiptCandidate({
        ...base,
        resource_bindings: datasourceUnavailable,
      }),
    ).rejects.toBeDefined();

    const semanticUnavailable = mandatory.map((binding) =>
      binding.resource_kind === "SEMANTIC_RELEASE"
        ? {
            ...binding,
            effective_resource: null,
            availability: "UNAVAILABLE" as const,
            unavailable_reason: "RESOURCE_NOT_FOUND_OR_FORBIDDEN" as const,
          }
        : binding,
    );
    await expect(
      buildRunConfigResolutionReceiptCandidate({ ...base, resource_bindings: semanticUnavailable }),
    ).rejects.toBeDefined();
    await expect(
      buildRunConfigResolutionReceiptCandidate({
        ...base,
        resource_bindings: mandatory
          .filter(
            (binding) =>
              binding.resource_kind === "MODEL_PROFILE" ||
              binding.resource_kind === "SEMANTIC_RELEASE",
          )
          .map((binding) =>
            binding.resource_kind === "MODEL_PROFILE"
              ? {
                  ...binding,
                  effective_resource: null,
                  availability: "UNAVAILABLE" as const,
                  unavailable_reason: "MODEL_NOT_AVAILABLE" as const,
                }
              : binding,
          ),
        unavailable_reasons: ["MODEL_NOT_AVAILABLE"],
      }),
    ).rejects.toBeDefined();

    const bootstrapBindings = [
      {
        resource_kind: "DATASOURCE" as const,
        mention_id: null,
        requested_resource_id: ids.datasource,
        requested_revision: 4,
        effective_resource: resource(ids.datasource, 4, H3),
        source: "DEFAULT" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "FILE" as const,
        mention_id: ids.mention,
        requested_resource_id: ids.file,
        requested_revision: 1,
        effective_resource: resource(ids.file, 1, H1),
        source: "MENTION" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
      {
        resource_kind: "SCHEMA_SNAPSHOT" as const,
        mention_id: null,
        requested_resource_id: null,
        requested_revision: null,
        effective_resource: resource(ids.snapshot, 7, H5),
        source: "ACTIVE_POINTER" as const,
        availability: "AVAILABLE" as const,
        unavailable_reason: null,
      },
    ];
    const bootstrapConfig = {
      schema_version: "semantic-bootstrap-job-config@1.0.0" as const,
      scope: effectiveReceiptDraft().scope,
      job_id: ids.job,
      operation: "SEMANTIC_BOOTSTRAP_JOB" as const,
      request_hash: H1,
      defaults_ref: effectiveReceiptDraft().defaults_ref,
      authority_binding: effectiveReceiptDraft().authority_binding,
      datasource: resource(ids.datasource, 4, H3),
      semantic_release: null,
      schema_snapshot: { ...resource(ids.snapshot, 7, H5), datasource_id: ids.datasource },
      source_resources: [
        {
          resource_kind: "FILE" as const,
          mention_id: ids.mention,
          resource_id: ids.file,
          resource_revision: 1,
          resource_hash: H1,
        },
      ],
      resource_bindings: bootstrapBindings,
    };
    expect(bootstrapJobConfigCandidateSchema.safeParse(bootstrapConfig).success).toBe(true);
    expect(
      bootstrapJobConfigCandidateSchema.safeParse({
        ...bootstrapConfig,
        source_resources: [{ ...bootstrapConfig.source_resources[0], resource_hash: H2 }],
      }).success,
    ).toBe(false);
    expect(
      bootstrapJobConfigCandidateSchema.safeParse({
        ...bootstrapConfig,
        resource_bindings: [
          bootstrapBindings[0],
          {
            ...bootstrapBindings[0],
            requested_resource_id: ids.candidate,
            effective_resource: resource(ids.candidate, 4, H3),
          },
          ...bootstrapBindings.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      bootstrapJobConfigCandidateSchema.safeParse({
        ...bootstrapConfig,
        resource_bindings: [
          bootstrapBindings[0],
          {
            resource_kind: "MODEL_PROFILE",
            mention_id: null,
            requested_resource_id: ids.model,
            requested_revision: 1,
            effective_resource: resource(ids.model, 1, H1),
            source: "DEFAULT",
            availability: "AVAILABLE",
            unavailable_reason: null,
          },
          ...bootstrapBindings.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      bootstrapJobConfigCandidateSchema.safeParse({
        ...bootstrapConfig,
        resource_bindings: bootstrapBindings.map((binding) =>
          binding.resource_kind === "FILE"
            ? {
                ...binding,
                effective_resource: null,
                availability: "UNAVAILABLE",
                unavailable_reason: "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
              }
            : binding,
        ),
      }).success,
    ).toBe(false);
  });

  it("permits egress overrides only when every dimension narrows", () => {
    const base = {
      allowed_providers: ["deepseek", "openai"] as const,
      allowed_audiences: ["PRIVATE", "WORKSPACE", "TENANT"] as const,
      classification: "INTERNAL" as const,
    };
    expect(
      resolveNarrowedEgressPolicy(base, {
        allowed_providers: ["deepseek"],
        allowed_audiences: ["PRIVATE", "WORKSPACE"],
        classification: "SECRET",
      }),
    ).toEqual({
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE", "WORKSPACE"],
      classification: "SECRET",
    });
    expect(() =>
      resolveNarrowedEgressPolicy(base, {
        allowed_providers: ["deepseek", "gemini"],
        allowed_audiences: ["PRIVATE"],
        classification: "SECRET",
      }),
    ).toThrow("EGRESS_PROVIDER_DENIED");
    expect(() =>
      resolveNarrowedEgressPolicy(base, {
        allowed_providers: ["deepseek"],
        allowed_audiences: ["EXTERNAL"],
        classification: "SECRET",
      }),
    ).toThrow("EGRESS_AUDIENCE_DENIED");
    expect(() =>
      resolveNarrowedEgressPolicy(base, {
        allowed_providers: ["deepseek"],
        allowed_audiences: ["PRIVATE"],
        classification: "PUBLIC",
      }),
    ).toThrow("POLICY_REJECTED");
  });

  it("binds resource/default/authz/policy/provider/audience changes into the config hash", async () => {
    const draft = effectiveReceiptDraft();
    const baseline = await computeEffectiveRunConfigHash(draft);
    const replaceBinding = (kind: string, effective_resource: ReturnType<typeof resource>) =>
      draft.resource_bindings.map((binding) =>
        binding.resource_kind === kind ? { ...binding, effective_resource } : binding,
      );
    const mutations = [
      {
        ...draft,
        defaults_ref: { ...draft.defaults_ref, defaults_revision: 2 },
        optional_selection_evaluations: draft.optional_selection_evaluations.map((evaluation) =>
          evaluation.selection_mode === "INHERIT_DEFAULT"
            ? {
                ...evaluation,
                defaults_ref: { ...draft.defaults_ref, defaults_revision: 2 },
              }
            : evaluation,
        ),
      },
      { ...draft, authority_binding: { ...draft.authority_binding, authz_epoch: 10 } },
      {
        ...draft,
        optional_selection_evaluations: draft.optional_selection_evaluations.map((evaluation) =>
          evaluation.resource_kind === "KNOWLEDGE"
            ? { ...evaluation, selection_mode: "EXPLICIT_NONE", defaults_ref: null }
            : evaluation,
        ),
      },
      {
        ...draft,
        model: { ...draft.model, resource_hash: H6 },
        resource_bindings: replaceBinding("MODEL_PROFILE", resource(ids.model, 2, H6)),
      },
      {
        ...draft,
        context_policy: { ...draft.context_policy, resource_revision: 3 },
        resource_bindings: replaceBinding("CONTEXT_POLICY", resource(ids.context, 3, H6)),
      },
      {
        ...draft,
        model: { ...draft.model, provider: "openai" },
        egress_policy: { ...draft.egress_policy, allowed_providers: ["openai"] },
        effective_egress: { ...draft.effective_egress, allowed_providers: ["openai"] },
      },
      {
        ...draft,
        effective_egress: { ...draft.effective_egress, allowed_audiences: ["WORKSPACE"] },
      },
    ];
    for (const mutation of mutations) {
      expect(await computeEffectiveRunConfigHash(mutation)).not.toBe(baseline);
    }
  });

  it("freezes only context bindings and rejects resolved context or secret payloads", async () => {
    const configDraft = effectiveReceiptDraft();
    const config_hash = await computeEffectiveRunConfigHash(configDraft);
    const bindingDraft = {
      schema_version: "effective-config-context-receipt@1.0.0",
      receipt_id: ids.receipt,
      outbox_id: ids.receipt,
      command_id: ids.config,
      consumer: "RUN_ACCEPTANCE",
      consumer_id: ids.config,
      attempt_id: null,
      lease_token: null,
      worker_fence: 0,
      scope: configDraft.scope,
      run_id: ids.run,
      config_ref: { config_id: ids.config, config_revision: 1, config_hash },
      semantic_release: configDraft.semantic_release,
      schema_snapshot: configDraft.schema_snapshot,
      context_policy: resource(ids.context, 2, H6),
      provider: "deepseek",
      audiences: ["PRIVATE"],
      classification: "SECRET",
      resource_refs: [resource(ids.file)],
      consumed_at: "2026-08-16T10:01:00.000Z",
    };
    const binding = await buildContextReceiptBindingCandidate(bindingDraft);
    expect(contextReceiptBindingSchema.safeParse(binding).success).toBe(true);
    expect(
      contextReceiptBindingSchema.safeParse({ ...binding, outbox_id: ids.route }).success,
    ).toBe(false);
    expect(
      contextReceiptBindingSchema.safeParse({ ...binding, command_id: ids.candidate }).success,
    ).toBe(false);
    await expect(verifyContextReceiptBindingCandidate(binding)).resolves.toEqual(binding);
    await expect(
      verifyContextReceiptBindingCandidate({ ...binding, provider: "openai" }),
    ).rejects.toThrow("CONTEXT_RECEIPT_HASH_MISMATCH");
    expect(
      contextReceiptBindingSchema.safeParse({ ...binding, retrieved_documents: ["secret"] })
        .success,
    ).toBe(false);
    expect(contextReceiptBindingSchema.safeParse({ ...binding, prompt: "secret" }).success).toBe(
      false,
    );
  });

  it("binds Worker lease correlation fields into the Context Receipt hash", async () => {
    const configDraft = effectiveReceiptDraft();
    const config_hash = await computeEffectiveRunConfigHash(configDraft);
    const worker = await buildContextReceiptBindingCandidate({
      schema_version: "effective-config-context-receipt@1.0.0",
      receipt_id: ids.receipt,
      outbox_id: ids.route,
      command_id: ids.config,
      consumer: "WORKER_START",
      consumer_id: "worker:u2",
      attempt_id: ids.candidate,
      lease_token: 7,
      worker_fence: 3,
      scope: configDraft.scope,
      run_id: ids.run,
      config_ref: { config_id: ids.config, config_revision: 1, config_hash },
      semantic_release: configDraft.semantic_release,
      schema_snapshot: configDraft.schema_snapshot,
      context_policy: resource(ids.context, 2, H6),
      provider: "deepseek",
      audiences: ["PRIVATE"],
      classification: "SECRET",
      resource_refs: [resource(ids.file)],
      consumed_at: "2026-08-16T10:01:00.000Z",
    });
    await expect(
      verifyContextReceiptBindingCandidate({ ...worker, lease_token: 8 }),
    ).rejects.toThrow("CONTEXT_RECEIPT_HASH_MISMATCH");
    await expect(
      verifyContextReceiptBindingCandidate({ ...worker, outbox_id: ids.file }),
    ).rejects.toThrow("CONTEXT_RECEIPT_HASH_MISMATCH");
    await expect(
      verifyContextReceiptBindingCandidate({ ...worker, command_id: ids.candidate }),
    ).rejects.toThrow("CONTEXT_RECEIPT_HASH_MISMATCH");
    expect(
      contextReceiptBindingSchema.safeParse({
        ...worker,
        attempt_id: undefined,
      }).success,
    ).toBe(false);
  });

  it("normalizes U2 authority timestamps to UTC milliseconds before hashing", async () => {
    const defaultsUtc = await buildWorkspaceDefaultsRevisionCandidate(defaultsDraft);
    const defaultsOffset = await buildWorkspaceDefaultsRevisionCandidate({
      ...defaultsDraft,
      created_at: "2026-08-16T18:00:00+08:00",
    });
    expect(defaultsOffset.created_at).toBe("2026-08-16T10:00:00.000Z");
    expect(defaultsOffset.defaults_hash).toBe(defaultsUtc.defaults_hash);

    const configDraft = effectiveReceiptDraft();
    const resolutionBase = {
      schema_version: "run-config-resolution-receipt@1.0.0",
      resolution_id: ids.receipt,
      scope: configDraft.scope,
      run_id: ids.run,
      operation: "QUESTION_RUN",
      conversation_ref: requestDraft.conversation_ref,
      request_hash: H1,
      defaults_ref: configDraft.defaults_ref,
      authority_binding: configDraft.authority_binding,
      resource_bindings: configDraft.resource_bindings,
      optional_selection_evaluations: optionalSelectionEvaluations(
        requestDraft.overrides,
        configDraft.defaults_ref,
      ),
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: H1 },
      required_action: null,
      bootstrap_job_config: null,
    } as const;
    const utc = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase,
      resolved_at: "2026-08-16T10:01:00.000Z",
    });
    const offset = await buildRunConfigResolutionReceiptCandidate({
      ...resolutionBase,
      resolved_at: "2026-08-16T18:01:00+08:00",
    });
    expect(offset.resolved_at).toBe("2026-08-16T10:01:00.000Z");
    expect(offset.resolution_hash).toBe(utc.resolution_hash);
  });

  it("adds a strict QA v2 start envelope around the candidate config request", async () => {
    const config_request = await buildRunConfigRequestCandidate(requestDraft);
    expect(
      qaRunStartInputV2Schema.safeParse({
        schema_version: "qa-run-start@2.0.0",
        question: "本月收入是多少？",
        idempotency_key: requestDraft.idempotency_key,
        config_request,
      }).success,
    ).toBe(true);
    expect(
      qaRunStartInputV2Schema.safeParse({
        schema_version: "qa-run-start@2.0.0",
        question: "本月收入是多少？",
        idempotency_key: "different:key",
        config_request,
      }).success,
    ).toBe(false);
    expect(
      qaRunStartInputV2Schema.safeParse({
        schema_version: "qa-run-start@2.0.0",
        question: "结构解析不能冒充内容哈希校验。",
        idempotency_key: requestDraft.idempotency_key,
        config_request: { ...config_request, request_hash: H6 },
      }).success,
    ).toBe(true);
    await expect(
      verifyRunConfigRequestCandidate({ ...config_request, request_hash: H6 }),
    ).rejects.toThrow("RUN_CONFIG_REQUEST_HASH_MISMATCH");
  });

  it("freezes READY/BLOCKED/BOOTSTRAP_REQUIRED resolution branches and stable reasons", async () => {
    expect(runConfigUnavailableReasonSchema.options).toEqual([
      "EXPLICITLY_CLEARED",
      "DEFAULT_NOT_CONFIGURED",
      "DEFAULT_REMOVED",
      "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
      "RESOURCE_DISABLED",
      "RESOURCE_REVISION_MISMATCH",
      "RESOURCE_REVOKED",
      "RESOURCE_KIND_MISMATCH",
      "MODEL_NOT_AVAILABLE",
      "SEMANTIC_RELEASE_NOT_PUBLISHED",
      "SCHEMA_SNAPSHOT_STALE",
      "POLICY_REJECTED",
      "EGRESS_PROVIDER_DENIED",
      "EGRESS_AUDIENCE_DENIED",
      "MENTION_RESOURCE_ID_REQUIRED",
    ]);
    const base = {
      schema_version: "run-config-resolution-receipt@1.0.0",
      resolution_id: ids.receipt,
      scope: effectiveReceiptDraft().scope,
      run_id: ids.run,
      operation: "QUESTION_RUN",
      conversation_ref: requestDraft.conversation_ref,
      request_hash: H1,
      defaults_ref: effectiveReceiptDraft().defaults_ref,
      authority_binding: effectiveReceiptDraft().authority_binding,
      resource_bindings: effectiveReceiptDraft().resource_bindings,
      optional_selection_evaluations: optionalSelectionEvaluations(
        requestDraft.overrides,
        effectiveReceiptDraft().defaults_ref,
      ),
      resolved_at: "2026-08-16T10:01:00.000Z",
    };
    const unavailableBindings = (
      kind: string,
      unavailable_reason: "RESOURCE_NOT_FOUND_OR_FORBIDDEN" | "SEMANTIC_RELEASE_NOT_PUBLISHED",
    ) =>
      base.resource_bindings.map((binding) =>
        binding.resource_kind === kind
          ? {
              ...binding,
              effective_resource: null,
              availability: "UNAVAILABLE" as const,
              unavailable_reason,
            }
          : binding,
      );
    const ready = await buildRunConfigResolutionReceiptCandidate({
      ...base,
      admission: "READY",
      unavailable_reasons: [],
      effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: H1 },
      required_action: null,
      bootstrap_job_config: null,
    });
    expect(runConfigResolutionReceiptCandidateSchema.safeParse(ready).success).toBe(true);
    await expect(verifyRunConfigResolutionReceiptCandidate(ready)).resolves.toEqual(ready);
    await expect(
      verifyRunConfigResolutionReceiptCandidate({
        ...ready,
        authority_binding: { ...ready.authority_binding, authz_epoch: 99 },
      }),
    ).rejects.toThrow("RUN_CONFIG_RESOLUTION_HASH_MISMATCH");

    const blocked = await buildRunConfigResolutionReceiptCandidate({
      ...base,
      resource_bindings: unavailableBindings(
        "DATASOURCE",
        "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
      ).filter(
        (binding) =>
          binding.resource_kind !== "SEMANTIC_RELEASE" &&
          binding.resource_kind !== "SCHEMA_SNAPSHOT",
      ),
      admission: "BLOCKED",
      unavailable_reasons: ["RESOURCE_NOT_FOUND_OR_FORBIDDEN"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    expect(runConfigResolutionReceiptCandidateSchema.safeParse(blocked).success).toBe(true);
    const datasourceBinding = base.resource_bindings.find(
      (binding) => binding.resource_kind === "DATASOURCE",
    );
    const modelBinding = base.resource_bindings.find(
      (binding) => binding.resource_kind === "MODEL_PROFILE",
    );
    if (!datasourceBinding || !modelBinding) throw new TypeError("mandatory fixture missing");
    const partialBlocked = await buildRunConfigResolutionReceiptCandidate({
      ...base,
      resource_bindings: [
        datasourceBinding,
        {
          ...modelBinding,
          effective_resource: null,
          availability: "UNAVAILABLE",
          unavailable_reason: "MODEL_NOT_AVAILABLE",
        },
      ],
      admission: "BLOCKED",
      unavailable_reasons: ["MODEL_NOT_AVAILABLE"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    expect(partialBlocked.unavailable_reasons).toEqual(["MODEL_NOT_AVAILABLE"]);
    await expect(
      buildRunConfigResolutionReceiptCandidate({
        ...base,
        resource_bindings: [
          {
            ...datasourceBinding,
            effective_resource: null,
            availability: "UNAVAILABLE",
            unavailable_reason: "MODEL_NOT_AVAILABLE",
          },
        ],
        admission: "BLOCKED",
        unavailable_reasons: ["MODEL_NOT_AVAILABLE"],
        effective_config_ref: null,
        required_action: null,
        bootstrap_job_config: null,
      }),
    ).rejects.toBeDefined();
    await expect(
      buildRunConfigResolutionReceiptCandidate({
        ...base,
        resource_bindings: unavailableBindings(
          "SEMANTIC_RELEASE",
          "SEMANTIC_RELEASE_NOT_PUBLISHED",
        ),
        admission: "BLOCKED",
        unavailable_reasons: ["SEMANTIC_RELEASE_NOT_PUBLISHED"],
        effective_config_ref: null,
        required_action: null,
        bootstrap_job_config: null,
      }),
    ).rejects.toBeDefined();

    const bootstrapRequired = await buildRunConfigResolutionReceiptCandidate({
      ...base,
      resource_bindings: unavailableBindings(
        "SEMANTIC_RELEASE",
        "SEMANTIC_RELEASE_NOT_PUBLISHED",
      ).filter((binding) => binding.resource_kind !== "SCHEMA_SNAPSHOT"),
      admission: "BOOTSTRAP_REQUIRED",
      unavailable_reasons: ["SEMANTIC_RELEASE_NOT_PUBLISHED"],
      effective_config_ref: null,
      required_action: "SEMANTIC_BOOTSTRAP",
      bootstrap_job_config: null,
    });
    expect(runConfigResolutionReceiptCandidateSchema.safeParse(bootstrapRequired).success).toBe(
      true,
    );
    expect(bootstrapRequired.effective_config_ref).toBeNull();

    expect(bootstrapRequired.bootstrap_job_config).toBeNull();

    const semanticAndFileUnavailable = unavailableBindings(
      "SEMANTIC_RELEASE",
      "SEMANTIC_RELEASE_NOT_PUBLISHED",
    )
      .filter((binding) => binding.resource_kind !== "SCHEMA_SNAPSHOT")
      .map((binding) =>
        binding.resource_kind === "FILE"
          ? {
              ...binding,
              effective_resource: null,
              availability: "UNAVAILABLE" as const,
              unavailable_reason: "RESOURCE_NOT_FOUND_OR_FORBIDDEN" as const,
            }
          : binding,
      );
    const blockedBootstrapWithMissingMention = await buildRunConfigResolutionReceiptCandidate({
      ...base,
      resource_bindings: semanticAndFileUnavailable,
      admission: "BLOCKED",
      unavailable_reasons: ["RESOURCE_NOT_FOUND_OR_FORBIDDEN", "SEMANTIC_RELEASE_NOT_PUBLISHED"],
      effective_config_ref: null,
      required_action: null,
      bootstrap_job_config: null,
    });
    expect(blockedBootstrapWithMissingMention.admission).toBe("BLOCKED");
    await expect(
      buildRunConfigResolutionReceiptCandidate({
        ...base,
        resource_bindings: semanticAndFileUnavailable,
        admission: "BOOTSTRAP_REQUIRED",
        unavailable_reasons: ["RESOURCE_NOT_FOUND_OR_FORBIDDEN", "SEMANTIC_RELEASE_NOT_PUBLISHED"],
        effective_config_ref: null,
        required_action: "SEMANTIC_BOOTSTRAP",
        bootstrap_job_config: null,
      }),
    ).rejects.toBeDefined();

    await expect(
      buildRunConfigResolutionReceiptCandidate({
        ...base,
        admission: "READY",
        unavailable_reasons: ["MODEL_NOT_AVAILABLE"],
        effective_config_ref: null,
        required_action: null,
        bootstrap_job_config: null,
      }),
    ).rejects.toBeDefined();
  });
});
