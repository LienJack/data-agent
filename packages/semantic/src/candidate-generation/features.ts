import {
  canonicalizeJson,
  computeSchemaFeaturePacketDigest,
  type PhysicalSchemaSnapshot,
  type SchemaDriftEvent,
  type SchemaFeature,
  type SchemaFeaturePacket,
  type SchemaFeaturePacketMaterial,
  type SemanticBaseReleaseIdentity,
  type SemanticEvidenceRef,
  type SemanticScope,
  sha256ContentHash,
} from "@data-agent/contracts";

export interface BuildSchemaFeaturePacketInput {
  readonly scope: SemanticScope;
  readonly snapshot: PhysicalSchemaSnapshot;
  readonly drift: {
    readonly event: SchemaDriftEvent;
    readonly digest: `sha256:${string}`;
  } | null;
  readonly base_release: SemanticBaseReleaseIdentity | null;
}

type FeatureWithoutId = Omit<SchemaFeature, "feature_id">;

function relationSortKey(relation: { schema_name: string; relation_name: string }): string {
  return `${relation.schema_name}\u0000${relation.relation_name}`;
}

function constraintFeature(
  feature_kind: Extract<
    SchemaFeature["feature_kind"],
    "PRIMARY_KEY" | "FOREIGN_KEY" | "UNIQUE" | "CHECK" | "INDEX"
  >,
  relation: { schema_name: string; relation_name: string },
  constraint_name: string,
  values: Pick<
    SchemaFeature,
    "column_names" | "referenced_relation" | "referenced_column_names" | "definition"
  >,
): FeatureWithoutId {
  return {
    feature_kind,
    locator: {
      locator_kind: "PHYSICAL_CONSTRAINT",
      relation,
      constraint_kind: feature_kind,
      constraint_name,
    },
    display_name: `${relation.schema_name}.${relation.relation_name}.${constraint_name}`,
    relation_kind: null,
    formatted_type: null,
    nullable: null,
    comment: null,
    ...values,
    proof_kind: "DDL_ENFORCED",
  };
}

