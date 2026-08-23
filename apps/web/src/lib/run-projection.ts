import type { DeterministicAnalysisRunProjection } from "@data-agent/contracts";

/**
 * 前端 Run Projection 数据类型。
 *
 * 对应后端 Run Projection 的客户端视图，随着 API 对接逐步完善。
 * 符合 implement.md §U8 工作包要求的信息层级与交互状态。
 */

/** SSE 连接状态 — 符合 implement.md §U8.10 要求 */
export type RunConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "closed";

/** 信息层级：权威状态/当前动作 → Question/Scope/Clarification → Report/Claim–Evidence → Hypothesis/SQL/Receipt → Eval */
export interface RunProjection {
  runId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  question: string;
  scope?: {
    workspace?: string;
    dataset?: string;
    dialect?: string;
    schemaDigest?: string;
  };
  clarification?: string;
  hypothesis?: Hypothesis[];
  reports?: Report[];
  eval?: EvalResult;
  createdAt: string;
  updatedAt: string;
  /** Demo 版本标记 */
  demoLicense?: string;
  demoVersion?: string;
  experienceOnly?: boolean;
  /** L3–L5 路线未交付标记 */
  l2Only: boolean;
  /** 仅由服务端 strict projection 注入；组件不得从原始事件重建。 */
  analysis?: DeterministicAnalysisRunProjection;
}

export interface Hypothesis {
  id: string;
  statement: string;
  status: "PROPOSED" | "TESTING" | "SUPPORTED" | "REFUTED" | "INCONCLUSIVE";
  sql?: string;
  gateReceipts?: GateReceipt[];
  executionReceipts?: ExecutionReceipt[];
  evidence?: ClaimEvidence[];
  conflicts?: Conflict[];
  limitations?: string[];
  /** 执行时间窗 */
  startedAt?: string;
  completedAt?: string;
}

export interface GateReceipt {
  gate: string;
  passed: boolean;
  reason?: string;
  durationMs?: number;
  /** 签发者 */
  issuer?: string;
}

export interface ExecutionReceipt {
  queryId: string;
  sql: string;
  durationMs: number;
  rowCount: number;
  error?: string;
  /** 编译后的 AST Hash */
  astHash?: string;
  /** 查询参数绑定 */
  parameters?: Record<string, unknown>;
}

export interface ClaimEvidence {
  claim: string;
  support: "SUPPORT" | "REFUTE" | "NEUTRAL";
  evidence: string;
  source: string;
  /** 置信度 */
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}

export interface Conflict {
  between: string[];
  description: string;
  /** 冲突类型 */
  type?: "DIRECT" | "PARTIAL" | "CONTINGENT";
}

export interface Report {
  id: string;
  title: string;
  summary: string;
  isDemo: boolean;
  license: string;
  version: string;
  l2Only: boolean;
  claims: ReportClaim[];
  /** 报告生成时间戳 */
  generatedAt?: string;
}

export interface ReportClaim {
  statement: string;
  evidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** 支撑证据列表 */
  supportingSources?: string[];
}

export interface EvalResult {
  suite: string;
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  scoreCard?: {
    passed: number;
    failed: number;
    total: number;
  };
  pairedComparison?: {
    baseline: string;
    candidate: string;
    improvement: boolean;
    metrics?: {
      name: string;
      baseline: number;
      candidate: number;
    }[];
  };
}

/** 工作台 UI 状态 — 符合 implement.md §U8 交互状态要求 */
export interface WorkbenchState {
  projection: RunProjection | null;
  authorityState: "LOADING" | "ACTIVE" | "STALE" | "ERROR" | "PERMISSION_DENIED";
  coreL2Verdict: "HOLD";
  attributionF9Status: "NOT_REGISTERED";
  fixtureEvidenceVerdict: "HOLD";
  currentAction: string;
  /** 各区域的交互状态 */
  sections: {
    query: "loading" | "empty" | "error" | "partial" | "stale" | "permission_denied" | "ready";
    hypothesis: "loading" | "empty" | "error" | "partial" | "stale" | "permission_denied" | "ready";
    report: "loading" | "empty" | "error" | "partial" | "stale" | "permission_denied" | "ready";
    eval: "loading" | "empty" | "error" | "partial" | "stale" | "permission_denied" | "ready";
  };
  /** 错误信息 */
  error?: string;
  /** 是否正在执行操作 */
  busy: boolean;
  /** 澄清对话框 */
  clarificationPending: boolean;
  /** SSE 连接状态 */
  connection: RunConnectionState;
  /** 当前活跃 Run ID */
  activeRunId: string | null;
  /** 投影版本号（用于 SSE 游标恢复） */
  projectionVersion: number;
  /** L3–L5 能力未交付标记 */
  l3Route: "NOT_DELIVERED";
  l4Route: "NOT_DELIVERED";
  l5Route: "NOT_DELIVERED";
}

