import { describe, expect, it } from "vitest";
import { artifactReferenceIdentity } from "../src/artifacts/envelope.js";
import {
  computeGroundingAuthorityDocumentHash,
  type GroundingAuthorityDocument,
  GroundingAuthorityError,
  type GroundingAuthorityReference,
  type GroundingAuthorityVerificationContext,
  groundingAuthorityDocumentSchema,
  policyReceiptDocumentSchema,
  schemaSnapshotDocumentSchema,
  semanticReleaseDocumentSchema,
  verifyGroundingAuthorityDocument,
} from "../src/artifacts/grounding-authority.js";
import * as publicContracts from "../src/index.js";
import { environments, hashes, ids, makeArtifactReference } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

function authorityBase<const T extends "SemanticRelease" | "SchemaSnapshot" | "PolicyReceipt">(
  artifactType: T,
  authorityPolicyVersion = "grounding-authority@1.0.0",
) {
  return {
    schema_version: "data-agent-grounding-authority/v1",
    artifact_type: artifactType,
    artifact_ref: makeArtifactReference(artifactType),
    scope,
    run_id: ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic" as const,
      id: "grounding-registry",
    },
    authority: {
      kind: "deterministic" as const,
      id: artifactType === "PolicyReceipt" ? "policy-authority" : "grounding-authority",
      policy_version: authorityPolicyVersion,
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: hashes.input,
  };
}

