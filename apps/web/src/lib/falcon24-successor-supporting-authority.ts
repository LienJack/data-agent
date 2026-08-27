import "server-only";

import {
  semanticReleaseReferenceSchema,
  semanticScopeSchema,
} from "@data-agent/contracts/artifacts";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  type VersionedResourceReference,
  verifyWorkspaceDefaultsRevision,
  type WorkspaceDefaultsReadResult,
  type WorkspaceDefaultsReference,
  workspaceDefaultsReadResultSchema,
} from "@data-agent/contracts/workspaces";
import { z } from "zod";

const inputSchema = z
  .strictObject({
    scope: semanticScopeSchema,
    expected_semantic_predecessor: semanticReleaseReferenceSchema,
    expected_datasource_id: z.uuid(),
    expected_defaults_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((input, context) => {
    if (input.expected_semantic_predecessor.generation !== 1) {
      context.addIssue({
        code: "custom",
        message: "FALCON24_E4_WORKSPACE_DEFAULTS_STALE",
        path: ["expected_semantic_predecessor", "generation"],
      });
    }
  });

export interface Falcon24WorkspaceDefaultsReader {
  getWorkspaceDefaults(
    capability: unknown,
  ): Promise<PortResult<WorkspaceDefaultsReadResult | null>>;
}

export interface Falcon24E4SupportingAuthorityContext {
  readonly defaults_ref: WorkspaceDefaultsReference;
  readonly model_ref: VersionedResourceReference;
  readonly datasource_ref: VersionedResourceReference;
  readonly schema_snapshot_ref: VersionedResourceReference;
  readonly context_policy_ref: VersionedResourceReference;
  readonly egress_policy_ref: VersionedResourceReference;
  readonly execution_safety_policy_ref: VersionedResourceReference;
}

function required<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function frozenRef(reference: VersionedResourceReference): VersionedResourceReference {
  return Object.freeze({ ...reference });
}

/**
 * Loads the already-active E3 workspace closure needed to build E4 supporting
 * receipts. This boundary is deliberately read-only: defaults remain on the
 * generation-1 predecessor until the combined PostgreSQL activation commits.
 */
export async function loadFalcon24E4SupportingAuthorityContext(input: {
  readonly capability: unknown;
  readonly defaults_reader: Falcon24WorkspaceDefaultsReader;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly semantic_domain: string;
  };
  readonly expected_semantic_predecessor: {
    readonly release_id: string;
    readonly generation: number;
    readonly release_digest: `sha256:${string}`;
  };
  readonly expected_datasource_id: string;
  readonly expected_defaults_version: number;
}): Promise<Falcon24E4SupportingAuthorityContext> {
  const expected = inputSchema.parse({
    scope: input.scope,
    expected_semantic_predecessor: input.expected_semantic_predecessor,
    expected_datasource_id: input.expected_datasource_id,
    expected_defaults_version: input.expected_defaults_version,
  });
  const loaded = required(await input.defaults_reader.getWorkspaceDefaults(input.capability));
  if (loaded === null) throw new TypeError("FALCON24_E4_WORKSPACE_DEFAULTS_REQUIRED");

  let current: WorkspaceDefaultsReadResult;
  try {
    const parsed = workspaceDefaultsReadResultSchema.parse(loaded);
    current = workspaceDefaultsReadResultSchema.parse({
      revision: await verifyWorkspaceDefaultsRevision(parsed.revision),
      defaults_ref: parsed.defaults_ref,
    });
  } catch {
    throw new TypeError("FALCON24_E4_WORKSPACE_DEFAULTS_INVALID");
  }
  const { revision } = current;
  if (
    revision.scope.app_id !== expected.scope.app_id ||
    revision.scope.tenant_id !== expected.scope.tenant_id ||
    revision.scope.workspace_id !== expected.scope.tenant_id ||
    revision.scope.environment !== expected.scope.environment
  ) {
    throw new TypeError("FALCON24_E4_WORKSPACE_DEFAULTS_SCOPE_MISMATCH");
  }

  const defaults = revision.defaults;
  const semantic = defaults.semantic_release;
  if (
    revision.defaults_revision !== expected.expected_defaults_version ||
    current.defaults_ref.defaults_revision !== expected.expected_defaults_version ||
    semantic?.resource_id !== expected.expected_semantic_predecessor.release_id ||
    semantic.resource_revision !== expected.expected_semantic_predecessor.generation ||
    semantic.resource_hash !== expected.expected_semantic_predecessor.release_digest
  ) {
    throw new TypeError("FALCON24_E4_WORKSPACE_DEFAULTS_STALE");
  }

  if (
    !defaults.model ||
    !defaults.datasource ||
    defaults.datasource.resource_id !== expected.expected_datasource_id ||
    !defaults.schema_snapshot ||
    defaults.files.length !== 0 ||
    defaults.knowledge.length !== 0 ||
    defaults.mcp_servers.length !== 0 ||
    defaults.skills.length !== 0
  ) {
    throw new TypeError("FALCON24_E4_SUPPORTING_AUTHORITY_INCOMPLETE");
  }

  return Object.freeze({
    defaults_ref: Object.freeze({ ...current.defaults_ref }),
    model_ref: frozenRef(defaults.model),
    datasource_ref: frozenRef(defaults.datasource),
    schema_snapshot_ref: frozenRef(defaults.schema_snapshot),
    context_policy_ref: frozenRef(defaults.context_policy),
    egress_policy_ref: frozenRef(defaults.egress_policy),
    execution_safety_policy_ref: frozenRef(defaults.execution_safety_policy),
  });
}
