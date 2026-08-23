"use client";

import type {
  SemanticExplorerObjectIdentity,
  SemanticRelationshipGraphEdge,
  SemanticRelationshipGraphNode,
  SemanticRelationshipSearchResult,
} from "@data-agent/contracts";
import { useEffect, useRef, useState } from "react";

interface RelationshipGraphProps {
  readonly result: SemanticRelationshipSearchResult;
  readonly onSelectObject: (identity: SemanticExplorerObjectIdentity) => void;
}

interface Position {
  readonly x: number;
  readonly y: number;
}

const WIDTH = 920;
const HEIGHT = 560;
const CATEGORY_COLOR = {
  BIZ: "#0f766e",
  JOIN: "#2563eb",
  FORMULA: "#7c3aed",
  BIND: "#c2410c",
  GOVERN: "#64748b",
} as const;

function initialPositions(nodes: readonly SemanticRelationshipGraphNode[]): Map<string, Position> {
  const positions = new Map<string, Position>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.65)));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const horizontal = WIDTH / (columns + 1);
  const vertical = HEIGHT / (rows + 1);
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offset = row % 2 === 0 ? 0 : horizontal * 0.25;
    positions.set(node.node_key, {
      x: horizontal * (column + 1) + offset,
      y: vertical * (row + 1),
    });
  });
  return positions;
}

function nodeLabel(node: SemanticRelationshipGraphNode): string {
  return node.node_type === "semantic_object"
    ? `${node.name} · ${node.object.identity.kind}`
    : `${node.name} · ${node.governance_kind}`;
}

function nodeIdentity(node: SemanticRelationshipGraphNode): string {
  return node.node_type === "semantic_object"
    ? `${node.object.identity.kind}:${node.object.identity.object_id}`
    : `${node.governance_kind}:${node.governance_id}`;
}

