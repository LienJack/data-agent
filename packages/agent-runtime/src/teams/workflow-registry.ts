import {
  type ArtifactReference,
  artifactReferenceSchema,
  deepFreeze,
  immutableIdSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type AgentProfileRevision,
  agentProfileRevisionSchema,
  type DataAgentProfileId,
} from "./agent-profiles.js";
import { type TeamTaskV2, teamTaskV2Schema } from "./team-orchestrator.js";

const workflowResultSchema = z.strictObject({
  status: z.enum(["COMPLETED", "FAILED", "NEEDS_CLARIFICATION"]),
  task_id: immutableIdSchema,
  output_ref: artifactReferenceSchema.nullable(),
});

export type TeamWorkflowResult = z.infer<typeof workflowResultSchema>;
export type TeamWorkflowInput = Readonly<{
  task: TeamTaskV2;
  context_epoch: Readonly<{ epoch_id: string; build_signature: string }>;
  signal?: AbortSignal;
}>;
export type TeamWorkflowExecutor = (input: TeamWorkflowInput) => Promise<TeamWorkflowResult>;

type RegisteredWorkflow = Readonly<{
  profile: AgentProfileRevision;
  executor: TeamWorkflowExecutor;
}>;

export class TeamWorkflowRegistry {
  readonly #workflows = new Map<DataAgentProfileId, RegisteredWorkflow>();

  register(profileInput: unknown, executor: TeamWorkflowExecutor): void {
    const profile = agentProfileRevisionSchema.parse(profileInput);
    if (this.#workflows.has(profile.profile_id))
      throw new Error("TEAM_WORKFLOW_ALREADY_REGISTERED");
    this.#workflows.set(profile.profile_id, deepFreeze({ profile, executor }));
  }

  async execute(
    taskInput: unknown,
    contextEpoch: Readonly<{ epoch_id: string; build_signature: string }>,
    signal?: AbortSignal,
  ): Promise<TeamWorkflowResult> {
    const task = teamTaskV2Schema.parse(taskInput);
    const registered = this.#workflows.get(task.profile_id);
    if (
      !registered ||
      registered.profile.revision !== task.profile_revision ||
      registered.profile.profile_hash !== task.profile_hash
    ) {
      throw new Error("TEAM_WORKFLOW_PROFILE_MISMATCH");
    }
    if (signal?.aborted) throw new Error("TEAM_WORKFLOW_ABORTED");
    const executionInput: TeamWorkflowInput = {
      task,
      context_epoch: contextEpoch,
      ...(signal ? { signal } : {}),
    };
    const result = workflowResultSchema.parse(await registered.executor(executionInput));
    if (result.task_id !== task.task_id) throw new Error("TEAM_WORKFLOW_TASK_MISMATCH");
    if (result.status === "COMPLETED") {
      const output = result.output_ref as ArtifactReference | null;
      if (
        !output ||
        output.app_id !== task.scope.app_id ||
        output.tenant_id !== task.scope.tenant_id ||
        output.environment !== task.scope.environment ||
        output.run_id !== task.run_id ||
        !task.acceptance.required_artifact_types.includes(output.artifact_type)
      ) {
        throw new Error("TEAM_WORKFLOW_OUTPUT_INVALID");
      }
    } else if (result.output_ref !== null) {
      throw new Error("TEAM_WORKFLOW_OUTPUT_INVALID");
    }
    return deepFreeze(result);
  }
}
