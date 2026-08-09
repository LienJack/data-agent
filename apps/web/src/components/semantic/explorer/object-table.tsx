import type { SemanticExplorerObject, SemanticExplorerObjectIdentity } from "@data-agent/contracts";
import { EXPLORER_KIND_LABELS, explorerIdentityKey } from "./view-model";

interface ObjectTableProps {
  readonly matchingCount: number;
  readonly objects: readonly SemanticExplorerObject[];
  readonly selected: SemanticExplorerObjectIdentity | null;
  readonly truncated: boolean;
  readonly onSelect: (identity: SemanticExplorerObjectIdentity) => void;
}

export function ObjectTable({
  matchingCount,
  objects,
  selected,
  truncated,
  onSelect,
}: ObjectTableProps) {
  const selectedKey = selected ? explorerIdentityKey(selected) : null;
  if (matchingCount === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-[var(--color-text-secondary)]">
        没有符合当前分类和搜索条件的对象。
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden">
      {truncated ? (
        <p className="border-b border-[var(--color-border-default)] bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          匹配 {matchingCount} 个对象；为控制 DOM，本页只渲染前 {objects.length} 行，请继续筛选。
        </p>
      ) : null}
      <div className="max-h-[58vh] overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)]">
            <tr>
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">Object ID</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((object) => {
              const key = explorerIdentityKey(object.identity);
              const active = key === selectedKey;
              return (
                <tr
                  key={key}
                  data-explorer-object-row="true"
                  className={`border-t border-[var(--color-border-default)] ${
                    active ? "bg-[var(--color-accent)]/10" : "hover:bg-[var(--color-bg-tertiary)]"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelect(object.identity)}
                      className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)]"
                    >
                      {object.name}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                    {EXPLORER_KIND_LABELS[object.identity.kind]}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        object.status === "published"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {object.status === "published" ? "已发布" : "已弃用"}
                    </span>
                  </td>
                  <td className="max-w-44 truncate px-3 py-2.5 font-mono text-[var(--color-text-tertiary)]">
                    {object.identity.object_id}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
