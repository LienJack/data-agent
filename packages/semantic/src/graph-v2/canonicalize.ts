import {
  deepFreeze,
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
  type SemanticEvidence,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSource,
  semanticEvidenceSchema,
  semanticGraphEdgeSchema,
  semanticGraphNodeSchema,
  semanticGraphSourceSchema,
  sha256ContentHash,
} from "@data-agent/contracts";

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStable);
}

export function canonicalizeSemanticGraph(input: unknown): SemanticGraphSource {
  const graph = semanticGraphSourceSchema.parse(input);
  return deepFreeze({
    ...graph,
    node_type_registry: [...graph.node_type_registry].sort((left, right) =>
      compareStable(left.node_type, right.node_type),
    ),
    edge_type_registry: [...graph.edge_type_registry]
      .sort((left, right) => compareStable(left.edge_type, right.edge_type))
      .map((definition) => ({
        ...definition,
        source_node_types: uniqueSorted(definition.source_node_types),
        target_node_types: uniqueSorted(definition.target_node_types),
      })),
    evidence: [...graph.evidence].sort((left, right) =>
      compareStable(left.evidence_id, right.evidence_id),
    ),
    nodes: [...graph.nodes]
      .sort((left, right) => compareStable(left.node_id, right.node_id))
      .map((node) => ({
        ...node,
        aliases: uniqueSorted(node.aliases),
        evidence_refs: uniqueSorted(node.evidence_refs),
        tags: uniqueSorted(node.tags),
      })),
    edges: [...graph.edges]
      .sort((left, right) => compareStable(left.edge_id, right.edge_id))
      .map((edge) => ({ ...edge, evidence_refs: uniqueSorted(edge.evidence_refs) })),
  });
}

export async function computeSemanticGraphDigest(input: unknown): Promise<`sha256:${string}`> {
  return sha256ContentHash(canonicalizeSemanticGraph(input));
}

export interface PhysicalOntologyMaterialization {
  readonly evidence: readonly SemanticEvidence[];
  readonly nodes: readonly SemanticGraphNode[];
  readonly edges: readonly SemanticGraphEdge[];
}

function physicalRelationKey(schemaName: string, relationName: string): string {
  return `${schemaName}\u0000${relationName}`;
}

async function physicalEntryId(prefix: string, locator: unknown): Promise<string> {
  const digest = await sha256ContentHash(locator);
  return `${prefix}-${digest.slice("sha256:".length, "sha256:".length + 32)}`;
}

