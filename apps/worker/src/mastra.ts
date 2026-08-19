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
import {
  createBillingGatedModelProvider,
  type ModelBillingPort,
  type ModelBillingProviderLifecycle,
} from "@data-agent/platform";

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
  readonly billing: Pick<ModelBillingPort, "authorize" | "finalize">;
  readonly billing_lifecycle: ModelBillingProviderLifecycle;
}): WorkerMastraComposition {
  const delegate = createModelProviderPort({
    ...input,
    tools: input.tools ?? [],
    dispatch_marker: {
      // This legacy billing composition is not the U3 audited dispatch path.
      // Fail closed at DISPATCH_READY so it can never cross the network without
      // a PostgreSQL-backed provider invocation permit.
      mark_dispatched: async () => {
        throw new Error("PROVIDER_PERSISTENT_DISPATCH_MARKER_REQUIRED");
      },
    },
  });
  return Object.freeze({
    model_provider: createBillingGatedModelProvider({
      delegate,
      billing: input.billing,
      lifecycle: input.billing_lifecycle,
    }),
  });
}
