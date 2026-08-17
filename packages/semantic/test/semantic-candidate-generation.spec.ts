import {
  type AppScope,
  type AuthoritativeModelProviderInvocation,
  authorizeAvailableModelProfile,
  computeModelProfileHash,
  computeSemanticChangeProposalDigest,
  type ModelProfile,
  type ModelProviderPort,
  type PhysicalSchemaSnapshot,
  type SemanticCandidateOperation,
  type SemanticChangeProposal,
  semanticChangeProposalSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  buildAgentSemanticCandidateDraft,
  buildPhysicalSchemaEvidence,
  buildSchemaFeaturePacket,
  runSemanticCandidateAgent,
  validateSemanticChangeProposal,
} from "../src/candidate-generation/index.js";

const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
const id3 = "00000000-0000-4000-8000-000000000003";
const hash = `sha256:${"a".repeat(64)}` as const;

function snapshot(reverse = false): PhysicalSchemaSnapshot {
  const columns = [
    {
      column_name: "id",
      ordinal_position: 1,
      formatted_type: "bigint",
      type_identity: {
        type_schema: "pg_catalog",
        type_name: "int8",
        type_kind: "BASE" as const,
        array_dimensions: 0,
      },
      nullable: false,
      default_expression: null,
      identity_generation: null,
      generated_expression: null,
      comment: "订单标识",
    },
    {
      column_name: "customer_id",
      ordinal_position: 2,
      formatted_type: "bigint",
      type_identity: {
        type_schema: "pg_catalog",
        type_name: "int8",
        type_kind: "BASE" as const,
        array_dimensions: 0,
      },
      nullable: false,
      default_expression: null,
      identity_generation: null,
      generated_expression: null,
      comment: null,
    },
  ];
  return {
    schema_version: "physical-schema-snapshot@1.0.0",
    snapshot_id: id1,
    scan_run_id: id2,
    snapshot_content_hash: hash,
    captured_at: "2026-08-11T00:00:00Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: "warehouse",
      datasource_fingerprint: hash,
      engine: "postgresql",
      engine_version: { major: 16, minor: 4 },
      database_identity: { database_name: "analytics", database_oid: 16_384 },
      included_schemas: ["public"],
      relations: [
        {
          identity: { schema_name: "public", relation_name: "orders" },
          relation_kind: "TABLE",
          comment: "订单事实表",
          columns: reverse ? [...columns].reverse() : columns,
          primary_key: {
            constraint_name: "orders_pkey",
            columns: ["id"],
            deferrable: false,
            initially_deferred: false,
          },
          foreign_keys: [],
          unique_constraints: [],
          check_constraints: [],
          indexes: [],
        },
      ],
    },
  };
}

const scope = {
  app_id: id1,
  tenant_id: id2,
  environment: "development",
  semantic_domain: "commerce",
} as const;

async function availableProfile() {
  const appScope: AppScope = {
    app_id: scope.app_id,
    tenant_id: scope.tenant_id,
    environment: scope.environment,
  };
  const receiptRef = {
    artifact_id: id3,
    artifact_type: "ModelCertificationReceipt" as const,
    ...appScope,
    run_id: id1,
    revision: 1,
    content_hash: hash,
  };
  const profile = {
    profile_id: id3,
    scope: appScope,
    provider: "openai",
    model_id: "fixture-model",
    profile_version: "1.0.0",
    capabilities: {
      structured_output: true,
      tool_calling: false,
      streaming: true,
      reasoning: false,
      vision: false,
    },
    operational_constraints: {
      context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: 64_000,
        max_output_tokens: 4_096,
      },
      region_privacy: { verification_status: "UNVERIFIED" },
      pricing: { verification_status: "UNVERIFIED" },
      fallback_compatibility: { verification_status: "UNVERIFIED" },
    },
    certification_status: "AVAILABLE",
    certification_receipt_ref: receiptRef,
    certified_model_id: "fixture-model",
  } as const satisfies ModelProfile;
  const profileHash = await computeModelProfileHash(profile);
  return authorizeAvailableModelProfile(profile, {
    verifyCommitted: async () => true,
    resolve: async (reference) => ({
      schema_version: "1.0.0",
      receipt_ref: reference,
      profile_id: profile.profile_id,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      probe_hash: hash,
      verdict: "PASS",
    }),
  });
}

function completedPort(output: string): ModelProviderPort {
  return {
    async *stream(request: AuthoritativeModelProviderInvocation) {
      yield {
        schema_version: "1.0.0",
        request_id: request.request_id,
        attempt_id: request.attempt_id,
        scope: request.scope,
        run_id: request.run_id,
        provider: request.provider,
        profile_id: request.profile_id,
        profile_version: request.profile_version,
        model_id: request.model_id,
        sequence: 0,
        observed_at: "2026-08-11T00:00:00Z",
        event_type: "COMPLETED",
        output_text: output,
        response_hash: hash,
        usage: {
          availability: "AVAILABLE",
          source: "PROVIDER_REPORTED",
          input_tokens: 100,
          output_tokens: 50,
          tool_calls: 0,
          unavailable_reason: null,
        },
      };
    },
  };
}

