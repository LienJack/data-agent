import {
  type ArtifactReference,
  type AuthoritativeMetamorphicOracleReceipt,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeGroundingAuthorityDocumentHash,
  computeL2ArtifactContentHash,
  type GroundingAuthorityDocument,
  groundingAuthorityDocumentSchema,
  isAuthoritativeMetamorphicFixtureReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
  L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES,
  L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  type L2ArtifactDocument,
  l2ArtifactDocumentSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  createAuthoritativeMetamorphicSandboxFixture,
  createMetamorphicOracleFixture,
} from "../../../text2sql/test/support/metamorphic-oracle-fixture.js";
import {
  createPostgresRepository,
  createText2SqlBrandedReceiptAuthorityContext,
  type PostgresRepositoryAuthorities,
} from "../../src/persistence/repository.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  run: "00000000-0000-4000-8000-000000000201",
  command: "00000000-0000-4000-8000-000000000301",
  event: "00000000-0000-4000-8000-000000000401",
  outbox: "00000000-0000-4000-8000-000000000501",
  browserOutbox: "00000000-0000-4000-8000-000000000502",
  audit: "00000000-0000-4000-8000-000000000601",
  deployment: "00000000-0000-4000-8000-0000000000d1",
};
const canonicalPayloadHash = `sha256:${"a".repeat(64)}`;

void ({
  // @ts-expect-error Fixture Authority 必须返回不可克隆品牌对象，不能注入 boolean 自证。
  verifyMetamorphicFixtureReceipt: async () => true,
} satisfies PostgresRepositoryAuthorities);

void ({
  // @ts-expect-error Meta Authority 必须按完整 Reference 返回品牌对象，不能注入 boolean 自证。
  verifyMetamorphicOracleReceipt: async () => true,
} satisfies PostgresRepositoryAuthorities);

void ({
  // @ts-expect-error Result Authority 不能退回 raw Receipt + boolean 的旧式自证接口。
  verifyResultOracleReceipt: async () => true,
} satisfies PostgresRepositoryAuthorities);

void ({
  // @ts-expect-error Sandbox Authority 不能退回 raw Receipt/Result + boolean 的旧式自证接口。
  verifySandboxExecutionEvidence: async () => true,
} satisfies PostgresRepositoryAuthorities);

function issueCapability(role: "OWNER" | "ANALYST" | "VIEWER" = "ANALYST") {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role,
      },
    ],
  );
  const result = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!result.ok) throw new Error("Capability fixture 创建失败。");
  return {
    capability: result.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function issueCapabilityForReference(reference: ArtifactReference, principal: string) {
  const registry = createDeploymentRegistry(
    [
      {
        deployment_id: ids.deployment,
        app_id: reference.app_id,
        environment: reference.environment,
      },
    ],
    [
      {
        subject: principal,
        deployment_id: ids.deployment,
        tenant_id: reference.tenant_id,
        role: "ANALYST",
      },
    ],
  );
  const result = registry.resolveForDeployment(ids.deployment, { subject: principal });
  if (!result.ok) throw new Error("Authoritative Ready fixture Capability 创建失败。");
  return {
    capability: result.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function scriptedPool(
  handle: (
    text: string,
    values: readonly unknown[],
  ) => SqlQueryResult | undefined | Promise<SqlQueryResult | undefined>,
) {
  const calls: QueryCall[] = [];
  let released = 0;
  let connections = 0;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      const handled = await handle(text, values);
      if (handled) return handled as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("platform.canonical_sha256")) {
        return {
          rows: [{ payload_hash: canonicalPayloadHash }],
          rowCount: 1,
        } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {
      released += 1;
    },
  };
  const pool: SqlPool = {
    connect: async () => {
      connections += 1;
      return client;
    },
  };
  return { calls, pool, released: () => released, connections: () => connections };
}

function commandInput() {
  return {
    run_id: ids.run,
    command_id: ids.command,
    event_id: ids.event,
    outbox_id: ids.outbox,
    audit_id: ids.audit,
    idempotency_key: "request-1",
    question: "华南区净收入同比为什么下降？",
    payload: {
      kind: "START_L2_RESEARCH",
      question_version: "v1",
      secret_refs: ["secretref:00000000-0000-4000-8000-000000000801"],
    },
  };
}

async function createBrandedMetamorphicReceiptFixture() {
  const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
  const oracle = await createMetamorphicOracleFixture({
    sandbox_fixture: sandbox,
    evaluated_at: "2026-07-26T00:30:00.000Z",
  });
  const verification = await oracle.verifier.verify(oracle.receipt.receipt_ref);
  if (!verification) {
    throw new Error("Metamorphic test fixture 未获得真实 Fixture/Meta 品牌。");
  }
  return verification;
}

async function committedDocument(input: {
  readonly artifact_id: string;
  readonly artifact_type: "QuestionFrame" | "ExecutionReceipt";
  readonly revision?: number;
  readonly parent_ref?: Record<string, unknown> | null;
  readonly input_refs?: readonly Record<string, unknown>[];
  readonly payload: Record<string, unknown>;
}): Promise<L2ArtifactDocument> {
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: {
      artifact_id: input.artifact_id,
      artifact_type: input.artifact_type,
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      revision: input.revision ?? 1,
      parent_ref: input.parent_ref ?? null,
      attempt_id: "00000000-0000-4000-8000-000000000901",
      producer: { kind: "deterministic", id: "platform-test" },
      input_refs: input.input_refs ?? [],
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "1.0.0",
      model_profile_version: "test",
      content_hash: `sha256:${"0".repeat(64)}`,
      status: "COMMITTED",
      created_at: "2026-07-25T00:00:00.000Z",
    },
    payload: input.payload,
  });
  return l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ArtifactContentHash(draft),
    },
  });
}

function l2CommitAuthoritiesFor(
  ...documents: readonly L2ArtifactDocument[]
): PostgresRepositoryAuthorities {
  return {
    verifyL2ArtifactCommitterCapability: async (claim, capability) =>
      capability.principal === ids.principal &&
      claim.app_id === capability.scope.app_id &&
      claim.tenant_id === capability.scope.tenant_id &&
      claim.environment === capability.scope.environment &&
      documents.some(
        ({ envelope }) =>
          claim.run_id === envelope.run_id &&
          claim.attempt_id === envelope.attempt_id &&
          claim.artifact_type === envelope.artifact_type &&
          claim.producer_id === envelope.producer.id &&
          claim.policy_version === envelope.policy_version,
      ),
  };
}

