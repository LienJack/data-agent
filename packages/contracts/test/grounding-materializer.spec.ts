import { describe, expect, it, vi } from "vitest";
import {
  GroundingAuthorityError,
  type GroundingAuthorityOrigin,
  type GroundingAuthorityReference,
  groundingAuthorityOriginSchema,
  type PolicyReceiptDocument,
  type SchemaSnapshotDocument,
  type SemanticReleaseDocument,
  verifyGroundingAuthorityDocument,
} from "../src/artifacts/grounding-authority.js";
import {
  type AuthoritativePolicyReceipt,
  type AuthoritativeSchemaSnapshot,
  type AuthoritativeSemanticRelease,
  coordinateGroundingBundle,
  isAuthoritativeGroundingBundle,
  isAuthoritativePolicyReceipt,
  isAuthoritativeSchemaSnapshot,
  isAuthoritativeSemanticRelease,
  issuePolicyReceipt,
  issueSchemaSnapshot,
  issueSemanticRelease,
  materializeGroundingAuthority,
  registerTrustedGroundingCoordinator,
  registerTrustedGroundingMaterializer,
  registerTrustedPolicyReceiptIssuer,
  registerTrustedSchemaSnapshotIssuer,
  registerTrustedSemanticReleaseIssuer,
} from "../src/artifacts/grounding-materializer.js";
import { environments, hashes, ids } from "./fixtures.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

const fixtureOrigin: GroundingAuthorityOrigin = {
  origin: "fixture",
  fixture_version: "test-fixture@1.0.0",
};

const publishedOrigin: GroundingAuthorityOrigin = {
  origin: "published",
  published_version: "production@1.0.0",
};

function makeArtifactReference(
  artifactType: "SemanticRelease" | "SchemaSnapshot" | "PolicyReceipt",
) {
  return {
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: environments.test,
    run_id: ids.run,
    artifact_id: ids.artifact,
    artifact_type: artifactType,
    revision: 1,
    content_hash: hashes.input,
  } as const;
}

function makeSemanticReleaseDraft(
  overrides: {
    origin?: GroundingAuthorityOrigin;
    artifact_id?: string;
    run_id?: string;
    producer_id?: string;
    authority_id?: string;
    authority_policy_version?: string;
  } = {},
): SemanticReleaseDocument {
  const ref = {
    ...makeArtifactReference("SemanticRelease"),
    artifact_id: overrides.artifact_id ?? ids.artifact,
  };
  const draft = {
    schema_version: "data-agent-grounding-authority/v1" as const,
    artifact_type: "SemanticRelease" as const,
    artifact_ref: ref,
    scope,
    origin: groundingAuthorityOriginSchema.parse(overrides.origin ?? fixtureOrigin),
    run_id: overrides.run_id ?? ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic" as const,
      id: overrides.producer_id ?? "grounding-registry",
    },
    authority: {
      kind: "deterministic" as const,
      id: overrides.authority_id ?? "grounding-authority",
      policy_version: overrides.authority_policy_version ?? "grounding-authority@1.0.0",
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: hashes.input,
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
    dimensions: [],
  } as SemanticReleaseDocument;
  return draft;
}

function makeSchemaSnapshotDraft(
  overrides: {
    origin?: GroundingAuthorityOrigin;
    producer_id?: string;
    authority_id?: string;
  } = {},
): SchemaSnapshotDocument {
  const ref = makeArtifactReference("SchemaSnapshot");
  const draft = {
    schema_version: "data-agent-grounding-authority/v1" as const,
    artifact_type: "SchemaSnapshot" as const,
    artifact_ref: ref,
    scope,
    origin: groundingAuthorityOriginSchema.parse(overrides.origin ?? fixtureOrigin),
    run_id: ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic" as const,
      id: overrides.producer_id ?? "grounding-registry",
    },
    authority: {
      kind: "deterministic" as const,
      id: overrides.authority_id ?? "grounding-authority",
      policy_version: "grounding-authority@1.0.0",
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: hashes.input,
    schema_snapshot_version: "commerce-schema@1.0.0",
    catalog_version: "commerce-catalog@1.0.0",
    datasource_id: ids.appA,
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
  } as SchemaSnapshotDocument;
  return draft;
}

