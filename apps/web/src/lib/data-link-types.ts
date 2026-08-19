/**
 * Data Link 页面类型定义。
 *
 * 语义层浏览和编辑的展示类型。
 * 数据来源为现有的语义治理 API 返回的已发布语义模型。
 */

/** 语义模型（展示视图） */
export interface SemanticModel {
  id: string;
  name: string;
  description: string;
  domain: string;
  version: number;
  status: "published" | "draft" | "archived";
  updatedAt: string;
  createdAt: string;
  metrics: SemanticMetric[];
  dimensions: SemanticDimension[];
  tableMappings: TableMapping[];
  relationships: SemanticRelation[];
}

/** 指标定义 */
export interface SemanticMetric {
  id: string;
  name: string;
  description: string;
  formula: string;
  unit: string;
  grain: string;
  table: string;
  column: string;
  aggregation: string;
}

/** 维度定义 */
export interface SemanticDimension {
  id: string;
  name: string;
  description: string;
  table: string;
  column: string;
  hierarchy?: string[];
}

/** 表映射 */
export interface TableMapping {
  table: string;
  alias: string;
  description: string;
  columns: TableColumn[];
}

/** 表列 */
export interface TableColumn {
  name: string;
  type: string;
  description: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

/** 语义关系 */
export interface SemanticRelation {
  id: string;
  name: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  description: string;
}