async function groundingAuthorityDocument(
  overrides: Readonly<{
    artifact_id?: string;
    revision?: number;
    parent_ref?: Record<string, unknown> | null;
    catalog_version?: string;
    metric_alias?: string;
    producer_id?: string;
    authority_id?: string;
    authority_policy_version?: string;
  }> = {},
): Promise<GroundingAuthorityDocument> {
  const artifactReference = {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test" as const,
    run_id: ids.run,
    artifact_id: overrides.artifact_id ?? "00000000-0000-4000-8000-000000000731",
    artifact_type: "SemanticRelease" as const,
    revision: overrides.revision ?? 1,
    content_hash: `sha256:${"0".repeat(64)}` as const,
  };
  const draft = groundingAuthorityDocumentSchema.parse({
    schema_version: "data-agent-grounding-authority/v1",
    artifact_type: "SemanticRelease",
    artifact_ref: artifactReference,
    scope: {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
    },
    origin: { origin: "fixture", fixture_version: "test-fixture@1.0.0" },
    run_id: ids.run,
    parent_ref: overrides.parent_ref ?? null,
    producer: {
      kind: "deterministic",
      id: overrides.producer_id ?? "grounding-registry",
    },
    authority: {
      kind: "deterministic",
      id: overrides.authority_id ?? "grounding-authority",
      policy_version: overrides.authority_policy_version ?? "grounding-authority@1.0.0",
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: artifactReference.content_hash,
    semantic_release_version: "commerce-semantic@1.0.0",
    catalog_version: overrides.catalog_version ?? "commerce-catalog@1.0.0",
    datasource_id: ids.app,
    metrics: [
      {
        metric_id: "metric.net_revenue",
        aliases: [overrides.metric_alias ?? "净收入"],
        table_id: "orders",
        column_id: "orders.net_amount",
        aggregation: "sum",
        grain: "order",
        unit: "CNY",
        time_column_id: "orders.created_at",
        additivity: "additive",
        null_policy: "coalesce-zero",
        dependency_column_ids: ["orders.net_amount"],
        fanout_policy: "preaggregate",
      },
    ],
    dimensions: [],
  });
  const documentHash = await computeGroundingAuthorityDocumentHash(draft);
  return groundingAuthorityDocumentSchema.parse({
    ...draft,
    artifact_ref: {
      ...draft.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  });
}

async function schemaSnapshotDocument(
  overrides: Readonly<{
    catalog_version?: string;
    producer_id?: string;
    authority_id?: string;
    authority_policy_version?: string;
  }> = {},
): Promise<Extract<GroundingAuthorityDocument, { artifact_type: "SchemaSnapshot" }>> {
  const artifactReference = {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test" as const,
    run_id: ids.run,
    artifact_id: "00000000-0000-4000-8000-000000000734",
    artifact_type: "SchemaSnapshot" as const,
    revision: 1,
    content_hash: `sha256:${"0".repeat(64)}` as const,
  };
  const draft = groundingAuthorityDocumentSchema.parse({
    schema_version: "data-agent-grounding-authority/v1",
    artifact_type: "SchemaSnapshot",
    artifact_ref: artifactReference,
    scope: {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
    },
    origin: { origin: "fixture", fixture_version: "test-fixture@1.0.0" },
    run_id: ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic",
      id: overrides.producer_id ?? "grounding-registry",
    },
    authority: {
      kind: "deterministic",
      id: overrides.authority_id ?? "grounding-authority",
      policy_version: overrides.authority_policy_version ?? "grounding-authority@1.0.0",
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: artifactReference.content_hash,
    schema_snapshot_version: "commerce-schema@1.0.0",
    catalog_version: overrides.catalog_version ?? "commerce-catalog@1.0.0",
    datasource_id: ids.app,
    tables: [
      {
        table_id: "orders",
        physical_name: "orders",
        columns: [
          {
            column_id: "orders.tenant_id",
            physical_name: "tenant_id",
            data_type: "uuid",
            nullable: false,
            sensitivity: "INTERNAL",
          },
          {
            column_id: "orders.net_amount",
            physical_name: "net_amount",
            data_type: "numeric",
            nullable: true,
            sensitivity: "INTERNAL",
          },
          {
            column_id: "orders.created_at",
            physical_name: "created_at",
            data_type: "timestamptz",
            nullable: false,
            sensitivity: "INTERNAL",
          },
        ],
      },
    ],
    relationships: [],
  });
  const documentHash = await computeGroundingAuthorityDocumentHash(draft);
  return groundingAuthorityDocumentSchema.parse({
    ...draft,
    artifact_ref: {
      ...draft.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  }) as Extract<GroundingAuthorityDocument, { artifact_type: "SchemaSnapshot" }>;
}

async function policyReceiptDocument(
  principalId: string,
  overrides: Readonly<{
    producer_id?: string;
    authority_id?: string;
    authority_policy_version?: string;
    semantic_release_ref?: Extract<
      GroundingAuthorityDocument,
      { artifact_type: "SemanticRelease" }
    >["artifact_ref"];
    schema_snapshot_ref?: Extract<
      GroundingAuthorityDocument,
      { artifact_type: "SchemaSnapshot" }
    >["artifact_ref"];
  }> = {},
): Promise<GroundingAuthorityDocument> {
  const artifactReference = {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test" as const,
    run_id: ids.run,
    artifact_id: "00000000-0000-4000-8000-000000000735",
    artifact_type: "PolicyReceipt" as const,
    revision: 1,
    content_hash: `sha256:${"0".repeat(64)}` as const,
  };
  const policyVersion = "default-policy@1.0.0";
  const draft = groundingAuthorityDocumentSchema.parse({
    schema_version: "data-agent-grounding-authority/v1",
    artifact_type: "PolicyReceipt",
    artifact_ref: artifactReference,
    scope: {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
    },
    origin: { origin: "fixture", fixture_version: "test-fixture@1.0.0" },
    run_id: ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic",
      id: overrides.producer_id ?? "grounding-registry",
    },
    authority: {
      kind: "deterministic",
      id: overrides.authority_id ?? "policy-authority",
      policy_version: overrides.authority_policy_version ?? policyVersion,
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: artifactReference.content_hash,
    policy_version: policyVersion,
    datasource_id: ids.app,
    principal_id: principalId,
    semantic_release_ref:
      overrides.semantic_release_ref ??
      ({
        ...artifactReference,
        artifact_id: "00000000-0000-4000-8000-000000000731",
        artifact_type: "SemanticRelease",
        content_hash: `sha256:${"a".repeat(64)}`,
      } as const),
    schema_snapshot_ref:
      overrides.schema_snapshot_ref ??
      ({
        ...artifactReference,
        artifact_id: "00000000-0000-4000-8000-000000000734",
        artifact_type: "SchemaSnapshot",
        content_hash: `sha256:${"b".repeat(64)}`,
      } as const),
    allowed_schema: {
      tables: [
        {
          table_id: "orders",
          column_ids: ["orders.tenant_id"],
        },
      ],
    },
    mandatory_predicates: [
      {
        table_id: "orders",
        column_id: "orders.tenant_id",
        operator: "eq",
        parameter_key: "tenant_id",
      },
    ],
  });
  const documentHash = await computeGroundingAuthorityDocumentHash(draft);
  return groundingAuthorityDocumentSchema.parse({
    ...draft,
    artifact_ref: {
      ...draft.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  });
}

async function groundingAuthorityBundle(
  principalId = ids.principal,
  schemaOverrides: Parameters<typeof schemaSnapshotDocument>[0] = {},
) {
  const semanticRelease = (await groundingAuthorityDocument()) as Extract<
    GroundingAuthorityDocument,
    { artifact_type: "SemanticRelease" }
  >;
  const schemaSnapshot = await schemaSnapshotDocument(schemaOverrides);
  const policyReceipt = (await policyReceiptDocument(principalId, {
    semantic_release_ref: semanticRelease.artifact_ref,
    schema_snapshot_ref: schemaSnapshot.artifact_ref,
  })) as Extract<GroundingAuthorityDocument, { artifact_type: "PolicyReceipt" }>;
  return { policyReceipt, schemaSnapshot, semanticRelease };
}

async function resealPolicyReceipt(
  source: Extract<GroundingAuthorityDocument, { artifact_type: "PolicyReceipt" }>,
  overrides: Record<string, unknown>,
) {
  const zeroHash = `sha256:${"0".repeat(64)}` as const;
  const draft = groundingAuthorityDocumentSchema.parse({
    ...source,
    ...overrides,
    artifact_ref: {
      ...source.artifact_ref,
      content_hash: zeroHash,
    },
    document_hash: zeroHash,
  });
  const documentHash = await computeGroundingAuthorityDocumentHash(draft);
  return groundingAuthorityDocumentSchema.parse({
    ...draft,
    artifact_ref: {
      ...draft.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  }) as Extract<GroundingAuthorityDocument, { artifact_type: "PolicyReceipt" }>;
}

function deterministicPolicyAuthorityFor(
  issuance: Extract<GroundingAuthorityDocument, { artifact_type: "PolicyReceipt" }>,
  observe?: (
    input: Parameters<
      NonNullable<PostgresRepositoryAuthorities["resolveDeterministicPolicyReceiptIssuance"]>
    >[0],
  ) => void,
): PostgresRepositoryAuthorities {
  return {
    resolveDeterministicPolicyReceiptIssuance: async (input, capability) => {
      observe?.(input);
      if (
        input.principal_id !== capability.principal ||
        input.principal_id !== issuance.principal_id ||
        artifactReferenceIdentity(input.policy_receipt_ref) !==
          artifactReferenceIdentity(issuance.artifact_ref) ||
        artifactReferenceIdentity(input.semantic_release_ref) !==
          artifactReferenceIdentity(issuance.semantic_release_ref) ||
        artifactReferenceIdentity(input.schema_snapshot_ref) !==
          artifactReferenceIdentity(issuance.schema_snapshot_ref)
      ) {
        return null;
      }
      return structuredClone(issuance);
    },
  };
}

describe("PostgreSQL authoritative repository", () => {
  it("accepts command, idempotency, initial event and outbox in one transaction", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        return {
          rows: [
            {
              result: {
                created: true,
                run_id: ids.run,
                command_id: ids.command,
                outbox_id: ids.outbox,
                payload_hash: canonicalPayloadHash,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const result = await repository.acceptCommand(authority.capability, commandInput());

    expect(result).toMatchObject({
      ok: true,
      value: {
        created: true,
        run_id: ids.run,
        command_id: ids.command,
        outbox_id: ids.outbox,
        payload_hash: canonicalPayloadHash,
      },
    });
    const statements = fixture.calls.map(({ text }) => text);
    expect(statements[0]).toBe("BEGIN");
    expect(statements).toContainEqual(expect.stringContaining("accept_backend_run_command"));
    expect(statements.some((text) => text.includes("insert into"))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
    const canonicalHashQuery = fixture.calls.find(({ text }) =>
      text.includes("platform.canonical_sha256"),
    );
    expect(canonicalHashQuery?.values).toEqual([canonicalizeJson(commandInput().payload)]);
    const acceptance = fixture.calls.find(({ text }) =>
      text.includes("accept_backend_run_command"),
    );
    expect(JSON.parse(String(acceptance?.values[0]))).toEqual(commandInput());
    expect(acceptance?.values[1]).toBe(canonicalPayloadHash);
    const initialEvent = JSON.parse(String(acceptance?.values[2]));
    expect(initialEvent).toMatchObject({
      event_id: ids.event,
      event_type: "run.accepted",
      payload: {
        command_id: ids.command,
        payload_hash: canonicalPayloadHash,
      },
    });
    expect(acceptance?.values[3]).toBe(await sha256ContentHash(initialEvent));
    expect(fixture.released()).toBe(1);
  });

  it("accepts a run and persists its datasource attribution in the same transaction", async () => {
    const datasourceId = "00000000-0000-4000-8000-000000000711";
    const conversationId = "00000000-0000-4000-8000-000000000712";
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        return {
          rows: [
            {
              result: {
                created: true,
                run_id: ids.run,
                command_id: ids.command,
                outbox_id: ids.outbox,
                payload_hash: canonicalPayloadHash,
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("insert into workspace_run_bindings")) {
        return {
          rows: [
            {
              datasource_id: datasourceId,
              conversation_id: conversationId,
              principal_id: ids.principal,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const issued = issueCapability();
    const repository = createPostgresRepository(fixture.pool, issued.authorizer);
    const input = {
      ...commandInput(),
      payload: {
        ...commandInput().payload,
        datasource_id: datasourceId,
        conversation_id: conversationId,
      },
    };

    expect(await repository.acceptCommand(issued.capability, input)).toMatchObject({
      ok: true,
      value: { created: true, run_id: ids.run },
    });
    const acceptanceIndex = fixture.calls.findIndex(({ text }) =>
      text.includes("accept_backend_run_command"),
    );
    const bindingIndex = fixture.calls.findIndex(({ text }) =>
      text.includes("insert into workspace_run_bindings"),
    );
    expect(bindingIndex).toBeGreaterThan(acceptanceIndex);
    expect(fixture.calls[bindingIndex]?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.run,
      datasourceId,
      conversationId,
      ids.principal,
    ]);
    expect(fixture.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("resolves Q&A model and datasource snapshots from the frozen conversation", async () => {
    const datasourceId = "00000000-0000-4000-8000-000000000711";
    const conversationId = "00000000-0000-4000-8000-000000000712";
    const messageId = "00000000-0000-4000-8000-000000000713";
    const modelProfileId = "30000000-0000-4000-8000-000000000003";
    const datasourceBindingHash = `sha256:${"b".repeat(64)}`;
    const fixture = scriptedPool((text) => {
      if (text.includes("from qa_conversations as conversation")) {
        return {
          rows: [
            {
              datasource_id: datasourceId,
              model_profile_id: modelProfileId,
              config_version: 7,
              provider: "deepseek",
              model_id: "deepseek-v4-pro",
              datasource_binding_hash: datasourceBindingHash,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("accept_backend_run_command")) {
        return {
          rows: [
            {
              result: {
                created: true,
                run_id: ids.run,
                command_id: ids.command,
                outbox_id: ids.outbox,
                payload_hash: canonicalPayloadHash,
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("insert into workspace_run_bindings")) {
        return {
          rows: [
            {
              datasource_id: datasourceId,
              conversation_id: conversationId,
              principal_id: ids.principal,
              model_profile_id: modelProfileId,
              model_config_version: 7,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const issued = issueCapability();
    const repository = createPostgresRepository(fixture.pool, issued.authorizer);
    const input = {
      ...commandInput(),
      payload: {
        kind: "START_L2_RESEARCH",
        mode: "L2",
        conversation_id: conversationId,
        message_id: messageId,
      },
    };

    expect(await repository.acceptCommand(issued.capability, input)).toMatchObject({
      ok: true,
      value: { created: true, run_id: ids.run },
    });
    const resolver = fixture.calls.find(({ text }) =>
      text.includes("from qa_conversations as conversation"),
    );
    expect(resolver?.text).toContain("platform.list_active_model_catalog($3::uuid, $2::uuid)");
    expect(resolver?.values).toEqual([conversationId, ids.principal, ids.deployment]);
    const acceptance = fixture.calls.find(({ text }) =>
      text.includes("accept_backend_run_command"),
    );
    expect(JSON.parse(String(acceptance?.values[0]))).toMatchObject({
      payload: {
        kind: "START_L2_RESEARCH",
        conversation_id: conversationId,
        message_id: messageId,
        datasource_id: datasourceId,
        model_profile_id: modelProfileId,
        model_config_version: 7,
        provider: "deepseek",
        model_id: "deepseek-v4-pro",
        datasource_binding_hash: datasourceBindingHash,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("insert into qa_messages"))).toBe(true);
    expect(fixture.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("rejects unknown or opaque credential payload fields before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.acceptCommand(authority.capability, {
        ...commandInput(),
        payload: {
          kind: "START_L2_RESEARCH",
          jdbc_url: "jdbc:postgresql://admin:hunter2@db.example.com/warehouse",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("rejects non-initial command kinds before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.acceptCommand(authority.capability, {
        ...commandInput(),
        payload: {
          ...commandInput().payload,
          kind: "RESUME_RUN",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("rejects plaintext credentials pasted into the question before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.acceptCommand(authority.capability, {
        ...commandInput(),
        question: "请连接 jdbc:postgresql://admin:hunter2@db.example.com/warehouse",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("returns an existing command only when all idempotency bindings match", async () => {
    const input = commandInput();
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        return {
          rows: [
            {
              result: {
                created: false,
                command_id: ids.command,
                payload_hash: canonicalPayloadHash,
                run_id: ids.run,
                outbox_id: ids.browserOutbox,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);
    const first = await repository.acceptCommand(authority.capability, input);

    expect(first).toMatchObject({
      ok: true,
      value: {
        created: false,
        command_id: ids.command,
        outbox_id: ids.browserOutbox,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("insert into"))).toBe(false);
    expect(fixture.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("rolls back a reused idempotency key with a different payload", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        throw new Error("DA_COMMAND_IDEMPOTENCY_CONFLICT");
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const result = await repository.acceptCommand(authority.capability, commandInput());

    expect(result).toMatchObject({
      ok: false,
      error: { code: "COMMAND_IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rolls back a reused idempotency key with a different question", async () => {
    const input = commandInput();
    const fixture = scriptedPool((text) => {
      if (text.includes("accept_backend_run_command")) {
        throw new Error("DA_COMMAND_IDEMPOTENCY_CONFLICT");
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(await repository.acceptCommand(authority.capability, input)).toMatchObject({
      ok: false,
      error: { code: "COMMAND_IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("binds Run reads to app, tenant, environment, object id and principal", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("from runs")
        ? {
            rows: [
              {
                app_id: ids.app,
                tenant_id: ids.tenant,
                environment: "test",
                run_id: ids.run,
                principal_id: ids.principal,
                status: "QUEUED",
                active_fence: "0",
                question: "question",
                created_at: "2026-07-25T00:00:00.000Z",
                updated_at: "2026-07-25T00:00:00.000Z",
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const result = await repository.getRun(authority.capability, { run_id: ids.run });

    expect(result).toMatchObject({
      ok: true,
      value: {
        app_id: ids.app,
        tenant_id: ids.tenant,
        principal_id: ids.principal,
        active_fence: 0,
      },
    });
    const query = fixture.calls.find(({ text }) => text.includes("from runs"));
    expect(query?.values).toEqual([ids.app, ids.tenant, "test", ids.run, ids.principal]);
    expect(query?.text).toContain("left join lateral");
    expect(query?.text).toContain("candidate.status");
    expect(query?.text).toContain("order by candidate.version desc");
  });

  it("binds artifact existence checks to the owning run principal", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("from artifacts as artifact")
        ? { rows: [{ present: 1 }], rowCount: 1 }
        : undefined,
    );
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);
    const reference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000701",
      artifact_type: "QuestionFrame",
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}`,
    };

    expect(await repository.verifyCommitted(authority.capability, reference)).toEqual({
      ok: true,
      value: true,
    });
    const query = fixture.calls.find(({ text }) => text.includes("from artifacts as artifact"));
    expect(query?.text).toContain("and run.principal_id = $9");
    expect(query?.values.at(-1)).toBe(ids.principal);
  });

  it("未配置服务端 L2 Committer Authority 时在 Run Fence 前失败关闭", async () => {
    const document = await committedDocument({
      artifact_id: "00000000-0000-4000-8000-000000000710",
      artifact_type: "QuestionFrame",
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000714"],
        expected_output: "多步研究报告",
      },
    });
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitL2Artifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "L2_ARTIFACT_AUTHORITY_INVALID", retryable: false },
    });
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("insert into artifacts"))).toBe(false);
  });

  it("通用 L2 Repository 在连接数据库前拒绝全部 U6 current 与 historical 保留元组", async () => {
    const reservedTuples = [
      ...L2_RESEARCH_WIRE_VERSION_MATRIX,
      ...L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES,
      ...L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES.map(
        (artifactType) => [artifactType, "1.0.0", null] as const,
      ),
    ];
    const authority = issueCapability();

    for (const [artifactType, envelopeVersion, payloadVersion] of reservedTuples) {
      const fixture = scriptedPool(() => undefined);
      const repository = createPostgresRepository(fixture.pool, authority.authorizer);
      const document = {
        envelope: {
          artifact_type: artifactType,
          schema_version: envelopeVersion,
        },
        payload: {
          artifact_type: artifactType,
          ...(payloadVersion === null ? {} : { protocol_version: payloadVersion }),
        },
      };

      expect(
        await repository.commitL2Artifact(authority.capability, document, {
          expected_active_revision: 0,
          worker_fence: 0,
        }),
        `${artifactType}/${envelopeVersion}/${payloadVersion ?? "legacy-null"}`,
      ).toMatchObject({
        ok: false,
        error: {
          code: "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
          retryable: false,
        },
      });
      expect(fixture.connections()).toBe(0);
      expect(fixture.calls).toHaveLength(0);
    }
  });

  it("L2 提交把运行证据输入路由到专用 System Store，而不要求镜像进 artifacts 表", async () => {
    const systemReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000717",
      artifact_type: "SandboxResult",
      revision: 1,
      content_hash: `sha256:${"7".repeat(64)}`,
    } as const;
    const document = await committedDocument({
      artifact_id: "00000000-0000-4000-8000-000000000718",
      artifact_type: "QuestionFrame",
      input_refs: [systemReference],
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000714"],
        expected_output: "多步研究报告",
      },
    });
    const fixture = scriptedPool((text) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "0" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    let systemVerificationCount = 0;
    const repository = createPostgresRepository(fixture.pool, authority.authorizer, {
      ...l2CommitAuthoritiesFor(document),
      verifyText2SqlSystemArtifactCommitted: async (reference) => {
        systemVerificationCount += 1;
        return artifactReferenceIdentity(reference) === artifactReferenceIdentity(systemReference);
      },
    });

    expect(
      await repository.commitL2Artifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({ ok: true, value: { artifact_type: "QuestionFrame" } });
    expect(systemVerificationCount).toBe(2);
    expect(fixture.calls.some(({ text }) => text.includes("from artifacts as artifact"))).toBe(
      false,
    );
  });

  it("L2 提交把 Metamorphic Fixture 与 Oracle Receipt 只路由到专用 System Store", async () => {
    const fixtureReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000719",
      artifact_type: "MetamorphicFixtureReceipt",
      revision: 1,
      content_hash: `sha256:${"8".repeat(64)}`,
    } as const;
    const metamorphicReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-00000000071a",
      artifact_type: "MetamorphicOracleReceipt",
      revision: 1,
      content_hash: `sha256:${"9".repeat(64)}`,
    } as const;
    const document = await committedDocument({
      artifact_id: "00000000-0000-4000-8000-000000000720",
      artifact_type: "QuestionFrame",
      input_refs: [fixtureReference, metamorphicReference],
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000714"],
        expected_output: "多步研究报告",
      },
    });
    const fixture = scriptedPool((text) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "0" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const systemReferences: string[] = [];
    const repository = createPostgresRepository(fixture.pool, authority.authorizer, {
      ...l2CommitAuthoritiesFor(document),
      verifyText2SqlSystemArtifactCommitted: async (reference) => {
        systemReferences.push(artifactReferenceIdentity(reference));
        return [fixtureReference, metamorphicReference].some(
          (expected) =>
            artifactReferenceIdentity(reference) === artifactReferenceIdentity(expected),
        );
      },
    });

    expect(
      await repository.commitL2Artifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({ ok: true, value: { artifact_type: "QuestionFrame" } });
    expect(
      systemReferences.filter(
        (identity) => identity === artifactReferenceIdentity(fixtureReference),
      ),
    ).toHaveLength(2);
    expect(
      systemReferences.filter(
        (identity) => identity === artifactReferenceIdentity(metamorphicReference),
      ),
    ).toHaveLength(2);
    expect(fixture.calls.some(({ text }) => text.includes("from artifacts as artifact"))).toBe(
      false,
    );
  });

  it("缺少 Metamorphic Oracle 专用 commit verifier 时在 insert 前失败关闭", async () => {
    const metamorphicReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000719",
      artifact_type: "MetamorphicOracleReceipt",
      revision: 1,
      content_hash: `sha256:${"9".repeat(64)}`,
    } as const;
    const document = await committedDocument({
      artifact_id: "00000000-0000-4000-8000-000000000720",
      artifact_type: "QuestionFrame",
      input_refs: [metamorphicReference],
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000714"],
        expected_output: "多步研究报告",
      },
    });
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer, {
      ...l2CommitAuthoritiesFor(document),
      resolveText2SqlSystemArtifact: async () => ({ ignored: true }),
    });

    expect(
      await repository.commitL2Artifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "L2_ARTIFACT_AUTHORITY_INVALID", retryable: false },
    });
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("insert into artifacts"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("from artifacts as artifact"))).toBe(
      false,
    );
  });

  it("按完整 Reference、Meta 原对象、Capability 与同一事务 Client 转发品牌", async () => {
    const verification = await createBrandedMetamorphicReceiptFixture();
    const fixtureReference = verification.fixture_receipt.receipt_ref;
    const metamorphicReference = verification.receipt.receipt_ref;
    const resultReference = {
      ...metamorphicReference,
      artifact_id: "50000000-0000-4000-8000-000000009997",
      artifact_type: "ResultOracleReceipt",
      content_hash: `sha256:${"d".repeat(64)}`,
    } as const satisfies ArtifactReference;
    const authority = issueCapabilityForReference(
      metamorphicReference,
      verification.verifier_identity.principal_id,
    );
    const sqlFixture = scriptedPool(() => undefined);
    const client = await sqlFixture.pool.connect();
    const calls: Array<{
      kind: "fixture" | "metamorphic" | "result";
      reference: ArtifactReference;
      metamorphic?: AuthoritativeMetamorphicOracleReceipt;
      capability: unknown;
      client: SqlClient;
    }> = [];
    const context = createText2SqlBrandedReceiptAuthorityContext(client, authority.capability, {
      resolveAuthoritativeMetamorphicFixtureReceipt: async (
        reference,
        capability,
        transactionClient,
      ) => {
        calls.push({
          kind: "fixture",
          reference,
          capability,
          client: transactionClient,
        });
        return verification.fixture_receipt;
      },
      resolveAuthoritativeMetamorphicOracleReceipt: async (
        reference,
        capability,
        transactionClient,
      ) => {
        calls.push({
          kind: "metamorphic",
          reference,
          capability,
          client: transactionClient,
        });
        return verification.receipt;
      },
      resolveAuthoritativeResultOracleReceipt: async (
        reference,
        metamorphic,
        capability,
        transactionClient,
      ) => {
        calls.push({
          kind: "result",
          reference,
          metamorphic,
          capability,
          client: transactionClient,
        });
        return null;
      },
    });

    expect(await context.resolveAuthoritativeMetamorphicFixtureReceipt?.(fixtureReference)).toBe(
      verification.fixture_receipt,
    );
    expect(await context.resolveAuthoritativeMetamorphicOracleReceipt?.(metamorphicReference)).toBe(
      verification.receipt,
    );
    expect(
      await context.resolveAuthoritativeResultOracleReceipt?.(
        resultReference,
        verification.receipt,
      ),
    ).toBeNull();
    expect(isAuthoritativeMetamorphicFixtureReceipt(verification.fixture_receipt)).toBe(true);
    expect(isAuthoritativeMetamorphicOracleReceipt(verification.receipt)).toBe(true);
    expect(
      calls.map(({ kind, reference }) => [kind, artifactReferenceIdentity(reference)]),
    ).toEqual([
      ["fixture", artifactReferenceIdentity(fixtureReference)],
      ["metamorphic", artifactReferenceIdentity(metamorphicReference)],
      ["result", artifactReferenceIdentity(resultReference)],
    ]);
    expect(calls.find(({ kind }) => kind === "result")?.metamorphic).toBe(verification.receipt);
    expect(calls.every(({ capability }) => capability === authority.capability)).toBe(true);
    expect(calls.every(({ client: observedClient }) => observedClient === client)).toBe(true);
    expect(
      new Set([
        verification.fixture_identity.authority_id,
        verification.sandbox_identity.authority_id,
        verification.verifier_identity.authority_id,
      ]).size,
    ).toBe(3);
    expect(
      new Set([
        verification.fixture_identity.key_id,
        verification.sandbox_identity.key_id,
        verification.verifier_identity.key_id,
      ]).size,
    ).toBe(3);
  });

  it("Fixture/Meta 品牌 resolver 拒绝 Reference A/Payload B 的 type、id、run、revision 与 hash 换绑", async () => {
    const verification = await createBrandedMetamorphicReceiptFixture();
    const fixtureReference = verification.fixture_receipt.receipt_ref;
    const metamorphicReference = verification.receipt.receipt_ref;
    const authority = issueCapabilityForReference(
      metamorphicReference,
      verification.verifier_identity.principal_id,
    );
    const client = await scriptedPool(() => undefined).pool.connect();
    const context = createText2SqlBrandedReceiptAuthorityContext(client, authority.capability, {
      resolveAuthoritativeMetamorphicFixtureReceipt: async () => verification.fixture_receipt,
      resolveAuthoritativeMetamorphicOracleReceipt: async () => verification.receipt,
    });
    const reboundFixtureReferences = [
      {
        ...fixtureReference,
        artifact_type: "MetamorphicOracleReceipt",
      },
      {
        ...fixtureReference,
        artifact_id: "50000000-0000-4000-8000-000000009998",
      },
      {
        ...fixtureReference,
        run_id: "50000000-0000-4000-8000-000000009999",
      },
      {
        ...fixtureReference,
        revision: fixtureReference.revision + 1,
      },
      {
        ...fixtureReference,
        content_hash: `sha256:${"f".repeat(64)}`,
      },
    ] as const satisfies readonly ArtifactReference[];
    for (const reboundReference of reboundFixtureReferences) {
      expect(
        await context.resolveAuthoritativeMetamorphicFixtureReceipt?.(reboundReference),
      ).toBeNull();
    }
    expect(
      await context.resolveAuthoritativeMetamorphicOracleReceipt?.({
        ...metamorphicReference,
        revision: metamorphicReference.revision + 1,
      }),
    ).toBeNull();
    expect(
      await context.resolveAuthoritativeMetamorphicOracleReceipt?.({
        ...metamorphicReference,
        content_hash: `sha256:${"e".repeat(64)}`,
      }),
    ).toBeNull();
    await expect(
      context.resolveAuthoritativeMetamorphicFixtureReceipt?.({
        ...fixtureReference,
        tenant_id: "50000000-0000-4000-8000-000000009999",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_SCOPE_DENIED" });
  });

  it("raw clone、boolean 自证与缺失 Authority 都不能产生 Fixture/Meta 品牌", async () => {
    const verification = await createBrandedMetamorphicReceiptFixture();
    const authority = issueCapabilityForReference(
      verification.receipt.receipt_ref,
      verification.verifier_identity.principal_id,
    );
    const client = await scriptedPool(() => undefined).pool.connect();
    const rawCloneContext = createText2SqlBrandedReceiptAuthorityContext(
      client,
      authority.capability,
      {
        resolveAuthoritativeMetamorphicFixtureReceipt: async () =>
          structuredClone(verification.fixture_receipt),
        resolveAuthoritativeMetamorphicOracleReceipt: async () =>
          structuredClone(verification.receipt),
      } as unknown as PostgresRepositoryAuthorities,
    );
    const rawBooleanContext = createText2SqlBrandedReceiptAuthorityContext(
      client,
      authority.capability,
      {
        verifyResultOracleReceipt: async () => true,
        verifySandboxExecutionEvidence: async () => true,
        verifyMetamorphicFixtureReceipt: async () => true,
        verifyMetamorphicOracleReceipt: async () => true,
      } as unknown as PostgresRepositoryAuthorities,
    );
    const missingAuthorityContext = createText2SqlBrandedReceiptAuthorityContext(
      client,
      authority.capability,
      {},
    );

    expect(
      await rawCloneContext.resolveAuthoritativeMetamorphicFixtureReceipt?.(
        verification.fixture_receipt.receipt_ref,
      ),
    ).toBeNull();
    expect(
      await rawCloneContext.resolveAuthoritativeMetamorphicOracleReceipt?.(
        verification.receipt.receipt_ref,
      ),
    ).toBeNull();
    expect(rawBooleanContext.resolveAuthoritativeMetamorphicFixtureReceipt).toBeUndefined();
    expect(rawBooleanContext.resolveAuthoritativeMetamorphicOracleReceipt).toBeUndefined();
    expect(rawBooleanContext.resolveAuthoritativeResultOracleReceipt).toBeUndefined();
    expect(rawBooleanContext.resolveAuthoritativeSandboxExecutionReceipt).toBeUndefined();
    expect(rawBooleanContext.resolveAuthoritativeSandboxResult).toBeUndefined();
    expect(missingAuthorityContext.resolveAuthoritativeMetamorphicFixtureReceipt).toBeUndefined();
    expect(missingAuthorityContext.resolveAuthoritativeMetamorphicOracleReceipt).toBeUndefined();
  });

  it("接受非凭据 Snapshot Token，但在语义上游不可解析时拒绝提交 ExecutionReceipt", async () => {
    const sqlReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: "00000000-0000-4000-8000-000000000711",
      artifact_type: "SqlArtifact",
      revision: 1,
      content_hash: `sha256:${"b".repeat(64)}`,
    };
    const executionPermitReference = {
      ...sqlReference,
      artifact_id: "00000000-0000-4000-8000-000000000712",
      artifact_type: "ExecutionPermit",
      content_hash: `sha256:${"c".repeat(64)}`,
    };
    const sandboxReceiptReference = {
      ...sqlReference,
      artifact_id: "00000000-0000-4000-8000-000000000715",
      artifact_type: "SandboxExecutionReceipt",
      content_hash: `sha256:${"e".repeat(64)}`,
    };
    const sandboxResultReference = {
      ...sqlReference,
      artifact_id: "00000000-0000-4000-8000-000000000716",
      artifact_type: "SandboxResult",
      content_hash: `sha256:${"f".repeat(64)}`,
    };
    const document = await committedDocument({
      artifact_id: "00000000-0000-4000-8000-000000000713",
      artifact_type: "ExecutionReceipt",
      input_refs: [
        sqlReference,
        executionPermitReference,
        sandboxReceiptReference,
        sandboxResultReference,
      ],
      payload: {
        artifact_type: "ExecutionReceipt",
        sql_artifact_ref: sqlReference,
        execution_permit_ref: executionPermitReference,
        sandbox_execution_receipt_ref: sandboxReceiptReference,
        result_artifact_ref: sandboxResultReference,
        datasource_id: "00000000-0000-4000-8000-000000000714",
        schema_version: "schema-1",
        snapshot_token: "snapshot-1",
        watermark: "watermark-1",
        observed_at: "2026-07-25T00:00:00.000Z",
        query_hash: `sha256:${"d".repeat(64)}`,
        result_hash: `sha256:${"f".repeat(64)}`,
        replay_state: "REPLAYABLE",
        row_count: 3,
      },
    });
    const fixture = scriptedPool((text) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "0" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("from artifacts as artifact")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      if (text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(
      fixture.pool,
      authority.authorizer,
      l2CommitAuthoritiesFor(document),
    );

    expect(
      await repository.commitL2Artifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "L2_ARTIFACT_AUTHORITY_INVALID", retryable: false },
    });
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("insert into artifacts"))).toBe(false);
  });

  it("commits a continuous revision one to revision two ancestry", async () => {
    const artifactId = "00000000-0000-4000-8000-000000000721";
    const revisionOne = await committedDocument({
      artifact_id: artifactId,
      artifact_type: "QuestionFrame",
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "收入为什么下降？",
        normalized_question: "解释收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000722"],
        expected_output: "多步研究报告",
      },
    });
    const parentReference = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      artifact_id: artifactId,
      artifact_type: "QuestionFrame",
      revision: 1,
      content_hash: revisionOne.envelope.content_hash,
    };
    const revisionTwo = await committedDocument({
      artifact_id: artifactId,
      artifact_type: "QuestionFrame",
      revision: 2,
      parent_ref: parentReference,
      payload: {
        artifact_type: "QuestionFrame",
        raw_question: "华南区收入为什么下降？",
        normalized_question: "解释华南区收入下降原因",
        authorized_datasource_ids: ["00000000-0000-4000-8000-000000000722"],
        expected_output: "多步研究报告",
      },
    });
    let active: { readonly revision: number; readonly content_hash: string } | null = null;
    const fixture = scriptedPool((text, values) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "0" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
      }
      if (text.includes("from artifacts as artifact")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      if (text.includes("insert into artifacts")) {
        active = {
          revision: Number(values[6]),
          content_hash: String(values[7]),
        };
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("update artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(
      fixture.pool,
      authority.authorizer,
      l2CommitAuthoritiesFor(revisionOne, revisionTwo),
    );

    expect(
      await repository.commitL2Artifact(authority.capability, revisionOne, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(
      await repository.commitL2Artifact(authority.capability, revisionTwo, {
        expected_active_revision: 1,
        worker_fence: 0,
      }),
    ).toMatchObject({ ok: true, value: { revision: 2 } });
  });

  it("commits a content-addressed Grounding Authority revision through the owned Run fence", async () => {
    const document = await groundingAuthorityDocument();
    const fixture = scriptedPool((text) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "7" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 7,
      }),
    ).toEqual({
      ok: true,
      value: document.artifact_ref,
    });
    const fenceLock = fixture.calls.find(({ text }) => text.includes("lock_owned_run_fence"));
    expect(fenceLock?.values).toEqual([ids.run]);
    const insert = fixture.calls.find(({ text }) => text.includes("insert into artifacts"));
    expect(insert?.values[5]).toBe("SemanticRelease");
    expect(insert?.values[8]).toBe(canonicalizeJson(document));
  });

  it("denies an ANALYST before opening a Grounding Authority commit transaction", async () => {
    const document = await groundingAuthorityDocument();
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability("ANALYST");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_WRITE_DENIED", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it.each([
    {
      label: "producer",
      overrides: { producer_id: "attacker-registry" },
    },
    {
      label: "authority id",
      overrides: { authority_id: "attacker-authority" },
    },
    {
      label: "authority version",
      overrides: { authority_policy_version: "grounding-authority@9.9.9" },
    },
  ])("rejects a spoofed Grounding $label inside the OWNER transaction", async ({ overrides }) => {
    const document = await groundingAuthorityDocument(overrides);
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GROUNDING_AUTHORITY_IDENTITY_DENIED", retryable: false },
    });
    expect(fixture.calls[0]?.text).toBe("BEGIN");
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
  });

  it("rejects a PolicyReceipt that is not authorized by policy-authority", async () => {
    const document = await policyReceiptDocument(ids.principal, {
      authority_id: "attacker-policy-authority",
    });
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GROUNDING_AUTHORITY_IDENTITY_DENIED", retryable: false },
    });
    expect(fixture.calls[0]?.text).toBe("BEGIN");
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rejects a PolicyReceipt whose principal differs from the transaction capability", async () => {
    const document = await policyReceiptDocument("00000000-0000-4000-8000-000000000999");
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GROUNDING_POLICY_PRINCIPAL_MISMATCH", retryable: false },
    });
    expect(fixture.calls[0]?.text).toBe("BEGIN");
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
  });

  it("rejects an OWNER PolicyReceipt when the server composition omits Policy Authority", async () => {
    const {
      policyReceipt: document,
      schemaSnapshot,
      semanticRelease,
    } = await groundingAuthorityBundle();
    const documents = new Map<string, GroundingAuthorityDocument>(
      [semanticRelease, schemaSnapshot].map((candidate) => [
        candidate.artifact_ref.artifact_type,
        candidate,
      ]),
    );
    const fixture = scriptedPool((text, values) => {
      if (text.includes("select artifact.document_json")) {
        const candidate = documents.get(String(values[5]));
        return candidate
          ? { rows: [{ document_json: structuredClone(candidate) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes("select 1")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 5,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "GROUNDING_DOCUMENT_NOT_AUTHORITATIVE",
        retryable: false,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
  });

  it("allows an OWNER to commit only the exact server-issued PolicyReceipt", async () => {
    const {
      policyReceipt: document,
      schemaSnapshot,
      semanticRelease,
    } = await groundingAuthorityBundle();
    const documents = new Map<string, GroundingAuthorityDocument>(
      [semanticRelease, schemaSnapshot].map((candidate) => [
        candidate.artifact_ref.artifact_type,
        candidate,
      ]),
    );
    const fixture = scriptedPool((text, values) => {
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "5" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("select artifact.document_json")) {
        const candidate = documents.get(String(values[5]));
        return candidate
          ? { rows: [{ document_json: structuredClone(candidate) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes("from artifacts as artifact")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      if (text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability("OWNER");
    let issuanceLookup: unknown = null;
    const repository = createPostgresRepository(
      fixture.pool,
      authority.authorizer,
      deterministicPolicyAuthorityFor(document, (input) => {
        issuanceLookup = input;
      }),
    );

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 5,
      }),
    ).toEqual({ ok: true, value: document.artifact_ref });
    const referenceChecks = fixture.calls.filter(({ text }) =>
      text.trimStart().startsWith("select 1"),
    );
    expect(referenceChecks).toHaveLength(4);
    expect(referenceChecks.every(({ values }) => values.at(-1) === ids.principal)).toBe(true);
    expect(issuanceLookup).toEqual({
      scope: semanticRelease.scope,
      run_id: semanticRelease.run_id,
      principal_id: ids.principal,
      datasource_id: semanticRelease.datasource_id,
      catalog_version: semanticRelease.catalog_version,
      policy_receipt_ref: document.artifact_ref,
      semantic_release_ref: semanticRelease.artifact_ref,
      schema_snapshot_ref: schemaSnapshot.artifact_ref,
    });
    expect(issuanceLookup).not.toHaveProperty("allowed_schema");
    expect(issuanceLookup).not.toHaveProperty("mandatory_predicates");
    expect(issuanceLookup).not.toHaveProperty("policy_version");
    expect(issuanceLookup).not.toHaveProperty("authority");
  });

  it("rejects an OWNER that broadens ACL, drops predicates, or changes the policy epoch", async () => {
    const {
      policyReceipt: issuance,
      schemaSnapshot,
      semanticRelease,
    } = await groundingAuthorityBundle();
    const candidates = [
      {
        label: "broaden AllowedSchema",
        document: await resealPolicyReceipt(issuance, {
          allowed_schema: {
            tables: [
              {
                table_id: "orders",
                column_ids: ["orders.tenant_id", "orders.net_amount"],
              },
            ],
          },
        }),
      },
      {
        label: "drop MandatoryPredicate",
        document: await resealPolicyReceipt(issuance, {
          mandatory_predicates: [],
        }),
      },
      {
        label: "change policy epoch",
        document: await resealPolicyReceipt(issuance, {
          policy_version: "default-policy@2.0.0",
          authority: {
            kind: "deterministic",
            id: "policy-authority",
            policy_version: "default-policy@2.0.0",
          },
        }),
      },
    ];

    for (const { document, label } of candidates) {
      const documents = new Map<string, GroundingAuthorityDocument>(
        [semanticRelease, schemaSnapshot].map((candidate) => [
          candidate.artifact_ref.artifact_type,
          candidate,
        ]),
      );
      const fixture = scriptedPool((text, values) => {
        if (text.includes("select artifact.document_json")) {
          const candidate = documents.get(String(values[5]));
          return candidate
            ? { rows: [{ document_json: structuredClone(candidate) }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (text.includes("select 1")) {
          return { rows: [{ present: 1 }], rowCount: 1 };
        }
        return undefined;
      });
      const authority = issueCapability("OWNER");
      const repository = createPostgresRepository(
        fixture.pool,
        authority.authorizer,
        deterministicPolicyAuthorityFor(issuance),
      );

      expect(
        await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
          expected_active_revision: 0,
          worker_fence: 5,
        }),
        label,
      ).toMatchObject({
        ok: false,
        error: {
          code: "GROUNDING_DOCUMENT_NOT_AUTHORITATIVE",
          retryable: false,
        },
      });
      expect(
        fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence")),
        label,
      ).toBe(false);
    }
  });

  it("rejects an inconsistent PolicyReceipt before locking or replacing Active Revision", async () => {
    const {
      policyReceipt: document,
      schemaSnapshot,
      semanticRelease,
    } = await groundingAuthorityBundle(ids.principal, {
      catalog_version: "commerce-catalog@2.0.0",
    });
    const documents = new Map<string, GroundingAuthorityDocument>(
      [semanticRelease, schemaSnapshot].map((candidate) => [
        candidate.artifact_ref.artifact_type,
        candidate,
      ]),
    );
    const fixture = scriptedPool((text, values) => {
      if (text.includes("select artifact.document_json")) {
        const candidate = documents.get(String(values[5]));
        return candidate
          ? { rows: [{ document_json: structuredClone(candidate) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes("select 1")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 0,
        worker_fence: 5,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "GROUNDING_DOCUMENT_NOT_AUTHORITATIVE",
        retryable: false,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("lock_owned_run_fence"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("select revision, content_hash"))).toBe(
      false,
    );
    expect(fixture.calls.some(({ text }) => text.includes("update artifacts"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("insert into artifacts"))).toBe(false);
  });

  it("rejects Grounding Authority hash drift and plaintext credentials before database I/O", async () => {
    const document = await groundingAuthorityDocument();
    const credentialDocument = await groundingAuthorityDocument({
      artifact_id: "00000000-0000-4000-8000-000000000732",
      metric_alias: "postgresql://admin:hunter2@db.example.test/warehouse",
    });
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(
        authority.capability,
        {
          ...document,
          catalog_version: "commerce-catalog@2.0.0",
        },
        {
          expected_active_revision: 0,
          worker_fence: 0,
        },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, credentialDocument, {
        expected_active_revision: 0,
        worker_fence: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID", retryable: false },
    });
    expect(fixture.calls).toEqual([]);
  });

  it("derives continuous Grounding Authority ancestry from the locked active revision", async () => {
    const artifactId = "00000000-0000-4000-8000-000000000733";
    const parent = await groundingAuthorityDocument({ artifact_id: artifactId });
    const activeHash = parent.document_hash;
    const document = await groundingAuthorityDocument({
      artifact_id: artifactId,
      revision: 2,
      parent_ref: parent.artifact_ref,
      catalog_version: "commerce-catalog@2.0.0",
    });
    const fixture = scriptedPool((text) => {
      if (text.includes("select artifact.document_json")) {
        return { rows: [{ document_json: structuredClone(parent) }], rowCount: 1 };
      }
      if (text.includes("select 1")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      if (text.includes("lock_owned_run_fence")) {
        return { rows: [{ active_fence: "3" }], rowCount: 1 };
      }
      if (text.includes("select revision, content_hash")) {
        return { rows: [{ revision: 1, content_hash: activeHash }], rowCount: 1 };
      }
      if (text.includes("update artifacts") || text.includes("insert into artifacts")) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability("OWNER");
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.commitGroundingAuthorityArtifact(authority.capability, document, {
        expected_active_revision: 1,
        worker_fence: 3,
      }),
    ).toMatchObject({ ok: true, value: { revision: 2 } });
    const insert = fixture.calls.find(({ text }) => text.includes("insert into artifacts"));
    expect(insert?.values[10]).toBe(1);
    expect(insert?.values[11]).toBe(activeHash);
  });

  it("returns raw persistence reads unchanged and contextually verified reads deeply frozen", async () => {
    const document = await groundingAuthorityDocument();
    const fixture = scriptedPool((text) => {
      if (text.includes("select artifact.document_json")) {
        return { rows: [{ document_json: structuredClone(document) }], rowCount: 1 };
      }
      if (text.includes("select 1")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    const raw = await repository.resolveArtifact(authority.capability, document.artifact_ref);
    expect(raw).toMatchObject({ ok: true });
    expect(raw.ok && Object.isFrozen(raw.value)).toBe(false);

    const authorized = await repository.resolveGroundingAuthorityArtifact(
      authority.capability,
      document.artifact_ref,
    );
    expect(authorized).toMatchObject({ ok: true });
    expect(authorized.ok && Object.isFrozen(authorized.value)).toBe(true);
    expect(
      authorized.ok && authorized.value !== null && Object.isFrozen(authorized.value.artifact_ref),
    ).toBe(true);
  });

  it.each([
    {
      label: "伪造 producer",
      create: () => groundingAuthorityDocument({ producer_id: "legacy-attacker" }),
      expected_code: "GROUNDING_AUTHORITY_IDENTITY_DENIED",
    },
    {
      label: "错误 Policy principal",
      create: () => policyReceiptDocument("00000000-0000-4000-8000-000000000999"),
      expected_code: "GROUNDING_POLICY_PRINCIPAL_MISMATCH",
    },
  ])("revalidates $label on every contextual Grounding read", async ({ create, expected_code }) => {
    const document = await create();
    const fixture = scriptedPool((text) => {
      if (text.includes("select artifact.document_json")) {
        return { rows: [{ document_json: structuredClone(document) }], rowCount: 1 };
      }
      if (text.includes("select 1")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.resolveGroundingAuthorityArtifact(
        authority.capability,
        document.artifact_ref,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: expected_code,
        retryable: false,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("select 1"))).toBe(false);
  });

  it("rejects a raw Grounding document whose exact reference is not committed", async () => {
    const document = await groundingAuthorityDocument();
    const fixture = scriptedPool((text) => {
      if (text.includes("select artifact.document_json")) {
        return { rows: [{ document_json: structuredClone(document) }], rowCount: 1 };
      }
      if (text.includes("select 1")) {
        return { rows: [], rowCount: 0 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.resolveGroundingAuthorityArtifact(
        authority.capability,
        document.artifact_ref,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "GROUNDING_DOCUMENT_NOT_AUTHORITATIVE",
        retryable: false,
      },
    });
  });

  it("rejects Grounding document_json whose embedded reference differs from the request", async () => {
    const requested = await groundingAuthorityDocument();
    const mismatched = await groundingAuthorityDocument({
      artifact_id: "00000000-0000-4000-8000-000000000734",
    });
    const fixture = scriptedPool((text) => {
      if (text.includes("select artifact.document_json")) {
        return { rows: [{ document_json: structuredClone(mismatched) }], rowCount: 1 };
      }
      if (text.includes("select 1")) {
        return { rows: [{ present: 1 }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const repository = createPostgresRepository(fixture.pool, authority.authorizer);

    expect(
      await repository.resolveGroundingAuthorityArtifact(
        authority.capability,
        requested.artifact_ref,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "GROUNDING_DOCUMENT_NOT_AUTHORITATIVE",
        retryable: false,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("select 1"))).toBe(false);
  });
});
