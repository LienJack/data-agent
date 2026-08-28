"use client";

import {
  type AgentProductProfileRegistryItem,
  type AgentTeamPublicTrace,
  agentProductProfileListResultSchema,
  type ConversationTrajectory,
  contractErrorSchema,
  conversationTrajectorySchema,
  type PublicRunEvent,
  publicRunEventSchema,
  type ResolutionTrace,
  type ResolutionTraceDetail,
  type SqlHistoryResult,
  verifyAgentProductProfileRevision,
  verifyAgentTeamPublicTrace,
  verifyResolutionTrace,
  verifyResolutionTraceDetail,
  verifySqlHistoryResult,
} from "@data-agent/contracts";
import type { RunProjection } from "./run-projection";
import { workspaceIdFromPathname } from "./workspace-routes";

// ─── Connection State ──────────────────────────────────────────────────────

/** SSE 连接状态 — 符合 implement.md §U8.10 要求 */
export type RunConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "closed";

// ─── Run Event Types ───────────────────────────────────────────────────────

export type RunEvent = PublicRunEvent;

// ─── Configuration ─────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "";

export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";

  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly retryable: boolean | null,
    message: string,
  ) {
    super(message);
  }
}

function resolutionTraceDecodeError(error: unknown, fallbackCode: string): ApiRequestError {
  const observed =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  const code = observed.startsWith("RESOLUTION_TRACE_") ? observed : fallbackCode;
  return new ApiRequestError(200, code, false, `权威轨迹响应未通过契约校验 (${code})`);
}

// ─── Workspace Context ─────────────────────────────────────────────────────

/** 仅从当前 /w/:workspaceId 规范路由解析工作空间 ID。 */
export function resolveWorkspaceId(): string {
  return typeof window === "undefined" ? "" : workspaceIdFromPathname(window.location.pathname);
}

// ─── Auth Headers ──────────────────────────────────────────────────────────

function authHeaders(workspaceId?: string): HeadersInit {
  const resolved = workspaceId?.trim() || resolveWorkspaceId();
  return {
    "Content-Type": "application/json",
    ...(resolved ? { "x-workspace-id": resolved } : {}),
  };
}

export function workspaceRequestHeaders(workspaceId?: string): HeadersInit {
  return authHeaders(workspaceId);
}

// ─── URL Composition ───────────────────────────────────────────────────────

function composeUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return normalized;
  return `${API_BASE.replace(/\/+$/, "")}${normalized}`;
}

// ─── Generic Request ───────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> {
  const response = await fetch(composeUrl(path), {
    ...init,
    headers: { ...authHeaders(workspaceId), ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const parsed = contractErrorSchema.safeParse(body?.error);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.code,
        parsed.data.retryable,
        `${parsed.data.message} (${parsed.data.code})`,
      );
    }
    throw new ApiRequestError(response.status, null, null, `API 请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

// ─── Run API ───────────────────────────────────────────────────────────────

/** 创建新的分析 Run */
export async function createRun(
  question: string,
  workspaceId?: string,
  datasourceId?: string,
  datasourceRevision?: number,
  conversationId?: string,
): Promise<RunProjection> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (
    !resolvedWorkspace ||
    !datasourceId ||
    !Number.isSafeInteger(datasourceRevision) ||
    (datasourceRevision ?? 0) < 1 ||
    !conversationId
  ) {
    throw new Error("Run 必须显式绑定工作空间、带版本的数据源和对话");
  }
  const idempotencyKey = crypto.randomUUID();
  return request<RunProjection>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/runs`,
    {
      method: "POST",
      headers: { "x-idempotency-key": idempotencyKey },
      body: JSON.stringify({
        question,
        idempotencyKey,
        datasourceId,
        datasourceRevision,
        conversationId,
      }),
    },
    resolvedWorkspace,
  );
}

/** 从服务端权威 Conversation 绑定原子创建问答 Run 和用户消息。 */
export async function createQaRun(
  question: string,
  conversationId: string,
  workspaceId?: string,
  files: readonly Readonly<{ file_id: string; revision: number; revision_hash: string }>[] = [],
  gateClaim?:
    | Readonly<{
        idempotency_key: string;
        acceptance_fence:
          | Readonly<{
              authority_kind: "QUALIFICATION";
              authority_epoch: string;
              qualification_id: string;
              attempt_id: string;
              run_id: string;
              claim_fence_token: string;
            }>
          | Readonly<{
              authority_kind: "FINAL_CAMPAIGN";
              authority_epoch: string;
              campaign_id: string;
              attempt_id: string;
              run_id: string;
              claim_fence_token: string;
            }>;
      }>
    | Readonly<{
        idempotency_key: string;
        diagnostic_attempt_id: string;
        run_id: string;
      }>,
): Promise<RunProjection> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace || !conversationId) {
    throw new Error("Run 必须绑定工作空间和对话");
  }
  return request<RunProjection>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/qa/conversations/${encodeURIComponent(conversationId)}/runs`,
    {
      method: "POST",
      body: JSON.stringify({
        schema_version: "qa-run-start@1.0.0",
        question,
        idempotency_key: gateClaim?.idempotency_key ?? crypto.randomUUID(),
        files,
        ...(gateClaim && "acceptance_fence" in gateClaim
          ? { acceptance_fence: gateClaim.acceptance_fence }
          : {}),
      }),
    },
    resolvedWorkspace,
  );
}

/** 获取 Run 的当前投影 */
export async function getRun(runId: string, workspaceId?: string): Promise<RunProjection> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  return request<RunProjection>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/runs/${encodeURIComponent(runId)}`,
    {},
    resolvedWorkspace,
  );
}