function entityOperation(action: "CREATE" | "MARK_STALE" = "CREATE"): SemanticCandidateOperation {
  return {
    schema_version: "semantic-candidate-operation@1.0.0",
    operation_id: id3,
    action,
    target_type: "BUSINESS_ENTITY_TYPE",
    target_id: "order",
    payload:
      action === "MARK_STALE"
        ? null
        : {
            entity_id: "order",
            name: "订单",
            aliases: ["Order"],
            domain: "commerce",
            owner: "data-platform",
            lifecycle: "active",
            business_relationship_types: [],
          },
    evidence_refs: ["placeholder"],
    field_evidence: { name: ["placeholder"] },
    confidence: 0.93,
    assumptions: [],
    open_questions: [],
    impact: {
      risk_level: "LOW",
      affected_object_ids: ["order"],
      summary: "订单实体候选。",
    },
  };
}

async function proposalWith(operation: SemanticCandidateOperation): Promise<{
  proposal: SemanticChangeProposal;
  packet: Awaited<ReturnType<typeof buildSchemaFeaturePacket>>;
}> {
  const packet = await buildSchemaFeaturePacket({
    scope,
    snapshot: snapshot(),
    drift: null,
    base_release: null,
  });
  const evidence = buildPhysicalSchemaEvidence(packet);
  const firstEvidence = evidence[0];
  if (!firstEvidence) throw new Error("fixture evidence missing");
  const evidenceId = firstEvidence.evidence_id;
  const material = {
    schema_version: "semantic-change-proposal@1.0.0" as const,
    compile_run_id: id1,
    source_revision_id: id2,
    feature_digest: packet.feature_digest,
    snapshot_id: packet.snapshot_id,
    snapshot_digest: packet.snapshot_digest,
    drift_event_id: null,
    drift_digest: null,
    base_release: null,
    agent_receipt: {
      provider_id: "openai",
      model_id: "gpt-5",
      model_profile_digest: hash,
      prompt_digest: hash,
      tool_policy_digest: hash,
      compiler_digest: hash,
      candidate_policy_digest: hash,
    },
    evidence: [firstEvidence],
    operations: [
      {
        ...operation,
        evidence_refs: [evidenceId],
        field_evidence: { name: [evidenceId] },
      },
    ],
    summary: "从物理模式生成订单语义候选。",
  };
  const proposal = semanticChangeProposalSchema.parse({
    ...material,
    proposal_digest: await computeSemanticChangeProposalDigest(material),
  });
  return { proposal, packet };
}

