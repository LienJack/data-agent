import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";

const teamProfileIdSchema = z.enum([
  "data-agent-orchestrator",
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
]);

export const agentTeamTraceTaskSchema = z.strictObject({
  task_id: immutableIdSchema,
  parent_task_id: immutableIdSchema.nullable(),
  depth: z.union([z.literal(0), z.literal(1)]),
  profile_id: teamProfileIdSchema,
  profile_revision: z.number().int().positive().safe(),
  profile_hash: contentHashSchema,
  task_revision: z.number().int().positive().safe(),
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive().safe(),
  status: z.enum(["RUNNING", "COMPLETED", "ACCEPTED", "REJECTED"]),
  created_at: timestampSchema,
});

export const agentTeamTraceHandoffSchema = z.strictObject({
  handoff_id: immutableIdSchema,
  parent_task_id: immutableIdSchema,
  child_task_id: immutableIdSchema,
  parent_expected_revision: z.number().int().positive().safe(),
  request_hash: contentHashSchema,
  created_at: timestampSchema,
});

export const agentTeamTraceEpochSchema = z.strictObject({
  task_id: immutableIdSchema,
  epoch_id: immutableIdSchema,
  epoch_revision: z.number().int().positive().safe(),
  phase: z.enum([
    "STARTED",
    "SUMMARY_COMMITTED",
    "REPLACEMENT_COMMITTED",
    "PROBE_PASSED",
    "ACTIVATED",
  ]),
  build_signature: contentHashSchema,
  obligation_ledger_hash: contentHashSchema,
  created_at: timestampSchema,
});

export const agentTeamTraceVerifierSchema = z.strictObject({
  task_id: immutableIdSchema,
  task_revision: z.number().int().positive().safe(),
  decision_id: immutableIdSchema,
  completion_hash: contentHashSchema,
  decision_hash: contentHashSchema,
  created_at: timestampSchema,
});

const agentTeamTraceBoundsSchema = z.strictObject({
  max_context_bytes: z.number().int().positive().safe(),
  max_input_tokens: z.number().int().positive().safe(),
  max_output_tokens: z.number().int().positive().safe(),
  max_tool_calls: z.number().int().nonnegative().safe(),
  timeout_ms: z.number().int().positive().safe(),
});

const teamArtifactTypeSchema = artifactReferenceSchema.shape.artifact_type;

export const agentTeamTraceTaskV2Schema = agentTeamTraceTaskSchema.extend({
  goal_revision: z.number().int().positive().safe(),
  bounds: agentTeamTraceBoundsSchema,
  required_artifact_types: z.array(teamArtifactTypeSchema).min(1).max(8),
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  context_epoch_ref: z
    .strictObject({ epoch_id: immutableIdSchema, build_signature: contentHashSchema })
    .nullable(),
  completion: z
    .strictObject({ output_ref: artifactReferenceSchema, completed_at: timestampSchema })
    .nullable(),
  acceptance: z
    .strictObject({
      status: z.enum(["ACCEPTED", "REJECTED"]),
      reason: z
        .enum(["VERIFIER_NOT_PASSED", "CONTEXT_COVERAGE_BLOCKED", "OPEN_OBLIGATIONS"])
        .nullable(),
      accepted_at: timestampSchema,
    })
    .nullable(),
});

export const agentTeamTraceHandoffV2Schema = agentTeamTraceHandoffSchema.extend({
  child_required_artifact_types: z.array(teamArtifactTypeSchema).min(1).max(8),
  child_bounds: agentTeamTraceBoundsSchema,
});

export const agentTeamTraceEpochV2Schema = agentTeamTraceEpochSchema.extend({
  obligation_counts: z.strictObject({
    total: z.number().int().nonnegative().max(256).safe(),
    open: z.number().int().nonnegative().max(256).safe(),
    unknown: z.number().int().nonnegative().max(256).safe(),
    resolved: z.number().int().nonnegative().max(256).safe(),
  }),
});

const verifierDimensionSchema = z.enum(["PASS", "FAIL", "UNVERIFIED"]);

