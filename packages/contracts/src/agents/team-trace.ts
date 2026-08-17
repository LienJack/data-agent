import { z } from "zod";
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

const agentTeamTraceDraftSchema = z.strictObject({
  schema_version: z.literal("agent-team-public-trace@1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  tasks: z.array(agentTeamTraceTaskSchema).max(1_000),
  handoffs: z.array(agentTeamTraceHandoffSchema).max(1_000),
  epochs: z.array(agentTeamTraceEpochSchema).max(10_000),
  verifier_decisions: z.array(agentTeamTraceVerifierSchema).max(1_000),
});

function canonicalIds(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

function addIssues(trace: z.infer<typeof agentTeamTraceDraftSchema>, ctx: z.RefinementCtx): void {
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

export const agentTeamPublicTraceSchema = agentTeamTraceDraftSchema
  .extend({ trace_hash: contentHashSchema })
  .superRefine(addIssues);

export async function buildAgentTeamPublicTrace(input: unknown) {
  const draft = agentTeamTraceDraftSchema.superRefine(addIssues).parse(input);
  return deepFreeze(
    agentTeamPublicTraceSchema.parse({ ...draft, trace_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifyAgentTeamPublicTrace(input: unknown) {
  const trace = agentTeamPublicTraceSchema.parse(input);
  const { trace_hash: actual, ...draft } = trace;
  if ((await sha256ContentHash(agentTeamTraceDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("AGENT_TEAM_PUBLIC_TRACE_HASH_MISMATCH");
  }
  return deepFreeze(trace);
}

export type AgentTeamPublicTrace = z.infer<typeof agentTeamPublicTraceSchema>;
