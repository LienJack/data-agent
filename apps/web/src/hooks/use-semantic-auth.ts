/**
 * 语义治理认证 Hook。
 *
 * M1 演示阶段使用模拟用户身份。
 * 后续对接真实认证系统时替换实现即可。
 */

import type { CurrentUser, SemanticRole } from "@data-agent/contracts";
import { useMemo } from "react";

const CURRENT_REVIEW_USER: CurrentUser = {
  id: "user-001",
  name: "张三",
  role: "human-reviewer",
};

// ─── 权限检查 ──────────────────────────────────────────────────────────────────

/** 可审批的角色集合 */
const CAN_APPROVE_ROLES: SemanticRole[] = ["human-reviewer", "admin"];

/** 可发布的角色集合 */
const CAN_PUBLISH_ROLES: SemanticRole[] = ["publisher", "admin"];

/** 可提案的角色集合 */
const CAN_PROPOSE_ROLES: SemanticRole[] = ["agent-proposer", "admin"];

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * 获取当前用户身份。
 * M1 阶段返回模拟用户；后续替换为真实认证上下文。
 */
export function useCurrentUser(): CurrentUser {
  // TODO: 替换为真实认证上下文
  return useMemo(() => CURRENT_REVIEW_USER, []);
}

/**
 * 检查用户是否可审批。
 */
export function useCanApprove(): boolean {
  const user = useCurrentUser();
  return useMemo(() => CAN_APPROVE_ROLES.includes(user.role), [user.role]);
}

/**
 * 检查用户是否可发布。
 */
export function useCanPublish(): boolean {
  const user = useCurrentUser();
  return useMemo(() => CAN_PUBLISH_ROLES.includes(user.role), [user.role]);
}

/**
 * 检查用户是否可提案。
 */
export function useCanPropose(): boolean {
  const user = useCurrentUser();
  return useMemo(() => CAN_PROPOSE_ROLES.includes(user.role), [user.role]);
}

/**
 * 检查当前用户是否可对指定审核包做出决策。
 * 提案人不能审批自己的提案（Exclusion Set）。
 */
export function useCanDecideOnPacket(packet: { proposer: { id: string }; status: string }): {
  canDecide: boolean;
  reason?: string;
} {
  const user = useCurrentUser();

  return useMemo(() => {
    // 只有 candidate 状态的包可决策
    if (packet.status !== "candidate") {
      return { canDecide: false, reason: "该审核包已结束" };
    }

    // 检查是否可审批
    if (!CAN_APPROVE_ROLES.includes(user.role)) {
      return { canDecide: false, reason: "当前角色无权审批" };
    }

    // Exclusion Set：提案人不能审批自己的提案
    if (user.id === packet.proposer.id) {
      return { canDecide: false, reason: "提案人不能审批自己的提案" };
    }

    return { canDecide: true };
  }, [user.id, user.role, packet.proposer.id, packet.status]);
}

/**
 * 检查用户是否可发布/回滚指定审核包。
 */
export function useCanPublishPacket(packet: { status: string }): {
  canPublish: boolean;
  reason?: string;
} {
  const user = useCurrentUser();

  return useMemo(() => {
    if (!CAN_PUBLISH_ROLES.includes(user.role)) {
      return { canPublish: false, reason: "当前角色无权发布" };
    }
    if (packet.status !== "approved-not-published") {
      return { canPublish: false, reason: "该审核包尚未批准发布" };
    }
    return { canPublish: true };
  }, [user.role, packet.status]);
}

/**
 * 获取当前用户的语义角色（用于 API 请求）。
 */
export function useSemanticRole(): SemanticRole {
  const user = useCurrentUser();
  return user.role;
}

/**
 * 获取当前用户 ID（用于 API 请求）。
 */
export function useCurrentUserId(): string {
  const user = useCurrentUser();
  return user.id;
}
