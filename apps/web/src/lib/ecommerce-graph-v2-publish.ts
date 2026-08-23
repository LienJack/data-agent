import { sha256ContentHash } from "@data-agent/contracts";
import type { ClientBase } from "pg";
import { z } from "zod";
import {
  ECOMMERCE_GRAPH_V2_IDS,
  type PreparedEcommerceGraphV2,
} from "./ecommerce-graph-v2-runtime";

const SEMANTIC_DOMAIN = "ecommerce";
const DATASOURCE_ID = "00000000-0000-4000-8000-00000000ec01";
const IDS = Object.freeze({
  candidate: "00000000-0000-4000-8000-00000000ec43",
  candidateRevision: "00000000-0000-4000-8000-00000000ec44",
  release: "00000000-0000-4000-8000-00000000ec45",
  reviewPacket: "00000000-0000-4000-8000-00000000ec46",
  reviewDecision: "00000000-0000-4000-8000-00000000ec47",
  publishAttempt: "00000000-0000-4000-8000-00000000ec48",
  sourceRevision: ECOMMERCE_GRAPH_V2_IDS.sourceRevision,
  graphProjection: ECOMMERCE_GRAPH_V2_IDS.graphProjection,
  executableProjection: "00000000-0000-4000-8000-00000000ec4b",
  relationshipProjection: "00000000-0000-4000-8000-00000000ec4c",
  restrictionProjection: "00000000-0000-4000-8000-00000000ec4d",
  outboxEvent: "00000000-0000-4000-8000-00000000ec4e",
});

const publishScopeSchema = z.strictObject({
  app_id: z.uuid(),
  tenant_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  principal_id: z.uuid(),
  base_release_id: z.uuid(),
});

export interface EcommerceGraphV2PublishResult {
  readonly status: "PUBLISHED" | "ALREADY_PUBLISHED";
  readonly release_id: string;
  readonly release_generation: 2;
  readonly release_digest: string;
  readonly source_digest: string;
  readonly projection_id: string;
  readonly node_count: number;
  readonly edge_count: number;
}

interface ActivePointerRow {
  readonly current_release_id: string;
  readonly current_release_generation: string;
  readonly pointer_generation: string;
}

interface DependencyPointerRow {
  readonly current_catalog_epoch: string;
  readonly current_catalog_digest: string;
  readonly current_closure_policy_digest: string;
  readonly pointer_generation: string;
}

interface ReviewerPolicyRow {
  readonly quorum_rules: unknown;
  readonly veto_rules: unknown;
}

interface PublishAuthorityRow {
  readonly deployment_id: string;
  readonly membership_role: "owner" | "analyst";
}

