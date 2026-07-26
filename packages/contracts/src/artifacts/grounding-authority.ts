import { z } from "zod";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type ArtifactReference,
  type ArtifactReferenceVerifier,
  artifactProducerSchema,
  artifactReferenceFor,
  artifactReferenceIdentity,
  deterministicAuthoritySchema,
} from "./envelope.js";
import {
  allowedTableContractSchema,
  type catalogColumnContractSchema,
  catalogRelationshipContractSchema,
  catalogTableContractSchema,
  dimensionBindingSchema,
  mandatoryPredicateContractSchema,
  metricBindingSchema,
} from "./text2sql-primitives.js";

const semanticReleaseReferenceSchema = artifactReferenceFor("SemanticRelease");
const schemaSnapshotReferenceSchema = artifactReferenceFor("SchemaSnapshot");
const policyReceiptReferenceSchema = artifactReferenceFor("PolicyReceipt");

export const groundingAuthorityReferenceSchema = z.discriminatedUnion("artifact_type", [
  semanticReleaseReferenceSchema,
  schemaSnapshotReferenceSchema,
  policyReceiptReferenceSchema,
]);

const deterministicProducerSchema = artifactProducerSchema.extend({
  kind: z.literal("deterministic"),
});

const groundingAuthorityBaseShape = {
  schema_version: versionIdentifierSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  parent_ref: groundingAuthorityReferenceSchema.nullable(),
  producer: deterministicProducerSchema,
  authority: deterministicAuthoritySchema,
  created_at: timestampSchema,
  document_hash: contentHashSchema,
} as const;

const allowedSchemaContractSchema = z.strictObject({
  tables: z.array(allowedTableContractSchema).min(1),
});

const semanticReleaseDocumentBaseSchema = z.strictObject({
  ...groundingAuthorityBaseShape,
  artifact_type: z.literal("SemanticRelease"),
  artifact_ref: semanticReleaseReferenceSchema,
  semantic_release_version: versionIdentifierSchema,
  catalog_version: versionIdentifierSchema,
  datasource_id: immutableIdSchema,
  metrics: z.array(metricBindingSchema).min(1),
  dimensions: z.array(dimensionBindingSchema),
});

const schemaSnapshotDocumentBaseSchema = z.strictObject({
  ...groundingAuthorityBaseShape,
  artifact_type: z.literal("SchemaSnapshot"),
  artifact_ref: schemaSnapshotReferenceSchema,
  schema_snapshot_version: versionIdentifierSchema,
  catalog_version: versionIdentifierSchema,
  datasource_id: immutableIdSchema,
  tables: z.array(catalogTableContractSchema).min(1),
  relationships: z.array(catalogRelationshipContractSchema),
});

const policyReceiptDocumentBaseSchema = z.strictObject({
  ...groundingAuthorityBaseShape,
  artifact_type: z.literal("PolicyReceipt"),
  artifact_ref: policyReceiptReferenceSchema,
  policy_version: versionIdentifierSchema,
  datasource_id: immutableIdSchema,
  principal_id: z.string().min(1).max(256),
  semantic_release_ref: semanticReleaseReferenceSchema,
  schema_snapshot_ref: schemaSnapshotReferenceSchema,
  allowed_schema: allowedSchemaContractSchema,
  mandatory_predicates: z.array(mandatoryPredicateContractSchema),
});

function addDuplicateIssue(
  values: readonly string[],
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({
      code: "custom",
      message,
      path,
    });
  }
}

function referenceMatchesDocument(
  reference: ArtifactReference,
  document: {
    readonly scope: z.infer<typeof appScopeSchema>;
    readonly run_id: string;
  },
): boolean {
  return (
    reference.app_id === document.scope.app_id &&
    reference.tenant_id === document.scope.tenant_id &&
    reference.environment === document.scope.environment &&
    reference.run_id === document.run_id
  );
}