export function RelationshipGraph({ result, onSelectObject }: RelationshipGraphProps) {
  const [positions, setPositions] = useState(() => initialPositions(result.nodes));
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(
    result.nodes[0]?.node_key ?? null,
  );
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const drag = useRef<
    | { readonly kind: "pan"; readonly pointerId: number; readonly x: number; readonly y: number }
    | {
        readonly kind: "node";
        readonly pointerId: number;
        readonly nodeKey: string;
        readonly x: number;
        readonly y: number;
      }
    | null
  >(null);
  useEffect(() => {
    const nextPositions = initialPositions(result.nodes);
    const term = result.term?.trim().toLocaleLowerCase("en-US") ?? "";
    const focusedNode =
      term.length > 0
        ? result.nodes.find((node) =>
            `${node.name}\u0000${nodeIdentity(node)}`.toLocaleLowerCase("en-US").includes(term),
          )
        : null;
    setPositions(nextPositions);
    setSelectedNodeKey(focusedNode?.node_key ?? result.nodes[0]?.node_key ?? null);
    setSelectedEdgeKey(null);
    const focusedPosition = focusedNode ? nextPositions.get(focusedNode.node_key) : null;
    setTransform(
      focusedPosition
        ? {
            x: WIDTH / 2 - focusedPosition.x * 1.25,
            y: HEIGHT / 2 - focusedPosition.y * 1.25,
            scale: 1.25,
          }
        : { x: 0, y: 0, scale: 1 },
    );
  }, [result.nodes, result.term]);

  const selectedNode = result.nodes.find((node) => node.node_key === selectedNodeKey) ?? null;
  const selectedEdge = result.edges.find((edge) => edge.edge_key === selectedEdgeKey) ?? null;

  function selectNode(node: SemanticRelationshipGraphNode) {
    setSelectedNodeKey(node.node_key);
    setSelectedEdgeKey(null);
    if (node.node_type === "semantic_object") onSelectObject(node.object.identity);
  }

  function startNodeDrag(
    event: React.PointerEvent<SVGGElement>,
    node: SemanticRelationshipGraphNode,
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind: "node",
      pointerId: event.pointerId,
      nodeKey: node.node_key,
      x: event.clientX,
      y: event.clientY,
    };
    selectNode(node);
  }

  function movePointer(event: React.PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - active.x;
    const deltaY = event.clientY - active.y;
    if (active.kind === "pan") {
      setTransform((current) => ({
        ...current,
        x: current.x + deltaX,
        y: current.y + deltaY,
      }));
      drag.current = { ...active, x: event.clientX, y: event.clientY };
      return;
    }
    setPositions((current) => {
      const position = current.get(active.nodeKey);
      if (!position) return current;
      const next = new Map(current);
      next.set(active.nodeKey, {
        x: position.x + deltaX / transform.scale,
        y: position.y + deltaY / transform.scale,
      });
      return next;
    });
    drag.current = { ...active, x: event.clientX, y: event.clientY };
  }

  function stopPointer(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  if (result.nodes.length === 0) {
    return (
      <div className="flex min-h-80 items-center justify-center px-6 text-center text-sm text-[var(--color-text-secondary)]">
        当前查询没有返回关系节点。可清空搜索词、增加 hop 或切换关系类别。
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-default)] px-3 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              result.source === "NEO4J"
                ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-200"
            }`}
          >
            {result.source === "NEO4J" ? "Neo4j sealed index" : "PostgreSQL fallback"}
          </span>
          <span className="text-[var(--color-text-secondary)]">
            {result.index_state}
            {result.index_reason_code ? ` · ${result.index_reason_code}` : ""}
          </span>
          <span className="text-[var(--color-text-tertiary)]">
            {result.nodes.length} nodes · {result.edges.length} edges ·{" "}
            {result.explanation.traversed_hops}
            hops
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setTransform((current) => ({
                ...current,
                scale: Math.min(2.5, current.scale * 1.2),
              }))
            }
            className="rounded border border-[var(--color-border-default)] px-2 py-1"
            aria-label="放大关系图"
          >
            +
          </button>
          <button
            type="button"
            onClick={() =>
              setTransform((current) => ({
                ...current,
                scale: Math.max(0.35, current.scale / 1.2),
              }))
            }
            className="rounded border border-[var(--color-border-default)] px-2 py-1"
            aria-label="缩小关系图"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
            className="rounded border border-[var(--color-border-default)] px-2 py-1"
          >
            Fit
          </button>
        </div>
      </div>

      {result.truncated ? (
        <p className="border-b border-[var(--color-border-default)] bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          结果已按 {result.truncation_reasons.join(" / ")}{" "}
          截断；图仅表示已发布关系合同，不表示因果或 Join 安全性。
        </p>
      ) : null}

      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0 overflow-auto bg-[radial-gradient(circle_at_center,var(--color-border-default)_1px,transparent_1px)] bg-[size:22px_22px]">
          <svg
            role="img"
            aria-labelledby="relationship-graph-title relationship-graph-description"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="min-h-[560px] min-w-[720px] touch-none select-none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                kind: "pan",
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
            }}
            onPointerMove={movePointer}
            onPointerUp={stopPointer}
            onPointerCancel={stopPointer}
            onWheel={(event) => {
              event.preventDefault();
              setTransform((current) => ({
                ...current,
                scale: Math.min(
                  2.5,
                  Math.max(0.35, current.scale * (event.deltaY > 0 ? 0.9 : 1.1)),
                ),
              }));
            }}
          >
            <title id="relationship-graph-title">语义关系搜索图</title>
            <desc id="relationship-graph-description">
              {result.explanation.summary} 可拖动节点、平移画布并缩放。
            </desc>
            <defs>
              {Object.entries(CATEGORY_COLOR).map(([category, color]) => (
                <marker
                  key={category}
                  id={`relationship-arrow-${category}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill={color} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
              {result.edges.map((edge) => {
                const source = positions.get(edge.source_node_key);
                const target = positions.get(edge.target_node_key);
                if (!source || !target) return null;
                const selected = edge.edge_key === selectedEdgeKey;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: SVG geometry must remain inside the graph; the table view is the semantic keyboard fallback.
                  <g
                    key={edge.edge_key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${edge.category} relationship ${edge.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEdgeKey(edge.edge_key);
                      setSelectedNodeKey(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedEdgeKey(edge.edge_key);
                        setSelectedNodeKey(null);
                      }
                    }}
                  >
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={CATEGORY_COLOR[edge.category]}
                      strokeWidth={selected ? 3 : 1.6}
                      opacity={selected ? 1 : 0.72}
                      markerEnd={`url(#relationship-arrow-${edge.category})`}
                    />
                    {result.edges.length <= 80 || selected ? (
                      <text
                        x={(source.x + target.x) / 2}
                        y={(source.y + target.y) / 2 - 5}
                        textAnchor="middle"
                        fontSize="9"
                        fill={CATEGORY_COLOR[edge.category]}
                        stroke="var(--color-bg-primary)"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {edge.label.slice(0, 34)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {result.nodes.map((node) => {
                const position = positions.get(node.node_key);
                if (!position) return null;
                const selected = node.node_key === selectedNodeKey;
                const fill =
                  node.node_type === "governance_object"
                    ? "#475569"
                    : node.object.restricted
                      ? "#b45309"
                      : "var(--color-accent)";
                return (
                  // biome-ignore lint/a11y/useSemanticElements: SVG geometry must remain inside the graph; the table view is the semantic keyboard fallback.
                  <g
                    key={node.node_key}
                    role="button"
                    tabIndex={0}
                    aria-label={nodeLabel(node)}
                    transform={`translate(${position.x} ${position.y})`}
                    onPointerDown={(event) => startNodeDrag(event, node)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectNode(node);
                      }
                    }}
                  >
                    <circle
                      r={selected ? 17 : 12}
                      fill={selected ? fill : "var(--color-bg-primary)"}
                      stroke={fill}
                      strokeWidth={selected ? 4 : 2.5}
                    />
                    {(result.nodes.length <= 45 || selected) && (
                      <text
                        y={selected ? 31 : 27}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight={selected ? 650 : 500}
                        fill="var(--color-text-secondary)"
                        stroke="var(--color-bg-primary)"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {node.name.slice(0, 22)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <aside className="border-t border-[var(--color-border-default)] p-3 text-xs lg:border-t-0 lg:border-l">
          <h3 className="font-semibold text-[var(--color-text-primary)]">Selection contract</h3>
          {selectedNode ? (
            <div className="mt-3 space-y-2">
              <p className="font-medium text-[var(--color-text-primary)]">{selectedNode.name}</p>
              <p className="break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
                {nodeIdentity(selectedNode)}
              </p>
              <dl className="space-y-1 text-[var(--color-text-secondary)]">
                <div>
                  <dt className="inline font-medium">Type: </dt>
                  <dd className="inline">{selectedNode.node_type}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Digest: </dt>
                  <dd className="inline break-all font-mono text-[10px]">
                    {selectedNode.canonical_digest}
                  </dd>
                </div>
              </dl>
            </div>
          ) : selectedEdge ? (
            <EdgeContractDetail edge={selectedEdge} />
          ) : (
            <p className="mt-3 text-[var(--color-text-tertiary)]">
              选择节点或关系边查看已发布合同。
            </p>
          )}
          <div className="mt-4 border-t border-[var(--color-border-default)] pt-3 text-[10px] text-[var(--color-text-tertiary)]">
            <p>{result.explanation.summary}</p>
            <p className="mt-2 break-all font-mono">manifest {result.manifest_digest ?? "none"}</p>
            <p className="mt-1">PostgreSQL authority revalidated: yes</p>
          </div>
        </aside>
      </div>

      <section
        aria-labelledby="relationship-accessible-table-title"
        className="border-t border-[var(--color-border-default)]"
      >
        <h3
          id="relationship-accessible-table-title"
          className="px-3 pt-3 text-xs font-semibold text-[var(--color-text-primary)]"
        >
          Accessible relationship table
        </h3>
        <div className="max-h-72 overflow-auto px-3 pb-3">
          <table className="mt-2 w-full border-collapse text-left text-[11px]">
            <thead className="sticky top-0 bg-[var(--color-bg-primary)] text-[var(--color-text-tertiary)]">
              <tr>
                <th className="border-b px-2 py-1.5">Item</th>
                <th className="border-b px-2 py-1.5">Label</th>
                <th className="border-b px-2 py-1.5">Published identity / contract</th>
              </tr>
            </thead>
            <tbody>
              {result.nodes.map((node) => (
                <tr key={`table-node-${node.node_key}`}>
                  <td className="border-b px-2 py-1.5">Node</td>
                  <td className="border-b px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => selectNode(node)}
                      className="text-left font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
                    >
                      {node.name}
                    </button>
                  </td>
                  <td className="border-b px-2 py-1.5 font-mono text-[10px]">
                    {nodeIdentity(node)}
                  </td>
                </tr>
              ))}
              {result.edges.map((edge) => (
                <tr key={`table-edge-${edge.edge_key}`}>
                  <td className="border-b px-2 py-1.5">Edge · {edge.category}</td>
                  <td className="border-b px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEdgeKey(edge.edge_key);
                        setSelectedNodeKey(null);
                      }}
                      className="text-left font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
                    >
                      {edge.label}
                    </button>
                  </td>
                  <td className="border-b px-2 py-1.5 font-mono text-[10px]">
                    {JSON.stringify(edge.contract)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EdgeContractDetail({ edge }: { readonly edge: SemanticRelationshipGraphEdge }) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: CATEGORY_COLOR[edge.category] }}
        >
          {edge.category}
        </span>
        <span className="font-medium text-[var(--color-text-primary)]">{edge.label}</span>
      </div>
      <p className="break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
        {edge.edge_id}
      </p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-bg-secondary)] p-2 text-[10px] text-[var(--color-text-secondary)]">
        {JSON.stringify(edge.contract, null, 2)}
      </pre>
    </div>
  );
}
