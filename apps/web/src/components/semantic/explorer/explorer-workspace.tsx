"use client";

import type {
  SemanticBindingImpactSafeProjection,
  SemanticExplorerCandidateComparison,
  SemanticExplorerDiff,
  SemanticExplorerDomainSummary,
  SemanticExplorerLineage,
  SemanticExplorerObjectIdentity,
  SemanticExplorerReleaseTimeline,
  SemanticExplorerSnapshot,
  SemanticRelationshipEdgeCategory,
  SemanticRelationshipSearchResult,
} from "@data-agent/contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  getActiveExplorerSnapshot,
  getExplorerCandidateComparison,
  getExplorerDiff,
  getExplorerDomains,
  getExplorerLineage,
  getExplorerRelease,
  getExplorerTimeline,
  getSemanticBindingImpact,
  SemanticExplorerApiError,
  searchExplorerRelationships,
} from "@/lib/semantic-explorer-api";
import { CategoryTree } from "./category-tree";
import {
  createLatestExplorerOperationGate,
  type LatestExplorerOperationGate,
  timelineMatchesSnapshot,
} from "./latest-operation";
import { ObjectDetail } from "./object-detail";
import { ObjectTable } from "./object-table";
import { RelationshipGraph } from "./relationship-graph";
import { ReleaseControls } from "./release-controls";
import { initialExplorerState, semanticExplorerReducer } from "./state";
import {
  explorerIdentityKey,
  resolveExplorerDeepLink,
  selectExplorerObjectWindow,
} from "./view-model";

function wasAborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function publicError(error: unknown): { code: string; message: string; permissionDenied: boolean } {
  if (error instanceof SemanticExplorerApiError) {
    return {
      code: error.code,
      message: error.message,
      permissionDenied: error.status === 401 || error.status === 403,
    };
  }
  return {
    code: "SEMANTIC_EXPLORER_UNAVAILABLE",
    message: "语义 Explorer 暂时不可用。",
    permissionDenied: false,
  };
}

