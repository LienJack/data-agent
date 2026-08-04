"use client";

import { useCallback, useEffect } from "react";
import { AuthorityStatusBar } from "@/components/workbench/authority-status-bar";
import { ClarificationDialog } from "@/components/workbench/clarification-dialog";
import { EvalSection } from "@/components/workbench/eval-section";
import { HypothesisSection } from "@/components/workbench/hypothesis-section";
import { QueryInputSection } from "@/components/workbench/query-input-section";
import { ReportSection } from "@/components/workbench/report-section";
import {
  commandRun,
  createRun,
  getRun,
  type RunEvent,
  resolveWorkspaceId,
  streamRunEvents,
} from "@/lib/api-client";
import { createM1DemoState, type RunProjection } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";

/** 判断 Run 是否已终止（COMPLETED / FAILED / CANCELLED） */
function isRunTerminal(status: RunProjection["status"]): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

export default function AnalysisWorkbenchPage() {
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
  const projectionVersion = useWorkbenchStore((s) => s.projectionVersion);
  const projection = useWorkbenchStore((s) => s.projection);
  const _connection = useWorkbenchStore((s) => s.connection);
  const _busy = useWorkbenchStore((s) => s.busy);

  const state = useWorkbenchStore((s) => ({
    authorityState: s.authorityState,
    coreL2Verdict: s.coreL2Verdict,
    attributionF9Status: s.attributionF9Status,
    fixtureEvidenceVerdict: s.fixtureEvidenceVerdict,
    currentAction: s.currentAction,
    l2Only: s.projection?.l2Only ?? true,
    demoLicense: s.projection?.demoLicense ?? "Demo v1.0.0",
    demoVersion: s.projection?.demoVersion ?? "1.0.0",
    experienceOnly: s.projection?.experienceOnly ?? true,
    l3Route: s.l3Route,
    l4Route: s.l4Route,
    l5Route: s.l5Route,
  }));

  // ── 初始化 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const stored = sessionStorage.getItem("data-agent.activeRunId");
    if (stored) {
      setActiveRunId(stored);
      void (async () => {
        try {
          setConnection("connecting");
          const run = await getRun(stored);
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
  ]);

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
    const workspaceId = resolveWorkspaceId();
    let cursor = useWorkbenchStore.getState().projectionVersion;
    let attempt = 0;

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
              if (event.type === "projection" || event.type === "terminal") {
                const store = useWorkbenchStore.getState();
                if (event.payload) {
                  const updated = event.payload as Partial<RunProjection>;
                  const merged = { ...store.projection, ...updated } as RunProjection;
                  store.setProjection(merged);
                  store.setProjectionVersion(cursor);
                  if (event.type === "terminal" || isRunTerminal(merged.status)) {
                    store.setConnection("closed");
                    store.setCurrentAction("分析完成");
                  }
                }
              } else if (event.type === "error") {
                const store = useWorkbenchStore.getState();
                store.setError(typeof event.payload === "string" ? event.payload : "分析过程出错");
              }
            },
          });
          if (stopped) return;
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
  }, [activeRunId, setConnection]);

  // ── 提交与分析命令 ──────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      setBusy(true);
      setError(undefined);
      try {
        const workspaceId = resolveWorkspaceId();
        const run = await createRun(question, workspaceId);
        setActiveRunId(run.runId);
        setProjection(run);
        setProjectionVersion(0);
        setConnection("connecting");
        setCurrentAction("分析中…");
        setSectionStatus("query", "ready");
        sessionStorage.setItem("data-agent.activeRunId", run.runId);
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
    ],
  );

  const handleCommand = useCallback(
    async (command: "cancel" | "resume" | "replay") => {
      if (!activeRunId || !projection) return;
      setBusy(true);
      try {
        const label =
          command === "cancel" ? "取消中…" : command === "resume" ? "恢复中…" : "重播中…";
        setCurrentAction(label);
        await commandRun(activeRunId, command, projectionVersion);
        if (command === "replay") {
          setProjectionVersion(0);
          setConnection("connecting");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : `命令 ${command} 失败`);
      } finally {
        setBusy(false);
      }
    },
    [
      activeRunId,
      projection,
      projectionVersion,
      setBusy,
      setError,
      setCurrentAction,
      setConnection,
      setProjectionVersion,
    ],
  );

  // ── 渲染 ────────────────────────────────────────────────────────────────

  return (
    <div>
      <AuthorityStatusBar
        authorityState={state.authorityState}
        coreL2Status={state.coreL2Verdict}
        attributionF9Status={state.attributionF9Status}
        fixtureEvidenceStatus={state.fixtureEvidenceVerdict}
        currentAction={state.currentAction}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {/* 信息层级 1: 权威状态/当前动作（已由 AuthorityStatusBar 展示） */}

        {/* 信息层级 2: Question/Scope/Clarification */}
        <QueryInputSection onSubmit={handleSubmit} onCommand={handleCommand} />

        {/* 信息层级 3: Report/Claim–Evidence */}
        <ReportSection />

        {/* 信息层级 4: Hypothesis/SQL/Receipt */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <HypothesisSection />
          <EvalSection />
        </div>

        {/* M1 固定信息 — 符合 implement.md §8.7 要求 */}
        <M1StateFooter
          l2Only={state.l2Only}
          demoLicense={state.demoLicense}
          demoVersion={state.demoVersion}
          experienceOnly={state.experienceOnly}
          l3Route={state.l3Route}
          l4Route={state.l4Route}
          l5Route={state.l5Route}
        />
      </main>

      {/* 澄清对话框 */}
      <ClarificationDialog />
    </div>
  );
}

function M1StateFooter({
  l2Only,
  demoLicense,
  demoVersion,
  experienceOnly,
  l3Route,
  l4Route,
  l5Route,
}: {
  l2Only: boolean;
  demoLicense: string;
  demoVersion: string;
  experienceOnly: boolean;
  l3Route: string;
  l4Route: string;
  l5Route: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-center text-xs text-[var(--color-text-tertiary)]">
      <p>
        Data Agent · M1 Demo · Core L2=
        <span className="font-medium text-[var(--color-warning)]">HOLD</span>
        {" · "}归因 F9=
        <span className="font-medium text-[var(--color-text-tertiary)]">NOT_REGISTERED</span>
        {" · "}Fixture Evidence=
        <span className="font-medium text-[var(--color-warning)]">HOLD</span>
      </p>
      <p className="mt-1">
        {demoLicense} v{demoVersion}
        {experienceOnly && " · 仅体验用途"}
        {l2Only && " · 仅 L2 能力"}
      </p>
      <p className="mt-1">
        {l3Route === "NOT_DELIVERED" && "L3 实验 DAG 未交付 · "}
        {l4Route === "NOT_DELIVERED" && "L4 主动发现 未交付 · "}
        {l5Route === "NOT_DELIVERED" && "L5 因果决策 未交付"}· 本页面仅展示 L2 分析工作台可行性
      </p>
    </div>
  );
}
