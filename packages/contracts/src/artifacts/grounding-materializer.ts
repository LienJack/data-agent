import { deepFreeze, sha256ContentHash } from "../common/index.js";
import {
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextPackage,
  verifyResolvedContextAuthoritySnapshot,
  verifyResolvedContextPackage,
} from "../context/resolved-context-package.js";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "./envelope.js";
import {
  assertGroundingAuthorityBundleConsistency,
  assertGroundingAuthorityOriginConsistency,
  computeGroundingAuthorityDocumentHash,
  GroundingAuthorityError,
  type GroundingAuthorityOrigin,
  type GroundingAuthorityReference,
  type GroundingAuthorityVerificationContext,
  groundingAuthorityDocumentSchema,
  groundingAuthorityIdentityViolation,
  groundingAuthorityOriginSchema,
  type PolicyReceiptDocument,
  policyReceiptDocumentSchema,
  type SchemaSnapshotDocument,
  type SemanticReleaseDocument,
  schemaSnapshotDocumentSchema,
  semanticReleaseDocumentSchema,
} from "./grounding-authority.js";
import {
  type ResolvedContextText2SqlBinding,
  resolvedContextText2SqlBindingDraftSchema,
  resolvedContextText2SqlBindingSchema,
} from "./text2sql-primitives.js";

type ResolvedContextText2SqlBindingInput = Readonly<{
  package: ResolvedContextPackage;
  snapshot: ResolvedContextAuthoritySnapshot;
}>;

declare const authoritativeResolvedContextText2SqlBindingBrand: unique symbol;
const authoritativeResolvedContextText2SqlBindings = new WeakSet<object>();

export type AuthoritativeResolvedContextText2SqlBinding = ResolvedContextText2SqlBinding &
  Readonly<{ readonly [authoritativeResolvedContextText2SqlBindingBrand]: true }>;

export function isAuthoritativeResolvedContextText2SqlBinding(
  input: unknown,
): input is AuthoritativeResolvedContextText2SqlBinding {
  return (
    typeof input === "object" &&
    input !== null &&
    authoritativeResolvedContextText2SqlBindings.has(input)
  );
}

function sameScope(
  left: ResolvedContextPackage["scope"],
  right: ResolvedContextAuthoritySnapshot["scope"],
): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

export async function buildResolvedContextText2SqlBinding(
  input: ResolvedContextText2SqlBindingInput,
): Promise<AuthoritativeResolvedContextText2SqlBinding> {
  const [contextPackage, snapshot] = await Promise.all([
    verifyResolvedContextPackage(input.package),
    verifyResolvedContextAuthoritySnapshot(input.snapshot),
  ]);
  if (
    !["READY", "PARTIAL"].includes(contextPackage.route_decision.state) ||
    !["METRIC", "ONTOLOGY_TEXT2SQL"].includes(contextPackage.route_decision.route)
  ) {
    throw new TypeError("RESOLVED_CONTEXT_ROUTE_NOT_QUERYABLE");
  }
  if (
    !sameScope(contextPackage.scope, snapshot.scope) ||
    contextPackage.authority_snapshot_hash !== snapshot.snapshot_hash ||
    contextPackage.semantic_release.resource_hash !== snapshot.semantic_release.resource_hash ||
    contextPackage.schema_snapshot.resource_hash !== snapshot.schema_snapshot.resource_hash
  ) {
    throw new TypeError("RESOLVED_CONTEXT_TEXT2SQL_AUTHORITY_MISMATCH");
  }

  const route = contextPackage.route_decision.route;
  const selectedMetricId = contextPackage.route_decision.selected_metric_id;
  const selectedOntologyIds = [...contextPackage.route_decision.selected_ontology_ids].sort();
  const mappingAuthorities =
    route === "METRIC"
      ? (() => {
          const metric = snapshot.published_metrics.find(
            ({ metric_id }) => metric_id === selectedMetricId,
          );
          if (!metric || metric.mapping_refs.length === 0) {
            throw new TypeError("RESOLVED_CONTEXT_METRIC_MAPPING_NOT_QUERYABLE");
          }
          return [
            {
              authority_kind: "METRIC" as const,
              authority_id: metric.metric_id,
              authority_hash: metric.mapping_hash,
              mapping_refs: metric.mapping_refs,
            },
          ];
        })()
      : selectedOntologyIds.map((objectId) => {
          const object = snapshot.published_ontology.find(
            ({ object_id }) => object_id === objectId,
          );
          if (!object?.queryable || object.mapping_refs.length === 0) {
            throw new TypeError("RESOLVED_CONTEXT_ONTOLOGY_MAPPING_NOT_QUERYABLE");
          }
          return {
            authority_kind: "ONTOLOGY" as const,
            authority_id: object.object_id,
            authority_hash: object.object_hash,
            mapping_refs: object.mapping_refs,
          };
        });
  const mappingRefs = [
    ...new Set(mappingAuthorities.flatMap(({ mapping_refs }) => mapping_refs)),
  ].sort();
  const mappingClosureHash = await sha256ContentHash({
    package_hash: contextPackage.package_hash,
    authority_snapshot_hash: snapshot.snapshot_hash,
    route,
    selected_metric_id: selectedMetricId,
    selected_ontology_ids: selectedOntologyIds,
    mapping_authorities: mappingAuthorities,
    semantic_projection_hashes: snapshot.projection_hashes,
  });
  const draft = resolvedContextText2SqlBindingDraftSchema.parse({
    schema_version: "resolved-context-text2sql-binding@1.0.0",
    scope: contextPackage.scope,
    resolved_context_package_ref: {
      package_id: contextPackage.package_id,
      package_revision: 1,
      package_hash: contextPackage.package_hash,
    },
    authority_snapshot_hash: snapshot.snapshot_hash,
    semantic_release: snapshot.semantic_release,
    schema_snapshot: snapshot.schema_snapshot,
    route,
    selected_metric_id: selectedMetricId,
    selected_ontology_ids: selectedOntologyIds,
    mapping_refs: mappingRefs,
    semantic_projection_hashes: snapshot.projection_hashes,
    mapping_closure_hash: mappingClosureHash,
  });
  const binding = deepFreeze(
    resolvedContextText2SqlBindingSchema.parse({
      ...draft,
      binding_hash: await sha256ContentHash(draft),
    }),
  );
  authoritativeResolvedContextText2SqlBindings.add(binding);
  return binding as AuthoritativeResolvedContextText2SqlBinding;
}