export function ExplorerWorkspace({ workspaceId }: { readonly workspaceId: string }) {
  const [state, dispatch] = useReducer(semanticExplorerReducer, initialExplorerState);
  const [domains, setDomains] = useState<readonly SemanticExplorerDomainSummary[]>([]);
  const [domainCatalogState, setDomainCatalogState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [timeline, setTimeline] = useState<SemanticExplorerReleaseTimeline | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [diff, setDiff] = useState<SemanticExplorerDiff | null>(null);
  const [lineage, setLineage] = useState<SemanticExplorerLineage | null>(null);
  const [comparison, setComparison] = useState<SemanticExplorerCandidateComparison | null>(null);
  const [impact, setImpact] = useState<SemanticBindingImpactSafeProjection | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [auxiliaryError, setAuxiliaryError] = useState<string | null>(null);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const [lineageBusy, setLineageBusy] = useState(false);
  const [relationshipResult, setRelationshipResult] =
    useState<SemanticRelationshipSearchResult | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [relationshipCategories, setRelationshipCategories] = useState<
    readonly SemanticRelationshipEdgeCategory[]
  >(["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"]);
  const [relationshipDirection, setRelationshipDirection] = useState<
    "upstream" | "downstream" | "both"
  >("both");
  const [relationshipHops, setRelationshipHops] = useState(3);
  const requestEpoch = useRef(0);
  const pointerGenerationFence = useRef(new Map<string, number>());
  const snapshotController = useRef<AbortController | null>(null);
  const relationshipController = useRef<AbortController | null>(null);
  const impactController = useRef<AbortController | null>(null);
  const lineageGate = useRef<LatestExplorerOperationGate | null>(null);
  const auxiliaryGate = useRef<LatestExplorerOperationGate | null>(null);
  lineageGate.current ??= createLatestExplorerOperationGate();
  auxiliaryGate.current ??= createLatestExplorerOperationGate();

  const cancelLineageOperation = useCallback(() => {
    lineageGate.current?.cancel();
    setLineage(null);
    setLineageBusy(false);
    setLineageError(null);
  }, []);

  const cancelAuxiliaryOperation = useCallback(() => {
    auxiliaryGate.current?.cancel();
    setDiff(null);
    setComparison(null);
    setAuxiliaryBusy(false);
    setAuxiliaryError(null);
  }, []);

  const loadSnapshot = useCallback(
    async (domain: string, releaseId: string | null) => {
      snapshotController.current?.abort();
      relationshipController.current?.abort();
      impactController.current?.abort();
      setImpact(null);
      setImpactError(null);
      setImpactBusy(false);
      setRelationshipResult(null);
      setRelationshipError(null);
      setRelationshipBusy(false);
      cancelLineageOperation();
      cancelAuxiliaryOperation();
      const controller = new AbortController();
      snapshotController.current = controller;
      const epoch = ++requestEpoch.current;
      dispatch({ type: "request-started", domain, request_epoch: epoch });
      setTimeline(null);
      setTimelineError(null);

      const timelinePromise = getExplorerTimeline(workspaceId, domain, controller.signal).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        const snapshot = releaseId
          ? await getExplorerRelease(workspaceId, domain, releaseId, controller.signal)
          : await getActiveExplorerSnapshot(workspaceId, domain, controller.signal);
        if (requestEpoch.current !== epoch) return;
        const highestObservedGeneration = pointerGenerationFence.current.get(domain) ?? 0;
        const stale = snapshot.pointer_observation.pointer_generation < highestObservedGeneration;
        dispatch({ type: "request-succeeded", domain, request_epoch: epoch, snapshot });
        if (stale) return;
        pointerGenerationFence.current.set(
          domain,
          Math.max(highestObservedGeneration, snapshot.pointer_observation.pointer_generation),
        );
        const params = new URLSearchParams({
          domain,
          releaseId: snapshot.release_identity.release_id,
        });
        window.history.replaceState(
          null,
          "",
          `/w/${encodeURIComponent(workspaceId)}/semantic/explorer?${params.toString()}`,
        );

        const timelineResult = await timelinePromise;
        if (requestEpoch.current !== epoch) return;
        if (timelineResult.ok) {
          if (timelineMatchesSnapshot(timelineResult.value, snapshot)) {
            setTimeline(timelineResult.value);
          } else {
            setTimeline(null);
            setTimelineError("发布指针在读取期间发生变化，请刷新活动版本后重试。");
          }
        } else if (!wasAborted(timelineResult.error)) {
          setTimelineError(publicError(timelineResult.error).message);
        }
      } catch (error) {
        if (wasAborted(error) || requestEpoch.current !== epoch) return;
        const failure = publicError(error);
        dispatch({
          type: "request-failed",
          domain,
          request_epoch: epoch,
          code: failure.code,
          message: failure.message,
          permission_denied: failure.permissionDenied,
        });
      }
    },
    [cancelAuxiliaryOperation, cancelLineageOperation, workspaceId],
  );

  const loadImpact = useCallback(
    async (domain: string, impactId: string) => {
      impactController.current?.abort();
      const controller = new AbortController();
      impactController.current = controller;
      const epoch = requestEpoch.current;
      setImpact(null);
      setImpactError(null);
      setImpactBusy(true);
      try {
        const loadedImpact = await getSemanticBindingImpact(
          workspaceId,
          domain,
          impactId,
          controller.signal,
        );
        if (controller.signal.aborted || requestEpoch.current !== epoch) return;
        setImpact(loadedImpact);
        const candidate = loadedImpact.candidate_ref;
        if (!candidate) return;
        const loadedComparison = await getExplorerCandidateComparison(
          workspaceId,
          domain,
          candidate.candidate_id,
          candidate.revision_id,
          controller.signal,
        );
        if (!controller.signal.aborted && requestEpoch.current === epoch) {
          setComparison(loadedComparison);
        }
      } catch (error) {
        if (!wasAborted(error) && !controller.signal.aborted && requestEpoch.current === epoch) {
          setImpactError(publicError(error).message);
        }
      } finally {
        if (!controller.signal.aborted && requestEpoch.current === epoch) setImpactBusy(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void getExplorerDomains(workspaceId, controller.signal)
      .then((loadedDomains) => {
        setDomains(loadedDomains);
        setDomainCatalogState("ready");
        const deepLink = resolveExplorerDeepLink(loadedDomains, window.location.search);
        if (!deepLink) return;
        void loadSnapshot(deepLink.domain, deepLink.releaseId);
        if (deepLink.impactId) void loadImpact(deepLink.domain, deepLink.impactId);
      })
      .catch((error) => {
        if (!wasAborted(error)) setDomainCatalogState("error");
      });
    return () => {
      controller.abort();
      snapshotController.current?.abort();
      relationshipController.current?.abort();
      impactController.current?.abort();
      lineageGate.current?.cancel();
      auxiliaryGate.current?.cancel();
    };
  }, [loadImpact, loadSnapshot, workspaceId]);

  const snapshot: SemanticExplorerSnapshot | null =
    state.server.kind === "success" || state.server.kind === "empty" ? state.server.snapshot : null;
  const objectWindow = useMemo(
    () =>
      snapshot
        ? selectExplorerObjectWindow(snapshot, state.category, state.search)
        : { objects: [], matching_count: 0, truncated: false },
    [snapshot, state.category, state.search],
  );
  const selectedIdentity = useMemo<SemanticExplorerObjectIdentity | null>(() => {
    if (!snapshot) return null;
    const selectedKey = state.selected ? explorerIdentityKey(state.selected) : null;
    return (
      objectWindow.objects.find((object) => explorerIdentityKey(object.identity) === selectedKey)
        ?.identity ??
      objectWindow.objects[0]?.identity ??
      null
    );
  }, [objectWindow.objects, snapshot, state.selected]);
  const selectedObject = useMemo(() => {
    if (!snapshot || !selectedIdentity) return null;
    const selectedKey = explorerIdentityKey(selectedIdentity);
    return (
      snapshot.objects.find((object) => explorerIdentityKey(object.identity) === selectedKey) ??
      null
    );
  }, [selectedIdentity, snapshot]);

  const loadRelationships = useCallback(async () => {
    if (!snapshot || !state.domain || state.view !== "graph") return;
    relationshipController.current?.abort();
    const controller = new AbortController();
    relationshipController.current = controller;
    setRelationshipBusy(true);
    setRelationshipError(null);
    try {
      const term = state.search.trim();
      const result = await searchExplorerRelationships(
        workspaceId,
        {
          schema_version: "semantic-relationship-search-request@1.0.0",
          semantic_domain: state.domain,
          release: {
            kind: "HISTORICAL",
            release_id: snapshot.release_identity.release_id,
          },
          root: term.length > 0 ? null : selectedIdentity,
          term: term.length > 0 ? term : null,
          categories: [...relationshipCategories],
          direction: relationshipDirection,
          hop_limit: relationshipHops,
          node_limit: 250,
          edge_limit: 500,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setRelationshipResult(result);
    } catch (error) {
      if (!wasAborted(error) && !controller.signal.aborted) {
        setRelationshipError(publicError(error).message);
      }
    } finally {
      if (!controller.signal.aborted) setRelationshipBusy(false);
    }
  }, [
    relationshipCategories,
    relationshipDirection,
    relationshipHops,
    selectedIdentity,
    snapshot,
    state.domain,
    state.search,
    state.view,
    workspaceId,
  ]);

  useEffect(() => {
    if (state.view !== "graph" || relationshipCategories.length === 0) return;
    const timeout = window.setTimeout(() => void loadRelationships(), 180);
    return () => window.clearTimeout(timeout);
  }, [loadRelationships, relationshipCategories.length, state.view]);

  function selectObject(selected: SemanticExplorerObjectIdentity) {
    cancelLineageOperation();
    dispatch({ type: "selection-changed", selected });
  }

  async function loadLineage() {
    if (!snapshot || !selectedIdentity || !state.domain) return;
    const epoch = requestEpoch.current;
    const operation = lineageGate.current?.begin();
    if (!operation) return;
    setLineageBusy(true);
    setLineage(null);
    setLineageError(null);
    try {
      const result = await getExplorerLineage(
        workspaceId,
        state.domain,
        snapshot.release_identity.release_id,
        selectedIdentity,
        operation.signal,
      );
      if (requestEpoch.current === epoch && lineageGate.current?.isLatest(operation)) {
        setLineage(result);
      }
    } catch (error) {
      if (
        !wasAborted(error) &&
        requestEpoch.current === epoch &&
        lineageGate.current?.isLatest(operation)
      ) {
        setLineageError(publicError(error).message);
      }
    } finally {
      if (requestEpoch.current === epoch && lineageGate.current?.finish(operation)) {
        setLineageBusy(false);
      }
    }
  }

  async function loadDiff(baseReleaseId: string) {
    if (!snapshot || !state.domain) return;
    const epoch = requestEpoch.current;
    cancelAuxiliaryOperation();
    const operation = auxiliaryGate.current?.begin();
    if (!operation) return;
    setAuxiliaryBusy(true);
    try {
      const result = await getExplorerDiff(
        workspaceId,
        state.domain,
        snapshot.release_identity.release_id,
        baseReleaseId,
        operation.signal,
      );
      if (requestEpoch.current === epoch && auxiliaryGate.current?.isLatest(operation)) {
        setDiff(result);
      }
    } catch (error) {
      if (
        !wasAborted(error) &&
        requestEpoch.current === epoch &&
        auxiliaryGate.current?.isLatest(operation)
      ) {
        setAuxiliaryError(publicError(error).message);
      }
    } finally {
      if (requestEpoch.current === epoch && auxiliaryGate.current?.finish(operation)) {
        setAuxiliaryBusy(false);
      }
    }
  }

  async function loadCandidate(candidateId: string, revisionId: string) {
    if (!state.domain) return;
    const epoch = requestEpoch.current;
    impactController.current?.abort();
    setImpact(null);
    setImpactError(null);
    setImpactBusy(false);
    cancelAuxiliaryOperation();
    const operation = auxiliaryGate.current?.begin();
    if (!operation) return;
    setAuxiliaryBusy(true);
    try {
      const result = await getExplorerCandidateComparison(
        workspaceId,
        state.domain,
        candidateId,
        revisionId,
        operation.signal,
      );
      if (requestEpoch.current === epoch && auxiliaryGate.current?.isLatest(operation)) {
        setComparison(result);
      }
    } catch (error) {
      if (
        !wasAborted(error) &&
        requestEpoch.current === epoch &&
        auxiliaryGate.current?.isLatest(operation)
      ) {
        setAuxiliaryError(publicError(error).message);
      }
    } finally {
      if (requestEpoch.current === epoch && auxiliaryGate.current?.finish(operation)) {
        setAuxiliaryBusy(false);
      }
    }
  }

  if (domainCatalogState === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在读取 PostgreSQL 语义域…
      </div>
    );
  }
  if (domainCatalogState === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-700 dark:text-red-300"
      >
        无法读取语义域。Explorer 只显示服务端 Authority 允许的内容。
      </div>
    );
  }
  if (domains.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
        当前 Authority 下没有可展示的已发布语义域。
      </div>
    );
  }
  if (state.server.kind === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在构建统一语义快照…
      </div>
    );
  }
  if (state.server.kind === "permission-denied") {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-800 dark:text-amber-200">
        当前服务端 Authority 不允许读取该语义域；响应不会透露对象是否存在。
      </div>
    );
  }
  if (state.server.kind === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-700 dark:text-red-300"
      >
        <p>{state.server.message}</p>
        <button
          type="button"
          onClick={() => state.domain && void loadSnapshot(state.domain, null)}
          className="mt-3 rounded-md border border-current px-3 py-1.5 text-xs"
        >
          重试活动版本
        </button>
      </div>
    );
  }
  if (!snapshot || !state.domain) return null;

  const activeDomain = state.domain;
  const hasCapabilityGap = Object.values(snapshot.capabilities).some((value) => !value);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                snapshot.is_active
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
              }`}
            >
              {snapshot.is_active ? "ACTIVE" : "HISTORICAL"}
            </span>
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              {state.domain} · generation {snapshot.release_identity.release_generation}
            </span>
            {state.refreshing ? (
              <span className="text-[10px] text-[var(--color-text-tertiary)]">刷新中…</span>
            ) : null}
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
            release {snapshot.release_identity.release_id} · pointer{" "}
            {snapshot.pointer_observation.pointer_generation}
          </p>
        </div>
        <button
          type="button"
          disabled={state.refreshing}
          onClick={() => void loadSnapshot(activeDomain, null)}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          刷新活动版本
        </button>
      </div>

      {hasCapabilityGap ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          能力缺失：
          {!snapshot.capabilities.business_ontology ? " BusinessOntology" : ""}
          {!snapshot.capabilities.physical_binding ? " PhysicalBinding" : ""}
          {!snapshot.capabilities.catalog_governance ? " CatalogGovernance" : ""}
          。历史版本不会补造它从未发布过的语义材料。
        </p>
      ) : null}

      <ReleaseControls
        key={activeDomain}
        busy={auxiliaryBusy || impactBusy}
        comparison={comparison}
        diff={diff}
        impact={impact}
        snapshot={snapshot}
        timeline={timeline}
        onCompareCandidate={(candidateId, revisionId) =>
          void loadCandidate(candidateId, revisionId)
        }
        onDiff={(baseReleaseId) => void loadDiff(baseReleaseId)}
        onReleaseSelect={(releaseId) => void loadSnapshot(activeDomain, releaseId)}
      />

      {timelineError ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          活动快照已加载，但 Release timeline 读取失败：{timelineError}
        </p>
      ) : null}

      {auxiliaryError ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {auxiliaryError}
        </p>
      ) : null}

      {impactError ? (
        <p
          role="alert"
          className="rounded-md border border-[#e4b75f] bg-[#fff9ec] px-3 py-2 text-xs text-[#80530c]"
        >
          Binding Impact 读取失败：{impactError}
        </p>
      ) : null}

      {lineageError ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {lineageError}
        </p>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_330px]">
        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3">
          <CategoryTree
            category={state.category}
            domain={activeDomain}
            domains={domains}
            snapshot={snapshot}
            onCategoryChange={(category) => {
              cancelLineageOperation();
              dispatch({ type: "category-changed", category });
            }}
            onDomainChange={(domain) => void loadSnapshot(domain, null)}
          />
        </div>

        <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-default)] p-3">
            <label className="min-w-56 flex-1">
              <span className="sr-only">搜索语义对象</span>
              <input
                type="search"
                value={state.search}
                onChange={(event) => {
                  cancelLineageOperation();
                  dispatch({ type: "search-changed", search: event.target.value });
                }}
                placeholder="搜索名称、别名或 Object ID"
                className="w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-3 py-2 text-xs text-[var(--color-text-primary)]"
              />
            </label>
            <div className="flex rounded-md border border-[var(--color-border-default)] p-0.5">
              {(["table", "graph"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={state.view === view}
                  onClick={() => dispatch({ type: "view-changed", view })}
                  className={`rounded px-2.5 py-1.5 text-xs ${
                    state.view === view
                      ? "bg-[var(--color-accent)] text-white"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {view === "table" ? "表格" : "关系图"}
                </button>
              ))}
            </div>
          </div>
          {state.view === "table" ? (
            <ObjectTable
              matchingCount={objectWindow.matching_count}
              objects={objectWindow.objects}
              selected={selectedIdentity}
              truncated={objectWindow.truncated}
              onSelect={selectObject}
            />
          ) : (
            <div>
              <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/45 px-3 py-2.5">
                <fieldset className="flex flex-wrap gap-1.5">
                  <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    Edge categories
                  </legend>
                  {(["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"] as const).map((category) => {
                    const enabled = relationshipCategories.includes(category);
                    return (
                      <label
                        key={category}
                        className={`cursor-pointer rounded border px-2 py-1 text-[10px] font-semibold ${
                          enabled
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                            : "border-[var(--color-border-default)] text-[var(--color-text-tertiary)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={enabled}
                          onChange={() =>
                            setRelationshipCategories((current) =>
                              current.includes(category)
                                ? current.filter((item) => item !== category)
                                : [...current, category],
                            )
                          }
                        />
                        {category}
                      </label>
                    );
                  })}
                </fieldset>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  Direction
                  <select
                    value={relationshipDirection}
                    onChange={(event) =>
                      setRelationshipDirection(
                        event.target.value as "upstream" | "downstream" | "both",
                      )
                    }
                    className="mt-1 block rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs normal-case tracking-normal text-[var(--color-text-secondary)]"
                  >
                    <option value="both">Both</option>
                    <option value="upstream">Upstream</option>
                    <option value="downstream">Downstream</option>
                  </select>
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  Hop limit
                  <select
                    value={relationshipHops}
                    onChange={(event) => setRelationshipHops(Number(event.target.value))}
                    className="mt-1 block rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs normal-case tracking-normal text-[var(--color-text-secondary)]"
                  >
                    {[1, 2, 3, 4, 5, 6].map((hop) => (
                      <option key={hop} value={hop}>
                        {hop}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void loadRelationships()}
                  disabled={relationshipBusy || relationshipCategories.length === 0}
                  className="rounded border border-[var(--color-border-default)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] disabled:opacity-50"
                >
                  {relationshipBusy ? "查询中…" : "刷新关系"}
                </button>
              </div>
              {relationshipCategories.length === 0 ? (
                <p className="flex min-h-72 items-center justify-center text-sm text-[var(--color-text-secondary)]">
                  至少选择一种关系类别。
                </p>
              ) : relationshipError ? (
                <div className="m-4 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                  <p>{relationshipError}</p>
                  <button
                    type="button"
                    onClick={() => void loadRelationships()}
                    className="mt-2 rounded border border-current px-2 py-1 text-xs"
                  >
                    重试
                  </button>
                </div>
              ) : relationshipResult ? (
                <RelationshipGraph result={relationshipResult} onSelectObject={selectObject} />
              ) : (
                <div className="flex min-h-72 items-center justify-center text-sm text-[var(--color-text-secondary)]">
                  正在查询发布关系图…
                </div>
              )}
            </div>
          )}
        </section>

        <ObjectDetail
          lineage={lineage}
          lineageBusy={lineageBusy}
          object={selectedObject}
          snapshot={snapshot}
          onLoadLineage={() => void loadLineage()}
        />
      </div>
    </div>
  );
}
