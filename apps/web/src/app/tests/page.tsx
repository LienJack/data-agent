"use client";

import {
  type BenchmarkAgentDescriptor,
  type BenchmarkCatalogEntry,
  type BenchmarkEvalBatchRun,
  CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
  CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
  CERTIFIED_MODEL_SQL_AGENT_ID,
  PROFILE_ANALYSIS_AGENT_ID,
  PUBLISHED_BASELINE_AGENT_ID,
  type PublicBenchmarkCase,
  SUBMITTED_ANSWER_AGENT_ID,
} from "@data-agent/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveWorkspaceId, workspaceRequestHeaders } from "@/lib/api-client";

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

const statusLabels: Record<BenchmarkCatalogEntry["dataset_status"], string> = {
  NOT_DOWNLOADED: "未安装",
  DOWNLOADING: "下载中",
  READY: "可运行",
  LICENSE_BLOCKED: "许可阻塞",
  ACCESS_GATED: "需人工授权",
  INVALID: "校验失败",
  UPDATE_AVAILABLE: "可更新",
};

const difficultyLabels: Record<PublicBenchmarkCase["difficulty"], string> = {
  simple: "简单",
  moderate: "中等",
  challenging: "挑战",
};

const installableSuites = new Set(["insightbench", "dr-spider", "blade"]);
const certifiedModelAgentIds = new Set([
  CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
  CERTIFIED_MODEL_SQL_AGENT_ID,
  CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
]);