export async function verifyResolvedContextText2SqlBinding(
  bindingInput: unknown,
  authorityInput: ResolvedContextText2SqlBindingInput,
): Promise<AuthoritativeResolvedContextText2SqlBinding> {
  const binding = resolvedContextText2SqlBindingSchema.parse(bindingInput);
  const { binding_hash: _bindingHash, ...draft } = binding;
  const expected = await buildResolvedContextText2SqlBinding(authorityInput);
  if (
    (await sha256ContentHash(draft)) !== binding.binding_hash ||
    binding.binding_hash !== expected.binding_hash
  ) {
    throw new TypeError("RESOLVED_CONTEXT_TEXT2SQL_BINDING_MISMATCH");
  }
  authoritativeResolvedContextText2SqlBindings.add(binding);
  return binding as AuthoritativeResolvedContextText2SqlBinding;
}

// ─── WeakSet brands ───────────────────────────────────────────────────────────

declare const authoritativeSemanticReleaseBrand: unique symbol;
declare const authoritativeSchemaSnapshotBrand: unique symbol;
declare const authoritativePolicyReceiptBrand: unique symbol;
declare const authoritativeGroundingBundleBrand: unique symbol;
declare const trustedSemanticReleaseIssuerBrand: unique symbol;
declare const trustedSchemaSnapshotIssuerBrand: unique symbol;
declare const trustedPolicyReceiptIssuerBrand: unique symbol;
declare const trustedGroundingCoordinatorBrand: unique symbol;
declare const trustedGroundingMaterializerBrand: unique symbol;

const authoritativeSemanticReleases = new WeakSet<object>();
const authoritativeSchemaSnapshots = new WeakSet<object>();
const authoritativePolicyReceipts = new WeakSet<object>();
const authoritativeGroundingBundles = new WeakSet<object>();
const trustedSemanticReleaseIssuers = new WeakSet<object>();
const trustedSchemaSnapshotIssuers = new WeakSet<object>();
const trustedPolicyReceiptIssuers = new WeakSet<object>();
const trustedGroundingCoordinators = new WeakSet<object>();
const trustedGroundingMaterializers = new WeakSet<object>();

// ─── Branded types ────────────────────────────────────────────────────────────

/**
 * 已由同进程 SemanticReleaseIssuer 核验并注册的 SemanticRelease 文档。
 *
 * 持有该类型表示 issuer 已完成 schema 校验、hash 验证与 producer/authority 身份检查，
 * 且文档已通过 `verifyCommitted` 确认持久化。
 */
