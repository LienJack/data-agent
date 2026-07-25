import {
  type AppScope,
  type ArtifactReference,
  appScopeSchema,
  artifactReferenceSchema,
  canonicalizeJson,
  deepFreeze,
  immutableIdSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type ContextProjection,
  contextProjectionDataBytes,
  contextProjectionSchema,
} from "./contracts.js";

export const untrustedContextFragmentSchema = z.strictObject({
  source_kind: z.enum(["schema_comment", "source_text", "sql_value", "tool_output"]),
  source_ref: artifactReferenceSchema,
  label: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
  media_type: z.enum(["text/plain", "application/json"]),
  value: z.json(),
});

export type ContextProjectionFilterInput = {
  readonly schema_version: string;
  readonly projection_id: string;
  readonly scope: AppScope;
  readonly run_id: string;
  readonly artifact_refs: readonly ArtifactReference[];
  readonly max_context_bytes: number;
  readonly raw_context: unknown;
};

export type ContextProjectionFilter = (
  input: ContextProjectionFilterInput,
) => unknown | Promise<unknown>;

const contextProjectionFilterInputSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  projection_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  max_context_bytes: z.number().int().positive(),
  raw_context: z.unknown(),
});

function projectFragmentContent(fragment: z.infer<typeof untrustedContextFragmentSchema>): string {
  if (fragment.media_type === "text/plain" && typeof fragment.value === "string") {
    return fragment.value;
  }
  return canonicalizeJson(fragment.value);
}

export async function projectUntrustedContext(
  input: ContextProjectionFilterInput,
): Promise<ContextProjection> {
  const request = contextProjectionFilterInputSchema.parse(input);
  const fragments = z.array(untrustedContextFragmentSchema).max(64).parse(request.raw_context);
  const projection = contextProjectionSchema.parse({
    schema_version: request.schema_version,
    projection_id: request.projection_id,
    scope: request.scope,
    run_id: request.run_id,
    artifact_refs: request.artifact_refs,
    data: fragments.map((fragment) => ({
      source_kind: fragment.source_kind,
      source_ref: fragment.source_ref,
      label: fragment.label,
      media_type: fragment.media_type,
      content: projectFragmentContent(fragment),
      trust: "UNTRUSTED_DATA",
      usage: "DATA_ONLY",
    })),
  });

  if (contextProjectionDataBytes(projection.data) > request.max_context_bytes) {
    throw new Error("CONTEXT_PROJECTION_BUDGET_EXCEEDED");
  }
  return deepFreeze(projection);
}

export class ContextProjectionError extends Error {
  override readonly name = "ContextProjectionError";
  readonly code = "CONTEXT_PROJECTION_FAILED";

  constructor() {
    super("Context Projection 失败，Handoff 已失败关闭。");
  }
}