function validateSemanticRelease(
  document: z.infer<typeof semanticReleaseDocumentBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  const metricIdList = document.metrics.map(({ metric_id }) => metric_id);
  const metricIds = new Set(metricIdList);
  addDuplicateIssue(metricIdList, ctx, ["metrics"], "SemanticRelease 不能包含重复 Metric。");
  addDuplicateIssue(
    document.dimensions.map(({ dimension_id }) => dimension_id),
    ctx,
    ["dimensions"],
    "SemanticRelease 不能包含重复 Dimension。",
  );
  if (document.dimensions.some(({ dimension_id }) => metricIds.has(dimension_id))) {
    ctx.addIssue({
      code: "custom",
      message: "SemanticRelease 的 Metric 与 Dimension 身份必须互斥。",
      path: ["dimensions"],
    });
  }
}

function validateSchemaSnapshot(
  document: z.infer<typeof schemaSnapshotDocumentBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  addDuplicateIssue(
    document.tables.map(({ table_id }) => table_id),
    ctx,
    ["tables"],
    "SchemaSnapshot 不能包含重复 Table。",
  );
  addDuplicateIssue(
    document.relationships.map(({ relationship_id }) => relationship_id),
    ctx,
    ["relationships"],
    "SchemaSnapshot 不能包含重复 Relationship。",
  );

  const columnsByTable = new Map<
    string,
    Map<string, z.infer<typeof catalogColumnContractSchema>>
  >();
  for (const [tableIndex, table] of document.tables.entries()) {
    const columnIds = table.columns.map(({ column_id }) => column_id);
    addDuplicateIssue(
      columnIds,
      ctx,
      ["tables", tableIndex, "columns"],
      "SchemaSnapshot Table 不能包含重复 Column。",
    );
    columnsByTable.set(
      table.table_id,
      new Map(table.columns.map((column) => [column.column_id, column])),
    );
  }

  for (const [relationshipIndex, relationship] of document.relationships.entries()) {
    if (relationship.left_column_ids.length !== relationship.right_column_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Relationship 两侧必须声明相同数量的复合 Join Key。",
        path: ["relationships", relationshipIndex],
      });
    }
    const leftColumns = columnsByTable.get(relationship.left_table_id);
    const rightColumns = columnsByTable.get(relationship.right_table_id);
    if (
      !leftColumns ||
      !rightColumns ||
      relationship.left_column_ids.some((columnId) => !leftColumns.has(columnId)) ||
      relationship.right_column_ids.some((columnId) => !rightColumns.has(columnId))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Relationship 必须完整引用当前 SchemaSnapshot 中的 Table 与 Column。",
        path: ["relationships", relationshipIndex],
      });
    }
    if (
      relationship.left_row_match === "required" &&
      relationship.left_column_ids.some((columnId) => leftColumns?.get(columnId)?.nullable === true)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Required left-row match 不能建立在可空 Join Key 上。",
        path: ["relationships", relationshipIndex, "left_row_match"],
      });
    }
    if (
      relationship.right_row_match === "required" &&
      relationship.right_column_ids.some(
        (columnId) => rightColumns?.get(columnId)?.nullable === true,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Required right-row match 不能建立在可空 Join Key 上。",
        path: ["relationships", relationshipIndex, "right_row_match"],
      });
    }
  }
}

