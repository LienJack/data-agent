"use client";

import type { SemanticAuthoringPublicEvent } from "@data-agent/contracts";
import {
  mergeSemanticAuthoringPublicFeeds,
  type SemanticAuthoringPublicFeed,
} from "@data-agent/semantic/application";
import {
  ArrowLeft,
  Brain,
  CheckCircle,
  CircleNotch,
  ClockCountdown,
  GitDiff,
  Pulse,
  Question,
  Robot,
  ShieldCheck,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceLocale } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import { useLayoutStore } from "@/lib/layout-store";
import {
  loadSemanticAuthoringPublicFeed,
  resumeSemanticAuthoring,
  subscribeSemanticAuthoringPublicFeed,
} from "@/lib/semantic-studio-api";
import {
  assembleSemanticAuthoringProcessEvents,
  publicEventSummary,
} from "@/lib/semantic-studio-model";

const TOOL_LABELS: Record<string, string> = {
  list_semantic_types: "读取语义类型",
  search_semantic_nodes: "搜索语义节点",
  read_semantic_node: "读取语义节点",
  read_semantic_edge: "读取语义关系",
  get_semantic_neighborhood: "读取邻域",
  read_schema_bindings: "读取物理绑定",
  read_formula_dependencies: "读取公式依赖",
  read_candidate_diff: "读取候选差异",
  create_semantic_node: "创建语义节点",
  update_semantic_node: "更新语义节点",
  retire_semantic_node: "退役语义节点",
  create_semantic_edge: "创建语义关系",
  update_semantic_edge: "更新语义关系",
  retire_semantic_edge: "退役语义关系",
  propose_semantic_edge_type: "提议关系类型",
  validate_semantic_graph: "校验候选图",
  analyze_semantic_impact: "分析变更影响",
  request_semantic_clarification: "请求业务澄清",
  complete_authoring_run: "完成语义创作",
};

function copy(locale: WorkspaceLocale, zhCN: string, enUS: string): string {
  return locale === "zh-CN" ? zhCN : enUS;
}

function eventPresentation(event: SemanticAuthoringPublicEvent, locale: WorkspaceLocale) {
  switch (event.type) {
    case "stage":
      return event.payload.phase.startsWith("semantic-turn-")
        ? {
            label: copy(locale, "思考摘要", "Thinking summary"),
            Icon: Brain,
            tone: "text-[#4f627c]",
            surface: "bg-[#e9edf3]",
          }
        : {
            label: copy(locale, "执行阶段", "Execution stage"),
            Icon: CircleNotch,
            tone: "text-[#426e60]",
            surface: "bg-[#e9f1ed]",
          };
    case "tool":
      return {
        label:
          locale === "zh-CN"
            ? (TOOL_LABELS[event.payload.tool_name] ?? event.payload.tool_name)
            : event.payload.tool_name,
        Icon: Wrench,
        tone: event.payload.status === "FAILED" ? "text-[#a04436]" : "text-[#426e60]",
        surface: event.payload.status === "FAILED" ? "bg-[#f8e9e6]" : "bg-[#e9f1ed]",
      };
    case "graph_patch":
      return {
        label: "Candidate Patch",
        Icon: GitDiff,
        tone: "text-[#896117]",
        surface: "bg-[#f8f0dc]",
      };
    case "validation":
      return {
        label: copy(locale, "确定性校验", "Deterministic validation"),
        Icon: event.payload.valid ? CheckCircle : WarningCircle,
        tone: event.payload.valid ? "text-[#36705d]" : "text-[#9a6318]",
        surface: event.payload.valid ? "bg-[#e6f1eb]" : "bg-[#fbf0d9]",
      };
    case "clarification":
      return {
        label: copy(locale, "业务澄清", "Business clarification"),
        Icon: Question,
        tone: "text-[#3d6f85]",
        surface: "bg-[#e7f0f4]",
      };
    case "authoring_terminal":
      return {
        label: copy(locale, "任务结束", "Run terminal"),
        Icon: event.payload.status === "FAILED" ? WarningCircle : ShieldCheck,
        tone: event.payload.status === "FAILED" ? "text-[#a04436]" : "text-[#36705d]",
        surface: event.payload.status === "FAILED" ? "bg-[#f8e9e6]" : "bg-[#e6f1eb]",
      };
  }
}

