import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { workspaceIdempotencyKeySchema } from "./identity.js";

const positiveRevisionSchema = z.number().int().positive().safe();

export const canonicalU2TimestampSchema = timestampSchema.transform((value) =>
  new Date(value).toISOString(),
);

export const canonicalImmutableIdSchema = immutableIdSchema.transform((id) => id.toLowerCase());

export const workspaceScopedAuthoritySchema = z
  .strictObject({
    app_id: canonicalImmutableIdSchema,
    tenant_id: canonicalImmutableIdSchema,
    environment: environmentSchema,
    workspace_id: canonicalImmutableIdSchema,
  })
  .superRefine((scope, ctx) => {
    if (scope.tenant_id !== scope.workspace_id) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Authority 的 tenant_id 必须等于 workspace_id。",
        path: ["tenant_id"],
      });
    }
  });

export const versionedResourceReferenceSchema = z.strictObject({
  resource_id: canonicalImmutableIdSchema,
  resource_revision: positiveRevisionSchema,
  resource_hash: contentHashSchema,
});

export const requestedResourceReferenceSchema = z.strictObject({
  resource_id: canonicalImmutableIdSchema,
  expected_revision: positiveRevisionSchema,
});

function compareRequestedResources(
  left: z.infer<typeof requestedResourceReferenceSchema>,
  right: z.infer<typeof requestedResourceReferenceSchema>,
): number {
  if (left.resource_id !== right.resource_id) {
    return left.resource_id < right.resource_id ? -1 : 1;
  }
  return left.expected_revision - right.expected_revision;
}

function compareVersionedResources(
  left: z.infer<typeof versionedResourceReferenceSchema>,
  right: z.infer<typeof versionedResourceReferenceSchema>,
): number {
  if (left.resource_id !== right.resource_id) {
    return left.resource_id < right.resource_id ? -1 : 1;
  }
  if (left.resource_revision !== right.resource_revision) {
    return left.resource_revision - right.resource_revision;
  }
  return left.resource_hash < right.resource_hash
    ? -1
    : left.resource_hash > right.resource_hash
      ? 1
      : 0;
}

function addCanonicalRequestedResourceIssues(
  resources: ReadonlyArray<z.infer<typeof requestedResourceReferenceSchema>>,
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  resources.forEach((resource, index) => {
    if (ids.has(resource.resource_id)) {
      ctx.addIssue({
        code: "custom",
        message: "RESOURCE_IDS 不能重复引用同一资源。",
        path: [index, "resource_id"],
      });
    }
    ids.add(resource.resource_id);
    const previous = resources[index - 1];
    if (previous && compareRequestedResources(previous, resource) >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "RESOURCE_IDS 必须按 resource_id/revision 规范升序排列。",
        path: [index],
      });
    }
  });
}

function addCanonicalVersionedResourceIssues(
  resources: ReadonlyArray<z.infer<typeof versionedResourceReferenceSchema>>,
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  resources.forEach((resource, index) => {
    if (ids.has(resource.resource_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Defaults 不能重复引用同一资源。",
        path: [index, "resource_id"],
      });
    }
    ids.add(resource.resource_id);
    const previous = resources[index - 1];
    if (previous && compareVersionedResources(previous, resource) >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Defaults 资源必须按 ID/revision/hash 规范升序排列。",
        path: [index],
      });
    }
  });
}

const inheritDefaultSelectionSchema = z.strictObject({
  mode: z.literal("INHERIT_DEFAULT"),
});

const explicitNoneSelectionSchema = z.strictObject({
  mode: z.literal("EXPLICIT_NONE"),
});

const requestedResourceIdsSchema = z
  .strictObject({
    mode: z.literal("RESOURCE_IDS"),
    resources: z.array(requestedResourceReferenceSchema).min(1).max(128),
  })
  .superRefine((selection, ctx) => {
    addCanonicalRequestedResourceIssues(selection.resources, ctx);
  });

export const requestedResourceCollectionSchema = z.discriminatedUnion("mode", [
  inheritDefaultSelectionSchema,
  explicitNoneSelectionSchema,
  requestedResourceIdsSchema,
]);

export const requestedSingleResourceSchema = z
  .discriminatedUnion("mode", [
    inheritDefaultSelectionSchema,
    explicitNoneSelectionSchema,
    requestedResourceIdsSchema,
  ])
  .superRefine((selection, ctx) => {
    if (selection.mode === "RESOURCE_IDS" && selection.resources.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "单值资源的 RESOURCE_IDS 必须恰好包含一项。",
        path: ["resources"],
      });
    }
  });

const canonicalVersionedResourceCollectionSchema = z
  .array(versionedResourceReferenceSchema)
  .max(128)
  .superRefine((resources, ctx) => {
    addCanonicalVersionedResourceIssues(resources, ctx);
  });

