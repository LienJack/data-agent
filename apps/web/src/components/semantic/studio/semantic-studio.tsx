"use client";

import type {
  SemanticAuthoringPublicEvent,
  SemanticAuthoringState,
  SemanticEdgeFamily,
  SemanticGraphCluster,
  SemanticGraphEntryStatus,
  SemanticGraphNode,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
  SemanticNodeType,
} from "@data-agent/contracts";
import {
  CirclesThree,
  Database,
  ListBullets,
  MagnifyingGlass,
  Plus,
  ShareNetwork,
  SlidersHorizontal,
  Sparkle,
} from "@phosphor-icons/react";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLayoutStore } from "@/lib/layout-store";
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
  SEMANTIC_EDGE_FAMILY_PRESENTATION,
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
  "GLOSSARY_TERM",
] as const satisfies readonly SemanticNodeType[];

const EDGE_FAMILIES = [
  "BUSINESS",
  "ANALYTICAL",
  "FORMULA",
  "PHYSICAL",
  "JOIN",
  "PROVENANCE",
  "TERMINOLOGY",
] as const satisfies readonly SemanticEdgeFamily[];

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
  const [edgeFamily, setEdgeFamily] = useState<SemanticEdgeFamily | "ALL">("ALL");
  const [owner, setOwner] = useState("");
  const [nodeDomain, setNodeDomain] = useState("");
  const [lifecycle, setLifecycle] = useState<SemanticGraphNode["lifecycle"] | "ALL">("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const prefersReducedMotion = useReducedMotion();
  const setSidebarCollapsed = useLayoutStore((state) => state.setSidebarCollapsed);
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
    const media = window.matchMedia("(max-width: 767px)");
    const collapseForSmallScreen = () => {
      if (media.matches) setSidebarCollapsed(true);
    };
    collapseForSmallScreen();
    media.addEventListener("change", collapseForSmallScreen);
    return () => media.removeEventListener("change", collapseForSmallScreen);
  }, [setSidebarCollapsed]);

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
  const nodeTypeCounts = useMemo(() => {
    const counts = new Map<SemanticNodeType, number>(NODE_TYPES.map((type) => [type, 0]));
    for (const item of snapshot?.list.items ?? []) {
      counts.set(item.node.node_type, (counts.get(item.node.node_type) ?? 0) + 1);
    }
    return counts;
  }, [snapshot?.list.items]);

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
      const { semanticStudioPreviewExpandedFullGraph } = await import(
        "@/lib/semantic-studio-preview"
      );
      setSnapshot({
        ...snapshot,
        full: semanticStudioPreviewExpandedFullGraph(cluster.cluster_id),
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
      <main className="grid min-h-[70vh] place-items-center bg-[#f3f5f3] px-6">
        <div className="w-full max-w-sm border-l-2 border-[#356b5a] pl-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#356b5a]">
            Semantic authority
          </p>
          <p className="mt-2 text-sm font-medium text-[#27322e]">正在读取 Graph v2 权威投影</p>
          <div className="mt-4 h-px w-full overflow-hidden bg-[#dbe1dd]">
            <motion.div
              className="h-full w-1/3 bg-[#356b5a]"
              animate={prefersReducedMotion ? undefined : { x: ["-100%", "300%"] }}
              transition={
                prefersReducedMotion
                  ? undefined
                  : { duration: 1.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
              }
            />
          </div>
        </div>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="grid min-h-[70vh] place-items-center bg-[#f3f5f3] px-6 py-20">
        <div className="w-full max-w-xl border-y border-[#d8dfda] bg-white px-8 py-12 text-center shadow-[0_18px_50px_rgba(42,55,49,0.06)]">
          <Database className="mx-auto size-6 text-[#356b5a]" aria-hidden="true" />
          <h1 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-[#26312d]">
            Semantic Studio 尚无可浏览的 Graph v2
          </h1>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#66726d]">
            {error ?? "当前工作空间没有已绑定的 Graph v2 release。请先运行确定性迁移并发布候选。"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="min-h-screen bg-[#f2f4f2] text-[#26312d]">
        <div className="mx-auto max-w-[1760px] px-3 pb-4 pt-3 sm:px-5 lg:px-6">
          <header className="border-b border-[#d7ddd9] pb-5 pt-2">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#356b5a]">
                  <span>Semantic layer</span>
                  <span className="text-[#a4ada8]">/</span>
                  <span>Ontology workspace</span>
                  {preview ? (
                    <span className="border-l border-amber-300 pl-2 text-amber-700">交互预览</span>
                  ) : null}
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#202a26] sm:text-[28px]">
                  语义本体工作台
                </h1>
                <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[#63706a]">
                  Node 保存对象身份，Edge 表达业务、分析、公式与物理关系。所有编辑由 Agent
                  写入候选图。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
                <label className="font-medium text-[#65716c]" htmlFor="semantic-domain">
                  语义域
                </label>
                <select
                  id="semantic-domain"
                  value={snapshot.semantic_domain}
                  onChange={(event) => void load({ domain: event.target.value })}
                  className="h-9 border border-[#cfd7d2] bg-white px-3 text-[#2d3934] outline-none transition-colors focus:border-[#356b5a]"
                >
                  {snapshot.available_domains.map((domain) => (
                    <option key={domain}>{domain}</option>
                  ))}
                </select>
                <span className="border-l border-[#d7ddd9] pl-3 font-mono text-[10px] text-[#6c7772]">
                  {snapshot.release.label}
                </span>
                <span
                  className={`inline-flex h-7 items-center gap-1.5 px-2.5 font-semibold ${candidateCount > 0 ? "bg-[#fff4df] text-[#80530c]" : "bg-[#e8f2ed] text-[#2f6b58]"}`}
                >
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {candidateCount > 0 ? `Candidate · ${candidateCount}` : "Published"}
                </span>
              </div>
            </div>
          </header>

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

          <div className="mt-4 grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_318px]">
            <aside
              className="border-b border-[#d7ddd9] pb-3 lg:sticky lg:top-3 lg:self-start lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3"
              aria-label="语义工作台导航"
            >
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a8580]">
                视图
              </p>
              <nav
                className="grid grid-cols-3 gap-1 lg:block lg:space-y-1"
                aria-label="Semantic Studio 视图"
              >
                {(
                  [
                    ["nodes", "节点目录", snapshot.list.total, ListBullets],
                    ["local", "局部关系", snapshot.local?.nodes.length ?? 0, ShareNetwork],
                    ["full", "全局本体", snapshot.full.glyph_count, CirclesThree],
                  ] as const
                ).map(([key, label, count, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    aria-current={view === key ? "page" : undefined}
                    className={`relative flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left text-[12px] transition-colors ${view === key ? "text-[#285b4b]" : "text-[#66726d] hover:bg-white hover:text-[#2f3a36]"}`}
                  >
                    {view === key ? (
                      <motion.span
                        layoutId="semantic-view-marker"
                        className="absolute inset-y-1 left-0 w-0.5 bg-[#356b5a]"
                      />
                    ) : null}
                    <Icon
                      className="size-4 shrink-0"
                      weight={view === key ? "fill" : "regular"}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{label}</span>
                    <span className="ml-auto font-mono text-[10px] text-[#8a948f]">{count}</span>
                  </button>
                ))}
              </nav>

              <div className="mt-7 hidden border-t border-[#d7ddd9] px-2 pt-5 lg:block">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a8580]">
                    对象类型
                  </p>
                  <span className="font-mono text-[9px] text-[#9aa39f]">当前页</span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {NODE_TYPES.map((item) => {
                    const presentation = SEMANTIC_NODE_PRESENTATION[item];
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setNodeType(item);
                          setView("nodes");
                        }}
                        className="flex w-full items-center gap-2 text-[11px] text-[#66726d] transition-colors hover:text-[#26312d]"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: presentation.fill }}
                          aria-hidden="true"
                        />
                        <span>{presentation.label}</span>
                        <span className="ml-auto font-mono text-[10px]">
                          {nodeTypeCounts.get(item) ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 hidden border-l-2 border-[#b6c9c1] px-3 py-1 lg:block">
                <p className="text-[10px] font-semibold text-[#356b5a]">Agent-only authoring</p>
                <p className="mt-1 text-[10px] leading-4 text-[#74807a]">
                  视图操作不写语义；变更只进入 Candidate。
                </p>
              </div>
            </aside>

            <motion.section layout className="min-w-0" aria-label="语义工作区">
              <div className="border border-[#d7ddd9] bg-white shadow-[0_12px_34px_rgba(38,52,45,0.045)]">
                <div className="flex flex-col gap-2 border-b border-[#d7ddd9] p-2.5 sm:flex-row sm:items-center">
                  <label className="relative min-w-0 flex-1">
                    <MagnifyingGlass
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#82908a]"
                      aria-hidden="true"
                    />
                    <span className="sr-only">搜索语义节点</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索名称、定义、稳定 ID…"
                      className="h-10 w-full border border-[#d4dbd7] bg-[#f8faf8] pl-9 pr-3 text-[12px] outline-none transition-colors placeholder:text-[#9aa49f] focus:border-[#356b5a] focus:bg-white"
                    />
                  </label>
                  <select
                    aria-label="按节点类型筛选"
                    value={nodeType}
                    onChange={(event) =>
                      setNodeType(event.target.value as SemanticNodeType | "ALL")
                    }
                    className="h-10 border border-[#d4dbd7] bg-white px-3 text-[11px] text-[#4f5c56] outline-none focus:border-[#356b5a]"
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
                    className="h-10 border border-[#d4dbd7] bg-white px-3 text-[11px] text-[#4f5c56] outline-none focus:border-[#356b5a]"
                  >
                    <option value="ALL">全部状态</option>
                    {STATUSES.map((item) => (
                      <option key={item} value={item}>
                        {SEMANTIC_STATUS_PRESENTATION[item].label}
                      </option>
                    ))}
                  </select>
                  {view === "nodes" ? (
                    <button
                      type="button"
                      onClick={() => setFiltersOpen((current) => !current)}
                      aria-expanded={filtersOpen}
                      className={`inline-flex h-10 items-center justify-center gap-2 border px-3 text-[11px] font-medium transition-colors ${filtersOpen ? "border-[#7fa293] bg-[#edf4f0] text-[#285b4b]" : "border-[#d4dbd7] text-[#59665f] hover:border-[#9aaba3]"}`}
                    >
                      <SlidersHorizontal className="size-4" aria-hidden="true" />
                      高级筛选
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDraft("新增语义节点：")}
                    className="inline-flex h-10 items-center justify-center gap-2 bg-[#356b5a] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#285b4b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#356b5a]"
                  >
                    <Plus className="size-4" weight="bold" aria-hidden="true" />
                    Agent 新增
                  </button>
                </div>

                {view === "nodes" && filtersOpen ? (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid gap-2 border-b border-[#d7ddd9] bg-[#f8faf8] p-3 sm:grid-cols-[1fr_150px_150px_auto]"
                  >
                    <select
                      aria-label="按 Node 领域筛选"
                      value={nodeDomain}
                      onChange={(event) => setNodeDomain(event.target.value)}
                      className="h-9 border border-[#d4dbd7] bg-white px-3 text-[11px]"
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
                      className="h-9 border border-[#d4dbd7] bg-white px-3 text-[11px] outline-none focus:border-[#356b5a]"
                    />
                    <select
                      aria-label="按生命周期筛选"
                      value={lifecycle}
                      onChange={(event) =>
                        setLifecycle(event.target.value as SemanticGraphNode["lifecycle"] | "ALL")
                      }
                      className="h-9 border border-[#d4dbd7] bg-white px-3 text-[11px]"
                    >
                      <option value="ALL">全部生命周期</option>
                      <option value="ACTIVE">Active</option>
                      <option value="DEPRECATED">Deprecated</option>
                      <option value="RETIRED">Retired</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void applyListFilters(0)}
                      className="h-9 bg-[#dfeae5] px-4 text-[11px] font-semibold text-[#285b4b] hover:bg-[#d3e2db]"
                    >
                      应用筛选
                    </button>
                  </motion.div>
                ) : null}

                {view === "local" ? (
                  <div className="flex flex-col gap-2 border-b border-[#d7ddd9] bg-[#f8faf8] px-3 py-2 text-[11px] text-[#64716b] sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      中心节点{" "}
                      <strong className="font-medium text-[#2e3a35]">
                        {selectedNode?.node.name ?? snapshot.local?.center_node_id ?? "未选择"}
                      </strong>
                    </span>
                    <div className="inline-flex border border-[#d4dbd7] bg-white p-0.5">
                      {[1, 2].map((hop) => (
                        <button
                          key={hop}
                          type="button"
                          onClick={() => void changeHops(hop as 1 | 2)}
                          className={`px-3 py-1.5 font-mono text-[10px] ${hops === hop ? "bg-[#e4eee9] text-[#285b4b]" : "text-[#74807a]"}`}
                        >
                          {hop}-hop
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {view !== "nodes" ? (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-[#d7ddd9] bg-white px-3 py-2">
                    <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#7b8781]">
                      关系家族
                    </span>
                    <button
                      type="button"
                      onClick={() => setEdgeFamily("ALL")}
                      className={`border px-2 py-1 text-[9px] transition-colors ${edgeFamily === "ALL" ? "border-[#7fa293] bg-[#e7f0eb] font-semibold text-[#285b4b]" : "border-[#d8dfdb] text-[#6f7b75] hover:border-[#aebbb4]"}`}
                    >
                      全部
                    </button>
                    {EDGE_FAMILIES.map((family) => (
                      <button
                        key={family}
                        type="button"
                        title={SEMANTIC_EDGE_FAMILY_PRESENTATION[family].description}
                        onClick={() => setEdgeFamily(family)}
                        className={`border px-2 py-1 text-[9px] transition-colors ${edgeFamily === family ? "border-[#7fa293] bg-[#e7f0eb] font-semibold text-[#285b4b]" : "border-[#d8dfdb] text-[#6f7b75] hover:border-[#aebbb4]"}`}
                      >
                        {SEMANTIC_EDGE_FAMILY_PRESENTATION[family].label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="min-w-0">
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
                      families={edgeFamily === "ALL" ? [] : [edgeFamily]}
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
              </div>
            </motion.section>

            <div className="lg:col-start-2 xl:col-start-3 xl:row-start-1">
              <SemanticInspector
                node={selectedNode}
                edge={selectedEdge}
                onClose={() => {
                  setSelectedNode(null);
                  setSelectedEdge(null);
                }}
                onAskAgent={setDraft}
              />
            </div>
          </div>
          {loading ? (
            <div
              className="fixed right-5 top-5 z-50 flex items-center gap-2 bg-[#26302c] px-3 py-2 text-[11px] text-white shadow-lg"
              role="status"
            >
              <Sparkle
                className="size-3.5 animate-pulse motion-reduce:animate-none"
                aria-hidden="true"
              />
              正在同步 Graph v2…
            </div>
          ) : null}
        </div>
      </main>
    </MotionConfig>
  );
}