function semanticDataType(
  formattedType: string,
): Extract<SemanticGraphNode, { node_type: "PHYSICAL_COLUMN" }>["data_type"] {
  const type = formattedType.trim().toLocaleLowerCase();
  if (/^(?:bool|boolean)$/.test(type)) return "boolean";
  if (/^date$/.test(type)) return "date";
  if (/^(?:smallint|integer|bigint|int2|int4|int8)$/.test(type)) return "integer";
  if (/^(?:numeric|decimal|real|double precision|money)(?:\(|$)/.test(type)) return "numeric";
  if (/^uuid$/.test(type)) return "uuid";
  if (/^(?:timestamp with time zone|timestamptz)(?:\(|$)/.test(type)) return "timestamptz";
  if (/^(?:timestamp without time zone|timestamp)(?:\(|$)/.test(type)) return "timestamp";
  return "text";
}

function semanticRelationKind(
  relationKind: PhysicalSchemaSnapshot["content"]["relations"][number]["relation_kind"],
): Extract<SemanticGraphNode, { node_type: "PHYSICAL_TABLE" }>["relation_kind"] {
  if (relationKind === "VIEW") return "VIEW";
  if (relationKind === "MATERIALIZED_VIEW") return "MATERIALIZED_VIEW";
  return "TABLE";
}

/**
 * Materializes only schema-authoritative facts. It intentionally does not turn an FK into
 * RELATES_TO or JOINABLE_VIA: business meaning and analytical join safety remain separate,
 * Agent-authored candidates that must carry their own evidence.
 */
export async function materializePhysicalOntology(
  snapshotInput: unknown,
  ownerRef: string,
): Promise<PhysicalOntologyMaterialization> {
  const snapshot = physicalSchemaSnapshotSchema.parse(snapshotInput);
  const snapshotEvidenceId = `evidence-schema-${snapshot.snapshot_id}`;
  const evidence: SemanticEvidence[] = [
    semanticEvidenceSchema.parse({
      evidence_id: snapshotEvidenceId,
      kind: "SCHEMA_SNAPSHOT",
      content_hash: snapshot.snapshot_content_hash,
      description: `PostgreSQL schema snapshot ${snapshot.snapshot_id}`,
    }),
  ];
  const nodes: SemanticGraphNode[] = [];
  const edges: SemanticGraphEdge[] = [];
  const tableIdByKey = new Map<string, string>();
  const columnIdByKey = new Map<string, string>();
  const relations = [...snapshot.content.relations].sort((left, right) =>
    physicalRelationKey(left.identity.schema_name, left.identity.relation_name).localeCompare(
      physicalRelationKey(right.identity.schema_name, right.identity.relation_name),
    ),
  );

  for (const relation of relations) {
    const relationLocator = {
      datasource_id: snapshot.content.datasource_id,
      schema_name: relation.identity.schema_name,
      table_name: relation.identity.relation_name,
    };
    const tableId = await physicalEntryId("physical-table", relationLocator);
    const tableKey = physicalRelationKey(
      relation.identity.schema_name,
      relation.identity.relation_name,
    );
    tableIdByKey.set(tableKey, tableId);
    nodes.push(
      semanticGraphNodeSchema.parse({
        node_id: tableId,
        node_version: 1,
        node_type: "PHYSICAL_TABLE",
        name: `${relation.identity.schema_name}.${relation.identity.relation_name}`,
        ...(relation.comment === null ? {} : { description: relation.comment }),
        aliases: [],
        owner_ref: ownerRef,
        lifecycle: "ACTIVE",
        evidence_refs: [snapshotEvidenceId],
        tags: ["schema-snapshot"],
        schema_snapshot_id: snapshot.snapshot_id,
        snapshot_content_hash: snapshot.snapshot_content_hash,
        datasource_id: snapshot.content.datasource_id,
        schema_name: relation.identity.schema_name,
        table_name: relation.identity.relation_name,
        relation_kind: semanticRelationKind(relation.relation_kind),
      }),
    );

    for (const column of [...relation.columns].sort(
      (left, right) =>
        left.ordinal_position - right.ordinal_position ||
        left.column_name.localeCompare(right.column_name),
    )) {
      const columnLocator = { ...relationLocator, column_name: column.column_name };
      const columnId = await physicalEntryId("physical-column", columnLocator);
      columnIdByKey.set(`${tableKey}\u0000${column.column_name}`, columnId);
      nodes.push(
        semanticGraphNodeSchema.parse({
          node_id: columnId,
          node_version: 1,
          node_type: "PHYSICAL_COLUMN",
          name: `${relation.identity.schema_name}.${relation.identity.relation_name}.${column.column_name}`,
          ...(column.comment === null ? {} : { description: column.comment }),
          aliases: [],
          owner_ref: ownerRef,
          lifecycle: "ACTIVE",
          evidence_refs: [snapshotEvidenceId],
          tags: ["schema-snapshot"],
          schema_snapshot_id: snapshot.snapshot_id,
          snapshot_content_hash: snapshot.snapshot_content_hash,
          datasource_id: snapshot.content.datasource_id,
          schema_name: relation.identity.schema_name,
          table_name: relation.identity.relation_name,
          column_name: column.column_name,
          ordinal: column.ordinal_position,
          formatted_type: column.formatted_type,
          data_type: semanticDataType(column.formatted_type),
          nullable: column.nullable,
          sensitivity: "PUBLIC",
        }),
      );
      edges.push(
        semanticGraphEdgeSchema.parse({
          edge_id: await physicalEntryId("contains-column", columnLocator),
          edge_version: 1,
          edge_type: "CONTAINS_COLUMN",
          family: "PHYSICAL",
          source_node_id: tableId,
          target_node_id: columnId,
          lifecycle: "ACTIVE",
          attributes: {
            kind: "PHYSICAL_FACT",
            schema_snapshot_id: snapshot.snapshot_id,
            snapshot_content_hash: snapshot.snapshot_content_hash,
            fact_kind: "CONTAINS_COLUMN",
          },
          evidence_refs: [snapshotEvidenceId],
        }),
      );
    }
  }

  for (const relation of relations) {
    const sourceTableKey = physicalRelationKey(
      relation.identity.schema_name,
      relation.identity.relation_name,
    );
    for (const foreignKey of [...relation.foreign_keys].sort((left, right) =>
      left.constraint_name.localeCompare(right.constraint_name),
    )) {
      const targetTableKey = physicalRelationKey(
        foreignKey.referenced_relation.schema_name,
        foreignKey.referenced_relation.relation_name,
      );
      if (!tableIdByKey.has(targetTableKey)) {
        throw new Error(`PHYSICAL_ONTOLOGY_FK_TARGET_MISSING:${targetTableKey}`);
      }
      const fkDigest = await sha256ContentHash({
        source_relation: relation.identity,
        foreign_key: foreignKey,
      });
      const fkEvidenceId = `evidence-fk-${fkDigest.slice("sha256:".length, "sha256:".length + 32)}`;
      evidence.push(
        semanticEvidenceSchema.parse({
          evidence_id: fkEvidenceId,
          kind: "DDL_CONSTRAINT",
          content_hash: fkDigest,
          description: `${sourceTableKey}.${foreignKey.constraint_name}`,
        }),
      );
      for (const pair of [...foreignKey.column_pairs].sort((left, right) =>
        left.column_name.localeCompare(right.column_name),
      )) {
        const sourceColumnId = columnIdByKey.get(`${sourceTableKey}\u0000${pair.column_name}`);
        const targetColumnId = columnIdByKey.get(
          `${targetTableKey}\u0000${pair.referenced_column_name}`,
        );
        if (sourceColumnId === undefined || targetColumnId === undefined) {
          throw new Error(`PHYSICAL_ONTOLOGY_FK_COLUMN_MISSING:${foreignKey.constraint_name}`);
        }
        edges.push(
          semanticGraphEdgeSchema.parse({
            edge_id: await physicalEntryId("foreign-key", {
              source_column_id: sourceColumnId,
              target_column_id: targetColumnId,
              constraint_name: foreignKey.constraint_name,
            }),
            edge_version: 1,
            edge_type: "FOREIGN_KEY_TO",
            family: "PHYSICAL",
            source_node_id: sourceColumnId,
            target_node_id: targetColumnId,
            lifecycle: "ACTIVE",
            attributes: {
              kind: "PHYSICAL_FACT",
              schema_snapshot_id: snapshot.snapshot_id,
              snapshot_content_hash: snapshot.snapshot_content_hash,
              fact_kind: "FOREIGN_KEY",
            },
            evidence_refs: [snapshotEvidenceId, fkEvidenceId],
          }),
        );
      }
    }
  }

  return deepFreeze({
    evidence: evidence.sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
    nodes: nodes.sort((left, right) => left.node_id.localeCompare(right.node_id)),
    edges: edges.sort((left, right) => left.edge_id.localeCompare(right.edge_id)),
  });
}