function validatePolicyReceipt(
  document: z.infer<typeof policyReceiptDocumentBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (document.authority.policy_version !== document.policy_version) {
    ctx.addIssue({
      code: "custom",
      message: "PolicyReceipt 必须由同版本的确定性 Policy Authority 提交。",
      path: ["authority", "policy_version"],
    });
  }
  if (
    !referenceMatchesDocument(document.semantic_release_ref, document) ||
    !referenceMatchesDocument(document.schema_snapshot_ref, document)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "PolicyReceipt 的 SemanticRelease 与 SchemaSnapshot 必须属于同一 Scope/Run。",
      path: ["semantic_release_ref"],
    });
  }

  addDuplicateIssue(
    document.allowed_schema.tables.map(({ table_id }) => table_id),
    ctx,
    ["allowed_schema", "tables"],
    "AllowedSchema 不能包含重复 Table。",
  );
  addDuplicateIssue(
    document.mandatory_predicates.map(
      ({ table_id, column_id, operator, parameter_key }) =>
        `${table_id}\u0000${column_id}\u0000${operator}\u0000${parameter_key}`,
    ),
    ctx,
    ["mandatory_predicates"],
    "PolicyReceipt 不能包含重复 Mandatory Predicate。",
  );
  const allowedColumns = new Map<string, Set<string>>();
  for (const [tableIndex, table] of document.allowed_schema.tables.entries()) {
    addDuplicateIssue(
      table.column_ids,
      ctx,
      ["allowed_schema", "tables", tableIndex, "column_ids"],
      "AllowedSchema Table 不能包含重复 Column。",
    );
    allowedColumns.set(table.table_id, new Set(table.column_ids));
  }
  for (const [predicateIndex, predicate] of document.mandatory_predicates.entries()) {
    if (!allowedColumns.get(predicate.table_id)?.has(predicate.column_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Mandatory Predicate 只能引用 AllowedSchema 中已授权的 Column。",
        path: ["mandatory_predicates", predicateIndex],
      });
    }
  }
}

type GroundingAuthorityBaseDocument =
  | z.infer<typeof semanticReleaseDocumentBaseSchema>
  | z.infer<typeof schemaSnapshotDocumentBaseSchema>
  | z.infer<typeof policyReceiptDocumentBaseSchema>;

function validateGroundingAuthorityCommon(
  document: GroundingAuthorityBaseDocument,
  ctx: z.RefinementCtx,
): void {
  if (!referenceMatchesDocument(document.artifact_ref, document)) {
    ctx.addIssue({
      code: "custom",
      message: "Grounding Authority Reference 必须与 Document 属于同一 Scope/Run。",
      path: ["artifact_ref"],
    });
  }
  if (document.artifact_ref.content_hash !== document.document_hash) {
    ctx.addIssue({
      code: "custom",
      message: "Grounding Authority Reference 必须绑定规范 Document Hash。",
      path: ["artifact_ref", "content_hash"],
    });
  }
  if (document.artifact_ref.revision === 1 && document.parent_ref !== null) {
    ctx.addIssue({
      code: "custom",
      message: "首个 Grounding Authority Revision 的 parent_ref 必须为 null。",
      path: ["parent_ref"],
    });
  }
  if (document.artifact_ref.revision > 1) {
    const parent = document.parent_ref;
    if (
      !parent ||
      parent.app_id !== document.artifact_ref.app_id ||
      parent.tenant_id !== document.artifact_ref.tenant_id ||
      parent.environment !== document.artifact_ref.environment ||
      parent.run_id !== document.artifact_ref.run_id ||
      parent.artifact_id !== document.artifact_ref.artifact_id ||
      parent.artifact_type !== document.artifact_ref.artifact_type ||
      parent.revision !== document.artifact_ref.revision - 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "后续 Grounding Authority Revision 必须绑定同 Artifact 的直接父 Revision。",
        path: ["parent_ref"],
      });
    }
  }
}

export const semanticReleaseDocumentSchema = semanticReleaseDocumentBaseSchema.superRefine(
  (document, ctx) => {
    validateGroundingAuthorityCommon(document, ctx);
    validateSemanticRelease(document, ctx);
  },
);

export const schemaSnapshotDocumentSchema = schemaSnapshotDocumentBaseSchema.superRefine(
  (document, ctx) => {
    validateGroundingAuthorityCommon(document, ctx);
    validateSchemaSnapshot(document, ctx);
  },
);

export const policyReceiptDocumentSchema = policyReceiptDocumentBaseSchema.superRefine(
  (document, ctx) => {
    validateGroundingAuthorityCommon(document, ctx);
    validatePolicyReceipt(document, ctx);
  },
);

export const groundingAuthorityDocumentSchema = z.discriminatedUnion("artifact_type", [
  semanticReleaseDocumentSchema,
  schemaSnapshotDocumentSchema,
  policyReceiptDocumentSchema,
]);

