export const GREENFIELD_STAGES = [
  "NO_SEMANTIC_RELEASE",
  "SCHEMA_READY",
  "BOOTSTRAP_RUNNING",
  "CANDIDATE_READY",
  "VALIDATION_FAILED",
  "READY_FOR_REVIEW",
  "PUBLISHED_V1_READY",
  "POLICY_MISSING",
  "POLICY_EXPIRED",
] as const;

export type GreenfieldStage = (typeof GREENFIELD_STAGES)[number];

export interface LocalizedCopy {
  readonly "zh-CN": string;
  readonly "en-US": string;
}

export interface GreenfieldStageDefinition {
  readonly stage: GreenfieldStage;
  readonly owner: "WORKSPACE_ADMIN" | "SEMANTIC_AGENT" | "ANALYST" | "SEMANTIC_MAINTAINER";
  readonly title: LocalizedCopy;
  readonly next_action: LocalizedCopy;
  readonly blocks_qa: boolean;
}

export const GREENFIELD_STAGE_DEFINITIONS: readonly GreenfieldStageDefinition[] = [
  {
    stage: "NO_SEMANTIC_RELEASE",
    owner: "WORKSPACE_ADMIN",
    title: { "zh-CN": "尚无语义版本", "en-US": "No semantic release" },
    next_action: { "zh-CN": "连接数据源", "en-US": "Connect a data source" },
    blocks_qa: true,
  },
  {
    stage: "SCHEMA_READY",
    owner: "WORKSPACE_ADMIN",
    title: { "zh-CN": "Schema 已就绪", "en-US": "Schema ready" },
    next_action: { "zh-CN": "授权首版生成", "en-US": "Authorize initial generation" },
    blocks_qa: true,
  },
  {
    stage: "BOOTSTRAP_RUNNING",
    owner: "SEMANTIC_AGENT",
    title: { "zh-CN": "正在生成首版", "en-US": "Bootstrap running" },
    next_action: { "zh-CN": "查看任务进度", "en-US": "View job progress" },
    blocks_qa: true,
  },
  {
    stage: "CANDIDATE_READY",
    owner: "SEMANTIC_AGENT",
    title: { "zh-CN": "候选已生成", "en-US": "Candidate ready" },
    next_action: { "zh-CN": "运行确定性验证", "en-US": "Run deterministic validation" },
    blocks_qa: true,
  },
  {
    stage: "VALIDATION_FAILED",
    owner: "SEMANTIC_MAINTAINER",
    title: { "zh-CN": "验证未通过", "en-US": "Validation failed" },
    next_action: { "zh-CN": "查看阻断证据", "en-US": "Inspect blocking evidence" },
    blocks_qa: true,
  },
  {
    stage: "READY_FOR_REVIEW",
    owner: "SEMANTIC_MAINTAINER",
    title: { "zh-CN": "等待人工治理", "en-US": "Ready for governance review" },
    next_action: { "zh-CN": "处理未解析对象", "en-US": "Resolve open objects" },
    blocks_qa: true,
  },
  {
    stage: "PUBLISHED_V1_READY",
    owner: "ANALYST",
    title: { "zh-CN": "首版已发布", "en-US": "Initial release published" },
    next_action: { "zh-CN": "开始提问", "en-US": "Ask a business question" },
    blocks_qa: false,
  },
  {
    stage: "POLICY_MISSING",
    owner: "WORKSPACE_ADMIN",
    title: { "zh-CN": "缺少启动策略", "en-US": "Bootstrap policy missing" },
    next_action: { "zh-CN": "配置启动授权", "en-US": "Configure bootstrap authorization" },
    blocks_qa: true,
  },
  {
    stage: "POLICY_EXPIRED",
    owner: "WORKSPACE_ADMIN",
    title: { "zh-CN": "启动策略已过期", "en-US": "Bootstrap policy expired" },
    next_action: { "zh-CN": "签发新策略", "en-US": "Issue a new policy" },
    blocks_qa: true,
  },
] as const;

export const RECOVERY_REASON_CODES = [
  "PERMISSION_DENIED",
  "NOT_READY",
  "STALE_RELEASE",
  "CHECKPOINT_AVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "THROTTLED",
  "EXECUTION_LIMIT_REACHED",
  "TERMINAL_POLICY_DENIAL",
  "OUTCOME_UNKNOWN",
] as const;

export type RecoveryReasonCode = (typeof RECOVERY_REASON_CODES)[number];
export type RecoveryAction =
  | "REQUEST_ACCESS"
  | "OPEN_DEPENDENCY"
  | "CREATE_NEW_TASK"
  | "RESUME"
  | "SELECT_CERTIFIED_PROFILE"
  | "WAIT_BACKOFF"
  | "VIEW_PARTIAL_OR_NARROW_SCOPE"
  | "EXPLAIN_ONLY"
  | "RECONCILE";

export interface RecoveryPolicy {
  readonly reason_code: RecoveryReasonCode;
  readonly action: RecoveryAction;
  readonly retry_allowed: boolean;
  readonly resume_allowed: boolean;
}

export const RECOVERY_MATRIX: Readonly<Record<RecoveryReasonCode, RecoveryPolicy>> = {
  PERMISSION_DENIED: {
    reason_code: "PERMISSION_DENIED",
    action: "REQUEST_ACCESS",
    retry_allowed: false,
    resume_allowed: false,
  },
  NOT_READY: {
    reason_code: "NOT_READY",
    action: "OPEN_DEPENDENCY",
    retry_allowed: false,
    resume_allowed: false,
  },
  STALE_RELEASE: {
    reason_code: "STALE_RELEASE",
    action: "CREATE_NEW_TASK",
    retry_allowed: false,
    resume_allowed: false,
  },
  CHECKPOINT_AVAILABLE: {
    reason_code: "CHECKPOINT_AVAILABLE",
    action: "RESUME",
    retry_allowed: false,
    resume_allowed: true,
  },
  PROVIDER_UNAVAILABLE: {
    reason_code: "PROVIDER_UNAVAILABLE",
    action: "SELECT_CERTIFIED_PROFILE",
    retry_allowed: false,
    resume_allowed: false,
  },
  THROTTLED: {
    reason_code: "THROTTLED",
    action: "WAIT_BACKOFF",
    retry_allowed: false,
    resume_allowed: false,
  },
  EXECUTION_LIMIT_REACHED: {
    reason_code: "EXECUTION_LIMIT_REACHED",
    action: "VIEW_PARTIAL_OR_NARROW_SCOPE",
    retry_allowed: false,
    resume_allowed: false,
  },
  TERMINAL_POLICY_DENIAL: {
    reason_code: "TERMINAL_POLICY_DENIAL",
    action: "EXPLAIN_ONLY",
    retry_allowed: false,
    resume_allowed: false,
  },
  OUTCOME_UNKNOWN: {
    reason_code: "OUTCOME_UNKNOWN",
    action: "RECONCILE",
    retry_allowed: false,
    resume_allowed: false,
  },
};

export const WORKSPACE_STATUS_AXES = [
  { axis: "TASK", states: ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] },
  { axis: "EVIDENCE", states: ["CANDIDATE", "VALIDATED", "ACCEPTED", "PUBLISHED"] },
  { axis: "BENCHMARK", states: ["DEMO", "TUNING", "HOLDOUT", "TEST_UNSCORED"] },
  { axis: "RELEASE", states: ["HOLD", "GO"] },
] as const;

export function recoveryPolicyFor(reasonCode: RecoveryReasonCode): RecoveryPolicy {
  return RECOVERY_MATRIX[reasonCode];
}
