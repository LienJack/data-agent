import {
  hasRunExecutionContextProvenance,
  hasRunProviderDispatchCapability,
} from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

/** @internal U3-only executor; it never exposes protected Provider response content. */
export function createProviderSmokeExecutor(): RunWorkflowExecutorPort {
  const executor: RunWorkflowExecutorPort = {
    async execute({ lease, context, signal }) {
      if (!hasRunExecutionContextProvenance(context)) {
        return { kind: "FAILED", error_code: "RUN_EXECUTION_CONTEXT_UNTRUSTED" };
      }
      if (signal.aborted) return { kind: "FAILED", error_code: "RUN_EXECUTION_ABORTED" };
      const dispatch = context.getProviderDispatchCapability();
      if (!hasRunProviderDispatchCapability(dispatch)) {
        return { kind: "FAILED", error_code: "PROVIDER_DISPATCH_AUTHORITY_NOT_CONFIGURED" };
      }
      const result = await dispatch.invoke({ logical_call_id: lease.command_id });
      if (!result.ok) return { kind: "FAILED", error_code: result.error.code };
      if (result.value.projection.status !== "COMPLETED") {
        return { kind: "FAILED", error_code: "PROVIDER_INVOCATION_SMOKE_NOT_COMPLETED" };
      }
      return { kind: "COMPLETED" };
    },
  };
  return Object.freeze(executor);
}