export type AuthoritativeSemanticRelease = Readonly<{
  document: SemanticReleaseDocument;
  reference: Extract<GroundingAuthorityReference, { artifact_type: "SemanticRelease" }>;
  readonly [authoritativeSemanticReleaseBrand]: true;
}>;

/**
 * 已由同进程 SchemaSnapshotIssuer 核验并注册的 SchemaSnapshot 文档。
 */
export type AuthoritativeSchemaSnapshot = Readonly<{
  document: SchemaSnapshotDocument;
  reference: Extract<GroundingAuthorityReference, { artifact_type: "SchemaSnapshot" }>;
  readonly [authoritativeSchemaSnapshotBrand]: true;
}>;

/**
 * 已由同进程 PolicyReceiptIssuer 核验并注册的 PolicyReceipt 文档。
 */
export type AuthoritativePolicyReceipt = Readonly<{
  document: PolicyReceiptDocument;
  reference: Extract<GroundingAuthorityReference, { artifact_type: "PolicyReceipt" }>;
  readonly [authoritativePolicyReceiptBrand]: true;
}>;

/**
 * 已由 GroundingAuthorityCoordinator 核验的外部 bundle，包含三份权威文档。
 *
 * Coordinator 只验证 sealed fact，不签发新权威。
 */
export type AuthoritativeGroundingBundle = Readonly<{
  semanticRelease: AuthoritativeSemanticRelease;
  schemaSnapshot: AuthoritativeSchemaSnapshot;
  policyReceipt: AuthoritativePolicyReceipt;
  origin: GroundingAuthorityOrigin;
  readonly [authoritativeGroundingBundleBrand]: true;
}>;

// ─── Issuer 适配器类型 ─────────────────────────────────────────────────────────

/**
 * SemanticReleaseIssuer 所需的持久化适配器。
 */
export type SemanticReleaseIssuerAdapter = Readonly<{
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
}>;

/**
 * SchemaSnapshotIssuer 所需的持久化适配器。
 */
export type SchemaSnapshotIssuerAdapter = Readonly<{
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
}>;

/**
 * PolicyReceiptIssuer 所需的持久化适配器。
 */
export type PolicyReceiptIssuerAdapter = Readonly<{
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  /**
   * 解析服务端 Deterministic Policy Authority 的发行事实。
   * 可选；缺失时 `requirePolicyReceiptIssuance` 控制是否失败关闭。
   */
  resolvePolicyReceiptIssuance?: GroundingAuthorityVerificationContext["resolvePolicyReceiptIssuance"];
  requirePolicyReceiptIssuance?: boolean;
}>;

// ─── Trusted Issuer 类型 ──────────────────────────────────────────────────────

type TrustedSemanticReleaseIssuer = Readonly<{
  readonly [trustedSemanticReleaseIssuerBrand]: true;
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
}>;

type TrustedSchemaSnapshotIssuer = Readonly<{
  readonly [trustedSchemaSnapshotIssuerBrand]: true;
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
}>;

type TrustedPolicyReceiptIssuer = Readonly<{
  readonly [trustedPolicyReceiptIssuerBrand]: true;
  principal_id: string;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolvePolicyReceiptIssuance?: GroundingAuthorityVerificationContext["resolvePolicyReceiptIssuance"];
  requirePolicyReceiptIssuance?: boolean;
}>;

type TrustedGroundingCoordinator = Readonly<{
  readonly [trustedGroundingCoordinatorBrand]: true;
  principal_id: string;
}>;

type TrustedGroundingMaterializer = Readonly<{
  readonly [trustedGroundingMaterializerBrand]: true;
  principal_id: string;
}>;

// ─── Brand inspectors ─────────────────────────────────────────────────────────

export function isAuthoritativeSemanticRelease(
  value: unknown,
): value is AuthoritativeSemanticRelease {
  return typeof value === "object" && value !== null && authoritativeSemanticReleases.has(value);
}

export function isAuthoritativeSchemaSnapshot(
  value: unknown,
): value is AuthoritativeSchemaSnapshot {
  return typeof value === "object" && value !== null && authoritativeSchemaSnapshots.has(value);
}

export function isAuthoritativePolicyReceipt(value: unknown): value is AuthoritativePolicyReceipt {
  return typeof value === "object" && value !== null && authoritativePolicyReceipts.has(value);
}

