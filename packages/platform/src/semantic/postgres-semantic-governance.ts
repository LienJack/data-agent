import type {
  ChangeClass,
  DiffEntry,
  ImpactAnalysis,
  InboxGroup,
  InboxItem,
  LineageRecord,
  PortResult,
  SemanticReviewDecisionView as ReviewDecision,
  ReviewDecisionRecord,
  Reviewer,
  ReviewPacketStatus,
  RevisionRecord,
  RiskLevel,
  SemanticApplicationAuthority,
  SemanticCandidateCreateResult,
  SemanticCandidateDraft,
  SemanticCommitPublishInput,
  SemanticDecisionInput,
  SemanticGovernanceDomainInfo,
  SemanticGovernancePort,
  SemanticPreparePublishInput,
  SemanticReviewPacket,
  SemanticRole,
  SemanticRollbackInput,
  SemanticSuccessorReviewAuthorityEvidence,
} from "@data-agent/contracts";
import {
  semanticCandidateCreateResultSchema,
  semanticChangeSetSchema,
  semanticSuccessorReviewPacketPayloadSchema,
  verifySemanticChangeSet,
} from "@data-agent/contracts";
import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import type pg from "pg";
import {
  adaptPgPool,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { AppCapability, AppCapabilityRole } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

type SemanticScope = SemanticApplicationAuthority["scope"];
type DomainInfo = SemanticGovernanceDomainInfo;
type DecisionResult = import("@data-agent/contracts").SemanticGovernanceDecisionResult;
type SemanticDiff = import("@data-agent/contracts").SemanticReviewDiff;

const GOVERNANCE_ERRORS = {
  SEMANTIC_SCOPE_FORBIDDEN: "当前身份无权访问该语义域。",
  SEMANTIC_PACKET_NOT_FOUND: "语义审核包不存在。",
  SEMANTIC_CANDIDATE_INVALID: "语义候选输入无效。",
  SEMANTIC_CANDIDATE_CONFLICT: "相同幂等键已绑定其他语义候选内容。",
  SEMANTIC_PUBLISH_CONFLICT: "语义发布状态已变化，请刷新后重试。",
  SEMANTIC_GOVERNANCE_UNAVAILABLE: "语义治理服务暂时不可用。",
} as const;

type GovernanceErrorCode = keyof typeof GOVERNANCE_ERRORS;

class SemanticGovernanceAdapterError extends Error {
  override readonly name = "SemanticGovernanceAdapterError";

  constructor(
    readonly code: string,
    message: string,
    _status = 500,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function isGovernanceErrorCode(code: string): code is GovernanceErrorCode {
  return code in GOVERNANCE_ERRORS;
}

function governanceError(
  code: GovernanceErrorCode,
  retryable = false,
): SemanticGovernanceAdapterError {
  return new SemanticGovernanceAdapterError(code, GOVERNANCE_ERRORS[code], 500, retryable);
}

// ─── 状态映射 ──────────────────────────────────────────────────────────────────

/** DB candidate_status → ReviewPacketStatus */
function mapCandidateStatus(dbStatus: string): ReviewPacketStatus {
  switch (dbStatus) {
    case "DRAFT":
    case "VALIDATING":
    case "VALIDATION_FAILED":
    case "REVIEW_SUBMITTED":
    case "WAITING_REVIEW":
    case "PUBLISHING":
      return "candidate";
    case "APPROVED":
      return "approved-not-published";
    case "REJECTED":
    case "REVIEW_EXPIRED":
      return "rejected";
    case "PUBLISHED":
      return "published";
    case "STALE_REBASE_REQUIRED":
      return "stale";
    default:
      return "candidate";
  }
}

/** DB review_outcome → ReviewDecision */
function mapReviewOutcome(outcome: string): ReviewDecision {
  switch (outcome) {
    case "PENDING":
      return "pending";
    case "APPROVED":
      return "approved";
    case "VETOED":
    case "EXPIRED":
      return "rejected";
    default:
      return "pending";
  }
}

/** DB semantic_role → SemanticRole */
function mapSemanticRole(dbRole: string): SemanticRole {
  switch (dbRole) {
    case "domain_reviewer":
    case "security_reviewer":
      return "human-reviewer";
    case "admin_reviewer":
      return "admin";
    default:
      return "human-reviewer";
  }
}

/** DB candidate_status → 计算用于收件箱分组的实际状态 */
function mapToInboxStatus(dbStatus: string): ReviewPacketStatus {
  return mapCandidateStatus(dbStatus);
}

// ─── 上下文变量设置 ────────────────────────────────────────────────────────────

/**
 * 设置 PostgreSQL 会话上下文变量，用于 RLS 策略。
 * semantic.* 表的 RLS 使用 app.app_id 和 app.tenant_id。
 * 注意：SET LOCAL 仅在当前事务中有效。
 */
async function setSemanticScopeContext(client: SqlClient, scope: SemanticScope): Promise<void> {
  await client.query("SELECT pg_catalog.set_config('app.app_id', $1, true)", [scope.appId]);
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [scope.tenantId]);
  await client.query("SELECT pg_catalog.set_config('app.environment', $1, true)", [
    scope.environment,
  ]);
  await client.query("SELECT pg_catalog.set_config('app.semantic_domain', $1, true)", [
    scope.semanticDomain,
  ]);
}

// ─── 行类型 ────────────────────────────────────────────────────────────────────

interface DomainRow {
  semantic_domain: string;
  domain_display_name: string;
  domain_description: string | null;
  datasource_id: string;
  is_active: boolean;
  domain_version: number;
}

interface ReviewTaskRow {
  semantic_domain: string;
  packet_id: string;
  packet_kind: string;
  packet_digest: string;
  packet_payload: Record<string, unknown>;
  candidate_id: string | null;
  decision_window_status: string;
  review_outcome: string;
  decision_expires_at: string;
  publish_expires_at: string | null;
  created_at: string;
  created_by: string;
  closed_at: string | null;
  quorum_rules_snapshot: Record<string, unknown>;
}

interface InboxReviewTaskRow extends ReviewTaskRow {
  proposer_principal: string | null;
  candidate_status: string | null;
  quorum_current: number;
}

interface ReviewDecisionRow {
  decision_id: string;
  packet_id: string;
  principal: string;
  semantic_role: string;
  decision: string;
  decision_reason: string | null;
  decision_digest: string;
  created_at: string;
}

interface CandidateRow {
  candidate_id: string;
  proposer_principal: string;
  candidate_status: string;
  current_revision_id: string;
  created_at: string;
  updated_at: string;
}

interface CandidateRevisionRow {
  revision_id: string;
  revision_number: number;
  revision_payload: Record<string, unknown>;
  author_principal: string;
  change_description: string | null;
  change_class: string | null;
  created_at: string;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/** 从 packet_payload JSONB 安全提取字符串字段 */
function pluckString(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

/** 从 packet_payload JSONB 安全提取字符串数组 */
function pluckStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function requiredApprovals(snapshot: Record<string, unknown>): number {
  return (
    positiveInteger(snapshot.required_approvals) ?? positiveInteger(snapshot.min_reviewers) ?? 1
  );
}

async function buildSuccessorAuthorityEvidence(
  payload: Record<string, unknown>,
  packetDigest: string,
): Promise<SemanticSuccessorReviewAuthorityEvidence | undefined> {
  if (payload.schema_version !== "semantic-successor-review-packet@1.0.0") return undefined;
  const parsed = semanticSuccessorReviewPacketPayloadSchema.safeParse(payload);
  const parsedDigest = contentHashSchema.safeParse(packetDigest);
  if (!parsed.success || !parsedDigest.success) {
    throw governanceError("SEMANTIC_GOVERNANCE_UNAVAILABLE");
  }
  try {
    await verifySemanticChangeSet(parsed.data.change_set);
  } catch {
    throw governanceError("SEMANTIC_GOVERNANCE_UNAVAILABLE");
  }
  if ((await sha256ContentHash(parsed.data)) !== parsedDigest.data) {
    throw governanceError("SEMANTIC_GOVERNANCE_UNAVAILABLE");
  }
  return {
    schemaVersion: "semantic-successor-review-evidence@1.0.0",
    packetDigest: parsedDigest.data,
    packetPayload: parsed.data,
  };
}

function assertAuthorityMatches(
  authority: SemanticApplicationAuthority,
  capability: AppCapability,
): void {
  if (
    capability.scope.app_id !== authority.scope.appId ||
    capability.scope.tenant_id !== authority.scope.tenantId ||
    capability.scope.environment !== authority.scope.environment ||
    capability.deployment_id !== authority.deploymentId ||
    capability.principal !== authority.principal ||
    (authority.scope.semanticDomain !== "all" &&
      !authority.allowedDomains.includes(authority.scope.semanticDomain))
  ) {
    throw governanceError("SEMANTIC_SCOPE_FORBIDDEN");
  }
}

function inputDomainMatches(
  authority: SemanticApplicationAuthority,
  semanticDomain: string,
): boolean {
  return authority.scope.semanticDomain === semanticDomain;
}

function authorizedReadDomains(authority: SemanticApplicationAuthority): readonly string[] {
  return authority.scope.semanticDomain === "all"
    ? authority.allowedDomains
    : [authority.scope.semanticDomain];
}

function mapSemanticDatabaseError(error: unknown): PortResult<never> | null {
  if (error instanceof SemanticGovernanceAdapterError) {
    const code = isGovernanceErrorCode(error.code) ? error.code : "SEMANTIC_GOVERNANCE_UNAVAILABLE";
    return {
      ok: false,
      error: {
        code,
        message: governanceError(code).message,
        retryable: error.retryable,
      },
    };
  }

  const candidate =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown; readonly message?: unknown })
      : null;
  const marker =
    typeof candidate?.message === "string"
      ? candidate.message.match(/SEMANTIC_[A-Z][A-Z0-9_]{1,126}/)?.[0]
      : undefined;
  const markerMapping: Record<string, readonly [GovernanceErrorCode, boolean]> = {
    SEMANTIC_CANDIDATE_INVALID: ["SEMANTIC_CANDIDATE_INVALID", false],
    SEMANTIC_CANDIDATE_IDEMPOTENCY_CONFLICT: ["SEMANTIC_CANDIDATE_CONFLICT", false],
    SEMANTIC_SCOPE_FORBIDDEN: ["SEMANTIC_SCOPE_FORBIDDEN", false],
    SEMANTIC_REVIEWER_REQUIRED: ["SEMANTIC_SCOPE_FORBIDDEN", false],
    SEMANTIC_PUBLISH_CONFLICT: ["SEMANTIC_PUBLISH_CONFLICT", true],
    SEMANTIC_ROLLBACK_CONFLICT: ["SEMANTIC_PUBLISH_CONFLICT", true],
    SEMANTIC_CANDIDATE_NOT_PUBLISHED: ["SEMANTIC_PUBLISH_CONFLICT", true],
    SEMANTIC_CANDIDATE_DIGEST_COLLISION: ["SEMANTIC_GOVERNANCE_UNAVAILABLE", true],
  };
  const markerMappingEntry = marker ? markerMapping[marker] : undefined;
  if (markerMappingEntry) {
    const [code, retryable] = markerMappingEntry;
    const mapped = governanceError(code, retryable);
    return {
      ok: false,
      error: { code: mapped.code, message: mapped.message, retryable },
    };
  }
  if (candidate?.code === "40001") {
    const mapped = governanceError("SEMANTIC_PUBLISH_CONFLICT");
    return {
      ok: false,
      error: { code: mapped.code, message: mapped.message, retryable: true },
    };
  }
  if (candidate?.code === "42501") {
    const mapped = governanceError("SEMANTIC_SCOPE_FORBIDDEN");
    return {
      ok: false,
      error: { code: mapped.code, message: mapped.message, retryable: false },
    };
  }
  return null;
}

// ─── 服务实现 ──────────────────────────────────────────────────────────────────

export class PostgresSemanticGovernanceService implements SemanticGovernancePort {
  private readonly pool: SqlPool;

  constructor(
    poolOrPgPool: SqlPool | pg.Pool,
    private readonly authorizer: TransactionalCapabilityAuthorizer,
  ) {
    this.pool = "connect" in poolOrPgPool ? poolOrPgPool : adaptPgPool(poolOrPgPool);
  }

  private async transaction<T>(
    authority: SemanticApplicationAuthority,
    access: "READ" | "WRITE",
    allowedRoles: readonly AppCapabilityRole[],
    operationName: string,
    work: (client: SqlClient, scope: SemanticScope, capability: AppCapability) => Promise<T>,
  ): Promise<PortResult<T>> {
    return withAppTransaction(
      this.pool,
      this.authorizer,
      authority.capabilityInput,
      {
        access,
        operation_name: operationName,
        map_database_error: mapSemanticDatabaseError,
      },
      async ({ client, capability }) => {
        assertAuthorityMatches(authority, capability);
        if (!allowedRoles.includes(capability.role)) {
          throw governanceError("SEMANTIC_SCOPE_FORBIDDEN");
        }
        await setSemanticScopeContext(client, authority.scope);
        return work(client, authority.scope, capability);
      },
    );
  }

  // ── listDomains ───────────────────────────────────────────────────────────────

  async listDomains(
    authority: SemanticApplicationAuthority,
  ): Promise<PortResult<readonly DomainInfo[]>> {
    return this.transaction(
      authority,
      "READ",
      ["OWNER", "ANALYST", "VIEWER"],
      "semantic.list-domains",
      async (client, scope) => {
        const result = await client.query<DomainRow>(
          `SELECT semantic_domain, domain_display_name, domain_description,
                datasource_id::text, is_active, domain_version
         FROM semantic.semantic_domain_registry
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND ($4 = 'all' OR semantic_domain = $4)`,
          [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain],
        );

        return result.rows
          .filter((row) => authority.allowedDomains.includes(row.semantic_domain))
          .map((row) => ({
            domain: row.semantic_domain,
            displayName: row.domain_display_name,
            description: row.domain_description ?? "",
            datasourceId: row.datasource_id,
            isActive: row.is_active,
            domainVersion: row.domain_version,
          }));
      },
    );
  }

  // ── getInboxItems ─────────────────────────────────────────────────────────────

  async getInboxItems(
    authority: SemanticApplicationAuthority,
    group: InboxGroup,
  ): Promise<PortResult<readonly InboxItem[]>> {
    return this.transaction(
      authority,
      "READ",
      ["OWNER", "ANALYST", "VIEWER"],
      "semantic.get-inbox-items",
      async (client, scope) => {
        let items: InboxItem[];
        const semanticDomains = authorizedReadDomains(authority);

        switch (group) {
          case "my-decision": {
            // OPEN packets where the user hasn't decided yet
            const result = await client.query<InboxReviewTaskRow>(
              `SELECT task.semantic_domain, task.packet_id, task.packet_kind, task.packet_digest,
                    task.packet_payload, task.quorum_rules_snapshot,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status,
                    (SELECT pg_catalog.count(*) FILTER (WHERE decision.decision = 'APPROVE')::integer
                       FROM semantic.semantic_review_decision decision
                      WHERE decision.app_id = task.app_id
                        AND decision.tenant_id = task.tenant_id
                        AND decision.environment = task.environment
                        AND decision.semantic_domain = task.semantic_domain
                        AND decision.packet_id = task.packet_id) AS quorum_current
             FROM semantic.semantic_review_task task
             LEFT JOIN semantic.semantic_candidate cand
               ON cand.app_id = task.app_id
              AND cand.tenant_id = task.tenant_id
              AND cand.environment = task.environment
              AND cand.semantic_domain = task.semantic_domain
              AND cand.candidate_id = task.candidate_id
             WHERE task.app_id = $1::uuid
               AND task.tenant_id = $2::uuid
               AND task.environment = $3
               AND task.semantic_domain = ANY($4::text[])
               AND task.decision_window_status = 'OPEN'
               AND NOT EXISTS (
                 SELECT 1 FROM semantic.semantic_review_decision own_decision
                 WHERE own_decision.app_id = task.app_id
                   AND own_decision.tenant_id = task.tenant_id
                   AND own_decision.environment = task.environment
                   AND own_decision.semantic_domain = task.semantic_domain
                   AND own_decision.packet_id = task.packet_id
                   AND own_decision.principal = $5
               )
             ORDER BY task.created_at DESC`,
              [
                scope.appId,
                scope.tenantId,
                scope.environment,
                semanticDomains,
                authority.principal,
              ],
            );
            items = result.rows.map((row) => buildInboxItem(row, "my-decision"));
            break;
          }
          case "waiting-others": {
            // OPEN packets with at least one decision
            const result = await client.query<InboxReviewTaskRow>(
              `SELECT task.semantic_domain, task.packet_id, task.packet_kind, task.packet_digest,
                    task.packet_payload, task.quorum_rules_snapshot,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status,
                    (SELECT pg_catalog.count(*) FILTER (WHERE decision.decision = 'APPROVE')::integer
                       FROM semantic.semantic_review_decision decision
                      WHERE decision.app_id = task.app_id
                        AND decision.tenant_id = task.tenant_id
                        AND decision.environment = task.environment
                        AND decision.semantic_domain = task.semantic_domain
                        AND decision.packet_id = task.packet_id) AS quorum_current
             FROM semantic.semantic_review_task task
             LEFT JOIN semantic.semantic_candidate cand
               ON cand.app_id = task.app_id
              AND cand.tenant_id = task.tenant_id
              AND cand.environment = task.environment
              AND cand.semantic_domain = task.semantic_domain
              AND cand.candidate_id = task.candidate_id
             WHERE task.app_id = $1::uuid
               AND task.tenant_id = $2::uuid
               AND task.environment = $3
               AND task.semantic_domain = ANY($4::text[])
               AND task.decision_window_status = 'OPEN'
               AND task.review_outcome = 'PENDING'
               AND EXISTS (
                 SELECT 1 FROM semantic.semantic_review_decision dec
                 WHERE dec.app_id = task.app_id
                   AND dec.tenant_id = task.tenant_id
                   AND dec.environment = task.environment
                   AND dec.semantic_domain = task.semantic_domain
                   AND dec.packet_id = task.packet_id
               )
             ORDER BY task.created_at DESC`,
              [scope.appId, scope.tenantId, scope.environment, semanticDomains],
            );
            items = result.rows.map((row) => buildInboxItem(row, "waiting-others"));
            break;
          }
          case "expiring": {
            // OPEN packets expiring within 24 hours
            const result = await client.query<InboxReviewTaskRow>(
              `SELECT task.semantic_domain, task.packet_id, task.packet_kind, task.packet_digest,
                    task.packet_payload, task.quorum_rules_snapshot,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status,
                    (SELECT pg_catalog.count(*) FILTER (WHERE decision.decision = 'APPROVE')::integer
                       FROM semantic.semantic_review_decision decision
                      WHERE decision.app_id = task.app_id
                        AND decision.tenant_id = task.tenant_id
                        AND decision.environment = task.environment
                        AND decision.semantic_domain = task.semantic_domain
                        AND decision.packet_id = task.packet_id) AS quorum_current
             FROM semantic.semantic_review_task task
             LEFT JOIN semantic.semantic_candidate cand
               ON cand.app_id = task.app_id
              AND cand.tenant_id = task.tenant_id
              AND cand.environment = task.environment
              AND cand.semantic_domain = task.semantic_domain
              AND cand.candidate_id = task.candidate_id
             WHERE task.app_id = $1::uuid
               AND task.tenant_id = $2::uuid
               AND task.environment = $3
               AND task.semantic_domain = ANY($4::text[])
               AND task.decision_window_status = 'OPEN'
               AND task.decision_expires_at < NOW() + INTERVAL '24 hours'
             ORDER BY task.decision_expires_at ASC`,
              [scope.appId, scope.tenantId, scope.environment, semanticDomains],
            );
            items = result.rows.map((row) => buildInboxItem(row, "expiring"));
            break;
          }
          case "completed": {
            // CLOSED packets
            const result = await client.query<InboxReviewTaskRow>(
              `SELECT task.semantic_domain, task.packet_id, task.packet_kind, task.packet_digest,
                    task.packet_payload, task.quorum_rules_snapshot,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status,
                    (SELECT pg_catalog.count(*) FILTER (WHERE decision.decision = 'APPROVE')::integer
                       FROM semantic.semantic_review_decision decision
                      WHERE decision.app_id = task.app_id
                        AND decision.tenant_id = task.tenant_id
                        AND decision.environment = task.environment
                        AND decision.semantic_domain = task.semantic_domain
                        AND decision.packet_id = task.packet_id) AS quorum_current
             FROM semantic.semantic_review_task task
             LEFT JOIN semantic.semantic_candidate cand
               ON cand.app_id = task.app_id
              AND cand.tenant_id = task.tenant_id
              AND cand.environment = task.environment
              AND cand.semantic_domain = task.semantic_domain
              AND cand.candidate_id = task.candidate_id
             WHERE task.app_id = $1::uuid
               AND task.tenant_id = $2::uuid
               AND task.environment = $3
               AND task.semantic_domain = ANY($4::text[])
               AND task.decision_window_status = 'CLOSED'
             ORDER BY task.closed_at DESC`,
              [scope.appId, scope.tenantId, scope.environment, semanticDomains],
            );
            items = result.rows.map((row) => buildInboxItem(row, "completed"));
            break;
          }
          default:
            items = [];
        }

        return items;
      },
    );
  }

  // ── getPacketDetail ───────────────────────────────────────────────────────────

  async getPacketDetail(
    authority: SemanticApplicationAuthority,
    packetId: string,
  ): Promise<PortResult<SemanticReviewPacket>> {
    return this.transaction(
      authority,
      "READ",
      ["OWNER", "ANALYST", "VIEWER"],
      "semantic.get-packet-detail",
      async (client, scope) => {
        const semanticDomains = authorizedReadDomains(authority);
        // 1. Get review task
        const taskResult = await client.query<ReviewTaskRow>(
          `SELECT semantic_domain, packet_id, packet_kind, packet_digest, packet_payload,
                candidate_id, decision_window_status,
                review_outcome, decision_expires_at,
                publish_expires_at, created_at,
                created_by, closed_at, quorum_rules_snapshot
         FROM semantic.semantic_review_task
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = ANY($4::text[])
           AND packet_id = $5::uuid
         ORDER BY semantic_domain
         LIMIT 2`,
          [scope.appId, scope.tenantId, scope.environment, semanticDomains, packetId],
        );

        if (taskResult.rows.length === 0) {
          throw governanceError("SEMANTIC_PACKET_NOT_FOUND");
        }
        if (taskResult.rows.length !== 1) {
          throw governanceError("SEMANTIC_GOVERNANCE_UNAVAILABLE");
        }

        const task = taskResult.rows[0] as NonNullable<(typeof taskResult.rows)[0]>;
        const semanticDomain = task.semantic_domain;
        const payload = task.packet_payload;
        const authorityEvidence = await buildSuccessorAuthorityEvidence(
          payload,
          task.packet_digest,
        );

        // 2. Get candidate info if available
        let candidateStatus: string | null = null;
        let proposerPrincipal = task.created_by;
        if (task.candidate_id) {
          const candResult = await client.query<CandidateRow>(
            `SELECT candidate_id, proposer_principal, candidate_status, current_revision_id, created_at, updated_at
           FROM semantic.semantic_candidate
           WHERE app_id = $1::uuid
             AND tenant_id = $2::uuid
             AND environment = $3
             AND semantic_domain = $4
             AND candidate_id = $5::uuid`,
            [scope.appId, scope.tenantId, scope.environment, semanticDomain, task.candidate_id],
          );
          if (candResult.rows.length > 0) {
            candidateStatus = candResult.rows[0]?.candidate_status ?? null;
            proposerPrincipal = candResult.rows[0]?.proposer_principal ?? proposerPrincipal;
          }
        }

        // 3. Get decisions
        const decResult = await client.query<ReviewDecisionRow>(
          `SELECT decision_id, packet_id, principal, semantic_role,
                decision, decision_reason, decision_digest, created_at
         FROM semantic.semantic_review_decision
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = $4
           AND packet_id = $5::uuid
         ORDER BY created_at ASC`,
          [scope.appId, scope.tenantId, scope.environment, semanticDomain, packetId],
        );

        // 4. Get candidate revisions if available
        let revisions: RevisionRecord[] = [];
        if (task.candidate_id) {
          const revResult = await client.query<CandidateRevisionRow>(
            `SELECT revision_id, revision_number, revision_payload,
                  author_principal, change_description, change_class, created_at
           FROM semantic.semantic_candidate_revision
           WHERE app_id = $1::uuid
             AND tenant_id = $2::uuid
             AND environment = $3
             AND semantic_domain = $4
             AND candidate_id = $5::uuid
           ORDER BY revision_number ASC`,
            [scope.appId, scope.tenantId, scope.environment, semanticDomain, task.candidate_id],
          );
          revisions = revResult.rows.map((row) => ({
            version: row.revision_number,
            author: row.author_principal,
            authorId: row.author_principal,
            comment: row.change_description ?? "",
            createdAt: row.created_at,
            diff: buildDiff(row.revision_payload),
          }));
        }

        // 5. Build packet detail
        const status = candidateStatus
          ? mapCandidateStatus(candidateStatus)
          : mapReviewOutcome(task.review_outcome) === "approved"
            ? "approved-not-published"
            : "candidate";

        const decisions: ReviewDecisionRecord[] = decResult.rows.map((row) => ({
          reviewerId: row.principal,
          reviewerName: row.principal,
          decision: row.decision === "APPROVE" ? "approved" : "rejected",
          decidedAt: row.created_at,
          ...(row.decision_reason === null ? {} : { comment: row.decision_reason }),
          reauthenticated: false,
        }));

        const reviewers: Reviewer[] = [
          // Deduplicate: reviewers from decision rows + any from payload
          ...decisions.map((d) => ({
            id: d.reviewerId,
            name: d.reviewerName,
            decision: d.decision,
            decidedAt: d.decidedAt,
            ...(d.comment === undefined ? {} : { comment: d.comment }),
          })),
        ];

        const diff = buildDiff(payload);
        const impact = buildImpact(payload);

        const packet: SemanticReviewPacket = {
          id: task.packet_id,
          version: revisions.length > 0 ? (revisions.at(-1)?.version ?? 1) : 1,
          title: pluckString(payload, "title", "未命名提案"),
          description: pluckString(payload, "description"),
          domain: semanticDomain,
          changeClass: pluckString(payload, "changeClass", "other") as ChangeClass,
          riskLevel: pluckString(payload, "riskLevel", "medium") as RiskLevel,
          status,
          createdAt: task.created_at,
          updatedAt: task.closed_at ?? task.created_at,
          expiresAt: task.decision_expires_at,
          proposer: {
            id: proposerPrincipal,
            name: proposerPrincipal,
          },
          reviewers,
          quorum: {
            required: requiredApprovals(task.quorum_rules_snapshot),
            current: decisions.filter((decision) => decision.decision === "approved").length,
          },
          decisions,
          diff,
          impact,
          lineage: buildLineage(task, candidateStatus),
          revisions,
          ...(authorityEvidence === undefined ? {} : { authorityEvidence }),
        };

        return packet;
      },
    );
  }

  // ── submitDecision ────────────────────────────────────────────────────────────

  async submitDecision(
    authority: SemanticApplicationAuthority,
    input: SemanticDecisionInput,
  ): Promise<PortResult<DecisionResult>> {
    if (!inputDomainMatches(authority, input.semantic_domain)) {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_SCOPE_FORBIDDEN",
          message: GOVERNANCE_ERRORS.SEMANTIC_SCOPE_FORBIDDEN,
          retryable: false,
        },
      };
    }
    return this.transaction(
      authority,
      "WRITE",
      ["OWNER", "ANALYST"],
      "semantic.submit-decision",
      async (client, scope, capability) => {
        // Map frontend decision to DB decision
        const dbDecision = input.decision;
        const dbRole = capability.role === "OWNER" ? "admin_reviewer" : "domain_reviewer";

        const result = await client.query<{
          human_record_semantic_review_decision: Record<string, unknown>;
        }>("SELECT semantic.human_record_semantic_review_decision($1::jsonb)", [
          {
            schema_version: "human-semantic-review-decision@1.0.0",
            scope: {
              app_id: scope.appId,
              tenant_id: scope.tenantId,
              workspace_id: scope.tenantId,
              environment: scope.environment,
            },
            semantic_domain: scope.semanticDomain,
            packet_id: input.packet_id,
            principal_id: capability.principal,
            semantic_role: dbRole,
            decision: dbDecision,
            decision_reason: input.decision_reason ?? null,
          },
        ]);

        const rpcResult = result.rows[0]?.human_record_semantic_review_decision;
        if (!rpcResult) {
          throw new SemanticGovernanceAdapterError("RPC_FAILED", "审核决策 RPC 调用失败", 500);
        }

        return {
          decisionId: rpcResult.decision_id as string,
          decisionDigest: rpcResult.decision_digest as string,
          packetClosed: (rpcResult.packet_closed ?? false) as boolean,
          outcome: (rpcResult.outcome ?? "PENDING") as "APPROVED" | "VETOED" | "PENDING",
          totalApprovals: (rpcResult.total_approvals as number) ?? 0,
          totalRejections: (rpcResult.total_rejections as number) ?? 0,
          ...(typeof rpcResult.required_approvals === "number"
            ? { requiredApprovals: rpcResult.required_approvals }
            : {}),
          ...(typeof rpcResult.decision_set_digest === "string"
            ? { decisionSetDigest: rpcResult.decision_set_digest }
            : {}),
        };
      },
    );
  }

  // ── createCandidate ───────────────────────────────────────────────────────────

  async createCandidate(
    authority: SemanticApplicationAuthority,
    input: SemanticCandidateDraft,
  ): Promise<PortResult<SemanticCandidateCreateResult>> {
    if (!inputDomainMatches(authority, input.semantic_domain)) {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_SCOPE_FORBIDDEN",
          message: GOVERNANCE_ERRORS.SEMANTIC_SCOPE_FORBIDDEN,
          retryable: false,
        },
      };
    }
    return this.transaction(
      authority,
      "WRITE",
      ["OWNER", "ANALYST"],
      "semantic.create-candidate",
      async (client, scope, capability) => {
        const result = await client.query<{ create_candidate_draft: unknown }>(
          `select semantic.create_candidate_draft(
             $1::uuid, $2::uuid, $3::text, $4::text,
             $5::text, $6::uuid, $7::text, $8::text,
             $9::text, $10::text, $11::jsonb, $12::jsonb
           )`,
          [
            scope.appId,
            scope.tenantId,
            scope.environment,
            scope.semanticDomain,
            capability.principal,
            input.idempotency_key,
            input.title,
            input.description,
            input.change_class,
            input.risk_level,
            JSON.stringify(input.source_payload),
            JSON.stringify(input.diff),
          ],
        );
        const rpcResult = result.rows[0]?.create_candidate_draft;
        const parsed = semanticCandidateCreateResultSchema.safeParse({
          ...(typeof rpcResult === "object" && rpcResult !== null ? rpcResult : {}),
          schema_version: "semantic-candidate-create-result@1.0.0",
          authority: "POSTGRESQL",
        });
        if (!parsed.success) {
          throw governanceError("SEMANTIC_GOVERNANCE_UNAVAILABLE", true);
        }
        return parsed.data;
      },
    );
  }

  // ── preparePublish ────────────────────────────────────────────────────────────

  async preparePublish(
    authority: SemanticApplicationAuthority,
    input: SemanticPreparePublishInput,
  ): Promise<PortResult<{ attemptId: string }>> {
    if (!inputDomainMatches(authority, input.semantic_domain)) {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_SCOPE_FORBIDDEN",
          message: GOVERNANCE_ERRORS.SEMANTIC_SCOPE_FORBIDDEN,
          retryable: false,
        },
      };
    }
    return this.transaction(
      authority,
      "WRITE",
      ["OWNER"],
      "semantic.prepare-publish",
      async (client, scope) => {
        // Get candidate_id from the review task
        const taskResult = await client.query<{ candidate_id: string | null }>(
          `SELECT candidate_id
         FROM semantic.semantic_review_task
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = $4
           AND packet_id = $5::uuid`,
          [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, input.packet_id],
        );

        if (taskResult.rows.length === 0) {
          throw new SemanticGovernanceAdapterError("PACKET_NOT_FOUND", "审核包不存在", 404);
        }

        const candidateId = taskResult.rows[0]?.candidate_id;
        if (!candidateId) {
          throw new SemanticGovernanceAdapterError("NO_CANDIDATE", "审核包没有关联的提案", 400);
        }

        const command = {
          schema_version: "human-prepare-publish-attempt@1.0.0",
          scope: {
            app_id: scope.appId,
            tenant_id: scope.tenantId,
            workspace_id: scope.tenantId,
            environment: scope.environment,
          },
          semantic_domain: scope.semanticDomain,
          packet_id: input.packet_id,
          candidate_id: candidateId,
          compiler_bundle_digest: input.compiler_bundle_digest,
          catalog_fence_epoch: input.catalog_epoch,
          dependency_generation: input.dependency_generation,
          target_generation: input.target_generation,
          idempotency_digest: input.idempotency_digest,
        };
        const result = await client.query<{ prepare_publish_attempt: Record<string, unknown> }>(
          "select semantic.human_prepare_publish_attempt($1::jsonb) as prepare_publish_attempt",
          [command],
        );

        const rpcResult = result.rows[0]?.prepare_publish_attempt;
        if (!rpcResult) {
          throw new SemanticGovernanceAdapterError("RPC_FAILED", "准备发布 RPC 调用失败", 500);
        }

        return { attemptId: rpcResult.attempt_id as string };
      },
    );
  }

  // ── commitPublish ─────────────────────────────────────────────────────────────

  async commitPublish(
    authority: SemanticApplicationAuthority,
    input: SemanticCommitPublishInput,
  ): Promise<PortResult<{ releaseId: string }>> {
    if (!inputDomainMatches(authority, input.semantic_domain)) {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_SCOPE_FORBIDDEN",
          message: GOVERNANCE_ERRORS.SEMANTIC_SCOPE_FORBIDDEN,
          retryable: false,
        },
      };
    }
    return this.transaction(
      authority,
      "WRITE",
      ["OWNER"],
      "semantic.commit-publish",
      async (client, scope) => {
        // Verify the exact PREPARED attempt belongs to this packet.
        const attemptResult = await client.query<{ attempt_id: string }>(
          `SELECT attempt_id
         FROM semantic.semantic_publish_attempt
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = $4
           AND packet_id = $5::uuid
           AND attempt_id = $6::uuid
           AND attempt_state = 'PREPARED'
         LIMIT 1`,
          [
            scope.appId,
            scope.tenantId,
            scope.environment,
            scope.semanticDomain,
            input.packet_id,
            input.attempt_id,
          ],
        );

        if (attemptResult.rows.length === 0) {
          throw new SemanticGovernanceAdapterError("NO_ATTEMPT", "没有找到准备好的发布尝试", 400);
        }

        const command = {
          schema_version: "human-commit-publish-attempt@1.0.0",
          scope: {
            app_id: scope.appId,
            tenant_id: scope.tenantId,
            workspace_id: scope.tenantId,
            environment: scope.environment,
          },
          semantic_domain: scope.semanticDomain,
          attempt_id: input.attempt_id,
          executable_projection_ref: input.executable_projection_ref,
          executable_projection_hash: input.executable_projection_hash,
          relationship_projection_ref: input.relationship_projection_ref,
          relationship_projection_hash: input.relationship_projection_hash,
          runtime_restriction_projection_ref: input.runtime_restriction_projection_ref,
          runtime_restriction_projection_hash: input.runtime_restriction_projection_hash,
          profile_child_manifest: input.profile_child_manifest ?? null,
        };
        const result = await client.query<{ commit_publish_attempt: Record<string, unknown> }>(
          "select semantic.human_commit_publish_attempt($1::jsonb) as commit_publish_attempt",
          [command],
        );

        const rpcResult = result.rows[0]?.commit_publish_attempt;
        if (!rpcResult) {
          throw new SemanticGovernanceAdapterError("RPC_FAILED", "执行发布 RPC 调用失败", 500);
        }

        return { releaseId: rpcResult.release_id as string };
      },
    );
  }

  // ── executeRollback ───────────────────────────────────────────────────────────

  async executeRollback(
    authority: SemanticApplicationAuthority,
    input: SemanticRollbackInput,
  ): Promise<PortResult<{ receiptId: string }>> {
    if (!inputDomainMatches(authority, input.semantic_domain)) {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_SCOPE_FORBIDDEN",
          message: GOVERNANCE_ERRORS.SEMANTIC_SCOPE_FORBIDDEN,
          retryable: false,
        },
      };
    }
    return this.transaction(
      authority,
      "WRITE",
      ["OWNER"],
      "semantic.execute-rollback",
      async (client, scope) => {
        const command = {
          schema_version: "human-execute-rollback@1.0.0",
          scope: {
            app_id: scope.appId,
            tenant_id: scope.tenantId,
            workspace_id: scope.tenantId,
            environment: scope.environment,
          },
          semantic_domain: scope.semanticDomain,
          authorization_id: input.authorization_id,
          nonce: input.authorization_nonce,
          rollback_reason: input.rollback_reason,
        };
        const result = await client.query<{ execute_rollback: Record<string, unknown> }>(
          "select semantic.human_execute_rollback($1::jsonb) as execute_rollback",
          [command],
        );

        const rpcResult = result.rows[0]?.execute_rollback;
        if (!rpcResult) {
          throw new SemanticGovernanceAdapterError("RPC_FAILED", "执行回滚 RPC 调用失败", 500);
        }

        return { receiptId: rpcResult.receipt_id as string };
      },
    );
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function buildInboxItem(row: InboxReviewTaskRow, group: InboxGroup): InboxItem {
  const payload = row.packet_payload;
  const status = row.candidate_status ? mapToInboxStatus(row.candidate_status) : "candidate";

  return {
    packetId: row.packet_id,
    title: pluckString(payload, "title", "未命名提案"),
    domain: row.semantic_domain,
    changeClass: pluckString(payload, "changeClass", "other") as ChangeClass,
    riskLevel: pluckString(payload, "riskLevel", "medium") as RiskLevel,
    status,
    createdAt: row.created_at,
    expiresAt: row.decision_expires_at,
    proposer: row.proposer_principal ?? row.created_by,
    quorum: {
      required: requiredApprovals(row.quorum_rules_snapshot),
      current: row.quorum_current,
    },
    currentDecision: mapReviewOutcome(row.review_outcome),
    group,
  };
}

