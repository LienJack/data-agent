import {
  type ArtifactCommitterCapabilityClaim,
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeL2ArtifactContentHash,
  deepFreeze,
  type L2ArtifactDocument,
  type LogicalPlanPayload,
  l2ArtifactDocumentSchema,
  type SqlArtifactPayloadContract,
} from "@data-agent/contracts";
import {
  isValidatedLogicalPlan,
  type ValidatedLogicalPlan,
} from "../planning/validate-logical-plan.js";

declare const authoritativeLogicalPlanBindingBrand: unique symbol;
declare const trustedLogicalPlanCompilerAuthorityBrand: unique symbol;

const authoritativeLogicalPlanBindings = new WeakSet<object>();
const trustedLogicalPlanCompilerAuthorities = new WeakSet<object>();

type LogicalPlanDocument = L2ArtifactDocument &
  Readonly<{
    envelope: L2ArtifactDocument["envelope"] & Readonly<{ artifact_type: "LogicalPlan" }>;
    payload: LogicalPlanPayload;
  }>;

export type LogicalPlanPrincipalCapabilityClaim = Readonly<{
  kind: "logical-plan-compiler";
  app_id: string;
  tenant_id: string;
  environment: string;
  run_id: string;
  principal_id: string;
  logical_plan_ref: SqlArtifactPayloadContract["logical_plan_ref"];
}>;

type TrustedLogicalPlanCompilerAuthority = Readonly<{
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyCommitterCapability(claim: ArtifactCommitterCapabilityClaim): Promise<boolean>;
  verifyPrincipalCapability(claim: LogicalPlanPrincipalCapabilityClaim): Promise<boolean>;
  readonly [trustedLogicalPlanCompilerAuthorityBrand]: true;
}>;

export type AuthoritativeLogicalPlanPolicyBinding = Readonly<{
  app_id: string;
  tenant_id: string;
  environment: string;
  principal_id: string;
}>;

/**
 * 已由服务端持久化边界核验过的 LogicalPlan payload/reference 组合。
 *
 * 注册函数和 Authority 注册器均不从 package 根导出。公开编译 API 只能消费这个
 * 同进程 WeakSet 品牌，不能让调用者提交 resolver、raw policy value 或伪造的 plain object。
 */
export type AuthoritativeLogicalPlanBinding = Readonly<{
  logical_plan: ValidatedLogicalPlan;
  reference: SqlArtifactPayloadContract["logical_plan_ref"];
  policy_binding: AuthoritativeLogicalPlanPolicyBinding;
  readonly [authoritativeLogicalPlanBindingBrand]: true;
}>;

export function isAuthoritativeLogicalPlanBinding(
  value: unknown,
): value is AuthoritativeLogicalPlanBinding {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authoritativeLogicalPlanBindings.has(value)
  );
}

function isTrustedLogicalPlanCompilerAuthority(
  value: unknown,
): value is TrustedLogicalPlanCompilerAuthority {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    trustedLogicalPlanCompilerAuthorities.has(value)
  );
}

/**
 * @internal 仅供服务端 Composition Root 注册真实持久化与 Capability 适配器。
 *
 * 该入口不会从 `@data-agent/text2sql` 导出；包装后所有方法都在解析过的完整 Reference 上执行，
 * clone/plain callback object 不携带同进程 Authority 品牌。
 */
export function registerTrustedLogicalPlanCompilerAuthority(adapter: {
  readonly principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyCommitterCapability(claim: ArtifactCommitterCapabilityClaim): Promise<boolean>;
  verifyPrincipalCapability(claim: LogicalPlanPrincipalCapabilityClaim): Promise<boolean>;
}): TrustedLogicalPlanCompilerAuthority {
  if (
    typeof adapter.principal_id !== "string" ||
    adapter.principal_id.length === 0 ||
    adapter.principal_id.length > 256 ||
    typeof adapter.resolveCommitted !== "function" ||
    typeof adapter.verifyCommitted !== "function" ||
    typeof adapter.verifyCommitterCapability !== "function" ||
    typeof adapter.verifyPrincipalCapability !== "function"
  ) {
    throw new TypeError("POSTGRESQL_COMPILER_AUTHORITY_INVALID");
  }
  const authority = Object.freeze({
    principal_id: adapter.principal_id,
    resolveCommitted: (reference: ArtifactReference) =>
      adapter.resolveCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
    verifyCommitted: (reference: ArtifactReference) =>
      adapter.verifyCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
    verifyCommitterCapability: (claim: ArtifactCommitterCapabilityClaim) =>
      adapter.verifyCommitterCapability(claim),
    verifyPrincipalCapability: (claim: LogicalPlanPrincipalCapabilityClaim) =>
      adapter.verifyPrincipalCapability(claim),
  });
  trustedLogicalPlanCompilerAuthorities.add(authority);
  return authority as TrustedLogicalPlanCompilerAuthority;
}