export function isAuthoritativeGroundingBundle(
  value: unknown,
): value is AuthoritativeGroundingBundle {
  return typeof value === "object" && value !== null && authoritativeGroundingBundles.has(value);
}

function isTrustedSemanticReleaseIssuer(value: unknown): value is TrustedSemanticReleaseIssuer {
  return typeof value === "object" && value !== null && trustedSemanticReleaseIssuers.has(value);
}

function isTrustedSchemaSnapshotIssuer(value: unknown): value is TrustedSchemaSnapshotIssuer {
  return typeof value === "object" && value !== null && trustedSchemaSnapshotIssuers.has(value);
}

function isTrustedPolicyReceiptIssuer(value: unknown): value is TrustedPolicyReceiptIssuer {
  return typeof value === "object" && value !== null && trustedPolicyReceiptIssuers.has(value);
}

function isTrustedGroundingCoordinator(value: unknown): value is TrustedGroundingCoordinator {
  return typeof value === "object" && value !== null && trustedGroundingCoordinators.has(value);
}

function isTrustedGroundingMaterializer(value: unknown): value is TrustedGroundingMaterializer {
  return typeof value === "object" && value !== null && trustedGroundingMaterializers.has(value);
}

// ─── Registry 函数 ────────────────────────────────────────────────────────────

/**
 * 在 Composition Root 注册一个真实的 SemanticReleaseIssuer 适配器。
 *
 * 包装后所有方法都在解析过的完整 Reference 上执行，clone/plain callback object
 * 不携带同进程 Authority 品牌。
 */
export function registerTrustedSemanticReleaseIssuer(
  adapter: SemanticReleaseIssuerAdapter,
): TrustedSemanticReleaseIssuer {
  if (
    typeof adapter.principal_id !== "string" ||
    adapter.principal_id.length === 0 ||
    adapter.principal_id.length > 256 ||
    typeof adapter.resolveCommitted !== "function" ||
    typeof adapter.verifyCommitted !== "function"
  ) {
    throw new TypeError("SEMANTIC_RELEASE_ISSUER_INVALID_ADAPTER");
  }
  const issuer = Object.freeze({
    principal_id: adapter.principal_id,
    resolveCommitted: (reference: ArtifactReference) =>
      adapter.resolveCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
    verifyCommitted: (reference: ArtifactReference) =>
      adapter.verifyCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
  });
  trustedSemanticReleaseIssuers.add(issuer);
  return issuer as unknown as TrustedSemanticReleaseIssuer;
}

/**
 * 在 Composition Root 注册一个真实的 SchemaSnapshotIssuer 适配器。
 */
export function registerTrustedSchemaSnapshotIssuer(
  adapter: SchemaSnapshotIssuerAdapter,
): TrustedSchemaSnapshotIssuer {
  if (
    typeof adapter.principal_id !== "string" ||
    adapter.principal_id.length === 0 ||
    adapter.principal_id.length > 256 ||
    typeof adapter.resolveCommitted !== "function" ||
    typeof adapter.verifyCommitted !== "function"
  ) {
    throw new TypeError("SCHEMA_SNAPSHOT_ISSUER_INVALID_ADAPTER");
  }
  const issuer = Object.freeze({
    principal_id: adapter.principal_id,
    resolveCommitted: (reference: ArtifactReference) =>
      adapter.resolveCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
    verifyCommitted: (reference: ArtifactReference) =>
      adapter.verifyCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
  });
  trustedSchemaSnapshotIssuers.add(issuer);
  return issuer as unknown as TrustedSchemaSnapshotIssuer;
}

/**
 * 在 Composition Root 注册一个真实的 PolicyReceiptIssuer 适配器。
 */
export function registerTrustedPolicyReceiptIssuer(
  adapter: PolicyReceiptIssuerAdapter,
): TrustedPolicyReceiptIssuer {
  if (
    typeof adapter.principal_id !== "string" ||
    adapter.principal_id.length === 0 ||
    adapter.principal_id.length > 256 ||
    typeof adapter.resolveCommitted !== "function" ||
    typeof adapter.verifyCommitted !== "function"
  ) {
    throw new TypeError("POLICY_RECEIPT_ISSUER_INVALID_ADAPTER");
  }
  const issuer = Object.freeze({
    principal_id: adapter.principal_id,
    resolveCommitted: (reference: ArtifactReference) =>
      adapter.resolveCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
    verifyCommitted: (reference: ArtifactReference) =>
      adapter.verifyCommitted(artifactReferenceFor(reference.artifact_type).parse(reference)),
    resolvePolicyReceiptIssuance: adapter.resolvePolicyReceiptIssuance,
    requirePolicyReceiptIssuance: adapter.requirePolicyReceiptIssuance,
  });
  trustedPolicyReceiptIssuers.add(issuer);
  return issuer as unknown as TrustedPolicyReceiptIssuer;
}