const canonicalRequestedResourceCollectionValueSchema = z
  .array(requestedResourceReferenceSchema)
  .max(128)
  .superRefine((resources, ctx) => {
    addCanonicalRequestedResourceIssues(resources, ctx);
  });

/**
 * Client-authored Workspace Defaults intent. PostgreSQL resolves every selector to a
 * server-owned VersionedResourceReference before creating a Defaults Revision.
 */
export const workspaceDefaultsSelectionCandidateSchema = z.strictObject({
  model: requestedResourceReferenceSchema.nullable(),
  datasource: requestedResourceReferenceSchema.nullable(),
  files: canonicalRequestedResourceCollectionValueSchema,
  knowledge: canonicalRequestedResourceCollectionValueSchema,
  mcp_servers: canonicalRequestedResourceCollectionValueSchema,
  skills: canonicalRequestedResourceCollectionValueSchema,
  semantic_release: requestedResourceReferenceSchema.nullable(),
  schema_snapshot: requestedResourceReferenceSchema.nullable(),
  context_policy: requestedResourceReferenceSchema,
  egress_policy: requestedResourceReferenceSchema,
  execution_safety_policy: requestedResourceReferenceSchema,
});

export const workspaceDefaultsValueSchema = z.strictObject({
  model: versionedResourceReferenceSchema.nullable(),
  datasource: versionedResourceReferenceSchema.nullable(),
  files: canonicalVersionedResourceCollectionSchema,
  knowledge: canonicalVersionedResourceCollectionSchema,
  mcp_servers: canonicalVersionedResourceCollectionSchema,
  skills: canonicalVersionedResourceCollectionSchema,
  semantic_release: versionedResourceReferenceSchema.nullable(),
  schema_snapshot: versionedResourceReferenceSchema.nullable(),
  context_policy: versionedResourceReferenceSchema,
  egress_policy: versionedResourceReferenceSchema,
  execution_safety_policy: versionedResourceReferenceSchema,
});

export const workspaceDefaultsReferenceSchema = z.strictObject({
  defaults_id: canonicalImmutableIdSchema,
  defaults_revision: positiveRevisionSchema,
  defaults_hash: contentHashSchema,
});

const workspaceDefaultsRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-defaults-revision@1.0.0"),
    scope: workspaceScopedAuthoritySchema,
    defaults_id: canonicalImmutableIdSchema,
    defaults_revision: positiveRevisionSchema,
    parent_revision: positiveRevisionSchema.nullable(),
    parent_hash: contentHashSchema.nullable(),
    defaults: workspaceDefaultsValueSchema,
    created_by_principal_id: canonicalImmutableIdSchema,
    created_at: canonicalU2TimestampSchema,
  })
  .superRefine((revision, ctx) => {
    if (revision.defaults_revision === 1) {
      if (revision.parent_revision !== null || revision.parent_hash !== null) {
        ctx.addIssue({
          code: "custom",
          message: "首个 Workspace Defaults Revision 不能携带 Parent。",
          path: ["parent_revision"],
        });
      }
      return;
    }
    if (
      revision.parent_revision !== revision.defaults_revision - 1 ||
      revision.parent_hash === null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "后续 Workspace Defaults Revision 必须绑定紧邻 Parent Revision/Hash。",
        path: ["parent_revision"],
      });
    }
  });

export const workspaceDefaultsRevisionSchema = workspaceDefaultsRevisionDraftSchema.safeExtend({
  defaults_hash: contentHashSchema,
});

export async function computeWorkspaceDefaultsHash(input: unknown) {
  const revision = workspaceDefaultsRevisionDraftSchema.parse(input);
  return sha256ContentHash({
    schema_version: revision.schema_version,
    scope: revision.scope,
    defaults_id: revision.defaults_id,
    defaults_revision: revision.defaults_revision,
    parent_revision: revision.parent_revision,
    parent_hash: revision.parent_hash,
    defaults: revision.defaults,
    created_by_principal_id: revision.created_by_principal_id,
    created_at: revision.created_at,
  });
}

export async function buildWorkspaceDefaultsRevisionCandidate(input: unknown) {
  const revision = workspaceDefaultsRevisionDraftSchema.parse(input);
  return workspaceDefaultsRevisionSchema.parse({
    ...revision,
    defaults_hash: await computeWorkspaceDefaultsHash(revision),
  });
}

export async function verifyWorkspaceDefaultsRevision(input: unknown) {
  const revision = workspaceDefaultsRevisionSchema.parse(input);
  const { defaults_hash: _defaultsHash, ...draft } = revision;
  if ((await computeWorkspaceDefaultsHash(draft)) !== revision.defaults_hash) {
    throw new TypeError("WORKSPACE_DEFAULTS_HASH_MISMATCH");
  }
  return revision;
}

