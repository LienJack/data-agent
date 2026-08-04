import {
  type BusinessOntology,
  type CatalogGovernance,
  type PhysicalBinding,
  type SemanticDimension,
  SemanticGovernanceError,
  type SemanticMetric,
  type SemanticRelationship,
  type SemanticSourceBundle,
  U5_EXECUTABLE_SUBSET,
  U13_EXECUTABLE_SUBSET,
} from "@data-agent/contracts";

/**
 * 验证严重程度。
 */
export enum ValidationSeverity {
  ERROR = "ERROR",
  WARNING = "WARNING",
  INFO = "INFO",
}

/**
 * 验证问题。
 */
export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

/**
 * 验证结果。
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

/**
 * 校验 SourceBundle 的结构完整性。
 *
 * 检查项：
 * - Bundle 版本和 Capability Profile
 * - Metric 必要字段
 * - Dimension 必要字段
 * - Relationship 引用完整性
 * - 字段唯一性
 * - BusinessOntology 结构完整性
 * - CatalogGovernance 结构完整性
 * - PhysicalBinding 结构完整性
 */
export function validateSourceBundle(bundle: SemanticSourceBundle): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. 检查 bundle 版本
  if (bundle.metadata.bundle_version !== "semantic-source-bundle@1") {
    issues.push({
      severity: ValidationSeverity.ERROR,
      code: "INVALID_BUNDLE_VERSION",
      message: `Bundle 版本必须为 semantic-source-bundle@1，当前为 ${bundle.metadata.bundle_version}。`,
      path: "metadata.bundle_version",
    });
  }

  // 2. 检查 capability profile
  if (bundle.metadata.capability_profile !== U5_EXECUTABLE_SUBSET && bundle.metadata.capability_profile !== U13_EXECUTABLE_SUBSET) {
    issues.push({
      severity: ValidationSeverity.ERROR,
      code: "INVALID_CAPABILITY_PROFILE",
      message: `Capability Profile 必须为 ${U5_EXECUTABLE_SUBSET} 或 ${U13_EXECUTABLE_SUBSET}，当前为 ${bundle.metadata.capability_profile}。`,
      path: "metadata.capability_profile",
    });
  }

  // 3. 检查 metrics
  if (bundle.metrics.length === 0) {
    issues.push({
      severity: ValidationSeverity.ERROR,
      code: "NO_METRICS",
      message: "SemanticSourceBundle 必须包含至少一个 Metric。",
      path: "metrics",
    });
  }

  const metricIds = new Set<string>();
  for (const metric of bundle.metrics) {
    if (metricIds.has(metric.metric_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "DUPLICATE_METRIC_ID",
        message: `重复的 Metric ID: ${metric.metric_id}。`,
        path: `metrics[${metric.metric_id}]`,
      });
    }
    metricIds.add(metric.metric_id);

    if (!metric.name || metric.name.length === 0) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "METRIC_MISSING_NAME",
        message: `Metric ${metric.metric_id} 缺少名称。`,
        path: `metrics[${metric.metric_id}].name`,
      });
    }

    if (!metric.aliases || metric.aliases.length === 0) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "METRIC_MISSING_ALIASES",
        message: `Metric ${metric.metric_id} 必须至少有一个别名。`,
        path: `metrics[${metric.metric_id}].aliases`,
      });
    }

    if (!metric.table_id) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "METRIC_MISSING_TABLE",
        message: `Metric ${metric.metric_id} 缺少 table_id。`,
        path: `metrics[${metric.metric_id}].table_id`,
      });
    }

    if (!metric.column_id) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "METRIC_MISSING_COLUMN",
        message: `Metric ${metric.metric_id} 缺少 column_id。`,
        path: `metrics[${metric.metric_id}].column_id`,
      });
    }
  }

  // 4. 检查 dimensions
  const dimensionIds = new Set<string>();
  for (const dimension of bundle.dimensions) {
    if (dimensionIds.has(dimension.dimension_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "DUPLICATE_DIMENSION_ID",
        message: `重复的 Dimension ID: ${dimension.dimension_id}。`,
        path: `dimensions[${dimension.dimension_id}]`,
      });
    }
    dimensionIds.add(dimension.dimension_id);

    if (metricIds.has(dimension.dimension_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "METRIC_DIMENSION_ID_CONFLICT",
        message: `Dimension ID ${dimension.dimension_id} 与 Metric ID 冲突。`,
        path: `dimensions[${dimension.dimension_id}]`,
      });
    }

    if (!dimension.name || dimension.name.length === 0) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "DIMENSION_MISSING_NAME",
        message: `Dimension ${dimension.dimension_id} 缺少名称。`,
        path: `dimensions[${dimension.dimension_id}].name`,
      });
    }
  }

  // 5. 检查 relationships
  const relationshipIds = new Set<string>();
  for (const relationship of bundle.relationships) {
    if (relationshipIds.has(relationship.relationship_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "DUPLICATE_RELATIONSHIP_ID",
        message: `重复的 Relationship ID: ${relationship.relationship_id}。`,
        path: `relationships[${relationship.relationship_id}]`,
      });
    }
    relationshipIds.add(relationship.relationship_id);
  }

  // 6. 检查 formulas
  const formulaIds = new Set<string>();
  for (const formula of bundle.formulas) {
    if (formulaIds.has(formula.formula_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "DUPLICATE_FORMULA_ID",
        message: `重复的 Formula ID: ${formula.formula_id}。`,
        path: `formulas[${formula.formula_id}]`,
      });
    }
    formulaIds.add(formula.formula_id);
  }

  // 7. 检查 M1 子集限制
  if (bundle.metadata.capability_profile === U5_EXECUTABLE_SUBSET && bundle.contribution_profile) {
    issues.push({
      severity: ValidationSeverity.WARNING,
      code: "M1_CONTRIBUTION_PROFILE_NOT_ALLOWED",
      message: "M1 不允许 DescriptiveContributionProfile。",
      path: "contribution_profile",
    });
  }

  // 8. 检查 BusinessOntology
  if (bundle.business_ontology) {
    const ontology: BusinessOntology = bundle.business_ontology;
    if (!ontology.domain || ontology.domain.length === 0) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "ONTOLOGY_MISSING_DOMAIN",
        message: "BusinessOntology 缺少 domain。",
        path: "business_ontology.domain",
      });
    }
    if (!ontology.owner || ontology.owner.length === 0) {
      issues.push({
        severity: ValidationSeverity.WARNING,
        code: "ONTOLOGY_MISSING_OWNER",
        message: "BusinessOntology 缺少 owner。",
        path: "business_ontology.owner",
      });
    }
    const entityIds = new Set<string>();
    for (const entity of ontology.entities) {
      if (entityIds.has(entity.entity_id)) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "ONTOLOGY_DUPLICATE_ENTITY_ID",
          message: `BusinessOntology 重复的 Entity ID: ${entity.entity_id}。`,
          path: `business_ontology.entities[${entity.entity_id}]`,
        });
      }
      entityIds.add(entity.entity_id);
      if (!entity.name || entity.name.length === 0) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "ONTOLOGY_ENTITY_MISSING_NAME",
          message: `Entity ${entity.entity_id} 缺少名称。`,
          path: `business_ontology.entities[${entity.entity_id}].name`,
        });
      }
    }
    const eventIds = new Set<string>();
    for (const event of ontology.events) {
      if (eventIds.has(event.event_id)) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "ONTOLOGY_DUPLICATE_EVENT_ID",
          message: `BusinessOntology 重复的 Event ID: ${event.event_id}。`,
          path: `business_ontology.events[${event.event_id}]`,
        });
      }
      eventIds.add(event.event_id);
      if (!entityIds.has(event.subject_entity_id)) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "ONTOLOGY_EVENT_INVALID_SUBJECT",
          message: `Event ${event.event_id} 引用不存在的 subject_entity_id: ${event.subject_entity_id}。`,
          path: `business_ontology.events[${event.event_id}].subject_entity_id`,
        });
      }
    }
    const termIds = new Set<string>();
    for (const term of ontology.terms) {
      if (termIds.has(term.term_id)) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "ONTOLOGY_DUPLICATE_TERM_ID",
          message: `BusinessOntology 重复的 Term ID: ${term.term_id}。`,
          path: `business_ontology.terms[${term.term_id}]`,
        });
      }
      termIds.add(term.term_id);
    }
    // 校验实体业务关系引用的 target_entity_id
    for (const entity of ontology.entities) {
      for (const rel of entity.business_relationship_types) {
        if (!entityIds.has(rel.target_entity_id)) {
          issues.push({
            severity: ValidationSeverity.ERROR,
            code: "ONTOLOGY_ENTITY_RELATIONSHIP_INVALID_TARGET",
            message: `Entity ${entity.entity_id} 的业务关系引用不存在的 target_entity_id: ${rel.target_entity_id}。`,
            path: `business_ontology.entities[${entity.entity_id}].business_relationship_types`,
          });
        }
      }
    }
  }

  // 9. 检查 CatalogGovernance
  if (bundle.catalog_governance) {
    const catalog: CatalogGovernance = bundle.catalog_governance;
    const tableIds = new Set<string>();
    for (const table of catalog.tables) {
      if (tableIds.has(table.table_id)) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "CATALOG_DUPLICATE_TABLE_ID",
          message: `CatalogGovernance 重复的 Table ID: ${table.table_id}。`,
          path: `catalog_governance.tables[${table.table_id}]`,
        });
      }
      tableIds.add(table.table_id);
      if (!table.table_name || table.table_name.length === 0) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "CATALOG_TABLE_MISSING_NAME",
          message: `Table ${table.table_id} 缺少 table_name。`,
          path: `catalog_governance.tables[${table.table_id}].table_name`,
        });
      }
      const columnIds = new Set<string>();
      for (const column of table.columns) {
        if (columnIds.has(column.column_id)) {
          issues.push({
            severity: ValidationSeverity.ERROR,
            code: "CATALOG_DUPLICATE_COLUMN_ID",
            message: `Table ${table.table_id} 重复的 Column ID: ${column.column_id}。`,
            path: `catalog_governance.tables[${table.table_id}].columns[${column.column_id}]`,
          });
        }
        columnIds.add(column.column_id);
      }
    }
  }

  // 10. 检查 PhysicalBinding
  if (bundle.physical_binding) {
    const binding: PhysicalBinding = bundle.physical_binding;
    const logicalObjectIds = new Set<string>();
    for (const entry of binding.entries) {
      if (logicalObjectIds.has(entry.logical_object_id)) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "BINDING_DUPLICATE_LOGICAL_OBJECT_ID",
          message: `PhysicalBinding 重复的 Logical Object ID: ${entry.logical_object_id}。`,
          path: `physical_binding.entries[${entry.logical_object_id}]`,
        });
      }
      logicalObjectIds.add(entry.logical_object_id);
      if (!entry.datasource_id) {
        issues.push({
          severity: ValidationSeverity.ERROR,
          code: "BINDING_MISSING_DATASOURCE_ID",
          message: `PhysicalBinding 条目 ${entry.logical_object_id} 缺少 datasource_id。`,
          path: `physical_binding.entries[${entry.logical_object_id}].datasource_id`,
        });
      }
    }
  }

  return {
    valid: issues.every((i) => i.severity !== ValidationSeverity.ERROR),
    issues,
  };
}