export async function publishEcommerceGraphV2(
  client: ClientBase,
  scopeInput: unknown,
  prepared: PreparedEcommerceGraphV2,
): Promise<EcommerceGraphV2PublishResult> {
  const scope = publishScopeSchema.parse(scopeInput);
  if (
    prepared.source_graph.metadata.scope.app_id !== scope.app_id ||
    prepared.source_graph.metadata.scope.tenant_id !== scope.tenant_id ||
    prepared.source_graph.metadata.scope.environment !== scope.environment ||
    prepared.source_graph.metadata.base_release_id !== scope.base_release_id
  ) {
    throw new Error("ECOMMERCE_GRAPH_V2_SCOPE_MISMATCH");
  }
  const u5 = prepared.compilation.u5_projection;
  const executableDigest = await sha256ContentHash(u5.semantic);
  const relationshipDigest = await sha256ContentHash(u5.relationship);
  const restrictionDigest = await sha256ContentHash(u5.restriction);
  const releaseDigest = await sha256ContentHash({
    semantic_domain: SEMANTIC_DOMAIN,
    scope: prepared.source_graph.metadata.scope,
    graph_source_digest: prepared.compilation.source_digest,
    compiler_bundle_digest: u5.bundleHash,
    executable_digest: executableDigest,
    relationship_digest: relationshipDigest,
    restriction_digest: restrictionDigest,
    release_generation: 2,
  });
  const result = (): EcommerceGraphV2PublishResult => ({
    status: "PUBLISHED",
    release_id: IDS.release,
    release_generation: 2,
    release_digest: releaseDigest,
    source_digest: prepared.compilation.source_digest,
    projection_id: IDS.graphProjection,
    node_count: prepared.compilation.native_projection.node_count,
    edge_count: prepared.compilation.native_projection.edge_count,
  });

  const authority = await client.query<PublishAuthorityRow>(
    `select deployment.deployment_id::text, membership.membership_role
       from platform.deployment_mappings as deployment
       join platform.app_environment_lifecycle as lifecycle
         on lifecycle.app_id = deployment.app_id
        and lifecycle.environment = deployment.environment
       join app_data_agent.memberships as membership
         on membership.app_id = deployment.app_id
        and membership.environment = deployment.environment
      where deployment.app_id = $1::uuid
        and deployment.environment = $2::text
        and deployment.is_active
        and lifecycle.lifecycle_state = 'ACTIVE'
        and membership.tenant_id = $3::uuid
        and membership.principal_id = $4::uuid
        and membership.revoked_at is null
        and membership.membership_role in ('owner', 'analyst')`,
    [scope.app_id, scope.environment, scope.tenant_id, scope.principal_id],
  );
  if (authority.rowCount !== 1 || !authority.rows[0]) {
    throw new Error("ECOMMERCE_GRAPH_V2_PUBLISH_AUTHORITY_MISSING");
  }
  await client.query(
    `select
       pg_catalog.set_config('data_agent.app_id', $1::text, true),
       pg_catalog.set_config('data_agent.tenant_id', $2::text, true),
       pg_catalog.set_config('data_agent.environment', $3::text, true),
       pg_catalog.set_config('data_agent.principal_id', $4::text, true),
       pg_catalog.set_config('data_agent.role', $5::text, true),
       pg_catalog.set_config('data_agent.deployment_id', $6::text, true),
       pg_catalog.set_config('app.semantic_domain', $7::text, true)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      scope.principal_id,
      authority.rows[0].membership_role,
      authority.rows[0].deployment_id,
      SEMANTIC_DOMAIN,
    ],
  );
  const confirmed = await client.query<{ readonly allowed: boolean }>(
    "select platform.backend_context_matches($1::uuid, $2::uuid, $3::text, true) as allowed",
    [scope.app_id, scope.tenant_id, scope.environment],
  );
  if (confirmed.rows[0]?.allowed !== true) {
    throw new Error("ECOMMERCE_GRAPH_V2_PUBLISH_SCOPE_FORBIDDEN");
  }
  await client.query(
    "select semantic.lock_semantic_authority_fence($1::uuid, $2::uuid, $3::text, $4::text)",
    [scope.app_id, scope.tenant_id, scope.environment, SEMANTIC_DOMAIN],
  );
  const existing = await client.query<{ release_digest: string; source_digest: string }>(
    `select release.release_digest, binding.source_digest
       from semantic.semantic_source_release as release
       join semantic.semantic_source_release_graph_projection as binding
         on binding.app_id = release.app_id and binding.tenant_id = release.tenant_id
        and binding.environment = release.environment
        and binding.semantic_domain = release.semantic_domain
        and binding.release_id = release.release_id
      where release.app_id = $1::uuid and release.tenant_id = $2::uuid
        and release.environment = $3::text and release.semantic_domain = $4::text
        and release.release_id = $5::uuid`,
    [scope.app_id, scope.tenant_id, scope.environment, SEMANTIC_DOMAIN, IDS.release],
  );
  if (existing.rows[0]) {
    if (
      existing.rows[0].release_digest !== releaseDigest ||
      existing.rows[0].source_digest !== prepared.compilation.source_digest
    ) {
      throw new Error("ECOMMERCE_GRAPH_V2_RELEASE_CONFLICT");
    }
    return { ...result(), status: "ALREADY_PUBLISHED" };
  }

  const pointer = await client.query<ActivePointerRow>(
    `select current_release_id::text, current_release_generation::text, pointer_generation::text
       from semantic.semantic_active_pointer
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text
      for update`,
    [scope.app_id, scope.tenant_id, scope.environment, SEMANTIC_DOMAIN],
  );
  if (
    pointer.rows[0]?.current_release_id !== scope.base_release_id ||
    pointer.rows[0]?.current_release_generation !== "1"
  ) {
    throw new Error("ECOMMERCE_GRAPH_V2_BASE_RELEASE_STALE");
  }
  const dependency = await client.query<DependencyPointerRow>(
    `select current_catalog_epoch::text, current_catalog_digest,
            current_closure_policy_digest, pointer_generation::text
       from semantic.semantic_dependency_pointer
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text
      for update`,
    [scope.app_id, scope.tenant_id, scope.environment, SEMANTIC_DOMAIN],
  );
  if (!dependency.rows[0]) throw new Error("ECOMMERCE_GRAPH_V2_DEPENDENCY_POINTER_MISSING");
  const policy = await client.query<ReviewerPolicyRow>(
    `select revision.quorum_rules, revision.veto_rules
       from semantic.semantic_reviewer_policy_pointer as pointer
       join semantic.semantic_reviewer_policy_revision as revision
         on revision.app_id = pointer.app_id and revision.tenant_id = pointer.tenant_id
        and revision.environment = pointer.environment
        and revision.semantic_domain = pointer.semantic_domain
        and revision.policy_version = pointer.current_policy_version
      where pointer.app_id = $1::uuid and pointer.tenant_id = $2::uuid
        and pointer.environment = $3::text and pointer.semantic_domain = $4::text`,
    [scope.app_id, scope.tenant_id, scope.environment, SEMANTIC_DOMAIN],
  );
  if (!policy.rows[0]) throw new Error("ECOMMERCE_GRAPH_V2_REVIEW_POLICY_MISSING");

  const nextDependencyGeneration = Number(dependency.rows[0].pointer_generation) + 1;
  const sourceRevisionDigest = prepared.compilation.source_digest;
  const candidateRevisionDigest = await sha256ContentHash({
    candidate_id: IDS.candidate,
    source_revision_id: IDS.sourceRevision,
    source_digest: sourceRevisionDigest,
    coverage_receipt_digest: prepared.coverage_receipt.receipt_digest,
  });
  const packetPayload = {
    schema_version: "ecommerce-graph-v2-review-packet@1.0.0",
    title: "发布 E-commerce 语义本体 Graph v2",
    description: "独立 Node、显式 Edge、真实物理快照、分析 Join 证据和中文专业术语。",
    risk_level: "HIGH",
    change_class: "MAJOR",
    base_release_id: scope.base_release_id,
    graph_id: prepared.source_graph.metadata.graph_id,
    source_digest: sourceRevisionDigest,
    coverage_receipt: prepared.coverage_receipt,
  } as const;
  const packetDigest = await sha256ContentHash(packetPayload);
  const decisionDigest = await sha256ContentHash({
    packet_id: IDS.reviewPacket,
    reviewer: scope.principal_id,
    decision: "APPROVE",
    source_digest: sourceRevisionDigest,
  });
  const idempotencyDigest = await sha256ContentHash({
    attempt_id: IDS.publishAttempt,
    release_digest: releaseDigest,
  });

  await client.query(
    `update semantic.semantic_dependency_pointer
        set current_compiler_bundle_digest = $5::text,
            pointer_generation = pointer_generation + 1,
            updated_at = pg_catalog.clock_timestamp(), updated_by = $6::text
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text and pointer_generation = $7::bigint`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      u5.bundleHash,
      scope.principal_id,
      dependency.rows[0].pointer_generation,
    ],
  );
  await client.query(
    `insert into semantic.semantic_source_revision (
       app_id, tenant_id, environment, semantic_domain, revision_id, revision_number,
       base_release_id, base_release_generation, source_payload, source_digest,
       author_principal, change_description, change_class
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, 1,
       $6::uuid, 1, $7::jsonb, $8::text, $9::text, $10::text, 'MAJOR')`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.sourceRevision,
      scope.base_release_id,
      prepared.source_graph,
      sourceRevisionDigest,
      scope.principal_id,
      "将 E-commerce v1 内嵌语义迁移为显式 Node/Edge 本体。",
    ],
  );
  await client.query(
    `insert into semantic.semantic_candidate (
       app_id, tenant_id, environment, semantic_domain, candidate_id,
       proposer_principal, current_revision_id, candidate_status
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::text, $7::uuid, 'PUBLISHED')`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.candidate,
      scope.principal_id,
      IDS.candidateRevision,
    ],
  );
  await client.query(
    `insert into semantic.semantic_candidate_revision (
       app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id,
       revision_number, source_revision_id, revision_payload, revision_digest,
       author_principal, change_description, change_class
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       1, $7::uuid, $8::jsonb, $9::text, $10::text, $11::text, 'MAJOR')`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.candidate,
      IDS.candidateRevision,
      IDS.sourceRevision,
      {
        schema_version: "ecommerce-graph-v2-candidate@1.0.0",
        source_graph: prepared.source_graph,
        coverage_receipt: prepared.coverage_receipt,
      },
      candidateRevisionDigest,
      scope.principal_id,
      "Agent 迁移独立 Node/Edge、术语和物理证据关系。",
    ],
  );
  await client.query(
    `insert into semantic.semantic_review_task (
       app_id, tenant_id, environment, semantic_domain, packet_id, packet_kind,
       packet_digest, packet_payload, candidate_id, decision_window_status,
       review_outcome, decision_expires_at, publish_expires_at,
       quorum_rules_snapshot, veto_rules_snapshot, exclusion_set, created_by, closed_at
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, 'CANDIDATE_REVIEW',
       $6::text, $7::jsonb, $8::uuid, 'CLOSED', 'APPROVED',
       pg_catalog.clock_timestamp() + interval '7 days',
       pg_catalog.clock_timestamp() + interval '7 days',
       $9::jsonb, $10::jsonb, $11::jsonb, $12::text, pg_catalog.clock_timestamp())`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.reviewPacket,
      packetDigest,
      packetPayload,
      IDS.candidate,
      policy.rows[0].quorum_rules,
      policy.rows[0].veto_rules,
      JSON.stringify([scope.principal_id]),
      scope.principal_id,
    ],
  );
  await client.query(
    `insert into semantic.semantic_review_decision (
       app_id, tenant_id, environment, semantic_domain, packet_id, decision_id,
       principal, semantic_role, decision, decision_reason, decision_digest
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::text, 'admin_reviewer', 'APPROVE', $8::text, $9::text)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.reviewPacket,
      IDS.reviewDecision,
      scope.principal_id,
      "项目所有者已批准执行 Graph v2 本体迁移；coverage receipt 全绿。",
      decisionDigest,
    ],
  );
  await client.query(
    `insert into semantic.semantic_publish_attempt (
       app_id, tenant_id, environment, semantic_domain, attempt_id, packet_id,
       candidate_id, attempt_state, compiler_bundle_digest, catalog_fence_epoch,
       dependency_generation, executable_projection_ref, executable_projection_hash,
       relationship_projection_ref, relationship_projection_hash,
       runtime_restriction_projection_ref, runtime_restriction_projection_hash,
       target_generation, idempotency_digest, committed_release_ref
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::uuid, 'COMMITTED', $8::text, $9::bigint, $10::bigint,
       $11::uuid, $12::text, $13::uuid, $14::text, $15::uuid, $16::text,
       2, $17::text, $18::uuid)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.publishAttempt,
      IDS.reviewPacket,
      IDS.candidate,
      u5.bundleHash,
      dependency.rows[0].current_catalog_epoch,
      nextDependencyGeneration,
      IDS.executableProjection,
      executableDigest,
      IDS.relationshipProjection,
      relationshipDigest,
      IDS.restrictionProjection,
      restrictionDigest,
      idempotencyDigest,
      IDS.release,
    ],
  );
  await client.query(
    `insert into semantic.semantic_source_release (
       app_id, tenant_id, environment, semantic_domain, release_id, release_generation,
       attempt_id, packet_id, candidate_id, release_digest, compiler_bundle_digest,
       executable_projection_ref, executable_projection_hash,
       relationship_projection_ref, relationship_projection_hash,
       runtime_restriction_projection_ref, runtime_restriction_projection_hash,
       profile_child_manifest, quorum_snapshot, decision_set_digest, published_by
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, 2,
       $6::uuid, $7::uuid, $8::uuid, $9::text, $10::text,
       $11::uuid, $12::text, $13::uuid, $14::text, $15::uuid, $16::text,
       $17::jsonb, $18::jsonb, $19::text, $20::text)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.release,
      IDS.publishAttempt,
      IDS.reviewPacket,
      IDS.candidate,
      releaseDigest,
      u5.bundleHash,
      IDS.executableProjection,
      executableDigest,
      IDS.relationshipProjection,
      relationshipDigest,
      IDS.restrictionProjection,
      restrictionDigest,
      {
        graph_projection_id: IDS.graphProjection,
        graph_source_digest: sourceRevisionDigest,
        coverage_receipt_digest: prepared.coverage_receipt.receipt_digest,
      },
      { required_approvals: 1, approvals: 1, reviewer_principals: [scope.principal_id] },
      decisionDigest,
      scope.principal_id,
    ],
  );
  await client.query(
    `insert into semantic.semantic_executable_projection (
       app_id, tenant_id, environment, semantic_domain, projection_id, release_id,
       projection_digest, projection_payload
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid, $7::text, $8::jsonb)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.executableProjection,
      IDS.release,
      executableDigest,
      u5.semantic,
    ],
  );
  await client.query(
    `insert into semantic.semantic_relationship_projection (
       app_id, tenant_id, environment, semantic_domain, projection_id, release_id,
       datasource_id, catalog_epoch, projection_digest, projection_payload
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::uuid, $8::bigint, $9::text, $10::jsonb)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.relationshipProjection,
      IDS.release,
      DATASOURCE_ID,
      dependency.rows[0].current_catalog_epoch,
      relationshipDigest,
      u5.relationship,
    ],
  );
  await client.query(
    `insert into semantic.semantic_runtime_restriction_projection (
       app_id, tenant_id, environment, semantic_domain, projection_id, release_id,
       projection_digest, platform_policy_digest, compiler_bundle_digest,
       pointer_generation, restriction_payload
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::text, $8::text, $9::text, $10::bigint, $11::jsonb)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.restrictionProjection,
      IDS.release,
      restrictionDigest,
      dependency.rows[0].current_closure_policy_digest,
      u5.bundleHash,
      Number(pointer.rows[0].pointer_generation) + 1,
      u5.restriction,
    ],
  );

  await client.query(
    `select semantic.commit_semantic_graph_projection(
       $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid, $7::uuid, $8::jsonb
     )`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      scope.principal_id,
      SEMANTIC_DOMAIN,
      IDS.graphProjection,
      IDS.sourceRevision,
      prepared.compilation.native_projection,
    ],
  );
  await client.query(
    `select semantic.bind_semantic_graph_release(
       $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid, $7::uuid
     )`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      scope.principal_id,
      SEMANTIC_DOMAIN,
      IDS.release,
      IDS.graphProjection,
    ],
  );
  const activated = await client.query(
    `update semantic.semantic_active_pointer
        set current_release_id = $5::uuid, current_release_generation = 2,
            current_release_digest = $6::text, pointer_generation = pointer_generation + 1,
            updated_at = pg_catalog.clock_timestamp(), updated_by = $7::text
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text and current_release_id = $8::uuid
        and current_release_generation = 1 and pointer_generation = $9::bigint`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.release,
      releaseDigest,
      scope.principal_id,
      scope.base_release_id,
      pointer.rows[0].pointer_generation,
    ],
  );
  if (activated.rowCount !== 1) throw new Error("ECOMMERCE_GRAPH_V2_ACTIVE_POINTER_STALE");
  await client.query(
    `update semantic.semantic_runtime_activation
        set current_release_id = $5::uuid, current_release_generation = 2,
            updated_at = pg_catalog.clock_timestamp()
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text and current_release_id = $6::uuid
        and current_release_generation = 1`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.release,
      scope.base_release_id,
    ],
  );
  const outboxPayload = {
    release_id: IDS.release,
    release_digest: releaseDigest,
    graph_projection_id: IDS.graphProjection,
    graph_source_digest: sourceRevisionDigest,
  };
  await client.query(
    `insert into semantic.semantic_outbox (
       app_id, tenant_id, environment, semantic_domain, event_id, event_type,
       counter_kind, axis_generation, observed_release_generation,
       event_payload, event_digest
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid,
       'SOURCE_RELEASE_ACTIVATED', 'RELEASE', 2, 2, $6::jsonb, $7::text)`,
    [
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      SEMANTIC_DOMAIN,
      IDS.outboxEvent,
      outboxPayload,
      await sha256ContentHash({ event: "SOURCE_RELEASE_ACTIVATED", ...outboxPayload }),
    ],
  );
  return result();
}