const workspaceDefaultsCasUpdateCommandDraftSchema = z.strictObject({
  schema_version: z.literal("workspace-defaults-cas-update@1.0.0"),
  operation_id: canonicalImmutableIdSchema,
  workspace_id: canonicalImmutableIdSchema,
  expected_defaults_revision: z.number().int().nonnegative().safe(),
  idempotency_key: workspaceIdempotencyKeySchema,
  defaults: workspaceDefaultsSelectionCandidateSchema,
});

export const workspaceDefaultsCasUpdateCommandSchema =
  workspaceDefaultsCasUpdateCommandDraftSchema.safeExtend({
    request_hash: contentHashSchema,
  });

export async function computeWorkspaceDefaultsCasUpdateRequestHash(input: unknown) {
  return sha256ContentHash(workspaceDefaultsCasUpdateCommandDraftSchema.parse(input));
}

export async function buildWorkspaceDefaultsCasUpdateCommandCandidate(input: unknown) {
  const command = workspaceDefaultsCasUpdateCommandDraftSchema.parse(input);
  return workspaceDefaultsCasUpdateCommandSchema.parse({
    ...command,
    request_hash: await computeWorkspaceDefaultsCasUpdateRequestHash(command),
  });
}

export async function verifyWorkspaceDefaultsCasUpdateCommand(input: unknown) {
  const command = workspaceDefaultsCasUpdateCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if ((await computeWorkspaceDefaultsCasUpdateRequestHash(draft)) !== command.request_hash) {
    throw new TypeError("WORKSPACE_DEFAULTS_REQUEST_HASH_MISMATCH");
  }
  return command;
}

function sameDefaultsReference(
  revision: z.infer<typeof workspaceDefaultsRevisionSchema>,
  reference: z.infer<typeof workspaceDefaultsReferenceSchema>,
): boolean {
  return (
    revision.defaults_id === reference.defaults_id &&
    revision.defaults_revision === reference.defaults_revision &&
    revision.defaults_hash === reference.defaults_hash
  );
}

export const workspaceDefaultsReadResultSchema = z
  .strictObject({
    revision: workspaceDefaultsRevisionSchema,
    defaults_ref: workspaceDefaultsReferenceSchema,
  })
  .superRefine((result, ctx) => {
    if (!sameDefaultsReference(result.revision, result.defaults_ref)) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Defaults read result 的 revision/ref 必须精确一致。",
        path: ["defaults_ref"],
      });
    }
  });

export const workspaceDefaultsUpdateResultSchema = z
  .strictObject({
    revision: workspaceDefaultsRevisionSchema,
    defaults_ref: workspaceDefaultsReferenceSchema,
    request_hash: contentHashSchema,
    committed_at: canonicalU2TimestampSchema,
    replayed: z.boolean(),
  })
  .superRefine((result, ctx) => {
    if (!sameDefaultsReference(result.revision, result.defaults_ref)) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Defaults update result 的 revision/ref 必须精确一致。",
        path: ["defaults_ref"],
      });
    }
    if (result.committed_at !== result.revision.created_at) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Defaults update result 的 committed_at 必须等于 revision.created_at。",
        path: ["committed_at"],
      });
    }
  });

export type WorkspaceScopedAuthority = z.infer<typeof workspaceScopedAuthoritySchema>;
export type VersionedResourceReference = z.infer<typeof versionedResourceReferenceSchema>;
export type RequestedResourceReference = z.infer<typeof requestedResourceReferenceSchema>;
export type RequestedResourceCollection = z.infer<typeof requestedResourceCollectionSchema>;
export type RequestedSingleResource = z.infer<typeof requestedSingleResourceSchema>;
export type WorkspaceDefaultsValue = z.infer<typeof workspaceDefaultsValueSchema>;
export type WorkspaceDefaultsSelectionCandidate = z.infer<
  typeof workspaceDefaultsSelectionCandidateSchema
>;
export type WorkspaceDefaultsReference = z.infer<typeof workspaceDefaultsReferenceSchema>;
export type WorkspaceDefaultsRevision = z.infer<typeof workspaceDefaultsRevisionSchema>;
export type WorkspaceDefaultsCasUpdateCommand = z.infer<
  typeof workspaceDefaultsCasUpdateCommandSchema
>;
export type WorkspaceDefaultsReadResult = z.infer<typeof workspaceDefaultsReadResultSchema>;
export type WorkspaceDefaultsUpdateResult = z.infer<typeof workspaceDefaultsUpdateResultSchema>;
