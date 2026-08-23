"use client";

import type {
  ArtifactPreviewResult,
  ArtifactReference,
  PublicRunEvent,
  QaAdminAuditReceiptRef,
  QaAdminConversationPage,
  QaAdminDirectoryPage,
  QaAdminRunEventsPage,
  WorkspaceConversationMessage,
  WorkspaceConversationV2,
} from "@data-agent/contracts";
import {
  Archive,
  CaretRight,
  Folder,
  MagnifyingGlass,
  Robot,
  ShieldCheck,
  Table,
  Trash,
  UserCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspaceRequestHeaders } from "@/lib/api-client";
import { mergeAdminRunEventsPage, parseAdminReplayPage } from "@/lib/qa-admin-event-stream";
import { ArtifactWorkspace } from "../workbench/artifact-workspace";
import { SafeAssistantMarkdown } from "./safe-assistant-markdown";

interface WorkspaceOption {
  readonly workspace_id: string;
  readonly name: string;
}

interface AdminConversationAuditProps {
  readonly initialWorkspaceId: string;
  readonly workspaces?: readonly WorkspaceOption[];
  readonly globalMode?: boolean;
}

type InspectorState =
  | { readonly kind: "empty" }
  | { readonly kind: "event"; readonly event: PublicRunEvent }
  | { readonly kind: "artifact-loading"; readonly reference: ArtifactReference }
  | {
      readonly kind: "artifact";
      readonly reference: ArtifactReference;
      readonly preview: ArtifactPreviewResult | null;
      readonly receipt: QaAdminAuditReceiptRef;
    }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function readApi<T>(input: string, workspaceId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { ...workspaceRequestHeaders(workspaceId), ...init?.headers },
  });
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.data) {
    throw Object.assign(new Error(body?.error?.message ?? "管理员审计读取失败。"), {
      code: body?.error?.code ?? "QA_ADMIN_READ_FAILED",
    });
  }
  return body.data;
}

function errorState(error: unknown): InspectorState {
  return {
    kind: "error",
    code:
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "QA_ADMIN_READ_FAILED",
    message: error instanceof Error ? error.message : "管理员审计读取失败。",
  };
}

function lifecycleIcon(lifecycle: WorkspaceConversationV2["lifecycle"]) {
  if (lifecycle === "TRASH") return <Trash aria-hidden="true" size={14} />;
  if (lifecycle === "ARCHIVED") return <Archive aria-hidden="true" size={14} />;
  return <CaretRight aria-hidden="true" size={14} />;
}

function receiptLabel(receipt: QaAdminAuditReceiptRef | null) {
  return receipt ? `${receipt.operation} · ${receipt.receipt_id.slice(0, 8)}` : "尚未读取";
}

