import type {
  SemanticExplorerLineage,
  SemanticExplorerObject,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";
import { EXPLORER_KIND_LABELS, explorerIdentityKey } from "./view-model";

interface DetailFact {
  readonly label: string;
  readonly value: string;
}

function payloadFacts(object: SemanticExplorerObject): readonly DetailFact[] {
  const payload = object.payload;
  switch (payload.kind) {
    case "metric":
      return [
        { label: "聚合", value: payload.aggregation },
        { label: "公式", value: payload.formula?.expression ?? "直接列聚合" },
        { label: "公式方言", value: payload.formula?.dialect ?? "—" },
        { label: "粒度", value: `${payload.grain.grain_id} · ${payload.grain.granularity}` },
        {
          label: "单位",
          value: payload.unit ? `${payload.unit.unit_id} · ${payload.unit.dimension}` : "—",
        },
        {
          label: "时间域",
          value: payload.time_domain
            ? `${payload.time_domain.time_domain_id} · ${payload.time_domain.calendar}`
            : "—",
        },
        { label: "可加性", value: payload.additivity },
        { label: "Null policy", value: payload.null_policy },
        { label: "Fanout policy", value: payload.fanout_policy },
      ];
    case "dimension":
      return [
        { label: "物理列", value: `${payload.table_id}.${payload.column_id}` },
        { label: "粒度", value: `${payload.grain.grain_id} · ${payload.grain.granularity}` },
        { label: "数据类型", value: payload.data_type },
        { label: "敏感级别", value: payload.sensitivity },
        { label: "层级维度", value: payload.hierarchical ? "是" : "否" },
        { label: "父维度", value: payload.parent_dimension_id ?? "—" },
      ];
    case "relationship":
      return [
        { label: "关系类型", value: payload.relationship_kind ?? "未声明" },
        {
          label: "端点",
          value: `${payload.left.table_id} → ${payload.right.table_id}`,
        },
        { label: "基数", value: payload.cardinality },
        { label: "方向", value: payload.direction },
        { label: "行保留", value: payload.row_preservation },
        { label: "证明类型", value: payload.proof_kind },
        { label: "证明说明", value: payload.proof_detail ?? "—" },
      ];
    case "business_entity":
      return [
        { label: "业务域", value: payload.domain },
        { label: "业务关系类型", value: String(payload.business_relationship_types.length) },
      ];
    case "business_event":
      return [
        { label: "业务域", value: payload.domain },
        { label: "事件类型", value: payload.event_type },
        { label: "主体实体", value: payload.subject_entity_id },
      ];
    case "business_term":
      return [
        { label: "业务域", value: payload.domain },
        { label: "定义", value: payload.definition },
      ];
    case "datasource":
      return [
        { label: "绑定数", value: String(payload.bindings.length) },
        {
          label: "表数",
          value: payload.catalog ? String(payload.catalog.table_count) : "能力缺失",
        },
        {
          label: "列数",
          value: payload.catalog ? String(payload.catalog.column_count) : "能力缺失",
        },
      ];
  }
}

function objectBindings(object: SemanticExplorerObject) {
  return "bindings" in object.payload ? object.payload.bindings : [];
}

interface ObjectDetailProps {
  readonly lineage: SemanticExplorerLineage | null;
  readonly lineageBusy: boolean;
  readonly object: SemanticExplorerObject | null;
  readonly snapshot: SemanticExplorerSnapshot;
  readonly onLoadLineage: () => void;
}

export function ObjectDetail({
  lineage,
  lineageBusy,
  object,
  snapshot,
  onLoadLineage,
}: ObjectDetailProps) {
  if (!object) {
    return (
      <aside className="flex min-h-72 items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4 text-center text-xs text-[var(--color-text-secondary)]">
        选择一个对象查看 exact release 详情。
      </aside>
    );
  }

  const bindings = objectBindings(object);
  const key = explorerIdentityKey(object.identity);
  const impactEdges = snapshot.edges.filter(
    (edge) => explorerIdentityKey(edge.source) === key || explorerIdentityKey(edge.target) === key,
  );

  return (
    <aside className="min-w-0 space-y-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
            {EXPLORER_KIND_LABELS[object.identity.kind]}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              object.status === "published"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
            }`}
          >
            {object.status === "published" ? "已发布" : "已弃用"}
          </span>
          {object.restricted ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              受限展示
            </span>
          ) : null}
        </div>
        <h2 className="mt-2 break-words text-base font-semibold text-[var(--color-text-primary)]">
          {object.name}
        </h2>
        <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
          {object.identity.object_id}
        </p>
        <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">
          {object.description ?? "没有发布说明。"}
        </p>
      </div>

      <dl className="grid gap-2 border-t border-[var(--color-border-default)] pt-3">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-xs">
          <dt className="text-[var(--color-text-tertiary)]">别名</dt>
          <dd className="break-words text-[var(--color-text-secondary)]">
            {object.aliases.join("、") || "—"}
          </dd>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-xs">
          <dt className="text-[var(--color-text-tertiary)]">Owner</dt>
          <dd className="break-words text-[var(--color-text-secondary)]">{object.owner ?? "—"}</dd>
        </div>
        {payloadFacts(object).map((fact) => (
          <div key={fact.label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-xs">
            <dt className="text-[var(--color-text-tertiary)]">{fact.label}</dt>
            <dd className="break-words text-[var(--color-text-secondary)]">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <section className="border-t border-[var(--color-border-default)] pt-3">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">
          Physical bindings
        </h3>
        {bindings.length > 0 ? (
          <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-text-secondary)]">
            {bindings.slice(0, 12).map((binding) => (
              <li
                key={`${binding.schema_name}.${binding.table_name}.${binding.column_name ?? "*"}`}
                className="break-all font-mono"
              >
                {binding.schema_name}.{binding.table_name}
                {binding.column_name ? `.${binding.column_name}` : ""} · {binding.lifecycle}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">没有可展示的绑定。</p>
        )}
      </section>

      <section className="border-t border-[var(--color-border-default)] pt-3 text-xs">
        <h3 className="font-semibold text-[var(--color-text-primary)]">版本与影响范围</h3>
        <p className="mt-2 break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
          release {snapshot.release_identity.release_id} · generation{" "}
          {snapshot.release_identity.release_generation}
        </p>
        <p className="mt-1 text-[var(--color-text-secondary)]">
          {impactEdges.length} 条直接已发布边；pointer generation{" "}
          {snapshot.pointer_observation.pointer_generation}
        </p>
        <button
          type="button"
          disabled={lineageBusy}
          onClick={onLoadLineage}
          className="mt-2 rounded-md border border-[var(--color-border-default)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
        >
          {lineageBusy ? "读取中…" : "读取 exact release lineage"}
        </button>
        {lineage ? (
          <div className="mt-2 rounded-md bg-[var(--color-bg-secondary)] p-2 text-[11px] text-[var(--color-text-secondary)]">
            {lineage.nodes.length} 节点 / {lineage.edges.length} 边
            {lineage.cycles_detected ? " · 检测到循环" : ""}
            {lineage.truncated ? ` · 已截断（${lineage.truncation_reasons.join(", ")}）` : ""}
          </div>
        ) : null}
      </section>
    </aside>
  );
}
