import {
  createModelProviderPort,
  type DeploymentModelProviderBindingResolver,
  type ModelCredentialResolver,
  type ModelProviderAdapterClock,
  type ServerModelResponseSchemaRegistry,
  type ServerOwnedToolDescriptor,
  type TrustedModelInputTokenCounter,
} from "@data-agent/agent-runtime";
import type { ModelProviderPort } from "@data-agent/contracts";

export interface WorkerMastraComposition {
  readonly model_provider: ModelProviderPort;
}

/**
 * U3 模型运行时的 Worker 组合根。
 *
 * 持久 Run、Lease、Snapshot 与 Replay 留给 U4；这里仅把服务端冻结的模型绑定、
 * Credential 与 Tool 描述符装配成项目 ModelProviderPort。
 */
export function createWorkerMastraComposition(input: {
  readonly credential_resolver: ModelCredentialResolver;
  readonly binding_resolver: DeploymentModelProviderBindingResolver;
  readonly response_schema_registry: ServerModelResponseSchemaRegistry;
  readonly input_token_counter: TrustedModelInputTokenCounter;
  readonly tools?: readonly ServerOwnedToolDescriptor[];
  readonly clock?: ModelProviderAdapterClock;
}): WorkerMastraComposition {
  return Object.freeze({
    model_provider: createModelProviderPort({
      ...input,
      tools: input.tools ?? [],
      dispatch_marker: {
        // The legacy composition is not the audited U3 path. Keep it unable to
        // cross the network without a durable PostgreSQL dispatch marker.
        mark_dispatched: async () => {
          throw new Error("PROVIDER_PERSISTENT_DISPATCH_MARKER_REQUIRED");
        },
      },
    }),
  });
}
