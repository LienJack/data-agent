/**
 * 语义治理相关类型定义。
 *
 * 对应 U11.2 Human Review Workspace 的数据模型。
 * 遵循 .trellis/spec/frontend/type-safety.md 的判别联合约定。
 */

// ─── 状态判别联合 ──────────────────────────────────────────────────────────────

/** 语义审核包状态 */
export type ReviewPacketStatus =
  | "active"
  | "candidate"
  | "stale"
  | "rejected"
  | "approved-not-published"
  | "published"
  | "rolled-back";

/** 审核决策 */
export type ReviewDecision = "approved" | "rejected" | "pending";

/** 风险等级 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** 变更类别 */
export type ChangeClass =
  | "metric" // 指标定义变更
  | "formula" // 计算公式变更
  | "relationship" // 关系/绑定变更
  | "binding" // 物理绑定变更
  | "governance" // 治理规则变更
  | "other"; // 其他

// ─── 核心类型 ──────────────────────────────────────────────────────────────────

/** 语义审核候选包 */
export interface SemanticReviewPacket {
  id: string;
  version: number;
  title: string;
  description: string;
  domain: string;
  changeClass: ChangeClass;
  riskLevel: RiskLevel;
  status: ReviewPacketStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;

  /** 提案人 */
  proposer: {
    id: string;
    name: string;
  };

  /** 审核人列表 */
  reviewers: Reviewer[];
  quorum: { required: number; current: number };

  /** 决策记录 */
  decisions: ReviewDecisionRecord[];

  /** Diff 内容 */
  diff: SemanticDiff;

  /** 影响分析 */
  impact: ImpactAnalysis;

  /** 发布溯源 */
  lineage: LineageRecord[];

  /** 修订历史 */
  revisions: RevisionRecord[];

  /** 当前版本前驱（被 rebase 的旧版本） */
  supersedes?: string;
}

/** 审核人 */
export interface Reviewer {
  id: string;
  name: string;
  avatar?: string;
  decision: ReviewDecision;
  decidedAt?: string;
  comment?: string;
}

/** 审核决策记录 */
export interface ReviewDecisionRecord {
  reviewerId: string;
  reviewerName: string;
  decision: ReviewDecision;
  decidedAt: string;
  comment?: string;
  reauthenticated: boolean;
}

/** 语义 Diff */
export interface SemanticDiff {
  summary: string;
  additions: DiffEntry[];
  modifications: DiffEntry[];
  deletions: DiffEntry[];
}

/** Diff 条目 */
export interface DiffEntry {
  path: string;
  before?: string;
  after?: string;
  changeType: "added" | "modified" | "deleted";
}

/** 影响分析 */
export interface ImpactAnalysis {
  affectedQueries: string[];
  affectedEvals: string[];
  affectedMetrics: string[];
  breakingChanges: boolean;
  summary: string;
}

/** 发布溯源记录 */
export interface LineageRecord {
  version: number;
  action: "created" | "approved" | "published" | "rolled-back" | "rejected" | "revised" | "rebased";
  actor: string;
  timestamp: string;
  comment?: string;
  packetId?: string;
}

/** 修订记录 */
export interface RevisionRecord {
  version: number;
  author: string;
  authorId: string;
  comment: string;
  createdAt: string;
  diff: SemanticDiff;
}

// ─── 收件箱类型 ────────────────────────────────────────────────────────────────

/** 审核收件箱分组 */
export type InboxGroup =
  | "my-decision" // 需我决策
  | "waiting-others" // 等待他人
  | "expiring" // 即将过期
  | "completed"; // 已结束

/** 收件箱分组配置 */
export const INBOX_GROUPS: { id: InboxGroup; label: string }[] = [
  { id: "my-decision", label: "需我决策" },
  { id: "waiting-others", label: "等待他人" },
  { id: "expiring", label: "即将过期" },
  { id: "completed", label: "已结束" },
];

/** 收件箱条目 */
export interface InboxItem {
  packetId: string;
  title: string;
  domain: string;
  changeClass: ChangeClass;
  riskLevel: RiskLevel;
  status: ReviewPacketStatus;
  createdAt: string;
  expiresAt: string;
  proposer: string;
  quorum: { required: number; current: number };
  currentDecision: ReviewDecision;
  group: InboxGroup;
}

// ─── 视图状态 ──────────────────────────────────────────────────────────────────

/** 审核工作台视图状态 */
export type SemanticViewState =
  | { kind: "inbox"; group: InboxGroup; items: InboxItem[] }
  | { kind: "detail"; packet: SemanticReviewPacket }
  | { kind: "diff"; packet: SemanticReviewPacket }
  | { kind: "impact"; packet: SemanticReviewPacket }
  | { kind: "lineage"; packet: SemanticReviewPacket }
  | { kind: "compose"; mode: "new" | "revise"; packet?: SemanticReviewPacket };
// ─── 语义角色 ──────────────────────────────────────────────────────────────────

/** 语义治理角色 */
export type SemanticRole =
  | "agent-proposer" // A7 Agent — 可提案，不可审批
  | "human-reviewer" // A2 Human Reviewer — 可审批，不可提案或发布
  | "publisher" // A8 Publisher — 可发布/回滚，不可提案
  | "admin"; // 系统管理员 — 全权限（仅 M1 阶段）

/** 角色显示名称 */
export const SEMANTIC_ROLE_LABELS: Record<SemanticRole, string> = {
  "agent-proposer": "Agent 提案者",
  "human-reviewer": "人工审核员",
  publisher: "发布管理员",
  admin: "管理员",
};

/** 当前用户身份 */
export interface CurrentUser {
  id: string;
  name: string;
  role: SemanticRole;
  avatar?: string;
}