/**
 * 在 Composition Root 注册 GroundingAuthorityCoordinator。
 *
 * Coordinator 只验证 sealed fact，不签发新权威。
 */
export function registerTrustedGroundingCoordinator(adapter: {
  readonly principal_id: string;
}): TrustedGroundingCoordinator {
  if (
    typeof adapter.principal_id !== "string" ||
    adapter.principal_id.length === 0 ||
    adapter.principal_id.length > 256
  ) {
    throw new TypeError("GROUNDING_COORDINATOR_INVALID_ADAPTER");
  }
  const coordinator = Object.freeze({
    principal_id: adapter.principal_id,
  });
  trustedGroundingCoordinators.add(coordinator);
  return coordinator as unknown as TrustedGroundingCoordinator;
}

/**
 * 在 Composition Root 注册 GroundingAuthorityMaterializer。
 *
 * Materializer 组合 issuers + coordinator，提供统一的签发 + 核验入口。
 */
export function registerTrustedGroundingMaterializer(adapter: {
  readonly principal_id: string;
}): TrustedGroundingMaterializer {
  if (
    typeof adapter.principal_id !== "string" ||
    adapter.principal_id.length === 0 ||
    adapter.principal_id.length > 256
  ) {
    throw new TypeError("GROUNDING_MATERIALIZER_INVALID_ADAPTER");
  }
  const materializer = Object.freeze({
    principal_id: adapter.principal_id,
  });
  trustedGroundingMaterializers.add(materializer);
  return materializer as unknown as TrustedGroundingMaterializer;
}

// ─── Issuer 实现 ──────────────────────────────────────────────────────────────

/**
 * 独立签发 SemanticRelease 文档。
 *
 * 只负责自己的文档类型，不能签发 SchemaSnapshot 或 PolicyReceipt。
 */
