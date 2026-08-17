import type { AppScope, ModelProvider, ModelProviderPort } from "@data-agent/contracts";
import {
  createMastraModelExecutionBridge,
  MastraModelProviderAdapter,
  type ModelCredentialResolver,
  type ModelProviderAdapterClock,
  type ProviderDispatchMarker,
  type ServerModelProviderBindingResolver,
  type ServerModelResponseSchemaDescriptor,
  ServerModelResponseSchemaRegistry,
  type TrustedModelInputTokenCounter,
  type TrustedModelInputTokenCounterContext,
} from "./mastra/index.js";
import type { ModelProviderBinding } from "./models/bindings.js";
import { type ServerOwnedToolDescriptor, ServerOwnedToolRegistry } from "./tools/index.js";

/**
 * 部署侧模型绑定解析器。
 *
 * Worker 必须从服务端冻结的部署配置解析 Profile/Model，不能接收客户端覆盖值。
 */
export interface DeploymentModelProviderBindingResolver {
  resolve(input: {
    readonly scope: AppScope;
    readonly provider: ModelProvider;
    readonly profile_id: string;
    readonly profile_version: string;
  }): Promise<ModelProviderBinding | null>;
}

export interface ModelProviderPortCompositionInput {
  readonly credential_resolver: ModelCredentialResolver;
  readonly binding_resolver: DeploymentModelProviderBindingResolver;
  readonly response_schema_registry: ServerModelResponseSchemaRegistry;
  readonly input_token_counter: TrustedModelInputTokenCounter;
  readonly dispatch_marker: ProviderDispatchMarker;
  readonly abort_signal?: AbortSignal;
  readonly tools?: readonly ServerOwnedToolDescriptor[];
  readonly clock?: ModelProviderAdapterClock;
}

/**
 * 项目稳定的 ModelProviderPort 组合入口。
 *
 * Mastra 是内部执行实现；调用方只获得项目自有 Port，不能依赖框架构造器。
 */
export function createModelProviderPort(
  input: ModelProviderPortCompositionInput,
): ModelProviderPort {
  const toolRegistry = new ServerOwnedToolRegistry(input.tools ?? []);
  const bridge = createMastraModelExecutionBridge({
    credential_resolver: input.credential_resolver,
    binding_resolver: input.binding_resolver satisfies ServerModelProviderBindingResolver,
    tool_registry: toolRegistry,
    response_schema_registry: input.response_schema_registry,
    input_token_counter: input.input_token_counter,
  });

  return new MastraModelProviderAdapter({
    bridge,
    dispatch_marker: input.dispatch_marker,
    authorization: "PERSISTENT_PERMIT",
    ...(input.abort_signal ? { abort_signal: input.abort_signal } : {}),
    ...(input.clock ? { clock: input.clock } : {}),
  });
}

/**
 * Isolated benchmark boundary. Requests still require an authoritative,
 * persisted-certification-backed model profile, but do not impersonate a U3
 * run dispatch permit. Product Run execution must use createModelProviderPort.
 */
export function createCertifiedEvaluationModelProviderPort(
  input: ModelProviderPortCompositionInput,
): ModelProviderPort {
  const bridge = createMastraModelExecutionBridge({
    credential_resolver: input.credential_resolver,
    binding_resolver: input.binding_resolver satisfies ServerModelProviderBindingResolver,
    tool_registry: new ServerOwnedToolRegistry(input.tools ?? []),
    response_schema_registry: input.response_schema_registry,
    input_token_counter: input.input_token_counter,
  });
  return new MastraModelProviderAdapter({
    bridge,
    dispatch_marker: input.dispatch_marker,
    authorization: "CERTIFIED_EVALUATION",
    ...(input.abort_signal ? { abort_signal: input.abort_signal } : {}),
    ...(input.clock ? { clock: input.clock } : {}),
  });
}

export type {
  ModelCredentialResolver,
  ModelProviderAdapterClock,
  ModelProviderBinding,
  ServerModelResponseSchemaDescriptor,
  ServerOwnedToolDescriptor,
  TrustedModelInputTokenCounter,
  TrustedModelInputTokenCounterContext,
};
export { ServerModelResponseSchemaRegistry };
