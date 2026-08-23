"use client";

import type {
  SemanticAuthoringPublicEvent,
  SemanticCandidateRevisionSaveResult,
  SemanticEdgeFamily,
  SemanticEdgeTypeDefinition,
  SemanticGraphEntryStatus,
  SemanticGraphNode,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
  SemanticManualEdit,
  SemanticNodeType,
} from "@data-agent/contracts";
import type {
  SemanticStudioAuthoringState,
  SemanticStudioSnapshot,
} from "@data-agent/semantic/application";
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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLayoutStore } from "@/lib/layout-store";
import {
  loadSemanticStudio,
  resumeSemanticAuthoring,
  saveSemanticCandidateRevision,
  startManualSemanticSession,
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
import { ContextPreviewWorkbench } from "./context-preview-workbench";
import { type DirectEditorMode, DirectSemanticEditor } from "./direct-semantic-editor";
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

function runIsOpen(state: SemanticStudioAuthoringState | null): boolean {
  return state?.run.status === "RUNNING" || state?.run.status === "WAITING_CLARIFICATION";
}

export function SemanticStudio({
  workspaceId,
  initialSnapshot,
  initialDraft = "",
  initialDomain,
  initialRunId,
  initialEvidenceSelectionId,
  initialEvidenceSelectionHash,
  preview = false,
}: {
  readonly workspaceId: string;
  readonly initialSnapshot: SemanticStudioSnapshot | null;
  readonly initialDraft?: string;
  readonly initialDomain?: string;
  readonly initialRunId?: string;
  readonly initialEvidenceSelectionId?: string;
  readonly initialEvidenceSelectionHash?: string;
  readonly preview?: boolean;
}) {
  const router = useRouter();
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
  const [evidenceSelectionId, setEvidenceSelectionId] = useState(
    initialEvidenceSelectionId ?? null,
  );
  const [authoringState, setAuthoringState] = useState<SemanticStudioAuthoringState | null>(
    initialSnapshot?.authoring?.state ?? null,
  );
  const [events, setEvents] = useState<readonly SemanticAuthoringPublicEvent[]>(
    initialSnapshot?.authoring?.events ?? [],
  );
  const [authoringBusy, setAuthoringBusy] = useState(false);
  const [directEditorMode, setDirectEditorMode] = useState<DirectEditorMode | null>(null);
  const [manualEdits, setManualEdits] = useState<readonly SemanticManualEdit[]>([]);
  const [saveSummary, setSaveSummary] = useState("保存语义 Working ChangeSet");
  const [lastSavedRevision, setLastSavedRevision] =
    useState<SemanticCandidateRevisionSaveResult | null>(
      initialSnapshot?.authoring?.saved_revision ?? null,
    );
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
        setAuthoringState(loaded.authoring?.state ?? null);
        setLastSavedRevision(loaded.authoring?.saved_revision ?? null);
        setEvents((current) =>
          loaded.authoring ? mergeAuthoringEvents(current, loaded.authoring.events) : [],
        );
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
    if (initialSnapshot === null) {
      void load({ domain: initialDomain, runId: initialRunId });
    }
    return () => activeRequest.current?.abort();
  }, [initialDomain, initialRunId, initialSnapshot, load]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const collapseForSmallScreen = () => {
      if (media.matches) setSidebarCollapsed(true);
    };
    collapseForSmallScreen();
    media.addEventListener("change", collapseForSmallScreen);
    return () => media.removeEventListener("change", collapseForSmallScreen);
  }, [setSidebarCollapsed]);

  const hasUnsavedChanges =
    manualEdits.length > 0 ||
    (authoringState?.run.status === "READY_FOR_REVIEW" &&
      authoringState.run.working_revision > 0 &&
      lastSavedRevision === null);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

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
          if (!runIsOpen(result.state)) setError(null);
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
  const graphSummary = useMemo(() => {
    const counts = new Map<SemanticNodeType, number>(NODE_TYPES.map((type) => [type, 0]));
    let nodeCount = 0;
    let candidateCount = 0;
    for (const item of snapshot?.full.nodes ?? []) {
      nodeCount += 1;
      if (item.status !== "PUBLISHED") candidateCount += 1;
      counts.set(item.node.node_type, (counts.get(item.node.node_type) ?? 0) + 1);
    }
    for (const cluster of snapshot?.full.clusters ?? []) {
      nodeCount += cluster.node_count;
      candidateCount += cluster.candidate_count;
      for (const type of NODE_TYPES) {
        counts.set(type, (counts.get(type) ?? 0) + (cluster.node_type_counts[type] ?? 0));
      }
    }
    return { nodeCount, candidateCount, nodeTypeCounts: counts };
  }, [snapshot?.full.clusters, snapshot?.full.nodes]);
  const candidateCount = graphSummary.candidateCount;
  const directEditorNodes = useMemo(() => {
    const indexed = new Map<string, SemanticGraphNode>();
    for (const item of snapshot?.list.items ?? []) indexed.set(item.node.node_id, item.node);
    for (const item of snapshot?.full.nodes ?? []) indexed.set(item.node.node_id, item.node);
    for (const edit of manualEdits) {
      if (edit.operation === "ADD_NODE" || edit.operation === "UPDATE_NODE") {
        indexed.set(edit.node.node_id, edit.node);
      } else if (edit.operation === "RETIRE_NODE") {
        const node = indexed.get(edit.node_id);
        if (node) indexed.set(edit.node_id, { ...node, lifecycle: "RETIRED" });
      }
    }
    return [...indexed.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [manualEdits, snapshot?.full.nodes, snapshot?.list.items]);
  const directEditorEdgeTypes = useMemo(() => {
    const indexed = new Map<string, SemanticEdgeTypeDefinition>();
    for (const definition of snapshot?.edge_type_registry ?? []) {
      indexed.set(definition.edge_type, definition);
    }
    for (const edit of manualEdits) {
      if (edit.operation === "ADD_EDGE_TYPE") {
        indexed.set(edit.edge_type_definition.edge_type, edit.edge_type_definition);
      }
    }
    return [...indexed.values()];
  }, [manualEdits, snapshot?.edge_type_registry]);
  const inspectorVisible = view !== "full" || selectedNode !== null || selectedEdge !== null;

  function appendManualEdit(edit: SemanticManualEdit) {
    setManualEdits((current) => [...current, edit]);
    if (edit.operation === "ADD_NODE") {
      setSelectedNode({
        node: edit.node,
        status: "ADDED",
        relation_count: {
          incoming: 0,
          outgoing: 0,
          total: 0,
          by_family: {
            BUSINESS: 0,
            ANALYTICAL: 0,
            FORMULA: 0,
            PHYSICAL: 0,
            JOIN: 0,
            PROVENANCE: 0,
            TERMINOLOGY: 0,
          },
        },
      });
      setSelectedEdge(null);
    } else if (edit.operation === "UPDATE_NODE") {
      setSelectedNode((current) =>
        current?.node.node_id === edit.node.node_id
          ? {
              ...current,
              node: edit.node,
              status: current.status === "PUBLISHED" ? "MODIFIED" : current.status,
            }
          : current,
      );
    } else if (edit.operation === "RETIRE_NODE") {
      setSelectedNode((current) =>
        current?.node.node_id === edit.node_id
          ? { ...current, node: { ...current.node, lifecycle: "RETIRED" }, status: "RETIRED" }
          : current,
      );
    } else if (edit.operation === "ADD_EDGE") {
      setSelectedEdge({ edge: edit.edge, status: "ADDED" });
      setSelectedNode(null);
    } else if (edit.operation === "UPDATE_EDGE") {
      setSelectedEdge((current) =>
        current?.edge.edge_id === edit.edge.edge_id
          ? {
              edge: edit.edge,
              status: current.status === "PUBLISHED" ? "MODIFIED" : current.status,
            }
          : current,
      );
    } else if (edit.operation === "RETIRE_EDGE") {
      setSelectedEdge((current) =>
        current?.edge.edge_id === edit.edge_id
          ? { edge: { ...current.edge, lifecycle: "RETIRED" }, status: "RETIRED" }
          : current,
      );
    }
  }

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
      setLastSavedRevision(null);
      window.setTimeout(() => setAuthoringBusy(false), 350);
      return;
    }
    try {
      const result = await startSemanticAuthoring(workspaceId, {
        semantic_domain: snapshot.semantic_domain,
        instruction: draft.trim(),
        selected_node_id: selectedNode?.node.node_id ?? null,
        selected_edge_id: selectedEdge?.edge.edge_id ?? null,
        evidence_selection_id: evidenceSelectionId,
        idempotency_key: crypto.randomUUID(),
      });
      setAuthoringState(result.state);
      setEvents((current) => mergeAuthoringEvents(current, result.events));
      setDraft("");
      setLastSavedRevision(null);
      const query = new URLSearchParams({
        domain: snapshot.semantic_domain,
        runId: result.state.run.authoring_run_id,
      });
      if (evidenceSelectionId) query.set("evidenceSelectionId", evidenceSelectionId);
      if (initialEvidenceSelectionHash) {
        query.set("evidenceSelectionHash", initialEvidenceSelectionHash);
      }
      router.replace(`/w/${encodeURIComponent(workspaceId)}/semantic?${query.toString()}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent 语义创作未能启动。");
    } finally {
      setAuthoringBusy(false);
    }
  }

  async function openDirectEditor(mode: DirectEditorMode) {
    if (!snapshot || authoringBusy) return;
    if (authoringRunOpen) {
      setError("Agent 正在写入 Working ChangeSet，请等待确定性校验完成后再直接编辑。");
      return;
    }
    if (authoringState === null || authoringState.run.status !== "READY_FOR_REVIEW") {
      setAuthoringBusy(true);
      setError(null);
      try {
        const started = await startManualSemanticSession(workspaceId, snapshot.semantic_domain);
        setAuthoringState({ run: started.run });
        setLastSavedRevision(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "无法创建直接编辑会话。");
        return;
      } finally {
        setAuthoringBusy(false);
      }
    }
    setDirectEditorMode(mode);
  }

  async function saveDraftRevision() {
    if (!snapshot || !authoringState || authoringState.run.status !== "READY_FOR_REVIEW") {
      setError("Working ChangeSet 尚未通过确定性校验，不能保存 Revision。");
      return;
    }
    setAuthoringBusy(true);
    setError(null);
    try {
      const saved = await saveSemanticCandidateRevision(workspaceId, {
        semantic_domain: snapshot.semantic_domain,
        authoring_run_id: authoringState.run.authoring_run_id,
        expected_working_revision: authoringState.run.working_revision,
        expected_graph_digest: authoringState.run.graph_digest,
        manual_edits: manualEdits,
        evidence_selection_refs:
          evidenceSelectionId && initialEvidenceSelectionHash
            ? [
                {
                  selection_id: evidenceSelectionId,
                  selection_hash: initialEvidenceSelectionHash,
                },
              ]
            : [],
        summary: saveSummary.trim() || "保存语义 Working ChangeSet",
      });
      setManualEdits([]);
      setLastSavedRevision(saved);
      await load({
        domain: snapshot.semantic_domain,
        selectedNodeId: selectedNode?.node.node_id,
        runId: authoringState.run.authoring_run_id,
        hops,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存 Candidate Revision 失败。");
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
      <main className="grid min-h-[70vh] place-items-center bg-[var(--color-bg-canvas)] px-6">
        <div className="w-full max-w-sm border-l-2 border-[var(--color-accent)] pl-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Semantic authority
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
            正在读取 Graph v2 权威投影
          </p>
          <div className="mt-4 h-px w-full overflow-hidden bg-[var(--color-border-default)]">
            <motion.div
              className="h-full w-1/3 bg-[var(--color-accent)]"
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
      <main className="grid min-h-[70vh] place-items-center bg-[var(--color-bg-canvas)] px-6 py-20">
        <div className="surface-reading w-full max-w-xl rounded-[var(--radius-panel)] border px-8 py-12 text-center">
          <Database className="mx-auto size-6 text-[var(--color-accent)]" aria-hidden="true" />
          <h1 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
            Semantic Studio 尚无可浏览的 Graph v2
          </h1>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--color-text-secondary)]">
            {error ?? "当前工作空间没有已绑定的 Graph v2 release。请先运行确定性迁移并发布候选。"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="min-h-screen bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
        <div className="mx-auto max-w-[1760px] px-3 pb-4 pt-3 sm:px-5 lg:px-6">
          <header className="border-b border-[var(--color-border-default)] pb-5 pt-2">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  <span>Semantic layer</span>
                  <span className="text-[var(--color-text-muted)]">/</span>
                  <span>Ontology workspace</span>
                  {preview ? (
                    <span className="border-l border-amber-300 pl-2 text-amber-700">交互预览</span>
                  ) : null}
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[28px]">
                  语义本体工作台
                </h1>
                <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  Node 保存对象身份，Edge 表达业务、分析、公式与物理关系。Agent 与直接编辑
                  共同写入未保存 ChangeSet。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
                <label
                  className="font-medium text-[var(--color-text-secondary)]"
                  htmlFor="semantic-domain"
                >
                  语义域
                </label>
                <select
                  id="semantic-domain"
                  value={snapshot.semantic_domain}
                  onChange={(event) => void load({ domain: event.target.value })}
                  className="h-9 border border-[var(--color-border-default)] bg-white px-3 text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent)]"
                >
                  {snapshot.available_domains.map((domain) => (
                    <option key={domain}>{domain}</option>
                  ))}
                </select>
                <span className="border-l border-[var(--color-border-default)] pl-3 font-mono text-[10px] text-[var(--color-text-secondary)]">
                  {snapshot.release.label}
                </span>
                <span
                  className={`inline-flex h-7 items-center gap-1.5 px-2.5 font-semibold ${candidateCount > 0 ? "bg-[#fff4df] text-[#80530c]" : "bg-[var(--color-accent-soft)] text-[var(--color-accent-pressed)]"}`}
                >
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {candidateCount > 0 ? `Candidate · ${candidateCount}` : "Published"}
                </span>
              </div>
            </div>
          </header>

          <details className="surface-reading mt-4 overflow-hidden rounded-[var(--radius-item)] border">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
              Context Preview
            </summary>
            <div className="border-t border-[var(--color-border-default)] p-3">
              <ContextPreviewWorkbench workspaceId={workspaceId} />
            </div>
          </details>

          <SemanticAgentComposer
            domain={snapshot.semantic_domain}
            releaseLabel={snapshot.release.label}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            evidenceSelectionId={evidenceSelectionId}
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
            onClearEvidenceSelection={() => setEvidenceSelectionId(null)}
            onSubmit={() => void submitAuthoring()}
            onResume={(answer) => void resume(answer)}
            onOpenTrajectory={() => {
              if (!authoringState) return;
              router.push(
                `/w/${encodeURIComponent(workspaceId)}/semantic/authoring/${encodeURIComponent(authoringState.run.authoring_run_id)}?domain=${encodeURIComponent(snapshot.semantic_domain)}`,
              );
            }}
          />

          <section
            className="surface-reading mt-3 rounded-[var(--radius-panel)] border px-3 py-3"
            aria-label="Candidate Revision actions"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openDirectEditor("ADD_NODE")}
                  disabled={authoringBusy}
                  className="control-pressable inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-overlay)] px-3 text-[11px] font-semibold text-[var(--color-accent-pressed)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  直接新建对象
                </button>
                <button
                  type="button"
                  onClick={() => void openDirectEditor("ADD_EDGE")}
                  disabled={authoringBusy}
                  className="control-pressable inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-overlay)] px-3 text-[11px] font-semibold text-[var(--color-accent-pressed)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                >
                  <ShareNetwork className="size-4" />
                  直接新建关系
                </button>
                <button
                  type="button"
                  onClick={() => void openDirectEditor("PROPOSE_EDGE_TYPE")}
                  disabled={authoringBusy}
                  className="control-pressable inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-overlay)] px-3 text-[11px] font-semibold text-[var(--color-accent-pressed)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                >
                  <Sparkle className="size-4" />
                  提案新关系类型
                </button>
                <span
                  className={`px-2 py-1 text-[10px] font-semibold ${manualEdits.length > 0 ? "bg-amber-100 text-amber-800" : "bg-[var(--color-bg-overlay)] text-[var(--color-text-secondary)]"}`}
                >
                  {manualEdits.length > 0
                    ? `${manualEdits.length} 项未保存修改`
                    : "没有未保存的手工修改"}
                </span>
                {lastSavedRevision ? (
                  <span className="font-mono text-[10px] text-[var(--color-accent)]">
                    已保存 r{lastSavedRevision.revision_number}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={saveSummary}
                  onChange={(event) => setSaveSummary(event.target.value)}
                  maxLength={2048}
                  className="h-9 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border-default)] px-3 text-[11px] outline-none focus:border-[var(--color-accent)] sm:w-72"
                  aria-label="Revision 保存摘要"
                />
                <button
                  type="button"
                  onClick={() => void saveDraftRevision()}
                  disabled={authoringBusy || authoringState?.run.status !== "READY_FOR_REVIEW"}
                  className="control-pressable inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 text-[11px] font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  保存草稿 Revision
                </button>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[var(--color-text-muted)]">
              编辑过程不会自动生成
              Revision。保存草稿与提交审核是两个独立动作；离开含未保存修改的页面会收到浏览器提示。
            </p>
          </section>

          {directEditorMode ? (
            <DirectSemanticEditor
              mode={directEditorMode}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              nodes={directEditorNodes}
              edgeTypes={directEditorEdgeTypes}
              ownerRef={authoringState?.run.principal_id ?? "semantic-owner"}
              onApply={appendManualEdit}
              onClose={() => setDirectEditorMode(null)}
            />
          ) : null}

          <div
            className={`mt-4 grid gap-4 lg:grid-cols-[176px_minmax(0,1fr)] ${inspectorVisible ? "xl:grid-cols-[184px_minmax(0,1fr)_286px]" : "xl:grid-cols-[184px_minmax(0,1fr)]"}`}
          >
            <aside
              className="border-b border-[var(--color-border-default)] pb-3 lg:sticky lg:top-3 lg:self-start lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3"
              aria-label="语义工作台导航"
            >
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                视图
              </p>
              <nav
                className="grid grid-cols-3 gap-1 lg:block lg:space-y-1"
                aria-label="Semantic Studio 视图"
              >
                {(
                  [
                    ["nodes", "节点目录", graphSummary.nodeCount, ListBullets],
                    ["local", "局部关系", snapshot.local?.nodes.length ?? 0, ShareNetwork],
                    ["full", "全局本体", snapshot.full.glyph_count, CirclesThree],
                  ] as const
                ).map(([key, label, count, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    aria-current={view === key ? "page" : undefined}
                    className={`relative flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left text-[12px] transition-colors ${view === key ? "text-[var(--color-accent-hover)]" : "text-[var(--color-text-secondary)] hover:bg-white hover:text-[var(--color-text-primary)]"}`}
                  >
                    {view === key ? (
                      <motion.span
                        layoutId="semantic-view-marker"
                        className="absolute inset-y-1 left-0 w-0.5 bg-[var(--color-accent)]"
                      />
                    ) : null}
                    <Icon
                      className="size-4 shrink-0"
                      weight={view === key ? "fill" : "regular"}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{label}</span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-text-muted)]">
                      {count}
                    </span>
                  </button>
                ))}
              </nav>

              <div className="mt-7 hidden border-t border-[var(--color-border-default)] px-2 pt-5 lg:block">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                    对象类型
                  </p>
                  <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                    当前页
                  </span>
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
                        className="flex w-full items-center gap-2 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: presentation.fill }}
                          aria-hidden="true"
                        />
                        <span>{presentation.label}</span>
                        <span className="ml-auto font-mono text-[10px]">
                          {graphSummary.nodeTypeCounts.get(item) ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 hidden border-l-2 border-[var(--color-border-overlay)] px-3 py-1 lg:block">
                <p className="text-[10px] font-semibold text-[var(--color-accent)]">
                  Unified ChangeSet
                </p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-muted)]">
                  Agent 与直接编辑使用同一 Candidate Patch；物理事实保持只读。
                </p>
              </div>
            </aside>

            <motion.section layout className="min-w-0" aria-label="语义工作区">
              <div className="surface-reading overflow-hidden rounded-[var(--radius-panel)] border">
                <div className="flex flex-col gap-2 border-b border-[var(--color-border-default)] p-2.5 sm:flex-row sm:items-center">
                  <label className="relative min-w-0 flex-1">
                    <MagnifyingGlass
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]"
                      aria-hidden="true"
                    />
                    <span className="sr-only">搜索语义节点</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索名称、定义、稳定 ID…"
                      className="h-10 w-full border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] pl-9 pr-3 text-[12px] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:bg-white"
                    />
                  </label>
                  <select
                    aria-label="按节点类型筛选"
                    value={nodeType}
                    onChange={(event) =>
                      setNodeType(event.target.value as SemanticNodeType | "ALL")
                    }
                    className="h-10 border border-[var(--color-border-default)] bg-white px-3 text-[11px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
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
                    className="h-10 border border-[var(--color-border-default)] bg-white px-3 text-[11px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
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
                      className={`inline-flex h-10 items-center justify-center gap-2 border px-3 text-[11px] font-medium transition-colors ${filtersOpen ? "border-[var(--color-border-overlay)] bg-[var(--color-accent-soft)] text-[var(--color-accent-hover)]" : "border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-overlay)]"}`}
                    >
                      <SlidersHorizontal className="size-4" aria-hidden="true" />
                      高级筛选
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDraft("新增语义节点：")}
                    className="inline-flex h-10 items-center justify-center gap-2 bg-[var(--color-accent)] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
                    className="grid gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] p-3 sm:grid-cols-[1fr_150px_150px_auto]"
                  >
                    <select
                      aria-label="按 Node 领域筛选"
                      value={nodeDomain}
                      onChange={(event) => setNodeDomain(event.target.value)}
                      className="h-9 border border-[var(--color-border-default)] bg-white px-3 text-[11px]"
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
                      className="h-9 border border-[var(--color-border-default)] bg-white px-3 text-[11px] outline-none focus:border-[var(--color-accent)]"
                    />
                    <select
                      aria-label="按生命周期筛选"
                      value={lifecycle}
                      onChange={(event) =>
                        setLifecycle(event.target.value as SemanticGraphNode["lifecycle"] | "ALL")
                      }
                      className="h-9 border border-[var(--color-border-default)] bg-white px-3 text-[11px]"
                    >
                      <option value="ALL">全部生命周期</option>
                      <option value="ACTIVE">Active</option>
                      <option value="DEPRECATED">Deprecated</option>
                      <option value="RETIRED">Retired</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void applyListFilters(0)}
                      className="h-9 bg-[var(--color-accent-soft)] px-4 text-[11px] font-semibold text-[var(--color-accent-hover)] hover:bg-[var(--color-accent-soft)]"
                    >
                      应用筛选
                    </button>
                  </motion.div>
                ) : null}

                {view === "local" ? (
                  <div className="flex flex-col gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)] sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      中心节点{" "}
                      <strong className="font-medium text-[var(--color-text-primary)]">
                        {selectedNode?.node.name ?? snapshot.local?.center_node_id ?? "未选择"}
                      </strong>
                    </span>
                    <div className="inline-flex border border-[var(--color-border-default)] bg-white p-0.5">
                      {[1, 2].map((hop) => (
                        <button
                          key={hop}
                          type="button"
                          onClick={() => void changeHops(hop as 1 | 2)}
                          className={`px-3 py-1.5 font-mono text-[10px] ${hops === hop ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-hover)]" : "text-[var(--color-text-muted)]"}`}
                        >
                          {hop}-hop
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {view !== "nodes" ? (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border-default)] bg-white px-3 py-2">
                    <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                      关系家族
                    </span>
                    <button
                      type="button"
                      onClick={() => setEdgeFamily("ALL")}
                      className={`rounded-full border px-2 py-1 text-[9px] transition-colors ${edgeFamily === "ALL" ? "border-[var(--color-border-overlay)] bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-hover)]" : "border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:border-[var(--color-border-overlay)]"}`}
                    >
                      全部
                    </button>
                    {EDGE_FAMILIES.map((family) => (
                      <button
                        key={family}
                        type="button"
                        title={SEMANTIC_EDGE_FAMILY_PRESENTATION[family].description}
                        onClick={() => setEdgeFamily(family)}
                        className={`rounded-full border px-2 py-1 text-[9px] transition-colors ${edgeFamily === family ? "border-[var(--color-border-overlay)] bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-hover)]" : "border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:border-[var(--color-border-overlay)]"}`}
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
                      onClearSelection={() => {
                        setSelectedNode(null);
                        setSelectedEdge(null);
                      }}
                    />
                  )}
                </div>
              </div>
            </motion.section>

            {inspectorVisible ? (
              <div className="lg:col-start-2 xl:col-start-3 xl:row-start-1">
                <SemanticInspector
                  node={selectedNode}
                  edge={selectedEdge}
                  onClose={() => {
                    setSelectedNode(null);
                    setSelectedEdge(null);
                  }}
                  onAskAgent={setDraft}
                  onDirectEdit={() => void openDirectEditor("EDIT_SELECTION")}
                />
              </div>
            ) : null}
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