function makePolicyReceiptDraft(
  overrides: {
    origin?: GroundingAuthorityOrigin;
    semanticReleaseRef?: GroundingAuthorityReference;
    schemaSnapshotRef?: GroundingAuthorityReference;
    principalId?: string;
    producer_id?: string;
    authority_id?: string;
  } = {},
): PolicyReceiptDocument {
  const ref = makeArtifactReference("PolicyReceipt");
  const srRef = overrides.semanticReleaseRef ?? makeArtifactReference("SemanticRelease");
  const ssRef = overrides.schemaSnapshotRef ?? makeArtifactReference("SchemaSnapshot");
  const draft = {
    schema_version: "data-agent-grounding-authority/v1" as const,
    artifact_type: "PolicyReceipt" as const,
    artifact_ref: ref,
    scope,
    origin: groundingAuthorityOriginSchema.parse(overrides.origin ?? fixtureOrigin),
    run_id: ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic" as const,
      id: overrides.producer_id ?? "grounding-registry",
    },
    authority: {
      kind: "deterministic" as const,
      id: overrides.authority_id ?? "policy-authority",
      policy_version: "default-policy@1.0.0",
    },
    created_at: "2026-07-26T00:00:00.000Z",
    document_hash: hashes.input,
    policy_version: "default-policy@1.0.0",
    datasource_id: ids.appA,
    principal_id: overrides.principalId ?? "test-issuer",
    semantic_release_ref: srRef,
    schema_snapshot_ref: ssRef,
    allowed_schema: {
      tables: [
        {
          table_id: "orders",
          column_ids: ["orders.tenant_id", "orders.net_amount", "orders.created_at"],
        },
      ],
    },
    mandatory_predicates: [],
  } as PolicyReceiptDocument;
  return draft;
}