function runStatus(feed: SemanticAuthoringPublicFeed, now: number, locale: WorkspaceLocale) {
  const queuedFor = now - new Date(feed.run.updated_at).getTime();
  if (feed.run.status === "QUEUED" && queuedFor >= 10_000) {
    return {
      label: copy(locale, "等待执行器领取", "Waiting for a worker"),
      detail: copy(
        locale,
        "任务已安全保存，但尚未产生 Worker 事件。页面会持续自动重连。",
        "The task is durable but has no Worker event yet. This page keeps reconnecting.",
      ),
      tone: "text-[#8a5b15]",
      dot: "bg-[#bb8126]",
    };
  }
  switch (feed.run.status) {
    case "QUEUED":
      return {
        label: copy(locale, "已排队", "Queued"),
        detail: copy(
          locale,
          "请求已保存，正在等待执行器领取。",
          "The request is waiting for a worker.",
        ),
        tone: "text-[#4f665e]",
        dot: "bg-[#799288]",
      };
    case "RUNNING":
      return {
        label: copy(locale, "Agent 正在执行", "Agent running"),
        detail: copy(
          locale,
          `正在处理第 ${Math.max(1, feed.run.current_turn + 1)} 轮。`,
          `Processing turn ${Math.max(1, feed.run.current_turn + 1)}.`,
        ),
        tone: "text-[#356b5a]",
        dot: "bg-[#4e8a76]",
      };
    case "WAITING_CLARIFICATION":
      return {
        label: copy(locale, "等待你的确认", "Waiting for clarification"),
        detail: copy(
          locale,
          "选择一个业务口径后，Agent 会从保存的 checkpoint 继续。",
          "Choose a business interpretation to resume from the durable checkpoint.",
        ),
        tone: "text-[#366f87]",
        dot: "bg-[#4b8298]",
      };
    case "READY_FOR_REVIEW":
      return {
        label: copy(locale, "已生成待审核 Candidate", "Candidate ready for review"),
        detail: copy(
          locale,
          "确定性校验已通过；发布前仍不会影响活动语义。",
          "Deterministic validation passed; active semantics remain unchanged until publish.",
        ),
        tone: "text-[#2f6b58]",
        dot: "bg-[#3d806a]",
      };
    case "FAILED":
      return {
        label: copy(locale, "执行失败", "Run failed"),
        detail: copy(
          locale,
          "已保留公开轨迹与 checkpoint，可据错误信息恢复。",
          "The public trace and checkpoint are retained for governed recovery.",
        ),
        tone: "text-[#a04436]",
        dot: "bg-[#b45445]",
      };
    case "CANCELLED":
      return {
        label: copy(locale, "已取消", "Cancelled"),
        detail: copy(
          locale,
          "该任务没有写入活动语义。",
          "This task did not change active semantics.",
        ),
        tone: "text-[#65716c]",
        dot: "bg-[#8a948f]",
      };
  }
}

