"use client";

import { Database } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AnalysisReportDocument } from "@/components/workbench/analysis-report-document";
import { ClarificationDialog } from "@/components/workbench/clarification-dialog";
import { TaskConsole } from "@/components/workbench/task-console";
import { WorkbenchComposer } from "@/components/workbench/workbench-composer";
import { submitBoundAnalysisRun } from "@/lib/analysis-run-submission";
import { getRun, type RunEvent, streamRunEvents } from "@/lib/api-client";
import { useQAStore } from "@/lib/qa-store";
import { createM1DemoState, type RunProjection } from "@/lib/run-projection";
import { useWorkspaceId } from "@/lib/use-workspace-id";
import { useWorkbenchStore } from "@/lib/workbench-store";
import { workspaceStorageKey } from "@/lib/workspace-routes";

/** 判断 Run 是否已终止（COMPLETED / FAILED / CANCELLED） */
function isRunTerminal(status: RunProjection["status"]): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

export default function AnalysisWorkbenchPage() {
  const workspaceId = useWorkspaceId();
  const activeRunStorageKey = workspaceId ? workspaceStorageKey(workspaceId, "activeRunId") : "";
  const [consoleOpen, setConsoleOpen] = useState(true);
  const hydrate = useWorkbenchStore((s) => s.hydrate);
  const setProjection = useWorkbenchStore((s) => s.setProjection);
  const setConnection = useWorkbenchStore((s) => s.setConnection);
  const setActiveRunId = useWorkbenchStore((s) => s.setActiveRunId);
  const setProjectionVersion = useWorkbenchStore((s) => s.setProjectionVersion);
  const setError = useWorkbenchStore((s) => s.setError);
  const setCurrentAction = useWorkbenchStore((s) => s.setCurrentAction);
  const setSectionStatus = useWorkbenchStore((s) => s.setSectionStatus);
  const setBusy = useWorkbenchStore((s) => s.setBusy);

  const activeRunId = useWorkbenchStore((s) => s.activeRunId);
  const projection = useWorkbenchStore((s) => s.projection);
  const _busy = useWorkbenchStore((s) => s.busy);
  const conversations = useQAStore((s) => s.conversations);
  const activeConversationId = useQAStore((s) => s.activeConversationId);
  const loadConversations = useQAStore((s) => s.loadConversations);
  const selectConversation = useQAStore((s) => s.selectConversation);
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const conversationReady = Boolean(
    activeConversation?.dataSourceId && activeConversation.modelProfileId,
  );

  const state = useWorkbenchStore(
    useShallow((s) => ({
      coreL2Verdict: s.coreL2Verdict,
      attributionF9Status: s.attributionF9Status,
      fixtureEvidenceVerdict: s.fixtureEvidenceVerdict,
      currentAction: s.currentAction,
      authorityState: s.authorityState,
      connection: s.connection,
      projectionVersion: s.projectionVersion,
    })),
  );

  // ── 初始化 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!workspaceId) return;
    const stored = sessionStorage.getItem(activeRunStorageKey);
    if (stored) {
      setActiveRunId(stored);
      void (async () => {
        try {
          setConnection("connecting");
          const run = await getRun(stored, workspaceId);
          setProjection(run);
          setProjectionVersion(0);
          setConnection(isRunTerminal(run.status) ? "closed" : "live");
          setCurrentAction(
            run.status === "RUNNING" ? "分析中…" : run.status === "QUEUED" ? "等待中…" : "分析完成",
          );
          setSectionStatus("query", "ready");
        } catch (err) {
          setError(err instanceof Error ? err.message : "获取 Run 失败");
          setConnection("closed");
        }
      })();
    } else {
      hydrate(createM1DemoState());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setSectionStatus,
    setProjectionVersion,
    setError,
    setActiveRunId,
    setProjection,
    setCurrentAction,
    setConnection,
    hydrate,
    activeRunStorageKey,
    workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    void loadConversations();
  }, [loadConversations, workspaceId]);

  useEffect(() => {
    if (activeConversationId || !conversations[0]) return;
    void selectConversation(conversations[0].id);
  }, [activeConversationId, conversations, selectConversation]);

  // ── SSE 生命周期 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeRunId) return;

    const current = useWorkbenchStore.getState().projection;
    if (current && isRunTerminal(current.status)) {
      setConnection("closed");
      return;
    }

    let stopped = false;
    const controller = new AbortController();
    let cursor = useWorkbenchStore.getState().projectionVersion;
    let attempt = 0;
    let terminalSeen = false;

    void (async () => {
      while (!stopped) {
        setConnection(attempt === 0 ? "connecting" : "reconnecting");
        try {
          setConnection("live");
          await streamRunEvents({
            runId: activeRunId,
            workspaceId,
            cursor,
            signal: controller.signal,
            onEvent: (event: RunEvent) => {
              cursor = Math.max(cursor, event.sequence);
              const store = useWorkbenchStore.getState();
              store.setProjectionVersion(cursor);
              if (event.type === "progress" || event.type === "tool") {
                store.setCurrentAction(event.payload.summary);
              }
              if (event.type === "terminal") terminalSeen = true;
            },
          });
          if (stopped) return;
          if (terminalSeen) {
            const updated = await getRun(activeRunId, workspaceId);
            const store = useWorkbenchStore.getState();
            store.setProjection(updated);
            store.setConnection("closed");
            store.setCurrentAction(updated.status === "COMPLETED" ? "分析完成" : "分析已终止");
            return;
          }
          // 流正常闭合 → 检查终态
          const store = useWorkbenchStore.getState();
          const p = store.projection;
          if (p && isRunTerminal(p.status)) {
            store.setConnection("closed");
            return;
          }
        } catch (_error) {
          if (controller.signal.aborted || stopped) return;
          attempt += 1;
          // 不重复设置相同错误，避免闪烁
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [activeRunId, setConnection, workspaceId]);

  // ── 提交分析 ────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      if (!workspaceId) {
        setError("请先选择工作空间");
        return;
      }
      if (!activeConversation || !conversationReady) {
        setError("请先在问答工作区创建对话，并绑定可运行模型与数据源");
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const run = await submitBoundAnalysisRun({
          question,
          workspace_id: workspaceId,
          conversation: activeConversation,
        });
        setActiveRunId(run.runId);
        setProjection(run);
        setProjectionVersion(0);
        setConnection("connecting");
        setCurrentAction("分析中…");
        setSectionStatus("query", "ready");
        sessionStorage.setItem(activeRunStorageKey, run.runId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建分析任务失败");
      } finally {
        setBusy(false);
      }
    },
    [
      setBusy,
      setError,
      setActiveRunId,
      setProjection,
      setProjectionVersion,
      setConnection,
      setCurrentAction,
      setSectionStatus,
      activeRunStorageKey,
      activeConversation,
      conversationReady,
      workspaceId,
    ],
  );

  // ── 渲染 ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 bg-[var(--color-bg-surface)]">
      <section className="relative flex min-w-0 flex-1 flex-col" aria-label="分析报告工作区">
        <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
              {projection?.question ?? "新数据分析"}
            </p>
            <div className="mt-2 flex items-center gap-2 overflow-hidden">
              {projection?.scope?.workspace && (
                <HeaderPill name="工作区" value={projection.scope.workspace} />
              )}
              {projection?.scope?.dataset && (
                <HeaderPill name="数据集" value={projection.scope.dataset} />
              )}
              {projection?.scope?.dialect && (
                <HeaderPill name="方言" value={projection.scope.dialect} />
              )}
              <span className="hidden rounded-full border border-[var(--color-border-default)] px-2.5 py-1 text-[10px] text-[var(--color-text-muted)] 2xl:inline">
                Core L2
              </span>
            </div>
          </div>
          <span
            className={[
              "rounded border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase",
              projection?.status === "COMPLETED"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            ].join(" ")}
          >
            {projection?.status === "COMPLETED" ? "工作流已完成" : state.currentAction}
          </span>
          {!consoleOpen && (
            <button
              type="button"
              onClick={() => setConsoleOpen(true)}
              className="hidden rounded-md border border-[var(--color-border-default)] px-3 py-2 text-[11px] font-medium hover:bg-[var(--color-bg-tertiary)] xl:block"
            >
              查看运行与证据
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pb-40">
          <AnalysisReportDocument
            projection={projection}
            coreL2Verdict={state.coreL2Verdict}
            attributionF9Status={state.attributionF9Status}
            fixtureEvidenceVerdict={state.fixtureEvidenceVerdict}
          />
        </div>

        {!conversationReady && (
          <p
            className="absolute inset-x-6 bottom-36 z-20 mx-auto max-w-[940px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 lg:inset-x-10"
            role="status"
          >
            请先在问答工作区创建对话，并绑定可运行模型与数据源后再开始分析。
          </p>
        )}
        <WorkbenchComposer
          projection={projection}
          busy={_busy || !conversationReady}
          onSubmit={handleSubmit}
        />
      </section>

      {consoleOpen && (
        <div className="hidden h-full xl:block">
          <TaskConsole
            projection={projection}
            currentAction={state.currentAction}
            authorityState={state.authorityState}
            connection={state.connection}
            projectionVersion={state.projectionVersion}
            coreL2Verdict={state.coreL2Verdict}
            attributionF9Status={state.attributionF9Status}
            fixtureEvidenceVerdict={state.fixtureEvidenceVerdict}
            onClose={() => setConsoleOpen(false)}
          />
        </div>
      )}
      <ClarificationDialog
        workspaceId={workspaceId}
        runId={activeRunId}
        onResolved={async () => {
          if (!activeRunId) return;
          const resumed = await getRun(activeRunId, workspaceId);
          setProjection(resumed);
          setConnection("connecting");
          setCurrentAction("正在恢复…");
        }}
      />
    </div>
  );
}

function HeaderPill({ name, value }: { name: string; value: string }) {
  return (
    <span className="flex max-w-[190px] items-center gap-1.5 truncate border-l border-[var(--color-border-default)] pl-2.5 text-[10px] text-[var(--color-text-secondary)]">
      <Database aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]" size={12} />
      <span className="shrink-0 text-[var(--color-text-muted)]">{name}</span>
      <span className="truncate font-medium">{value}</span>
    </span>
  );
}
