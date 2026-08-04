/**
 * 语义治理 API 客户端。
 *
 * 对应 U11.2 Human Review Workspace 的 API 调用。
 * 通过 Next.js API Routes 与服务层通信。
 */

import type {
  ChangeClass,
  InboxGroup,
  InboxItem,
  ReviewDecision,
  RiskLevel,
  SemanticReviewPacket,
} from "./semantic-types";
import { type CurrentUser, MOCK_CURRENT_USER } from "./semantic-types";

// ─── API 基础路径 ──────────────────────────────────────────────────────────────

const API_BASE = "/api/semantic/governance";

// ─── 当前用户上下文 ────────────────────────────────────────────────────────────

/**
 * 当前用户身份。
 * M1 阶段使用模拟用户；后续替换为真实认证上下文。
 */
let currentUser: CurrentUser = MOCK_CURRENT_USER;

/** 设置当前用户（供认证系统集成） */
export function setCurrentUser(user: CurrentUser): void {
  currentUser = user;
}

/** 获取当前用户 */
export function getCurrentUser(): CurrentUser {
  return currentUser;
}

// ─── 通用请求封装 ──────────────────────────────────────────────────────────────

class SemanticApiError extends Error {
  override readonly name = "SemanticApiError";
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorBody: { error?: { code?: string; message?: string } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // 解析失败时使用默认错误信息
    }
    throw new SemanticApiError(
      errorBody.error?.code ?? "UNKNOWN_ERROR",
      errorBody.error?.message ?? `请求失败 (${response.status})`,
      response.status,
    );
  }
  const json = (await response.json()) as { data: T };
  return json.data;
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

/** 获取收件箱条目 */
export async function fetchInboxItems(group: InboxGroup): Promise<InboxItem[]> {
  const params = new URLSearchParams({ group });
  const response = await fetch(`${API_BASE}/inbox?${params}`);
  return handleResponse<InboxItem[]>(response);
}

/** 获取审核包详情 */
export async function fetchPacketDetail(packetId: string): Promise<SemanticReviewPacket | null> {
  const response = await fetch(`${API_BASE}/packets/${encodeURIComponent(packetId)}`);
  try {
    return await handleResponse<SemanticReviewPacket>(response);
  } catch (err) {
    if (err instanceof SemanticApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/** 提交审核决策 */
export async function submitDecision(
  packetId: string,
  decision: ReviewDecision,
  comment?: string,
): Promise<{ success: boolean }> {
  const user = getCurrentUser();
  const response = await fetch(`${API_BASE}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      packetId,
      principal: user.id,
      semanticRole: user.role,
      decision,
      decisionReason: comment,
    }),
  });
  const result = await handleResponse<{
    decisionId: string;
    decisionDigest: string;
    packetClosed: boolean;
    outcome: string;
  }>(response);
  return { success: result.outcome === "APPROVED" || result.outcome === "VETOED" };
}

/** 创建新提案 */
export async function createProposal(data: {
  title: string;
  description: string;
  domain: string;
  changeClass: ChangeClass;
  riskLevel: RiskLevel;
  diff: string;
}): Promise<{ packetId: string }> {
  const _user = getCurrentUser();
  const response = await fetch(`${API_BASE}/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse<{ packetId: string }>(response);
}
