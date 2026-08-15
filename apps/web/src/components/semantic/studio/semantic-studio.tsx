"use client";

import type {
  SemanticAuthoringPublicEvent,
  SemanticAuthoringState,
  SemanticGraphCluster,
  SemanticGraphEntryStatus,
  SemanticGraphNode,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
  SemanticNodeType,
} from "@data-agent/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  expandSemanticStudioCluster,
  loadSemanticStudio,
  resumeSemanticAuthoring,
  type SemanticStudioSnapshot,
  startSemanticAuthoring,
  subscribeSemanticAuthoringEvents,
} from "@/lib/semantic-studio-api";
import {
  filterSemanticNodes,
  mergeAuthoringEvents,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
  type SemanticStudioView,
} from "@/lib/semantic-studio-model";
import { SemanticAgentComposer } from "./semantic-agent-composer";
import { SemanticGraphCanvas } from "./semantic-graph-canvas";
import { SemanticInspector } from "./semantic-inspector";
import { SemanticNodeList } from "./semantic-node-list";

const NODE_TYPES = [
  "BUSINESS_SUBJECT",
  "DIMENSION",
  "METRIC",
  "FORMULA",
  "PHYSICAL_TABLE",
  "PHYSICAL_COLUMN",
] as const satisfies readonly SemanticNodeType[];

const STATUSES = [
  "PUBLISHED",
  "ADDED",
  "MODIFIED",
  "RETIRED",
] as const satisfies readonly SemanticGraphEntryStatus[];

function runIsOpen(state: SemanticAuthoringState | null): boolean {
  return state?.run.status === "RUNNING" || state?.run.status === "WAITING_CLARIFICATION";
}