function buildDiff(payload: Record<string, unknown>): SemanticDiff {
  const successor = successorChangeSetForDisplay(payload);
  if (successor) {
    return {
      summary: `Forward successor ${successor.change_set_id} contains ${successor.assertions.length} frozen assertions; base generation ${successor.base_release.generation}; validation ${successor.validation.outcome}.`,
      additions: successor.assertions.map((assertion) => ({
        path: assertion.canonical_key,
        after: JSON.stringify(assertion),
        changeType: "added" as const,
      })),
      modifications: [],
      deletions: [],
    };
  }
  const diff = payload.diff as Record<string, unknown> | undefined;
  return {
    summary: pluckString(diff ?? {}, "summary", "无变更摘要"),
    additions: (diff?.additions as DiffEntry[]) ?? [],
    modifications: (diff?.modifications as DiffEntry[]) ?? [],
    deletions: (diff?.deletions as DiffEntry[]) ?? [],
  };
}

function buildImpact(payload: Record<string, unknown>): ImpactAnalysis {
  const successor = successorChangeSetForDisplay(payload);
  if (successor) {
    return {
      affectedQueries: successor.competency_results.map((result) => result.case_id),
      affectedEvals: successor.competency_results.map((result) => result.case_id),
      affectedMetrics: successor.assertions
        .filter((assertion) => assertion.target_kind === "METRIC")
        .map((assertion) => assertion.canonical_key),
      breakingChanges: true,
      summary: `Critical generation+1 authority transition from ${successor.base_release.release_id}; exact ChangeSet hash ${successor.change_set_hash}.`,
    };
  }
  const impact = payload.impact as Record<string, unknown> | undefined;
  return {
    affectedQueries: pluckStringArray(impact ?? {}, "affectedQueries"),
    affectedEvals: pluckStringArray(impact ?? {}, "affectedEvals"),
    affectedMetrics: pluckStringArray(impact ?? {}, "affectedMetrics"),
    breakingChanges: (impact?.breakingChanges as boolean) ?? false,
    summary: pluckString(impact ?? {}, "summary", "无影响分析"),
  };
}

