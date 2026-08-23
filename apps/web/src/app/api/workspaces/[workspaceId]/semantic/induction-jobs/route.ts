import {
  buildJobSubmissionCommand,
  buildSemanticInductionSourceRegistrationCommand,
  contentHashSchema,
  semanticInductionBaseReleaseReferenceSchema,
  semanticInductionFactSchema,
  semanticInductionKindSchema,
  semanticInductionRequestSchema,
  semanticMetricExchangeEntrySchema,
  semanticMetricExchangeFormatSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { workspaceErrorResponse } from "@/lib/workspace-request";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const existingSourceSchema = z.strictObject({
  source_kind: z.enum(["PHYSICAL_SCHEMA", "KNOWLEDGE_DOCUMENT"]),
  resource_id: z.uuid(),
  resource_revision: z.number().int().positive().safe(),
  resource_hash: contentHashSchema,
});

const packageSourceSchema = z
  .strictObject({
    source_kind: z.enum(["METRIC_EXCHANGE", "FOUNDATIONAL_ONTOLOGY"]),
    resource_revision: z.number().int().positive().safe(),
    metric_format: semanticMetricExchangeFormatSchema.nullable(),
    facts: z.array(semanticInductionFactSchema).max(10_000),
    metrics: z.array(semanticMetricExchangeEntrySchema).max(10_000),
    dependencies: z
      .array(z.strictObject({ source_object_id: z.uuid(), dependent_object_id: z.uuid() }))
      .max(250_000),
  })
  .superRefine((source, context) => {
    if ((source.source_kind === "METRIC_EXCHANGE") !== (source.metric_format !== null)) {
      context.addIssue({ code: "custom", message: "Metric source format is invalid." });
    }
  });

const inputSchema = z.strictObject({
  schema_version: z.literal("semantic-induction-job-start@1.0.0"),
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  induction_kind: semanticInductionKindSchema,
  base_release_ref: semanticInductionBaseReleaseReferenceSchema.nullable(),
  sources: z
    .array(z.union([existingSourceSchema, packageSourceSchema]))
    .min(1)
    .max(64),
  idempotency_key: workspaceIdempotencyKeySchema,
});

function governedSource(source: z.infer<typeof existingSourceSchema>) {
  return {
    schema_version: "semantic-induction-source@1.0.0" as const,
    source_kind: source.source_kind,
    source_ref: {
      resource_kind:
        source.source_kind === "PHYSICAL_SCHEMA"
          ? ("SCHEMA_SNAPSHOT" as const)
          : ("KNOWLEDGE_REVISION" as const),
      resource_id: source.resource_id,
      resource_revision: source.resource_revision,
      resource_hash: source.resource_hash,
    },
    corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS" as const,
    taint: {
      contains_holdout_or_test: false as const,
      contains_gold_or_expected_output: false as const,
      contains_oracle_feedback: false as const,
      sealed_benchmark: false as const,
    },
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "INDUCTION",
    access: "WRITE",
    workspaceId,
  });
  if (!resolved.ok) return resolved.response;
  const { capabilityInput, principalId, queue, registry, scope } = resolved.runtime;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "SEMANTIC_INDUCTION_INPUT_INVALID",
      message: "Semantic induction request does not match the strict contract.",
      retryable: false,
    });
  }
  const inductionId = deriveIdempotentOperationId({
    operation_kind: "semantic-induction",
    workspace_id: workspaceId,
    principal_id: principalId,
    idempotency_key: input.data.idempotency_key,
  });
  const sources = [];
  for (const [index, source] of input.data.sources.entries()) {
    if (!("facts" in source)) {
      sources.push(governedSource(source));
      continue;
    }
    const command = await buildSemanticInductionSourceRegistrationCommand({
      schema_version: "semantic-induction-source-register@1.0.0",
      scope,
      semantic_domain: input.data.semantic_domain,
      source_kind: source.source_kind,
      resource_id: deriveIdempotentOperationId({
        operation_kind: `semantic-induction-source-${index}`,
        workspace_id: workspaceId,
        principal_id: principalId,
        idempotency_key: input.data.idempotency_key,
      }),
      resource_revision: source.resource_revision,
      content: {
        metric_format: source.metric_format,
        facts: source.facts,
        metrics: source.metrics,
        dependencies: source.dependencies,
      },
    });
    const registered = await registry.registerSource(capabilityInput, command);
    if (!registered.ok) return workspaceErrorResponse(registered.error);
    sources.push(command.source);
  }
  sources.sort((left, right) => {
    const leftIdentity = `${left.source_kind}:${left.source_ref.resource_id}:${left.source_ref.resource_revision}:${left.source_ref.resource_hash}`;
    const rightIdentity = `${right.source_kind}:${right.source_ref.resource_id}:${right.source_ref.resource_revision}:${right.source_ref.resource_hash}`;
    return leftIdentity.localeCompare(rightIdentity);
  });
  const inductionRequest = semanticInductionRequestSchema.parse({
    schema_version: "semantic-induction-request@1.0.0",
    scope,
    semantic_domain: input.data.semantic_domain,
    induction_id: inductionId,
    induction_kind: input.data.induction_kind,
    base_release_ref: input.data.base_release_ref,
    sources,
    idempotency_key: input.data.idempotency_key,
  });
  const job = await queue.enqueue(
    await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: input.data.induction_kind === "METRIC_IMPORT" ? "METRIC_IMPORT" : "SEMANTIC_INDUCTION",
      idempotency_key: input.data.idempotency_key,
      input: {
        schema_version: "job-input@1.0.0",
        kind:
          input.data.induction_kind === "METRIC_IMPORT" ? "METRIC_IMPORT" : "SEMANTIC_INDUCTION",
        resource_refs: [],
        parameters: { request: inductionRequest },
      },
      priority: 50,
      max_attempts: 3,
      cancel_policy: "COOPERATIVE",
    }),
  );
  return job.ok
    ? NextResponse.json({ data: { induction_id: inductionId, job: job.value } }, { status: 202 })
    : workspaceErrorResponse(job.error);
}