function semanticReleaseDraft() {
  return {
    ...authorityBase("SemanticRelease"),
    semantic_release_version: "commerce-semantic@1.0.0",
    catalog_version: "commerce-catalog@1.0.0",
    datasource_id: ids.appA,
    metrics: [
      {
        metric_id: "metric.net_revenue",
        aliases: ["净收入"],
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
    dimensions: [
      {
        dimension_id: "dimension.customer_segment",
        aliases: ["客户分层"],
        table_id: "customers",
        column_id: "customers.segment",
        grain: "customer",
      },
    ],
  } as const;
}

function schemaSnapshotDraft() {
  return {
    ...authorityBase("SchemaSnapshot"),
    schema_snapshot_version: "commerce-schema@1.0.0",
    catalog_version: "commerce-catalog@1.0.0",
    datasource_id: ids.appA,
    tables: [
      {
        table_id: "orders",
        physical_name: "orders",
        columns: [
          {
            column_id: "orders.customer_id",
            physical_name: "customer_id",
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
      {
        table_id: "customers",
        physical_name: "customers",
        columns: [
          {
            column_id: "customers.id",
            physical_name: "id",
            data_type: "uuid",
            nullable: false,
            sensitivity: "INTERNAL",
          },
          {
            column_id: "customers.segment",
            physical_name: "segment",
            data_type: "text",
            nullable: true,
            sensitivity: "INTERNAL",
          },
        ],
      },
    ],
    relationships: [
      {
        relationship_id: "orders_customer",
        left_table_id: "orders",
        left_column_ids: ["orders.customer_id"],
        right_table_id: "customers",
        right_column_ids: ["customers.id"],
        cardinality: "many-to-one",
        left_row_match: "required",
        right_row_match: "optional",
      },
    ],
  } as const;
}

function policyReceiptDraft(
  references: {
    semantic_release_ref?: Extract<
      GroundingAuthorityReference,
      { artifact_type: "SemanticRelease" }
    >;
    schema_snapshot_ref?: Extract<GroundingAuthorityReference, { artifact_type: "SchemaSnapshot" }>;
  } = {},
) {
  return {
    ...authorityBase("PolicyReceipt", "analyst-policy@1.0.0"),
    policy_version: "analyst-policy@1.0.0",
    datasource_id: ids.appA,
    principal_id: "analyst@example.test",
    semantic_release_ref:
      references.semantic_release_ref ?? makeArtifactReference("SemanticRelease"),
    schema_snapshot_ref: references.schema_snapshot_ref ?? makeArtifactReference("SchemaSnapshot"),
    allowed_schema: {
      tables: [
        {
          table_id: "orders",
          column_ids: ["orders.customer_id", "orders.net_amount", "orders.created_at"],
        },
        {
          table_id: "customers",
          column_ids: ["customers.id", "customers.segment"],
        },
      ],
    },
    mandatory_predicates: [
      {
        table_id: "orders",
        column_id: "orders.customer_id",
        operator: "eq",
        parameter_key: "tenant_customer",
      },
    ],
  } as const;
}

async function sealDocument<T extends GroundingAuthorityDocument["artifact_type"]>(
  input: Readonly<{ artifact_type: T }> & Record<string, unknown>,
): Promise<Extract<GroundingAuthorityDocument, { artifact_type: T }>> {
  const documentHash = await computeGroundingAuthorityDocumentHash(input);
  const draft = groundingAuthorityDocumentSchema.parse(input);
  return groundingAuthorityDocumentSchema.parse({
    ...draft,
    artifact_ref: {
      ...draft.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  }) as Extract<GroundingAuthorityDocument, { artifact_type: T }>;
}

async function authorityFixture() {
  const semanticRelease = await sealDocument(semanticReleaseDraft());
  const schemaSnapshot = await sealDocument(schemaSnapshotDraft());
  const policyReceipt = await sealDocument(
    policyReceiptDraft({
      semantic_release_ref: semanticRelease.artifact_ref,
      schema_snapshot_ref: schemaSnapshot.artifact_ref,
    }),
  );
  const documents = [semanticRelease, schemaSnapshot, policyReceipt];
  const byReference = new Map(
    documents.map((document) => [artifactReferenceIdentity(document.artifact_ref), document]),
  );
  const authority: GroundingAuthorityVerificationContext = {
    principalId: "analyst@example.test",
    resolveCommitted: async (reference) =>
      structuredClone(byReference.get(artifactReferenceIdentity(reference)) ?? null),
    verifyCommitted: async (reference) => byReference.has(artifactReferenceIdentity(reference)),
  };
  return { authority, documents, policyReceipt, schemaSnapshot, semanticRelease };
}

describe("Grounding System Authority 契约", () => {
  it("公共入口不暴露可转移的权威品牌或品牌签发函数", () => {
    expect("authorizeGroundingAuthorityDocument" in publicContracts).toBe(false);
    expect("isAuthoritativeGroundingAuthorityDocument" in publicContracts).toBe(false);
    expect("verifyGroundingAuthorityDocument" in publicContracts).toBe(true);
  });

  it("三类文档按当前持久化上下文核验后只返回不可变快照", async () => {
    const { authority, documents } = await authorityFixture();

    for (const document of documents) {
      const verified = await verifyGroundingAuthorityDocument(document.artifact_ref, authority);

      expect(verified).toEqual(document);
      expect(Object.isFrozen(verified)).toBe(true);
      expect(Object.isFrozen(verified.artifact_ref)).toBe(true);
      expect(structuredClone(verified)).toEqual(document);
    }
  });

  it("公开分支 Schema 与联合 Schema 使用同一 Authority/唯一性约束", () => {
    expect(
      semanticReleaseDocumentSchema.safeParse({
        ...semanticReleaseDraft(),
        metrics: [...semanticReleaseDraft().metrics, semanticReleaseDraft().metrics[0]],
      }).success,
    ).toBe(false);
    expect(
      semanticReleaseDocumentSchema.safeParse({
        ...semanticReleaseDraft(),
        dimensions: [
          {
            ...semanticReleaseDraft().dimensions[0],
            dimension_id: "metric.net_revenue",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      schemaSnapshotDocumentSchema.safeParse({
        ...schemaSnapshotDraft(),
        tables: [...schemaSnapshotDraft().tables, schemaSnapshotDraft().tables[0]],
      }).success,
    ).toBe(false);
    expect(
      policyReceiptDocumentSchema.safeParse({
        ...policyReceiptDraft(),
        allowed_schema: {
          tables: [
            ...policyReceiptDraft().allowed_schema.tables,
            policyReceiptDraft().allowed_schema.tables[0],
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      policyReceiptDocumentSchema.safeParse({
        ...policyReceiptDraft(),
        mandatory_predicates: [
          ...policyReceiptDraft().mandatory_predicates,
          policyReceiptDraft().mandatory_predicates[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      semanticReleaseDocumentSchema.safeParse({
        ...semanticReleaseDraft(),
        artifact_ref: {
          ...semanticReleaseDraft().artifact_ref,
          tenant_id: ids.tenantB,
        },
      }).success,
    ).toBe(false);
    expect(
      policyReceiptDocumentSchema.safeParse({
        ...policyReceiptDraft(),
        authority: {
          kind: "deterministic",
          id: "policy-authority",
          policy_version: "analyst-policy@2.0.0",
        },
      }).success,
    ).toBe(false);
  });

  it("三分支内容足以核对 Catalog、Policy、Allowed Schema 与语义绑定", () => {
    const semanticRelease = groundingAuthorityDocumentSchema.parse(semanticReleaseDraft());
    const schemaSnapshot = groundingAuthorityDocumentSchema.parse(schemaSnapshotDraft());
    const policyReceipt = groundingAuthorityDocumentSchema.parse(policyReceiptDraft());

    expect(semanticRelease).toMatchObject({
      artifact_type: "SemanticRelease",
      catalog_version: "commerce-catalog@1.0.0",
      metrics: [{ metric_id: "metric.net_revenue" }],
      dimensions: [{ dimension_id: "dimension.customer_segment" }],
    });
    expect(schemaSnapshot).toMatchObject({
      artifact_type: "SchemaSnapshot",
      catalog_version: "commerce-catalog@1.0.0",
      relationships: [{ relationship_id: "orders_customer" }],
    });
    expect(policyReceipt).toMatchObject({
      artifact_type: "PolicyReceipt",
      policy_version: "analyst-policy@1.0.0",
      allowed_schema: {
        tables: [{ table_id: "orders" }, { table_id: "customers" }],
      },
      mandatory_predicates: [{ parameter_key: "tenant_customer" }],
    });
  });

  it("非确定性 producer/authority、引用异 Scope 或 Policy 版本漂移均失败关闭", () => {
    expect(
      groundingAuthorityDocumentSchema.safeParse({
        ...semanticReleaseDraft(),
        producer: { kind: "agent", id: "model-proposal" },
      }).success,
    ).toBe(false);
    expect(
      groundingAuthorityDocumentSchema.safeParse({
        ...semanticReleaseDraft(),
        authority: {
          kind: "human",
          id: "manual-approval",
          policy_version: "grounding-authority@1.0.0",
        },
      }).success,
    ).toBe(false);
    expect(
      groundingAuthorityDocumentSchema.safeParse({
        ...policyReceiptDraft(),
        schema_snapshot_ref: {
          ...makeArtifactReference("SchemaSnapshot"),
          tenant_id: ids.tenantB,
        },
      }).success,
    ).toBe(false);
    expect(
      groundingAuthorityDocumentSchema.safeParse({
        ...policyReceiptDraft(),
        authority: {
          kind: "deterministic",
          id: "grounding-authority",
          policy_version: "analyst-policy@2.0.0",
        },
      }).success,
    ).toBe(false);
  });

  it("Resolver 错 Revision、规范内容漂移或未提交引用均不能授权", async () => {
    const document = await sealDocument(semanticReleaseDraft());

    await expect(
      verifyGroundingAuthorityDocument(
        {
          ...document.artifact_ref,
          revision: document.artifact_ref.revision + 1,
        },
        {
          principalId: "analyst@example.test",
          resolveCommitted: async () => document,
          verifyCommitted: async () => true,
        },
      ),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);

    await expect(
      verifyGroundingAuthorityDocument(document.artifact_ref, {
        principalId: "analyst@example.test",
        resolveCommitted: async () => ({
          ...document,
          catalog_version: "commerce-catalog@2.0.0",
        }),
        verifyCommitted: async () => true,
      }),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);

    await expect(
      verifyGroundingAuthorityDocument(document.artifact_ref, {
        principalId: "analyst@example.test",
        resolveCommitted: async () => document,
        verifyCommitted: async () => false,
      }),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);
  });

  it("Policy Receipt 授权时同时要求其 SemanticRelease 与 SchemaSnapshot 引用已提交", async () => {
    const { authority, policyReceipt } = await authorityFixture();

    await expect(
      verifyGroundingAuthorityDocument(policyReceipt.artifact_ref, {
        ...authority,
        verifyCommitted: async (reference) => reference.artifact_type !== "SchemaSnapshot",
      }),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);
  });

  it("PolicyReceipt 只有在三份固定文档的 Datasource/Catalog/字段闭合时才能授权", async () => {
    const semanticRelease = await sealDocument(semanticReleaseDraft());
    const inconsistentSchema = await sealDocument({
      ...schemaSnapshotDraft(),
      catalog_version: "commerce-catalog@2.0.0",
    });
    const policyReceipt = await sealDocument(
      policyReceiptDraft({
        semantic_release_ref: semanticRelease.artifact_ref,
        schema_snapshot_ref: inconsistentSchema.artifact_ref,
      }),
    );
    const documents = [semanticRelease, inconsistentSchema, policyReceipt];
    const byReference = new Map(
      documents.map((document) => [artifactReferenceIdentity(document.artifact_ref), document]),
    );

    await expect(
      verifyGroundingAuthorityDocument(policyReceipt.artifact_ref, {
        principalId: "analyst@example.test",
        resolveCommitted: async (reference) =>
          byReference.get(artifactReferenceIdentity(reference)) ?? null,
        verifyCommitted: async (reference) => byReference.has(artifactReferenceIdentity(reference)),
      }),
    ).rejects.toThrow("Datasource/Catalog");
  });

  it("公共 Context 即使声称已提交，也不能授权伪造的 Producer/Authority Identity", async () => {
    const forged = await sealDocument({
      ...semanticReleaseDraft(),
      producer: { kind: "deterministic", id: "attacker-registry" },
      authority: {
        kind: "deterministic",
        id: "attacker-authority",
        policy_version: "grounding-authority@1.0.0",
      },
    });

    await expect(
      verifyGroundingAuthorityDocument(forged.artifact_ref, {
        principalId: "analyst@example.test",
        resolveCommitted: async () => forged,
        verifyCommitted: async () => true,
      }),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);
  });

  it("Grounding Authority Hash 绑定直接父 Revision，不能在不同父链重放", async () => {
    const parent = await sealDocument(semanticReleaseDraft());
    const revisionTwo = await sealDocument({
      ...semanticReleaseDraft(),
      artifact_ref: {
        ...parent.artifact_ref,
        revision: 2,
        content_hash: hashes.input,
      },
      parent_ref: parent.artifact_ref,
      semantic_release_version: "commerce-semantic@2.0.0",
    });
    const byReference = new Map(
      [parent, revisionTwo].map((document) => [
        artifactReferenceIdentity(document.artifact_ref),
        document,
      ]),
    );
    const authority: GroundingAuthorityVerificationContext = {
      principalId: "analyst@example.test",
      resolveCommitted: async (reference) =>
        byReference.get(artifactReferenceIdentity(reference)) ?? null,
      verifyCommitted: async (reference) => byReference.has(artifactReferenceIdentity(reference)),
    };

    await expect(
      verifyGroundingAuthorityDocument(revisionTwo.artifact_ref, authority),
    ).resolves.toMatchObject({ parent_ref: parent.artifact_ref });

    await expect(
      verifyGroundingAuthorityDocument(revisionTwo.artifact_ref, {
        principalId: "analyst@example.test",
        resolveCommitted: async (reference) =>
          artifactReferenceIdentity(reference) ===
          artifactReferenceIdentity(revisionTwo.artifact_ref)
            ? {
                ...revisionTwo,
                parent_ref: {
                  ...parent.artifact_ref,
                  content_hash: hashes.artifact,
                },
              }
            : parent,
        verifyCommitted: async () => true,
      }),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);
  });
});
