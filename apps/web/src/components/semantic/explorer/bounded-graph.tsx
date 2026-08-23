import type { SemanticExplorerObjectIdentity } from "@data-agent/contracts";
import type { BoundedExplorerGraph } from "./graph";
import { explorerIdentityKey } from "./view-model";

interface BoundedGraphProps {
  readonly graph: BoundedExplorerGraph;
  readonly selected: SemanticExplorerObjectIdentity | null;
  readonly onSelect: (identity: SemanticExplorerObjectIdentity) => void;
}

const WIDTH = 760;
const HEIGHT = 460;

export function BoundedGraph({ graph, selected, onSelect }: BoundedGraphProps) {
  if (graph.nodes.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-[var(--color-text-secondary)]">
        选择一个对象后显示它的有界关系邻域。
      </div>
    );
  }

  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) * 0.36;
  const positions = new Map(
    graph.nodes.map((node, index) => {
      if (graph.nodes.length === 1) return [explorerIdentityKey(node.identity), [centerX, centerY]];
      const angle = (Math.PI * 2 * index) / graph.nodes.length - Math.PI / 2;
      return [
        explorerIdentityKey(node.identity),
        [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius],
      ];
    }),
  );
  const selectedKey = selected ? explorerIdentityKey(selected) : null;

  return (
    <div className="overflow-auto">
      {graph.truncated ? (
        <p className="border-b border-[var(--color-border-default)] bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          当前图已截断为最多 250 节点 / 500 边；路径仅表示已发布依赖或导航关系，不代表因果或安全
          Join。
        </p>
      ) : null}
      <label className="m-3 block max-w-sm text-[11px] text-[var(--color-text-tertiary)]">
        图节点焦点
        <select
          value={selectedKey ?? ""}
          onChange={(event) => {
            const node = graph.nodes.find(
              (candidate) => explorerIdentityKey(candidate.identity) === event.target.value,
            );
            if (node) onSelect(node.identity);
          }}
          className="mt-1 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
        >
          {graph.nodes.map((node) => (
            <option
              key={explorerIdentityKey(node.identity)}
              value={explorerIdentityKey(node.identity)}
            >
              {node.name} · {node.identity.kind}
            </option>
          ))}
        </select>
      </label>
      <svg
        role="img"
        aria-labelledby="semantic-explorer-graph-title semantic-explorer-graph-description"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="min-h-[460px] min-w-[680px]"
      >
        <title id="semantic-explorer-graph-title">语义对象关系邻域</title>
        <desc id="semantic-explorer-graph-description">
          {graph.nodes.length} 个节点，{graph.edges.length} 条已发布关系边。
        </desc>
        {graph.edges.map((edge) => {
          const source = positions.get(explorerIdentityKey(edge.source));
          const target = positions.get(explorerIdentityKey(edge.target));
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.kind}:${edge.edge_id}`}
              data-explorer-edge="true"
              x1={source[0]}
              y1={source[1]}
              x2={target[0]}
              y2={target[1]}
              stroke="var(--color-border-default)"
              strokeWidth="1.5"
            />
          );
        })}
        {graph.nodes.map((node) => {
          const position = positions.get(explorerIdentityKey(node.identity));
          if (!position) return null;
          const active = explorerIdentityKey(node.identity) === selectedKey;
          return (
            <g
              key={explorerIdentityKey(node.identity)}
              data-explorer-node="true"
              transform={`translate(${position[0]} ${position[1]})`}
            >
              <circle
                r={active ? 15 : 10}
                fill={active ? "var(--color-accent)" : "var(--color-bg-primary)"}
                stroke={active ? "var(--color-accent)" : "var(--color-text-tertiary)"}
                strokeWidth="2"
              />
              {(graph.nodes.length <= 40 || active) && (
                <text
                  y={active ? 29 : 23}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--color-text-secondary)"
                >
                  {node.name.slice(0, 18)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
