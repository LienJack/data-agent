import type {
  SemanticExplorerObject,
  SemanticExplorerObjectIdentity,
  SemanticExplorerObjectKind,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";

export const EXPLORER_OBJECT_ROW_LIMIT = 200;

export const EXPLORER_KIND_LABELS: Readonly<Record<SemanticExplorerObjectKind, string>> = {
  business_entity: "业务实体",
  business_event: "业务事件",
  business_term: "业务术语",
  metric: "指标",
  dimension: "维度",
  relationship: "关系",
  datasource: "数据源",
};

export const EXPLORER_KINDS = Object.freeze(
  Object.keys(EXPLORER_KIND_LABELS) as SemanticExplorerObjectKind[],
);

export function explorerIdentityKey(identity: SemanticExplorerObjectIdentity): string {
  return JSON.stringify([identity.kind, identity.object_id]);
}

export interface ExplorerObjectWindow {
  readonly objects: readonly SemanticExplorerObject[];
  readonly matching_count: number;
  readonly truncated: boolean;
}

export function selectExplorerObjectWindow(
  snapshot: SemanticExplorerSnapshot,
  category: SemanticExplorerObjectKind | null,
  search: string,
): ExplorerObjectWindow {
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const matching = snapshot.objects.filter((object) => {
    if (category && object.identity.kind !== category) return false;
    if (!normalizedSearch) return true;
    return [object.name, object.identity.object_id, object.description ?? "", ...object.aliases]
      .join("\n")
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedSearch);
  });
  return {
    objects: matching.slice(0, EXPLORER_OBJECT_ROW_LIMIT),
    matching_count: matching.length,
    truncated: matching.length > EXPLORER_OBJECT_ROW_LIMIT,
  };
}
