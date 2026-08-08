/**
 * 语义治理 API 客户端。
 *
 * 对应 U11.2 Human Review Workspace 的 API 调用。
 * 通过 Next.js API Routes 与服务层通信。
 */

import type { SemanticCandidateCreateResult } from "@data-agent/contracts";
import type {
  ChangeClass,
  InboxGroup,
  InboxItem,
  ReviewDecision,
  RiskLevel,
  SemanticReviewPacket,
} from "./semantic-types";

// ─── API 基础路径 ──────────────────────────────────────────────────────────────

const API_BASE = "/api/semantic/governance";

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
  semanticDomain = "revenue",
): Promise<{ success: boolean }> {
  if (decision === "pending") {
    throw new SemanticApiError("INVALID_DECISION", "待处理状态不能作为审核决策提交。", 400);
  }
  const response = await fetch(`${API_BASE}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: "semantic-decision@1.0.0",
      semantic_domain: semanticDomain,
      packet_id: packetId,
      decision: decision === "approved" ? "APPROVE" : "REJECT",
      ...(comment ? { decision_reason: comment } : {}),
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
}): Promise<SemanticCandidateCreateResult> {
  let content: Record<string, unknown>;
  try {
    const parsed = JSON.parse(data.diff) as unknown;
    content =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { definition: parsed };
  } catch {
    content = { definition: data.diff };
  }
  const changeClass =
    data.changeClass === "binding"
      ? "RUNTIME_AUTHORIZATION"
      : data.changeClass === "governance"
        ? "SECURITY"
        : data.changeClass === "other"
          ? "MINOR"
          : "MAJOR";
  const response = await fetch(`${API_BASE}/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: "semantic-candidate-draft@1.0.0",
      title: data.title,
      description: data.description,
      semantic_domain: data.domain,
      change_class: changeClass,
      risk_level: data.riskLevel.toUpperCase(),
      idempotency_key: crypto.randomUUID(),
      source_payload: {
        schema_version: "semantic-source-payload@1.0.0",
        source_kind: "MANUAL",
        content,
      },
      diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: data.description,
        operations: [
          {
            path: "semantic_model",
            change_type: "MODIFY",
            before: {},
            after: content,
          },
        ],
      },
    }),
  });
  return handleResponse<SemanticCandidateCreateResult>(response);
}
