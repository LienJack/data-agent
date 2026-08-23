import "server-only";

import type { PersistedRun } from "@data-agent/platform";
import type { RunProjection } from "./run-projection";

export function workspaceRunProjection(run: PersistedRun, datasourceId?: string): RunProjection {
  const status: RunProjection["status"] =
    run.status === "SUCCEEDED"
      ? "COMPLETED"
      : run.status === "WAITING"
        ? "RUNNING"
        : run.status === "QUEUED" ||
            run.status === "RUNNING" ||
            run.status === "FAILED" ||
            run.status === "CANCELLED"
          ? run.status
          : "FAILED";
  return {
    runId: run.run_id,
    status,
    question: run.question,
    scope: {
      workspace: run.tenant_id,
      ...(datasourceId ? { dataset: datasourceId } : {}),
    },
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    l2Only: true,
  };
}
