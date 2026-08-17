import { deepFreeze, immutableIdSchema } from "@data-agent/contracts";
import {
  authorizePersistedTaskCapability,
  type CommittedTaskCapabilityResolver,
  createSubagentDelegationCommand,
  teamTaskV2Schema,
} from "../teams/team-orchestrator.js";

export interface SubagentHandoffAuthority {
  prepareHandoff(command: unknown): Promise<unknown>;
}

export interface PersistedSubagentControllerOptions {
  readonly capabilities: CommittedTaskCapabilityResolver;
  readonly handoffs: SubagentHandoffAuthority;
  readonly now: () => string;
}

/**
 * Execution-only adapter. It cannot mint a capability and it cannot delegate
 * recursively: both facts are re-proved from committed Task Authority first.
 */
export function createPersistedSubagentController(options: PersistedSubagentControllerOptions) {
  return deepFreeze({
    async delegate(input: {
      readonly parent_task: unknown;
      readonly capability_id: string;
      readonly request: unknown;
    }) {
      const parent = teamTaskV2Schema.parse(input.parent_task);
      const capability = await authorizePersistedTaskCapability(
        parent,
        immutableIdSchema.parse(input.capability_id),
        options.capabilities,
        { now: options.now(), audience: "HANDOFF_PREPARE" },
      );
      const command = createSubagentDelegationCommand(parent, capability, input.request);
      await options.handoffs.prepareHandoff(command);
      return command;
    },
  });
}

export type PersistedSubagentController = ReturnType<typeof createPersistedSubagentController>;
