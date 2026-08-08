/**
 * 语义治理后端服务。
 *
 * 封装 U11.1 Agent-native Semantic Services 的业务逻辑。
 * 当前使用 M1 演示阶段数据，SQL 调用通过 withAppTransaction 注入。
 * 后续替换 service 实现即可对接真实 PostgreSQL 10610 migration。
 *
 * @server-only
 */

import {
  type SemanticCandidateCreateResult,
  type SemanticCandidateDraft,
  type SemanticCommitPublishInput,
  type SemanticDecisionInput,
  type SemanticPreparePublishInput,
  type SemanticRollbackInput,
  sha256ContentHash,
} from "@data-agent/contracts";
import "server-only";
import type { SemanticAuthorityContext } from "./semantic-authority";
import {
  publicSemanticGovernanceError,
  SemanticGovernanceError,
} from "./semantic-governance-error";
import type { InboxGroup, InboxItem, SemanticReviewPacket, SemanticRole } from "./semantic-types";

// ─── 错误类型 ──────────────────────────────────────────────────────────────────

export { SemanticGovernanceError } from "./semantic-governance-error";

// ─── 服务层类型 ────────────────────────────────────────────────────────────────

export interface SemanticGovernanceService {
  /** 获取指定域的语义域列表 */
  listDomains(authority: SemanticAuthorityContext): Promise<DomainInfo[]>;

  /** 获取收件箱条目（按分组） */
  getInboxItems(authority: SemanticAuthorityContext, group: InboxGroup): Promise<InboxItem[]>;

  /** 获取审核包详情 */
  getPacketDetail(
    authority: SemanticAuthorityContext,
    packetId: string,
  ): Promise<SemanticReviewPacket>;

  /** 提交审核决策 */
  submitDecision(
    authority: SemanticAuthorityContext,
    input: SemanticDecisionInput,
  ): Promise<DecisionResult>;

  /** 创建新提案（Candidate） */
  createCandidate(
    authority: SemanticAuthorityContext,
    input: SemanticCandidateDraft,
  ): Promise<SemanticCandidateCreateResult>;

  /** 准备发布 */
  preparePublish(
    authority: SemanticAuthorityContext,
    input: SemanticPreparePublishInput,
  ): Promise<{ attemptId: string }>;

  /** 执行发布 */
  commitPublish(
    authority: SemanticAuthorityContext,
    input: SemanticCommitPublishInput,
  ): Promise<{ releaseId: string }>;

  /** 执行回滚 */
  executeRollback(
    authority: SemanticAuthorityContext,
    input: SemanticRollbackInput,
  ): Promise<{ receiptId: string }>;
}

export type SemanticScope = SemanticAuthorityContext["scope"];

export interface DomainInfo {
  domain: string;
  displayName: string;
  description: string;
  datasourceId: string;
  isActive: boolean;
  domainVersion: number;
}

export interface DecisionResult {
  decisionId: string;
  decisionDigest: string;
  packetClosed: boolean;
  outcome: "APPROVED" | "VETOED" | "PENDING";
  totalApprovals: number;
  totalRejections: number;
  requiredApprovals?: number;
  decisionSetDigest?: string;
}

// ─── 模拟数据 ──────────────────────────────────────────────────────────────────

const mockDomains: DomainInfo[] = [
  {
    domain: "revenue",
    displayName: "收入分析",
    description: "收入相关的指标、维度和关系",
    datasourceId: "ds-001",
    isActive: true,
    domainVersion: 3,
  },
  {
    domain: "customer",
    displayName: "客户分析",
    description: "客户行为与画像分析",
    datasourceId: "ds-001",
    isActive: true,
    domainVersion: 2,
  },
  {
    domain: "marketing",
    displayName: "营销分析",
    description: "营销活动与效果分析",
    datasourceId: "ds-001",
    isActive: false,
    domainVersion: 1,
  },
];

