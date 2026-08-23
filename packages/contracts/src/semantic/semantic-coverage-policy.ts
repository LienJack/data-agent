import { z } from "zod";
import { contentHashSchema, deepFreeze, versionIdentifierSchema } from "../common/index.js";

const semanticIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const semanticCoveragePolicyFloorSchema = z.strictObject({
  schema_version: z.literal("semantic-coverage-floor@1.0.0"),
  relation_coverage_percent: z.literal(100),
  primary_key_coverage_percent: z.literal(100),
  foreign_key_coverage_percent: z.literal(100),
  supported_queryable_column_coverage_percent: z.literal(100),
  require_join_edge_for_every_foreign_key: z.literal(true),
  require_evidence_for_every_foreign_key: z.literal(true),
  require_deterministic_unsupported_type_reason: z.literal(true),
});

export const SEMANTIC_COVERAGE_POLICY_FLOOR = deepFreeze(
  semanticCoveragePolicyFloorSchema.parse({
    schema_version: "semantic-coverage-floor@1.0.0",
    relation_coverage_percent: 100,
    primary_key_coverage_percent: 100,
    foreign_key_coverage_percent: 100,
    supported_queryable_column_coverage_percent: 100,
    require_join_edge_for_every_foreign_key: true,
    require_evidence_for_every_foreign_key: true,
    require_deterministic_unsupported_type_reason: true,
  }),
);

export const deterministicTypeExclusionReasonSchema = z.enum([
  "ADAPTER_TYPE_UNSUPPORTED",
  "ADAPTER_QUERY_SEMANTICS_UNSUPPORTED",
]);

export const adapterCandidateDescriptorSchema = z
  .strictObject({
    classification: z.literal("CANDIDATE"),
    capability_id: versionIdentifierSchema,
    supported_physical_types: z.array(semanticIdentifierSchema).min(1).max(10_000),
    deterministic_exclusions: z
      .array(
        z.strictObject({
          physical_type: semanticIdentifierSchema,
          reason_code: deterministicTypeExclusionReasonSchema,
          evidence_hash: contentHashSchema,
        }),
      )
      .max(10_000),
  })
  .superRefine((capability, ctx) => {
    if (
      new Set(capability.supported_physical_types).size !==
      capability.supported_physical_types.length
    ) {
      ctx.addIssue({ code: "custom", message: "Adapter Candidate supported type 必须唯一。" });
    }
    const exclusions = new Set(
      capability.deterministic_exclusions.map((item) => item.physical_type),
    );
    if (exclusions.size !== capability.deterministic_exclusions.length) {
      ctx.addIssue({ code: "custom", message: "Adapter Candidate exclusion type 必须唯一。" });
    }
    for (const physicalType of capability.supported_physical_types) {
      if (exclusions.has(physicalType)) {
        ctx.addIssue({
          code: "custom",
          message: `Adapter Candidate type 不能同时 supported 与 excluded: ${physicalType}`,
        });
      }
    }
  });

const physicalQueryableColumnSchema = z.strictObject({
  column_id: semanticIdentifierSchema,
  physical_type: semanticIdentifierSchema,
  queryable: z.boolean(),
});

const relationEndpointSchema = z
  .strictObject({
    relation_id: semanticIdentifierSchema,
    column_ids: z.array(semanticIdentifierSchema).min(1).max(1_000),
  })
  .superRefine((endpoint, ctx) => {
    if (new Set(endpoint.column_ids).size !== endpoint.column_ids.length) {
      ctx.addIssue({ code: "custom", message: "Relation endpoint column_id 必须唯一。" });
    }
  });

const physicalForeignKeySchema = z
  .strictObject({
    foreign_key_id: semanticIdentifierSchema,
    constraint_identity: semanticIdentifierSchema,
    source_endpoint: relationEndpointSchema,
    target_endpoint: relationEndpointSchema,
  })
  .superRefine((foreignKey, ctx) => {
    if (
      foreignKey.source_endpoint.column_ids.length !== foreignKey.target_endpoint.column_ids.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Physical composite FK source/target column arity 必须一致。",
        path: ["target_endpoint", "column_ids"],
      });
    }
  });