export function createEmptyWorkbenchState(): WorkbenchState {
  return {
    projection: null,
    authorityState: "LOADING",
    coreL2Verdict: "HOLD",
    attributionF9Status: "NOT_REGISTERED",
    fixtureEvidenceVerdict: "HOLD",
    currentAction: "等待查询…",
    sections: {
      query: "empty",
      hypothesis: "empty",
      report: "empty",
      eval: "empty",
    },
    error: undefined,
    busy: false,
    clarificationPending: false,
    connection: "idle",
    activeRunId: null,
    projectionVersion: 0,
    l3Route: "NOT_DELIVERED",
    l4Route: "NOT_DELIVERED",
    l5Route: "NOT_DELIVERED",
  };
}

/** M1 固定演示状态 — 符合 implement.md §8.7 要求 */
export function createM1DemoState(): WorkbenchState {
  return {
    projection: {
      runId: "m1-demo-001",
      status: "COMPLETED",
      question: "2025 年第一季度华南区净收入同比为什么下降？",
      scope: {
        workspace: "demo-retail",
        dataset: "retail-sales",
        dialect: "postgresql",
      },
      hypothesis: [
        {
          id: "hyp-001",
          statement: "华南区大客户流失导致收入下降",
          status: "SUPPORTED",
          sql: "SELECT c.region, c.customer_tier, SUM(o.net_amount) AS net_revenue FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE o.order_date BETWEEN '2025-01-01' AND '2025-03-31' AND c.region = '华南' GROUP BY c.region, c.customer_tier ORDER BY net_revenue ASC",
          gateReceipts: [
            {
              gate: "意图校验",
              passed: true,
              reason: "问题与查询意图匹配",
              issuer: "intent-gate/v1",
            },
            {
              gate: "语义校验",
              passed: true,
              reason: "维度/度量绑定正确",
              issuer: "semantic-gate/v1",
            },
            {
              gate: "权限校验",
              passed: true,
              reason: "Principal 有华南区数据权限",
              issuer: "acl-gate/v1",
            },
            {
              gate: "资源限制",
              passed: true,
              reason: "预估扫描行数在配额内",
              issuer: "resource-gate/v1",
            },
          ],
          executionReceipts: [
            {
              queryId: "qry-001",
              sql: "SELECT c.region, c.customer_tier, SUM(o.net_amount) AS net_revenue FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE o.order_date BETWEEN '2025-01-01' AND '2025-03-31' AND c.region = '华南' GROUP BY c.region, c.customer_tier ORDER BY net_revenue ASC",
              durationMs: 2340,
              rowCount: 5,
              astHash: "a1b2c3d4",
            },
          ],
          evidence: [
            {
              claim: "华南区大客户收入同比下降 32%",
              support: "SUPPORT",
              evidence: "2025Q1 大客户净收入 ¥1,280 万 vs 2024Q1 ¥1,882 万",
              source: "QueryResult",
              confidence: "HIGH",
            },
            {
              claim: "中小客户收入基本持平",
              support: "SUPPORT",
              evidence: "2025Q1 中小客户净收入 ¥2,150 万 vs 2024Q1 ¥2,210 万",
              source: "QueryResult",
              confidence: "HIGH",
            },
          ],
          conflicts: [],
          limitations: ["未考虑春节季节性因素", "未区分新客与复购"],
          startedAt: "2025-04-01T10:00:00Z",
          completedAt: "2025-04-01T10:00:05Z",
        },
        {
          id: "hyp-002",
          statement: "华南区促销活动减少导致收入下降",
          status: "REFUTED",
          sql: "SELECT c.region, COUNT(DISTINCT p.promotion_id) AS promo_count, SUM(o.net_amount) AS net_revenue FROM orders o JOIN customers c ON o.customer_id = c.customer_id LEFT JOIN promotions p ON o.order_id = p.order_id WHERE o.order_date BETWEEN '2025-01-01' AND '2025-03-31' AND c.region = '华南' GROUP BY c.region",
          gateReceipts: [
            {
              gate: "意图校验",
              passed: true,
              reason: "问题与查询意图匹配",
              issuer: "intent-gate/v1",
            },
            {
              gate: "语义校验",
              passed: false,
              reason: "促销活动与订单没有直接关联",
              issuer: "semantic-gate/v1",
            },
          ],
          executionReceipts: [],
          evidence: [
            {
              claim: "华南区促销活动数量与去年同期持平",
              support: "REFUTE",
              evidence: "2025Q1 促销活动 45 场 vs 2024Q1 44 场",
              source: "QueryResult",
              confidence: "HIGH",
            },
          ],
          conflicts: [
            {
              between: ["hyp-001", "hyp-002"],
              description: "大客户流失与促销减少的解释方向不同",
              type: "DIRECT",
            },
          ],
          limitations: ["促销活动数据可能不完整"],
          startedAt: "2025-04-01T10:01:00Z",
          completedAt: "2025-04-01T10:01:03Z",
        },
        {
          id: "hyp-003",
          statement: "华南区竞争对手降价导致市场份额流失",
          status: "INCONCLUSIVE",
          evidence: [
            {
              claim: "缺少外部竞品定价数据",
              support: "NEUTRAL",
              evidence: "当前数据源未包含竞品信息",
              source: "System",
              confidence: "MEDIUM",
            },
          ],
          conflicts: [],
          limitations: ["需要接入外部市场数据源"],
          startedAt: "2025-04-01T10:02:00Z",
        },
      ],
      reports: [
        {
          id: "rpt-001",
          title: "华南区 2025Q1 净收入下降分析",
          summary:
            "2025 年第一季度华南区净收入同比下降约 18%，主要驱动因素为大客户收入下降 32%，中小客户收入基本持平。未发现促销活动减少的证据。",
          isDemo: true,
          license: "Demo License v1.0",
          version: "1.0.0",
          l2Only: true,
          claims: [
            {
              statement: "华南区 2025Q1 净收入同比下降 18%",
              evidence: "总净收入 ¥3,430 万 vs 2024Q1 ¥4,092 万，同比 -16.2%",
              confidence: "HIGH",
              supportingSources: ["qry-001"],
            },
            {
              statement: "大客户流失是主要驱动因素",
              evidence: "大客户收入占比从 46% 降至 37%，贡献了 62% 的降幅",
              confidence: "HIGH",
              supportingSources: ["qry-001"],
            },
            {
              statement: "促销活动减少不是主要原因",
              evidence: "促销活动数量同比持平，未发现显著变化",
              confidence: "MEDIUM",
              supportingSources: ["qry-002"],
            },
          ],
          generatedAt: "2025-04-01T10:05:00Z",
        },
      ],
      eval: {
        suite: "M1-Demo-QA-v1",
        verdict: "PASS",
        scoreCard: { passed: 5, failed: 0, total: 5 },
        pairedComparison: {
          baseline: "text2sql-v0",
          candidate: "data-agent-v1",
          improvement: true,
          metrics: [
            { name: "SQL 准确率", baseline: 0.82, candidate: 0.94 },
            { name: "归因完整度", baseline: 0.65, candidate: 0.88 },
            { name: "证据可追溯性", baseline: 0.7, candidate: 0.95 },
          ],
        },
      },
      createdAt: "2025-04-01T10:00:00Z",
      updatedAt: "2025-04-01T10:05:00Z",
      demoLicense: "Demo License v1.0",
      demoVersion: "1.0.0",
      experienceOnly: true,
      l2Only: true,
    },
    authorityState: "ACTIVE",
    coreL2Verdict: "HOLD",
    attributionF9Status: "NOT_REGISTERED",
    fixtureEvidenceVerdict: "HOLD",
    currentAction: "分析完成",
    sections: {
      query: "ready",
      hypothesis: "ready",
      report: "ready",
      eval: "ready",
    },
    error: undefined,
    busy: false,
    clarificationPending: false,
    connection: "idle",
    activeRunId: null,
    projectionVersion: 0,
    l3Route: "NOT_DELIVERED",
    l4Route: "NOT_DELIVERED",
    l5Route: "NOT_DELIVERED",
  };
}

/** 判断 Run 是否已终止 */
export function isRunTerminal(status: RunProjection["status"]): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}
