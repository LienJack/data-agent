import { effectiveConfigRunLeasePayloadSchema } from "@data-agent/contracts/runs";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

export function createRunWorkflowExecutorRouter(input: {
  readonly research: RunWorkflowExecutorPort;
  readonly team: RunWorkflowExecutorPort;
}): RunWorkflowExecutorPort {
  return {
    execute(execution) {
      const payload = effectiveConfigRunLeasePayloadSchema.parse(execution.lease.payload);
      if (payload.kind !== execution.lease.command_kind) {
        throw new TypeError("RUN_WORKFLOW_COMMAND_PAYLOAD_MISMATCH");
      }
      switch (payload.kind) {
        case "START_L2_RESEARCH":
          return input.research.execute(execution);
        case "START_DATA_AGENT_TEAM":
          return input.team.execute(execution);
      }
    },
  };
}