const physicalRelationCoverageInventorySchema = z.strictObject({
  relation_id: semanticIdentifierSchema,
  primary_key_id: semanticIdentifierSchema.nullable(),
  foreign_keys: z.array(physicalForeignKeySchema).max(10_000),
  columns: z.array(physicalQueryableColumnSchema).min(1).max(10_000),
});

const joinEdgeCandidateDescriptorSchema = z
  .strictObject({
    join_edge_id: semanticIdentifierSchema,
    foreign_key_id: semanticIdentifierSchema,
    constraint_identity: semanticIdentifierSchema,
    source_endpoint: relationEndpointSchema,
    target_endpoint: relationEndpointSchema,
    evidence_hash: contentHashSchema,
  })
  .superRefine((edge, ctx) => {
    if (edge.source_endpoint.column_ids.length !== edge.target_endpoint.column_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Join Edge composite endpoint column arity 必须一致。",
        path: ["target_endpoint", "column_ids"],
      });
    }
  });

export const semanticCoverageAssessmentSchema = z
  .strictObject({
    schema_version: z.literal("semantic-coverage-assessment@1.0.0"),
    policy_floor: semanticCoveragePolicyFloorSchema,
    effective_adapter_candidate_id: versionIdentifierSchema,
    adapter_candidates: z.array(adapterCandidateDescriptorSchema).min(1).max(1_000),
    physical_inventory: z.strictObject({
      relations: z.array(physicalRelationCoverageInventorySchema).min(1).max(100_000),
    }),
    join_edge_inventory: z.array(joinEdgeCandidateDescriptorSchema).max(100_000),
    semantic_coverage: z.strictObject({
      relations: z.array(
        z.strictObject({
          relation_id: semanticIdentifierSchema,
          semantic_object_id: semanticIdentifierSchema,
        }),
      ),
      primary_keys: z.array(
        z.strictObject({
          primary_key_id: semanticIdentifierSchema,
          mapping_id: semanticIdentifierSchema,
        }),
      ),
      foreign_keys: z.array(
        z.strictObject({
          foreign_key_id: semanticIdentifierSchema,
          join_edge_id: semanticIdentifierSchema,
          evidence_hash: contentHashSchema,
        }),
      ),
      queryable_columns: z.array(
        z.strictObject({
          column_id: semanticIdentifierSchema,
          mapping_id: semanticIdentifierSchema,
        }),
      ),
      excluded_columns: z.array(
        z.strictObject({
          column_id: semanticIdentifierSchema,
          adapter_candidate_id: versionIdentifierSchema,
          reason_code: deterministicTypeExclusionReasonSchema,
          evidence_hash: contentHashSchema,
        }),
      ),
    }),
  })
  .superRefine((assessment, ctx) => {
    const capabilityIds = assessment.adapter_candidates.map((item) => item.capability_id);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "Adapter Candidate capability_id 必须唯一。",
        path: ["adapter_candidates"],
      });
    }
    if (
      capabilityIds.filter((id) => id === assessment.effective_adapter_candidate_id).length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "effective_adapter_candidate_id 必须唯一绑定一个 Adapter Candidate Descriptor。",
        path: ["effective_adapter_candidate_id"],
      });
    }

    const relationsById = new Map(
      assessment.physical_inventory.relations.map(
        (relation) => [relation.relation_id, relation] as const,
      ),
    );
    const globalIdentities = {
      primary_key_id: [] as string[],
      foreign_key_id: [] as string[],
      constraint_identity: [] as string[],
      column_id: [] as string[],
    };
    for (const relation of assessment.physical_inventory.relations) {
      const relationColumnIds = new Set(relation.columns.map((column) => column.column_id));
      if (relation.primary_key_id) globalIdentities.primary_key_id.push(relation.primary_key_id);
      for (const foreignKey of relation.foreign_keys) {
        globalIdentities.foreign_key_id.push(foreignKey.foreign_key_id);
        globalIdentities.constraint_identity.push(foreignKey.constraint_identity);
        if (foreignKey.source_endpoint.relation_id !== relation.relation_id) {
          ctx.addIssue({
            code: "custom",
            message: "Physical FK source relation 必须绑定所属 relation。",
            path: ["physical_inventory", "relations"],
          });
        }
        if (
          foreignKey.source_endpoint.column_ids.some((columnId) => !relationColumnIds.has(columnId))
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Physical FK source endpoint 必须引用所属 relation 的 column。",
            path: ["physical_inventory", "relations"],
          });
        }
        const target = relationsById.get(foreignKey.target_endpoint.relation_id);
        if (!target) {
          ctx.addIssue({
            code: "custom",
            message: "Physical FK target endpoint 必须引用 inventory 中存在的 relation。",
            path: ["physical_inventory", "relations"],
          });
        } else if (
          foreignKey.target_endpoint.column_ids.some(
            (columnId) => !target.columns.some((column) => column.column_id === columnId),
          )
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Physical FK target endpoint 必须引用目标 relation 的 column。",
            path: ["physical_inventory", "relations"],
          });
        }
      }
      globalIdentities.column_id.push(...relation.columns.map((column) => column.column_id));
    }
    for (const [category, identities] of Object.entries(globalIdentities)) {
      if (new Set(identities).size !== identities.length) {
        ctx.addIssue({
          code: "custom",
          message: `Physical ${category} 必须全局唯一或 relation-qualified。`,
          path: ["physical_inventory", "relations"],
        });
      }
    }

    const edgeIds = assessment.join_edge_inventory.map((edge) => edge.join_edge_id);
    const edgeForeignKeys = assessment.join_edge_inventory.map((edge) => edge.foreign_key_id);
    if (
      new Set(edgeIds).size !== edgeIds.length ||
      new Set(edgeForeignKeys).size !== edgeForeignKeys.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Join Edge inventory 必须按 join_edge_id 与 foreign_key_id 唯一。",
        path: ["join_edge_inventory"],
      });
    }

    const physicalForeignKeys = new Map<string, z.infer<typeof physicalForeignKeySchema>>();
    for (const relation of assessment.physical_inventory.relations) {
      for (const foreignKey of relation.foreign_keys) {
        physicalForeignKeys.set(foreignKey.foreign_key_id, foreignKey);
      }
    }
    const joinEdgesByForeignKey = new Map(
      assessment.join_edge_inventory.map((edge) => [edge.foreign_key_id, edge] as const),
    );
    for (const [foreignKeyId, foreignKey] of physicalForeignKeys) {
      const edge = joinEdgesByForeignKey.get(foreignKeyId);
      if (!edge) {
        ctx.addIssue({
          code: "custom",
          message: `Physical FK 缺少对应 Join Edge Candidate: ${foreignKeyId}`,
          path: ["join_edge_inventory"],
        });
      } else if (
        edge.constraint_identity !== foreignKey.constraint_identity ||
        JSON.stringify(edge.source_endpoint) !== JSON.stringify(foreignKey.source_endpoint) ||
        JSON.stringify(edge.target_endpoint) !== JSON.stringify(foreignKey.target_endpoint)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Join Edge Candidate 与 Physical FK endpoint/constraint 不一致: ${foreignKeyId}`,
          path: ["join_edge_inventory"],
        });
      }
    }
    for (const foreignKeyId of joinEdgesByForeignKey.keys()) {
      if (!physicalForeignKeys.has(foreignKeyId)) {
        ctx.addIssue({
          code: "custom",
          message: `Join Edge Candidate 引用了 inventory 中不存在的 Physical FK: ${foreignKeyId}`,
          path: ["join_edge_inventory"],
        });
      }
    }
  });

export const semanticCoverageValidationResultSchema = z.strictObject({
  ok: z.boolean(),
  code: z.enum([
    "SEMANTIC_COVERAGE_COMPLETE",
    "SEMANTIC_COVERAGE_INCOMPLETE",
    "SEMANTIC_COVERAGE_INPUT_INVALID",
  ]),
  missing: z.array(z.string().min(1).max(512)),
});

function uniqueIndex<T>(
  values: readonly T[],
  identity: (value: T) => string,
  category: string,
  missing: string[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = identity(value);
    if (result.has(key)) missing.push(`DUPLICATE_${category}:${key}`);
    result.set(key, value);
  }
  return result;
}

export function evaluateSemanticCoverage(input: unknown) {
  const parsed = semanticCoverageAssessmentSchema.safeParse(input);
  if (!parsed.success) {
    return deepFreeze(
      semanticCoverageValidationResultSchema.parse({
        ok: false,
        code: "SEMANTIC_COVERAGE_INPUT_INVALID",
        missing: parsed.error.issues.map((issue) => `INVALID:${issue.path.join(".") || "root"}`),
      }),
    );
  }

  const assessment = parsed.data;
  const missing: string[] = [];
  const capabilities = uniqueIndex(
    assessment.adapter_candidates,
    (item) => item.capability_id,
    "ADAPTER_CAPABILITY",
    missing,
  );
  const effectiveCapability = capabilities.get(assessment.effective_adapter_candidate_id);
  if (!effectiveCapability) {
    return deepFreeze(
      semanticCoverageValidationResultSchema.parse({
        ok: false,
        code: "SEMANTIC_COVERAGE_INPUT_INVALID",
        missing: ["INVALID:effective_adapter_candidate_id"],
      }),
    );
  }
  const joinEdges = uniqueIndex(
    assessment.join_edge_inventory,
    (item) => item.join_edge_id,
    "JOIN_EDGE_INVENTORY",
    missing,
  );
  const relationCoverage = uniqueIndex(
    assessment.semantic_coverage.relations,
    (item) => item.relation_id,
    "RELATION_COVERAGE",
    missing,
  );
  const primaryKeyCoverage = uniqueIndex(
    assessment.semantic_coverage.primary_keys,
    (item) => item.primary_key_id,
    "PRIMARY_KEY_COVERAGE",
    missing,
  );
  const foreignKeyCoverage = uniqueIndex(
    assessment.semantic_coverage.foreign_keys,
    (item) => item.foreign_key_id,
    "FOREIGN_KEY_COVERAGE",
    missing,
  );
  const columnCoverage = uniqueIndex(
    assessment.semantic_coverage.queryable_columns,
    (item) => item.column_id,
    "QUERYABLE_COLUMN_COVERAGE",
    missing,
  );
  const exclusions = uniqueIndex(
    assessment.semantic_coverage.excluded_columns,
    (item) => item.column_id,
    "COLUMN_EXCLUSION",
    missing,
  );
  const inventoryRelations = uniqueIndex(
    assessment.physical_inventory.relations,
    (item) => item.relation_id,
    "PHYSICAL_RELATION",
    missing,
  );

  const expectedRelations = new Set<string>();
  const expectedPrimaryKeys = new Set<string>();
  const expectedForeignKeys = new Set<string>();
  const expectedQueryableColumns = new Set<string>();
  const expectedExcludedColumns = new Set<string>();

  for (const relation of inventoryRelations.values()) {
    expectedRelations.add(relation.relation_id);
    if (!relationCoverage.has(relation.relation_id)) {
      missing.push(`RELATION:${relation.relation_id}`);
    }
    if (relation.primary_key_id) {
      expectedPrimaryKeys.add(relation.primary_key_id);
      if (!primaryKeyCoverage.has(relation.primary_key_id)) {
        missing.push(`PRIMARY_KEY:${relation.primary_key_id}`);
      }
    }
    for (const foreignKey of relation.foreign_keys) {
      const foreignKeyId = foreignKey.foreign_key_id;
      expectedForeignKeys.add(foreignKeyId);
      const mapping = foreignKeyCoverage.get(foreignKeyId);
      if (!mapping) {
        missing.push(`FOREIGN_KEY:${foreignKeyId}`);
        continue;
      }
      const candidateEdge = joinEdges.get(mapping.join_edge_id);
      if (
        !candidateEdge ||
        candidateEdge.foreign_key_id !== foreignKeyId ||
        candidateEdge.constraint_identity !== foreignKey.constraint_identity ||
        JSON.stringify(candidateEdge.source_endpoint) !==
          JSON.stringify(foreignKey.source_endpoint) ||
        JSON.stringify(candidateEdge.target_endpoint) !==
          JSON.stringify(foreignKey.target_endpoint) ||
        candidateEdge.evidence_hash !== mapping.evidence_hash
      ) {
        missing.push(`JOIN_EDGE_BINDING:${foreignKeyId}`);
      }
    }

    const inventoryColumns = uniqueIndex(
      relation.columns,
      (item) => item.column_id,
      "PHYSICAL_COLUMN",
      missing,
    );
    for (const column of inventoryColumns.values()) {
      if (!column.queryable) continue;
      const supported = effectiveCapability.supported_physical_types.includes(column.physical_type);
      if (supported) {
        expectedQueryableColumns.add(column.column_id);
        if (!columnCoverage.has(column.column_id)) {
          missing.push(`QUERYABLE_COLUMN:${column.column_id}`);
        }
        if (exclusions.has(column.column_id)) {
          missing.push(`SUPPORTED_COLUMN_EXCLUDED:${column.column_id}`);
        }
        continue;
      }

      expectedExcludedColumns.add(column.column_id);
      const exclusion = exclusions.get(column.column_id);
      const adapterReason = effectiveCapability.deterministic_exclusions.find(
        (item) => item.physical_type === column.physical_type,
      );
      if (
        !exclusion ||
        exclusion.adapter_candidate_id !== assessment.effective_adapter_candidate_id ||
        !adapterReason ||
        exclusion.reason_code !== adapterReason.reason_code ||
        exclusion.evidence_hash !== adapterReason.evidence_hash
      ) {
        missing.push(`DETERMINISTIC_EXCLUSION:${column.column_id}`);
      }
      if (columnCoverage.has(column.column_id)) {
        missing.push(`UNSUPPORTED_COLUMN_MAPPED:${column.column_id}`);
      }
    }
  }

  const rejectUnexpected = (actual: Iterable<string>, expected: Set<string>, category: string) => {
    for (const identity of actual) {
      if (!expected.has(identity)) missing.push(`UNEXPECTED_${category}:${identity}`);
    }
  };
  rejectUnexpected(relationCoverage.keys(), expectedRelations, "RELATION");
  rejectUnexpected(primaryKeyCoverage.keys(), expectedPrimaryKeys, "PRIMARY_KEY");
  rejectUnexpected(foreignKeyCoverage.keys(), expectedForeignKeys, "FOREIGN_KEY");
  rejectUnexpected(columnCoverage.keys(), expectedQueryableColumns, "QUERYABLE_COLUMN");
  rejectUnexpected(exclusions.keys(), expectedExcludedColumns, "COLUMN_EXCLUSION");

  const uniqueMissing = [...new Set(missing)].sort();
  return deepFreeze(
    semanticCoverageValidationResultSchema.parse({
      ok: uniqueMissing.length === 0,
      code:
        uniqueMissing.length === 0 ? "SEMANTIC_COVERAGE_COMPLETE" : "SEMANTIC_COVERAGE_INCOMPLETE",
      missing: uniqueMissing,
    }),
  );
}

export type SemanticCoveragePolicyFloor = z.infer<typeof semanticCoveragePolicyFloorSchema>;
export type AdapterCandidateDescriptor = z.infer<typeof adapterCandidateDescriptorSchema>;
export type SemanticCoverageAssessment = z.infer<typeof semanticCoverageAssessmentSchema>;
export type SemanticCoverageValidationResult = z.infer<
  typeof semanticCoverageValidationResultSchema
>;
