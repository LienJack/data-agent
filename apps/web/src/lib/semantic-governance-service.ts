/**
 * 语义治理后端服务。
 *
 * 封装 U11.1 Agent-native Semantic Services 的业务逻辑。
 * 当前使用 M1 演示阶段数据，SQL 调用通过 withAppTransaction 注入。
 * 后续替换 service 实现即可对接真实 PostgreSQL 10610 migration。
 *
 * @server-only
 */

import pg from "pg";
import { PostgresSemanticGovernanceService } from "./postgres-semantic-governance-service";
import "server-only";
import type {
  InboxGroup,
  InboxItem,
  ReviewDecision,
  SemanticReviewPacket,
  SemanticRole,
} from "./semantic-types";

// ─── 错误类型 ──────────────────────────────────────────────────────────────────

export class SemanticGovernanceError extends Error {
  override readonly name = "SemanticGovernanceError";
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

// ─── 服务层类型 ────────────────────────────────────────────────────────────────

export interface SemanticGovernanceService {
  /** 获取指定域的语义域列表 */
  listDomains(scope: SemanticScope): Promise<DomainInfo[]>;

  /** 获取收件箱条目（按分组） */
  getInboxItems(scope: SemanticScope, group: InboxGroup): Promise<InboxItem[]>;

  /** 获取审核包详情 */
  getPacketDetail(scope: SemanticScope, packetId: string): Promise<SemanticReviewPacket>;

  /** 提交审核决策 */
  submitDecision(scope: SemanticScope, input: DecisionInput): Promise<DecisionResult>;

  /** 创建新提案（Candidate） */
  createCandidate(scope: SemanticScope, input: CreateCandidateInput): Promise<{ packetId: string }>;

  /** 准备发布 */
  preparePublish(scope: SemanticScope, packetId: string): Promise<{ attemptId: string }>;

  /** 执行发布 */
  commitPublish(scope: SemanticScope, packetId: string): Promise<{ releaseId: string }>;

  /** 执行回滚 */
  executeRollback(scope: SemanticScope, packetId: string): Promise<{ receiptId: string }>;
}

export interface SemanticScope {
  appId: string;
  tenantId: string;
  environment: string;
  semanticDomain: string;
}

export interface DomainInfo {
  domain: string;
  displayName: string;
  description: string;
  datasourceId: string;
  isActive: boolean;
  domainVersion: number;
}

export interface DecisionInput {
  packetId: string;
  principal: string;
  semanticRole: string;
  decision: ReviewDecision;
  decisionReason?: string;
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

export interface CreateCandidateInput {
  title: string;
  description: string;
  domain: string;
  changeClass: string;
  riskLevel: string;
  diff: string;
}

// ─── 默认 scope ────────────────────────────────────────────────────────────────

const _DEFAULT_SCOPE: SemanticScope = {
  appId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000001",
  environment: "development",
  semanticDomain: "revenue",
};

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

class MockSemanticGovernanceService implements SemanticGovernanceService {
  async listDomains(scope: SemanticScope): Promise<DomainInfo[]> {
    await delay(200);
    return mockDomains.filter(
      (d) => scope.semanticDomain === "all" || d.domain === scope.semanticDomain,
    );
  }

  async getInboxItems(_scope: SemanticScope, group: InboxGroup): Promise<InboxItem[]> {
    await delay(300);
    return mockInboxItems.filter((item) => item.group === group);
  }

  async getPacketDetail(_scope: SemanticScope, packetId: string): Promise<SemanticReviewPacket> {
    await delay(400);
    if (packetId === "pkt-001") return mockPacketDetail;
    const found = mockInboxItems.find((i) => i.packetId === packetId);
    if (!found) {
      throw new SemanticGovernanceError("PACKET_NOT_FOUND", "审核包不存在", 404);
    }
    return mockPacketDetail;
  }

  async submitDecision(_scope: SemanticScope, input: DecisionInput): Promise<DecisionResult> {
    // 权限验证
    const packet = mockPacketDetail;
    assertCanDecide(input.semanticRole as SemanticRole, input.principal, packet);

    await delay(500);
    return {
      decisionId: crypto.randomUUID(),
      decisionDigest: `sha256:mock-${Date.now()}`,
      packetClosed: true,
      outcome: "APPROVED",
      totalApprovals: 1,
      totalRejections: 0,
      requiredApprovals: 2,
      decisionSetDigest: `sha256:decision-set-${Date.now()}`,
    };
  }

  async createCandidate(
    _scope: SemanticScope,
    _input: CreateCandidateInput,
  ): Promise<{ packetId: string }> {
    await delay(600);
    return { packetId: `pkt-new-${Date.now()}` };
  }

  async preparePublish(_scope: SemanticScope, _packetId: string): Promise<{ attemptId: string }> {
    assertCanPublish("human-reviewer" as SemanticRole, "approved-not-published");
    await delay(300);
    return { attemptId: `attempt-${Date.now()}` };
  }

  async commitPublish(_scope: SemanticScope, _packetId: string): Promise<{ releaseId: string }> {
    assertCanPublish("human-reviewer" as SemanticRole, "approved-not-published");
    await delay(500);
    return { releaseId: `release-${Date.now()}` };
  }

  async executeRollback(_scope: SemanticScope, _packetId: string): Promise<{ receiptId: string }> {
    assertCanPublish("human-reviewer" as SemanticRole, "approved-not-published");
    await delay(400);
    return { receiptId: `receipt-${Date.now()}` };
  }
}

// ─── 单例 ──────────────────────────────────────────────────────────────────────

let serviceInstance: SemanticGovernanceService | null = null;

export function getSemanticGovernanceService(): SemanticGovernanceService {
  if (!serviceInstance) {
    if (process.env.USE_POSTGRES_SERVICE === "true") {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new SemanticGovernanceError(
          "DATABASE_URL_REQUIRED",
          "USE_POSTGRES_SERVICE 为 true 但未设置 DATABASE_URL 环境变量",
          500,
        );
      }
      const pool = new pg.Pool({ connectionString });
      serviceInstance = new PostgresSemanticGovernanceService(pool);
    } else {
      serviceInstance = new MockSemanticGovernanceService();
    }
  }
  return serviceInstance;
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
