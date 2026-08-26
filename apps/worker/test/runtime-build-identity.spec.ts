import {
  loadRuntimeBuildIdentity,
  RUNTIME_BUILD_IDENTITY_VERSION,
  type RuntimeBuildIdentity,
  type RuntimeBuildIdentityConfigurationError,
} from "@data-agent/contracts/server";
import { describe, expect, it } from "vitest";
import { projectWorkerHealthResponse, runWorkerProcess } from "../src/run-worker-cli.js";
import {
  runSemanticAuthoringWorkerProcess,
  semanticAuthoringStartedRecord,
} from "../src/semantic/authoring-worker-cli.js";
import {
  projectRelationshipIndexerHealthResponse,
  type RelationshipIndexerHealthState,
  runRelationshipIndexerProcess,
} from "../src/semantic/relationship-indexer-cli.js";

function identity(role: RuntimeBuildIdentity["consumer_role"] = "worker"): RuntimeBuildIdentity {
  return {
    schema_version: RUNTIME_BUILD_IDENTITY_VERSION,
    consumer_role: role,
    generation_id: `sha256:${"a".repeat(64)}`,
    build_id: `sha256:${"b".repeat(64)}`,
    built_at: "2026-08-22T00:00:00.000Z",
    git_commit: "c".repeat(40),
    git_dirty: true,
  };
}

describe("Worker runtime build identity", () => {
  it("四个受管理角色均拒绝 mismatch，test harness 必须显式注入", () => {
    for (const role of ["web", "worker", "relationship-indexer", "semantic-authoring"] as const) {
      expect(
        loadRuntimeBuildIdentity({
          expectedRole: role,
          environment: {},
          testIdentity: identity(role),
        }),
      ).toEqual(identity(role));
      const mismatchedRole = role === "web" ? "worker" : "web";
      expect(() =>
        loadRuntimeBuildIdentity({
          expectedRole: role,
          environment: {},
          testIdentity: identity(mismatchedRole),
        }),
      ).toThrowError(
        expect.objectContaining<Partial<RuntimeBuildIdentityConfigurationError>>({
          code: "RUNTIME_BUILD_IDENTITY_ROLE_MISMATCH",
        }),
      );
    }
  });

  it("三个 Worker 进程在创建 DB/health 资源前拒绝缺失 identity", async () => {
    for (const start of [
      () => runWorkerProcess({}),
      () => runRelationshipIndexerProcess({}),
      () => runSemanticAuthoringWorkerProcess({}),
    ]) {
      await expect(start()).rejects.toMatchObject({
        code: "RUNTIME_BUILD_IDENTITY_MISSING",
      });
    }
  });

  it("Worker live 仅增加 opaque build/generation ID，保留原 health 语义", () => {
    const response = projectWorkerHealthResponse(
      {
        initialized: true,
        run_queue_ready: true,
        job_queue_ready: true,
        last_cycle_at: null,
        last_cycle_kind: "IDLE",
        last_error_code: null,
        job_last_cycle_at: null,
        job_last_cycle_kind: "IDLE",
        job_last_error_code: null,
        research_authority_configured: false,
      },
      identity(),
    );

    expect(response).toMatchObject({
      status: "ready",
      build_id: identity().build_id,
      generation_id: identity().generation_id,
    });
    expect(JSON.stringify(response)).not.toContain("git_commit");
    expect(JSON.stringify(response)).not.toContain("git_dirty");
    expect(JSON.stringify(response)).not.toContain("package_tasks");
    expect(JSON.stringify(response)).not.toContain("migration_frontier");

    const verifiedMigration = projectWorkerHealthResponse(response, identity(), {
      schema_version: "runtime-migration-fact@1.0.0",
      migration_ready: true,
      migration_frontier: `sha256:${"d".repeat(64)}`,
    });
    expect(verifiedMigration).toMatchObject({
      migration_ready: true,
      migration_frontier: `sha256:${"d".repeat(64)}`,
    });
  });

  it("Indexer live 与 Authoring startup 使用各自 role identity", () => {
    const indexerHealth: RelationshipIndexerHealthState = {
      initialized: false,
      last_cycle_at: null,
    };
    expect(
      projectRelationshipIndexerHealthResponse(indexerHealth, identity("relationship-indexer")),
    ).toEqual({
      status: "starting",
      initialized: false,
      last_cycle_at: null,
      build_id: identity().build_id,
      generation_id: identity().generation_id,
    });

    const started = semanticAuthoringStartedRecord({
      identity: identity("semantic-authoring"),
      modelReady: true,
      semanticDomains: ["ecommerce"],
    });
    expect(started).toMatchObject({
      event_name: "semantic_authoring_worker_started",
      build_id: identity().build_id,
      generation_id: identity().generation_id,
      git_commit: identity().git_commit,
      git_dirty: true,
    });
  });
});
