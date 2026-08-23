import {
  type EcommerceDirectQaRegistration,
  matchesEcommerceDirectQaRegistration,
} from "@data-agent/evals/ecommerce-direct-qa";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

export interface RegisteredEcommerceDirectQaAdapter {
  readonly registration: EcommerceDirectQaRegistration;
  readonly executor: RunWorkflowExecutorPort;
}

export function createEcommerceDirectQaRegistry(input: {
  readonly registrations: readonly RegisteredEcommerceDirectQaAdapter[];
  readonly fallback: RunWorkflowExecutorPort;
}): RunWorkflowExecutorPort {
  const unique = new Set(
    input.registrations.map(
      ({ registration }) => `${registration.workspace_id}\0${registration.benchmark_profile_id}`,
    ),
  );
  if (unique.size !== input.registrations.length) {
    throw new Error("ECOMMERCE_DIRECT_QA_REGISTRATION_DUPLICATE");
  }
  return Object.freeze({
    execute(execution: Parameters<RunWorkflowExecutorPort["execute"]>[0]) {
      const config = execution.context.getEffectiveConfig();
      const selected = input.registrations.find(({ registration }) =>
        matchesEcommerceDirectQaRegistration(registration, {
          workspace_id: execution.lease.scope.tenant_id,
          datasource_id: config.datasource.resource_id,
          semantic_release_id: config.semantic_release.resource_id,
        }),
      );
      return (selected?.executor ?? input.fallback).execute(execution);
    },
  });
}