/**
 * 检查 Bundle 与指定 Catalog 的兼容性。
 */
export function checkSchemaCompatibility(
  bundle: SemanticSourceBundle,
  catalogTables: readonly string[],
): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const metric of bundle.metrics) {
    if (!catalogTables.includes(metric.table_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "METRIC_TABLE_NOT_IN_CATALOG",
        message: `Metric ${metric.metric_id} 引用的表 ${metric.table_id} 不在 Catalog 中。`,
        path: `metrics[${metric.metric_id}].table_id`,
      });
    }
  }

  for (const dimension of bundle.dimensions) {
    if (!catalogTables.includes(dimension.table_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "DIMENSION_TABLE_NOT_IN_CATALOG",
        message: `Dimension ${dimension.dimension_id} 引用的表 ${dimension.table_id} 不在 Catalog 中。`,
        path: `dimensions[${dimension.dimension_id}].table_id`,
      });
    }
  }

  for (const relationship of bundle.relationships) {
    if (!catalogTables.includes(relationship.left_table_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "RELATIONSHIP_LEFT_TABLE_NOT_IN_CATALOG",
        message: `Relationship ${relationship.relationship_id} 引用的左表 ${relationship.left_table_id} 不在 Catalog 中。`,
        path: `relationships[${relationship.relationship_id}].left_table_id`,
      });
    }
    if (!catalogTables.includes(relationship.right_table_id)) {
      issues.push({
        severity: ValidationSeverity.ERROR,
        code: "RELATIONSHIP_RIGHT_TABLE_NOT_IN_CATALOG",
        message: `Relationship ${relationship.relationship_id} 引用的右表 ${relationship.right_table_id} 不在 Catalog 中。`,
        path: `relationships[${relationship.relationship_id}].right_table_id`,
      });
    }
  }

  return {
    valid: issues.every((i) => i.severity !== ValidationSeverity.ERROR),
    issues,
  };
}