function collectFeatures(snapshot: PhysicalSchemaSnapshot): FeatureWithoutId[] {
  const result: FeatureWithoutId[] = [];
  const relations = [...snapshot.content.relations].sort((left, right) =>
    relationSortKey(left.identity).localeCompare(relationSortKey(right.identity)),
  );

  for (const physicalRelation of relations) {
    const relation = physicalRelation.identity;
    result.push({
      feature_kind: "RELATION",
      locator: { locator_kind: "PHYSICAL_RELATION", relation },
      display_name: `${relation.schema_name}.${relation.relation_name}`,
      relation_kind: physicalRelation.relation_kind,
      formatted_type: null,
      nullable: null,
      comment: physicalRelation.comment,
      definition: null,
      column_names: physicalRelation.columns.map((column) => column.column_name).sort(),
      referenced_relation: null,
      referenced_column_names: [],
      proof_kind: "OBSERVED_ONLY",
    });

    for (const column of [...physicalRelation.columns].sort(
      (left, right) =>
        left.ordinal_position - right.ordinal_position ||
        left.column_name.localeCompare(right.column_name),
    )) {
      result.push({
        feature_kind: "COLUMN",
        locator: { locator_kind: "PHYSICAL_COLUMN", relation, column_name: column.column_name },
        display_name: `${relation.schema_name}.${relation.relation_name}.${column.column_name}`,
        relation_kind: null,
        formatted_type: column.formatted_type,
        nullable: column.nullable,
        comment: column.comment,
        definition: column.generated_expression ?? column.default_expression,
        column_names: [column.column_name],
        referenced_relation: null,
        referenced_column_names: [],
        proof_kind: "OBSERVED_ONLY",
      });
    }

    if (physicalRelation.primary_key) {
      result.push(
        constraintFeature("PRIMARY_KEY", relation, physicalRelation.primary_key.constraint_name, {
          column_names: [...physicalRelation.primary_key.columns],
          referenced_relation: null,
          referenced_column_names: [],
          definition: null,
        }),
      );
    }

    for (const foreignKey of [...physicalRelation.foreign_keys].sort((left, right) =>
      left.constraint_name.localeCompare(right.constraint_name),
    )) {
      result.push(
        constraintFeature("FOREIGN_KEY", relation, foreignKey.constraint_name, {
          column_names: foreignKey.column_pairs.map((pair) => pair.column_name),
          referenced_relation: foreignKey.referenced_relation,
          referenced_column_names: foreignKey.column_pairs.map(
            (pair) => pair.referenced_column_name,
          ),
          definition: `MATCH ${foreignKey.match_type}; ON UPDATE ${foreignKey.on_update}; ON DELETE ${foreignKey.on_delete}`,
        }),
      );
    }

    for (const unique of [...physicalRelation.unique_constraints].sort((left, right) =>
      left.constraint_name.localeCompare(right.constraint_name),
    )) {
      result.push(
        constraintFeature("UNIQUE", relation, unique.constraint_name, {
          column_names: [...unique.columns],
          referenced_relation: null,
          referenced_column_names: [],
          definition: unique.nulls_not_distinct ? "NULLS NOT DISTINCT" : null,
        }),
      );
    }

    for (const check of [...physicalRelation.check_constraints].sort((left, right) =>
      left.constraint_name.localeCompare(right.constraint_name),
    )) {
      result.push(
        constraintFeature("CHECK", relation, check.constraint_name, {
          column_names: [],
          referenced_relation: null,
          referenced_column_names: [],
          definition: check.expression,
        }),
      );
    }

    for (const index of [...physicalRelation.indexes].sort((left, right) =>
      left.index_name.localeCompare(right.index_name),
    )) {
      result.push(
        constraintFeature("INDEX", relation, index.index_name, {
          column_names: [...index.included_columns],
          referenced_relation: null,
          referenced_column_names: [],
          definition: canonicalizeJson({
            access_method: index.access_method,
            key_expressions: index.key_expressions,
            predicate: index.predicate,
            unique: index.unique,
            valid: index.valid,
          }),
        }),
      );
    }
  }

  return result;
}

async function attachFeatureId(feature: FeatureWithoutId): Promise<SchemaFeature> {
  const digest = await sha256ContentHash({
    feature_kind: feature.feature_kind,
    locator: feature.locator,
  });
  return { ...feature, feature_id: `feature.${digest.slice("sha256:".length)}` };
}

export async function buildSchemaFeaturePacket(
  input: BuildSchemaFeaturePacketInput,
): Promise<SchemaFeaturePacket> {
  if (
    input.drift &&
    input.drift.event.current_snapshot_content_hash !== input.snapshot.snapshot_content_hash
  ) {
    throw new Error("SCHEMA_FEATURE_DRIFT_SNAPSHOT_MISMATCH");
  }

  const features = await Promise.all(collectFeatures(input.snapshot).map(attachFeatureId));
  features.sort((left, right) => left.feature_id.localeCompare(right.feature_id));

  const material: SchemaFeaturePacketMaterial = {
    schema_version: "schema-feature-packet@1.0.0",
    scope: input.scope,
    snapshot_id: input.snapshot.snapshot_id,
    snapshot_digest: input.snapshot.snapshot_content_hash,
    drift_event_id: input.drift?.event.drift_event_id ?? null,
    drift_digest: input.drift?.digest ?? null,
    base_release: input.base_release,
    features,
  };

  return { ...material, feature_digest: await computeSchemaFeaturePacketDigest(material) };
}

export function buildPhysicalSchemaEvidence(
  packet: SchemaFeaturePacket,
): readonly SemanticEvidenceRef[] {
  return packet.features.map((feature) => ({
    evidence_id: `evidence.${feature.feature_id.slice("feature.".length)}`,
    source_kind: "PHYSICAL_SCHEMA" as const,
    source_id: packet.snapshot_id,
    source_digest: packet.snapshot_digest,
    locator: feature.locator,
    observation: `${feature.feature_kind}: ${feature.display_name}`,
    confidence: feature.proof_kind === "DDL_ENFORCED" ? 1 : 0.95,
  }));
}
