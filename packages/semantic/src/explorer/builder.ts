import {
  computeSemanticExplorerSidecarDigest,
  deepFreeze,
  type Grain,
  type SemanticExplorerBinding,
  type SemanticExplorerCounts,
  type SemanticExplorerEdge,
  type SemanticExplorerObject,
  type SemanticExplorerObjectIdentity,
  type SemanticExplorerReleaseIdentity,
  type SemanticExplorerSidecar,
  type SemanticExplorerSnapshot,
  semanticExplorerRawSourceEnvelopeSchema,
  semanticExplorerSnapshotSchema,
  sha256ContentHash,
  type TimeDomain,
  type Unit,
} from "@data-agent/contracts";
import { ZodError } from "zod";
import { explorerFailure, SemanticExplorerKernelError } from "./errors.js";
import {
  type ExplorerExecutablePayload,
  type ExplorerLoweredAuthRule,
  type ExplorerRelationshipPayload,
  type ExplorerRestrictionPayload,
  explorerExecutablePayloadSchema,
  explorerRelationshipPayloadSchema,
  explorerRestrictionPayloadSchema,
} from "./projection-schemas.js";

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function semanticExplorerIdentityKey(identity: SemanticExplorerObjectIdentity): string {
  return JSON.stringify([identity.kind, identity.object_id]);
}