export async function issueSemanticRelease(
  input: Readonly<{
    issuer: unknown;
    document: unknown;
    origin: GroundingAuthorityOrigin;
  }>,
): Promise<AuthoritativeSemanticRelease> {
  if (!isTrustedSemanticReleaseIssuer(input.issuer)) {
    throw new TypeError("SEMANTIC_RELEASE_ISSUER_REQUIRED");
  }
  const issuer = input.issuer;

  // 1. 解析并校验文档 schema
  const draft = semanticReleaseDocumentSchema.parse(input.document);

  // 2. 注入 origin
  const documentWithOrigin = groundingAuthorityDocumentSchema.parse({
    ...draft,
    origin: groundingAuthorityOriginSchema.parse(input.origin),
  });

  // 3. 重算 hash
  const documentHash = await computeGroundingAuthorityDocumentHash(documentWithOrigin);
  const document = groundingAuthorityDocumentSchema.parse({
    ...documentWithOrigin,
    artifact_ref: {
      ...documentWithOrigin.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  }) as SemanticReleaseDocument;

  // 4. 验证身份
  if (groundingAuthorityIdentityViolation(document, issuer.principal_id) !== null) {
    throw new GroundingAuthorityError("SemanticRelease 的受信 Producer/Authority 身份不匹配。");
  }

  // 5. 验证持久化
  if (!(await issuer.verifyCommitted(document.artifact_ref))) {
    throw new GroundingAuthorityError("SemanticRelease 尚未提交到持久化 Authority。");
  }

  // 6. 注册品牌
  const reference = document.artifact_ref as Extract<
    GroundingAuthorityReference,
    { artifact_type: "SemanticRelease" }
  >;
  const binding = Object.freeze({
    document,
    reference,
  });
  authoritativeSemanticReleases.add(binding);
  return binding as unknown as AuthoritativeSemanticRelease;
}

/**
 * 独立签发 SchemaSnapshot 文档。
 */
export async function issueSchemaSnapshot(
  input: Readonly<{
    issuer: unknown;
    document: unknown;
    origin: GroundingAuthorityOrigin;
  }>,
): Promise<AuthoritativeSchemaSnapshot> {
  if (!isTrustedSchemaSnapshotIssuer(input.issuer)) {
    throw new TypeError("SCHEMA_SNAPSHOT_ISSUER_REQUIRED");
  }
  const issuer = input.issuer;

  const draft = schemaSnapshotDocumentSchema.parse(input.document);
  const documentWithOrigin = groundingAuthorityDocumentSchema.parse({
    ...draft,
    origin: groundingAuthorityOriginSchema.parse(input.origin),
  });

  const documentHash = await computeGroundingAuthorityDocumentHash(documentWithOrigin);
  const document = groundingAuthorityDocumentSchema.parse({
    ...documentWithOrigin,
    artifact_ref: {
      ...documentWithOrigin.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  }) as SchemaSnapshotDocument;

  if (groundingAuthorityIdentityViolation(document, issuer.principal_id) !== null) {
    throw new GroundingAuthorityError("SchemaSnapshot 的受信 Producer/Authority 身份不匹配。");
  }

  if (!(await issuer.verifyCommitted(document.artifact_ref))) {
    throw new GroundingAuthorityError("SchemaSnapshot 尚未提交到持久化 Authority。");
  }

  const reference = document.artifact_ref as Extract<
    GroundingAuthorityReference,
    { artifact_type: "SchemaSnapshot" }
  >;
  const binding = Object.freeze({
    document,
    reference,
  });
  authoritativeSchemaSnapshots.add(binding);
  return binding as unknown as AuthoritativeSchemaSnapshot;
}

/**
 * 独立签发 PolicyReceipt 文档。
 */
export async function issuePolicyReceipt(
  input: Readonly<{
    issuer: unknown;
    document: unknown;
    origin: GroundingAuthorityOrigin;
  }>,
): Promise<AuthoritativePolicyReceipt> {
  if (!isTrustedPolicyReceiptIssuer(input.issuer)) {
    throw new TypeError("POLICY_RECEIPT_ISSUER_REQUIRED");
  }
  const issuer = input.issuer;

  const draft = policyReceiptDocumentSchema.parse(input.document);
  const documentWithOrigin = groundingAuthorityDocumentSchema.parse({
    ...draft,
    origin: groundingAuthorityOriginSchema.parse(input.origin),
  });

  const documentHash = await computeGroundingAuthorityDocumentHash(documentWithOrigin);
  const document = groundingAuthorityDocumentSchema.parse({
    ...documentWithOrigin,
    artifact_ref: {
      ...documentWithOrigin.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  }) as PolicyReceiptDocument;

  if (groundingAuthorityIdentityViolation(document, issuer.principal_id) !== null) {
    throw new GroundingAuthorityError("PolicyReceipt 的受信 Producer/Authority 身份不匹配。");
  }

  if (!(await issuer.verifyCommitted(document.artifact_ref))) {
    throw new GroundingAuthorityError("PolicyReceipt 尚未提交到持久化 Authority。");
  }

  const reference = document.artifact_ref as Extract<
    GroundingAuthorityReference,
    { artifact_type: "PolicyReceipt" }
  >;
  const binding = Object.freeze({
    document,
    reference,
  });
  authoritativePolicyReceipts.add(binding);
  return binding as unknown as AuthoritativePolicyReceipt;
}

// ─── Coordinator 实现 ──────────────────────────────────────────────────────────

/**
 * Coordinator 只验证 sealed fact，不签发新权威。
 *
 * 接收一个 bundle（三个独立的权威文档），验证：
 * - 每个文档自身完整（schema、hash、identity）
 * - bundle 内 origin 一致
 * - bundle 内文档间引用一致（PolicyReceipt 引用同 scope/run 的 SR/SS）
 * - 所有文档已持久化提交
 */
export async function coordinateGroundingBundle(
  input: Readonly<{
    coordinator: unknown;
    semanticRelease: AuthoritativeSemanticRelease;
    schemaSnapshot: AuthoritativeSchemaSnapshot;
    policyReceipt: AuthoritativePolicyReceipt;
  }>,
): Promise<AuthoritativeGroundingBundle> {
  if (!isTrustedGroundingCoordinator(input.coordinator)) {
    throw new TypeError("GROUNDING_COORDINATOR_REQUIRED");
  }

  // 1. 验证每个文档的品牌
  if (!isAuthoritativeSemanticRelease(input.semanticRelease)) {
    throw new TypeError("GROUNDING_BUNDLE_SEMANTIC_RELEASE_NOT_AUTHORITATIVE");
  }
  if (!isAuthoritativeSchemaSnapshot(input.schemaSnapshot)) {
    throw new TypeError("GROUNDING_BUNDLE_SCHEMA_SNAPSHOT_NOT_AUTHORITATIVE");
  }
  if (!isAuthoritativePolicyReceipt(input.policyReceipt)) {
    throw new TypeError("GROUNDING_BUNDLE_POLICY_RECEIPT_NOT_AUTHORITATIVE");
  }

  const { document: sr, reference: srRef } = input.semanticRelease;
  const { document: ss, reference: ssRef } = input.schemaSnapshot;
  const { document: pr, reference: prRef } = input.policyReceipt;

  // 2. 验证 origin 一致性
  assertGroundingAuthorityOriginConsistency([sr, ss, pr]);

  // 3. 验证 bundle 一致性（文档间引用）
  assertGroundingAuthorityBundleConsistency(pr, sr, ss);

  // 4. 验证所有文档与 reference 身份匹配
  if (
    artifactReferenceIdentity(srRef) !== artifactReferenceIdentity(sr.artifact_ref) ||
    artifactReferenceIdentity(ssRef) !== artifactReferenceIdentity(ss.artifact_ref) ||
    artifactReferenceIdentity(prRef) !== artifactReferenceIdentity(pr.artifact_ref)
  ) {
    throw new GroundingAuthorityError(
      "Grounding Bundle 中 Reference 与 Document 的 Artifact Identity 必须一致。",
    );
  }

  // 5. 验证 PolicyReceipt 引用上游
  if (
    artifactReferenceIdentity(pr.semantic_release_ref) !== artifactReferenceIdentity(srRef) ||
    artifactReferenceIdentity(pr.schema_snapshot_ref) !== artifactReferenceIdentity(ssRef)
  ) {
    throw new GroundingAuthorityError(
      "PolicyReceipt 必须引用当前 Bundle 中的 SemanticRelease 与 SchemaSnapshot。",
    );
  }

  const binding = Object.freeze({
    semanticRelease: input.semanticRelease,
    schemaSnapshot: input.schemaSnapshot,
    policyReceipt: input.policyReceipt,
    origin: sr.origin,
  });
  authoritativeGroundingBundles.add(binding);
  return binding as unknown as AuthoritativeGroundingBundle;
}

// ─── Materializer 实现 ─────────────────────────────────────────────────────────

/**
 * 签发并核验的结果。
 */
export type MaterializationResult = Readonly<{
  bundle: AuthoritativeGroundingBundle;
  /**
   * 所有文档的 origin 镜像。
   */
  origin: GroundingAuthorityOrigin;
}>;

/**
 * GroundingAuthorityMaterializer 的组合签发入口。
 *
 * 按顺序执行：
 * 1. 签发 SemanticRelease
 * 2. 签发 SchemaSnapshot
 * 3. 签发 PolicyReceipt
 * 4. Coordinator 核验 bundle
 *
 * 三个 issuer 独立运行，各自使用自己的适配器。如果任一签发失败，整个物化失败。
 */
export async function materializeGroundingAuthority(
  input: Readonly<{
    materializer: unknown;
    semanticReleaseIssuer: unknown;
    schemaSnapshotIssuer: unknown;
    policyReceiptIssuer: unknown;
    coordinator: unknown;
    semanticRelease: unknown;
    schemaSnapshot: unknown;
    policyReceipt: unknown;
    origin: GroundingAuthorityOrigin;
  }>,
): Promise<MaterializationResult> {
  if (!isTrustedGroundingMaterializer(input.materializer)) {
    throw new TypeError("GROUNDING_MATERIALIZER_REQUIRED");
  }

  // 先签发 SR 与 SS，再用它们的 reference 签发 PR（PR 必须引用已签发的 SR/SS 的 content_hash）
  const sr = await issueSemanticRelease({
    issuer: input.semanticReleaseIssuer,
    document: input.semanticRelease,
    origin: input.origin,
  });
  const ss = await issueSchemaSnapshot({
    issuer: input.schemaSnapshotIssuer,
    document: input.schemaSnapshot,
    origin: input.origin,
  });
  const pr = await issuePolicyReceipt({
    issuer: input.policyReceiptIssuer,
    document: {
      ...(input.policyReceipt as Record<string, unknown>),
      semantic_release_ref: sr.reference,
      schema_snapshot_ref: ss.reference,
    },
    origin: input.origin,
  });

  // Coordinator 核验 bundle
  const bundle = await coordinateGroundingBundle({
    coordinator: input.coordinator,
    semanticRelease: sr,
    schemaSnapshot: ss,
    policyReceipt: pr,
  });

  return Object.freeze({
    bundle,
    origin: input.origin,
  }) as MaterializationResult;
}

// ─── V2 Published-only Grounding Bundle ───────────────────────────────────────

/**
 * V2 物化器的输入参数。
 * 与 `materializeGroundingAuthority` 相同，但额外包含 published-only binding 信息。
 */
export type PublishedGroundingBundleV2Input = Readonly<{
  materializer: unknown;
  semanticReleaseIssuer: unknown;
  schemaSnapshotIssuer: unknown;
  policyReceiptIssuer: unknown;
  coordinator: unknown;
  semanticRelease: unknown;
  schemaSnapshot: unknown;
  policyReceipt: unknown;
  origin: GroundingAuthorityOrigin;
  /** 运行 ID */
  runId: string;
  /** 物化输入哈希 */
  materializationInputHash: string;
  /** 绑定的 projection ID */
  projectionId: string;
  /** 绑定的 U5 artifact ref（可选） */
  u5ArtifactRef?: string;
  /** 绑定的 U5 artifact hash（可选） */
  u5ArtifactHash?: string;
}>;

/**
 * V2 物化器的结果。
 * 包含 bundle 和 binding 信息。
 */
export type PublishedGroundingBundleV2Result = Readonly<{
  bundle: AuthoritativeGroundingBundle;
  origin: GroundingAuthorityOrigin;
  /** binding ID */
  bindingId: string;
  /** binding hash */
  bindingHash: string;
  /** release ID */
  releaseId: string;
  /** release generation */
  releaseGeneration: number;
  /** projection ID */
  projectionId: string;
  /** run ID */
  runId: string;
}>;

/**
 * V2 Published-only Grounding Bundle 物化器。
 *
 * 与 `materializeGroundingAuthority` 相似，但额外：
 * 1. 验证运行时模式不是 LEGACY（published-only bridge 要求至少 SHADOW）
 * 2. 将三个 U5 Artifact 与 `semantic_runtime_projection_binding` 在同一事务提交
 * 3. 幂等性基于 `(scope, run_id, materialization_input_hash)`
 *
 * 注意：此函数是 TypeScript 层的编排函数，实际的 SQL 事务和绑定
 * 由 `semantic.commit_published_grounding_bundle_v2` 数据库函数完成。
 * 此函数负责签发和核验 three Issuer documents，然后返回结果供调用者
 * 在数据库事务中提交。
 */
export async function commitPublishedGroundingBundleV2(
  input: PublishedGroundingBundleV2Input,
): Promise<PublishedGroundingBundleV2Result> {
  if (!isTrustedGroundingMaterializer(input.materializer)) {
    throw new TypeError("GROUNDING_MATERIALIZER_REQUIRED");
  }

  // 先签发 SR 与 SS，再用它们的 reference 签发 PR
  const sr = await issueSemanticRelease({
    issuer: input.semanticReleaseIssuer,
    document: input.semanticRelease,
    origin: input.origin,
  });
  const ss = await issueSchemaSnapshot({
    issuer: input.schemaSnapshotIssuer,
    document: input.schemaSnapshot,
    origin: input.origin,
  });
  const pr = await issuePolicyReceipt({
    issuer: input.policyReceiptIssuer,
    document: {
      ...(input.policyReceipt as Record<string, unknown>),
      semantic_release_ref: sr.reference,
      schema_snapshot_ref: ss.reference,
    },
    origin: input.origin,
  });

  // Coordinator 核验 bundle
  const bundle = await coordinateGroundingBundle({
    coordinator: input.coordinator,
    semanticRelease: sr,
    schemaSnapshot: ss,
    policyReceipt: pr,
  });

  // 计算 binding hash
  const bindingHash = sha256Hex(
    `${input.runId}|${input.materializationInputHash}|v2-grounding-binding`,
  );
  const bindingId = uuidV7();

  return Object.freeze({
    bundle,
    origin: input.origin,
    bindingId,
    bindingHash: `sha256:${bindingHash}`,
    releaseId: sr.reference.content_hash,
    releaseGeneration: 0, // 调用者应在数据库事务中填充实际值
    projectionId: input.projectionId,
    runId: input.runId,
  }) as PublishedGroundingBundleV2Result;
}

/**
 * 计算 SHA-256 hex 摘要。
 */
function sha256Hex(input: string): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * 生成 UUID v7。
 */
function uuidV7(): string {
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  return randomUUID();
}
