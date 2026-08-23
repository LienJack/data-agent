import { describe, expect, it, vi } from "vitest";
import {
  type QaReadinessBootstrapDependencies,
  type QaReadinessState,
  runQaReadinessBootstrap,
} from "../scripts/qa-readiness-bootstrap";

const readyState: QaReadinessState = {
  schema_version: "qa-readiness-state@1.0.0",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  model_profiles_ready: true,
  schema_snapshot_ready: true,
  defaults_ready: true,
  team_profiles_ready: true,
};

function dependencies(states: QaReadinessState[]): {
  value: QaReadinessBootstrapDependencies;
  order: string[];
} {
  const order: string[] = [];
  return {
    order,
    value: {
      inspect: vi.fn(async () => {
        order.push("inspect");
        const state = states.shift();
        if (!state) throw new Error("fixture state exhausted");
        return state;
      }),
      ensureModelProfiles: vi.fn(async () => {
        order.push("models");
      }),
      ensureSchemaSnapshot: vi.fn(async () => {
        order.push("snapshot");
      }),
      ensureDefaults: vi.fn(async () => {
        order.push("defaults");
      }),
      ensureTeamProfiles: vi.fn(async () => {
        order.push("profiles");
      }),
    },
  };
}

describe("local Q&A readiness bootstrap", () => {
  it("completes model, snapshot, and defaults readiness before activating Team Profiles", async () => {
    const fixture = dependencies([
      {
        ...readyState,
        model_profiles_ready: false,
        schema_snapshot_ready: false,
        defaults_ready: false,
        team_profiles_ready: false,
      },
      readyState,
    ]);

    await expect(
      runQaReadinessBootstrap(
        {
          workspace_id: readyState.workspace_id,
          environment: "local",
          confirmed: true,
        },
        fixture.value,
      ),
    ).resolves.toEqual({
      schema_version: "qa-readiness-bootstrap-result@1.0.0",
      terminal: "READY",
      reason_code: "QA_READINESS_BOOTSTRAPPED",
      state: readyState,
    });
    expect(fixture.order).toEqual([
      "inspect",
      "models",
      "snapshot",
      "defaults",
      "profiles",
      "inspect",
    ]);
  });

  it("returns without writes when the workspace is already ready", async () => {
    const fixture = dependencies([readyState]);

    await expect(
      runQaReadinessBootstrap(
        {
          workspace_id: readyState.workspace_id,
          environment: "local",
          confirmed: true,
        },
        fixture.value,
      ),
    ).resolves.toMatchObject({
      terminal: "READY",
      reason_code: "QA_READINESS_ALREADY_READY",
    });
    expect(fixture.order).toEqual(["inspect"]);
  });

  it("fails closed before inspection without explicit local confirmation", async () => {
    const fixture = dependencies([readyState]);

    await expect(
      runQaReadinessBootstrap(
        {
          workspace_id: readyState.workspace_id,
          environment: "production",
          confirmed: true,
        },
        fixture.value,
      ),
    ).resolves.toMatchObject({
      terminal: "HOLD",
      reason_code: "QA_READINESS_PRODUCTION_FORBIDDEN",
    });
    await expect(
      runQaReadinessBootstrap(
        {
          workspace_id: readyState.workspace_id,
          environment: "local",
          confirmed: false,
        },
        fixture.value,
      ),
    ).resolves.toMatchObject({
      terminal: "NOT_RUN",
      reason_code: "QA_READINESS_EXPLICIT_CONFIRMATION_REQUIRED",
    });
    expect(fixture.order).toEqual([]);
  });

  it("does not activate Team Profiles after an earlier readiness failure", async () => {
    const fixture = dependencies([
      {
        ...readyState,
        schema_snapshot_ready: false,
        defaults_ready: false,
        team_profiles_ready: false,
      },
    ]);
    vi.mocked(fixture.value.ensureSchemaSnapshot).mockRejectedValueOnce(
      new Error("SCHEMA_SCAN_DATASOURCE_UNAVAILABLE"),
    );

    await expect(
      runQaReadinessBootstrap(
        {
          workspace_id: readyState.workspace_id,
          environment: "local",
          confirmed: true,
        },
        fixture.value,
      ),
    ).resolves.toMatchObject({
      terminal: "HOLD",
      reason_code: "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
    });
    expect(fixture.order).toEqual(["inspect"]);
    expect(fixture.value.ensureSchemaSnapshot).toHaveBeenCalledOnce();
    expect(fixture.value.ensureTeamProfiles).not.toHaveBeenCalled();
  });
});