describe("semantic candidate generation kernel", () => {
  it("builds the same feature digest for the same unordered snapshot content", async () => {
    const first = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(),
      drift: null,
      base_release: null,
    });
    const second = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(true),
      drift: null,
      base_release: null,
    });
    expect(first.feature_digest).toBe(second.feature_digest);
    expect(first.features.map((feature) => feature.feature_id)).toEqual(
      second.features.map((feature) => feature.feature_id),
    );
  });

  it("accepts a fully bound typed proposal", async () => {
    const { proposal, packet } = await proposalWith(entityOperation());
    expect(await validateSemanticChangeProposal(proposal, packet)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects a physical relationship that lacks FK evidence", async () => {
    const relationship: SemanticCandidateOperation = {
      ...entityOperation(),
      target_type: "RELATIONSHIP",
      target_id: "orders_customer",
      payload: {
        relationship_id: "orders_customer",
        name: "订单客户",
        kind: "physical",
        left_table_id: "orders",
        left_column_ids: ["customer_id"],
        right_table_id: "customers",
        right_column_ids: ["id"],
        cardinality: "many-to-one",
        left_row_preservation: "required",
        right_row_preservation: "optional",
        proof_kind: "DDL_ENFORCED",
        proof_detail: "猜测的外键",
        tags: [],
      },
    };
    const { proposal, packet } = await proposalWith(relationship);
    const result = await validateSemanticChangeProposal(proposal, packet);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("PHYSICAL_RELATIONSHIP_WITHOUT_FK");
  });

  it("reduces removal intent to a visible stale modification, never DELETE", async () => {
    const { proposal } = await proposalWith(entityOperation("MARK_STALE"));
    const draft = buildAgentSemanticCandidateDraft({
      proposal,
      semantic_domain: "commerce",
      idempotency_key: id3,
      selected_operation_ids: [id3],
    });
    expect(draft.diff.operations[0]?.change_type).toBe("MODIFY");
    expect(draft.diff.operations[0]?.after).toEqual({ target_id: "order", state: "STALE" });
    expect(draft.source_payload.source_kind).toBe("AGENT");
  });

  it("assembles authority fields around a valid structured model output", async () => {
    const packet = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(),
      drift: null,
      base_release: null,
    });
    const evidenceId = buildPhysicalSchemaEvidence(packet)[0]?.evidence_id;
    if (!evidenceId) throw new Error("fixture evidence missing");
    const operation = {
      ...entityOperation(),
      evidence_refs: [evidenceId],
      field_evidence: { name: [evidenceId] },
    };
    const result = await runSemanticCandidateAgent({
      profile: await availableProfile(),
      model_provider: completedPort(
        JSON.stringify({
          schema_version: "semantic-agent-candidate-output@1.0.0",
          operations: [operation],
          summary: "订单实体候选。",
        }),
      ),
      packet,
      compile_run_id: id1,
      source_revision_id: id2,
      request_id: id2,
      attempt_id: id3,
      budget: { timeout_ms: 1_000, max_input_tokens: 32_000, max_output_tokens: 4_096 },
    });
    expect(result.terminal).toBe("COMPILED");
    expect(result.proposal).toMatchObject({
      compile_run_id: id1,
      source_revision_id: id2,
      snapshot_id: packet.snapshot_id,
      operations: [{ target_id: "order" }],
    });
  });

  it("fails closed when a provider emits a tool call", async () => {
    const packet = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(),
      drift: null,
      base_release: null,
    });
    const modelProvider: ModelProviderPort = {
      async *stream(request) {
        yield {
          schema_version: "1.0.0",
          request_id: request.request_id,
          attempt_id: request.attempt_id,
          scope: request.scope,
          run_id: request.run_id,
          provider: request.provider,
          profile_id: request.profile_id,
          profile_version: request.profile_version,
          model_id: request.model_id,
          sequence: 0,
          observed_at: "2026-08-11T00:00:00Z",
          event_type: "TOOL_CALL_CANDIDATE",
          tool_call_id: "forbidden-call",
          tool_name: "network-fetch@1",
          arguments: {},
        };
      },
    };
    const result = await runSemanticCandidateAgent({
      profile: await availableProfile(),
      model_provider: modelProvider,
      packet,
      compile_run_id: id1,
      source_revision_id: id2,
      request_id: id2,
      attempt_id: id3,
      budget: { timeout_ms: 1_000, max_input_tokens: 32_000, max_output_tokens: 4_096 },
    });
    expect(result).toMatchObject({
      terminal: "INVALID_OUTPUT",
      proposal: null,
      failure_code: "MODEL_TOOL_OUTPUT_FORBIDDEN",
    });
  });

  it("fails closed on non-JSON model output", async () => {
    const packet = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(),
      drift: null,
      base_release: null,
    });
    const result = await runSemanticCandidateAgent({
      profile: await availableProfile(),
      model_provider: completedPort("not-json"),
      packet,
      compile_run_id: id1,
      source_revision_id: id2,
      request_id: id2,
      attempt_id: id3,
      budget: { timeout_ms: 1_000, max_input_tokens: 32_000, max_output_tokens: 4_096 },
    });
    expect(result).toMatchObject({
      terminal: "INVALID_OUTPUT",
      proposal: null,
      failure_code: "MODEL_OUTPUT_NOT_JSON",
    });
  });

  it("maps an explicit provider timeout to a stable timeout terminal", async () => {
    const packet = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(),
      drift: null,
      base_release: null,
    });
    const modelProvider: ModelProviderPort = {
      async *stream(request) {
        yield {
          schema_version: "1.0.0",
          request_id: request.request_id,
          attempt_id: request.attempt_id,
          scope: request.scope,
          run_id: request.run_id,
          provider: request.provider,
          profile_id: request.profile_id,
          profile_version: request.profile_version,
          model_id: request.model_id,
          sequence: 0,
          observed_at: "2026-08-11T00:00:00Z",
          event_type: "FAILED",
          reason_code: "MODEL_TIMEOUT",
          retryable: true,
          delivery_certainty: "NOT_DISPATCHED",
        };
      },
    };
    const result = await runSemanticCandidateAgent({
      profile: await availableProfile(),
      model_provider: modelProvider,
      packet,
      compile_run_id: id1,
      source_revision_id: id2,
      request_id: id2,
      attempt_id: id3,
      budget: { timeout_ms: 1_000, max_input_tokens: 32_000, max_output_tokens: 4_096 },
    });
    expect(result).toMatchObject({
      terminal: "TIMEOUT",
      proposal: null,
      failure_code: "MODEL_TIMEOUT",
    });
  });

  it("redacts a thrown provider failure into a stable unavailable terminal", async () => {
    const packet = await buildSchemaFeaturePacket({
      scope,
      snapshot: snapshot(),
      drift: null,
      base_release: null,
    });
    const modelProvider: ModelProviderPort = {
      stream() {
        const iterator: AsyncIterableIterator<never> = {
          [Symbol.asyncIterator]() {
            return iterator;
          },
          async next(): Promise<IteratorResult<never>> {
            throw new Error("api_key=raw-secret host=provider.internal");
          },
        };
        return iterator;
      },
    };
    const result = await runSemanticCandidateAgent({
      profile: await availableProfile(),
      model_provider: modelProvider,
      packet,
      compile_run_id: id1,
      source_revision_id: id2,
      request_id: id2,
      attempt_id: id3,
      budget: { timeout_ms: 1_000, max_input_tokens: 32_000, max_output_tokens: 4_096 },
    });
    expect(result).toMatchObject({
      terminal: "AGENT_UNAVAILABLE",
      proposal: null,
      failure_code: "MODEL_PROVIDER_STREAM_FAILED",
    });
  });
});
