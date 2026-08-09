"use client";

import type {
  SemanticExplorerCandidateComparison,
  SemanticExplorerDiff,
  SemanticExplorerDomainSummary,
  SemanticExplorerLineage,
  SemanticExplorerObjectIdentity,
  SemanticExplorerReleaseTimeline,
  SemanticExplorerSnapshot,
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
  SemanticExplorerApiError,
} from "@/lib/semantic-explorer-api";
import { BoundedGraph } from "./bounded-graph";
import { CategoryTree } from "./category-tree";
import { deriveBoundedExplorerGraph } from "./graph";
import {
  createLatestExplorerOperationGate,
  type LatestExplorerOperationGate,
  timelineMatchesSnapshot,
} from "./latest-operation";
import { ObjectDetail } from "./object-detail";
import { ObjectTable } from "./object-table";
import { ReleaseControls } from "./release-controls";
import { initialExplorerState, semanticExplorerReducer } from "./state";
import { explorerIdentityKey, selectExplorerObjectWindow } from "./view-model";

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

export function ExplorerWorkspace() {
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
  const [auxiliaryError, setAuxiliaryError] = useState<string | null>(null);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const [lineageBusy, setLineageBusy] = useState(false);
  const requestEpoch = useRef(0);
  const pointerGenerationFence = useRef(new Map<string, number>());
  const snapshotController = useRef<AbortController | null>(null);
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
      cancelLineageOperation();
      cancelAuxiliaryOperation();
      const controller = new AbortController();
      snapshotController.current = controller;
      const epoch = ++requestEpoch.current;
      dispatch({ type: "request-started", domain, request_epoch: epoch });
      setTimeline(null);
      setTimelineError(null);

      const timelinePromise = getExplorerTimeline(domain, controller.signal).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        const snapshot = releaseId
          ? await getExplorerRelease(domain, releaseId, controller.signal)
          : await getActiveExplorerSnapshot(domain, controller.signal);
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
        window.history.replaceState(null, "", `/semantic/explorer?${params.toString()}`);

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
    [cancelAuxiliaryOperation, cancelLineageOperation],
  );

  useEffect(() => {
    const controller = new AbortController();
    void getExplorerDomains(controller.signal)
      .then((loadedDomains) => {
        setDomains(loadedDomains);
        setDomainCatalogState("ready");
        if (loadedDomains.length === 0) return;
        const fallbackDomain = loadedDomains.at(0);
        if (!fallbackDomain) return;
        const params = new URLSearchParams(window.location.search);
        const requestedDomain = params.get("domain");
        const domain =
          loadedDomains.find((item) => item.semantic_domain === requestedDomain)?.semantic_domain ??
          loadedDomains.find((item) => item.has_current_release)?.semantic_domain ??
          fallbackDomain.semantic_domain;
        const releaseId = requestedDomain === domain ? params.get("releaseId") : null;
        void loadSnapshot(domain, releaseId);
      })
      .catch((error) => {
        if (!wasAborted(error)) setDomainCatalogState("error");
      });
    return () => {
      controller.abort();
      snapshotController.current?.abort();
      lineageGate.current?.cancel();
      auxiliaryGate.current?.cancel();
    };
  }, [loadSnapshot]);

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
  const graph = useMemo(
    () =>
      snapshot
        ? deriveBoundedExplorerGraph(snapshot, selectedIdentity)
        : { nodes: [], edges: [], truncated: false },
    [selectedIdentity, snapshot],
  );

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
    cancelAuxiliaryOperation();
    const operation = auxiliaryGate.current?.begin();
    if (!operation) return;
    setAuxiliaryBusy(true);
    try {
      const result = await getExplorerCandidateComparison(
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
        busy={auxiliaryBusy}
        comparison={comparison}
        diff={diff}
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
            <BoundedGraph graph={graph} selected={selectedIdentity} onSelect={selectObject} />
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
