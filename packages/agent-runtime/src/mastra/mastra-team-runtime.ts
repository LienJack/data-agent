import {
  canonicalizeJson,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type TeamTaskV2,
  type TeamWorkflowRegistry,
  type TeamWorkflowResult,
  teamTaskV2Schema,
} from "../teams/index.js";

const epochRefSchema = z.strictObject({
  epoch_id: immutableIdSchema,
  build_signature: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

export interface MastraTeamAuthorityPort {
  loadTask(taskId: string): Promise<unknown>;
  loadContextEpoch(task: TeamTaskV2): Promise<unknown>;
  recordExecutionSnapshot(snapshot: unknown): Promise<void>;
}

export interface MastraTeamRuntimeOptions {
  readonly authority: MastraTeamAuthorityPort;
  readonly workflows: TeamWorkflowRegistry;
}

export class MastraTeamRuntime {
  constructor(private readonly options: MastraTeamRuntimeOptions) {}

  async execute(taskIdInput: string, signal?: AbortSignal): Promise<TeamWorkflowResult> {
    const taskId = immutableIdSchema.parse(taskIdInput);
    const initial = teamTaskV2Schema.parse(await this.options.authority.loadTask(taskId));
    const epoch = epochRefSchema.parse(await this.options.authority.loadContextEpoch(initial));
    if (
      initial.context_epoch_ref === null ||
      canonicalizeJson(initial.context_epoch_ref) !== canonicalizeJson(epoch)
    ) {
      throw new Error("TEAM_CONTEXT_EPOCH_AUTHORITY_MISMATCH");
    }
    const current = teamTaskV2Schema.parse(await this.options.authority.loadTask(taskId));
    if (initial.task_hash !== current.task_hash) throw new Error("TEAM_TASK_AUTHORITY_DRIFT");
    const snapshotDraft = {
      schema_version: "mastra-team-snapshot@2.0.0",
      authority: "EXECUTION_SNAPSHOT_ONLY",
      mastra_core_version: "1.52.1",
      task_id: current.task_id,
      task_revision: current.task_revision,
      task_hash: current.task_hash,
      attempt_id: current.attempt_id,
      worker_fence: current.worker_fence,
      context_epoch: epoch,
    } as const;
    await this.options.authority.recordExecutionSnapshot(
      deepFreeze({ ...snapshotDraft, snapshot_hash: await sha256ContentHash(snapshotDraft) }),
    );
    return this.options.workflows.execute(current, epoch, signal);
  }
}