export function SemanticAuthoringTrace({
  workspaceId,
  runId,
  semanticDomain,
}: {
  readonly workspaceId: string;
  readonly runId: string;
  readonly semanticDomain: string;
}) {
  const { locale } = useWorkspaceI18n();
  const [feed, setFeed] = useState<SemanticAuthoringPublicFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");
  const [resuming, setResuming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const cursor = useRef(0);
  const prefersReducedMotion = useReducedMotion();
  const setSidebarCollapsed = useLayoutStore((state) => state.setSidebarCollapsed);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const collapseForSmallScreen = () => {
      if (media.matches) setSidebarCollapsed(true);
    };
    collapseForSmallScreen();
    media.addEventListener("change", collapseForSmallScreen);
    return () => media.removeEventListener("change", collapseForSmallScreen);
  }, [setSidebarCollapsed]);

  const mergeFeed = useCallback((incoming: SemanticAuthoringPublicFeed) => {
    cursor.current = Math.max(cursor.current, incoming.events.at(-1)?.sequence ?? 0);
    setFeed((current) => mergeSemanticAuthoringPublicFeeds(current, incoming));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadSemanticAuthoringPublicFeed(
      workspaceId,
      { semanticDomain, runId, after: 0 },
      controller.signal,
    )
      .then((value) => {
        mergeFeed(value);
        setFatalError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFatalError(error instanceof Error ? error.message : "无法读取 Agent 公开轨迹。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mergeFeed, runId, semanticDomain, workspaceId]);

  const open =
    feed?.run.status === "QUEUED" ||
    feed?.run.status === "RUNNING" ||
    feed?.run.status === "WAITING_CLARIFICATION";

  useEffect(() => {
    if (!open) return;
    return subscribeSemanticAuthoringPublicFeed(
      workspaceId,
      { semanticDomain, runId, after: cursor.current },
      {
        onAuthoring: (value) => {
          mergeFeed(value);
          setStreamNotice(null);
        },
        onError: setStreamNotice,
        onConnectionChange: setConnection,
      },
    );
  }, [mergeFeed, open, runId, semanticDomain, workspaceId]);

  useEffect(() => {
    if (feed?.run.status !== "QUEUED") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [feed?.run.status]);

  const status = useMemo(() => (feed ? runStatus(feed, now, locale) : null), [feed, locale, now]);
  const processEvents = useMemo(
    () => assembleSemanticAuthoringProcessEvents(feed?.events ?? []),
    [feed?.events],
  );
  const backHref = `/w/${encodeURIComponent(workspaceId)}/semantic?domain=${encodeURIComponent(
    semanticDomain,
  )}&runId=${encodeURIComponent(runId)}`;

  async function answerClarification(answer: string) {
    const clarification = feed?.run.clarification;
    if (!clarification || clarification.answered || resuming) return;
    setResuming(true);
    setFatalError(null);
    try {
      await resumeSemanticAuthoring(workspaceId, {
        semantic_domain: semanticDomain,
        run_id: runId,
        clarification_id: clarification.clarification_id,
        answer,
        idempotency_key: crypto.randomUUID(),
      });
      mergeFeed(
        await loadSemanticAuthoringPublicFeed(workspaceId, {
          semanticDomain,
          runId,
          after: cursor.current,
        }),
      );
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "无法提交澄清答案。");
    } finally {
      setResuming(false);
    }
  }

  if (loading && feed === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f3f5f3] px-6 text-[#26312d]">
        <div className="w-full max-w-sm border-l-2 border-[#356b5a] pl-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#356b5a]">
            Public agent trace
          </p>
          <p className="mt-2 text-sm font-medium">
            {copy(locale, "正在恢复公开事件流", "Restoring the public event stream")}
          </p>
          <div className="mt-4 h-px overflow-hidden bg-[#d8dfda]">
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

  if (feed === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f3f5f3] px-6 text-[#26312d]">
        <div className="w-full max-w-lg border-y border-[#d8dfda] bg-white px-8 py-12 text-center">
          <WarningCircle className="mx-auto size-7 text-[#a04436]" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">
            {copy(locale, "无法打开这条执行轨迹", "Unable to open this execution trace")}
          </h1>
          <p className="mt-2 text-xs leading-5 text-[#65716c]">{fatalError}</p>
          <Link
            href={backHref}
            className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-[#356b5a]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {copy(locale, "返回语义工作台", "Back to Semantic Studio")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f5f3] text-[#26312d]">
      <header className="border-b border-[#d6ddd8] bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1540px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <nav
              className="flex items-center gap-2 text-[11px] text-[#728079]"
              aria-label={copy(locale, "面包屑", "Breadcrumb")}
            >
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 hover:text-[#356b5a]"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {copy(locale, "语义工作台", "Semantic Studio")}
              </Link>
              <span aria-hidden="true">/</span>
              <span className="truncate font-mono text-[#4e5a55]">{semanticDomain}</span>
              <span aria-hidden="true">/</span>
              <span className="truncate">{copy(locale, "Agent 执行轨迹", "Agent trace")}</span>
            </nav>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold sm:text-xl">
                {copy(locale, "语义变更执行轨迹", "Semantic authoring trace")}
              </h1>
              {status ? (
                <span
                  className={`inline-flex items-center gap-2 text-[11px] font-semibold ${status.tone}`}
                >
                  <span
                    className={`size-1.5 ${status.dot} ${open ? "animate-pulse" : ""}`}
                    aria-hidden="true"
                  />
                  {status.label}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[#718079]">
            <span className="font-mono">Run · {runId.slice(0, 8)}</span>
            <span className="h-4 w-px bg-[#d8dfda]" aria-hidden="true" />
            <span className={connection === "live" ? "text-[#3a715f]" : "text-[#94631e]"}>
              {connection === "live"
                ? copy(locale, "事件流已连接", "Event stream connected")
                : copy(locale, "正在重新连接", "Reconnecting")}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1540px] gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(330px,0.8fr)] lg:px-6">
        <section
          className="min-w-0 border border-[#d8dfda] bg-white"
          aria-label={copy(locale, "Agent 对话内容", "Agent conversation")}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#d8dfda] px-4 py-3 sm:px-5">
            <div>
              <p className="text-xs font-semibold">{copy(locale, "对话内容", "Conversation")}</p>
              <p className="mt-1 text-[10px] leading-4 text-[#75817b]">
                {copy(
                  locale,
                  "仅展示用户原始意图与可公开的 Agent 回复；不包含系统提示或私有推理。",
                  "Shows the user intent and public Agent response only; system prompts and private reasoning are excluded.",
                )}
              </p>
            </div>
            <Robot className="mt-0.5 size-5 shrink-0 text-[#56796d]" aria-hidden="true" />
          </div>

          <div className="min-h-[58vh] px-4 py-6 sm:px-7 lg:min-h-[calc(100vh-220px)]">
            <div className="mx-auto max-w-3xl space-y-6" aria-live="polite">
              <AnimatePresence initial={false}>
                {feed.messages.map((message) => (
                  <motion.article
                    key={message.message_id}
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={
                      message.role === "user" ? "ml-auto max-w-[88%]" : "mr-auto max-w-[94%]"
                    }
                  >
                    <p
                      className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${message.role === "user" ? "text-right text-[#55756a]" : "text-[#718079]"}`}
                    >
                      {message.role === "user" ? copy(locale, "你", "You") : "Agent"}
                    </p>
                    <div
                      className={
                        message.role === "user"
                          ? "border-r-2 border-[#5f8879] bg-[#edf3ef] px-4 py-3"
                          : "border-l-2 border-[#cad5cf] px-4 py-1"
                      }
                    >
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[#2d3934]">
                        {message.content}
                      </p>
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>

              {open && feed.run.status !== "WAITING_CLARIFICATION" ? (
                <div className="mr-auto flex max-w-[94%] items-center gap-3 border-l-2 border-[#cad5cf] px-4 py-2 text-xs text-[#64716b]">
                  <Pulse className="size-4 animate-pulse text-[#4e806f]" aria-hidden="true" />
                  <span>{status?.detail}</span>
                </div>
              ) : null}

              {feed.run.clarification && !feed.run.clarification.answered ? (
                <div className="border-l-2 border-[#4f8196] bg-[#eef5f7] px-4 py-4">
                  <p className="text-xs font-semibold text-[#315f73]">
                    {copy(locale, "Agent 需要确认业务口径", "Agent needs clarification")}
                  </p>
                  <p className="mt-2 text-[13px] leading-6 text-[#395d6a]">
                    {feed.run.clarification.question}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {feed.run.clarification.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={resuming}
                        onClick={() => void answerClarification(option)}
                        className="border border-[#8fb0bc] bg-white px-3 py-2 text-[11px] font-medium text-[#315f73] transition-colors hover:bg-[#dcecf1] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside
          className="min-w-0 lg:sticky lg:top-5 lg:self-start"
          aria-label={copy(locale, "执行过程与工具调用", "Execution process and tool calls")}
        >
          <div className="border border-[#d8dfda] bg-white">
            <div className="border-b border-[#d8dfda] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">
                    {copy(locale, "执行过程", "Execution process")}
                  </p>
                  <p className="mt-1 text-[10px] text-[#75817b]">
                    {feed.events.length} 个公开事件 · {feed.run.used_tool_calls}/
                    {feed.run.max_tool_calls} {copy(locale, "次工具调用", "tool calls")}
                  </p>
                </div>
                <Pulse
                  className={`size-5 ${open ? "animate-pulse text-[#4f806f]" : "text-[#8b9691]"}`}
                  aria-hidden="true"
                />
              </div>
            </div>

            <ol className="max-h-[calc(100vh-260px)] min-h-64 overflow-y-auto px-4 py-4">
              {feed.events.length === 0 && feed.pending_tools.length === 0 ? (
                <li className="border-l border-[#d3dbd6] py-2 pl-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[#5e6b65]">
                    <ClockCountdown className="size-4 text-[#70877e]" aria-hidden="true" />
                    {status?.label}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-[#7b8781]">{status?.detail}</p>
                </li>
              ) : null}

              {processEvents.map((event) => {
                const presentation = eventPresentation(event, locale);
                const Icon = presentation.Icon;
                const disclosure =
                  event.type === "tool" ||
                  (event.type === "stage" && event.payload.phase.startsWith("semantic-turn-"));
                return (
                  <li
                    key={event.event_id}
                    className="relative border-l border-[#d3dbd6] pb-5 pl-5 last:pb-1"
                  >
                    <span
                      className={`absolute -left-3 top-0 grid size-6 place-items-center ${presentation.surface} ${presentation.tone}`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    {disclosure ? (
                      <details>
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[#356b5a]">
                          <span className={`text-[11px] font-semibold ${presentation.tone}`}>
                            {presentation.label}
                            {` · ${event.payload.status}`}
                          </span>
                          <span className="font-mono text-[9px] text-[#99a29e]">
                            #{event.sequence}
                          </span>
                        </summary>
                        <div className="mt-2 border-l border-[#d3dbd6] pl-3">
                          <p className="text-[11px] leading-5 text-[#5f6c66]">
                            {publicEventSummary(event)}
                          </p>
                          {event.type === "tool" ? (
                            <p className="mt-1 break-all font-mono text-[9px] text-[#99a29e]">
                              {event.payload.call_id}
                              {event.payload.error_code ? ` · ${event.payload.error_code}` : ""}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <p className={`text-[11px] font-semibold ${presentation.tone}`}>
                            {presentation.label}
                          </p>
                          <span className="font-mono text-[9px] text-[#99a29e]">
                            #{event.sequence}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-[#5f6c66]">
                          {publicEventSummary(event)}
                        </p>
                      </>
                    )}
                    <p className="mt-1 font-mono text-[9px] text-[#99a29e]">
                      {new Intl.DateTimeFormat(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(event.occurred_at))}
                    </p>
                  </li>
                );
              })}

              {feed.pending_tools.map((tool) => (
                <li
                  key={tool.call_id}
                  className="relative border-l border-[#d3dbd6] pb-5 pl-5 last:pb-1"
                >
                  <span className="absolute -left-3 top-0 grid size-6 place-items-center bg-[#e9f1ed] text-[#426e60]">
                    <Wrench className="size-3.5 animate-pulse" aria-hidden="true" />
                  </span>
                  <p className="text-[11px] font-semibold text-[#426e60]">
                    {locale === "zh-CN"
                      ? (TOOL_LABELS[tool.tool_name] ?? tool.tool_name)
                      : tool.tool_name}
                  </p>
                  <p className="mt-1 text-[11px] text-[#65716c]">
                    {copy(locale, "工具正在执行", "Tool running")}
                  </p>
                  <p className="mt-1 truncate font-mono text-[9px] text-[#99a29e]">
                    {tool.call_id}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-3 border-l-2 border-[#9cb2a9] px-3 py-2 text-[10px] leading-4 text-[#718079]">
            <p>Candidate revision · {feed.run.working_revision}</p>
            <p>
              {copy(
                locale,
                "所有变更仍需审核发布，不会直接覆盖活动语义。",
                "All changes require review and publish; active semantics are not overwritten.",
              )}
            </p>
          </div>
          {streamNotice || fatalError ? (
            <p className="mt-3 border-l-2 border-[#c0852d] bg-[#fbf3e4] px-3 py-2 text-[10px] leading-4 text-[#81591c]">
              {fatalError ?? streamNotice}
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
