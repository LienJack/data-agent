import type {
  AppScope,
  ContractError,
  PortResult,
  RunWorkLease,
  SideEffectReceipt,
} from "@data-agent/contracts";
import type { JSONType } from "zod";

export function success<T>(value: T): PortResult<T> {
  return { ok: true, value };
}

export function failure<T>(
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, JSONType>,
): PortResult<T> {
  const error: ContractError = details
    ? { code, message, retryable, details }
    : { code, message, retryable };
  return { ok: false, error };
}

export function scopesMatch(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

export function occurredAt(now: () => Date): string {
  return now().toISOString();
}

export function receiptMatchesRequest(
  receipt: SideEffectReceipt,
  lease: RunWorkLease,
  effectKind: SideEffectReceipt["effect_kind"],
  inputHash: string,
): boolean {
  return (
    scopesMatch(receipt.scope, lease.scope) &&
    receipt.run_id === lease.run_id &&
    receipt.effect_kind === effectKind &&
    receipt.input_hash === inputHash
  );
}