export type GroundingAuthorityReference = z.infer<typeof groundingAuthorityReferenceSchema>;
export type SemanticReleaseDocument = z.infer<typeof semanticReleaseDocumentSchema>;
export type SchemaSnapshotDocument = z.infer<typeof schemaSnapshotDocumentSchema>;
export type PolicyReceiptDocument = z.infer<typeof policyReceiptDocumentSchema>;
export type GroundingAuthorityDocument = z.infer<typeof groundingAuthorityDocumentSchema>;

export async function computeGroundingAuthorityDocumentHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const document = groundingAuthorityDocumentSchema.parse(input);
  const {
    document_hash: _documentHash,
    artifact_ref: { content_hash: _contentHash, ...artifactIdentity },
    ...facts
  } = document;
  return sha256ContentHash({
    ...facts,
    artifact_ref: artifactIdentity,
  });
}

export interface GroundingAuthorityVerificationContext {
  readonly principalId: string;
  resolveCommitted(reference: GroundingAuthorityReference): Promise<unknown | null>;
  verifyCommitted: ArtifactReferenceVerifier;
  /**
   * 由服务端 Deterministic Policy Authority 按目标 Content Address、当前 Principal
   * 与已解析的上游发行事实查询。
   *
   * 查询条件刻意不包含候选 PolicyReceipt 的 issuer、policy_version、allowed_schema 或
   * mandatory_predicates，避免调用方把自报事实反射成“权威结果”。
   */
  resolvePolicyReceiptIssuance?(
    input: Readonly<{
      scope: z.infer<typeof appScopeSchema>;
      run_id: string;
      principal_id: string;
      datasource_id: string;
      catalog_version: string;
      policy_receipt_ref: Extract<GroundingAuthorityReference, { artifact_type: "PolicyReceipt" }>;
      semantic_release_ref: Extract<
        GroundingAuthorityReference,
        { artifact_type: "SemanticRelease" }
      >;
      schema_snapshot_ref: Extract<
        GroundingAuthorityReference,
        { artifact_type: "SchemaSnapshot" }
      >;
    }>,
  ): Promise<unknown | null>;
  /**
   * 持久化提交与受治理读取边界必须设为 true；缺少专用 Policy Authority 时失败关闭。
   * 纯结构契约检查可以省略，以便校验尚未接入发行服务的离线文档。
   */
  readonly requirePolicyReceiptIssuance?: boolean;
}

export class GroundingAuthorityError extends Error {
  override readonly name = "GroundingAuthorityError";
  readonly code = "GROUNDING_DOCUMENT_NOT_AUTHORITATIVE";
}

export type GroundingAuthorityIdentityViolation =
  | "PRODUCER_ID_MISMATCH"
  | "AUTHORITY_ID_MISMATCH"
  | "AUTHORITY_VERSION_MISMATCH"
  | "POLICY_PRINCIPAL_MISMATCH";

export function groundingAuthorityIdentityViolation(
  document: GroundingAuthorityDocument,
  principalId: string,
): GroundingAuthorityIdentityViolation | null {
  if (document.producer.id !== "grounding-registry") {
    return "PRODUCER_ID_MISMATCH";
  }
  switch (document.artifact_type) {
    case "SemanticRelease":
    case "SchemaSnapshot":
      if (document.authority.id !== "grounding-authority") {
        return "AUTHORITY_ID_MISMATCH";
      }
      return document.authority.policy_version === "grounding-authority@1.0.0"
        ? null
        : "AUTHORITY_VERSION_MISMATCH";
    case "PolicyReceipt":
      if (document.authority.id !== "policy-authority") {
        return "AUTHORITY_ID_MISMATCH";
      }
      if (document.authority.policy_version !== document.policy_version) {
        return "AUTHORITY_VERSION_MISMATCH";
      }
      return document.principal_id === principalId ? null : "POLICY_PRINCIPAL_MISMATCH";
  }
}

function schemaColumnsByTable(document: SchemaSnapshotDocument) {
  return new Map(
    document.tables.map((table) => [
      table.table_id,
      new Set(table.columns.map(({ column_id }) => column_id)),
    ]),
  );
}

