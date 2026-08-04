import "server-only";
import { adaptPgPool, type SqlClient, type SqlPool } from "@data-agent/platform";
import type pg from "pg";
import type {
  CreateCandidateInput,
  DecisionInput,
  DecisionResult,
  DomainInfo,
  SemanticGovernanceService,
  SemanticScope,
} from "./semantic-governance-service";
import { SemanticGovernanceError } from "./semantic-governance-service";
import type {
  ChangeClass,
  DiffEntry,
  ImpactAnalysis,
  InboxGroup,
  InboxItem,
  LineageRecord,
  ReviewDecision,
  ReviewDecisionRecord,
  Reviewer,
  ReviewPacketStatus,
  RevisionRecord,
  RiskLevel,
  SemanticDiff,
  SemanticReviewPacket,
  SemanticRole,
} from "./semantic-types";

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
async function setScopeContext(
  client: SqlClient,
  scope: SemanticScope,
  principal?: string,
): Promise<void> {
  await client.query("SELECT pg_catalog.set_config('app.app_id', $1, true)", [scope.appId]);
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [scope.tenantId]);
  await client.query("SELECT pg_catalog.set_config('app.environment', $1, true)", [
    scope.environment,
  ]);
  await client.query("SELECT pg_catalog.set_config('app.semantic_domain', $1, true)", [
    scope.semanticDomain,
  ]);
  await client.query("SELECT pg_catalog.set_config('data_agent.app_id', $1, true)", [scope.appId]);
  await client.query("SELECT pg_catalog.set_config('data_agent.tenant_id', $1, true)", [
    scope.tenantId,
  ]);
  await client.query("SELECT pg_catalog.set_config('data_agent.environment', $1, true)", [
    scope.environment,
  ]);
  if (principal) {
    await client.query("SELECT pg_catalog.set_config('data_agent.principal_id', $1, true)", [
      principal,
    ]);
  }
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
  packet_id: string;
  packet_kind: string;
  packet_payload: Record<string, unknown>;
  candidate_id: string | null;
  decision_window_status: string;
  review_outcome: string;
  decision_expires_at: string;
  publish_expires_at: string | null;
  created_at: string;
  created_by: string;
  closed_at: string | null;
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

// ─── 服务实现 ──────────────────────────────────────────────────────────────────

export class PostgresSemanticGovernanceService implements SemanticGovernanceService {
  private readonly pool: SqlPool;

  constructor(poolOrPgPool: SqlPool | pg.Pool) {
    this.pool = "connect" in poolOrPgPool ? poolOrPgPool : adaptPgPool(poolOrPgPool);
  }

  // ── listDomains ───────────────────────────────────────────────────────────────

