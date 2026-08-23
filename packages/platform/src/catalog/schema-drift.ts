import {
  type CheckConstraint,
  canonicalizeJson,
  type ForeignKey,
  type PhysicalColumn,
  type PhysicalIndex,
  type PhysicalRelation,
  type PhysicalSchemaSnapshot,
  type PrimaryKey,
  type RelationIdentity,
  type SchemaDriftEvent,
  type SchemaDriftOperation,
  schemaDriftEventSchema,
  type UniqueConstraint,
} from "@data-agent/contracts";
import { CatalogContractError } from "./physical-schema.js";

type DriftEventMetadata = Readonly<{
  drift_event_id: string;
  observed_at: string;
}>;

type NamedObject = PrimaryKey | ForeignKey | UniqueConstraint | CheckConstraint | PhysicalIndex;

type WithoutSeverity<T> = T extends unknown ? Omit<T, "severity"> : never;
type OperationInput = WithoutSeverity<SchemaDriftOperation>;

const severityRank = { INFO: 1, WARNING: 2, BREAKING: 3 } as const;

function structuredKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function relationKey(identity: RelationIdentity): string {
  return structuredKey([identity.schema_name, identity.relation_name]);
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function namedObjectName(value: NamedObject): string {
  if ("constraint_name" in value) return value.constraint_name;
  return value.index_name;
}

function operationSeverity(
  kind: SchemaDriftOperation["operation_kind"],
): "INFO" | "WARNING" | "BREAKING" {
  if (
    kind.endsWith("_REMOVED") ||
    kind === "COLUMN_TYPE_CHANGED" ||
    kind === "COLUMN_NULLABILITY_CHANGED" ||
    kind === "COLUMN_GENERATED_CHANGED" ||
    kind === "COLUMN_IDENTITY_CHANGED" ||
    kind === "PRIMARY_KEY_CHANGED" ||
    kind === "FOREIGN_KEY_CHANGED" ||
    kind === "UNIQUE_CONSTRAINT_CHANGED" ||
    kind === "CHECK_CONSTRAINT_CHANGED"
  ) {
    return "BREAKING";
  }
  if (kind.endsWith("_CHANGED")) return "WARNING";
  return "INFO";
}

function operationIdentity(operation: SchemaDriftOperation): readonly string[] {
  if (operation.operation_kind === "RELATION_ADDED") {
    return [operation.after.identity.schema_name, operation.after.identity.relation_name];
  }
  if (operation.operation_kind === "RELATION_REMOVED") {
    return [operation.before.identity.schema_name, operation.before.identity.relation_name];
  }
  const identity = operation.identity;
  if ("column_name" in identity) {
    return [identity.relation.schema_name, identity.relation.relation_name, identity.column_name];
  }
  if ("object_name" in identity) {
    return [identity.relation.schema_name, identity.relation.relation_name, identity.object_name];
  }
  return [identity.schema_name, identity.relation_name];
}

function compareOperations(left: SchemaDriftOperation, right: SchemaDriftOperation): number {
  if (left.operation_kind < right.operation_kind) return -1;
  if (left.operation_kind > right.operation_kind) return 1;
  return structuredKey(operationIdentity(left)).localeCompare(
    structuredKey(operationIdentity(right)),
  );
}

function columnIdentity(relation: PhysicalRelation, column: PhysicalColumn) {
  return { relation: relation.identity, column_name: column.column_name };
}

function namedIdentity(relation: PhysicalRelation, objectName: string) {
  return { relation: relation.identity, object_name: objectName };
}

function pushOperation(target: SchemaDriftOperation[], operation: OperationInput): void {
  target.push({
    ...operation,
    severity: operationSeverity(operation.operation_kind),
  } as SchemaDriftOperation);
}

function compareColumns(
  baseRelation: PhysicalRelation,
  currentRelation: PhysicalRelation,
  operations: SchemaDriftOperation[],
): void {
  const base = new Map(baseRelation.columns.map((column) => [column.column_name, column]));
  const current = new Map(currentRelation.columns.map((column) => [column.column_name, column]));
  const names = [...new Set([...base.keys(), ...current.keys()])].sort();
  for (const name of names) {
    const before = base.get(name);
    const after = current.get(name);
    if (!before && after) {
      pushOperation(operations, {
        operation_kind: "COLUMN_ADDED",
        identity: columnIdentity(currentRelation, after),
        after,
      });
      continue;
    }
    if (before && !after) {
      pushOperation(operations, {
        operation_kind: "COLUMN_REMOVED",
        identity: columnIdentity(baseRelation, before),
        before,
      });
      continue;
    }
    if (!before || !after) continue;
    const identity = columnIdentity(currentRelation, after);
    const changes: ReadonlyArray<
      readonly [SchemaDriftOperation["operation_kind"], unknown, unknown]
    > = [
      ["COLUMN_ORDINAL_CHANGED", before.ordinal_position, after.ordinal_position],
      [
        "COLUMN_TYPE_CHANGED",
        { formatted_type: before.formatted_type, type_identity: before.type_identity },
        { formatted_type: after.formatted_type, type_identity: after.type_identity },
      ],
      ["COLUMN_NULLABILITY_CHANGED", before.nullable, after.nullable],
      ["COLUMN_DEFAULT_CHANGED", before.default_expression, after.default_expression],
      ["COLUMN_IDENTITY_CHANGED", before.identity_generation, after.identity_generation],
      ["COLUMN_GENERATED_CHANGED", before.generated_expression, after.generated_expression],
      ["COLUMN_COMMENT_CHANGED", before.comment, after.comment],
    ];
    for (const [operationKind, beforeValue, afterValue] of changes) {
      if (!equal(beforeValue, afterValue)) {
        pushOperation(operations, {
          operation_kind: operationKind,
          identity,
          before: beforeValue,
          after: afterValue,
        } as OperationInput);
      }
    }
  }
}

function compareNamedObjects(
  currentRelation: PhysicalRelation,
  baseValues: readonly NamedObject[],
  currentValues: readonly NamedObject[],
  kinds: Readonly<{
    added: SchemaDriftOperation["operation_kind"];
    removed: SchemaDriftOperation["operation_kind"];
    changed: SchemaDriftOperation["operation_kind"];
  }>,
  operations: SchemaDriftOperation[],
): void {
  const base = new Map(baseValues.map((value) => [namedObjectName(value), value]));
  const current = new Map(currentValues.map((value) => [namedObjectName(value), value]));
  const names = [...new Set([...base.keys(), ...current.keys()])].sort();
  for (const name of names) {
    const before = base.get(name);
    const after = current.get(name);
    const identity = namedIdentity(currentRelation, name);
    if (!before && after) {
      pushOperation(operations, { operation_kind: kinds.added, identity, after } as OperationInput);
    } else if (before && !after) {
      pushOperation(operations, {
        operation_kind: kinds.removed,
        identity,
        before,
      } as OperationInput);
    } else if (before && after && !equal(before, after)) {
      pushOperation(operations, {
        operation_kind: kinds.changed,
        identity,
        before,
        after,
      } as OperationInput);
    }
  }
}

function compareRelations(
  base: PhysicalRelation,
  current: PhysicalRelation,
  operations: SchemaDriftOperation[],
): void {
  if (base.relation_kind !== current.relation_kind) {
    pushOperation(operations, {
      operation_kind: "RELATION_KIND_CHANGED",
      identity: current.identity,
      before: base.relation_kind,
      after: current.relation_kind,
    });
  }
  if (base.comment !== current.comment) {
    pushOperation(operations, {
      operation_kind: "RELATION_COMMENT_CHANGED",
      identity: current.identity,
      before: base.comment,
      after: current.comment,
    });
  }
  compareColumns(base, current, operations);
  compareNamedObjects(
    current,
    base.primary_key ? [base.primary_key] : [],
    current.primary_key ? [current.primary_key] : [],
    { added: "PRIMARY_KEY_ADDED", removed: "PRIMARY_KEY_REMOVED", changed: "PRIMARY_KEY_CHANGED" },
    operations,
  );
  compareNamedObjects(
    current,
    base.foreign_keys,
    current.foreign_keys,
    {
      added: "FOREIGN_KEY_ADDED",
      removed: "FOREIGN_KEY_REMOVED",
      changed: "FOREIGN_KEY_CHANGED",
    },
    operations,
  );
  compareNamedObjects(
    current,
    base.unique_constraints,
    current.unique_constraints,
    {
      added: "UNIQUE_CONSTRAINT_ADDED",
      removed: "UNIQUE_CONSTRAINT_REMOVED",
      changed: "UNIQUE_CONSTRAINT_CHANGED",
    },
    operations,
  );
  compareNamedObjects(
    current,
    base.check_constraints,
    current.check_constraints,
    {
      added: "CHECK_CONSTRAINT_ADDED",
      removed: "CHECK_CONSTRAINT_REMOVED",
      changed: "CHECK_CONSTRAINT_CHANGED",
    },
    operations,
  );
  compareNamedObjects(
    current,
    base.indexes,
    current.indexes,
    {
      added: "INDEX_ADDED",
      removed: "INDEX_REMOVED",
      changed: "INDEX_CHANGED",
    },
    operations,
  );
}

export function comparePhysicalSchemaSnapshots(
  base: PhysicalSchemaSnapshot,
  current: PhysicalSchemaSnapshot,
  metadata: DriftEventMetadata,
): SchemaDriftEvent {
  if (
    base.content.datasource_id !== current.content.datasource_id ||
    base.content.datasource_fingerprint !== current.content.datasource_fingerprint
  ) {
    throw new CatalogContractError("Drift 只能比较同一 datasource fingerprint 的物理快照。");
  }

  const operations: SchemaDriftOperation[] = [];
  const baseRelations = new Map(
    base.content.relations.map((relation) => [relationKey(relation.identity), relation]),
  );
  const currentRelations = new Map(
    current.content.relations.map((relation) => [relationKey(relation.identity), relation]),
  );
  const keys = [...new Set([...baseRelations.keys(), ...currentRelations.keys()])].sort();
  for (const key of keys) {
    const before = baseRelations.get(key);
    const after = currentRelations.get(key);
    if (!before && after) {
      pushOperation(operations, { operation_kind: "RELATION_ADDED", after });
    } else if (before && !after) {
      pushOperation(operations, { operation_kind: "RELATION_REMOVED", before });
    } else if (before && after) {
      compareRelations(before, after, operations);
    }
  }
  operations.sort(compareOperations);
  const highestSeverity = operations.reduce<"NONE" | "INFO" | "WARNING" | "BREAKING">(
    (highest, operation) =>
      highest === "NONE" || severityRank[operation.severity] > severityRank[highest]
        ? operation.severity
        : highest,
    "NONE",
  );

  return schemaDriftEventSchema.parse({
    schema_version: "schema-drift-event@1.0.0",
    drift_event_id: metadata.drift_event_id,
    datasource_id: current.content.datasource_id,
    datasource_fingerprint: current.content.datasource_fingerprint,
    base_snapshot_content_hash: base.snapshot_content_hash,
    current_snapshot_content_hash: current.snapshot_content_hash,
    observed_at: metadata.observed_at,
    severity: highestSeverity,
    binding_impact: "UNKNOWN",
    operations,
  });
}
