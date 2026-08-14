"use client";

import {
  type ConversationTrajectory,
  conversationTrajectorySchema,
  type PublicRunEvent,
  publicRunEventSchema,
} from "@data-agent/contracts";
import type { RunProjection } from "./run-projection";

// ─── Connection State ──────────────────────────────────────────────────────

/** SSE 连接状态 — 符合 implement.md §U8.10 要求 */
export type RunConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "closed";

// ─── Run Event Types ───────────────────────────────────────────────────────

export type RunEvent = PublicRunEvent;

// ─── Configuration ─────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "";

// ─── Workspace Context ─────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 从 /w/:workspaceId 路由或会话选择解析工作空间 ID。 */
export function resolveWorkspaceId(): string {
  if (typeof window !== "undefined") {
    const routed = window.location.pathname.match(
      /^\/w\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i,
    )?.[1];
    if (routed) {
      window.sessionStorage.setItem("data-agent.activeWorkspaceId", routed);
      return routed;
    }
    const stored = window.sessionStorage.getItem("data-agent.activeWorkspaceId")?.trim();
    if (stored && UUID_PATTERN.test(stored)) return stored;
  }
  return "";
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
    throw new Error(`API 请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

// ─── Run API ───────────────────────────────────────────────────────────────

/** 创建新的分析 Run */
export async function createRun(
  question: string,
  workspaceId?: string,
  datasourceId?: string,
  conversationId?: string,
): Promise<RunProjection> {
  const resolvedWorkspace = workspaceId?.trim() || resolveWorkspaceId();
  if (!resolvedWorkspace || !datasourceId || !conversationId) {
    throw new Error("Run 必须显式绑定工作空间、数据源和对话");
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
        conversationId,
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
  command: "start" | "pause" | "resume" | "cancel" | "replay",
  expectedVersion: number,
  workspaceId?: string,
): Promise<void> {
  await request(
    `/api/workspaces/${encodeURIComponent(workspaceId?.trim() || resolveWorkspaceId())}/runs/${encodeURIComponent(runId)}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        type: command,
        expectedRunVersion: expectedVersion,
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
