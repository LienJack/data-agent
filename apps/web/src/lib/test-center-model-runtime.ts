import "server-only";

import {
  createModelProviderBindings,
  createModelProviderPort,
  type ModelProviderBinding,
  ServerModelResponseSchemaRegistry,
} from "@data-agent/agent-runtime";
import {
  type AppScope,
  type ArtifactReference,
  type AvailableModelProfile,
  artifactReferenceIdentity,
  authorizeAvailableModelProfile,
  type BenchmarkAgentDescriptor,
  type BenchmarkRunBudget,
  benchmarkAgentDescriptorSchema,
  CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
  CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
  CERTIFIED_MODEL_SQL_AGENT_ID,
  type ModelCertificationClaims,
  type ModelProviderPort,
  modelProviderSchema,
} from "@data-agent/contracts";
import {
  CertifiedModelAnalysisAgent,
  CertifiedModelMultipleChoiceAgent,
  CertifiedModelSqlAgent,
  INSIGHTBENCH_REFLECTION_RESPONSE_SCHEMA_VERSION,
  INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION,
  insightBenchModelReflectionResponseSchema,
  insightBenchModelReportResponseSchema,
  MULTIPLE_CHOICE_RESPONSE_SCHEMA_VERSION,
  modelMultipleChoiceResponseSchema,
  modelSqlAnswerResponseSchema,
  modelSqlReflectionResponseSchema,
  SQL_ANSWER_RESPONSE_SCHEMA_VERSION,
  SQL_REFLECTION_RESPONSE_SCHEMA_VERSION,
} from "@data-agent/evals";

const MODEL_RESPONSE_SCHEMA_OVERHEAD_BYTES = 4_096;

export interface PersistedModelCertificationReceipt {
  readonly reference: ArtifactReference;
  readonly claims: ModelCertificationClaims;
}

export type PersistedModelCertificationReceiptResolver = (
  binding: ModelProviderBinding,
) => Promise<PersistedModelCertificationReceipt | null>;

export type CertifiedTestCenterModelRuntime = {
  readonly available: true;
  readonly descriptor: BenchmarkAgentDescriptor;
  readonly sql_descriptor: BenchmarkAgentDescriptor;
  readonly multiple_choice_descriptor: BenchmarkAgentDescriptor;
  readonly profile: AvailableModelProfile;
  readonly model_provider: ModelProviderPort;
  createAgent(budget: BenchmarkRunBudget): CertifiedModelAnalysisAgent;
  createSqlAgent(budget: BenchmarkRunBudget): CertifiedModelSqlAgent;
  createMultipleChoiceAgent(budget: BenchmarkRunBudget): CertifiedModelMultipleChoiceAgent;
};

export type UnavailableTestCenterModelRuntime = {
  readonly available: false;
  readonly descriptor: BenchmarkAgentDescriptor;
  readonly sql_descriptor: BenchmarkAgentDescriptor;
  readonly multiple_choice_descriptor: BenchmarkAgentDescriptor;
};

export type TestCenterModelRuntime =
  | CertifiedTestCenterModelRuntime
  | UnavailableTestCenterModelRuntime;

function unavailableDescriptor(input: {
  readonly provider: string | null;
  readonly model_id: string | null;
  readonly reason: string;
}): BenchmarkAgentDescriptor {
  return benchmarkAgentDescriptorSchema.parse({
    agent_id: CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
    agent_version: "certified-model-analysis@1.0.0",
    display_name: "Certified model analysis agent",
    kind: "CERTIFIED_MODEL_ANALYSIS",
    provider: input.provider,
    model_id: input.model_id,
    available: false,
    unavailable_reason: input.reason,
    supports_reflection: true,
  });
}

function sqlDescriptorFromAnalysis(descriptor: BenchmarkAgentDescriptor): BenchmarkAgentDescriptor {
  return benchmarkAgentDescriptorSchema.parse({
    ...descriptor,
    agent_id: CERTIFIED_MODEL_SQL_AGENT_ID,
    agent_version: descriptor.agent_version.replace("model-analysis", "model-sql"),
    display_name: descriptor.display_name.replace("analysis", "SQL"),
    kind: "CERTIFIED_MODEL_SQL",
  });
}

function multipleChoiceDescriptorFromAnalysis(
  descriptor: BenchmarkAgentDescriptor,
): BenchmarkAgentDescriptor {
  return benchmarkAgentDescriptorSchema.parse({
    ...descriptor,
    agent_id: CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
    agent_version: descriptor.agent_version.replace("model-analysis", "model-multiple-choice"),
    display_name: descriptor.display_name.replace("analysis", "multiple-choice"),
    kind: "CERTIFIED_MODEL_MULTIPLE_CHOICE",
    supports_reflection: true,
  });
}