export function SemanticStudio({
  workspaceId,
  initialSnapshot,
  initialDraft = "",
  preview = false,
}: {
  readonly workspaceId: string;
  readonly initialSnapshot: SemanticStudioSnapshot | null;
  readonly initialDraft?: string;
  readonly preview?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [view, setView] = useState<SemanticStudioView>("nodes");
  const [loading, setLoading] = useState(initialSnapshot === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nodeType, setNodeType] = useState<SemanticNodeType | "ALL">("ALL");
  const [status, setStatus] = useState<SemanticGraphEntryStatus | "ALL">("ALL");
  const [owner, setOwner] = useState("");
  const [nodeDomain, setNodeDomain] = useState("");
  const [lifecycle, setLifecycle] = useState<SemanticGraphNode["lifecycle"] | "ALL">("ALL");
  const [listCursor, setListCursor] = useState(0);
  const [selectedNode, setSelectedNode] = useState<SemanticGraphReadNode | null>(() => {
    if (!initialSnapshot?.local) return null;
    return (
      initialSnapshot.local.nodes.find(
        ({ node }) => node.node_id === initialSnapshot.local?.center_node_id,
      ) ?? null
    );
  });
  const [selectedEdge, setSelectedEdge] = useState<SemanticGraphReadEdge | null>(null);
  const [hops, setHops] = useState<1 | 2>(1);
  const [draft, setDraft] = useState(initialDraft);
  const [authoringState, setAuthoringState] = useState<SemanticAuthoringState | null>(
    initialSnapshot?.authoring?.state ?? null,
  );
  const [events, setEvents] = useState<readonly SemanticAuthoringPublicEvent[]>(
    initialSnapshot?.authoring?.events ?? [],
  );
  const [authoringBusy, setAuthoringBusy] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const lastPatchSequence = useRef(0);
  const eventCursor = useRef(initialSnapshot?.authoring?.events.at(-1)?.sequence ?? 0);
  const listQuery = useRef<{
    cursor: number;
    limit: number;
    search?: string;
    nodeType?: SemanticNodeType;
    owner?: string;
    lifecycle?: SemanticGraphNode["lifecycle"];
    status?: SemanticGraphEntryStatus;
    nodeDomain?: string;
  }>({ cursor: 0, limit: 250 });

  const load = useCallback(
    async (
      input: { domain?: string; selectedNodeId?: string; runId?: string; hops?: 1 | 2 } = {},
    ) => {
      if (preview) return;
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadSemanticStudio(
          workspaceId,
          { ...listQuery.current, ...input },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSnapshot(loaded);
        if (loaded.authoring) {
          setAuthoringState(loaded.authoring.state);
          setEvents((current) => mergeAuthoringEvents(current, loaded.authoring?.events ?? []));
        }
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "Semantic Studio 暂时不可用。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [preview, workspaceId],
  );

  useEffect(() => {
    if (initialSnapshot === null) void load();
    return () => activeRequest.current?.abort();
  }, [initialSnapshot, load]);

  useEffect(() => {
    eventCursor.current = events.at(-1)?.sequence ?? eventCursor.current;
  }, [events]);

  const authoringRunId = authoringState?.run.authoring_run_id ?? null;
  const authoringRunOpen = runIsOpen(authoringState);
  const semanticDomain = snapshot?.semantic_domain ?? null;

  useEffect(() => {
    if (preview || !semanticDomain || !authoringRunId || !authoringRunOpen) return;
    return subscribeSemanticAuthoringEvents(
      workspaceId,
      {
        semanticDomain,
        runId: authoringRunId,
        after: eventCursor.current,
      },
      {
        onAuthoring: (result) => {
          setAuthoringState(result.state);
          setEvents((current) => mergeAuthoringEvents(current, result.events));
          const newestPatch = [...result.events]
            .reverse()
            .find((event) => event.type === "graph_patch");
          if (newestPatch && newestPatch.sequence > lastPatchSequence.current) {
            lastPatchSequence.current = newestPatch.sequence;
            void load({
              domain: semanticDomain,
              selectedNodeId: selectedNode?.node.node_id,
              runId: result.state.run.authoring_run_id,
              hops,
            });
          }
        },
        onError: setError,
      },
    );
  }, [
    authoringRunId,
    authoringRunOpen,
    hops,
    load,
    preview,
    selectedNode?.node.node_id,
    semanticDomain,
    workspaceId,
  ]);

  const filteredNodes = useMemo(
    () =>
      filterSemanticNodes(snapshot?.list.items ?? [], {
        search,
        nodeType,
        status,
        owner,
        lifecycle,
        domain: nodeDomain,
      }),
    [lifecycle, nodeDomain, nodeType, owner, search, snapshot?.list.items, status],
  );
  const candidateCount =
    snapshot?.list.items.filter((item) => item.status !== "PUBLISHED").length ?? 0;

  async function selectAndLoadNode(node: SemanticGraphReadNode, openGraph: boolean) {
    setSelectedNode(node);
    setSelectedEdge(null);
    if (openGraph) setView("local");
    if (!preview && snapshot?.local?.center_node_id !== node.node.node_id) {
      await load({
        domain: snapshot?.semantic_domain,
        selectedNodeId: node.node.node_id,
        runId: authoringState?.run.authoring_run_id,
        hops,
      });
    }
  }

  async function applyListFilters(cursor = 0) {
    listQuery.current = {
      cursor,
      limit: 250,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(nodeType === "ALL" ? {} : { nodeType }),
      ...(status === "ALL" ? {} : { status }),
      ...(owner.trim() ? { owner: owner.trim() } : {}),
      ...(lifecycle === "ALL" ? {} : { lifecycle }),
      ...(nodeDomain ? { nodeDomain } : {}),
    };
    setListCursor(cursor);
    if (preview) return;
    await load({
      domain: snapshot?.semantic_domain,
      selectedNodeId: selectedNode?.node.node_id,
      runId: authoringState?.run.authoring_run_id,
      hops,
    });
  }

  async function changeHops(nextHops: 1 | 2) {
    setHops(nextHops);
    if (!preview && selectedNode) {
      await load({
        domain: snapshot?.semantic_domain,
        selectedNodeId: selectedNode.node.node_id,
        runId: authoringState?.run.authoring_run_id,
        hops: nextHops,
      });
    }
  }

  async function expandCluster(cluster: SemanticGraphCluster) {
    if (!snapshot) return;
    if (preview) {
      setSnapshot({
        ...snapshot,
        full: {
          ...snapshot.full,
          clusters: snapshot.full.clusters.filter((item) => item.cluster_id !== cluster.cluster_id),
          nodes: snapshot.list.items.slice(0, Math.min(cluster.node_count, 8)),
          glyph_count: Math.min(cluster.node_count, 8) + snapshot.full.clusters.length - 1,
        },
      });
      return;
    }
    setLoading(true);
    try {
      const full = await expandSemanticStudioCluster(workspaceId, {
        domain: snapshot.semantic_domain,
        clusterId: cluster.cluster_id,
        runId: authoringState?.run.authoring_run_id,
      });
      setSnapshot({ ...snapshot, full });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法展开分群。");
    } finally {
      setLoading(false);
    }
  }

  async function submitAuthoring() {
    if (!snapshot || draft.trim().length === 0 || authoringBusy) return;
    setAuthoringBusy(true);
    setError(null);
    if (preview) {
      const previewEvents: readonly SemanticAuthoringPublicEvent[] = [
        {
          schema_version: "semantic-authoring-public-event@1.0.0",
          event_id: "10000000-0000-4000-8000-000000000091",
          run_id: "10000000-0000-4000-8000-000000000099",
          sequence: 1,
          occurred_at: new Date().toISOString(),
          type: "stage",
          payload: {
            phase: "intent.classification",
            status: "COMPLETED",
            summary: "已识别指标与公式修改意图",
          },
        },
        {
          schema_version: "semantic-authoring-public-event@1.0.0",
          event_id: "10000000-0000-4000-8000-000000000092",
          run_id: "10000000-0000-4000-8000-000000000099",
          sequence: 2,
          occurred_at: new Date().toISOString(),
          type: "tool",
          payload: {
            call_id: "preview-search",
            tool_name: "search_semantic_nodes",
            status: "COMPLETED",
            summary: "已搜索并复用现有稳定身份",
            error_code: null,
          },
        },
        {
          schema_version: "semantic-authoring-public-event@1.0.0",
          event_id: "10000000-0000-4000-8000-000000000093",
          run_id: "10000000-0000-4000-8000-000000000099",
          sequence: 3,
          occurred_at: new Date().toISOString(),
          type: "graph_patch",
          payload: {
            patch_id: "10000000-0000-4000-8000-000000000098",
            from_working_revision: 0,
            to_working_revision: 1,
            before_digest: `sha256:${"5".repeat(64)}`,
            after_digest: `sha256:${"6".repeat(64)}`,
            operation_count: 1,
            affected_node_ids: [selectedNode?.node.node_id ?? "metric-product-count"],
            affected_edge_ids: [],
          },
        },
        {
          schema_version: "semantic-authoring-public-event@1.0.0",
          event_id: "10000000-0000-4000-8000-000000000094",
          run_id: "10000000-0000-4000-8000-000000000099",
          sequence: 4,
          occurred_at: new Date().toISOString(),
          type: "validation",
          payload: {
            receipt_version: "semantic-authoring-validation@1.0.0",
            graph_digest: `sha256:${"6".repeat(64)}`,
            compiler_version: "semantic-graph-validator@2.0.0",
            valid: true,
            issues: [],
            receipt_digest: `sha256:${"7".repeat(64)}`,
          },
        },
      ];
      setEvents(previewEvents);
      setDraft("");
      window.setTimeout(() => setAuthoringBusy(false), 350);
      return;
    }
    try {
      const result = await startSemanticAuthoring(workspaceId, {
        semantic_domain: snapshot.semantic_domain,
        instruction: draft.trim(),
        selected_node_id: selectedNode?.node.node_id ?? null,
        selected_edge_id: selectedEdge?.edge.edge_id ?? null,
        idempotency_key: crypto.randomUUID(),
      });
      setAuthoringState(result.state);
      setEvents((current) => mergeAuthoringEvents(current, result.events));
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent 语义创作未能启动。");
    } finally {
      setAuthoringBusy(false);
    }
  }

  async function resume(answer: string) {
    const clarification = authoringState?.run.clarification;
    if (!snapshot || !authoringState || !clarification) return;
    setAuthoringBusy(true);
    try {
      const result = await resumeSemanticAuthoring(workspaceId, {
        semantic_domain: snapshot.semantic_domain,
        run_id: authoringState.run.authoring_run_id,
        clarification_id: clarification.clarification_id,
        answer,
        idempotency_key: crypto.randomUUID(),
      });
      setAuthoringState(result.state);
      setEvents((current) => mergeAuthoringEvents(current, result.events));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法提交澄清答案。");
    } finally {
      setAuthoringBusy(false);
    }
  }

  if (!snapshot && loading) {
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <div className="text-sm text-[var(--color-text-secondary)]">
          正在读取 Graph v2 权威投影…
        </div>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <div className="rounded-lg border border-[var(--color-border-default)] bg-white p-10 text-center">
          <h1 className="text-base font-semibold">Semantic Studio 尚无可浏览的 Graph v2</h1>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            {error ?? "当前工作空间没有已绑定的 Graph v2 release。请先运行确定性迁移并发布候选。"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg-secondary)]">
      <div className="mx-auto max-w-[1600px] px-4 pb-5 pt-4">
        <header className="flex flex-col gap-3 border-b border-[var(--color-border-default)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#355f54]">
              <span>Semantic Layer</span>
              <span className="text-[var(--color-text-muted)]">/</span>
              <span>Ontology Graph</span>
              {preview ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">交互预览</span>
              ) : null}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
              语义本体工作台
            </h1>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Node 保存对象自身，Edge 表达公式、归属、依赖与物理绑定。所有变更由 Agent 写入候选图。
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <label className="text-[var(--color-text-secondary)]" htmlFor="semantic-domain">
              语义域
            </label>
            <select
              id="semantic-domain"
              value={snapshot.semantic_domain}
              onChange={(event) => void load({ domain: event.target.value })}
              className="rounded-md border border-[var(--color-border-default)] bg-white px-2.5 py-1.5 text-[var(--color-text-primary)]"
            >
              {snapshot.available_domains.map((domain) => (
                <option key={domain}>{domain}</option>
              ))}
            </select>
            <span className="rounded bg-white px-2.5 py-1.5 text-[var(--color-text-secondary)]">
              {snapshot.release.label}
            </span>
            {candidateCount > 0 ? (
              <span className="rounded bg-amber-50 px-2.5 py-1.5 font-medium text-amber-800">
                Candidate · {candidateCount} 变更
              </span>
            ) : (
              <span className="rounded bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-800">
                Published
              </span>
            )}
          </div>
        </header>

        <div className="mt-4 flex flex-col gap-3">
          <nav
            className="flex flex-col gap-3 rounded-lg border border-[var(--color-border-default)] bg-white p-2 md:flex-row md:items-center md:justify-between"
            aria-label="Semantic Studio 视图"
          >
            <div className="flex items-center gap-1">
              {(
                [
                  ["nodes", "Node List", snapshot.list.total],
                  ["local", "局部关系图", snapshot.local?.nodes.length ?? 0],
                  ["full", "全图", snapshot.full.glyph_count],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`rounded-md px-3 py-2 text-xs font-medium ${view === key ? "bg-[#e9f0ed] text-[#355f54]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)]"}`}
                >
                  {label}
                  <span className="ml-2 font-mono text-[10px]">{count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2 md:max-w-[720px] md:flex-nowrap">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 Node 名称、定义、ID…"
                className="w-full min-w-0 flex-1 rounded-md border border-[var(--color-border-default)] bg-[#fafbfa] px-3 py-2 text-xs outline-none focus:border-[var(--color-border-focused)] md:w-auto"
              />
              <select
                aria-label="按节点类型筛选"
                value={nodeType}
                onChange={(event) => setNodeType(event.target.value as SemanticNodeType | "ALL")}
                className="rounded-md border border-[var(--color-border-default)] bg-white px-2 py-2 text-[11px]"
              >
                <option value="ALL">全部类型</option>
                {NODE_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {SEMANTIC_NODE_PRESENTATION[item].label}
                  </option>
                ))}
              </select>
              <select
                aria-label="按候选状态筛选"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SemanticGraphEntryStatus | "ALL")
                }
                className="rounded-md border border-[var(--color-border-default)] bg-white px-2 py-2 text-[11px]"
              >
                <option value="ALL">全部状态</option>
                {STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {SEMANTIC_STATUS_PRESENTATION[item].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setDraft("新增语义节点：");
                }}
                className="whitespace-nowrap rounded-md bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[var(--color-accent-hover)]"
              >
                ＋ Agent 新增
              </button>
            </div>
          </nav>

          {view === "nodes" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-[11px]">
              <span className="font-semibold text-[var(--color-text-secondary)]">更多筛选</span>
              <select
                aria-label="按 Node 领域筛选"
                value={nodeDomain}
                onChange={(event) => setNodeDomain(event.target.value)}
                className="rounded border border-[var(--color-border-default)] bg-white px-2 py-1.5"
              >
                <option value="">全部 Node 领域</option>
                {snapshot.list.domains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="Owner"
                className="w-36 rounded border border-[var(--color-border-default)] px-2 py-1.5"
              />
              <select
                aria-label="按生命周期筛选"
                value={lifecycle}
                onChange={(event) =>
                  setLifecycle(event.target.value as SemanticGraphNode["lifecycle"] | "ALL")
                }
                className="rounded border border-[var(--color-border-default)] bg-white px-2 py-1.5"
              >
                <option value="ALL">全部生命周期</option>
                <option value="ACTIVE">Active</option>
                <option value="DEPRECATED">Deprecated</option>
                <option value="RETIRED">Retired</option>
              </select>
              <button
                type="button"
                onClick={() => void applyListFilters(0)}
                className="rounded bg-[#e9f0ed] px-3 py-1.5 font-semibold text-[#355f54]"
              >
                应用筛选
              </button>
              <span className="ml-auto text-[var(--color-text-secondary)]">
                服务端分页 · 每页最多 250
              </span>
            </div>
          ) : null}

          {view === "local" ? (
            <div className="flex items-center justify-between text-[11px] text-[var(--color-text-secondary)]">
              <span>
                中心节点：{selectedNode?.node.name ?? snapshot.local?.center_node_id ?? "未选择"}
              </span>
              <div className="flex rounded-md border border-[var(--color-border-default)] bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => void changeHops(1)}
                  className={`rounded px-2.5 py-1 ${hops === 1 ? "bg-[var(--color-bg-overlay)] font-semibold" : ""}`}
                >
                  1-hop
                </button>
                <button
                  type="button"
                  onClick={() => void changeHops(2)}
                  className={`rounded px-2.5 py-1 ${hops === 2 ? "bg-[var(--color-bg-overlay)] font-semibold" : ""}`}
                >
                  2-hop
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="min-w-0 flex-1">
              {view === "nodes" ? (
                <SemanticNodeList
                  key={listCursor}
                  nodes={filteredNodes}
                  selectedNodeId={selectedNode?.node.node_id ?? null}
                  onSelect={(node) => void selectAndLoadNode(node, false)}
                  onOpenGraph={(node) => void selectAndLoadNode(node, true)}
                  total={snapshot.list.total}
                  cursor={listCursor}
                  nextCursor={snapshot.list.next_cursor}
                  onPage={(cursor) => void applyListFilters(cursor)}
                />
              ) : (
                <SemanticGraphCanvas
                  mode={view}
                  local={snapshot.local}
                  full={snapshot.full}
                  selectedNodeId={selectedNode?.node.node_id ?? null}
                  selectedEdgeId={selectedEdge?.edge.edge_id ?? null}
                  onSelectNode={(node) => {
                    setSelectedNode(node);
                    setSelectedEdge(null);
                  }}
                  onSelectEdge={(edge) => {
                    setSelectedEdge(edge);
                    setSelectedNode(null);
                  }}
                  onExpandCluster={(cluster) => void expandCluster(cluster)}
                />
              )}
            </div>
            <SemanticInspector
              node={selectedNode}
              edge={selectedEdge}
              onClose={() => {
                setSelectedNode(null);
                setSelectedEdge(null);
              }}
              onAskAgent={(value) => setDraft(value)}
            />
          </div>
          {loading ? (
            <div className="fixed right-5 top-5 z-50 rounded bg-[#26302c] px-3 py-2 text-[11px] text-white shadow-lg">
              正在同步 Graph v2…
            </div>
          ) : null}
        </div>
      </div>
      <SemanticAgentComposer
        domain={snapshot.semantic_domain}
        releaseLabel={snapshot.release.label}
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        draft={draft}
        state={authoringState}
        events={events}
        busy={authoringBusy}
        error={error}
        onDraftChange={setDraft}
        onClearSelection={() => {
          setSelectedNode(null);
          setSelectedEdge(null);
        }}
        onSubmit={() => void submitAuthoring()}
        onResume={(answer) => void resume(answer)}
      />
    </main>
  );
}