function referenceFromDocument(
  document: LogicalPlanDocument,
): SqlArtifactPayloadContract["logical_plan_ref"] {
  return artifactReferenceFor("LogicalPlan").parse({
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  });
}

function logicalPlanContent(document: L2ArtifactDocument): unknown {
  if (document.payload.artifact_type !== "LogicalPlan") return null;
  const {
    artifact_type: _artifactType,
    semantic_query_ref: _semanticQueryReference,
    ...content
  } = document.payload;
  return content;
}

function committerClaim(document: LogicalPlanDocument): ArtifactCommitterCapabilityClaim {
  return {
    kind: "artifact-committer",
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    attempt_id: document.envelope.attempt_id,
    artifact_type: "LogicalPlan",
    producer_id: document.envelope.producer.id,
    policy_version: document.envelope.policy_version,
  };
}

/**
 * @internal 将一个已验证的 LogicalPlan 精确绑定到同内容、同 Scope/Run、已 COMMITTED 的文档。
 *
 * 注意：这里故意重新解析持久化返回值并重算 Document content_hash；不能用调用者传入的
 * LogicalPlan 或 Reference 代替 resolver 的返回值。
 */
export async function registerAuthoritativeLogicalPlanBinding(input: {
  readonly logical_plan: unknown;
  readonly reference: unknown;
  readonly authority: unknown;
}): Promise<AuthoritativeLogicalPlanBinding> {
  if (!isTrustedLogicalPlanCompilerAuthority(input.authority)) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED");
  }
  if (!isValidatedLogicalPlan(input.logical_plan)) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_VALIDATION_REQUIRED");
  }
  const reference = artifactReferenceFor("LogicalPlan").parse(input.reference);
  if (!(await input.authority.verifyCommitted(reference))) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_NOT_COMMITTED");
  }
  const resolved = await input.authority.resolveCommitted(reference);
  const parsed = l2ArtifactDocumentSchema.safeParse(resolved);
  if (
    !parsed.success ||
    parsed.data.payload.artifact_type !== "LogicalPlan" ||
    parsed.data.envelope.artifact_type !== "LogicalPlan" ||
    parsed.data.envelope.status !== "COMMITTED"
  ) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_DOCUMENT_INVALID");
  }
  const document = parsed.data as LogicalPlanDocument;
  const resolvedReference = referenceFromDocument(document);
  if (
    artifactReferenceIdentity(resolvedReference) !== artifactReferenceIdentity(reference) ||
    (await computeL2ArtifactContentHash(document)) !== reference.content_hash
  ) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_REFERENCE_MISMATCH");
  }
  if (canonicalizeJson(logicalPlanContent(document)) !== canonicalizeJson(input.logical_plan)) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_PAYLOAD_MISMATCH");
  }
  if (!(await input.authority.verifyCommitterCapability(committerClaim(document)))) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_COMMITTER_CAPABILITY_REQUIRED");
  }
  const principalClaim: LogicalPlanPrincipalCapabilityClaim = deepFreeze({
    kind: "logical-plan-compiler",
    app_id: reference.app_id,
    tenant_id: reference.tenant_id,
    environment: reference.environment,
    run_id: reference.run_id,
    principal_id: input.authority.principal_id,
    logical_plan_ref: reference,
  });
  if (!(await input.authority.verifyPrincipalCapability(principalClaim))) {
    throw new TypeError("POSTGRESQL_COMPILER_PRINCIPAL_CAPABILITY_REQUIRED");
  }
  // resolver / capability 调用均为异步；在发放同进程品牌前重新确认完整内容寻址 Revision
  // 仍是当前持久化 Authority 的 COMMITTED 对象，避免 check-use 窗口。
  if (!(await input.authority.verifyCommitted(reference))) {
    throw new TypeError("POSTGRESQL_COMPILER_LOGICAL_PLAN_NOT_COMMITTED");
  }
  const binding = {
    logical_plan: input.logical_plan,
    reference,
    policy_binding: {
      app_id: reference.app_id,
      tenant_id: reference.tenant_id,
      environment: reference.environment,
      principal_id: input.authority.principal_id,
    },
  };
  authoritativeLogicalPlanBindings.add(binding);
  return deepFreeze(binding) as AuthoritativeLogicalPlanBinding;
}
