import type {
  SemanticExplorerDomainSummary,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";
import { create } from "zustand";
import type { SemanticModel } from "./data-link-types";
import { getActiveExplorerSnapshot, getExplorerDomains } from "./semantic-explorer-api";

/**
 * @deprecated 旧 Data Link 扁平化适配层已暂停使用。
 * 新开发必须读取统一的 Semantic Studio/Explorer Node-Edge 投影。
 */

interface DataLinkState {
  /** 模型列表 */
  models: SemanticModel[];
  /** 当前选中的模型 ID */
  selectedModelId: string | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | undefined;
}

interface DataLinkActions {
  /** 加载已发布的语义模型 */
  loadModels: () => Promise<void>;
  /** 选中模型 */
  selectModel: (id: string) => void;
  /** 清除选中 */
  clearSelection: () => void;
  /** 清除错误 */
  clearError: () => void;
  /** 清除当前工作空间的全部客户端状态 */
  reset: () => void;
}

export type DataLinkStore = DataLinkState & DataLinkActions;

const initialState: DataLinkState = {
  models: [],
  selectedModelId: null,
  loading: false,
  error: undefined,
};

export const useDataLinkStore = create<DataLinkStore>((set) => ({
  ...initialState,

  loadModels: async () => {
    set({ loading: true, error: undefined });
    try {
      const domains = (await getExplorerDomains()).filter((domain) => domain.has_current_release);
      const models = await Promise.all(
        domains.map(async (domain) =>
          transformSnapshotToModel(domain, await getActiveExplorerSnapshot(domain.semantic_domain)),
        ),
      );

      set({
        models: models.sort((left, right) => left.domain.localeCompare(right.domain)),
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "加载语义模型失败",
        loading: false,
      });
    }
  },

  selectModel: (id) => set({ selectedModelId: id }),

  clearSelection: () => set({ selectedModelId: null }),

  clearError: () => set({ error: undefined }),

  reset: () => set(initialState),
}));

function transformSnapshotToModel(
  domain: SemanticExplorerDomainSummary,
  snapshot: SemanticExplorerSnapshot,
): SemanticModel {
  if (
    snapshot.release_identity.semantic_domain !== domain.semantic_domain ||
    snapshot.release_identity.release_id !== domain.pointer_observation.current_release_id
  ) {
    throw new Error("SEMANTIC_RELEASE_POINTER_MISMATCH");
  }

  const metrics: SemanticModel["metrics"] = [];
  const dimensions: SemanticModel["dimensions"] = [];
  const relationships: SemanticModel["relationships"] = [];
  const tables = new Map<string, SemanticModel["tableMappings"][number]>();

  function addBinding(
    binding: {
      schema_name: string;
      table_name: string;
      column_name: string | null;
    },
    type: string,
    description: string,
  ): void {
    const table = `${binding.schema_name}.${binding.table_name}`;
    const existing = tables.get(table) ?? {
      table,
      alias: binding.table_name,
      description: `${table} 的已发布物理绑定`,
      columns: [],
    };
    if (
      binding.column_name &&
      !existing.columns.some((column) => column.name === binding.column_name)
    ) {
      existing.columns.push({
        name: binding.column_name,
        type,
        description,
      });
    }
    tables.set(table, existing);
  }

  for (const object of snapshot.objects) {
    switch (object.payload.kind) {
      case "metric": {
        const binding =
          object.payload.bindings.find((candidate) => candidate.lifecycle === "active") ??
          object.payload.bindings[0];
        metrics.push({
          id: object.identity.object_id,
          name: object.name,
          description: object.description ?? "",
          formula:
            object.payload.formula?.expression ??
            `${object.payload.aggregation}(${object.payload.column_id})`,
          unit: object.payload.unit?.description ?? object.payload.unit?.dimension ?? "",
          grain: object.payload.grain.description ?? object.payload.grain.grain_id,
          table: binding ? `${binding.schema_name}.${binding.table_name}` : object.payload.table_id,
          column: binding?.column_name ?? object.payload.column_id,
          aggregation: object.payload.aggregation,
        });
        for (const candidate of object.payload.bindings) {
          addBinding(candidate, "numeric", object.description ?? object.name);
        }
        break;
      }
      case "dimension": {
        const binding =
          object.payload.bindings.find((candidate) => candidate.lifecycle === "active") ??
          object.payload.bindings[0];
        dimensions.push({
          id: object.identity.object_id,
          name: object.name,
          description: object.description ?? "",
          table: binding ? `${binding.schema_name}.${binding.table_name}` : object.payload.table_id,
          column: binding?.column_name ?? object.payload.column_id,
          ...(object.payload.parent_dimension_id
            ? { hierarchy: [object.payload.parent_dimension_id, object.identity.object_id] }
            : {}),
        });
        for (const candidate of object.payload.bindings) {
          addBinding(candidate, object.payload.data_type, object.description ?? object.name);
        }
        break;
      }
      case "relationship":
        relationships.push({
          id: object.identity.object_id,
          name: object.name,
          sourceTable: object.payload.left.table_id,
          sourceColumn: object.payload.left.column_ids.join(", "),
          targetTable: object.payload.right.table_id,
          targetColumn: object.payload.right.column_ids.join(", "),
          type: object.payload.cardinality,
          description: object.description ?? "",
        });
        for (const candidate of object.payload.bindings) {
          addBinding(candidate, "relationship", object.description ?? object.name);
        }
        break;
      case "datasource":
        for (const candidate of object.payload.bindings) {
          if (candidate.lifecycle === "active") {
            addBinding(candidate, "", object.description ?? object.name);
          }
        }
        break;
      case "business_entity":
      case "business_event":
      case "business_term":
        break;
    }
  }

  return {
    id: snapshot.release_identity.release_id,
    name: domain.display_name,
    description: domain.description ?? `${domain.display_name} 已发布语义模型`,
    domain: domain.semantic_domain,
    version: snapshot.release_identity.release_generation,
    status: "published",
    updatedAt: snapshot.release_identity.published_at,
    createdAt: snapshot.release_identity.published_at,
    metrics: metrics.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    dimensions: dimensions.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    tableMappings: [...tables.values()].sort((left, right) =>
      left.table.localeCompare(right.table),
    ),
    relationships: relationships.sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    ),
  };
}

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useDataLinkModels = () => useDataLinkStore((s) => s.models);
export const useDataLinkLoading = () => useDataLinkStore((s) => s.loading);
export const useDataLinkError = () => useDataLinkStore((s) => s.error);
export const useDataLinkSelectedModel = () =>
  useDataLinkStore((s) => {
    if (!s.selectedModelId) return null;
    return s.models.find((m) => m.id === s.selectedModelId) ?? null;
  });