export function AdminConversationAudit({
  initialWorkspaceId,
  workspaces = [],
  globalMode = false,
}: AdminConversationAuditProps) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<"" | WorkspaceConversationV2["lifecycle"]>("");
  const [liveState, setLiveState] = useState<"" | WorkspaceConversationV2["live_state"]>("");
  const [owner, setOwner] = useState("");
  const [folderId, setFolderId] = useState("");
  const [directory, setDirectory] = useState<QaAdminDirectoryPage | null>(null);
  const [detail, setDetail] = useState<QaAdminConversationPage | null>(null);
  const [trajectory, setTrajectory] = useState<QaAdminRunEventsPage | null>(null);
  const [inspector, setInspector] = useState<InspectorState>({ kind: "empty" });
  const [loading, setLoading] = useState(false);
  const [streamState, setStreamState] = useState<"idle" | "live" | "reconnecting" | "stopped">(
    "idle",
  );
  const streamGeneration = useRef(0);
  const trajectoryRef = useRef<QaAdminRunEventsPage | null>(null);

  const loadDirectory = useCallback(
    async (cursor: string | null = null) => {
      setLoading(true);
      try {
        const search = new URLSearchParams({ limit: "50" });
        if (query.trim()) search.set("query", query.trim());
        if (lifecycle) search.set("lifecycle", lifecycle);
        if (liveState) search.set("liveState", liveState);
        if (owner.trim()) search.set("ownerPrincipalId", owner.trim());
        if (folderId) search.set("folderId", folderId);
        if (cursor) search.set("cursor", cursor);
        const page = await readApi<QaAdminDirectoryPage>(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/admin/directory?${search}`,
          workspaceId,
        );
        setDirectory((current) => {
          if (!cursor || !current) return page;
          const folders = new Map(current.folders.map((folder) => [folder.folder_id, folder]));
          for (const folder of page.folders) folders.set(folder.folder_id, folder);
          const conversations = new Map(
            current.conversations.map((conversation) => [
              conversation.conversation_id,
              conversation,
            ]),
          );
          for (const conversation of page.conversations)
            conversations.set(conversation.conversation_id, conversation);
          return {
            ...page,
            folders: [...folders.values()],
            conversations: [...conversations.values()],
          };
        });
        if (!cursor) {
          setDetail(null);
          setTrajectory(null);
          trajectoryRef.current = null;
          setInspector({ kind: "empty" });
        }
      } catch (error) {
        setDirectory(null);
        setInspector(errorState(error));
      } finally {
        setLoading(false);
      }
    },
    [folderId, lifecycle, liveState, owner, query, workspaceId],
  );

  useEffect(() => {
    void loadDirectory(null);
  }, [loadDirectory]);

  useEffect(() => {
    const generation = ++streamGeneration.current;
    const runId =
      [...(detail?.messages ?? [])].reverse().find((message) => message.run_id)?.run_id ??
      trajectoryRef.current?.events.at(-1)?.run_id;
    if (detail?.conversation.live_state !== "RUNNING" || !runId) {
      setStreamState("idle");
      return;
    }

    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cursor =
      trajectoryRef.current?.events
        .filter((event) => event.run_id === runId)
        .reduce((maximum, event) => Math.max(maximum, event.sequence), 0) ?? 0;

    const connect = async () => {
      if (generation !== streamGeneration.current) return;
      controller = new AbortController();
      const search = new URLSearchParams({
        operation: "RUN_REPLAY",
        ownerPrincipalId: detail.owner_principal_id,
        runId,
        afterSequence: String(cursor),
        limit: "500",
        transport: "sse",
      });
      try {
        setStreamState("live");
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/admin/conversations/${encodeURIComponent(detail.conversation.conversation_id)}/events?${search}`,
          {
            headers: {
              ...workspaceRequestHeaders(workspaceId),
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          },
        );
        if (generation !== streamGeneration.current) return;
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setStreamState("stopped");
          return;
        }
        if (!response.ok) throw new Error(`QA_ADMIN_SSE_${response.status}`);
        const replay = parseAdminReplayPage(await response.text());
        if (generation !== streamGeneration.current || !replay) return;
        cursor = replay.events.reduce(
          (maximum, event) => Math.max(maximum, event.sequence),
          cursor,
        );
        setTrajectory((current) => {
          const merged = mergeAdminRunEventsPage(current, replay);
          trajectoryRef.current = merged;
          return merged;
        });
        setStreamState("reconnecting");
        reconnectTimer = setTimeout(() => void connect(), 2_000);
      } catch {
        if (controller?.signal.aborted || generation !== streamGeneration.current) return;
        setStreamState("reconnecting");
        reconnectTimer = setTimeout(() => void connect(), 2_000);
      }
    };

    void connect();
    return () => {
      streamGeneration.current += 1;
      controller?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [detail, workspaceId]);

  async function selectConversation(conversation: WorkspaceConversationV2) {
    setLoading(true);
    setInspector({ kind: "empty" });
    try {
      const ownerQuery = new URLSearchParams({
        ownerPrincipalId: conversation.owner_principal_id,
        limit: "200",
      });
      const eventQuery = new URLSearchParams({
        ownerPrincipalId: conversation.owner_principal_id,
        operation: "TRAJECTORY_READ",
        afterSequence: "0",
        limit: "500",
      });
      const [conversationPage, eventPage] = await Promise.all([
        readApi<QaAdminConversationPage>(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/admin/conversations/${encodeURIComponent(conversation.conversation_id)}?${ownerQuery}`,
          workspaceId,
        ),
        readApi<QaAdminRunEventsPage>(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/admin/conversations/${encodeURIComponent(conversation.conversation_id)}/events?${eventQuery}`,
          workspaceId,
        ),
      ]);
      setDetail(conversationPage);
      setTrajectory(eventPage);
      trajectoryRef.current = eventPage;
    } catch (error) {
      setDetail(null);
      setTrajectory(null);
      trajectoryRef.current = null;
      setInspector(errorState(error));
    } finally {
      setLoading(false);
    }
  }

  async function inspectArtifact(
    ownerPrincipalId: string,
    conversationId: string,
    reference: ArtifactReference,
  ) {
    setInspector({ kind: "artifact-loading", reference });
    try {
      const result = await readApi<{
        preview: ArtifactPreviewResult | null;
        receipt: QaAdminAuditReceiptRef;
      }>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/admin/conversations/${encodeURIComponent(conversationId)}/artifacts`,
        workspaceId,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema_version: "qa-admin-artifact-access-query@1.0.0",
            operation: "ARTIFACT_PREVIEW",
            owner_principal_id: ownerPrincipalId,
            run_id: reference.run_id,
            reference,
          }),
        },
      );
      setInspector({
        kind: "artifact",
        reference,
        preview: result.preview,
        receipt: result.receipt,
      });
    } catch (error) {
      setInspector(errorState(error));
    }
  }

  async function loadMoreMessages() {
    if (!detail?.next_cursor) return;
    setLoading(true);
    try {
      const search = new URLSearchParams({
        ownerPrincipalId: detail.owner_principal_id,
        cursor: detail.next_cursor,
        limit: "200",
      });
      const page = await readApi<QaAdminConversationPage>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/admin/conversations/${encodeURIComponent(detail.conversation.conversation_id)}?${search}`,
        workspaceId,
      );
      setDetail((current) => {
        if (!current || current.conversation.conversation_id !== page.conversation.conversation_id)
          return current;
        const messages = new Map(current.messages.map((message) => [message.message_id, message]));
        for (const message of page.messages) messages.set(message.message_id, message);
        return { ...page, messages: [...messages.values()] };
      });
    } catch (error) {
      setInspector(errorState(error));
    } finally {
      setLoading(false);
    }
  }

  const owners = useMemo(
    () => [...new Set(directory?.conversations.map((item) => item.owner_principal_id) ?? [])],
    [directory],
  );
  const eventMessageByRun = useMemo(() => {
    const selected = new Map<string, string>();
    for (const message of detail?.messages ?? []) {
      if (message.role === "agent" && message.run_id)
        selected.set(message.run_id, message.message_id);
    }
    return selected;
  }, [detail]);
  const inspectorOpen = inspector.kind !== "empty";

  return (
    <main className="flex h-full min-h-0 flex-col bg-[var(--color-bg-primary)]">
      <header className="border-b border-[var(--color-border-default)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              <ShieldCheck aria-hidden="true" size={15} />
              Read-only audit plane
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-[-0.025em]">对话审计</h1>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              跨用户读取会写入不可变审计回执；此页面没有发送、重命名、归档、删除或运行控制能力。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/w/${workspaceId}/qa`}
              className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
            >
              返回我的对话
            </Link>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              管理员只读 · 所有访问可追溯
            </div>
          </div>
        </div>
        {globalMode && workspaces.length > 0 ? (
          <label className="mt-3 block max-w-sm text-[10px] font-semibold text-[var(--color-text-muted)]">
            工作空间
            <select
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside
          className={`${detail ? "hidden lg:block" : "block"} min-h-0 overflow-y-auto border-r border-[var(--color-border-default)] p-3`}
        >
          <div className="grid gap-2">
            <label className="relative">
              <MagnifyingGlass
                className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]"
                size={14}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题或消息"
                className="w-full rounded-lg border border-[var(--color-border-default)] bg-white py-2 pl-8 pr-3 text-xs"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="生命周期"
                value={lifecycle}
                onChange={(event) =>
                  setLifecycle(event.target.value as "" | WorkspaceConversationV2["lifecycle"])
                }
                className="rounded-lg border border-[var(--color-border-default)] bg-white px-2 py-2 text-[11px]"
              >
                <option value="">全部状态</option>
                <option value="ACTIVE">活跃</option>
                <option value="ARCHIVED">已归档</option>
                <option value="TRASH">回收站</option>
              </select>
              <select
                aria-label="所有者"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                className="rounded-lg border border-[var(--color-border-default)] bg-white px-2 py-2 text-[11px]"
              >
                <option value="">全部用户</option>
                {owners.map((principalId) => (
                  <option key={principalId} value={principalId}>
                    {principalId.slice(0, 8)}
                  </option>
                ))}
              </select>
              <select
                aria-label="运行状态"
                value={liveState}
                onChange={(event) =>
                  setLiveState(event.target.value as "" | WorkspaceConversationV2["live_state"])
                }
                className="rounded-lg border border-[var(--color-border-default)] bg-white px-2 py-2 text-[11px]"
              >
                <option value="">全部运行状态</option>
                <option value="IDLE">空闲</option>
                <option value="RUNNING">运行中</option>
                <option value="WAITING_APPROVAL">等待审批</option>
                <option value="WAITING_ANSWER">等待回答</option>
                <option value="FAILED">失败</option>
                <option value="COMPLETED">完成</option>
              </select>
              <select
                aria-label="文件夹"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                className="rounded-lg border border-[var(--color-border-default)] bg-white px-2 py-2 text-[11px]"
              >
                <option value="">全部文件夹</option>
                {directory?.folders.map((folder) => (
                  <option key={folder.folder_id} value={folder.folder_id}>
                    {folder.name} · {folder.owner_principal_id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void loadDirectory(null)}
              className="rounded-lg bg-[var(--color-text-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "读取中…" : "应用筛选"}
            </button>
          </div>

          <div className="mt-4 space-y-1">
            {directory?.folders.map((folder) => (
              <div
                key={folder.folder_id}
                className="flex items-center gap-2 px-2 py-1 text-[10px] text-[var(--color-text-muted)]"
              >
                <Folder aria-hidden="true" size={13} />
                <span className="truncate">{folder.name}</span>
                <span className="ml-auto font-mono">{folder.owner_principal_id.slice(0, 6)}</span>
              </div>
            ))}
            {directory?.conversations.map((conversation) => (
              <button
                key={conversation.conversation_id}
                type="button"
                onClick={() => void selectConversation(conversation)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-[var(--color-accent)] ${
                  detail?.conversation.conversation_id === conversation.conversation_id
                    ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_6%,white)]"
                    : "border-transparent hover:bg-[var(--color-bg-overlay)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  {lifecycleIcon(conversation.lifecycle)}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {conversation.title}
                  </span>
                  <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                    {conversation.message_count}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-[var(--color-text-muted)]">
                  <UserCircle aria-hidden="true" size={11} />
                  {conversation.owner_principal_id.slice(0, 12)} · {conversation.live_state}
                </div>
              </button>
            ))}
            {!loading && directory?.conversations.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-[var(--color-text-muted)]">
                没有匹配的对话
              </p>
            ) : null}
            {directory?.next_cursor ? (
              <button
                type="button"
                onClick={() => void loadDirectory(directory.next_cursor)}
                className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-[11px] font-medium text-[var(--color-text-secondary)]"
                disabled={loading}
              >
                加载更多
              </button>
            ) : null}
          </div>
          <p className="mt-4 break-all border-t border-[var(--color-border-default)] pt-3 font-mono text-[9px] text-[var(--color-text-muted)]">
            Directory receipt: {receiptLabel(directory?.receipt ?? null)}
          </p>
        </aside>

        <section
          className={`${detail && !inspectorOpen ? "block" : "hidden lg:block"} min-h-0 overflow-y-auto px-5 py-5`}
        >
          {detail ? (
            <>
              <div className="mb-5 border-b border-[var(--color-border-default)] pb-4">
                <button
                  type="button"
                  onClick={() => {
                    setDetail(null);
                    setTrajectory(null);
                    trajectoryRef.current = null;
                    setInspector({ kind: "empty" });
                  }}
                  className="mb-3 text-[11px] font-medium text-[var(--color-accent)] lg:hidden"
                >
                  ← 返回管理目录
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{detail.conversation.title}</h2>
                  {detail.conversation.live_state === "RUNNING" ? (
                    <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                      Admin SSE · {streamState}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                  owner {detail.owner_principal_id} · {detail.conversation.lifecycle} ·{" "}
                  {detail.conversation.live_state}
                </p>
              </div>
              <div className="space-y-6">
                {detail.messages.map((message) => (
                  <AdminMessage
                    key={message.message_id}
                    message={message}
                    events={
                      message.run_id && eventMessageByRun.get(message.run_id) === message.message_id
                        ? (trajectory?.events.filter((event) => event.run_id === message.run_id) ??
                          [])
                        : []
                    }
                    onInspectEvent={(event) => setInspector({ kind: "event", event })}
                    onInspectArtifact={(reference) =>
                      void inspectArtifact(
                        detail.owner_principal_id,
                        detail.conversation.conversation_id,
                        reference,
                      )
                    }
                  />
                ))}
              </div>
              {detail.next_cursor ? (
                <button
                  type="button"
                  onClick={() => void loadMoreMessages()}
                  className="mt-5 w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-[11px] font-medium text-[var(--color-text-secondary)]"
                  disabled={loading}
                >
                  加载更多消息
                </button>
              ) : null}
              <div className="mt-7 grid gap-1 border-t border-[var(--color-border-default)] pt-3 font-mono text-[9px] text-[var(--color-text-muted)]">
                <span>Messages receipt: {receiptLabel(detail.receipt)}</span>
                <span>Trajectory receipt: {receiptLabel(trajectory?.receipt ?? null)}</span>
              </div>
            </>
          ) : (
            <div className="flex min-h-72 items-center justify-center text-center text-sm text-[var(--color-text-muted)]">
              选择一条对话，读取消息与公开运行轨迹。
            </div>
          )}
        </section>

        <aside
          className={`${inspectorOpen ? "block" : "hidden lg:block"} min-h-0 overflow-y-auto border-l border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4`}
        >
          <button
            type="button"
            onClick={() => setInspector({ kind: "empty" })}
            className="mb-3 text-[11px] font-medium text-[var(--color-accent)] lg:hidden"
          >
            ← 返回对话
          </button>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
            Inspector
          </p>
          <AdminInspector state={inspector} />
        </aside>
      </div>
    </main>
  );
}

function AdminMessage({
  message,
  events,
  onInspectEvent,
  onInspectArtifact,
}: {
  readonly message: WorkspaceConversationMessage;
  readonly events: readonly PublicRunEvent[];
  readonly onInspectEvent: (event: PublicRunEvent) => void;
  readonly onInspectArtifact: (reference: ArtifactReference) => void;
}) {
  const isUser = message.role === "user";
  return (
    <article className={isUser ? "ml-auto max-w-[82%]" : "w-full"}>
      <div
        className={
          isUser ? "rounded-xl bg-[var(--color-text-primary)] px-4 py-3 text-white" : "agent-answer"
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <SafeAssistantMarkdown content={message.content} runId={message.run_id ?? undefined} />
        )}
      </div>
      {!isUser && events.length > 0 ? (
        <div className="mt-3 border-y border-[var(--color-border-default)]">
          {events.map((event) => (
            <AdminEventRow
              key={event.event_id}
              event={event}
              onInspect={() => onInspectEvent(event)}
              onInspectArtifact={onInspectArtifact}
            />
          ))}
        </div>
      ) : null}
      <p
        className={`mt-1 font-mono text-[9px] text-[var(--color-text-muted)] ${isUser ? "text-right" : ""}`}
      >
        {message.created_at}
      </p>
    </article>
  );
}

function AdminEventRow({
  event,
  onInspect,
  onInspectArtifact,
}: {
  readonly event: PublicRunEvent;
  readonly onInspect: () => void;
  readonly onInspectArtifact: (reference: ArtifactReference) => void;
}) {
  if (event.type === "answer") return null;
  const artifactRefs =
    event.schema_version === "public-run-event@2.0.0" && event.type === "tool"
      ? event.payload.artifact_refs
      : [];
  const label =
    event.type === "agent"
      ? `Subagent · ${event.payload.title}`
      : event.type === "tool"
        ? `Tool · ${event.payload.tool_name}`
        : event.type === "reasoning"
          ? "Think · 公共思考摘要"
          : `${event.type} · ${"summary" in event.payload ? event.payload.summary : event.type}`;
  return (
    <div className="border-b border-[var(--color-border-default)] last:border-b-0">
      <button
        type="button"
        onClick={onInspect}
        className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-[var(--color-bg-overlay)]"
      >
        {event.type === "agent" ? (
          <Robot aria-hidden="true" size={14} />
        ) : (
          <CaretRight aria-hidden="true" size={14} />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-secondary)]">
          {label}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
          #{event.sequence}
        </span>
      </button>
      {artifactRefs.map((reference) => (
        <button
          key={`${reference.artifact_id}:${reference.revision}`}
          type="button"
          onClick={() => onInspectArtifact(reference)}
          className="mb-1 ml-7 flex items-center gap-2 rounded px-2 py-1 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-bg-overlay)]"
        >
          <Table aria-hidden="true" size={13} />
          {reference.artifact_type} · rev {reference.revision}
        </button>
      ))}
    </div>
  );
}

function AdminInspector({ state }: { readonly state: InspectorState }) {
  if (state.kind === "empty") {
    return (
      <p className="mt-6 text-xs leading-5 text-[var(--color-text-muted)]">
        点击 Tool、Subagent 或 Artifact 查看公开详情。不会展示原始 chain-of-thought。
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mt-4 border-l-2 border-[var(--color-error)] bg-red-50 p-3 text-xs text-red-800">
        <p>{state.message}</p>
        <code className="mt-2 block text-[10px]">{state.code}</code>
      </div>
    );
  }
  if (state.kind === "artifact-loading") {
    return (
      <p className="mt-6 text-xs text-[var(--color-text-muted)]">
        正在读取并记录 Artifact 预览回执…
      </p>
    );
  }
  if (state.kind === "artifact") {
    return (
      <div className="mt-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{state.reference.artifact_type}</h2>
          <p className="mt-1 break-all font-mono text-[9px] text-[var(--color-text-muted)]">
            {state.reference.content_hash}
          </p>
        </div>
        {state.preview ? (
          <ArtifactWorkspace preview={state.preview} />
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">该操作只完成了只读授权。</p>
        )}
        <p className="break-all border-t border-[var(--color-border-default)] pt-2 font-mono text-[9px] text-[var(--color-text-muted)]">
          Preview receipt: {receiptLabel(state.receipt)}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold">公开运行事件 #{state.event.sequence}</h2>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border-default)] bg-white p-3 font-mono text-[10px] leading-5 text-[var(--color-text-secondary)]">
        {JSON.stringify(state.event, null, 2)}
      </pre>
    </div>
  );
}