const mockInboxItems: InboxItem[] = [
  {
    packetId: "pkt-001",
    title: "调整「净收入」计算公式",
    domain: "收入分析",
    changeClass: "formula",
    riskLevel: "high",
    status: "candidate",
    createdAt: "2026-08-03T09:00:00Z",
    expiresAt: "2026-08-10T09:00:00Z",
    proposer: "A7 Agent",
    quorum: { required: 2, current: 0 },
    currentDecision: "pending",
    group: "my-decision",
  },
  {
    packetId: "pkt-002",
    title: "新增「客户流失率」指标定义",
    domain: "客户分析",
    changeClass: "metric",
    riskLevel: "medium",
    status: "candidate",
    createdAt: "2026-08-03T10:00:00Z",
    expiresAt: "2026-08-10T10:00:00Z",
    proposer: "张三",
    quorum: { required: 2, current: 1 },
    currentDecision: "pending",
    group: "my-decision",
  },
  {
    packetId: "pkt-003",
    title: "更新华南区数据源绑定",
    domain: "数据源",
    changeClass: "binding",
    riskLevel: "critical",
    status: "candidate",
    createdAt: "2026-08-02T14:00:00Z",
    expiresAt: "2026-08-09T14:00:00Z",
    proposer: "A7 Agent",
    quorum: { required: 3, current: 2 },
    currentDecision: "pending",
    group: "waiting-others",
  },
  {
    packetId: "pkt-004",
    title: "添加「市场份额」关系定义",
    domain: "竞争分析",
    changeClass: "relationship",
    riskLevel: "low",
    status: "candidate",
    createdAt: "2026-08-01T11:00:00Z",
    expiresAt: "2026-08-08T11:00:00Z",
    proposer: "李四",
    quorum: { required: 1, current: 1 },
    currentDecision: "approved",
    group: "completed",
  },
  {
    packetId: "pkt-005",
    title: "删除废弃的「促销效率」指标",
    domain: "营销分析",
    changeClass: "metric",
    riskLevel: "medium",
    status: "rejected",
    createdAt: "2026-07-30T08:00:00Z",
    expiresAt: "2026-08-06T08:00:00Z",
    proposer: "A7 Agent",
    quorum: { required: 2, current: 2 },
    currentDecision: "rejected",
    group: "completed",
  },
];

const mockPacketDetail: SemanticReviewPacket = {
  id: "pkt-001",
  version: 3,
  title: "调整「净收入」计算公式",
  description:
    "将净收入计算公式从「总收入 - 退款」调整为「总收入 - 退款 - 折扣」，以准确反映实际收入。",
  domain: "收入分析",
  changeClass: "formula",
  riskLevel: "high",
  status: "candidate",
  createdAt: "2026-08-03T09:00:00Z",
  updatedAt: "2026-08-03T09:30:00Z",
  expiresAt: "2026-08-10T09:00:00Z",
  proposer: { id: "agent-a7", name: "A7 Agent" },
  reviewers: [
    { id: "user-001", name: "张三", decision: "pending" },
    { id: "user-002", name: "李四", decision: "pending" },
  ],
  quorum: { required: 2, current: 0 },
  decisions: [],
  diff: {
    summary: "修改净收入计算公式，增加折扣扣减项",
    additions: [
      {
        path: "metrics/net-revenue.formula",
        before: "总收入 - 退款",
        after: "总收入 - 退款 - 折扣",
        changeType: "modified",
      },
    ],
    modifications: [
      {
        path: "metrics/net-revenue.description",
        before: "净收入 = 总收入 - 退款",
        after: "净收入 = 总收入 - 退款 - 折扣",
        changeType: "modified",
      },
    ],
    deletions: [],
  },
  impact: {
    affectedQueries: ["qry-001: 季度收入分析", "qry-003: 产品线收入对比"],
    affectedEvals: ["eval-001: 收入计算准确性"],
    affectedMetrics: ["net-revenue", "gross-profit"],
    breakingChanges: false,
    summary: "影响 2 个查询和 1 个评测，无破坏性变更",
  },
  lineage: [
    {
      version: 1,
      action: "created",
      actor: "A7 Agent",
      timestamp: "2026-08-03T09:00:00Z",
      comment: "初始提案",
    },
    {
      version: 2,
      action: "revised",
      actor: "张三",
      timestamp: "2026-08-03T09:15:00Z",
      comment: "补充折扣扣减的详细说明",
    },
    {
      version: 3,
      action: "revised",
      actor: "A7 Agent",
      timestamp: "2026-08-03T09:30:00Z",
      comment: "根据反馈调整计算公式格式",
    },
  ],
  revisions: [
    {
      version: 1,
      author: "A7 Agent",
      authorId: "agent-a7",
      comment: "初始提案",
      createdAt: "2026-08-03T09:00:00Z",
      diff: {
        summary: "初始版本",
        additions: [],
        modifications: [],
        deletions: [],
      },
    },
    {
      version: 2,
      author: "张三",
      authorId: "user-001",
      comment: "补充折扣扣减的详细说明",
      createdAt: "2026-08-03T09:15:00Z",
      diff: {
        summary: "完善描述",
        additions: [],
        modifications: [],
        deletions: [],
      },
    },
  ],
};

// ─── 服务实现（M1 演示阶段）────────────────────────────────────────────────────

export class MockSemanticGovernanceService implements SemanticGovernanceService {
  async listDomains(authority: SemanticAuthorityContext): Promise<DomainInfo[]> {
    await delay(200);
    return mockDomains.filter(
      (domain) =>
        authority.allowedDomains.includes(domain.domain) &&
        (authority.scope.semanticDomain === "all" ||
          domain.domain === authority.scope.semanticDomain),
    );
  }

  async getInboxItems(
    _authority: SemanticAuthorityContext,
    group: InboxGroup,
  ): Promise<InboxItem[]> {
    await delay(300);
    return mockInboxItems.filter((item) => item.group === group);
  }