function edgeIdentityKey(edge: Pick<SemanticExplorerEdge, "kind" | "edge_id">): string {
  return JSON.stringify([edge.kind, edge.edge_id]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort(compareStable);
  const sortedRight = [...right].sort(compareStable);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function normalizeDescription(value: string | undefined): string | null {
  return value ?? null;
}

function normalizeGrain(grain: Grain) {
  return { ...grain, description: grain.description ?? null };
}

function normalizeUnit(unit: Unit | null) {
  return unit === null ? null : { ...unit, description: unit.description ?? null };
}

function normalizeTimeDomain(timeDomain: TimeDomain | null) {
  return timeDomain === null
    ? null
    : { ...timeDomain, description: timeDomain.description ?? null };
}

function referenceMatchesColumn(reference: string, column: string): boolean {
  return (
    reference === column || reference.endsWith(`.${column}`) || column.endsWith(`.${reference}`)
  );
}

function ruleMatches(
  rule: ExplorerLoweredAuthRule,
  tableId: string,
  columnIds: readonly string[],
): boolean {
  if (rule.tableId !== tableId) return false;
  if (rule.columnIds.some((column) => column === "*" || column === `${tableId}.*`)) return true;
  return columnIds.some((column) =>
    rule.columnIds.some((ruleColumn) => referenceMatchesColumn(ruleColumn, column)),
  );
}

function authState(
  rules: readonly ExplorerLoweredAuthRule[],
  tableId: string,
  columnIds: readonly string[],
): { readonly denied: boolean; readonly restricted: boolean } {
  return {
    denied: rules.some((rule) => rule.action === "DENY" && ruleMatches(rule, tableId, columnIds)),
    restricted: rules.some(
      (rule) => rule.action === "RESTRICT" && ruleMatches(rule, tableId, columnIds),
    ),
  };
}

type SidecarBinding = NonNullable<SemanticExplorerSidecar["physical_binding"]>["entries"][number];
type SidecarCatalogTable = NonNullable<
  SemanticExplorerSidecar["catalog_governance"]
>["tables"][number];

interface ExplorerBindingIndexes {
  readonly bindingsByObject: ReadonlyMap<string, readonly SidecarBinding[]>;
  readonly catalogTablesByName: ReadonlyMap<string, readonly SidecarCatalogTable[]>;
  readonly catalogColumnIdsByTableAndReference: ReadonlyMap<
    string,
    ReadonlyMap<string, string | null>
  >;
  readonly hasCatalog: boolean;
}

function bindingObjectKey(
  logicalObjectType: "metric" | "dimension" | "relationship",
  logicalObjectId: string,
): string {
  return JSON.stringify([logicalObjectType, logicalObjectId]);
}

function buildBindingIndexes(sidecar: SemanticExplorerSidecar | undefined): ExplorerBindingIndexes {
  const bindingsByObject = new Map<string, SidecarBinding[]>();
  for (const entry of sidecar?.physical_binding?.entries ?? []) {
    if (
      entry.logical_object_type !== "metric" &&
      entry.logical_object_type !== "dimension" &&
      entry.logical_object_type !== "relationship"
    ) {
      continue;
    }
    const key = bindingObjectKey(entry.logical_object_type, entry.logical_object_id);
    const bucket = bindingsByObject.get(key) ?? [];
    bucket.push(entry);
    bindingsByObject.set(key, bucket);
  }
  const catalogTablesByName = new Map<string, SidecarCatalogTable[]>();
  const catalogColumnIdsByTableAndReference = new Map<string, Map<string, string | null>>();
  for (const table of sidecar?.catalog_governance?.tables ?? []) {
    const bucket = catalogTablesByName.get(table.table_name) ?? [];
    bucket.push(table);
    catalogTablesByName.set(table.table_name, bucket);
    const columnReferences = new Map<string, string | null>();
    for (const column of table.columns) {
      const references = new Set([
        column.column_id,
        column.column_id.split(".").at(-1) ?? column.column_id,
      ]);
      for (const reference of references) {
        const existing = columnReferences.get(reference);
        columnReferences.set(
          reference,
          existing === undefined || existing === column.column_id ? column.column_id : null,
        );
      }
    }
    catalogColumnIdsByTableAndReference.set(table.table_id, columnReferences);
  }
  return {
    bindingsByObject,
    catalogTablesByName,
    catalogColumnIdsByTableAndReference,
    hasCatalog: sidecar?.catalog_governance !== null && sidecar?.catalog_governance !== undefined,
  };
}

function bindingTableIdentity(
  indexes: ExplorerBindingIndexes,
  binding: { readonly table_name: string },
): string | null {
  if (!indexes.hasCatalog) return binding.table_name;
  const matchingTables = indexes.catalogTablesByName.get(binding.table_name) ?? [];
  return matchingTables.length === 1 ? (matchingTables[0]?.table_id ?? null) : null;
}

function bindingColumnIdentities(
  indexes: ExplorerBindingIndexes,
  tableId: string,
  columnName: string | null,
): readonly string[] {
  if (columnName === null) return [];
  const catalogColumnId = indexes.catalogColumnIdsByTableAndReference.get(tableId)?.get(columnName);
  return catalogColumnId ? [catalogColumnId] : [columnName];
}

function visibleBindingsFor(
  sidecar: SemanticExplorerSidecar | undefined,
  indexes: ExplorerBindingIndexes,
  rules: readonly ExplorerLoweredAuthRule[],
  logicalObjectId: string,
  logicalObjectType: "metric" | "dimension" | "relationship",
): readonly SemanticExplorerBinding[] {
  if (!sidecar?.physical_binding) return [];
  return (indexes.bindingsByObject.get(bindingObjectKey(logicalObjectType, logicalObjectId)) ?? [])
    .filter(
      (entry) => entry.binding_lifecycle === "active" || entry.binding_lifecycle === "deprecated",
    )
    .filter((entry) => {
      const tableId = bindingTableIdentity(indexes, entry);
      if (tableId === null) return false;
      const columns = bindingColumnIdentities(indexes, tableId, entry.column_name);
      if (columns.length === 0) {
        return !rules.some((rule) => rule.tableId === tableId && rule.action === "DENY");
      }
      return !authState(rules, tableId, columns).denied;
    })
    .map((entry) => ({
      datasource_id: entry.datasource_id,
      schema_name: entry.schema_name,
      table_name: entry.table_name,
      column_name: entry.column_name,
      lifecycle: entry.binding_lifecycle as "active" | "deprecated",
      valid_from: entry.valid_from,
      valid_until: entry.valid_until,
    }))
    .sort((left, right) =>
      compareStable(
        JSON.stringify([left.datasource_id, left.schema_name, left.table_name, left.column_name]),
        JSON.stringify([
          right.datasource_id,
          right.schema_name,
          right.table_name,
          right.column_name,
        ]),
      ),
    );
}

async function finalizeObject(
  material: Omit<SemanticExplorerObject, "canonical_digest">,
): Promise<SemanticExplorerObject> {
  return {
    ...material,
    canonical_digest: await sha256ContentHash(material),
  } as SemanticExplorerObject;
}

async function finalizeEdge(
  material: Omit<SemanticExplorerEdge, "edge_id" | "canonical_digest">,
): Promise<SemanticExplorerEdge> {
  const canonicalDigest = await sha256ContentHash(material);
  return {
    ...material,
    edge_id: canonicalDigest,
    canonical_digest: canonicalDigest,
  } as SemanticExplorerEdge;
}

function validateEnvelopeBindings(
  envelope: ReturnType<typeof semanticExplorerRawSourceEnvelopeSchema.parse>,
): void {
  const { pointer, release } = envelope;
  if (
    (pointer.current_release_id === null &&
      (pointer.current_release_generation !== 0 || pointer.current_release_digest !== null)) ||
    (pointer.current_release_id !== null &&
      (pointer.current_release_generation < 1 || pointer.current_release_digest === null))
  ) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
  if (pointer.semantic_domain !== release.semantic_domain) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
  if (
    envelope.source_kind === "ACTIVE" &&
    (pointer.current_release_id !== release.release_id ||
      pointer.current_release_generation !== release.release_generation ||
      pointer.current_release_digest !== release.release_digest)
  ) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }

  const bindings = [
    {
      row: envelope.executable_projection,
      releaseRef: release.executable_projection_ref,
      releaseDigest: release.executable_projection_hash,
    },
    {
      row: envelope.relationship_projection,
      releaseRef: release.relationship_projection_ref,
      releaseDigest: release.relationship_projection_hash,
    },
    {
      row: envelope.runtime_restriction_projection,
      releaseRef: release.runtime_restriction_projection_ref,
      releaseDigest: release.runtime_restriction_projection_hash,
    },
  ];
  if (
    bindings.some(
      ({ row, releaseRef, releaseDigest }) =>
        row.release_id !== release.release_id ||
        row.projection_id !== releaseRef ||
        row.projection_digest !== releaseDigest,
    )
  ) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
  if (
    envelope.source_kind === "ACTIVE" &&
    envelope.runtime_restriction_projection.pointer_generation !== pointer.pointer_generation
  ) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
}

function parsePayloads(
  envelope: ReturnType<typeof semanticExplorerRawSourceEnvelopeSchema.parse>,
): {
  readonly executable: ExplorerExecutablePayload;
  readonly relationship: ExplorerRelationshipPayload;
  readonly restriction: ExplorerRestrictionPayload;
} {
  try {
    return {
      executable: explorerExecutablePayloadSchema.parse(
        envelope.executable_projection.projection_payload,
      ),
      relationship: explorerRelationshipPayloadSchema.parse(
        envelope.relationship_projection.projection_payload,
      ),
      restriction: explorerRestrictionPayloadSchema.parse(
        envelope.runtime_restriction_projection.projection_payload,
      ),
    };
  } catch {
    explorerFailure("SEMANTIC_EXPLORER_PROJECTION_PAYLOAD_INVALID");
  }
}

async function validatePayloadBindings(
  rawPayloads: {
    readonly executable: unknown;
    readonly relationship: unknown;
    readonly restriction: unknown;
  },
  projectionDigests: {
    readonly executable: string;
    readonly relationship: string;
    readonly restriction: string;
  },
  releaseCompilerDigest: string,
  executable: ExplorerExecutablePayload,
  relationship: ExplorerRelationshipPayload,
  restriction: ExplorerRestrictionPayload,
): Promise<void> {
  if (
    executable.sourceDigest !== releaseCompilerDigest ||
    relationship.sourceDigest !== releaseCompilerDigest ||
    restriction.sourceDigest !== releaseCompilerDigest
  ) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
  if (restriction.lowered.status !== "LOWERED") {
    explorerFailure("SEMANTIC_EXPLORER_PROJECTION_PAYLOAD_INVALID");
  }

  const sidecar = executable.explorer_sidecar;
  if (sidecar) {
    const { sidecar_digest: _digest, ...material } = sidecar;
    if ((await computeSemanticExplorerSidecarDigest(material)) !== sidecar.sidecar_digest) {
      explorerFailure("SEMANTIC_EXPLORER_SIDECAR_DIGEST_MISMATCH");
    }
    if (
      !sameStringSet(
        executable.formulas,
        sidecar.formula_signatures.map((item) => item.formula_id),
      )
    ) {
      explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
    }
    if (sidecar.relationships.length !== relationship.edges.length) {
      explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
    }
    for (const semanticRelationship of sidecar.relationships) {
      const edge = relationship.edges.find(
        (candidate) => candidate.relationshipId === semanticRelationship.relationship_id,
      );
      if (
        !edge ||
        edge.leftTableId !== semanticRelationship.left_table_id ||
        !sameStringSet(edge.leftColumnIds, semanticRelationship.left_column_ids) ||
        edge.rightTableId !== semanticRelationship.right_table_id ||
        !sameStringSet(edge.rightColumnIds, semanticRelationship.right_column_ids) ||
        edge.cardinality !== semanticRelationship.cardinality ||
        edge.proofKind !== semanticRelationship.proof_kind ||
        edge.proofDetail !== semanticRelationship.proof_detail
      ) {
        explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
      }
    }
  }
  if (
    (await sha256ContentHash(rawPayloads.executable)) !== projectionDigests.executable ||
    (await sha256ContentHash(rawPayloads.relationship)) !== projectionDigests.relationship ||
    (await sha256ContentHash(rawPayloads.restriction)) !== projectionDigests.restriction
  ) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
}

function releaseIdentity(
  envelope: ReturnType<typeof semanticExplorerRawSourceEnvelopeSchema.parse>,
): SemanticExplorerReleaseIdentity {
  return {
    semantic_domain: envelope.release.semantic_domain,
    release_id: envelope.release.release_id,
    release_generation: envelope.release.release_generation,
    release_digest: envelope.release.release_digest,
    executable_projection: {
      projection_id: envelope.executable_projection.projection_id,
      projection_digest: envelope.executable_projection.projection_digest,
    },
    relationship_projection: {
      projection_id: envelope.relationship_projection.projection_id,
      projection_digest: envelope.relationship_projection.projection_digest,
    },
    runtime_restriction_projection: {
      projection_id: envelope.runtime_restriction_projection.projection_id,
      projection_digest: envelope.runtime_restriction_projection.projection_digest,
    },
    published_at: envelope.release.published_at,
    published_by: envelope.release.published_by,
  };
}

async function buildObjects(
  executable: ExplorerExecutablePayload,
  relationship: ExplorerRelationshipPayload,
  restriction: ExplorerRestrictionPayload,
): Promise<readonly SemanticExplorerObject[]> {
  const rules = restriction.lowered.loweredRules;
  const sidecar = executable.explorer_sidecar;
  const bindingIndexes = buildBindingIndexes(sidecar);
  const objectMaterials: Omit<SemanticExplorerObject, "canonical_digest">[] = [];
  const seen = new Set<string>();
  const add = (material: Omit<SemanticExplorerObject, "canonical_digest">) => {
    const key = semanticExplorerIdentityKey(material.identity);
    if (seen.has(key)) explorerFailure("SEMANTIC_EXPLORER_DUPLICATE_IDENTITY");
    seen.add(key);
    objectMaterials.push(material);
  };

  for (const metric of executable.metrics) {
    const columns = [
      metric.column_id,
      ...metric.dependency_column_ids,
      ...(metric.time_column_id === null ? [] : [metric.time_column_id]),
    ];
    const state = authState(rules, metric.table_id, columns);
    if (state.denied) continue;
    add({
      identity: { kind: "metric", object_id: metric.metric_id },
      status: "published",
      name: metric.name,
      description: normalizeDescription(metric.description),
      aliases: [...metric.aliases].sort(compareStable),
      owner: null,
      restricted: state.restricted,
      payload: {
        kind: "metric",
        table_id: metric.table_id,
        column_id: metric.column_id,
        aggregation: metric.aggregation,
        formula:
          metric.formula === null
            ? null
            : {
                ...metric.formula,
                description: normalizeDescription(metric.formula.description),
              },
        grain: normalizeGrain(metric.grain),
        unit: normalizeUnit(metric.unit),
        time_domain: normalizeTimeDomain(metric.time_domain),
        time_column_id: metric.time_column_id,
        additivity: metric.additivity,
        null_policy: metric.null_policy,
        fanout_policy: metric.fanout_policy,
        dependency_column_ids: [...metric.dependency_column_ids].sort(compareStable),
        tags: [...metric.tags].sort(compareStable),
        bindings: [
          ...visibleBindingsFor(sidecar, bindingIndexes, rules, metric.metric_id, "metric"),
        ],
      },
    });
  }

  for (const dimension of executable.dimensions) {
    const state = authState(rules, dimension.table_id, [dimension.column_id]);
    if (state.denied) continue;
    add({
      identity: { kind: "dimension", object_id: dimension.dimension_id },
      status: "published",
      name: dimension.name,
      description: normalizeDescription(dimension.description),
      aliases: [...dimension.aliases].sort(compareStable),
      owner: null,
      restricted: state.restricted,
      payload: {
        kind: "dimension",
        table_id: dimension.table_id,
        column_id: dimension.column_id,
        grain: normalizeGrain(dimension.grain),
        data_type: dimension.data_type,
        sensitivity: dimension.sensitivity,
        hierarchical: dimension.hierarchical,
        parent_dimension_id: dimension.parent_dimension_id,
        tags: [...dimension.tags].sort(compareStable),
        bindings: [
          ...visibleBindingsFor(
            sidecar,
            bindingIndexes,
            rules,
            dimension.dimension_id,
            "dimension",
          ),
        ],
      },
    });
  }

  const sidecarRelationships = new Map(
    sidecar?.relationships.map((item) => [item.relationship_id, item]) ?? [],
  );
  for (const edge of relationship.edges) {
    const state = {
      denied:
        authState(rules, edge.leftTableId, edge.leftColumnIds).denied ||
        authState(rules, edge.rightTableId, edge.rightColumnIds).denied,
      restricted:
        authState(rules, edge.leftTableId, edge.leftColumnIds).restricted ||
        authState(rules, edge.rightTableId, edge.rightColumnIds).restricted,
    };
    if (state.denied) continue;
    const source = sidecarRelationships.get(edge.relationshipId);
    add({
      identity: { kind: "relationship", object_id: edge.relationshipId },
      status: "published",
      name: source?.name ?? edge.relationshipId,
      description: source ? normalizeDescription(source.description) : edge.proofDetail,
      aliases: [],
      owner: null,
      restricted: state.restricted,
      payload: {
        kind: "relationship",
        relationship_kind: source?.kind ?? null,
        left: { table_id: edge.leftTableId, column_ids: [...edge.leftColumnIds] },
        right: { table_id: edge.rightTableId, column_ids: [...edge.rightColumnIds] },
        cardinality: edge.cardinality,
        direction: edge.direction,
        row_preservation: edge.rowPreservation,
        fanout_grain_proof: edge.fanoutGrainProof,
        proof_kind: edge.proofKind,
        proof_detail: edge.proofDetail,
        bindings: [
          ...visibleBindingsFor(
            sidecar,
            bindingIndexes,
            rules,
            edge.relationshipId,
            "relationship",
          ),
        ],
      },
    });
  }

  if (sidecar?.business_ontology) {
    for (const entity of sidecar.business_ontology.entities) {
      if (entity.lifecycle === "archived") continue;
      add({
        identity: { kind: "business_entity", object_id: entity.entity_id },
        status: entity.lifecycle === "deprecated" ? "deprecated" : "published",
        name: entity.name,
        description: normalizeDescription(entity.description),
        aliases: [...entity.aliases].sort(compareStable),
        owner: entity.owner,
        restricted: false,
        payload: {
          kind: "business_entity",
          domain: entity.domain,
          business_relationship_types: entity.business_relationship_types.map((item) => ({
            ...item,
            description: normalizeDescription(item.description),
          })),
        },
      });
    }
    for (const event of sidecar.business_ontology.events) {
      add({
        identity: { kind: "business_event", object_id: event.event_id },
        status: "published",
        name: event.name,
        description: normalizeDescription(event.description),
        aliases: [],
        owner: sidecar.business_ontology.owner,
        restricted: false,
        payload: {
          kind: "business_event",
          domain: event.domain,
          subject_entity_id: event.subject_entity_id,
          event_type: event.event_type,
        },
      });
    }
    for (const term of sidecar.business_ontology.terms) {
      add({
        identity: { kind: "business_term", object_id: term.term_id },
        status: "published",
        name: term.name,
        description: term.definition,
        aliases: [...term.aliases].sort(compareStable),
        owner: sidecar.business_ontology.owner,
        restricted: false,
        payload: {
          kind: "business_term",
          domain: term.domain,
          definition: term.definition,
        },
      });
    }
  }

  if (sidecar?.physical_binding) {
    const bindingsByDatasource = new Map<string, SemanticExplorerBinding[]>();
    for (const object of objectMaterials) {
      if (
        object.payload.kind !== "metric" &&
        object.payload.kind !== "dimension" &&
        object.payload.kind !== "relationship"
      ) {
        continue;
      }
      for (const binding of object.payload.bindings) {
        const current = bindingsByDatasource.get(binding.datasource_id) ?? [];
        current.push(binding);
        bindingsByDatasource.set(binding.datasource_id, current);
      }
    }
    for (const [datasourceId, bindings] of bindingsByDatasource) {
      const uniqueBindings = [
        ...new Map(
          bindings.map((binding) => [
            JSON.stringify([
              binding.schema_name,
              binding.table_name,
              binding.column_name,
              binding.lifecycle,
            ]),
            binding,
          ]),
        ).values(),
      ].sort((left, right) =>
        compareStable(
          JSON.stringify([left.schema_name, left.table_name, left.column_name]),
          JSON.stringify([right.schema_name, right.table_name, right.column_name]),
        ),
      );
      const catalogTables = sidecar.catalog_governance?.tables
        .filter((table) =>
          uniqueBindings.some((binding) => binding.table_name === table.table_name),
        )
        .map((table) => ({
          ...table,
          columns: table.columns.filter(
            (column) => !authState(rules, table.table_id, [column.column_id]).denied,
          ),
        }))
        .filter((table) => table.columns.length > 0);
      const snapshots =
        catalogTables
          ?.map((table) => table.snapshot_currentness.snapshot_timestamp)
          .filter((value): value is string => value !== null)
          .sort(compareStable) ?? [];
      add({
        identity: { kind: "datasource", object_id: datasourceId },
        status: uniqueBindings.every((binding) => binding.lifecycle === "deprecated")
          ? "deprecated"
          : "published",
        name: datasourceId,
        description: null,
        aliases: [],
        owner: null,
        restricted: objectMaterials.some(
          (object) =>
            object.restricted &&
            (object.payload.kind === "metric" ||
              object.payload.kind === "dimension" ||
              object.payload.kind === "relationship") &&
            object.payload.bindings.some((binding) => binding.datasource_id === datasourceId),
        ),
        payload: {
          kind: "datasource",
          bindings: uniqueBindings.map((binding) => ({
            schema_name: binding.schema_name,
            table_name: binding.table_name,
            column_name: binding.column_name,
            lifecycle: binding.lifecycle,
          })),
          catalog: catalogTables
            ? {
                table_count: catalogTables.length,
                column_count: catalogTables.reduce((sum, table) => sum + table.columns.length, 0),
                newest_snapshot_at: snapshots.at(-1) ?? null,
              }
            : null,
        },
      });
    }
  }

  const objects: SemanticExplorerObject[] = [];
  const batchSize = 1_024;
  for (let offset = 0; offset < objectMaterials.length; offset += batchSize) {
    objects.push(
      ...(await Promise.all(
        objectMaterials
          .slice(offset, offset + batchSize)
          .map((material) => finalizeObject(material)),
      )),
    );
  }
  return objects.sort((left, right) =>
    compareStable(
      JSON.stringify([left.identity.kind, left.identity.object_id]),
      JSON.stringify([right.identity.kind, right.identity.object_id]),
    ),
  );
}

async function buildEdges(
  objects: readonly SemanticExplorerObject[],
  executable: ExplorerExecutablePayload,
  relationship: ExplorerRelationshipPayload,
): Promise<readonly SemanticExplorerEdge[]> {
  const objectMap = new Map(
    objects.map((object) => [semanticExplorerIdentityKey(object.identity), object]),
  );
  const edges: SemanticExplorerEdge[] = [];
  const seen = new Set<string>();
  const add = async (material: Omit<SemanticExplorerEdge, "edge_id" | "canonical_digest">) => {
    const sourceVisible = objectMap.has(semanticExplorerIdentityKey(material.source));
    const targetVisible = objectMap.has(semanticExplorerIdentityKey(material.target));
    if (!sourceVisible || !targetVisible) return;
    const edge = await finalizeEdge(material);
    const key = edgeIdentityKey(edge);
    if (seen.has(key)) explorerFailure("SEMANTIC_EXPLORER_DUPLICATE_IDENTITY");
    seen.add(key);
    edges.push(edge);
  };

  const metricsByFormulaId = new Map<string, SemanticExplorerObjectIdentity[]>();
  for (const metric of executable.metrics) {
    if (metric.formula) {
      const current = metricsByFormulaId.get(metric.formula.formula_id) ?? [];
      current.push({
        kind: "metric",
        object_id: metric.metric_id,
      });
      metricsByFormulaId.set(metric.formula.formula_id, current);
    }
  }
  const releasedFormulaIds = new Set(
    (executable.explorer_sidecar?.formula_signatures ?? []).map((formula) => formula.formula_id),
  );
  for (const formula of executable.explorer_sidecar?.formula_signatures ?? []) {
    const sources = metricsByFormulaId.get(formula.formula_id) ?? [];
    for (const dependencyId of formula.dependency_formula_ids) {
      if (!releasedFormulaIds.has(dependencyId)) {
        explorerFailure("SEMANTIC_EXPLORER_DANGLING_EDGE");
      }
      const targets = metricsByFormulaId.get(dependencyId) ?? [];
      for (const source of sources) {
        for (const target of targets) {
          await add({
            kind: "metric_dependency",
            source,
            target,
            payload: { kind: "metric_dependency", formula_id: formula.formula_id },
          });
        }
      }
    }
  }

  const dimensionIds = new Set(executable.dimensions.map((dimension) => dimension.dimension_id));
  for (const dimension of executable.dimensions) {
    if (dimension.parent_dimension_id === null) continue;
    if (!dimensionIds.has(dimension.parent_dimension_id)) {
      explorerFailure("SEMANTIC_EXPLORER_DANGLING_EDGE");
    }
    await add({
      kind: "dimension_hierarchy",
      source: { kind: "dimension", object_id: dimension.dimension_id },
      target: { kind: "dimension", object_id: dimension.parent_dimension_id },
      payload: { kind: "dimension_hierarchy" },
    });
  }

  const navigableObjects = objects.filter(
    (object) => object.payload.kind === "metric" || object.payload.kind === "dimension",
  );
  for (const relation of relationship.edges) {
    const relationshipIdentity = {
      kind: "relationship" as const,
      object_id: relation.relationshipId,
    };
    const sidecarRelationship = executable.explorer_sidecar?.relationships.find(
      (candidate) => candidate.relationship_id === relation.relationshipId,
    );
    if (sidecarRelationship && sidecarRelationship.kind !== "analytical") continue;
    for (const object of navigableObjects) {
      if (object.payload.kind !== "metric" && object.payload.kind !== "dimension") {
        continue;
      }
      if (
        object.payload.table_id !== relation.leftTableId &&
        object.payload.table_id !== relation.rightTableId
      ) {
        continue;
      }
      await add({
        kind: "analytical_relationship",
        source: relationshipIdentity,
        target: object.identity,
        payload: {
          kind: "analytical_relationship",
          relationship_id: relation.relationshipId,
        },
      });
    }
  }

  for (const entity of executable.explorer_sidecar?.business_ontology?.entities ?? []) {
    for (const businessRelationship of entity.business_relationship_types) {
      await add({
        kind: "business_relationship",
        source: { kind: "business_entity", object_id: entity.entity_id },
        target: {
          kind: "business_entity",
          object_id: businessRelationship.target_entity_id,
        },
        payload: {
          kind: "business_relationship",
          relationship_type: businessRelationship.relationship_type,
        },
      });
    }
  }

  for (const object of objects) {
    if (
      object.payload.kind !== "metric" &&
      object.payload.kind !== "dimension" &&
      object.payload.kind !== "relationship"
    ) {
      continue;
    }
    for (const binding of object.payload.bindings) {
      await add({
        kind: "physical_binding",
        source: object.identity,
        target: { kind: "datasource", object_id: binding.datasource_id },
        payload: { kind: "physical_binding", datasource_id: binding.datasource_id },
      });
    }
  }

  return edges.sort((left, right) =>
    compareStable(
      JSON.stringify([left.kind, left.edge_id]),
      JSON.stringify([right.kind, right.edge_id]),
    ),
  );
}

function countSnapshot(
  objects: readonly SemanticExplorerObject[],
  edges: readonly SemanticExplorerEdge[],
): SemanticExplorerCounts {
  return {
    total_objects: objects.length,
    by_object_kind: {
      business_entity: objects.filter((object) => object.identity.kind === "business_entity")
        .length,
      business_event: objects.filter((object) => object.identity.kind === "business_event").length,
      business_term: objects.filter((object) => object.identity.kind === "business_term").length,
      metric: objects.filter((object) => object.identity.kind === "metric").length,
      dimension: objects.filter((object) => object.identity.kind === "dimension").length,
      relationship: objects.filter((object) => object.identity.kind === "relationship").length,
      datasource: objects.filter((object) => object.identity.kind === "datasource").length,
    },
    total_edges: edges.length,
    by_edge_kind: {
      metric_dependency: edges.filter((edge) => edge.kind === "metric_dependency").length,
      dimension_hierarchy: edges.filter((edge) => edge.kind === "dimension_hierarchy").length,
      analytical_relationship: edges.filter((edge) => edge.kind === "analytical_relationship")
        .length,
      business_relationship: edges.filter((edge) => edge.kind === "business_relationship").length,
      physical_binding: edges.filter((edge) => edge.kind === "physical_binding").length,
    },
  };
}

export async function buildSemanticExplorerSnapshot(
  input: unknown,
): Promise<SemanticExplorerSnapshot> {
  try {
    const envelope = semanticExplorerRawSourceEnvelopeSchema.parse(input);
    validateEnvelopeBindings(envelope);
    const payloads = parsePayloads(envelope);
    await validatePayloadBindings(
      {
        executable: envelope.executable_projection.projection_payload,
        relationship: envelope.relationship_projection.projection_payload,
        restriction: envelope.runtime_restriction_projection.projection_payload,
      },
      {
        executable: envelope.executable_projection.projection_digest,
        relationship: envelope.relationship_projection.projection_digest,
        restriction: envelope.runtime_restriction_projection.projection_digest,
      },
      envelope.release.compiler_bundle_digest,
      payloads.executable,
      payloads.relationship,
      payloads.restriction,
    );
    const objects = await buildObjects(
      payloads.executable,
      payloads.relationship,
      payloads.restriction,
    );
    const edges = await buildEdges(objects, payloads.executable, payloads.relationship);
    const snapshot = semanticExplorerSnapshotSchema.parse({
      schema_version: "semantic-explorer-snapshot@1.0.0",
      authority: "POSTGRESQL",
      release_identity: releaseIdentity(envelope),
      pointer_observation: {
        current_release_id: envelope.pointer.current_release_id,
        current_release_generation: envelope.pointer.current_release_generation,
        current_release_digest: envelope.pointer.current_release_digest,
        pointer_generation: envelope.pointer.pointer_generation,
        observed_at: envelope.observed_at,
      },
      is_active: envelope.source_kind === "ACTIVE",
      capabilities: {
        business_ontology:
          payloads.executable.explorer_sidecar?.business_ontology !== null &&
          payloads.executable.explorer_sidecar?.business_ontology !== undefined,
        physical_binding:
          payloads.executable.explorer_sidecar?.physical_binding !== null &&
          payloads.executable.explorer_sidecar?.physical_binding !== undefined,
        catalog_governance:
          payloads.executable.explorer_sidecar?.catalog_governance !== null &&
          payloads.executable.explorer_sidecar?.catalog_governance !== undefined,
      },
      objects,
      edges,
      counts: countSnapshot(objects, edges),
    });
    return deepFreeze(snapshot);
  } catch (error) {
    if (error instanceof SemanticExplorerKernelError) throw error;
    if (error instanceof ZodError) {
      explorerFailure("SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE");
    }
    explorerFailure("SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE");
  }
}

export interface SemanticExplorerSearchEntry {
  readonly identity: SemanticExplorerObjectIdentity;
  readonly search_text: string;
}

export interface SemanticExplorerReadModel {
  readonly snapshot: SemanticExplorerSnapshot;
  readonly object_index: ReadonlyMap<string, SemanticExplorerObject>;
  readonly edge_index: ReadonlyMap<string, SemanticExplorerEdge>;
  readonly search_index: readonly SemanticExplorerSearchEntry[];
}

export async function buildSemanticExplorerReadModel(
  input: unknown,
): Promise<SemanticExplorerReadModel> {
  const snapshot = await buildSemanticExplorerSnapshot(input);
  const objectIndex = new Map(
    snapshot.objects.map((object) => [semanticExplorerIdentityKey(object.identity), object]),
  );
  const edgeIndex = new Map(snapshot.edges.map((edge) => [edgeIdentityKey(edge), edge]));
  const searchIndex = snapshot.objects.map((object) => ({
    identity: object.identity,
    search_text: [object.name, ...object.aliases, object.description ?? ""]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("en-US"),
  }));
  return Object.freeze({
    snapshot,
    object_index: objectIndex,
    edge_index: edgeIndex,
    search_index: Object.freeze(searchIndex),
  });
}
