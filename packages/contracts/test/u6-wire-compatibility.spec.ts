import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR } from "../../../scripts/u6-c2-physical-schema.js";
import {
  knownArtifactTypeSchema,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  l2ArtifactTypeSchema,
  versionFrontierSchema,
} from "../src/artifacts/index.js";

// ─── U6 Wire Compatibility Gate ───────────────────────────────────────────────
//
// 此门禁验证 U10.0/U10.1a 不新增 U6 Artifact / VersionFrontier 字段。
//
// 失败条件：
//   - versionFrontierSchema 新增或减少字段（必须恰好 5 个）。
//   - L2_RESEARCH_WIRE_VERSION_MATRIX 新增了 U10 引入的 artifact type。
//   - C2 descriptor 的 status 从 FROZEN_TABLE_SURFACE 改变。
//   - C2 descriptor 的 installable 从 false 改变（U6 remainder 未闭合前必须保持）。
//
// ───────────────────────────────────────────────────────────────────────────────

// ─── 1. VersionFrontier Schema 恰好 5 个字段 ──────────────────────────────────

describe("U6 Wire Compatibility: VersionFrontier schema", () => {
  const expectedFields = [
    "semantic_release_ref",
    "schema_snapshot_ref",
    "data_snapshot",
    "policy_receipt_ref",
    "identity_binding",
  ] as const;

  it("versionFrontierSchema 恰好有 5 个字段，不可扩展", () => {
    const shape = versionFrontierSchema.shape;
    const keys = Object.keys(shape);
    expect(keys).toHaveLength(5);
    expect(keys.sort()).toEqual([...expectedFields].sort());
  });

  it("versionFrontierSchema 拒绝额外字段", () => {
    const validFrontier = {
      semantic_release_ref: {
        app_id: "00000000-0000-4000-8000-000000000001",
        tenant_id: "00000000-0000-4000-8000-000000000002",
        environment: "test",
        run_id: "00000000-0000-4000-8000-000000000003",
        artifact_id: "00000000-0000-4000-8000-000000000004",
        artifact_type: "SemanticRelease",
        revision: 1,
        content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      schema_snapshot_ref: {
        app_id: "00000000-0000-4000-8000-000000000001",
        tenant_id: "00000000-0000-4000-8000-000000000002",
        environment: "test",
        run_id: "00000000-0000-4000-8000-000000000003",
        artifact_id: "00000000-0000-4000-8000-000000000005",
        artifact_type: "SchemaSnapshot",
        revision: 1,
        content_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      data_snapshot: {
        protocol_version: "data-snapshot-binding@1.0.0",
        datasource_id: "00000000-0000-4000-8000-000000000001",
        strategy: "NONE",
        snapshot_token: null,
        schema_manifest_hash: null,
        data_manifest_hash: null,
        fixture_manifest_hash: null,
        replay_state: "REPLAY_UNAVAILABLE",
        binding_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
      policy_receipt_ref: {
        app_id: "00000000-0000-4000-8000-000000000001",
        tenant_id: "00000000-0000-4000-8000-000000000002",
        environment: "test",
        run_id: "00000000-0000-4000-8000-000000000003",
        artifact_id: "00000000-0000-4000-8000-000000000006",
        artifact_type: "PolicyReceipt",
        revision: 1,
        content_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
      identity_binding: {
        principal_id: "test-principal",
        delegation_chain_hash:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        authority_epoch: 1,
      },
    };
    expect(versionFrontierSchema.safeParse(validFrontier).success).toBe(true);
    // 拒绝额外字段
    expect(
      versionFrontierSchema.safeParse({ ...validFrontier, extra_field: "should_fail" }).success,
    ).toBe(false);
  });
});

// ─── 2. L2_RESEARCH_WIRE_VERSION_MATRIX 无新增 Artifact Type ──────────────────

describe("U6 Wire Compatibility: Version Matrix", () => {
  // 冻结的基线：U6 注册的 artifact types，不含 U10 新增
  const frozenTypes = [
    "ResearchBrief",
    "HypothesisSet",
    "EvidencePlan",
    "ObligationExecutionDecision",
    "QueryEvidence",
    "AtomicClaim",
    "EvidenceRelation",
    "EvidenceCheckReceipt",
    "SupportDecision",
    "HypothesisAssessment",
    "CoverageState",
    "ResearchStopDecision",
    "ReportManifest",
    "AnalysisReport",
    "ReportProjectionReceipt",
    "EvidenceGateReceipt",
    "ReportReadyCertificate",
    "ReadinessRevocationReceipt",
  ] as const;

  it("L2_RESEARCH_WIRE_VERSION_MATRIX 的 artifact types 不超出冻结基线", () => {
    const currentTypes = L2_RESEARCH_WIRE_VERSION_MATRIX.map((entry) => entry[0]);
    const uniqueTypes = [...new Set(currentTypes)];
    for (const artifactType of currentTypes) {
      expect(frozenTypes.includes(artifactType as (typeof frozenTypes)[number])).toBe(true);
    }
    expect(uniqueTypes).toHaveLength(frozenTypes.length);
    expect(uniqueTypes.sort()).toEqual([...frozenTypes].sort());
  });

  it("L2_RESEARCH_WIRE_VERSION_MATRIX 不包含 U10 grounding authority 类型", () => {
    const currentTypes = L2_RESEARCH_WIRE_VERSION_MATRIX.map((entry) => entry[0]);
    const u10Types = ["SemanticRelease", "SchemaSnapshot", "PolicyReceipt", "SemanticSourceBundle"];
    for (const u10Type of u10Types) {
      expect(currentTypes).not.toContain(u10Type);
    }
  });

  it("L2_RESEARCH_WIRE_VERSION_MATRIX 不包含 U10 descriptive contribution 类型", () => {
    const currentTypes = L2_RESEARCH_WIRE_VERSION_MATRIX.map((entry) => entry[0]);
    const u10ContributionTypes = [
      "DescriptiveContributionProfileProjection",
      "ContributionReceiptSubject",
      "ContributionSubjectManifest",
    ];
    for (const ct of u10ContributionTypes) {
      expect(currentTypes).not.toContain(ct);
    }
  });

  it("L2_RESEARCH_WIRE_VERSION_MATRIX 不包含 F9/Attribution 类型", () => {
    const currentTypes = L2_RESEARCH_WIRE_VERSION_MATRIX.map((entry) => entry[0]);
    const f9Types = [
      "AttributionProfileRequest",
      "AttributionProfileSubscription",
      "AttributionKernelEvidence",
      "AttributionFeasibilityVerdict",
      "AttributionCapabilityDirectory",
      "AttributionEligibilityDecision",
    ];
    for (const ft of f9Types) {
      expect(currentTypes).not.toContain(ft);
    }
  });

  it("knownArtifactTypeSchema 正确包含系统级 U10 类型（这些是合法系统类型，非 L2 研究类型）", () => {
    const u10GroundingTypes = [
      "SemanticRelease",
      "SchemaSnapshot",
      "PolicyReceipt",
      "SemanticSourceBundle",
    ];
    for (const gt of u10GroundingTypes) {
      expect(knownArtifactTypeSchema.safeParse(gt).success).toBe(true);
    }
  });

  it("l2ArtifactTypeSchema 不包含 U10 grounding authority 类型", () => {
    const u10GroundingTypes = [
      "SemanticRelease",
      "SchemaSnapshot",
      "PolicyReceipt",
      "SemanticSourceBundle",
    ];
    for (const gt of u10GroundingTypes) {
      expect(l2ArtifactTypeSchema.safeParse(gt).success).toBe(false);
    }
  });
});

// ─── 3. 10600 Migration 存在（U6-C2a 已闭合）─────────────────────────────────

describe("U6 Wire Compatibility: Migration", () => {
  it("infra/supabase/apps/data-agent/migrations/ 包含 10600 迁移文件（U6-C2a 已闭合）", () => {
    const migrationDir = join(__dirname, "../../../infra/supabase/apps/data-agent/migrations");
    const files = readdirSync(migrationDir);
    const c2Migrations = files.filter((f) => f.includes("10600") || f.includes("10601"));
    // 10600 是 U6-C2a 派生回执迁移，10601 是受控 Fixture 迁移
    expect(c2Migrations).toHaveLength(2);
  });

  it("Migration 文件数应为 17 个（15 基线 + 10600 + 10601）", () => {
    const migrationDir = join(__dirname, "../../../infra/supabase/apps/data-agent/migrations");
    const files = readdirSync(migrationDir);
    // 10600 和 10601 是 U6-C2a 闭合后新增的迁移
    expect(files).toHaveLength(17);
    expect(files.some((f) => f.includes("10600"))).toBe(true);
    expect(files.some((f) => f.includes("10601"))).toBe(true);
  });
});

// ─── 4. C2 Descriptor 保持 NOT_INSTALLABLE ────────────────────────────────────

describe("U6 Wire Compatibility: C2 descriptor", () => {
  it("U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR 的 installable 必须为 false", () => {
    expect(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.installable).toBe(false);
  });

  it("U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR 的 status 必须为 FROZEN_TABLE_SURFACE", () => {
    expect(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.status).toBe("FROZEN_TABLE_SURFACE");
  });

  it("U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR 的 protocol_version 必须正确", () => {
    expect(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.protocol_version).toBe(
      "u6-c2-physical-schema-descriptor@1.0.0",
    );
  });

  it("U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR 的物理描述符 hash 保持不变", () => {
    // 从脚本导出的已冻结 hash
    expect(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.physical_descriptor_hash).toBe(
      "sha256:b848930cc4cd97148cf5209983b1d4637f8550c219d697be08fe0dd2c657f8d9",
    );
  });

  it("U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR 的 baseline migration 为 U6 研究 Authority", () => {
    expect(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.baseline.migration_name).toBe(
      "20260725010590_app_data_agent_u6_research_authority.sql",
    );
  });
});