function unavailableRuntime(
  descriptor: BenchmarkAgentDescriptor,
): UnavailableTestCenterModelRuntime {
  return Object.freeze({
    available: false,
    descriptor,
    sql_descriptor: sqlDescriptorFromAnalysis(descriptor),
    multiple_choice_descriptor: multipleChoiceDescriptorFromAnalysis(descriptor),
  });
}

function configuredBinding(
  environment: NodeJS.ProcessEnv,
):
  | { readonly ok: true; readonly binding: ModelProviderBinding }
  | { readonly ok: false; readonly descriptor: BenchmarkAgentDescriptor } {
  const provider = modelProviderSchema.safeParse(environment.TEST_CENTER_MODEL_PROVIDER);
  if (!provider.success) {
    return {
      ok: false,
      descriptor: unavailableDescriptor({
        provider: null,
        model_id: null,
        reason: "未设置 TEST_CENTER_MODEL_PROVIDER，认证模型 Agent 保持关闭。",
      }),
    };
  }
  let overrides: unknown = [];
  try {
    overrides = environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES
      ? JSON.parse(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES)
      : [];
    const binding = createModelProviderBindings(overrides).find(
      (candidate) => candidate.provider === provider.data,
    );
    if (!binding) throw new Error("binding missing");
    return { ok: true, binding };
  } catch {
    return {
      ok: false,
      descriptor: unavailableDescriptor({
        provider: provider.data,
        model_id: null,
        reason: "DATA_AGENT_MODEL_PROVIDER_OVERRIDES 不是受支持的冻结部署配置。",
      }),
    };
  }
}

function trustedInputTokenUpperBound(input: {
  readonly instructions: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly tools: readonly unknown[];
  readonly response_schema_version: string;
}): number {
  return (
    Buffer.byteLength(
      JSON.stringify({
        instructions: input.instructions,
        messages: input.messages,
        tools: input.tools,
        response_schema_version: input.response_schema_version,
      }),
      "utf8",
    ) + MODEL_RESPONSE_SCHEMA_OVERHEAD_BYTES
  );
}

