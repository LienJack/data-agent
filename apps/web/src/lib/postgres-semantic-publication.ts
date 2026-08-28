import {
  buildSemanticSuccessorStage,
  type SemanticChangeSet,
  type SemanticReviewDecision,
  type SemanticSuccessorStageEnvelope,
  type StageReviewedSemanticSuccessorCommand,
  semanticSuccessorStageEnvelopeSchema,
  verifySemanticChangeSet,
  verifySemanticReviewDecision,
} from "@data-agent/contracts/artifacts";
import { physicalSchemaSnapshotSchema } from "@data-agent/contracts/catalog";
import {
  type ContentHash,
  canonicalizeJson,
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts/common";
import {
  type CombinedFalcon24SemanticActivationCommand,
  type CombinedFalcon24SemanticActivationReceipt,
  verifyCombinedFalcon24SemanticActivationCommand,
  verifyCombinedFalcon24SemanticActivationReceipt,
} from "@data-agent/contracts/runs";
import {
  compileSemanticPublicationProjection,
  type SemanticPublicationAuthorityPort,
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "@data-agent/semantic/production";
import type { Pool, PoolClient } from "pg";

export interface PostgresSemanticPublicationScope {
  readonly appId: string;
  readonly workspaceId: string;
  readonly environment: string;
  readonly principalId: string;
  readonly datasourceId: string;
  readonly semanticDomain: string;
}

export interface PrepareFalcon24SuccessorReviewInput {
  readonly idempotency_key: string;
  readonly expected_predecessor: {
    readonly release_id: string;
    readonly generation: number;
    readonly release_digest: string;
  };
  readonly expected_pointer_version: number;
  readonly change_set: SemanticChangeSet;
}

export interface PreparedFalcon24SuccessorReview {
  readonly change_set: SemanticChangeSet;
  readonly change_set_ref: {
    readonly change_set_id: string;
    readonly change_set_hash: ContentHash;
  };
  readonly review_packet_ref: {
    readonly review_id: string;
    readonly packet_digest: ContentHash;
  };
  readonly candidate_status: Falcon24SuccessorReviewCandidateStatus;
  readonly created: boolean;
}

export type Falcon24SuccessorReviewCandidateStatus =
  | "WAITING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "REVIEW_EXPIRED"
  | "STALE_REBASE_REQUIRED"
  | "PUBLISHING"
  | "PUBLISHED";

export interface PrepareApprovedFalcon24SuccessorInput {
  readonly review_id: string;
  readonly change_set_ref: {
    readonly change_set_id: string;
    readonly change_set_hash: string;
  };
  readonly compiler_bundle_digest: string;
  readonly target_generation: number;
  readonly idempotency_digest: string;
  readonly expected_predecessor: PrepareFalcon24SuccessorReviewInput["expected_predecessor"];
  readonly expected_pointer_version: number;
}

export interface PreparedApprovedFalcon24Successor {
  readonly attempt_id: string;
  readonly attempt_state: "PREPARED";
  readonly change_set_ref: PreparedFalcon24SuccessorReview["change_set_ref"];
  readonly review_ref: {
    readonly review_id: string;
    readonly review_hash: ContentHash;
  };
  readonly review_document: SemanticReviewDecision;
  readonly created: boolean;
}

export interface PostgresSemanticPublicationAuthority extends SemanticPublicationAuthorityPort {
  prepareSuccessorReview(
    input: PrepareFalcon24SuccessorReviewInput,
  ): Promise<PreparedFalcon24SuccessorReview>;
  prepareApprovedSuccessor(
    input: PrepareApprovedFalcon24SuccessorInput,
  ): Promise<PreparedApprovedFalcon24Successor>;
}

interface AuthorityRow {
  readonly deployment_id: string;
  readonly membership_role: "owner" | "analyst";
}

interface PointerRow {
  readonly current_release_id: string | null;
  readonly current_release_generation: string;
  readonly current_release_digest: string | null;
  readonly pointer_generation: string;
}

interface SourceRevisionRow {
  readonly revision_id: string;
  readonly source_digest: string;
  readonly source_payload: unknown;
}

interface CandidateRevisionRow {
  readonly candidate_status: string;
  readonly current_revision_id: string;
  readonly source_revision_id: string;
  readonly revision_digest: string;
  readonly revision_payload: unknown;
}

interface ReviewedPacketRow {
  readonly candidate_id: string;
  readonly decision_window_status: string;
  readonly review_outcome: string;
  readonly packet_payload: unknown;
  readonly decision_id: string;
  readonly decision_principal: string;
  readonly decision: string;
  readonly decision_digest: string;
  readonly review_document: unknown | null;
}

interface PreparedAttemptRow {
  readonly attempt_id: string;
  readonly attempt_state: string;
  readonly candidate_id: string;
  readonly packet_id: string;
  readonly compiler_bundle_digest: string;
  readonly target_generation: string;
}

interface DomainRow {
  readonly datasource_id: string;
}

interface PhysicalSnapshotRow {
  readonly snapshot: unknown;
}

const ZERO_HASH = `sha256:${"0".repeat(64)}` as const;

function parseContentHash(value: string): ContentHash {
  contentHashSchema.parse(value);
  return value as ContentHash;
}

function parseSuccessorReviewCandidateStatus(
  value: unknown,
): Falcon24SuccessorReviewCandidateStatus {
  switch (value) {
    case "WAITING_REVIEW":
    case "APPROVED":
    case "REJECTED":
    case "REVIEW_EXPIRED":
    case "STALE_REBASE_REQUIRED":
    case "PUBLISHING":
    case "PUBLISHED":
      return value;
    default:
      throw new Error("SEMANTIC_SUCCESSOR_REVIEW_STATE_INVALID");
  }
}

async function setPublicationAuthority(
  client: PoolClient,
  scope: PostgresSemanticPublicationScope,
): Promise<void> {
  const authority = await client.query<AuthorityRow>(
    `select deployment.deployment_id::text, membership.membership_role
       from platform.deployment_mappings as deployment
       join platform.app_environment_lifecycle as lifecycle
         on lifecycle.app_id=deployment.app_id and lifecycle.environment=deployment.environment
       join app_data_agent.memberships as membership
         on membership.app_id=deployment.app_id and membership.environment=deployment.environment
      where deployment.app_id=$1::uuid and deployment.environment=$2::text
        and deployment.is_active and lifecycle.lifecycle_state='ACTIVE'
        and membership.tenant_id=$3::uuid and membership.principal_id=$4::uuid
        and membership.revoked_at is null and membership.membership_role in ('owner','analyst')`,
    [scope.appId, scope.environment, scope.workspaceId, scope.principalId],
  );
  const row = authority.rows[0];
  if (authority.rowCount !== 1 || !row) throw new Error("SEMANTIC_PUBLICATION_AUTHORITY_MISSING");
  await client.query(
    `select pg_catalog.set_config('data_agent.app_id',$1::text,true),
            pg_catalog.set_config('data_agent.tenant_id',$2::text,true),
            pg_catalog.set_config('data_agent.environment',$3::text,true),
            pg_catalog.set_config('data_agent.principal_id',$4::text,true),
            pg_catalog.set_config('data_agent.role',$5::text,true),
            pg_catalog.set_config('data_agent.deployment_id',$6::text,true),
            pg_catalog.set_config('app.semantic_domain',$7::text,true)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      scope.principalId,
      row.membership_role,
      row.deployment_id,
      scope.semanticDomain,
    ],
  );
  const confirmed = await client.query<{ readonly allowed: boolean }>(
    "select platform.backend_context_matches($1::uuid,$2::uuid,$3::text,true) as allowed",
    [scope.appId, scope.workspaceId, scope.environment],
  );
  if (confirmed.rows[0]?.allowed !== true) throw new Error("SEMANTIC_PUBLICATION_SCOPE_FORBIDDEN");
}

async function assertDatabaseCanonicalHashes(
  client: PoolClient,
  documents: readonly Readonly<{ document: unknown; expected: string; label: string }>[],
): Promise<void> {
  for (const { document, expected, label } of documents) {
    const result = await client.query<{ readonly digest: string }>(
      "select app_data_agent.u2_canonical_sha256($1::jsonb) as digest",
      [document],
    );
    if (result.rows[0]?.digest !== expected) {
      throw new Error(`SEMANTIC_PUBLICATION_DATABASE_HASH_MISMATCH:${label}`);
    }
  }
}

async function databaseCanonicalHash(client: PoolClient, document: unknown): Promise<ContentHash> {
  const result = await client.query<{ readonly digest: string }>(
    "select app_data_agent.u2_canonical_sha256($1::jsonb) as digest",
    [document],
  );
  const digest = result.rows[0]?.digest;
  if (result.rowCount !== 1 || !digest) {
    throw new Error("SEMANTIC_PUBLICATION_DATABASE_HASH_UNAVAILABLE");
  }
  return parseContentHash(digest);
}

function commandScopeMatches(
  scope: PostgresSemanticPublicationScope,
  commandScope: Readonly<{
    app_id: string;
    tenant_id: string;
    environment: string;
    semantic_domain: string;
  }>,
): boolean {
  return (
    commandScope.app_id === scope.appId &&
    commandScope.tenant_id === scope.workspaceId &&
    commandScope.environment === scope.environment &&
    commandScope.semantic_domain === scope.semanticDomain
  );
}

function packetMember(packet: unknown, key: "change_set" | "review"): unknown {
  if (typeof packet !== "object" || packet === null || Array.isArray(packet)) {
    throw new Error("SEMANTIC_SUCCESSOR_SOURCE_CLOSURE_INVALID");
  }
  return (packet as Readonly<Record<string, unknown>>)[key];
}

function publicationRpcScope(scope: PostgresSemanticPublicationScope) {
  return {
    app_id: scope.appId,
    tenant_id: scope.workspaceId,
    workspace_id: scope.workspaceId,
    environment: scope.environment,
  } as const;
}

async function prepareSuccessorReview(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
  input: PrepareFalcon24SuccessorReviewInput,
): Promise<PreparedFalcon24SuccessorReview> {
  const changeSet = await verifySemanticChangeSet(input.change_set);
  if (
    !commandScopeMatches(scope, changeSet.scope) ||
    changeSet.lifecycle_state !== "REVIEW_FROZEN" ||
    changeSet.validation.outcome !== "PASS" ||
    changeSet.base_release.release_id !== input.expected_predecessor.release_id ||
    changeSet.base_release.generation !== input.expected_predecessor.generation ||
    changeSet.base_release.release_hash !== input.expected_predecessor.release_digest
  ) {
    throw new Error("SEMANTIC_SUCCESSOR_CHANGE_SET_SCOPE_INVALID");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setPublicationAuthority(client, scope);
    const result = await client.query<{
      readonly prepared: {
        readonly change_set_ref?: Readonly<Record<string, unknown>>;
        readonly review_packet_ref?: Readonly<Record<string, unknown>>;
        readonly candidate_status?: unknown;
        readonly created?: unknown;
      };
    }>("select semantic.prepare_falcon24_successor_review($1::jsonb) as prepared", [
      {
        schema_version: "prepare-falcon24-semantic-successor-review@1.0.0",
        scope: publicationRpcScope(scope),
        semantic_domain: scope.semanticDomain,
        idempotency_key: input.idempotency_key,
        expected_predecessor: input.expected_predecessor,
        expected_pointer_version: input.expected_pointer_version,
        change_set: changeSet,
      },
    ]);
    const prepared = result.rows[0]?.prepared;
    const changeSetRef = prepared?.change_set_ref;
    const reviewPacketRef = prepared?.review_packet_ref;
    if (
      result.rowCount !== 1 ||
      !prepared ||
      typeof prepared.created !== "boolean" ||
      changeSetRef?.change_set_id !== changeSet.change_set_id ||
      changeSetRef.change_set_hash !== changeSet.change_set_hash
    ) {
      throw new Error("SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_INVALID");
    }
    const candidateStatus = parseSuccessorReviewCandidateStatus(prepared.candidate_status);
    const reviewId = immutableIdSchema.parse(reviewPacketRef?.review_id);
    const packetDigest = contentHashSchema.parse(reviewPacketRef?.packet_digest);
    await client.query("commit");
    return {
      change_set: changeSet,
      change_set_ref: {
        change_set_id: immutableIdSchema.parse(changeSetRef.change_set_id),
        change_set_hash: parseContentHash(contentHashSchema.parse(changeSetRef.change_set_hash)),
      },
      review_packet_ref: {
        review_id: reviewId,
        packet_digest: parseContentHash(packetDigest),
      },
      candidate_status: candidateStatus,
      created: prepared.created,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function prepareApprovedSuccessor(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
  input: PrepareApprovedFalcon24SuccessorInput,
): Promise<PreparedApprovedFalcon24Successor> {
  if (input.target_generation !== input.expected_predecessor.generation + 1) {
    throw new Error("SEMANTIC_SUCCESSOR_GENERATION_INVALID");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setPublicationAuthority(client, scope);
    const result = await client.query<{
      readonly prepared: {
        readonly attempt_id?: unknown;
        readonly attempt_state?: unknown;
        readonly change_set_ref?: Readonly<Record<string, unknown>>;
        readonly review_ref?: Readonly<Record<string, unknown>>;
        readonly review_document?: unknown;
        readonly created?: unknown;
      };
    }>("select semantic.prepare_falcon24_successor_publish_attempt($1::jsonb) as prepared", [
      {
        schema_version: "prepare-falcon24-semantic-successor-publish-attempt@1.0.0",
        scope: publicationRpcScope(scope),
        semantic_domain: scope.semanticDomain,
        review_id: input.review_id,
        change_set_ref: input.change_set_ref,
        compiler_bundle_digest: input.compiler_bundle_digest,
        target_generation: input.target_generation,
        idempotency_digest: input.idempotency_digest,
        expected_predecessor: input.expected_predecessor,
        expected_pointer_version: input.expected_pointer_version,
      },
    ]);
    const prepared = result.rows[0]?.prepared;
    const review = await verifySemanticReviewDecision(prepared?.review_document);
    if (
      result.rowCount !== 1 ||
      !prepared ||
      prepared.attempt_state !== "PREPARED" ||
      typeof prepared.created !== "boolean" ||
      prepared.change_set_ref?.change_set_id !== input.change_set_ref.change_set_id ||
      prepared.change_set_ref.change_set_hash !== input.change_set_ref.change_set_hash ||
      prepared.review_ref?.review_id !== input.review_id ||
      prepared.review_ref.review_hash !== review.review_hash ||
      review.change_set_id !== input.change_set_ref.change_set_id ||
      review.change_set_hash !== input.change_set_ref.change_set_hash ||
      review.decision !== "APPROVE" ||
      !commandScopeMatches(scope, review.scope)
    ) {
      throw new Error("SEMANTIC_SUCCESSOR_APPROVED_REVIEW_REQUIRED");
    }
    await client.query("commit");
    return {
      attempt_id: immutableIdSchema.parse(prepared.attempt_id),
      attempt_state: "PREPARED",
      change_set_ref: {
        change_set_id: immutableIdSchema.parse(input.change_set_ref.change_set_id),
        change_set_hash: parseContentHash(
          contentHashSchema.parse(input.change_set_ref.change_set_hash),
        ),
      },
      review_ref: {
        review_id: immutableIdSchema.parse(prepared.review_ref.review_id),
        review_hash: parseContentHash(contentHashSchema.parse(prepared.review_ref.review_hash)),
      },
      review_document: review,
      created: prepared.created,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function stageReviewedSuccessor(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
  command: StageReviewedSemanticSuccessorCommand,
): Promise<SemanticSuccessorStageEnvelope> {
  if (!commandScopeMatches(scope, command.scope)) {
    throw new Error("SEMANTIC_SUCCESSOR_SCOPE_FORBIDDEN");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setPublicationAuthority(client, scope);
    await client.query(
      "select semantic.lock_semantic_authority_fence($1::uuid,$2::uuid,$3::text,$4::text)",
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain],
    );
    const pointerResult = await client.query<PointerRow>(
      `select current_release_id::text,current_release_generation::text,current_release_digest,
              pointer_generation::text
         from semantic.semantic_active_pointer
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and semantic_domain=$4::text
        for update`,
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain],
    );
    const pointer = pointerResult.rows[0];
    if (
      pointerResult.rowCount !== 1 ||
      !pointer ||
      pointer.current_release_id !== command.expected_predecessor.release_id ||
      Number(pointer.current_release_generation) !== command.expected_predecessor.generation ||
      pointer.current_release_digest !== command.expected_predecessor.release_digest ||
      Number(pointer.pointer_generation) !== command.expected_pointer_version
    ) {
      throw new Error("SEMANTIC_SUCCESSOR_POINTER_STALE");
    }

    const candidateResult = await client.query<CandidateRevisionRow>(
      `select candidate.candidate_status,candidate.current_revision_id::text,
              revision.source_revision_id::text,revision.revision_digest,
              revision.revision_payload
         from semantic.semantic_candidate as candidate
         join semantic.semantic_candidate_revision as revision
           on revision.app_id=candidate.app_id and revision.tenant_id=candidate.tenant_id
          and revision.environment=candidate.environment
          and revision.semantic_domain=candidate.semantic_domain
          and revision.candidate_id=candidate.candidate_id
          and revision.revision_id=candidate.current_revision_id
        where candidate.app_id=$1::uuid and candidate.tenant_id=$2::uuid
          and candidate.environment=$3::text and candidate.semantic_domain=$4::text
          and candidate.candidate_id=$5::uuid
        for update of candidate
        for share of revision`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        command.change_set_ref.change_set_id,
      ],
    );
    const candidate = candidateResult.rows[0];
    if (candidateResult.rowCount !== 1 || !candidate) {
      throw new Error("SEMANTIC_SUCCESSOR_SOURCE_CLOSURE_INVALID");
    }
    const sourceResult = await client.query<SourceRevisionRow>(
      `select revision_id::text,source_digest,source_payload
         from semantic.semantic_source_revision
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and semantic_domain=$4::text and revision_id=$5::uuid
        for share`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        candidate.source_revision_id,
      ],
    );
    const reviewResult = await client.query<ReviewedPacketRow>(
      `select task.candidate_id::text,task.decision_window_status,task.review_outcome,
              task.packet_payload,decision.decision_id::text,
              decision.principal as decision_principal,decision.decision,
              decision.decision_digest,document.review_document
         from semantic.semantic_review_task as task
         join semantic.semantic_review_decision as decision
           on decision.app_id=task.app_id and decision.tenant_id=task.tenant_id
          and decision.environment=task.environment
          and decision.semantic_domain=task.semantic_domain
          and decision.packet_id=task.packet_id
         left join semantic.semantic_successor_review_decision_document as document
           on document.app_id=decision.app_id and document.tenant_id=decision.tenant_id
          and document.environment=decision.environment
          and document.semantic_domain=decision.semantic_domain
          and document.packet_id=decision.packet_id and document.decision_id=decision.decision_id
        where task.app_id=$1::uuid and task.tenant_id=$2::uuid
          and task.environment=$3::text and task.semantic_domain=$4::text
          and task.packet_id=$5::uuid and decision.decision_digest=$6::text
        for update of task
        for share of decision`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        command.review_ref.review_id,
        command.review_ref.review_hash,
      ],
    );
    const attemptResult = await client.query<PreparedAttemptRow>(
      `select attempt_id::text,attempt_state,candidate_id::text,packet_id::text,
              compiler_bundle_digest,target_generation::text
         from semantic.semantic_publish_attempt
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and semantic_domain=$4::text and packet_id=$5::uuid and candidate_id=$6::uuid
          and attempt_state='PREPARED' and target_generation=$7::bigint
        for update`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        command.review_ref.review_id,
        command.change_set_ref.change_set_id,
        command.target_generation,
      ],
    );
    const domainResult = await client.query<DomainRow>(
      `select datasource_id::text
         from semantic.semantic_domain_registry
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and semantic_domain=$4::text and is_active
        for share`,
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain],
    );
    const snapshotResult = await client.query<PhysicalSnapshotRow>(
      `select catalog.get_physical_schema_snapshot(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid) as snapshot`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.principalId,
        command.source_snapshot_ref.snapshot_id,
      ],
    );
    const source = sourceResult.rows[0];
    const packet = reviewResult.rows[0];
    const attempt = attemptResult.rows[0];
    const domain = domainResult.rows[0];
    const snapshot = physicalSchemaSnapshotSchema.parse(snapshotResult.rows[0]?.snapshot);
    if (
      sourceResult.rowCount !== 1 ||
      reviewResult.rowCount !== 1 ||
      attemptResult.rowCount !== 1 ||
      domainResult.rowCount !== 1 ||
      snapshotResult.rowCount !== 1 ||
      !source ||
      !packet ||
      !attempt ||
      !domain ||
      domain.datasource_id !== scope.datasourceId ||
      snapshot.snapshot_id !== command.source_snapshot_ref.snapshot_id ||
      command.source_snapshot_ref.snapshot_revision !== 1 ||
      snapshot.snapshot_content_hash !== command.source_snapshot_ref.snapshot_hash ||
      (await sha256ContentHash(snapshot.content)) !== snapshot.snapshot_content_hash ||
      snapshot.content.datasource_id !== scope.datasourceId ||
      source.source_digest !== command.change_set_ref.change_set_hash ||
      candidate.candidate_status !== "PUBLISHING" ||
      candidate.source_revision_id !== source.revision_id ||
      candidate.revision_digest !== command.change_set_ref.change_set_hash ||
      packet.candidate_id !== command.change_set_ref.change_set_id ||
      packet.decision_window_status !== "CLOSED" ||
      packet.review_outcome !== "APPROVED" ||
      packet.decision !== "APPROVE" ||
      packet.decision_digest !== command.review_ref.review_hash ||
      attempt.attempt_state !== "PREPARED" ||
      attempt.candidate_id !== command.change_set_ref.change_set_id ||
      attempt.packet_id !== command.review_ref.review_id ||
      attempt.compiler_bundle_digest !== command.compiler_bundle_ref.compiler_bundle_hash ||
      Number(attempt.target_generation) !== command.target_generation
    ) {
      throw new Error("SEMANTIC_SUCCESSOR_SOURCE_CLOSURE_INVALID");
    }

    const [changeSet, candidateChangeSet, packetChangeSet, review] = await Promise.all([
      verifySemanticChangeSet(source.source_payload),
      verifySemanticChangeSet(candidate.revision_payload),
      verifySemanticChangeSet(packetMember(packet.packet_payload, "change_set")),
      verifySemanticReviewDecision(
        packet.review_document ?? packetMember(packet.packet_payload, "review"),
      ),
    ]);
    if (
      canonicalizeJson(changeSet) !== canonicalizeJson(candidateChangeSet) ||
      canonicalizeJson(changeSet) !== canonicalizeJson(packetChangeSet) ||
      changeSet.lifecycle_state !== "REVIEW_FROZEN" ||
      changeSet.validation.outcome !== "PASS" ||
      !changeSet.validation.competency_cases_passed ||
      changeSet.change_set_id !== command.change_set_ref.change_set_id ||
      changeSet.change_set_hash !== command.change_set_ref.change_set_hash ||
      canonicalizeJson(changeSet.scope) !== canonicalizeJson(command.scope) ||
      canonicalizeJson(changeSet.base_release) !==
        canonicalizeJson({
          release_id: command.expected_predecessor.release_id,
          generation: command.expected_predecessor.generation,
          release_hash: command.expected_predecessor.release_digest,
        }) ||
      review.review_id !== command.review_ref.review_id ||
      review.review_hash !== command.review_ref.review_hash ||
      review.change_set_id !== changeSet.change_set_id ||
      review.change_set_hash !== changeSet.change_set_hash ||
      review.reviewer_principal_id !== packet.decision_principal ||
      review.decision !== "APPROVE" ||
      canonicalizeJson(review.scope) !== canonicalizeJson(changeSet.scope)
    ) {
      throw new Error("SEMANTIC_SUCCESSOR_SOURCE_CLOSURE_INVALID");
    }

    const projection = await compileSemanticPublicationProjection(changeSet, {
      source_snapshot: snapshot,
    });
    if (
      projection.compiler_bundle_digest !== command.compiler_bundle_ref.compiler_bundle_hash ||
      projection.graph_projection.compiler_version !== command.compiler_bundle_ref.compiler_version
    ) {
      throw new Error("SEMANTIC_SUCCESSOR_COMPILER_BUNDLE_MISMATCH");
    }
    const projectionRefs = {
      executable: {
        projection_id: projection.executable_projection_id,
        projection_digest: projection.executable_projection_digest,
      },
      relationship: {
        projection_id: projection.relationship_projection_id,
        projection_digest: projection.relationship_projection_digest,
      },
      runtime_restriction: {
        projection_id: projection.restriction_projection_id,
        projection_digest: projection.restriction_projection_digest,
      },
      graph: {
        projection_id: projection.graph_projection_id,
        projection_digest: projection.graph_projection_digest,
      },
    } as const;
    const candidateRelease = {
      release_id: projection.release_id,
      generation: command.target_generation,
      release_digest: projection.release_digest,
      datasource_id: scope.datasourceId,
    } as const;
    const staged = await buildSemanticSuccessorStage({
      schema_version: "semantic-successor-stage@1.0.0",
      stage_id: command.command_id,
      scope: command.scope,
      predecessor_release: command.expected_predecessor,
      expected_pointer_version: command.expected_pointer_version,
      target_generation: command.target_generation,
      change_set_ref: command.change_set_ref,
      review_ref: command.review_ref,
      source_snapshot_ref: command.source_snapshot_ref,
      compiler_bundle_ref: command.compiler_bundle_ref,
      candidate_release: candidateRelease,
      projection_refs: projectionRefs,
      status: "STAGED",
    });
    const projections = {
      executable: {
        projection_kind: "EXECUTABLE" as const,
        projection_id: projection.executable_projection_id,
        projection_digest: projection.executable_projection_digest,
        projection_payload: projection.executable_projection,
      },
      relationship: {
        projection_kind: "RELATIONSHIP" as const,
        projection_id: projection.relationship_projection_id,
        projection_digest: projection.relationship_projection_digest,
        projection_payload: projection.relationship_projection,
      },
      runtime_restriction: {
        projection_kind: "RUNTIME_RESTRICTION" as const,
        projection_id: projection.restriction_projection_id,
        projection_digest: projection.restriction_projection_digest,
        projection_payload: projection.restriction_projection,
      },
      graph: {
        projection_kind: "GRAPH" as const,
        projection_id: projection.graph_projection_id,
        projection_digest: projection.graph_projection_digest,
        projection_payload: projection.graph_projection,
      },
    } as const;
    const verified = await verifySemanticReleaseEnvelope({ stage: staged, projections });
    const validationReceipt = await validateSemanticRuntimeClosure(verified);
    const finalStage =
      validationReceipt.outcome === "PASS"
        ? staged
        : await buildSemanticSuccessorStage({ ...staged, status: "REJECTED" });
    const recordBase = {
      schema_version: "semantic-successor-stage-record@1.0.0",
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      idempotency_digest: ZERO_HASH,
      binding_impact_hashes: projection.binding_impact_hashes,
      stage: finalStage,
      projections,
      validation_receipt: validationReceipt,
      authority_ids: {
        source_revision_id: source.revision_id,
        candidate_revision_id: candidate.current_revision_id,
        publish_attempt_id: attempt.attempt_id,
        review_decision_id: packet.decision_id,
        outbox_event_id: projection.outbox_event_id,
      },
      command_hash: ZERO_HASH,
    } as const;
    const {
      idempotency_digest: _idempotencyDigest,
      command_hash: _commandHash,
      ...idempotencyCommand
    } = recordBase;
    const idempotencyDigest = await databaseCanonicalHash(client, {
      hash_domain: "semantic-successor-stage-record-idempotency@1.0.0",
      command: idempotencyCommand,
    });
    const { command_hash: _placeholder, ...commandWithoutHash } = {
      ...recordBase,
      idempotency_digest: idempotencyDigest,
    };
    const recordCommand = {
      ...commandWithoutHash,
      command_hash: await databaseCanonicalHash(client, commandWithoutHash),
    };
    const result = await client.query<{ readonly envelope: unknown }>(
      "select semantic.record_semantic_successor_stage($1::jsonb) as envelope",
      [recordCommand],
    );
    if (result.rowCount !== 1 || result.rows[0]?.envelope === undefined) {
      throw new Error("SEMANTIC_SUCCESSOR_STAGE_RECORD_INVALID");
    }
    const envelope = semanticSuccessorStageEnvelopeSchema.parse(result.rows[0]?.envelope);
    await verifySemanticReleaseEnvelope(envelope);
    await client.query("commit");
    return envelope;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadStagedSuccessor(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
  query: Readonly<{ stage_id: string }>,
): Promise<SemanticSuccessorStageEnvelope> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setPublicationAuthority(client, scope);
    const commandMaterial = {
      schema_version: "semantic-successor-stage-load@1.0.0",
      stage_id: query.stage_id,
    } as const;
    const command = {
      ...commandMaterial,
      command_hash: await databaseCanonicalHash(client, commandMaterial),
    };
    const result = await client.query<{ readonly envelope: unknown }>(
      "select semantic.load_semantic_successor_stage($1::jsonb) as envelope",
      [command],
    );
    if (result.rowCount !== 1 || result.rows[0]?.envelope === undefined) {
      throw new Error("SEMANTIC_SUCCESSOR_STAGE_LOAD_INVALID");
    }
    const envelope = semanticSuccessorStageEnvelopeSchema.parse(result.rows[0]?.envelope);
    await verifySemanticReleaseEnvelope(envelope);
    await client.query("commit");
    return envelope;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function promoteStagedSuccessor(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
  candidate: CombinedFalcon24SemanticActivationCommand,
): Promise<CombinedFalcon24SemanticActivationReceipt> {
  const command = await verifyCombinedFalcon24SemanticActivationCommand(candidate);
  if (!commandScopeMatches(scope, command.scope)) {
    throw new Error("FALCON24_COMBINED_ACTIVATION_SCOPE_FORBIDDEN");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setPublicationAuthority(client, scope);
    const result = await client.query<{ readonly receipt: unknown }>(
      `select app_data_agent.activate_falcon24_authority_with_semantic_successor(
         $1::jsonb) as receipt`,
      [command],
    );
    if (result.rowCount !== 1 || result.rows[0]?.receipt === undefined) {
      throw new Error("FALCON24_COMBINED_ACTIVATION_RECEIPT_MISSING");
    }
    const receipt = await verifyCombinedFalcon24SemanticActivationReceipt(result.rows[0]?.receipt);
    await client.query("commit");
    return receipt;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function publishAtomically(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
  input: Readonly<{
    change_set: SemanticChangeSet;
    review: SemanticReviewDecision;
    published_at: string;
  }>,
) {
  if (
    input.change_set.scope.app_id !== scope.appId ||
    input.change_set.scope.tenant_id !== scope.workspaceId ||
    input.change_set.scope.environment !== scope.environment ||
    input.change_set.scope.semantic_domain !== scope.semanticDomain ||
    input.review.reviewer_principal_id !== scope.principalId
  ) {
    throw new Error("SEMANTIC_PUBLICATION_SCOPE_MISMATCH");
  }
  const projection = await compileSemanticPublicationProjection(input.change_set);
  const { change_set_hash: _changeSetHash, ...changeSetMaterial } = input.change_set;
  const { review_hash: _reviewHash, ...reviewMaterial } = input.review;
  const generation = input.change_set.base_release.generation + 1;
  const [catalogDigest, closurePolicyDigest, validationDigest, packetDigest, idempotencyDigest] =
    await Promise.all([
      sha256ContentHash(projection.executable_projection.physical_bindings),
      sha256ContentHash({ policy: "semantic-change-set-mandatory-closure@1" }),
      sha256ContentHash({
        change_set_hash: input.change_set.change_set_hash,
        validation: input.change_set.validation,
        competency_results: input.change_set.competency_results,
      }),
      sha256ContentHash({ change_set: input.change_set, review: input.review }),
      sha256ContentHash({
        change_set_hash: input.change_set.change_set_hash,
        review_hash: input.review.review_hash,
        release_digest: projection.release_digest,
      }),
    ]);
  const outboxPayload = {
    release_id: projection.release_id,
    release_digest: projection.release_digest,
    change_set_id: input.change_set.change_set_id,
    change_set_hash: input.change_set.change_set_hash,
    graph_projection_id: projection.graph_projection_id,
  };
  const outboxDigest = await sha256ContentHash({
    event_type: "SOURCE_RELEASE_ACTIVATED",
    ...outboxPayload,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setPublicationAuthority(client, scope);
    await client.query(
      "select semantic.lock_semantic_authority_fence($1::uuid,$2::uuid,$3::text,$4::text)",
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain],
    );
    const existing = await client.query<{ readonly release_digest: string }>(
      `select release_digest from semantic.semantic_source_release
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and semantic_domain=$4::text and release_id=$5::uuid`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.release_id,
      ],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].release_digest !== projection.release_digest) {
        throw new Error("SEMANTIC_PUBLICATION_RELEASE_CONFLICT");
      }
      await client.query("commit");
      return {
        release_id: projection.release_id,
        generation,
        release_hash: parseContentHash(projection.release_digest),
        binding_impact_hashes: projection.binding_impact_hashes.map((hash) =>
          parseContentHash(hash),
        ),
        projection_rebuild: {
          sparse: "READY" as const,
          vector: "READY" as const,
          graph: "READY" as const,
        },
      };
    }
    await assertDatabaseCanonicalHashes(client, [
      {
        document: changeSetMaterial,
        expected: input.change_set.change_set_hash,
        label: "CHANGE_SET",
      },
      { document: reviewMaterial, expected: input.review.review_hash, label: "REVIEW" },
      {
        document: projection.executable_projection,
        expected: projection.executable_projection_digest,
        label: "EXECUTABLE",
      },
      {
        document: projection.relationship_projection,
        expected: projection.relationship_projection_digest,
        label: "RELATIONSHIP",
      },
      {
        document: projection.restriction_projection,
        expected: projection.restriction_projection_digest,
        label: "RESTRICTION",
      },
      {
        document: projection.graph_projection,
        expected: projection.graph_projection_digest,
        label: "GRAPH",
      },
    ]);
    await client.query(
      `insert into semantic.semantic_domain_registry (
         app_id,tenant_id,environment,semantic_domain,datasource_id,domain_display_name,
         domain_description,created_by,updated_at
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$4::text,
         'Published Semantic ChangeSet authority',$6::text,pg_catalog.clock_timestamp())
       on conflict (app_id,tenant_id,environment,semantic_domain) do update
         set datasource_id=excluded.datasource_id,domain_version=semantic.semantic_domain_registry.domain_version+1,
             updated_at=pg_catalog.clock_timestamp()`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        scope.datasourceId,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_active_pointer (
         app_id,tenant_id,environment,semantic_domain,current_release_id,current_release_generation,
         current_release_digest,updated_by
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,null,0,null,$5::text)
       on conflict (app_id,tenant_id,environment,semantic_domain) do nothing`,
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain, scope.principalId],
    );
    await client.query(
      `insert into semantic.semantic_runtime_activation (
         app_id,tenant_id,environment,semantic_domain,current_release_id,current_release_generation
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,null,0)
       on conflict (app_id,tenant_id,environment,semantic_domain) do nothing`,
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain],
    );
    const pointer = await client.query<PointerRow>(
      `select current_release_id::text,current_release_generation::text,current_release_digest,
              pointer_generation::text
         from semantic.semantic_active_pointer
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text and semantic_domain=$4::text
        for update`,
      [scope.appId, scope.workspaceId, scope.environment, scope.semanticDomain],
    );
    const current = pointer.rows[0];
    const baseMatches =
      current &&
      Number(current.current_release_generation) === input.change_set.base_release.generation &&
      (input.change_set.base_release.generation === 0
        ? current.current_release_id === null && current.current_release_digest === null
        : current.current_release_id === input.change_set.base_release.release_id &&
          current.current_release_digest === input.change_set.base_release.release_hash);
    if (!baseMatches) throw new Error("SEMANTIC_PUBLICATION_BASE_RELEASE_STALE");
    await client.query(
      `insert into semantic.semantic_catalog_fence (
         app_id,tenant_id,environment,semantic_domain,catalog_epoch,catalog_digest,schema_digest,is_valid
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::text,$6::text,true)
       on conflict (app_id,tenant_id,environment,semantic_domain,catalog_epoch) do nothing`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        generation,
        catalogDigest,
      ],
    );
    await client.query(
      `insert into semantic.semantic_dependency_pointer (
         app_id,tenant_id,environment,semantic_domain,current_catalog_epoch,current_catalog_digest,
         current_compiler_bundle_digest,current_closure_policy_digest,updated_by
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::text,$7::text,$8::text,$9::text)
       on conflict (app_id,tenant_id,environment,semantic_domain) do update
         set current_catalog_epoch=excluded.current_catalog_epoch,
             current_catalog_digest=excluded.current_catalog_digest,
             current_compiler_bundle_digest=excluded.current_compiler_bundle_digest,
             current_closure_policy_digest=excluded.current_closure_policy_digest,
             pointer_generation=semantic.semantic_dependency_pointer.pointer_generation+1,
             updated_at=pg_catalog.clock_timestamp(),updated_by=excluded.updated_by`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        generation,
        catalogDigest,
        projection.compiler_bundle_digest,
        closurePolicyDigest,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_source_revision (
         app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
         base_release_id,base_release_generation,source_payload,source_digest,author_principal,
         change_description,change_class
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::integer,
         $7::uuid,$8::bigint,$9::jsonb,$10::text,$11::text,
         'Published reviewed Semantic ChangeSet','MAJOR')`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.source_revision_id,
        input.change_set.revision,
        input.change_set.base_release.generation === 0
          ? null
          : input.change_set.base_release.release_id,
        input.change_set.base_release.generation,
        input.change_set,
        input.change_set.change_set_hash,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_candidate (
         app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
         current_revision_id,candidate_status
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::uuid,'PUBLISHED')`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        input.change_set.change_set_id,
        scope.principalId,
        projection.candidate_revision_id,
      ],
    );
    await client.query(
      `insert into semantic.semantic_candidate_revision (
         app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,revision_number,
         source_revision_id,revision_payload,revision_digest,author_principal,change_description,change_class
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::integer,
         $8::uuid,$9::jsonb,$10::text,$11::text,'Frozen reviewed Semantic ChangeSet','MAJOR')`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        input.change_set.change_set_id,
        projection.candidate_revision_id,
        input.change_set.revision,
        projection.source_revision_id,
        input.change_set,
        input.change_set.change_set_hash,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_validation_receipt (
         app_id,tenant_id,environment,semantic_domain,receipt_id,candidate_id,revision_id,
         catalog_epoch,compiler_bundle_digest,validation_outcome,validation_details,impact_analysis,receipt_digest
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,
         $8::bigint,$9::text,'PASS',$10::jsonb,$11::jsonb,$12::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.validation_receipt_id,
        input.change_set.change_set_id,
        projection.candidate_revision_id,
        generation,
        projection.compiler_bundle_digest,
        input.change_set.validation,
        { competency_results: input.change_set.competency_results },
        validationDigest,
      ],
    );
    await client.query(
      `insert into semantic.semantic_review_task (
         app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,packet_digest,
         packet_payload,candidate_id,decision_window_status,review_outcome,decision_expires_at,
         publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,exclusion_set,created_by,closed_at
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,'CANDIDATE_REVIEW',$6::text,
         $7::jsonb,$8::uuid,'CLOSED','APPROVED',$9::timestamptz,$9::timestamptz,
         $10::jsonb,'{}'::jsonb,'[]'::jsonb,$11::text,$9::timestamptz)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        input.review.review_id,
        packetDigest,
        { change_set: input.change_set, review: input.review },
        input.change_set.change_set_id,
        input.published_at,
        { required_approvals: 1, approvals: 1 },
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_review_decision (
         app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,principal,
         semantic_role,decision,decision_reason,decision_digest,created_at
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::text,
         'admin_reviewer','APPROVE','Exact frozen ChangeSet approved',$8::text,$9::timestamptz)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        input.review.review_id,
        projection.review_decision_id,
        scope.principalId,
        input.review.review_hash,
        input.review.reviewed_at,
      ],
    );
    await client.query(
      `insert into semantic.semantic_publish_attempt (
         app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,
         attempt_state,compiler_bundle_digest,catalog_fence_epoch,dependency_generation,
         executable_projection_ref,executable_projection_hash,relationship_projection_ref,
         relationship_projection_hash,runtime_restriction_projection_ref,
         runtime_restriction_projection_hash,target_generation,idempotency_digest,committed_release_ref
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,
         'COMMITTED',$8::text,$9::bigint,$9::bigint,$10::uuid,$11::text,$12::uuid,$13::text,
         $14::uuid,$15::text,$9::bigint,$16::text,$17::uuid)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.publish_attempt_id,
        input.review.review_id,
        input.change_set.change_set_id,
        projection.compiler_bundle_digest,
        generation,
        projection.executable_projection_id,
        projection.executable_projection_digest,
        projection.relationship_projection_id,
        projection.relationship_projection_digest,
        projection.restriction_projection_id,
        projection.restriction_projection_digest,
        idempotencyDigest,
        projection.release_id,
      ],
    );
    await client.query(
      `insert into semantic.semantic_source_release (
         app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,
         packet_id,candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
         executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
         runtime_restriction_projection_ref,runtime_restriction_projection_hash,profile_child_manifest,
         quorum_snapshot,decision_set_digest,published_at,published_by
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::bigint,$7::uuid,
         $8::uuid,$9::uuid,$10::text,$11::text,$12::uuid,$13::text,$14::uuid,$15::text,
         $16::uuid,$17::text,$18::jsonb,$19::jsonb,$20::text,$21::timestamptz,$22::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.release_id,
        generation,
        projection.publish_attempt_id,
        input.review.review_id,
        input.change_set.change_set_id,
        projection.release_digest,
        projection.compiler_bundle_digest,
        projection.executable_projection_id,
        projection.executable_projection_digest,
        projection.relationship_projection_id,
        projection.relationship_projection_digest,
        projection.restriction_projection_id,
        projection.restriction_projection_digest,
        {
          graph_projection_id: projection.graph_projection_id,
          graph_projection_digest: projection.graph_projection_digest,
        },
        { required_approvals: 1, approvals: 1, reviewer_principals: [scope.principalId] },
        input.review.review_hash,
        input.published_at,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_executable_projection (
         app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,projection_payload
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::text,$8::jsonb)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.executable_projection_id,
        projection.release_id,
        projection.executable_projection_digest,
        projection.executable_projection,
      ],
    );
    await client.query(
      `insert into semantic.semantic_relationship_projection (
         app_id,tenant_id,environment,semantic_domain,projection_id,release_id,datasource_id,
         catalog_epoch,projection_digest,projection_payload
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,
         $8::bigint,$9::text,$10::jsonb)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.relationship_projection_id,
        projection.release_id,
        scope.datasourceId,
        generation,
        projection.relationship_projection_digest,
        projection.relationship_projection,
      ],
    );
    await client.query(
      `insert into semantic.semantic_runtime_restriction_projection (
         app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,
         platform_policy_digest,compiler_bundle_digest,pointer_generation,restriction_payload
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::text,
         $8::text,$9::text,$10::bigint,$11::jsonb)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.restriction_projection_id,
        projection.release_id,
        projection.restriction_projection_digest,
        closurePolicyDigest,
        projection.compiler_bundle_digest,
        Number(current.pointer_generation) + 1,
        projection.restriction_projection,
      ],
    );
    await client.query(
      `insert into semantic.semantic_graph_projection (
         app_id,tenant_id,environment,semantic_domain,projection_id,graph_id,source_revision_id,
         source_revision_digest,source_digest,registry_digest,compiler_version,projection_payload,
         projection_storage_digest,node_count,edge_count,created_by
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,
         $8::text,$9::text,$10::text,$11::text,$12::jsonb,$13::text,$14::integer,$15::integer,$16::uuid)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.graph_projection_id,
        projection.graph_projection.graph_id,
        projection.source_revision_id,
        input.change_set.change_set_hash,
        projection.graph_projection.source_digest,
        projection.graph_projection.registry_digest,
        projection.graph_projection.compiler_version,
        projection.graph_projection,
        projection.graph_projection_digest,
        projection.graph_projection.node_count,
        projection.graph_projection.edge_count,
        scope.principalId,
      ],
    );
    for (const node of projection.graph_projection.nodes) {
      await client.query(
        `insert into semantic.semantic_graph_node_projection (
           app_id,tenant_id,environment,semantic_domain,projection_id,node_id,node_type,
           node_version,lifecycle,intrinsic_payload,entry_storage_digest
         ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::text,
           $8::integer,$9::text,$10::jsonb,app_data_agent.u2_canonical_sha256($10::jsonb))`,
        [
          scope.appId,
          scope.workspaceId,
          scope.environment,
          scope.semanticDomain,
          projection.graph_projection_id,
          node.node_id,
          node.node_type,
          node.node_version,
          node.lifecycle,
          node,
        ],
      );
    }
    for (const edge of projection.graph_projection.edges) {
      await client.query(
        `insert into semantic.semantic_graph_edge_projection (
           app_id,tenant_id,environment,semantic_domain,projection_id,edge_id,edge_type,edge_family,
           source_node_id,target_node_id,edge_version,lifecycle,edge_payload,entry_storage_digest
         ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::text,$8::text,
           $9::text,$10::text,$11::integer,$12::text,$13::jsonb,
           app_data_agent.u2_canonical_sha256($13::jsonb))`,
        [
          scope.appId,
          scope.workspaceId,
          scope.environment,
          scope.semanticDomain,
          projection.graph_projection_id,
          edge.edge_id,
          edge.edge_type,
          edge.family,
          edge.source_node_id,
          edge.target_node_id,
          edge.edge_version,
          edge.lifecycle,
          edge,
        ],
      );
    }
    await client.query(
      `insert into semantic.semantic_source_release_graph_projection (
         app_id,tenant_id,environment,semantic_domain,release_id,projection_id,source_revision_id,
         source_revision_digest,source_digest,projection_storage_digest,bound_by
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,
         $8::text,$9::text,$10::text,$11::uuid)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.release_id,
        projection.graph_projection_id,
        projection.source_revision_id,
        input.change_set.change_set_hash,
        projection.graph_projection.source_digest,
        projection.graph_projection_digest,
        scope.principalId,
      ],
    );
    const activated = await client.query(
      `update semantic.semantic_active_pointer
          set current_release_id=$5::uuid,current_release_generation=$6::bigint,
              current_release_digest=$7::text,pointer_generation=pointer_generation+1,
              updated_at=pg_catalog.clock_timestamp(),updated_by=$8::text
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text and semantic_domain=$4::text
          and current_release_generation=$9::bigint and pointer_generation=$10::bigint`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.release_id,
        generation,
        projection.release_digest,
        scope.principalId,
        input.change_set.base_release.generation,
        current.pointer_generation,
      ],
    );
    if (activated.rowCount !== 1) throw new Error("SEMANTIC_PUBLICATION_ACTIVE_POINTER_STALE");
    await client.query(
      `update semantic.semantic_runtime_activation
          set current_release_id=$5::uuid,current_release_generation=$6::bigint,
              activation_generation=activation_generation+1,updated_at=pg_catalog.clock_timestamp()
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text and semantic_domain=$4::text`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.release_id,
        generation,
      ],
    );
    await client.query(
      `insert into semantic.semantic_outbox (
         app_id,tenant_id,environment,semantic_domain,event_id,event_type,counter_kind,
         axis_generation,observed_release_generation,event_payload,event_digest
       ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,'SOURCE_RELEASE_ACTIVATED','RELEASE',
         $6::bigint,$6::bigint,$7::jsonb,$8::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        scope.semanticDomain,
        projection.outbox_event_id,
        generation,
        outboxPayload,
        outboxDigest,
      ],
    );
    await client.query("commit");
    return {
      release_id: projection.release_id,
      generation,
      release_hash: parseContentHash(projection.release_digest),
      binding_impact_hashes: projection.binding_impact_hashes.map((hash) => parseContentHash(hash)),
      projection_rebuild: {
        sparse: "READY" as const,
        vector: "READY" as const,
        graph: "READY" as const,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createPostgresSemanticPublicationAuthority(
  pool: Pick<Pool, "connect">,
  scope: PostgresSemanticPublicationScope,
): PostgresSemanticPublicationAuthority {
  return {
    publishAtomically: (input) => publishAtomically(pool, scope, input),
    prepareSuccessorReview: (input) => prepareSuccessorReview(pool, scope, input),
    prepareApprovedSuccessor: (input) => prepareApprovedSuccessor(pool, scope, input),
    stageReviewedSuccessor: (command) => stageReviewedSuccessor(pool, scope, command),
    loadStagedSuccessor: (query) => loadStagedSuccessor(pool, scope, query),
    promoteStagedSuccessor: (command) => promoteStagedSuccessor(pool, scope, command),
  };
}