export const agentTeamTraceVerifierV2Schema = agentTeamTraceVerifierSchema.extend({
  dimensions: z.strictObject({
    schema_valid: verifierDimensionSchema,
    scope_valid: verifierDimensionSchema,
    policy_valid: verifierDimensionSchema,
    provenance_valid: verifierDimensionSchema,
    execution_valid: verifierDimensionSchema,
    intent_grounded: verifierDimensionSchema,
    oracle_verified: verifierDimensionSchema,
  }),
  semantic_status: z.enum(["VERIFIED", "SEMANTICALLY_UNVERIFIED", "NEEDS_CLARIFICATION"]),
  decided_at: timestampSchema,
  acceptance: z
    .strictObject({
      status: z.enum(["ACCEPTED", "REJECTED"]),
      reason: z
        .enum(["VERIFIER_NOT_PASSED", "CONTEXT_COVERAGE_BLOCKED", "OPEN_OBLIGATIONS"])
        .nullable(),
      accepted_at: timestampSchema,
    })
    .nullable(),
});

const agentTeamTraceDraftSchema = z.strictObject({
  schema_version: z.literal("agent-team-public-trace@1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  tasks: z.array(agentTeamTraceTaskSchema).max(1_000),
  handoffs: z.array(agentTeamTraceHandoffSchema).max(1_000),
  epochs: z.array(agentTeamTraceEpochSchema).max(10_000),
  verifier_decisions: z.array(agentTeamTraceVerifierSchema).max(1_000),
});

const agentTeamTraceDraftV2Schema = z.strictObject({
  schema_version: z.literal("agent-team-public-trace@2.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  tasks: z.array(agentTeamTraceTaskV2Schema).max(1_000),
  handoffs: z.array(agentTeamTraceHandoffV2Schema).max(1_000),
  epochs: z.array(agentTeamTraceEpochV2Schema).max(10_000),
  verifier_decisions: z.array(agentTeamTraceVerifierV2Schema).max(1_000),
});

function canonicalIds(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

function addIssues(
  trace: {
    readonly tasks: readonly z.infer<typeof agentTeamTraceTaskSchema>[];
    readonly handoffs: readonly z.infer<typeof agentTeamTraceHandoffSchema>[];
    readonly epochs: readonly z.infer<typeof agentTeamTraceEpochSchema>[];
    readonly verifier_decisions: readonly z.infer<typeof agentTeamTraceVerifierSchema>[];
  },
  ctx: z.RefinementCtx,
): void {
  const taskIds = trace.tasks.map(({ task_id }) => task_id);
  if (!canonicalIds(taskIds)) {
    ctx.addIssue({
      code: "custom",
      message: "Team tasks must be unique and sorted.",
      path: ["tasks"],
    });
  }
  const taskSet = new Set(taskIds);
  const taskById = new Map(trace.tasks.map((task) => [task.task_id, task]));
  trace.tasks.forEach((task, index) => {
    if (task.parent_task_id && !taskSet.has(task.parent_task_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Team parent task is missing.",
        path: ["tasks", index],
      });
    }
    if (
      (task.depth === 0 &&
        (task.parent_task_id !== null || task.profile_id !== "data-agent-orchestrator")) ||
      (task.depth === 1 &&
        (task.parent_task_id === null || task.profile_id === "data-agent-orchestrator"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Team task depth, parent and Profile lineage is invalid.",
        path: ["tasks", index],
      });
    }
  });
  if (trace.tasks.filter(({ depth }) => depth === 0).length !== 1) {
    ctx.addIssue({ code: "custom", message: "Team trace must contain exactly one root task." });
  }
  for (const [field, identities] of [
    ["handoffs", trace.handoffs.map(({ handoff_id }) => handoff_id)],
    [
      "epochs",
      trace.epochs.map((epoch) => `${epoch.task_id}:${epoch.epoch_id}:${epoch.epoch_revision}`),
    ],
    ["verifier_decisions", trace.verifier_decisions.map(({ decision_id }) => decision_id)],
  ] as const) {
    if (!canonicalIds(identities)) {
      ctx.addIssue({
        code: "custom",
        message: `${field} must be unique and sorted.`,
        path: [field],
      });
    }
  }
  trace.handoffs.forEach((handoff, index) => {
    if (!taskSet.has(handoff.parent_task_id) || !taskSet.has(handoff.child_task_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Handoff task endpoint is missing.",
        path: ["handoffs", index],
      });
    }
    if (taskById.get(handoff.child_task_id)?.parent_task_id !== handoff.parent_task_id) {
      ctx.addIssue({
        code: "custom",
        message: "Handoff does not match child task lineage.",
        path: ["handoffs", index],
      });
    }
  });
  trace.epochs.forEach((epoch, index) => {
    if (!taskSet.has(epoch.task_id)) {
      ctx.addIssue({ code: "custom", message: "Epoch task is missing.", path: ["epochs", index] });
    }
  });
  trace.verifier_decisions.forEach((decision, index) => {
    if (!taskSet.has(decision.task_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Verifier task is missing.",
        path: ["verifier_decisions", index],
      });
    }
  });
}