export async function resolveTestCenterModelRuntime(input: {
  readonly scope: AppScope;
  readonly resolve_receipt: PersistedModelCertificationReceiptResolver;
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<TestCenterModelRuntime> {
  const environment = input.environment ?? process.env;
  const configured = configuredBinding(environment);
  if (!configured.ok) {
    return unavailableRuntime(configured.descriptor);
  }
  const { binding } = configured;
  const credential = environment[binding.credential_env]?.trim();
  if (!credential) {
    return unavailableRuntime(
      unavailableDescriptor({
        provider: binding.provider,
        model_id: binding.default_model_id,
        reason: `${binding.credential_env} 未配置；不会绕过 Credential Authority。`,
      }),
    );
  }

  let receipt: PersistedModelCertificationReceipt | null;
  try {
    receipt = await input.resolve_receipt(binding);
  } catch {
    receipt = null;
  }
  if (!receipt) {
    return unavailableRuntime(
      unavailableDescriptor({
        provider: binding.provider,
        model_id: binding.default_model_id,
        reason: "PostgreSQL 中没有匹配当前绑定的已提交 Model Certification Receipt。",
      }),
    );
  }

  const referenceIdentity = artifactReferenceIdentity(receipt.reference);
  let profile: AvailableModelProfile;
  try {
    profile = await authorizeAvailableModelProfile(
      {
        profile_id: binding.profile_id,
        scope: input.scope,
        provider: binding.provider,
        model_id: binding.default_model_id,
        profile_version: binding.profile_version,
        capabilities: binding.capabilities,
        operational_constraints: binding.operational_constraints,
        certification_status: "AVAILABLE",
        certification_receipt_ref: receipt.reference,
        certified_model_id: binding.default_model_id,
      },
      {
        resolve: async (reference) =>
          artifactReferenceIdentity(reference) === referenceIdentity ? receipt.claims : null,
        verifyCommitted: async (reference) =>
          artifactReferenceIdentity(reference) === referenceIdentity,
      },
    );
  } catch {
    return unavailableRuntime(
      unavailableDescriptor({
        provider: binding.provider,
        model_id: binding.default_model_id,
        reason: "持久化 Receipt 未能重验当前 Provider、Model、Profile Version 与约束 Hash。",
      }),
    );
  }

  if (
    profile.operational_constraints.context_window.verification_status !== "VERIFIED" ||
    profile.operational_constraints.pricing.verification_status !== "VERIFIED" ||
    profile.operational_constraints.pricing.currency !== "USD"
  ) {
    return unavailableRuntime(
      unavailableDescriptor({
        provider: binding.provider,
        model_id: binding.default_model_id,
        reason: "认证 Profile 尚未冻结已验证 Context Window 与 USD 定价，评测预算无法失败关闭。",
      }),
    );
  }

  const responseSchemaRegistry = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION,
      schema: insightBenchModelReportResponseSchema,
    },
    {
      response_schema_version: INSIGHTBENCH_REFLECTION_RESPONSE_SCHEMA_VERSION,
      schema: insightBenchModelReflectionResponseSchema,
    },
    {
      response_schema_version: SQL_ANSWER_RESPONSE_SCHEMA_VERSION,
      schema: modelSqlAnswerResponseSchema,
    },
    {
      response_schema_version: SQL_REFLECTION_RESPONSE_SCHEMA_VERSION,
      schema: modelSqlReflectionResponseSchema,
    },
    {
      response_schema_version: MULTIPLE_CHOICE_RESPONSE_SCHEMA_VERSION,
      schema: modelMultipleChoiceResponseSchema,
    },
  ]);
  const modelProvider = createModelProviderPort({
    credential_resolver: {
      resolve: async (request) =>
        request.scope.app_id === input.scope.app_id &&
        request.scope.tenant_id === input.scope.tenant_id &&
        request.scope.environment === input.scope.environment &&
        request.provider === binding.provider &&
        request.credential_env === binding.credential_env
          ? (environment[binding.credential_env]?.trim() ?? null)
          : null,
    },
    binding_resolver: {
      resolve: async (request) =>
        request.scope.app_id === input.scope.app_id &&
        request.scope.tenant_id === input.scope.tenant_id &&
        request.scope.environment === input.scope.environment &&
        request.provider === binding.provider &&
        request.profile_id === binding.profile_id &&
        request.profile_version === binding.profile_version
          ? binding
          : null,
    },
    response_schema_registry: responseSchemaRegistry,
    input_token_counter: {
      count: async (context) => trustedInputTokenUpperBound(context),
    },
  });
  const descriptor = benchmarkAgentDescriptorSchema.parse({
    agent_id: CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
    agent_version: `certified-model-analysis@${profile.profile_version}`,
    display_name: `${profile.provider} ${profile.model_id} analysis agent`,
    kind: "CERTIFIED_MODEL_ANALYSIS",
    provider: profile.provider,
    model_id: profile.model_id,
    available: true,
    unavailable_reason: null,
    supports_reflection: true,
  });
  const sqlDescriptor = benchmarkAgentDescriptorSchema.parse({
    agent_id: CERTIFIED_MODEL_SQL_AGENT_ID,
    agent_version: `certified-model-sql@${profile.profile_version}`,
    display_name: `${profile.provider} ${profile.model_id} SQL agent`,
    kind: "CERTIFIED_MODEL_SQL",
    provider: profile.provider,
    model_id: profile.model_id,
    available: true,
    unavailable_reason: null,
    supports_reflection: true,
  });
  const multipleChoiceDescriptor = benchmarkAgentDescriptorSchema.parse({
    agent_id: CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
    agent_version: `certified-model-multiple-choice@${profile.profile_version}`,
    display_name: `${profile.provider} ${profile.model_id} multiple-choice agent`,
    kind: "CERTIFIED_MODEL_MULTIPLE_CHOICE",
    provider: profile.provider,
    model_id: profile.model_id,
    available: true,
    unavailable_reason: null,
    supports_reflection: true,
  });
  return Object.freeze({
    available: true,
    descriptor,
    sql_descriptor: sqlDescriptor,
    multiple_choice_descriptor: multipleChoiceDescriptor,
    profile,
    model_provider: modelProvider,
    createAgent: (budget: BenchmarkRunBudget) =>
      new CertifiedModelAnalysisAgent({ profile, model_provider: modelProvider, budget }),
    createSqlAgent: (budget: BenchmarkRunBudget) =>
      new CertifiedModelSqlAgent({ profile, model_provider: modelProvider, budget }),
    createMultipleChoiceAgent: (budget: BenchmarkRunBudget) =>
      new CertifiedModelMultipleChoiceAgent({ profile, model_provider: modelProvider, budget }),
  });
}