export function assertGroundingAuthorityBundleConsistency(
  policy: PolicyReceiptDocument,
  semanticRelease: SemanticReleaseDocument,
  schemaSnapshot: SchemaSnapshotDocument,
): void {
  if (
    policy.datasource_id !== semanticRelease.datasource_id ||
    policy.datasource_id !== schemaSnapshot.datasource_id ||
    semanticRelease.catalog_version !== schemaSnapshot.catalog_version
  ) {
    throw new GroundingAuthorityError(
      "PolicyReceipt 的 Datasource/Catalog 必须与固定 SemanticRelease/SchemaSnapshot 一致。",
    );
  }
  const schemaColumns = schemaColumnsByTable(schemaSnapshot);
  for (const metric of semanticRelease.metrics) {
    const columns = schemaColumns.get(metric.table_id);
    if (
      !columns?.has(metric.column_id) ||
      metric.dependency_column_ids.some((columnId) => !columns.has(columnId)) ||
      (metric.time_column_id !== null && !columns.has(metric.time_column_id))
    ) {
      throw new GroundingAuthorityError(
        `SemanticRelease Metric ${metric.metric_id} 未完整绑定 SchemaSnapshot 字段。`,
      );
    }
  }
  for (const dimension of semanticRelease.dimensions) {
    if (!schemaColumns.get(dimension.table_id)?.has(dimension.column_id)) {
      throw new GroundingAuthorityError(
        `SemanticRelease Dimension ${dimension.dimension_id} 未绑定 SchemaSnapshot 字段。`,
      );
    }
  }
  for (const table of policy.allowed_schema.tables) {
    const columns = schemaColumns.get(table.table_id);
    if (!columns || table.column_ids.some((columnId) => !columns.has(columnId))) {
      throw new GroundingAuthorityError(
        "PolicyReceipt AllowedSchema 不能超出固定 SchemaSnapshot。",
      );
    }
  }
}

async function verifyDeterministicPolicyReceiptIssuance(
  candidate: PolicyReceiptDocument,
  semanticRelease: SemanticReleaseDocument,
  schemaSnapshot: SchemaSnapshotDocument,
  authority: GroundingAuthorityVerificationContext,
): Promise<void> {
  const resolver = authority.resolvePolicyReceiptIssuance;
  if (!resolver) {
    if (authority.requirePolicyReceiptIssuance === true) {
      throw new GroundingAuthorityError(
        "PolicyReceipt 缺少服务端 Deterministic Policy Authority 发行事实。",
      );
    }
    return;
  }

  let resolved: unknown;
  try {
    resolved = await resolver({
      scope: semanticRelease.scope,
      run_id: semanticRelease.run_id,
      principal_id: authority.principalId,
      datasource_id: semanticRelease.datasource_id,
      catalog_version: semanticRelease.catalog_version,
      policy_receipt_ref: candidate.artifact_ref,
      semantic_release_ref: semanticRelease.artifact_ref,
      schema_snapshot_ref: schemaSnapshot.artifact_ref,
    });
  } catch {
    throw new GroundingAuthorityError(
      "PolicyReceipt 无法从服务端 Deterministic Policy Authority 解析。",
    );
  }

  const issuance = policyReceiptDocumentSchema.safeParse(resolved);
  if (
    !issuance.success ||
    groundingAuthorityIdentityViolation(issuance.data, authority.principalId) !== null ||
    artifactReferenceIdentity(issuance.data.artifact_ref) !==
      artifactReferenceIdentity(candidate.artifact_ref) ||
    (await computeGroundingAuthorityDocumentHash(issuance.data)) !== issuance.data.document_hash ||
    canonicalizeJson(issuance.data) !== canonicalizeJson(candidate)
  ) {
    throw new GroundingAuthorityError(
      "PolicyReceipt 必须逐字匹配服务端发行的 Content-Addressed Policy Revision。",
    );
  }
  assertGroundingAuthorityBundleConsistency(issuance.data, semanticRelease, schemaSnapshot);
}