function addV2Issues(trace: z.infer<typeof agentTeamTraceDraftV2Schema>, ctx: z.RefinementCtx) {
  addIssues(trace, ctx);
  trace.tasks.forEach((task, index) => {
    const refs = [...task.artifact_refs, ...(task.completion ? [task.completion.output_ref] : [])];
    refs.forEach((reference) => {
      if (
        reference.app_id !== trace.scope.app_id ||
        reference.tenant_id !== trace.scope.tenant_id ||
        reference.environment !== trace.scope.environment ||
        reference.run_id !== trace.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Team public Artifact scope/run identity mismatch.",
          path: ["tasks", index, "artifact_refs"],
        });
      }
    });
    if (
      task.completion &&
      !task.required_artifact_types.includes(task.completion.output_ref.artifact_type)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Team completion output type is not required by the task.",
        path: ["tasks", index, "completion", "output_ref", "artifact_type"],
      });
    }
  });
  trace.epochs.forEach((epoch, index) => {
    if (
      epoch.obligation_counts.open +
        epoch.obligation_counts.unknown +
        epoch.obligation_counts.resolved !==
      epoch.obligation_counts.total
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Team obligation counts do not close.",
        path: ["epochs", index, "obligation_counts"],
      });
    }
  });
}

export const agentTeamPublicTraceSchema = agentTeamTraceDraftSchema
  .extend({ trace_hash: contentHashSchema })
  .superRefine(addIssues);

export const agentTeamPublicTraceV2Schema = agentTeamTraceDraftV2Schema
  .extend({ trace_hash: contentHashSchema })
  .superRefine(addV2Issues);

export const anyAgentTeamPublicTraceSchema = z.union([
  agentTeamPublicTraceV2Schema,
  agentTeamPublicTraceSchema,
]);

export async function buildAgentTeamPublicTrace(input: unknown) {
  const version = z.object({ schema_version: z.string() }).parse(input).schema_version;
  const draftSchema =
    version === "agent-team-public-trace@2.0.0"
      ? agentTeamTraceDraftV2Schema.superRefine(addV2Issues)
      : agentTeamTraceDraftSchema.superRefine(addIssues);
  const outputSchema =
    version === "agent-team-public-trace@2.0.0"
      ? agentTeamPublicTraceV2Schema
      : agentTeamPublicTraceSchema;
  const draft = draftSchema.parse(input);
  return deepFreeze(outputSchema.parse({ ...draft, trace_hash: await sha256ContentHash(draft) }));
}

export async function verifyAgentTeamPublicTrace(input: unknown) {
  const trace = anyAgentTeamPublicTraceSchema.parse(input);
  const { trace_hash: actual, ...draft } = trace;
  const parsedDraft =
    draft.schema_version === "agent-team-public-trace@2.0.0"
      ? agentTeamTraceDraftV2Schema.parse(draft)
      : agentTeamTraceDraftSchema.parse(draft);
  if ((await sha256ContentHash(parsedDraft)) !== actual) {
    throw new TypeError("AGENT_TEAM_PUBLIC_TRACE_HASH_MISMATCH");
  }
  return deepFreeze(trace);
}

export type AgentTeamPublicTrace = z.infer<typeof anyAgentTeamPublicTraceSchema>;
