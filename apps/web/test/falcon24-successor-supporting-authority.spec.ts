import type { PortResult } from "@data-agent/contracts/ports";
import {
  buildWorkspaceDefaultsRevisionCandidate,
  type WorkspaceDefaultsReadResult,
} from "@data-agent/contracts/workspaces";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  loadFalcon24E4SupportingAuthorityContext,
  loadFalcon24SupportingAuthorityContext,
} from "../src/lib/falcon24-successor-supporting-authority";

const id = (suffix: number) => `90000000-0000-5000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test",
  semantic_domain: "falcon24",
} as const;
const predecessor = {
  release_id: id(3),
  generation: 1,
  release_digest: hash("1"),
} as const;

const resource = (suffix: number, character: string) => ({
  resource_id: id(suffix),
  resource_revision: suffix,
  resource_hash: hash(character),
});

async function defaults(
  overrides: Partial<{
    defaults_revision: number;
    scope: {
      app_id: string;
      tenant_id: string;
      environment: string;
      workspace_id: string;
    };
    model: ReturnType<typeof resource> | null;
    datasource: ReturnType<typeof resource> | null;
    semantic_release: ReturnType<typeof resource> | null;
    schema_snapshot: ReturnType<typeof resource> | null;
    files: ReturnType<typeof resource>[];
  }> = {},
): Promise<WorkspaceDefaultsReadResult> {
  const defaultsRevision = overrides.defaults_revision ?? 7;
  const revision = await buildWorkspaceDefaultsRevisionCandidate({
    schema_version: "workspace-defaults-revision@1.0.0",
    scope: overrides.scope ?? {
      app_id: scope.app_id,
      tenant_id: scope.tenant_id,
      environment: scope.environment,
      workspace_id: scope.tenant_id,
    },
    defaults_id: id(20),
    defaults_revision: defaultsRevision,
    parent_revision: defaultsRevision - 1,
    parent_hash: hash("0"),
    defaults: {
      model: overrides.model === undefined ? resource(21, "2") : overrides.model,
      datasource:
        overrides.datasource === undefined
          ? { ...resource(22, "3"), resource_id: id(4) }
          : overrides.datasource,
      files: overrides.files ?? [],
      knowledge: [],
      mcp_servers: [],
      skills: [],
      semantic_release:
        overrides.semantic_release === undefined
          ? {
              resource_id: predecessor.release_id,
              resource_revision: predecessor.generation,
              resource_hash: predecessor.release_digest,
            }
          : overrides.semantic_release,
      schema_snapshot:
        overrides.schema_snapshot === undefined ? resource(23, "4") : overrides.schema_snapshot,
      context_policy: resource(24, "5"),
      egress_policy: resource(25, "6"),
      execution_safety_policy: resource(26, "7"),
    },
    created_by_principal_id: id(27),
    created_at: "2026-08-28T00:00:00.000Z",
  });
  return {
    revision,
    defaults_ref: {
      defaults_id: revision.defaults_id,
      defaults_revision: revision.defaults_revision,
      defaults_hash: revision.defaults_hash,
    },
  };
}

function reader(result: PortResult<WorkspaceDefaultsReadResult | null>) {
  return { getWorkspaceDefaults: vi.fn(async () => result) };
}

function input(defaultsReader: ReturnType<typeof reader>, overrides: Record<string, unknown> = {}) {
  return {
    capability: { role: "owner" },
    defaults_reader: defaultsReader,
    scope,
    expected_semantic_predecessor: predecessor,
    expected_datasource_id: id(4),
    expected_defaults_version: 7,
    ...overrides,
  };
}

describe("Falcon24 E4 supporting authority preflight", () => {
  it("loads the exact frozen resources without exposing a defaults writer", async () => {
    const current = await defaults();
    const defaultsReader = reader({ ok: true, value: current });

    const result = await loadFalcon24E4SupportingAuthorityContext(input(defaultsReader));

    expect(defaultsReader.getWorkspaceDefaults).toHaveBeenCalledWith({ role: "owner" });
    expect(result).toEqual({
      defaults_ref: current.defaults_ref,
      model_ref: current.revision.defaults.model,
      datasource_ref: current.revision.defaults.datasource,
      schema_snapshot_ref: current.revision.defaults.schema_snapshot,
      context_policy_ref: current.revision.defaults.context_policy,
      egress_policy_ref: current.revision.defaults.egress_policy,
      execution_safety_policy_ref: current.revision.defaults.execution_safety_policy,
    });
    expect("updateWorkspaceDefaults" in defaultsReader).toBe(false);
  });

  it("rejects missing defaults", async () => {
    const defaultsReader = reader({ ok: true, value: null });

    await expect(loadFalcon24E4SupportingAuthorityContext(input(defaultsReader))).rejects.toThrow(
      "FALCON24_E4_WORKSPACE_DEFAULTS_REQUIRED",
    );
  });

  it("rejects a stale defaults revision or semantic predecessor", async () => {
    const staleVersion = reader({ ok: true, value: await defaults({ defaults_revision: 8 }) });
    const staleSemantic = reader({
      ok: true,
      value: await defaults({ semantic_release: resource(28, "8") }),
    });

    await expect(loadFalcon24E4SupportingAuthorityContext(input(staleVersion))).rejects.toThrow(
      "FALCON24_E4_WORKSPACE_DEFAULTS_STALE",
    );
    await expect(loadFalcon24E4SupportingAuthorityContext(input(staleSemantic))).rejects.toThrow(
      "FALCON24_E4_WORKSPACE_DEFAULTS_STALE",
    );
  });

  it("rejects missing core resource refs and unexpected extension defaults", async () => {
    const missingModel = reader({ ok: true, value: await defaults({ model: null }) });
    const extensionBound = reader({
      ok: true,
      value: await defaults({ files: [resource(29, "9")] }),
    });

    await expect(loadFalcon24E4SupportingAuthorityContext(input(missingModel))).rejects.toThrow(
      "FALCON24_E4_SUPPORTING_AUTHORITY_INCOMPLETE",
    );
    await expect(loadFalcon24E4SupportingAuthorityContext(input(extensionBound))).rejects.toThrow(
      "FALCON24_E4_SUPPORTING_AUTHORITY_INCOMPLETE",
    );
  });

  it("rejects cross-scope defaults and preserves stable reader failures", async () => {
    const crossScope = reader({
      ok: true,
      value: await defaults({
        scope: {
          app_id: scope.app_id,
          tenant_id: id(30),
          workspace_id: id(30),
          environment: scope.environment,
        },
      }),
    });
    const failed = reader({
      ok: false,
      error: { code: "EFFECTIVE_CONFIG_SCOPE_DENIED", message: "denied", retryable: false },
    });

    await expect(loadFalcon24E4SupportingAuthorityContext(input(crossScope))).rejects.toThrow(
      "FALCON24_E4_WORKSPACE_DEFAULTS_SCOPE_MISMATCH",
    );
    await expect(loadFalcon24E4SupportingAuthorityContext(input(failed))).rejects.toThrow(
      "EFFECTIVE_CONFIG_SCOPE_DENIED",
    );
  });
});

describe("Falcon24 retained supporting authority preflight", () => {
  it("loads the exact active generation-2 defaults without a writer", async () => {
    const successor = {
      release_id: id(31),
      generation: 2,
      release_digest: hash("8"),
    } as const;
    const current = await defaults({
      semantic_release: {
        resource_id: successor.release_id,
        resource_revision: successor.generation,
        resource_hash: successor.release_digest,
      },
    });
    const defaultsReader = reader({ ok: true, value: current });

    await expect(
      loadFalcon24SupportingAuthorityContext({
        capability: { role: "owner" },
        defaults_reader: defaultsReader,
        scope,
        expected_semantic_release: successor,
        expected_datasource_id: id(4),
        expected_defaults_version: 7,
      }),
    ).resolves.toMatchObject({
      defaults_ref: current.defaults_ref,
      schema_snapshot_ref: current.revision.defaults.schema_snapshot,
    });
    expect("updateWorkspaceDefaults" in defaultsReader).toBe(false);
  });

  it("rejects a stale generation-2 release with retained error identity", async () => {
    const defaultsReader = reader({ ok: true, value: await defaults() });

    await expect(
      loadFalcon24SupportingAuthorityContext({
        capability: { role: "owner" },
        defaults_reader: defaultsReader,
        scope,
        expected_semantic_release: {
          release_id: id(31),
          generation: 2,
          release_digest: hash("8"),
        },
        expected_datasource_id: id(4),
        expected_defaults_version: 7,
      }),
    ).rejects.toThrow("FALCON24_RETAINED_WORKSPACE_DEFAULTS_STALE");
  });
});
