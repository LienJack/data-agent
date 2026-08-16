import type { AppScope, PortResult } from "@data-agent/contracts";
import type { RunWorkerCycleOutcome, RunWorkerRunner } from "./run-worker-runner.js";

export interface ActiveWorkspacePrincipal {
  readonly principal_id: string;
}

export function isRunnableWorkspaceMember(member: {
  readonly role: string;
  readonly user_status: string;
  readonly revoked_at: string | null;
}): boolean {
  return (
    member.user_status === "ACTIVE" &&
    member.revoked_at === null &&
    (member.role === "OWNER" || member.role === "ANALYST")
  );
}

const principalDeniedCodes = new Set([
  "APP_SCOPE_FORBIDDEN",
  "APP_AUTHORITY_STALE_OR_FORBIDDEN",
  "MEMBERSHIP_REVOKED",
  "PERSISTENCE_WRITE_DENIED",
  "RUN_EVENT_STORE_PRINCIPAL_DENIED",
  "RUN_QUEUE_PRINCIPAL_DENIED",
  "WORKSPACE_ACCESS_DENIED",
  "WORKSPACE_ROLE_DENIED",
]);

function isPrincipalDenied(code: string): boolean {
  return principalDeniedCodes.has(code);
}

export function createMultiPrincipalRunWorkerRunner(input: {
  readonly listPrincipals: () => Promise<PortResult<readonly ActiveWorkspacePrincipal[]>>;
  readonly createRunner: (principalId: string) => Promise<PortResult<RunWorkerRunner>>;
}): RunWorkerRunner {
  const runners = new Map<string, RunWorkerRunner>();
  let nextPrincipalId: string | null = null;

  return Object.freeze({
    async runOnce(context: {
      readonly scope: AppScope;
      readonly worker_id: string;
    }): Promise<PortResult<RunWorkerCycleOutcome>> {
      const listed = await input.listPrincipals();
      if (!listed.ok) return listed;
      const principals = [...new Set(listed.value.map((entry) => entry.principal_id))].sort();
      const active = new Set(principals);
      for (const principalId of runners.keys()) {
        if (!active.has(principalId)) runners.delete(principalId);
      }
      if (principals.length === 0) {
        nextPrincipalId = null;
        return { ok: true, value: { kind: "IDLE" } };
      }
      const requestedStart = nextPrincipalId ? principals.indexOf(nextPrincipalId) : -1;
      const startIndex = requestedStart >= 0 ? requestedStart : 0;
      const ordered = principals.map(
        (_, offset) => principals[(startIndex + offset) % principals.length] as string,
      );
      for (const principalId of ordered) {
        let runner = runners.get(principalId);
        if (!runner) {
          const created = await input.createRunner(principalId);
          if (!created.ok) {
            if (isPrincipalDenied(created.error.code)) continue;
            return created;
          }
          runner = created.value;
          runners.set(principalId, runner);
        }
        const outcome = await runner.runOnce(context);
        if (!outcome.ok) {
          if (isPrincipalDenied(outcome.error.code)) {
            runners.delete(principalId);
            continue;
          }
          return outcome;
        }
        if (outcome.value.kind !== "IDLE") {
          const index = principals.indexOf(principalId);
          nextPrincipalId = principals[(index + 1) % principals.length] ?? null;
          return outcome;
        }
      }
      return { ok: true, value: { kind: "IDLE" } };
    },
  });
}
