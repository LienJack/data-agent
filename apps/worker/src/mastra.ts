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
 * 轻量模型运行时的 Worker 组合根。
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
  const modelProvider = createModelProviderPort({
    ...input,
    tools: input.tools ?? [],
    dispatch_marker: {
      // Direct calls retain an in-process dispatch boundary only; no
      // PostgreSQL invocation permit or billing lifecycle is involved.
      mark_dispatched: async () => {},
    },
  });
  return Object.freeze({
    model_provider: modelProvider,
  });
}