function createMockAdapter(principalId = "test-issuer") {
  return {
    principal_id: principalId,
    resolveCommitted: vi.fn().mockResolvedValue({}),
    verifyCommitted: vi.fn().mockResolvedValue(true),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Grounding Authority Materializer", () => {
  // ─── Registration ──────────────────────────────────────────────────────────

  describe("registration", () => {
    it("注册有效的 SemanticReleaseIssuer", () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedSemanticReleaseIssuer(adapter);
      expect(issuer).toBeDefined();
      expect(issuer.principal_id).toBe("test-issuer");
    });

    it("拒绝无效的 SemanticReleaseIssuer 适配器——空 principal_id", () => {
      expect(() =>
        registerTrustedSemanticReleaseIssuer({
          principal_id: "",
          resolveCommitted: vi.fn(),
          verifyCommitted: vi.fn(),
        }),
      ).toThrow("SEMANTIC_RELEASE_ISSUER_INVALID_ADAPTER");
    });

    it("拒绝无效的 SemanticReleaseIssuer 适配器——缺少 resolveCommitted", () => {
      expect(() =>
        registerTrustedSemanticReleaseIssuer({
          principal_id: "issuer",
          resolveCommitted: undefined as unknown as () => Promise<unknown>,
          verifyCommitted: vi.fn(),
        }),
      ).toThrow("SEMANTIC_RELEASE_ISSUER_INVALID_ADAPTER");
    });

    it("拒绝无效的 SemanticReleaseIssuer 适配器——缺少 verifyCommitted", () => {
      expect(() =>
        registerTrustedSemanticReleaseIssuer({
          principal_id: "issuer",
          resolveCommitted: vi.fn(),
          verifyCommitted: undefined as unknown as () => Promise<boolean>,
        }),
      ).toThrow("SEMANTIC_RELEASE_ISSUER_INVALID_ADAPTER");
    });

    it("注册有效的 SchemaSnapshotIssuer", () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedSchemaSnapshotIssuer(adapter);
      expect(issuer).toBeDefined();
      expect(issuer.principal_id).toBe("test-issuer");
    });

    it("拒绝无效的 SchemaSnapshotIssuer 适配器", () => {
      expect(() =>
        registerTrustedSchemaSnapshotIssuer({
          principal_id: "",
          resolveCommitted: vi.fn(),
          verifyCommitted: vi.fn(),
        }),
      ).toThrow("SCHEMA_SNAPSHOT_ISSUER_INVALID_ADAPTER");
    });

    it("注册有效的 PolicyReceiptIssuer", () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedPolicyReceiptIssuer(adapter);
      expect(issuer).toBeDefined();
      expect(issuer.principal_id).toBe("test-issuer");
    });

    it("拒绝无效的 PolicyReceiptIssuer 适配器", () => {
      expect(() =>
        registerTrustedPolicyReceiptIssuer({
          principal_id: "",
          resolveCommitted: vi.fn(),
          verifyCommitted: vi.fn(),
        }),
      ).toThrow("POLICY_RECEIPT_ISSUER_INVALID_ADAPTER");
    });

    it("注册有效的 GroundingCoordinator", () => {
      const coordinator = registerTrustedGroundingCoordinator({
        principal_id: "test-coordinator",
      });
      expect(coordinator).toBeDefined();
      expect(coordinator.principal_id).toBe("test-coordinator");
    });

    it("拒绝无效的 GroundingCoordinator——空 principal_id", () => {
      expect(() =>
        registerTrustedGroundingCoordinator({
          principal_id: "",
        }),
      ).toThrow("GROUNDING_COORDINATOR_INVALID_ADAPTER");
    });

    it("注册有效的 GroundingMaterializer", () => {
      const materializer = registerTrustedGroundingMaterializer({
        principal_id: "test-materializer",
      });
      expect(materializer).toBeDefined();
      expect(materializer.principal_id).toBe("test-materializer");
    });

    it("拒绝无效的 GroundingMaterializer——空 principal_id", () => {
      expect(() =>
        registerTrustedGroundingMaterializer({
          principal_id: "",
        }),
      ).toThrow("GROUNDING_MATERIALIZER_INVALID_ADAPTER");
    });
  });

  // ─── Issuing Documents ─────────────────────────────────────────────────────

  describe("issueSemanticRelease", () => {
    it("成功签发有效的 SemanticRelease 文档", async () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedSemanticReleaseIssuer(adapter);
      const draft = makeSemanticReleaseDraft();

      const result = await issueSemanticRelease({
        issuer,
        document: draft,
        origin: fixtureOrigin,
      });

      expect(isAuthoritativeSemanticRelease(result)).toBe(true);
      expect(result.document.artifact_type).toBe("SemanticRelease");
      expect(result.document.origin.origin).toBe("fixture");
      expect(result.reference.artifact_type).toBe("SemanticRelease");
      // verifyCommitted 应该被调用
      expect(adapter.verifyCommitted).toHaveBeenCalled();
    });

    it("签发 Published 文档保留 published_version", async () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedSemanticReleaseIssuer(adapter);
      const draft = makeSemanticReleaseDraft();

      const result = await issueSemanticRelease({
        issuer,
        document: draft,
        origin: publishedOrigin,
      });

      expect(isAuthoritativeSemanticRelease(result)).toBe(true);
      expect(result.document.origin.origin).toBe("published");
      if (result.document.origin.origin === "published") {
        expect(result.document.origin.published_version).toBe("production@1.0.0");
      }
    });

    it("拒绝未注册的 issuer", async () => {
      const draft = makeSemanticReleaseDraft();
      const fakeIssuer = { principal_id: "fake" };

      await expect(
        issueSemanticRelease({
          issuer: fakeIssuer,
          document: draft,
          origin: fixtureOrigin,
        }),
      ).rejects.toThrow("SEMANTIC_RELEASE_ISSUER_REQUIRED");
    });

    it("拒绝未提交的文档", async () => {
      const adapter = createMockAdapter();
      adapter.verifyCommitted.mockResolvedValue(false);
      const issuer = registerTrustedSemanticReleaseIssuer(adapter);
      const draft = makeSemanticReleaseDraft();

      await expect(
        issueSemanticRelease({
          issuer,
          document: draft,
          origin: fixtureOrigin,
        }),
      ).rejects.toThrow(GroundingAuthorityError);
    });

    it("拒绝身份不匹配的文档", async () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedSemanticReleaseIssuer(adapter);
      const draft = makeSemanticReleaseDraft({ producer_id: "wrong-producer" });

      await expect(
        issueSemanticRelease({
          issuer,
          document: draft,
          origin: fixtureOrigin,
        }),
      ).rejects.toThrow(GroundingAuthorityError);
    });
  });

  describe("issueSchemaSnapshot", () => {
    it("成功签发有效的 SchemaSnapshot 文档", async () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedSchemaSnapshotIssuer(adapter);
      const draft = makeSchemaSnapshotDraft();

      const result = await issueSchemaSnapshot({
        issuer,
        document: draft,
        origin: fixtureOrigin,
      });

      expect(isAuthoritativeSchemaSnapshot(result)).toBe(true);
      expect(result.document.artifact_type).toBe("SchemaSnapshot");
      expect(result.document.origin.origin).toBe("fixture");
      expect(adapter.verifyCommitted).toHaveBeenCalled();
    });

    it("拒绝未注册的 issuer", async () => {
      await expect(
        issueSchemaSnapshot({
          issuer: { principal_id: "fake" },
          document: makeSchemaSnapshotDraft(),
          origin: fixtureOrigin,
        }),
      ).rejects.toThrow("SCHEMA_SNAPSHOT_ISSUER_REQUIRED");
    });
  });

  describe("issuePolicyReceipt", () => {
    it("成功签发有效的 PolicyReceipt 文档", async () => {
      const adapter = createMockAdapter();
      const issuer = registerTrustedPolicyReceiptIssuer(adapter);
      const draft = makePolicyReceiptDraft();

      const result = await issuePolicyReceipt({
        issuer,
        document: draft,
        origin: fixtureOrigin,
      });

      expect(isAuthoritativePolicyReceipt(result)).toBe(true);
      expect(result.document.artifact_type).toBe("PolicyReceipt");
      expect(result.document.origin.origin).toBe("fixture");
      expect(adapter.verifyCommitted).toHaveBeenCalled();
    });

    it("拒绝未注册的 issuer", async () => {
      await expect(
        issuePolicyReceipt({
          issuer: { principal_id: "fake" },
          document: makePolicyReceiptDraft(),
          origin: fixtureOrigin,
        }),
      ).rejects.toThrow("POLICY_RECEIPT_ISSUER_REQUIRED");
    });
  });

  // ─── Coordinator ───────────────────────────────────────────────────────────

  describe("coordinateGroundingBundle", () => {
    it("协调有效的 bundle——三个已签发的文档", async () => {
      const srAdapter = createMockAdapter();
      const ssAdapter = createMockAdapter();
      const prAdapter = createMockAdapter();
      const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
      const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
      const prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
      const coordinator = registerTrustedGroundingCoordinator({ principal_id: "test-coordinator" });

      const sr = await issueSemanticRelease({
        issuer: srIssuer,
        document: makeSemanticReleaseDraft(),
        origin: fixtureOrigin,
      });
      const ss = await issueSchemaSnapshot({
        issuer: ssIssuer,
        document: makeSchemaSnapshotDraft(),
        origin: fixtureOrigin,
      });
      // 让 PolicyReceipt 引用正确的 SR/SS
      const prDraft = makePolicyReceiptDraft({
        semanticReleaseRef: sr.reference,
        schemaSnapshotRef: ss.reference,
      });
      const pr = await issuePolicyReceipt({
        issuer: prIssuer,
        document: prDraft,
        origin: fixtureOrigin,
      });

      const bundle = await coordinateGroundingBundle({
        coordinator,
        semanticRelease: sr,
        schemaSnapshot: ss,
        policyReceipt: pr,
      });

      expect(isAuthoritativeGroundingBundle(bundle)).toBe(true);
      expect(bundle.semanticRelease.document.artifact_type).toBe("SemanticRelease");
      expect(bundle.schemaSnapshot.document.artifact_type).toBe("SchemaSnapshot");
      expect(bundle.policyReceipt.document.artifact_type).toBe("PolicyReceipt");
      expect(bundle.origin.origin).toBe("fixture");
    });

    it("拒绝未注册的 coordinator", async () => {
      const sr = {
        document: makeSemanticReleaseDraft(),
        reference: makeArtifactReference("SemanticRelease"),
      } as unknown as AuthoritativeSemanticRelease;
      const ss = {
        document: makeSchemaSnapshotDraft(),
        reference: makeArtifactReference("SchemaSnapshot"),
      } as unknown as AuthoritativeSchemaSnapshot;
      const pr = {
        document: makePolicyReceiptDraft(),
        reference: makeArtifactReference("PolicyReceipt"),
      } as unknown as AuthoritativePolicyReceipt;

      await expect(
        coordinateGroundingBundle({
          coordinator: { principal_id: "fake" },
          semanticRelease: sr,
          schemaSnapshot: ss,
          policyReceipt: pr,
        }),
      ).rejects.toThrow("GROUNDING_COORDINATOR_REQUIRED");
    });

    it("拒绝 origin 不一致的 bundle", async () => {
      const srAdapter = createMockAdapter();
      const ssAdapter = createMockAdapter();
      const prAdapter = createMockAdapter();
      const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
      const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
      const _prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
      const coordinator = registerTrustedGroundingCoordinator({ principal_id: "test-coordinator" });

      // 签发 SR 和 SS 为 fixture，PR 为 published
      const sr = await issueSemanticRelease({
        issuer: srIssuer,
        document: makeSemanticReleaseDraft(),
        origin: fixtureOrigin,
      });
      const ss = await issueSchemaSnapshot({
        issuer: ssIssuer,
        document: makeSchemaSnapshotDraft(),
        origin: fixtureOrigin,
      });
      const prDraft = makePolicyReceiptDraft({
        semanticReleaseRef: sr.reference,
        schemaSnapshotRef: ss.reference,
        origin: publishedOrigin,
      });

      await expect(
        // 直接使用未注册的 PR（跳过 issue 步骤，因为 issue 会注入 origin 覆盖 draft 的 origin）
        coordinateGroundingBundle({
          coordinator,
          semanticRelease: sr,
          schemaSnapshot: ss,
          policyReceipt: await (async () => {
            const prAdapter2 = createMockAdapter();
            const prIssuer2 = registerTrustedPolicyReceiptIssuer(prAdapter2);
            return issuePolicyReceipt({
              issuer: prIssuer2,
              document: prDraft,
              origin: publishedOrigin,
            });
          })(),
        }),
      ).rejects.toThrow(GroundingAuthorityError);
    });
  });

  // ─── Materializer ──────────────────────────────────────────────────────────

  describe("materializeGroundingAuthority", () => {
    it("完整的物化流程——签发并核验三个文档", async () => {
      const srAdapter = createMockAdapter();
      const ssAdapter = createMockAdapter();
      const prAdapter = createMockAdapter();
      const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
      const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
      const prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
      const coordinator = registerTrustedGroundingCoordinator({ principal_id: "coordinator" });
      const materializer = registerTrustedGroundingMaterializer({ principal_id: "materializer" });

      const srDraft = makeSemanticReleaseDraft();
      const ssDraft = makeSchemaSnapshotDraft();

      // 让 PR 引用与 SR/SS 相同的 artifact identity
      // （artifact_id 与 revision 均匹配，materializer 会并行签发三个文档）
      const prDraft = makePolicyReceiptDraft({
        semanticReleaseRef: makeArtifactReference("SemanticRelease"),
        schemaSnapshotRef: makeArtifactReference("SchemaSnapshot"),
      });

      const result = await materializeGroundingAuthority({
        materializer,
        semanticReleaseIssuer: srIssuer,
        schemaSnapshotIssuer: ssIssuer,
        policyReceiptIssuer: prIssuer,
        coordinator,
        semanticRelease: srDraft,
        schemaSnapshot: ssDraft,
        policyReceipt: prDraft,
        origin: fixtureOrigin,
      });

      expect(result).toBeDefined();
      expect(isAuthoritativeGroundingBundle(result.bundle)).toBe(true);
      expect(result.origin.origin).toBe("fixture");
    });

    it("拒绝未注册的 materializer", async () => {
      const srDraft = makeSemanticReleaseDraft();
      const ssDraft = makeSchemaSnapshotDraft();
      const prDraft = makePolicyReceiptDraft();

      await expect(
        materializeGroundingAuthority({
          materializer: { principal_id: "fake" },
          semanticReleaseIssuer: { principal_id: "fake" },
          schemaSnapshotIssuer: { principal_id: "fake" },
          policyReceiptIssuer: { principal_id: "fake" },
          coordinator: { principal_id: "fake" },
          semanticRelease: srDraft,
          schemaSnapshot: ssDraft,
          policyReceipt: prDraft,
          origin: fixtureOrigin,
        }),
      ).rejects.toThrow("GROUNDING_MATERIALIZER_REQUIRED");
    });
  });
});

