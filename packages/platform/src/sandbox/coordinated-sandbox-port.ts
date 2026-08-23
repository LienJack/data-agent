import type {
  PortResult,
  SandboxExecutionReceipt,
  SandboxExecutionRequest,
  SandboxPort,
} from "@data-agent/contracts";
import {
  authorizeSandboxExecutionReceipt,
  cancelSandboxExecution,
  type ExecutionGrant,
  failSandboxExecution,
  finalizeSandboxExecution,
  prepareSandboxExecution,
  SandboxExecutionAuthorityError,
  type SandboxExecutionTransitionResult,
  type SandboxServerAuthority,
} from "@data-agent/contracts/server";
import type {
  PythonSqlSandboxClient,
  PythonSqlSandboxExecutionHandle,
} from "./python-sql-sandbox.js";

export interface CoordinatedSandboxPortOptions {
  readonly authority: SandboxServerAuthority;
  readonly python: PythonSqlSandboxClient;
  /**
   * 只提供 Datasource Operation 数据，不能授权执行。
   *
   * Coordinator 会覆盖返回值中的 grant；Python Client 再以 Authority 签发的 Grant
   * 精确校验 SQL、Parameters、Settings、Budget 与 Snapshot Plan。
   */
  resolve_operation(grant: ExecutionGrant): Promise<unknown> | unknown;
}

export interface ActiveSandboxCancelRequest {
  readonly execution_id: string;
  readonly requested_at: string;
  readonly reason_code: "USER_CANCELLED" | "DEADLINE_EXCEEDED" | "AUTHORITY_REVOKED";
}

export interface CoordinatedSandboxPort extends SandboxPort {
  cancelActive(
    input: ActiveSandboxCancelRequest,
  ): Promise<PortResult<SandboxExecutionTransitionResult>>;
}

interface ActiveExecution {
  readonly handle: PythonSqlSandboxExecutionHandle;
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return {
    ok: false,
    error: { code, message, retryable },
  };
}

function transitionFailure<T>(transition: SandboxExecutionTransitionResult): PortResult<T> {
  return failure(
    transition.reason_code,
    `Sandbox Authority 以 ${transition.claim?.state ?? "UNKNOWN"} 关闭当前执行。`,
    transition.disposition === "IN_PROGRESS" || transition.disposition === "OUTCOME_UNKNOWN",
  );
}

function operationWithGrant(operation: unknown, grant: unknown): unknown {
  if (typeof operation !== "object" || operation === null || Array.isArray(operation)) {
    throw new TypeError("Sandbox Operation Resolver 必须返回对象。");
  }
  return { ...operation, grant };
}

export function createCoordinatedSandboxPort(
  options: CoordinatedSandboxPortOptions,
): CoordinatedSandboxPort {
  const active = new Map<string, ActiveExecution>();

  const execute = async (
    input: SandboxExecutionRequest,
  ): Promise<PortResult<SandboxExecutionReceipt>> => {
    let activeExecution: ActiveExecution | undefined;
    let executionId: string | undefined;
    try {
      const preparation = await prepareSandboxExecution(input, options.authority);
      if (preparation.disposition === "REPLAYED" && preparation.claim?.receipt_ref) {
        return {
          ok: true,
          value: await authorizeSandboxExecutionReceipt(
            preparation.claim.receipt_ref,
            options.authority,
          ),
        };
      }
      if (preparation.disposition !== "ACCEPTED" || !preparation.grant || !preparation.claim) {
        return transitionFailure(preparation);
      }

      const grant = preparation.grant;
      executionId = grant.identity.execution_id;
      const operation = await options.resolve_operation(grant);
      const handle = await options.python.start(operationWithGrant(operation, grant));
      activeExecution = { handle };
      if (active.has(executionId)) {
        handle.terminate();
        return failure(
          "SANDBOX_EXECUTION_IN_PROGRESS",
          "同一个 Execution 已有活跃 Datasource Process。",
          true,
        );
      }
      active.set(executionId, activeExecution);

      const outcome = await handle.outcome;
      const transition =
        outcome.terminal === "FAILED"
          ? await failSandboxExecution(outcome, options.authority)
          : await finalizeSandboxExecution(outcome, options.authority);
      if (transition.claim?.state !== "COMPLETED" || !transition.claim.receipt_ref) {
        return transitionFailure(transition);
      }
      return {
        ok: true,
        value: await authorizeSandboxExecutionReceipt(
          transition.claim.receipt_ref,
          options.authority,
        ),
      };
    } catch (error) {
      if (error instanceof SandboxExecutionAuthorityError) {
        return failure(error.code, error.message);
      }
      return failure(
        "SANDBOX_EXECUTION_OUTCOME_UNKNOWN",
        "Sandbox 未形成可由 Authority 提交的完整 Outcome；Claim 将按 Lease Recovery 处理。",
        true,
      );
    } finally {
      if (executionId && activeExecution && active.get(executionId) === activeExecution) {
        active.delete(executionId);
      }
    }
  };

  return {
    execute,
    async cancelActive(
      input: ActiveSandboxCancelRequest,
    ): Promise<PortResult<SandboxExecutionTransitionResult>> {
      const running = active.get(input.execution_id);
      if (!running) {
        return failure(
          "SANDBOX_EXECUTION_NOT_ACTIVE",
          "当前进程没有可取消的活跃 Sandbox Execution。",
        );
      }
      try {
        const transition = await cancelSandboxExecution(
          {
            identity: running.handle.grant.identity,
            expected_cancel_epoch: running.handle.grant.cancel_epoch,
            requested_at: input.requested_at,
          },
          options.authority,
        );
        if (transition.disposition === "CANCEL_ACCEPTED" && transition.claim) {
          try {
            running.handle.cancel({
              cancel_epoch: transition.claim.cancel_epoch,
              requested_at: input.requested_at,
              reason_code: input.reason_code,
            });
          } catch {
            // Authority 已接受取消；若 Datasource 已终止，Finalize 会按 late cancel 丢弃候选。
          }
        }
        return { ok: true, value: transition };
      } catch (error) {
        return error instanceof SandboxExecutionAuthorityError
          ? failure(error.code, error.message)
          : failure("SANDBOX_AUTHORITY_REJECTED", "Sandbox Authority 无法接受当前取消请求。");
      }
    },
  };
}