function testCenterPath(path: string): string {
  const workspaceId = resolveWorkspaceId();
  if (!workspaceId) throw new Error("请先选择工作空间。");
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/tests${path}`;
}

function testCenterHeaders(extra: HeadersInit = {}): HeadersInit {
  return { ...workspaceRequestHeaders(), ...extra };
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message ?? "能力测试请求失败。");
  }
  return envelope.data;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function statusClass(status: BenchmarkCatalogEntry["dataset_status"]): string {
  if (status === "READY") return "bg-emerald-50 text-emerald-700";
  if (status === "LICENSE_BLOCKED" || status === "INVALID") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

export default function TestCenterPage() {
  const [suites, setSuites] = useState<readonly BenchmarkCatalogEntry[]>([]);
  const [activeSuiteId, setActiveSuiteId] = useState<string | null>(null);
  const [cases, setCases] = useState<readonly PublicBenchmarkCase[]>([]);
  const [agents, setAgents] = useState<readonly BenchmarkAgentDescriptor[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<ReadonlySet<string>>(new Set());
  const [sql, setSql] = useState("");
  const [run, setRun] = useState<BenchmarkEvalBatchRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runnableSuites = useMemo(() => suites.filter((suite) => suite.runnable), [suites]);
  const activeSuite = useMemo(
    () => runnableSuites.find((suite) => suite.suite_id === activeSuiteId) ?? null,
    [activeSuiteId, runnableSuites],
  );
  const activeCase = useMemo(
    () => cases.find((testCase) => testCase.case_id === activeCaseId) ?? null,
    [activeCaseId, cases],
  );
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.agent_id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const resultByCase = useMemo(
    () => new Map(run?.case_runs.map((caseRun) => [caseRun.case_id, caseRun]) ?? []),
    [run],
  );

  const loadCases = useCallback(async (suiteId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [loadedCases, loadedAgents] = await Promise.all([
        fetch(testCenterPath(`/suites/${encodeURIComponent(suiteId)}/cases`), {
          headers: testCenterHeaders(),
        }).then((response) => readEnvelope<readonly PublicBenchmarkCase[]>(response)),
        fetch(testCenterPath(`/suites/${encodeURIComponent(suiteId)}/agents`), {
          headers: testCenterHeaders(),
        }).then((response) => readEnvelope<readonly BenchmarkAgentDescriptor[]>(response)),
      ]);
      setCases(loadedCases);
      setAgents(loadedAgents);
      setSelectedAgentId(loadedAgents.find((agent) => agent.available)?.agent_id ?? null);
      setActiveCaseId(loadedCases[0]?.case_id ?? null);
      setSelectedCaseIds(new Set(loadedCases.map((testCase) => testCase.case_id)));
      setRun(null);
    } catch (cause) {
      setCases([]);
      setAgents([]);
      setSelectedAgentId(null);
      setActiveCaseId(null);
      setSelectedCaseIds(new Set());
      setError(cause instanceof Error ? cause.message : "题目加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSuites() {
      try {
        const loaded = await readEnvelope<readonly BenchmarkCatalogEntry[]>(
          await fetch(testCenterPath("/suites"), { headers: testCenterHeaders() }),
        );
        if (cancelled) return;
        setSuites(loaded);
        const initial = loaded.find((suite) => suite.runnable) ?? null;
        setActiveSuiteId(initial?.suite_id ?? null);
        if (initial) await loadCases(initial.suite_id);
        else setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "题库目录加载失败。");
          setLoading(false);
        }
      }
    }
    void loadSuites();
    return () => {
      cancelled = true;
    };
  }, [loadCases]);

  const chooseSuite = useCallback(
    (suite: BenchmarkCatalogEntry) => {
      setActiveSuiteId(suite.suite_id);
      setRun(null);
      setSql("");
      if (suite.runnable) {
        void loadCases(suite.suite_id);
      } else {
        setCases([]);
        setAgents([]);
        setSelectedAgentId(null);
        setActiveCaseId(null);
        setSelectedCaseIds(new Set());
        setError(suite.status_reason);
      }
    },
    [loadCases],
  );

  const installActiveSuite = useCallback(async () => {
    if (!activeSuite || !installableSuites.has(activeSuite.suite_id)) return;
    setInstalling(true);
    setError(null);
    try {
      await readEnvelope(
        await fetch(testCenterPath(`/suites/${encodeURIComponent(activeSuite.suite_id)}/install`), {
          method: "POST",
          headers: testCenterHeaders(),
        }),
      );
      const loaded = await readEnvelope<readonly BenchmarkCatalogEntry[]>(
        await fetch(testCenterPath("/suites"), { headers: testCenterHeaders() }),
      );
      setSuites(loaded);
      await loadCases(activeSuite.suite_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "题库自动导入失败。");
    } finally {
      setInstalling(false);
    }
  }, [activeSuite, loadCases]);

  const execute = useCallback(
    async (mode: "single-baseline" | "batch-baseline" | "submitted") => {
      if (!activeSuite || !activeCase) return;
      const caseIds = mode === "batch-baseline" ? [...selectedCaseIds] : [activeCase.case_id];
      if (caseIds.length === 0) {
        setError("请至少选择一道题目。");
        return;
      }
      if (mode === "submitted" && !sql.trim()) {
        setError("请先填写待判分 SQL。");
        return;
      }
      if (mode !== "submitted" && agents.length > 0 && !activeAgent?.available) {
        setError(activeAgent?.unavailable_reason ?? "请选择一个可用的 Agent。");
        return;
      }
      setRunning(true);
      setError(null);
      try {
        const response = await fetch(testCenterPath("/runs"), {
          method: "POST",
          headers: testCenterHeaders({
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          }),
          body: JSON.stringify({
            suite_id: activeSuite.suite_id,
            suite_version: activeSuite.suite_version,
            case_ids: caseIds,
            agent_id:
              mode === "submitted"
                ? SUBMITTED_ANSWER_AGENT_ID
                : (activeAgent?.agent_id ??
                  (activeSuite.suite_id === "insightbench"
                    ? PROFILE_ANALYSIS_AGENT_ID
                    : PUBLISHED_BASELINE_AGENT_ID)),
            reflection_enabled: mode !== "submitted" && (activeAgent?.supports_reflection ?? false),
            seed: 42,
            budget: {
              max_cases: caseIds.length,
              max_attempts_per_case: 2,
              max_case_duration_ms: 240_000,
              max_batch_duration_ms: 1_200_000,
              max_output_tokens_per_attempt: 2_048,
              max_cost_micros:
                activeAgent && certifiedModelAgentIds.has(activeAgent.agent_id) ? 3_000_000 : 0,
              concurrency: 1,
            },
            ...(mode === "submitted"
              ? { submitted_answers: { [activeCase.case_id]: sql.trim() } }
              : {}),
          }),
        });
        setRun(await readEnvelope<BenchmarkEvalBatchRun>(response));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "运行失败。");
      } finally {
        setRunning(false);
      }
    },
    [activeAgent, activeCase, activeSuite, agents.length, selectedCaseIds, sql],
  );

  const toggleCase = useCallback((caseId: string) => {
    setSelectedCaseIds((current) => {
      const next = new Set(current);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  }, []);

  const downloadScorecard = useCallback(() => {
    if (!run?.scorecard) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `benchmark-scorecard-${run.batch_run_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [run]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1500px] px-5 py-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-[-0.02em]">能力测试</h1>
              <span className="rounded bg-[#edf2ef] px-2 py-0.5 text-[10px] font-semibold text-[#527c70]">
                TEST CENTER
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--color-text-muted)]">
              选择公开题库，单题或批量执行；Oracle 确定性判分，首答与反省后成绩分开记录。
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
            <div>密封材料：服务端隔离</div>
            <div className="mt-0.5">成绩聚合：服务端生成</div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="题库选择">
          {runnableSuites.map((suite) => (
            <button
              type="button"
              key={suite.suite_id}
              onClick={() => chooseSuite(suite)}
              className={[
                "min-h-40 rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                activeSuiteId === suite.suite_id
                  ? "border-[#6a8e81] ring-2 ring-[#6a8e81]/10"
                  : "border-[var(--color-border-default)]",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{suite.name}</span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] ${statusClass(suite.dataset_status)}`}
                >
                  {statusLabels[suite.dataset_status]}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 text-[11px] leading-[18px] text-[var(--color-text-secondary)]">
                {suite.description}
              </p>
              <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                <span>{suite.case_count} 题</span>
                <span>{suite.oracle_kind.replaceAll("_", " ")}</span>
              </div>
            </button>
          ))}
        </section>

        {error && (
          <div
            className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
            role="alert"
          >
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="font-medium">
              关闭
            </button>
          </div>
        )}

        <section className="mt-4 grid min-h-[520px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white">
            <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">题目</h2>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  已选 {selectedCaseIds.size} / {cases.length}
                </p>
              </div>
              {cases.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCaseIds(
                      selectedCaseIds.size === cases.length
                        ? new Set()
                        : new Set(cases.map((testCase) => testCase.case_id)),
                    )
                  }
                  className="text-[11px] font-medium text-[#527c70]"
                >
                  {selectedCaseIds.size === cases.length ? "取消全选" : "全选"}
                </button>
              )}
            </div>
            <div className="max-h-[650px] overflow-y-auto p-2">
              {loading ? (
                <div className="p-6 text-center text-xs text-[var(--color-text-muted)]">
                  正在校验题库…
                </div>
              ) : cases.length === 0 ? (
                <div className="p-6 text-center text-xs leading-5 text-[var(--color-text-muted)]">
                  {activeSuite?.status_reason ?? "当前题库没有可公开的题目。"}
                </div>
              ) : (
                cases.map((testCase) => {
                  const caseResult = resultByCase.get(testCase.case_id);
                  return (
                    <div
                      key={testCase.case_id}
                      className={[
                        "mb-1 flex items-start gap-2 rounded-lg border p-2.5",
                        activeCaseId === testCase.case_id
                          ? "border-[#9bb3aa] bg-[#f2f6f4]"
                          : "border-transparent hover:bg-[var(--color-bg-canvas)]",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择第 ${testCase.ordinal + 1} 题`}
                        checked={selectedCaseIds.has(testCase.case_id)}
                        onChange={() => toggleCase(testCase.case_id)}
                        className="mt-0.5 accent-[#527c70]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCaseId(testCase.case_id);
                          setSql("");
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                            #{testCase.ordinal + 1} · {difficultyLabels[testCase.difficulty]}
                          </span>
                          {caseResult && (
                            <span
                              className={
                                caseResult.status === "PASS"
                                  ? "text-[10px] font-semibold text-emerald-700"
                                  : "text-[10px] font-semibold text-red-700"
                              }
                            >
                              {caseResult.status}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-[18px] text-[var(--color-text-primary)]">
                          {testCase.question}
                        </p>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="rounded-xl border border-[var(--color-border-default)] bg-white p-5">
              {activeCase ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                      <span>题目 #{activeCase.ordinal + 1}</span>
                      <span>·</span>
                      <span>{activeCase.database_id}</span>
                      <span>·</span>
                      <span>{difficultyLabels[activeCase.difficulty]}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => void execute("single-baseline")}
                        className="rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs font-medium hover:bg-[var(--color-bg-canvas)] disabled:opacity-50"
                      >
                        运行所选 Agent 单题
                      </button>
                      <button
                        type="button"
                        disabled={running || selectedCaseIds.size === 0}
                        onClick={() => void execute("batch-baseline")}
                        className="rounded-lg bg-[#171a18] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50"
                      >
                        {running ? "执行中…" : `批量运行所选 Agent · ${selectedCaseIds.size} 题`}
                      </button>
                    </div>
                  </div>
                  <h2 className="mt-5 max-w-4xl text-base font-semibold leading-7">
                    {activeCase.question}
                  </h2>
                  {activeCase.evidence && (
                    <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      <span className="font-semibold">Evidence：</span>
                      {activeCase.evidence}
                    </div>
                  )}

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold">公开 Schema</h3>
                      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border-default)] bg-[#fafbfa] p-3 font-mono text-[10px] leading-5">
                        {activeCase.schema.length === 0 ? (
                          <div className="font-sans text-[11px] text-[var(--color-text-muted)]">
                            本题不使用数据库 Schema；题面与研究上下文就是全部公开输入。
                          </div>
                        ) : (
                          activeCase.schema.map((table) => (
                            <div key={table.name} className="mb-3 last:mb-0">
                              <div className="font-semibold text-[#42685e]">{table.name}</div>
                              <div className="text-[var(--color-text-secondary)]">
                                {table.columns
                                  .map((column) => `${column.name}: ${column.data_type}`)
                                  .join(" · ")}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    {agents.length > 0 ? (
                      <div className="rounded-lg border border-[#bfd0ca] bg-[#f2f6f4] p-4 text-xs leading-6 text-[#42685e]">
                        <div className="font-semibold">运行 Agent</div>
                        <div className="mt-3 space-y-2">
                          {agents.map((agent) => (
                            <button
                              type="button"
                              key={agent.agent_id}
                              disabled={!agent.available || running}
                              onClick={() => setSelectedAgentId(agent.agent_id)}
                              className={[
                                "w-full rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-55",
                                selectedAgentId === agent.agent_id
                                  ? "border-[#527c70] bg-white"
                                  : "border-[#cfddd8] bg-white/60 hover:bg-white",
                              ].join(" ")}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-semibold">{agent.display_name}</span>
                                <span className="text-[10px]">
                                  {agent.available ? "可运行" : "未就绪"}
                                </span>
                              </span>
                              <span className="mt-1 block text-[10px] leading-4 text-[var(--color-text-muted)]">
                                {agent.available
                                  ? certifiedModelAgentIds.has(agent.agent_id)
                                    ? `${agent.provider} / ${agent.model_id} · 单批成本上限 $3`
                                    : "冻结公开基线"
                                  : agent.unavailable_reason}
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
                          Agent 只读取公开题面、Evidence 与 Schema；若支持
                          Reflection，失败后只接收不泄漏封存答案的类型化反馈。
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold">提交 SQL 做题</h3>
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            只读沙箱
                          </span>
                        </div>
                        <textarea
                          value={sql}
                          onChange={(event) => setSql(event.target.value)}
                          placeholder="SELECT ..."
                          spellCheck={false}
                          className="mt-2 h-40 w-full resize-y rounded-lg border border-[var(--color-border-default)] bg-[#111513] p-3 font-mono text-xs leading-5 text-[#d9e3de] placeholder:text-[#6d7772]"
                        />
                        <button
                          type="button"
                          disabled={running || !sql.trim()}
                          onClick={() => void execute("submitted")}
                          className="mt-2 w-full rounded-lg border border-[#527c70] px-3 py-2 text-xs font-semibold text-[#42685e] hover:bg-[#edf2ef] disabled:opacity-50"
                        >
                          提交并确定性判分
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border-default)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
                    自反省重试只对声明支持 Reflection 的运行时 Agent
                    开放；题目、数据、封存真值、Oracle 与预算保持冻结，首答和终答分别记分。
                  </div>
                </>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>选择一个已安装题库后开始做题。</span>
                  {activeSuite &&
                    installableSuites.has(activeSuite.suite_id) &&
                    activeSuite.dataset_status === "NOT_DOWNLOADED" && (
                      <button
                        type="button"
                        disabled={installing}
                        onClick={() => void installActiveSuite()}
                        className="rounded-lg bg-[#171a18] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {installing
                          ? "正在下载并校验…"
                          : `自动导入 ${activeSuite.smoke_case_count} 题 Smoke Slice`}
                      </button>
                    )}
                </div>
              )}
            </div>

            {run?.scorecard && (
              <section
                className="rounded-xl border border-[var(--color-border-default)] bg-white p-5"
                aria-label="成绩单"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">成绩单</h2>
                    <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                      Run {run.batch_run_id} · {run.manifest.agent.display_name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={downloadScorecard}
                    className="rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-[11px] font-medium hover:bg-[var(--color-bg-canvas)]"
                  >
                    下载 JSON 回执
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["首答正确率", percent(run.scorecard.first_pass_pass_rate)],
                    ["反省后正确率", percent(run.scorecard.post_reflection_pass_rate)],
                    ["恢复率", percent(run.scorecard.recovery_rate)],
                    ["有效题目", `${run.scorecard.valid_cases} / ${run.scorecard.total_cases}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-[var(--color-bg-canvas)] p-3">
                      <div className="text-[10px] text-[var(--color-text-muted)]">{label}</div>
                      <div className="mt-1 text-xl font-semibold tracking-[-0.03em]">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="border-b border-[var(--color-border-default)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-2 py-2 font-medium">题号</th>
                        <th className="px-2 py-2 font-medium">结果</th>
                        <th className="px-2 py-2 font-medium">尝试</th>
                        <th className="px-2 py-2 font-medium">得分</th>
                        <th className="px-2 py-2 font-medium">Oracle 反馈</th>
                        <th className="px-2 py-2 font-medium">耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.case_runs.map((caseRun) => {
                        const lastAttempt = caseRun.attempts.at(-1);
                        return (
                          <tr
                            key={caseRun.case_run_id}
                            className="border-b border-[var(--color-border-default)] last:border-0"
                          >
                            <td className="px-2 py-3 font-medium">#{caseRun.ordinal + 1}</td>
                            <td
                              className={
                                caseRun.status === "PASS"
                                  ? "px-2 py-3 font-semibold text-emerald-700"
                                  : "px-2 py-3 font-semibold text-red-700"
                              }
                            >
                              {caseRun.status}
                            </td>
                            <td className="px-2 py-3">{caseRun.attempts.length}</td>
                            <td className="px-2 py-3">
                              {caseRun.normalized_score === null
                                ? "—"
                                : caseRun.normalized_score.toFixed(1)}
                            </td>
                            <td className="max-w-md px-2 py-3 text-[var(--color-text-secondary)]">
                              {lastAttempt?.oracle_feedback.public_message ?? "—"}
                            </td>
                            <td className="px-2 py-3">
                              {lastAttempt ? `${lastAttempt.latency_ms} ms` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
                  <span>Dataset {run.manifest.dataset_digest.slice(0, 20)}…</span>
                  <span>Manifest {run.manifest.manifest_hash.slice(0, 20)}…</span>
                  <span>Scorecard {run.scorecard.scorecard_hash.slice(0, 20)}…</span>
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
