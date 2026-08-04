"use client";

import type { RunProjection } from "./run-projection";

// ─── Connection State ──────────────────────────────────────────────────────

/** SSE 连接状态 — 符合 implement.md §U8.10 要求 */
export type RunConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "closed";

// ─── Run Event Types ───────────────────────────────────────────────────────

export interface RunEvent {
  runId: string;
  sequence: number;
  type: "projection" | "hypothesis" | "report" | "eval" | "error" | "terminal";
  payload: unknown;
  timestamp: string;
}

// ─── Configuration ─────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "";

// ─── Workspace Context ─────────────────────────────────────────────────────

/** 从 sessionStorage / query param / env 解析工作空间 ID */
export function resolveWorkspaceId(): string {
  if (typeof window !== "undefined") {
    const stored = window.sessionStorage.getItem("data-agent.activeWorkspaceId")?.trim();
    if (stored) return stored;
    const queried = new URLSearchParams(window.location.search).get("workspaceId")?.trim();
    if (queried) return queried;
  }
  return process.env.NEXT_PUBLIC_WORKSPACE_ID?.trim() ?? "";
}

// ─── Auth Headers ──────────────────────────────────────────────────────────

function authHeaders(workspaceId?: string): HeadersInit {
  const resolved = workspaceId?.trim() || resolveWorkspaceId();
  return {
    "Content-Type": "application/json",
    "x-user-role": process.env.NEXT_PUBLIC_DEV_USER_ROLE?.trim() || "admin",
    "x-user-id": process.env.NEXT_PUBLIC_DEV_USER_ID?.trim() || "data-agent-ui",
    ...(resolved ? { "x-workspace-id": resolved } : {}),
  };
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
export async function createRun(question: string, workspaceId?: string): Promise<RunProjection> {
  const idempotencyKey = crypto.randomUUID();
  return request<RunProjection>(
    "/api/v1/runs",
    {
      method: "POST",
      headers: { "x-idempotency-key": idempotencyKey },
      body: JSON.stringify({ question, idempotencyKey }),
    },
    workspaceId,
  );
}

/** 获取 Run 的当前投影 */
export async function getRun(runId: string, workspaceId?: string): Promise<RunProjection> {
  return request<RunProjection>(`/api/v1/runs/${encodeURIComponent(runId)}`, {}, workspaceId);
}

/** 向 Run 发送命令（start/pause/resume/cancel/replay） */
export async function commandRun(
  runId: string,
  command: "start" | "pause" | "resume" | "cancel" | "replay",
  expectedVersion: number,
  workspaceId?: string,
): Promise<void> {
  await request(
    `/api/v1/runs/${encodeURIComponent(runId)}/commands`,
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
      `/api/v1/runs/${encodeURIComponent(input.runId)}/events/stream?cursor=${input.cursor}`,
    ),
    { headers: authHeaders(input.workspaceId), signal: input.signal },
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
function parseEventBlock(block: string): RunEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  return JSON.parse(data) as RunEvent;
}

// ─── Event Merging ─────────────────────────────────────────────────────────

/** 合并新旧事件列表，按 sequence 去重排序 */
export function mergeRunEvents(current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const merged = new Map(current.map((event) => [`${event.runId}:${event.sequence}`, event]));
  for (const event of incoming) {
    const key = `${event.runId}:${event.sequence}`;
    if (!merged.has(key)) {
      merged.set(key, event);
    }
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
    return a.sequence - b.sequence;
  });
}

// ─── Exponential Backoff ───────────────────────────────────────────────────

/** 指数退避等待（最多 30 秒） */
export async function waitWithBackoff(attempt: number): Promise<void> {
  const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
  await new Promise((resolve) => setTimeout(resolve, delay));
}
