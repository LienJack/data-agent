import type { PostgresSemanticExplorerReader } from "@data-agent/platform/semantic-postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  verifyPackage: vi.fn(),
  verifyEnvelope: vi.fn(),
  validateClosure: vi.fn(),
}));

vi.mock("@data-agent/contracts/context", () => ({
  verifySemanticContextPackage: shared.verifyPackage,
}));
vi.mock("@data-agent/semantic/production", () => ({
  verifySemanticReleaseEnvelope: shared.verifyEnvelope,
  validateSemanticRuntimeClosure: shared.validateClosure,
}));

import { createFrozenSemanticReleaseReadPort } from "../src/semantic/semantic-release-read-port.js";

const id = (suffix: number) => `72000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const datasourceId = id(4);
const releaseId = id(5);
const projectionRefs = {
  executable: { projection_id: id(10), projection_digest: hash("a") },
  relationship: { projection_id: id(11), projection_digest: hash("b") },
  runtime_restriction: { projection_id: id(12), projection_digest: hash("c") },
  graph: { projection_id: id(13), projection_digest: hash("d") },
} as const;
const packageDocument = {
  semantic_domain: "falcon24",
  semantic_release: {
    resource_id: releaseId,
    resource_revision: 2,
    resource_hash: hash("e"),
    datasource_id: datasourceId,
  },
};
const explorerEnvelope = {
  source_kind: "HISTORICAL",
  observed_at: "2026-08-28T00:00:00.000Z",
  pointer: {
    semantic_domain: "falcon24",
    current_release_id: releaseId,
    current_release_generation: 2,
    current_release_digest: hash("e"),
    pointer_generation: 4,
    updated_at: "2026-08-28T00:00:00.000Z",
  },
  release: {
    semantic_domain: "falcon24",
    release_id: releaseId,
    release_generation: 2,
    release_digest: hash("e"),
    compiler_bundle_digest: hash("f"),
    candidate_id: id(6),
    executable_projection_ref: projectionRefs.executable.projection_id,
    executable_projection_hash: projectionRefs.executable.projection_digest,
    relationship_projection_ref: projectionRefs.relationship.projection_id,
    relationship_projection_hash: projectionRefs.relationship.projection_digest,
    runtime_restriction_projection_ref: projectionRefs.runtime_restriction.projection_id,
    runtime_restriction_projection_hash: projectionRefs.runtime_restriction.projection_digest,
    published_at: "2026-08-28T00:00:00.000Z",
    published_by: id(7),
  },
  executable_projection: {
    projection_id: projectionRefs.executable.projection_id,
    release_id: releaseId,
    projection_digest: projectionRefs.executable.projection_digest,
    projection_payload: {},
  },
  relationship_projection: {
    projection_id: projectionRefs.relationship.projection_id,
    release_id: releaseId,
    datasource_id: datasourceId,
    catalog_epoch: 1,
    projection_digest: projectionRefs.relationship.projection_digest,
    projection_payload: {},
  },
  runtime_restriction_projection: {
    projection_id: projectionRefs.runtime_restriction.projection_id,
    release_id: releaseId,
    pointer_generation: 4,
    projection_digest: projectionRefs.runtime_restriction.projection_digest,
    projection_payload: {},
  },
} as const;
const promotedEnvelope = {
  stage: {
    schema_version: "semantic-successor-stage@1.0.0",
    stage_id: id(8),
    stage_digest: hash("1"),
    scope: {
      app_id: id(1),
      tenant_id: id(2),
      environment: "test",
      semantic_domain: "falcon24",
    },
    predecessor_release: { release_id: id(3), generation: 1, release_digest: hash("2") },
    expected_pointer_version: 3,
    target_generation: 2,
    change_set_ref: { change_set_id: id(6), change_set_hash: hash("3") },
    review_ref: { review_id: id(9), review_hash: hash("4") },
    source_snapshot_ref: {
      snapshot_id: id(14),
      snapshot_revision: 1,
      snapshot_hash: hash("5"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("f"),
    },
    candidate_release: {
      release_id: releaseId,
      generation: 2,
      release_digest: hash("e"),
      datasource_id: datasourceId,
    },
    projection_refs: projectionRefs,
    status: "PROMOTED",
  },
  projections: {
    executable: {
      projection_kind: "EXECUTABLE",
      ...projectionRefs.executable,
      projection_payload: { schema_version: "semantic-executable-projection@1.0.0" },
    },
    relationship: {
      projection_kind: "RELATIONSHIP",
      ...projectionRefs.relationship,
      projection_payload: { schema_version: "semantic-relationship-projection@1.0.0" },
    },
    runtime_restriction: {
      projection_kind: "RUNTIME_RESTRICTION",
      ...projectionRefs.runtime_restriction,
      projection_payload: { schema_version: "semantic-runtime-restriction-projection@1.0.0" },
    },
    graph: {
      projection_kind: "GRAPH",
      ...projectionRefs.graph,
      projection_payload: { projection_version: "semantic-graph-projection@2" },
    },
  },
} as const;

function reader() {
  return {
    getReleaseSource: vi.fn(async () => ({ ok: true as const, value: explorerEnvelope })),
  } as unknown as PostgresSemanticExplorerReader;
}

beforeEach(() => {
  shared.verifyPackage.mockReset();
  shared.verifyEnvelope.mockReset();
  shared.validateClosure.mockReset();
  shared.verifyPackage.mockImplementation(async (candidate) => candidate);
  shared.verifyEnvelope.mockImplementation(async (candidate) => candidate);
  shared.validateClosure.mockResolvedValue({ outcome: "PASS" });
});

describe("frozen semantic release production read", () => {
  it("uses the promoted four-projection envelope and the same shared closure validator as smoke", async () => {
    const loadPromotedRelease = vi.fn(async () => ({
      ok: true as const,
      value: promotedEnvelope,
    }));
    const port = createFrozenSemanticReleaseReadPort(reader(), { loadPromotedRelease });

    const result = await port.read({ capability: {}, package: packageDocument as never });

    expect(result).toMatchObject({
      ok: true,
      value: {
        release_identity: { release_id: releaseId, release_generation: 2 },
        executable: { schema_version: "semantic-executable-projection@1.0.0" },
      },
    });
    expect(loadPromotedRelease).toHaveBeenCalledWith(
      {},
      {
        semantic_domain: "falcon24",
        release_id: releaseId,
      },
    );
    expect(shared.verifyEnvelope).toHaveBeenCalledWith(promotedEnvelope);
    expect(shared.validateClosure).toHaveBeenCalledWith(promotedEnvelope);
  });

  it("keeps an unpromoted generation-one release fail-closed", async () => {
    const loadPromotedRelease = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "SEMANTIC_SUCCESSOR_PROMOTED_RELEASE_NOT_FOUND",
        message: "not found",
        retryable: false,
      },
    }));
    const port = createFrozenSemanticReleaseReadPort(reader(), { loadPromotedRelease });

    await expect(
      port.read({ capability: {}, package: packageDocument as never }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_RELEASE_PROJECTION_INVALID" },
    });
    expect(shared.verifyEnvelope).not.toHaveBeenCalled();
  });
});
