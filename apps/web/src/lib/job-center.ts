import "server-only";

import type { CapabilityReadinessReceipt } from "@data-agent/contracts";
import { createPostgresJobQueue } from "@data-agent/platform";
import { getWorkspaceAuthority, getWorkspaceSqlPool } from "./workspace-identity";

export function projectCapabilityReadiness(receipt: CapabilityReadinessReceipt) {
  return {
    capability: receipt.capability,
    status: receipt.status,
    reason_code: receipt.reason_code,
    evaluated_at: receipt.evaluated_at,
    valid_until: receipt.valid_until,
  } as const;
}

export function getWorkspaceJobQueue(capability: unknown) {
  return createPostgresJobQueue(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
    capability,
    { lease_duration_ms: 30_000 },
  );
}