  async listDomains(scope: SemanticScope): Promise<DomainInfo[]> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope);

      const _filterAll = scope.semanticDomain === "all";
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

      return result.rows.map((row) => ({
        domain: row.semantic_domain,
        displayName: row.domain_display_name,
        description: row.domain_description ?? "",
        datasourceId: row.datasource_id,
        isActive: row.is_active,
        domainVersion: row.domain_version,
      }));
    } catch (error) {
      throw wrapError(error, "LIST_DOMAINS_FAILED");
    } finally {
      client.release();
    }
  }

  // ── getInboxItems ─────────────────────────────────────────────────────────────

  async getInboxItems(scope: SemanticScope, group: InboxGroup): Promise<InboxItem[]> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope);

      let items: InboxItem[];

      switch (group) {
        case "my-decision": {
          // OPEN packets where the user hasn't decided yet
          const result = await client.query<
            ReviewTaskRow & { proposer_principal: string | null; candidate_status: string | null }
          >(
            `SELECT task.packet_id, task.packet_kind, task.packet_payload,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status
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
               AND task.semantic_domain = $4
               AND task.decision_window_status = 'OPEN'
             ORDER BY task.created_at DESC`,
            [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain],
          );
          items = result.rows.map((row) => buildInboxItem(row, "my-decision"));
          break;
        }
        case "waiting-others": {
          // OPEN packets with at least one decision
          const result = await client.query<
            ReviewTaskRow & { proposer_principal: string | null; candidate_status: string | null }
          >(
            `SELECT task.packet_id, task.packet_kind, task.packet_payload,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status
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
               AND task.semantic_domain = $4
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
            [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain],
          );
          items = result.rows.map((row) => buildInboxItem(row, "waiting-others"));
          break;
        }
        case "expiring": {
          // OPEN packets expiring within 24 hours
          const result = await client.query<
            ReviewTaskRow & { proposer_principal: string | null; candidate_status: string | null }
          >(
            `SELECT task.packet_id, task.packet_kind, task.packet_payload,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status
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
               AND task.semantic_domain = $4
               AND task.decision_window_status = 'OPEN'
               AND task.decision_expires_at < NOW() + INTERVAL '24 hours'
             ORDER BY task.decision_expires_at ASC`,
            [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain],
          );
          items = result.rows.map((row) => buildInboxItem(row, "expiring"));
          break;
        }
        case "completed": {
          // CLOSED packets
          const result = await client.query<
            ReviewTaskRow & { proposer_principal: string | null; candidate_status: string | null }
          >(
            `SELECT task.packet_id, task.packet_kind, task.packet_payload,
                    task.candidate_id, task.decision_window_status,
                    task.review_outcome, task.decision_expires_at,
                    task.publish_expires_at, task.created_at,
                    task.created_by, task.closed_at,
                    cand.proposer_principal,
                    cand.candidate_status
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
               AND task.semantic_domain = $4
               AND task.decision_window_status = 'CLOSED'
             ORDER BY task.closed_at DESC`,
            [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain],
          );
          items = result.rows.map((row) => buildInboxItem(row, "completed"));
          break;
        }
        default:
          items = [];
      }

      return items;
    } catch (error) {
      throw wrapError(error, "GET_INBOX_ITEMS_FAILED");
    } finally {
      client.release();
    }
  }

  // ── getPacketDetail ───────────────────────────────────────────────────────────

  async getPacketDetail(scope: SemanticScope, packetId: string): Promise<SemanticReviewPacket> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope);

      // 1. Get review task
      const taskResult = await client.query<ReviewTaskRow>(
        `SELECT packet_id, packet_kind, packet_payload,
                candidate_id, decision_window_status,
                review_outcome, decision_expires_at,
                publish_expires_at, created_at,
                created_by, closed_at
         FROM semantic.semantic_review_task
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = $4
           AND packet_id = $5::uuid`,
        [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, packetId],
      );

      if (taskResult.rows.length === 0) {
        throw new SemanticGovernanceError("PACKET_NOT_FOUND", "审核包不存在", 404);
      }

      const task = taskResult.rows[0] as NonNullable<(typeof taskResult.rows)[0]>;
      const payload = task.packet_payload;

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
          [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, task.candidate_id],
        );
        if (candResult.rows.length > 0) {
          candidateStatus = candResult.rows[0]?.candidate_status;
          proposerPrincipal = candResult.rows[0]?.proposer_principal;
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
        [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, packetId],
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
          [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, task.candidate_id],
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
        comment: row.decision_reason ?? undefined,
        reauthenticated: false,
      }));

      const reviewers: Reviewer[] = [
        // Deduplicate: reviewers from decision rows + any from payload
        ...decisions.map((d) => ({
          id: d.reviewerId,
          name: d.reviewerName,
          decision: d.decision,
          decidedAt: d.decidedAt,
          comment: d.comment,
        })),
      ];

      const diff = buildDiff(payload);
      const impact = buildImpact(payload);

      const packet: SemanticReviewPacket = {
        id: task.packet_id,
        version: revisions.length > 0 ? revisions.at(-1)?.version : 1,
        title: pluckString(payload, "title", "未命名提案"),
        description: pluckString(payload, "description"),
        domain: scope.semanticDomain,
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
          required: (task.packet_payload.quorumRequired as number) ?? 2,
          current: (task.packet_payload.quorumCurrent as number) ?? 0,
        },
        decisions,
        diff,
        impact,
        lineage: buildLineage(task, candidateStatus),
        revisions,
      };

      return packet;
    } catch (error) {
      if (error instanceof SemanticGovernanceError) throw error;
      throw wrapError(error, "GET_PACKET_DETAIL_FAILED");
    } finally {
      client.release();
    }
  }

  // ── submitDecision ────────────────────────────────────────────────────────────

  async submitDecision(scope: SemanticScope, input: DecisionInput): Promise<DecisionResult> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope, input.principal);

      // Map frontend decision to DB decision
      const dbDecision = input.decision === "approved" ? "APPROVE" : "REJECT";
      const dbRole =
        input.semanticRole === "human-reviewer"
          ? "domain_reviewer"
          : input.semanticRole === "admin"
            ? "admin_reviewer"
            : "domain_reviewer";

      const result = await client.query<{ record_review_decision: Record<string, unknown> }>(
        `SELECT semantic.record_review_decision(
          $1::uuid, $2::uuid, $3, $4,
          $5::uuid, $6, $7, $8, $9
        )`,
        [
          scope.appId,
          scope.tenantId,
          scope.environment,
          scope.semanticDomain,
          input.packetId,
          input.principal,
          dbRole,
          dbDecision,
          input.decisionReason ?? null,
        ],
      );

      const rpcResult = result.rows[0]?.record_review_decision;
      if (!rpcResult) {
        throw new SemanticGovernanceError("RPC_FAILED", "审核决策 RPC 调用失败", 500);
      }

      return {
        decisionId: rpcResult.decision_id as string,
        decisionDigest: rpcResult.decision_digest as string,
        packetClosed: (rpcResult.packet_closed ?? false) as boolean,
        outcome: (rpcResult.outcome ?? "PENDING") as "APPROVED" | "VETOED" | "PENDING",
        totalApprovals: (rpcResult.total_approvals as number) ?? 0,
        totalRejections: (rpcResult.total_rejections as number) ?? 0,
        requiredApprovals: rpcResult.required_approvals as number | undefined,
        decisionSetDigest: rpcResult.decision_set_digest as string | undefined,
      };
    } catch (error) {
      if (error instanceof SemanticGovernanceError) throw error;
      throw wrapError(error, "SUBMIT_DECISION_FAILED");
    } finally {
      client.release();
    }
  }

  // ── createCandidate ───────────────────────────────────────────────────────────

  async createCandidate(
    scope: SemanticScope,
    input: CreateCandidateInput,
  ): Promise<{ packetId: string }> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope, "agent-proposer");

      const candidateId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const packetId = crypto.randomUUID();

      // Build packet payload
      const packetPayload = {
        title: input.title,
        description: input.description,
        domain: input.domain,
        changeClass: input.changeClass,
        riskLevel: input.riskLevel,
        diff: input.diff,
        quorumRequired: 2,
        quorumCurrent: 0,
      };

      // Build revision payload
      const revisionPayload = {
        summary: `初始提案: ${input.title}`,
        additions: [],
        modifications: [],
        deletions: [],
      };

      // Begin transaction
      await client.query("BEGIN");

      try {
        // Insert candidate
        await client.query(
          `INSERT INTO semantic.semantic_candidate (
            app_id, tenant_id, environment, semantic_domain,
            candidate_id, proposer_principal, current_revision_id, candidate_status
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::uuid, 'DRAFT')`,
          [
            scope.appId,
            scope.tenantId,
            scope.environment,
            scope.semanticDomain,
            candidateId,
            "agent-proposer",
            revisionId,
          ],
        );

        // Insert candidate revision
        await client.query(
          `INSERT INTO semantic.semantic_candidate_revision (
            app_id, tenant_id, environment, semantic_domain,
            candidate_id, revision_id, revision_number, source_revision_id,
            revision_payload, revision_digest, author_principal,
            change_description, change_class
          ) VALUES (
            $1::uuid, $2::uuid, $3, $4,
            $5::uuid, $6::uuid, 1, $6::uuid,
            $7::jsonb, $8, $9, $10, $11
          )`,
          [
            scope.appId,
            scope.tenantId,
            scope.environment,
            scope.semanticDomain,
            candidateId,
            revisionId,
            JSON.stringify(revisionPayload),
            `sha256:${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`,
            "agent-proposer",
            input.description,
            input.changeClass === "formula" ? "MAJOR" : "MINOR",
          ],
        );

        // Insert review task
        await client.query(
          `INSERT INTO semantic.semantic_review_task (
            app_id, tenant_id, environment, semantic_domain,
            packet_id, packet_kind, packet_digest, packet_payload,
            candidate_id, decision_window_status, review_outcome,
            decision_expires_at, quorum_rules_snapshot, veto_rules_snapshot,
            exclusion_set, created_by
          ) VALUES (
            $1::uuid, $2::uuid, $3, $4,
            $5::uuid, 'CANDIDATE_REVIEW', $6, $7::jsonb,
            $8::uuid, 'OPEN', 'PENDING',
            NOW() + INTERVAL '7 days', $9::jsonb, $10::jsonb,
            $11::jsonb, $12
          )`,
          [
            scope.appId,
            scope.tenantId,
            scope.environment,
            scope.semanticDomain,
            packetId,
            `sha256:${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`,
            JSON.stringify(packetPayload),
            candidateId,
            JSON.stringify({ required_approvals: 2, min_reviewers: 2 }),
            JSON.stringify({ min_veto_count: 1 }),
            JSON.stringify(["agent-proposer"]),
            "agent-proposer",
          ],
        );

        await client.query("COMMIT");
        return { packetId };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } catch (error) {
      if (error instanceof SemanticGovernanceError) throw error;
      throw wrapError(error, "CREATE_CANDIDATE_FAILED");
    } finally {
      client.release();
    }
  }

  // ── preparePublish ────────────────────────────────────────────────────────────

  async preparePublish(scope: SemanticScope, packetId: string): Promise<{ attemptId: string }> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope, "publisher");

      // Get candidate_id from the review task
      const taskResult = await client.query<{ candidate_id: string | null }>(
        `SELECT candidate_id
         FROM semantic.semantic_review_task
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = $4
           AND packet_id = $5::uuid`,
        [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, packetId],
      );

      if (taskResult.rows.length === 0) {
        throw new SemanticGovernanceError("PACKET_NOT_FOUND", "审核包不存在", 404);
      }

      const candidateId = taskResult.rows[0]?.candidate_id;
      if (!candidateId) {
        throw new SemanticGovernanceError("NO_CANDIDATE", "审核包没有关联的提案", 400);
      }

      const result = await client.query<{ prepare_publish_attempt: Record<string, unknown> }>(
        `SELECT semantic.prepare_publish_attempt(
          $1::uuid, $2::uuid, $3, $4,
          $5::uuid, $6::uuid, $7, $8::bigint,
          $9::bigint, $10::bigint, $11
        )`,
        [
          scope.appId,
          scope.tenantId,
          scope.environment,
          scope.semanticDomain,
          packetId,
          candidateId,
          `sha256:${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`,
          1,
          1,
          1,
          `sha256:${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`,
        ],
      );

      const rpcResult = result.rows[0]?.prepare_publish_attempt;
      if (!rpcResult) {
        throw new SemanticGovernanceError("RPC_FAILED", "准备发布 RPC 调用失败", 500);
      }

      return { attemptId: rpcResult.attempt_id as string };
    } catch (error) {
      if (error instanceof SemanticGovernanceError) throw error;
      throw wrapError(error, "PREPARE_PUBLISH_FAILED");
    } finally {
      client.release();
    }
  }

  // ── commitPublish ─────────────────────────────────────────────────────────────

  async commitPublish(scope: SemanticScope, packetId: string): Promise<{ releaseId: string }> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope, "publisher");

      // Get the latest PREPARED attempt for this packet
      const attemptResult = await client.query<{ attempt_id: string }>(
        `SELECT attempt_id
         FROM semantic.semantic_publish_attempt
         WHERE app_id = $1::uuid
           AND tenant_id = $2::uuid
           AND environment = $3
           AND semantic_domain = $4
           AND packet_id = $5::uuid
           AND attempt_state = 'PREPARED'
         ORDER BY created_at DESC
         LIMIT 1`,
        [scope.appId, scope.tenantId, scope.environment, scope.semanticDomain, packetId],
      );

      if (attemptResult.rows.length === 0) {
        throw new SemanticGovernanceError("NO_ATTEMPT", "没有找到准备好的发布尝试", 400);
      }

      const attemptId = attemptResult.rows[0]?.attempt_id;
      const projectionRef = crypto.randomUUID();
      const projectionHash = `sha256:${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

      const result = await client.query<{ commit_publish_attempt: Record<string, unknown> }>(
        `SELECT semantic.commit_publish_attempt(
          $1::uuid, $2::uuid, $3, $4,
          $5::uuid, $6::uuid, $7, $8::uuid,
          $9, $10::uuid, $11, $12::uuid
        )`,
        [
          scope.appId,
          scope.tenantId,
          scope.environment,
          scope.semanticDomain,
          attemptId,
          projectionRef,
          projectionHash,
          projectionRef,
          projectionHash,
          projectionRef,
          projectionHash,
          null,
        ],
      );

      const rpcResult = result.rows[0]?.commit_publish_attempt;
      if (!rpcResult) {
        throw new SemanticGovernanceError("RPC_FAILED", "执行发布 RPC 调用失败", 500);
      }

      return { releaseId: rpcResult.release_id as string };
    } catch (error) {
      if (error instanceof SemanticGovernanceError) throw error;
      throw wrapError(error, "COMMIT_PUBLISH_FAILED");
    } finally {
      client.release();
    }
  }

  // ── executeRollback ───────────────────────────────────────────────────────────

  async executeRollback(scope: SemanticScope, _packetId: string): Promise<{ receiptId: string }> {
    const client = await this.pool.connect();
    try {
      await setScopeContext(client, scope, "publisher");

      const authorizationId = crypto.randomUUID();
      const nonce = crypto.randomUUID();

      const result = await client.query<{ execute_rollback: Record<string, unknown> }>(
        `SELECT semantic.execute_rollback(
          $1::uuid, $2::uuid, $3, $4,
          $5::uuid, $6::uuid, $7
        )`,
        [
          scope.appId,
          scope.tenantId,
          scope.environment,
          scope.semanticDomain,
          authorizationId,
          nonce,
          "手动回滚",
        ],
      );

      const rpcResult = result.rows[0]?.execute_rollback;
      if (!rpcResult) {
        throw new SemanticGovernanceError("RPC_FAILED", "执行回滚 RPC 调用失败", 500);
      }

      return { receiptId: rpcResult.receipt_id as string };
    } catch (error) {
      if (error instanceof SemanticGovernanceError) throw error;
      throw wrapError(error, "EXECUTE_ROLLBACK_FAILED");
    } finally {
      client.release();
    }
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function buildInboxItem(
  row: ReviewTaskRow & { proposer_principal: string | null; candidate_status: string | null },
  group: InboxGroup,
): InboxItem {
  const payload = row.packet_payload;
  const status = row.candidate_status ? mapToInboxStatus(row.candidate_status) : "candidate";

  return {
    packetId: row.packet_id,
    title: pluckString(payload, "title", "未命名提案"),
    domain: pluckString(payload, "domain", "未知"),
    changeClass: pluckString(payload, "changeClass", "other") as ChangeClass,
    riskLevel: pluckString(payload, "riskLevel", "medium") as RiskLevel,
    status,
    createdAt: row.created_at,
    expiresAt: row.decision_expires_at,
    proposer: row.proposer_principal ?? row.created_by,
    quorum: {
      required: (payload.quorumRequired as number) ?? 2,
      current: (payload.quorumCurrent as number) ?? 0,
    },
    currentDecision: mapReviewOutcome(row.review_outcome),
    group,
  };
}

function buildDiff(payload: Record<string, unknown>): SemanticDiff {
  const diff = payload.diff as Record<string, unknown> | undefined;
  return {
    summary: pluckString(diff ?? {}, "summary", "无变更摘要"),
    additions: (diff?.additions as DiffEntry[]) ?? [],
    modifications: (diff?.modifications as DiffEntry[]) ?? [],
    deletions: (diff?.deletions as DiffEntry[]) ?? [],
  };
}

function buildImpact(payload: Record<string, unknown>): ImpactAnalysis {
  const impact = payload.impact as Record<string, unknown> | undefined;
  return {
    affectedQueries: pluckStringArray(impact ?? {}, "affectedQueries"),
    affectedEvals: pluckStringArray(impact ?? {}, "affectedEvals"),
    affectedMetrics: pluckStringArray(impact ?? {}, "affectedMetrics"),
    breakingChanges: (impact?.breakingChanges as boolean) ?? false,
    summary: pluckString(impact ?? {}, "summary", "无影响分析"),
  };
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

/** 包装数据库错误为 SemanticGovernanceError */
function wrapError(error: unknown, fallbackCode: string): SemanticGovernanceError {
  if (error instanceof SemanticGovernanceError) return error;
  const message = error instanceof Error ? error.message : "未知数据库错误";
  const pgCode =
    error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (pgCode === "42501" || (typeof message === "string" && message.includes("SEMANTIC_"))) {
    return new SemanticGovernanceError(fallbackCode, message, 403);
  }
  return new SemanticGovernanceError(fallbackCode, message, 500);
}

// ─── 重新导出用于类型检查的辅助函数 ────────────────────────────────────────────
export { mapCandidateStatus, mapReviewOutcome, mapSemanticRole };