async function verifyGroundingAuthorityDocumentRevision(
  referenceInput: unknown,
  authority: GroundingAuthorityVerificationContext,
  visited: Set<string>,
): Promise<GroundingAuthorityDocument> {
  let reference: GroundingAuthorityReference;
  let resolved: unknown;
  try {
    reference = groundingAuthorityReferenceSchema.parse(referenceInput);
    const identity = artifactReferenceIdentity(reference);
    if (visited.has(identity)) {
      throw new GroundingAuthorityError("Grounding Authority Parent/Upstream 引用不能形成循环。");
    }
    visited.add(identity);
    resolved = await authority.resolveCommitted(reference);
  } catch {
    throw new GroundingAuthorityError("Grounding Authority Document 无法从持久化 Authority 解析。");
  }

  const result = groundingAuthorityDocumentSchema.safeParse(resolved);
  if (
    !result.success ||
    artifactReferenceIdentity(result.data.artifact_ref) !== artifactReferenceIdentity(reference)
  ) {
    throw new GroundingAuthorityError(
      "Grounding Authority Resolver 必须返回完整匹配的 Content-Addressed Revision。",
    );
  }
  const document = result.data;
  if ((await computeGroundingAuthorityDocumentHash(document)) !== document.document_hash) {
    throw new GroundingAuthorityError("Grounding Authority Document Hash 与规范化内容不匹配。");
  }
  if (groundingAuthorityIdentityViolation(document, authority.principalId) !== null) {
    throw new GroundingAuthorityError(
      "Grounding Authority Document 的受信 Producer/Authority/Principal 身份不匹配。",
    );
  }

  if (document.parent_ref) {
    const parent = await verifyGroundingAuthorityDocumentRevision(
      document.parent_ref,
      authority,
      new Set(visited),
    );
    if (parent.artifact_type !== document.artifact_type) {
      throw new GroundingAuthorityError(
        "Grounding Authority Parent 必须是同 Artifact Type 的权威 Revision。",
      );
    }
  }

  if (document.artifact_type === "PolicyReceipt") {
    const [semanticRelease, schemaSnapshot] = await Promise.all([
      verifyGroundingAuthorityDocumentRevision(
        document.semantic_release_ref,
        authority,
        new Set(visited),
      ),
      verifyGroundingAuthorityDocumentRevision(
        document.schema_snapshot_ref,
        authority,
        new Set(visited),
      ),
    ]);
    if (
      semanticRelease.artifact_type !== "SemanticRelease" ||
      schemaSnapshot.artifact_type !== "SchemaSnapshot"
    ) {
      throw new GroundingAuthorityError(
        "PolicyReceipt 的固定上游必须是 SemanticRelease 与 SchemaSnapshot。",
      );
    }
    assertGroundingAuthorityBundleConsistency(document, semanticRelease, schemaSnapshot);
    await verifyDeterministicPolicyReceiptIssuance(
      document,
      semanticRelease,
      schemaSnapshot,
      authority,
    );
  }

  const references: ArtifactReference[] = [
    document.artifact_ref,
    ...(document.parent_ref ? [document.parent_ref] : []),
    ...(document.artifact_type === "PolicyReceipt"
      ? [document.semantic_release_ref, document.schema_snapshot_ref]
      : []),
  ];
  const committed = await Promise.all(references.map(authority.verifyCommitted));
  if (committed.some((verdict) => !verdict)) {
    throw new GroundingAuthorityError("Grounding Authority Document 或其固定上游引用尚未提交。");
  }

  return deepFreeze(document);
}

/**
 * 在调用者提供的同一持久化上下文中核验一条 Grounding Authority 修订。
 *
 * 返回值只是不可变的已校验快照，不携带、也不签发可跨事务转移的“权威品牌”。
 * 每个安全敏感消费点都必须在自己的事务中重新调用本函数。
 */
export async function verifyGroundingAuthorityDocument(
  referenceInput: unknown,
  authority: GroundingAuthorityVerificationContext,
): Promise<GroundingAuthorityDocument> {
  return verifyGroundingAuthorityDocumentRevision(referenceInput, authority, new Set());
}