/** 向 Run 发送命令（start/pause/resume/cancel/replay） */
export async function commandRun(
  runId: string,
  command: "resume" | "cancel",
  workspaceId?: string,
): Promise<void> {
  await request(
    `/api/workspaces/${encodeURIComponent(workspaceId?.trim() || resolveWorkspaceId())}/runs/${encodeURIComponent(runId)}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        type: command,
      }),
    },
    workspaceId,
  );
}

// ─── SSE Streaming ─────────────────────────────────────────────────────────

/** 从 cursor 位置开始 SSE 事件流 */
export async function streamRunEvents(input: {
  runId: string;
  workspaceId: string;
  cursor: number;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
}): Promise<void> {
  const response = await fetch(
    composeUrl(
      `/api/workspaces/${encodeURIComponent(input.workspaceId)}/runs/${encodeURIComponent(input.runId)}/events/stream?cursor=${input.cursor}`,
    ),
    {
      headers: {
        ...authHeaders(input.workspaceId),
        Accept: "text/event-stream",
        ...(input.cursor > 0 ? { "Last-Event-ID": String(input.cursor) } : {}),
      },
      signal: input.signal,
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`事件流不可用 (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEventBlock(block);
      if (event) {
        input.onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/** 解析 SSE 事件块中的 JSON 数据 */
export function parseEventBlock(block: string): RunEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  return publicRunEventSchema.parse(JSON.parse(data));
}

// ─── Event Merging ─────────────────────────────────────────────────────────

/** 合并新旧事件列表，按 sequence 去重排序 */
export function mergeRunEvents(current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const merged = new Map(current.map((event) => [`${event.run_id}:${event.sequence}`, event]));
  for (const event of incoming) {
    const key = `${event.run_id}:${event.sequence}`;
    if (!merged.has(key)) {
      merged.set(key, event);
    }
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
    return a.sequence - b.sequence;
  });
}

/** 读取整个对话的持久化轨迹。 */
export async function fetchConversationTrajectory(
  conversationId: string,
  workspaceId?: string,
): Promise<ConversationTrajectory> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  const response = await request<{ data: unknown }>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/qa/conversations/${encodeURIComponent(conversationId)}/trajectory`,
    {},
    resolvedWorkspace,
  );
  return conversationTrajectorySchema.parse(response.data);
}

export async function fetchResolutionTrace(
  runId: string,
  workspaceId?: string,
): Promise<ResolutionTrace> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  const response = await request<{ data: unknown }>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/runs/${encodeURIComponent(runId)}/resolution-trace`,
    {},
    resolvedWorkspace,
  );
  try {
    return await verifyResolutionTrace(response.data);
  } catch (error) {
    throw resolutionTraceDecodeError(error, "RESOLUTION_TRACE_SCHEMA_INVALID");
  }
}

export async function fetchResolutionTraceDetail(
  runId: string,
  nodeId: string,
  expectedTraceHash: string,
  workspaceId?: string,
  signal?: AbortSignal,
): Promise<ResolutionTraceDetail> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  const parameters = new URLSearchParams({
    node_id: nodeId,
    expected_trace_hash: expectedTraceHash,
  });
  const response = await request<{ data: unknown }>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/runs/${encodeURIComponent(runId)}/resolution-trace/details?${parameters.toString()}`,
    { signal },
    resolvedWorkspace,
  );
  try {
    const detail = await verifyResolutionTraceDetail(response.data);
    if (detail.trace_hash !== expectedTraceHash) {
      throw new TypeError("RESOLUTION_TRACE_SNAPSHOT_STALE");
    }
    return detail;
  } catch (error) {
    throw resolutionTraceDecodeError(error, "RESOLUTION_TRACE_DETAIL_SCHEMA_INVALID");
  }
}

export async function fetchSqlHistory(
  filters: {
    readonly runId?: string;
    readonly conversationId?: string;
    readonly occurredAfter?: string;
    readonly occurredBefore?: string;
    readonly limit?: number;
  },
  workspaceId?: string,
): Promise<SqlHistoryResult> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  const parameters = new URLSearchParams();
  if (filters.runId) parameters.set("run_id", filters.runId);
  if (filters.conversationId) parameters.set("conversation_id", filters.conversationId);
  if (filters.occurredAfter) parameters.set("occurred_after", filters.occurredAfter);
  if (filters.occurredBefore) parameters.set("occurred_before", filters.occurredBefore);
  parameters.set("limit", String(filters.limit ?? 100));
  const response = await request<{ data: unknown }>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/sql-history?${parameters.toString()}`,
    {},
    resolvedWorkspace,
  );
  return verifySqlHistoryResult(response.data);
}

export async function fetchAgentProfiles(
  workspaceId?: string,
): Promise<readonly AgentProductProfileRegistryItem[]> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  const response = await request<{ data: unknown }>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/agent-profiles`,
    {},
    resolvedWorkspace,
  );
  const result = agentProductProfileListResultSchema.parse(response.data);
  await Promise.all(
    result.items.map(({ revision }) => verifyAgentProductProfileRevision(revision)),
  );
  return result.items;
}

export async function fetchAgentTeamTrace(
  runId: string,
  workspaceId?: string,
): Promise<AgentTeamPublicTrace | null> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace) throw new Error("请先选择工作空间");
  const response = await request<{ data: unknown }>(
    `/api/workspaces/${encodeURIComponent(resolvedWorkspace)}/runs/${encodeURIComponent(runId)}/team-trace`,
    {},
    resolvedWorkspace,
  );
  return response.data === null ? null : verifyAgentTeamPublicTrace(response.data);
}

// ─── Exponential Backoff ───────────────────────────────────────────────────

/** 指数退避等待（最多 30 秒） */
export async function waitWithBackoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
  await new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timeout = setTimeout(done, delay);
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