function successorChangeSetForDisplay(payload: Record<string, unknown>) {
  const direct = semanticChangeSetSchema.safeParse(payload);
  if (direct.success) return direct.data;
  const nested = semanticChangeSetSchema.safeParse(payload.change_set);
  return nested.success ? nested.data : null;
}

function buildLineage(task: ReviewTaskRow, candidateStatus: string | null): LineageRecord[] {
  const lineage: LineageRecord[] = [
    {
      version: 1,
      action: "created",
      actor: task.created_by,
      timestamp: task.created_at,
      comment: "初始提案",
    },
  ];

  if (task.decision_window_status === "CLOSED") {
    const outcome = task.review_outcome;
    if (outcome === "APPROVED") {
      lineage.push({
        version: 2,
        action: "approved",
        actor: "system",
        timestamp: task.closed_at ?? task.created_at,
        comment: "审核通过",
      });
    } else if (outcome === "VETOED") {
      lineage.push({
        version: 2,
        action: "rejected",
        actor: "system",
        timestamp: task.closed_at ?? task.created_at,
        comment: "审核被否决",
      });
    } else if (outcome === "EXPIRED") {
      lineage.push({
        version: 2,
        action: "rejected",
        actor: "system",
        timestamp: task.closed_at ?? task.created_at,
        comment: "决策窗口过期",
      });
    }

    if (candidateStatus === "PUBLISHED") {
      lineage.push({
        version: 3,
        action: "published",
        actor: "system",
        timestamp: task.closed_at ?? task.created_at,
        comment: "已发布",
      });
    }
  }

  return lineage;
}

// ─── 重新导出用于类型检查的辅助函数 ────────────────────────────────────────────
export { mapCandidateStatus, mapReviewOutcome, mapSemanticRole };
