import {
  deepFreeze,
  type PhysicalRelation,
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotDraftSchema,
  physicalSchemaSnapshotSchema,
  type SchemaScanErrorCode,
  sha256ContentHash,
} from "@data-agent/contracts";

export class CatalogContractError extends Error {
  readonly code: SchemaScanErrorCode = "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID";

  constructor(message = "Datasource catalog 返回了不符合物理快照契约的数据。") {
    super(message);
    this.name = "CatalogContractError";
  }
}

function identityKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function assertUnique<T>(
  values: readonly T[],
  identity: (value: T) => readonly string[],
  objectKind: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = identityKey(identity(value));
    if (seen.has(key)) {
      throw new CatalogContractError(`${objectKind} 存在重复的结构化 identity。`);
    }
    seen.add(key);
  }
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? "";
    const rightPart = right[index] ?? "";
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

function sortByIdentity<T>(values: readonly T[], identity: (value: T) => readonly string[]): T[] {
  return [...values].sort((left, right) => compareTuple(identity(left), identity(right)));
}

function normalizeRelation(relation: PhysicalRelation): PhysicalRelation {
  assertUnique(relation.columns, (column) => [column.column_name], "Column");
  assertUnique(relation.foreign_keys, (foreignKey) => [foreignKey.constraint_name], "Foreign key");
  assertUnique(
    relation.unique_constraints,
    (constraint) => [constraint.constraint_name],
    "Unique constraint",
  );
  assertUnique(
    relation.check_constraints,
    (constraint) => [constraint.constraint_name],
    "Check constraint",
  );
  assertUnique(relation.indexes, (index) => [index.index_name], "Index");

  return {
    ...relation,
    columns: sortByIdentity(relation.columns, (column) => [column.column_name]),
    foreign_keys: sortByIdentity(relation.foreign_keys, (foreignKey) => [
      foreignKey.constraint_name,
    ]),
    unique_constraints: sortByIdentity(relation.unique_constraints, (constraint) => [
      constraint.constraint_name,
    ]),
    check_constraints: sortByIdentity(relation.check_constraints, (constraint) => [
      constraint.constraint_name,
    ]),
    indexes: sortByIdentity(relation.indexes, (index) => [index.index_name]),
  };
}

export async function createPhysicalSchemaSnapshot(
  input: unknown,
): Promise<PhysicalSchemaSnapshot> {
  const parsed = physicalSchemaSnapshotDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new CatalogContractError();
  }

  const { content } = parsed.data;
  assertUnique(content.included_schemas, (schemaName) => [schemaName], "Included schema");
  assertUnique(
    content.relations,
    (relation) => [relation.identity.schema_name, relation.identity.relation_name],
    "Relation",
  );

  const normalizedContent = {
    ...content,
    included_schemas: [...content.included_schemas].sort(),
    relations: sortByIdentity(content.relations.map(normalizeRelation), (relation) => [
      relation.identity.schema_name,
      relation.identity.relation_name,
    ]),
  };
  const snapshot = physicalSchemaSnapshotSchema.parse({
    schema_version: "physical-schema-snapshot@1.0.0",
    snapshot_id: parsed.data.snapshot_id,
    scan_run_id: parsed.data.scan_run_id,
    snapshot_content_hash: await sha256ContentHash(normalizedContent),
    captured_at: parsed.data.captured_at,
    content: normalizedContent,
  });
  return deepFreeze(snapshot);
}