  async getPacketDetail(
    _authority: SemanticAuthorityContext,
    packetId: string,
  ): Promise<SemanticReviewPacket> {
    await delay(400);
    if (packetId === "pkt-001") return mockPacketDetail;
    const found = mockInboxItems.find((i) => i.packetId === packetId);
    if (!found) {
      throw publicSemanticGovernanceError("SEMANTIC_PACKET_NOT_FOUND");
    }
    return mockPacketDetail;
  }

  async submitDecision(
    authority: SemanticAuthorityContext,
    input: SemanticDecisionInput,
  ): Promise<DecisionResult> {
    // 权限验证
    const packet = mockPacketDetail;
    const role = authority.semanticRole === "demo" ? "admin" : authority.semanticRole;
    assertCanDecide(role as SemanticRole, authority.principal, packet);

    await delay(500);
    const decisionId = crypto.randomUUID();
    const decisionDigest = await sha256ContentHash({
      decisionId,
      input,
      authority: "NON_AUTHORITATIVE_MOCK",
    });
    return {
      decisionId,
      decisionDigest,
      packetClosed: true,
      outcome: "APPROVED",
      totalApprovals: 1,
      totalRejections: 0,
      requiredApprovals: 2,
      decisionSetDigest: decisionDigest,
    };
  }

  async createCandidate(
    _authority: SemanticAuthorityContext,
    input: SemanticCandidateDraft,
  ): Promise<SemanticCandidateCreateResult> {
    await delay(600);
    const digest = await sha256ContentHash(input);
    return {
      schema_version: "semantic-candidate-create-result@1.0.0",
      authority: "NON_AUTHORITATIVE_MOCK",
      candidate_id: crypto.randomUUID(),
      revision_id: crypto.randomUUID(),
      source_revision_id: crypto.randomUUID(),
      source_digest: digest,
      revision_digest: digest,
      idempotency_digest: await sha256ContentHash({ idempotency_key: input.idempotency_key }),
      candidate_status: "DRAFT",
      created: true,
    };
  }

  async preparePublish(
    authority: SemanticAuthorityContext,
    _input: SemanticPreparePublishInput,
  ): Promise<{ attemptId: string }> {
    const role = authority.semanticRole === "demo" ? "admin" : authority.semanticRole;
    assertCanPublish(role as SemanticRole, "approved-not-published");
    await delay(300);
    return { attemptId: crypto.randomUUID() };
  }

  async commitPublish(
    authority: SemanticAuthorityContext,
    _input: SemanticCommitPublishInput,
  ): Promise<{ releaseId: string }> {
    const role = authority.semanticRole === "demo" ? "admin" : authority.semanticRole;
    assertCanPublish(role as SemanticRole, "approved-not-published");
    await delay(500);
    return { releaseId: crypto.randomUUID() };
  }

  async executeRollback(
    authority: SemanticAuthorityContext,
    _input: SemanticRollbackInput,
  ): Promise<{ receiptId: string }> {
    const role = authority.semanticRole === "demo" ? "admin" : authority.semanticRole;
    assertCanPublish(role as SemanticRole, "approved-not-published");
    await delay(400);
    return { receiptId: crypto.randomUUID() };
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 可审批的角色 */
const APPROVAL_ROLES: SemanticRole[] = ["human-reviewer", "admin"];

/** 可发布的角色 */
const PUBLISH_ROLES: SemanticRole[] = ["publisher", "admin"];

/**
 * 验证决策提交权限。
 *
 * - 仅 human-reviewer 和 admin 可审批。
 * - 提案人不能审批自己的提案（Exclusion Set）。
 */
function assertCanDecide(
  role: SemanticRole,
  principalId: string,
  packet: { proposer: { id: string }; status: string },
): void {
  if (!APPROVAL_ROLES.includes(role)) {
    throw new SemanticGovernanceError("ROLE_CANNOT_DECIDE", `当前角色 ${role} 无权审批`, 403);
  }
  // Exclusion Set: 提案人不能审批自己的提案
  if (principalId === packet.proposer.id) {
    throw new SemanticGovernanceError("PROPOSER_CANNOT_APPROVE", "提案人不能审批自己的提案", 403);
  }
  if (packet.status !== "candidate") {
    throw new SemanticGovernanceError(
      "PACKET_NOT_CANDIDATE",
      `当前审核包状态为 ${packet.status}，不可审批`,
      400,
    );
  }
}

/**
 * 验证发布权限。
 */
function assertCanPublish(role: SemanticRole, packetStatus: string): void {
  if (!PUBLISH_ROLES.includes(role)) {
    throw new SemanticGovernanceError("ROLE_CANNOT_PUBLISH", `当前角色 ${role} 无权发布`, 403);
  }
  if (packetStatus !== "approved-not-published") {
    throw new SemanticGovernanceError(
      "PACKET_NOT_APPROVED",
      `当前审核包状态为 ${packetStatus}，不可发布`,
      400,
    );
  }
}