// ─── Fixture/Published Isolation in Materializer ──────────────────────────────

describe("Fixture/Published Isolation in Materializer", () => {
  it("materializeGroundingAuthority 使用 fixture origin 时所有文档 origin 一致", async () => {
    const srAdapter = createMockAdapter();
    const ssAdapter = createMockAdapter();
    const prAdapter = createMockAdapter();
    const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
    const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
    const prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
    const coordinator = registerTrustedGroundingCoordinator({ principal_id: "coordinator" });
    const materializer = registerTrustedGroundingMaterializer({ principal_id: "materializer" });

    const srDraft = makeSemanticReleaseDraft();
    const ssDraft = makeSchemaSnapshotDraft();
    const prDraft = makePolicyReceiptDraft({
      semanticReleaseRef: makeArtifactReference("SemanticRelease"),
      schemaSnapshotRef: makeArtifactReference("SchemaSnapshot"),
    });

    const result = await materializeGroundingAuthority({
      materializer,
      semanticReleaseIssuer: srIssuer,
      schemaSnapshotIssuer: ssIssuer,
      policyReceiptIssuer: prIssuer,
      coordinator,
      semanticRelease: srDraft,
      schemaSnapshot: ssDraft,
      policyReceipt: prDraft,
      origin: fixtureOrigin,
    });

    // 所有文档的 origin 应该一致，都是 fixture
    expect(result.origin.origin).toBe("fixture");
    expect(result.bundle.semanticRelease.document.origin.origin).toBe("fixture");
    expect(result.bundle.schemaSnapshot.document.origin.origin).toBe("fixture");
    expect(result.bundle.policyReceipt.document.origin.origin).toBe("fixture");
  });

  it("materializeGroundingAuthority 使用 published origin 时所有文档 origin 一致", async () => {
    const srAdapter = createMockAdapter();
    const ssAdapter = createMockAdapter();
    const prAdapter = createMockAdapter();
    const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
    const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
    const prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
    const coordinator = registerTrustedGroundingCoordinator({ principal_id: "coordinator" });
    const materializer = registerTrustedGroundingMaterializer({ principal_id: "materializer" });

    const srDraft = makeSemanticReleaseDraft();
    const ssDraft = makeSchemaSnapshotDraft();
    const prDraft = makePolicyReceiptDraft({
      semanticReleaseRef: makeArtifactReference("SemanticRelease"),
      schemaSnapshotRef: makeArtifactReference("SchemaSnapshot"),
    });

    const result = await materializeGroundingAuthority({
      materializer,
      semanticReleaseIssuer: srIssuer,
      schemaSnapshotIssuer: ssIssuer,
      policyReceiptIssuer: prIssuer,
      coordinator,
      semanticRelease: srDraft,
      schemaSnapshot: ssDraft,
      policyReceipt: prDraft,
      origin: publishedOrigin,
    });

    // 所有文档的 origin 应该一致，都是 published
    expect(result.origin.origin).toBe("published");
    expect(result.bundle.semanticRelease.document.origin.origin).toBe("published");
    expect(result.bundle.schemaSnapshot.document.origin.origin).toBe("published");
    expect(result.bundle.policyReceipt.document.origin.origin).toBe("published");
  });

  it("coordinateGroundingBundle 拒绝 fixture/published 混合 origin", async () => {
    const srAdapter = createMockAdapter();
    const ssAdapter = createMockAdapter();
    const prAdapter = createMockAdapter();
    const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
    const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
    const _prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
    const coordinator = registerTrustedGroundingCoordinator({ principal_id: "test-coordinator" });

    // 签发 SR 和 SS 为 fixture
    const sr = await issueSemanticRelease({
      issuer: srIssuer,
      document: makeSemanticReleaseDraft(),
      origin: fixtureOrigin,
    });
    const ss = await issueSchemaSnapshot({
      issuer: ssIssuer,
      document: makeSchemaSnapshotDraft(),
      origin: fixtureOrigin,
    });

    // 用不同的 adapter 签发 PR 为 published
    const prAdapter2 = createMockAdapter();
    const prIssuer2 = registerTrustedPolicyReceiptIssuer(prAdapter2);
    const pr = await issuePolicyReceipt({
      issuer: prIssuer2,
      document: makePolicyReceiptDraft({
        semanticReleaseRef: sr.reference,
        schemaSnapshotRef: ss.reference,
        origin: publishedOrigin,
      }),
      origin: publishedOrigin,
    });

    // coordinator 应该拒绝混合 origin 的 bundle
    await expect(
      coordinateGroundingBundle({
        coordinator,
        semanticRelease: sr,
        schemaSnapshot: ss,
        policyReceipt: pr,
      }),
    ).rejects.toThrow(GroundingAuthorityError);
  });

  it("fixture-origin 文档不能被 published coordinator 消费", async () => {
    const srAdapter = createMockAdapter();
    const ssAdapter = createMockAdapter();
    const prAdapter = createMockAdapter();
    const srIssuer = registerTrustedSemanticReleaseIssuer(srAdapter);
    const ssIssuer = registerTrustedSchemaSnapshotIssuer(ssAdapter);
    const prIssuer = registerTrustedPolicyReceiptIssuer(prAdapter);
    const coordinator = registerTrustedGroundingCoordinator({ principal_id: "coordinator" });

    // 签发 fixture-origin 文档
    const sr = await issueSemanticRelease({
      issuer: srIssuer,
      document: makeSemanticReleaseDraft(),
      origin: fixtureOrigin,
    });
    const ss = await issueSchemaSnapshot({
      issuer: ssIssuer,
      document: makeSchemaSnapshotDraft(),
      origin: fixtureOrigin,
    });
    const prDraft = makePolicyReceiptDraft({
      semanticReleaseRef: sr.reference,
      schemaSnapshotRef: ss.reference,
    });
    const pr = await issuePolicyReceipt({
      issuer: prIssuer,
      document: prDraft,
      origin: fixtureOrigin,
    });

    // fixture-origin 文档可以被 fixture coordinator 消费
    const bundle = await coordinateGroundingBundle({
      coordinator,
      semanticRelease: sr,
      schemaSnapshot: ss,
      policyReceipt: pr,
    });
    expect(bundle.origin.origin).toBe("fixture");

    // 但 fixture-origin 文档不能通过 published resolver 验证
    const productionResolver = {
      principalId: "production-resolver",
      resolveCommitted: async () => null,
      verifyCommitted: async () => false,
    };

    // fixture-origin 文档在 production resolver 中不存在
    await expect(
      verifyGroundingAuthorityDocument(sr.document.artifact_ref, productionResolver),
    ).rejects.toBeInstanceOf(GroundingAuthorityError);
  });
});
