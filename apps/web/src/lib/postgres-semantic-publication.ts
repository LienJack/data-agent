import {
  type ContentHash,
  contentHashSchema,
  type SemanticChangeSet,
  type SemanticReviewDecision,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  compileSemanticPublicationProjection,
  type SemanticPublicationAuthorityPort,
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

function parseContentHash(value: string): ContentHash {
  contentHashSchema.parse(value);
  return value as ContentHash;
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
): SemanticPublicationAuthorityPort {
  return {
    publishAtomically: (input) => publishAtomically(pool, scope, input),
  };
}
