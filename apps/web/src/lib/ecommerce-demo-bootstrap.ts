import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type SemanticSourceBundle,
  semanticSourceBundleSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { compileU5Projection } from "@data-agent/semantic";
import type { ClientBase } from "pg";
import { z } from "zod";

export const ECOMMERCE_DEMO_DATASOURCE_ID = "00000000-0000-4000-8000-00000000ec01";
export const ECOMMERCE_DEMO_SECRET_REF_ID = "00000000-0000-4000-8000-00000000ec02";
export const ECOMMERCE_DEMO_CREDENTIAL_REF_ID = "00000000-0000-4000-8000-00000000ec03";
export const ECOMMERCE_DEMO_BUNDLE_DIGEST =
  "sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518";
export const ECOMMERCE_DEMO_LOCAL_PASSWORD = "data-agent-ecommerce-demo-change-me";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const SECRET_LOCATOR = "env:DATA_AGENT_ECOMMERCE_READER_PASSWORD";

const scopeSchema = z.strictObject({
  appId: z.literal(APP_ID),
  workspaceId: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  principalId: z.uuid(),
});
const configurationSchema = z.strictObject({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  database: z.string().trim().min(1).max(255),
  password: z.string().min(16).max(1_024),
});

export type EcommerceDemoBootstrapScope = z.infer<typeof scopeSchema>;
export type EcommerceDemoConnectionConfiguration = z.infer<typeof configurationSchema>;

export interface EcommerceDemoBootstrapResult {
  readonly schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0";
  readonly terminal: "SUCCEEDED";
  readonly reason_code: "ECOMMERCE_DEMO_ATTACHED" | "ECOMMERCE_DEMO_ALREADY_ATTACHED";
  readonly workspace_id: string;
  readonly datasource_id: string;
  readonly bundle_digest: string;
  readonly credential_rotated: true;
  readonly semantic_release: EcommerceDemoSemanticReleaseResult;
}

export interface EcommerceDemoSemanticReleaseResult {
  readonly status: "PUBLISHED" | "ALREADY_PUBLISHED";
  readonly semantic_domain: "ecommerce";
  readonly release_id: string;
  readonly release_digest: string;
  readonly bundle_digest: string;
  readonly metric_count: number;
  readonly dimension_count: number;
  readonly relationship_count: number;
  readonly entity_count: number;
  readonly term_count: number;
}

const SEMANTIC_DOMAIN = "ecommerce";
const SEMANTIC_IDS = Object.freeze({
  candidate: "00000000-0000-4000-8000-00000000ec20",
  revision: "00000000-0000-4000-8000-00000000ec21",
  packet: "00000000-0000-4000-8000-00000000ec22",
  decision: "00000000-0000-4000-8000-00000000ec23",
  attempt: "00000000-0000-4000-8000-00000000ec24",
  release: "00000000-0000-4000-8000-00000000ec25",
  executableProjection: "00000000-0000-4000-8000-00000000ec26",
  relationshipProjection: "00000000-0000-4000-8000-00000000ec27",
  restrictionProjection: "00000000-0000-4000-8000-00000000ec28",
  sourceRevision: "00000000-0000-4000-8000-00000000ec29",
  curatorPrincipal: "00000000-0000-4000-8000-00000000ec30",
  outboxEvent: "00000000-0000-4000-8000-00000000ec31",
  bootstrapNonce: "00000000-0000-4000-8000-00000000ec32",
  bootstrap: "00000000-0000-4000-8000-00000000ec33",
  reviewerAssignment: "00000000-0000-4000-8000-00000000ec34",
});

function repositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "web" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

async function loadSemanticBundle(): Promise<SemanticSourceBundle> {
  const path = resolve(
    repositoryRoot(),
    "infra/agenticdatabench/ecommerce-v1/semantic/ecommerce-source-bundle.json",
  );
  return semanticSourceBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function publishEcommerceDemoSemanticRelease(
  client: ClientBase,
  scope: EcommerceDemoBootstrapScope,
): Promise<EcommerceDemoSemanticReleaseResult> {
  const bundle = await loadSemanticBundle();
  const projection = await compileU5Projection(bundle, "adb-ecommerce-v1");
  if (projection.errors.length > 0 || !projection.semantic.lowerabilityResult.overallLowerable) {
    throw new Error("ECOMMERCE_DEMO_SEMANTIC_NOT_LOWERABLE");
  }

  const executableDigest = await sha256ContentHash(projection.semantic);
  const relationshipDigest = await sha256ContentHash(projection.relationship);
  const restrictionDigest = await sha256ContentHash(projection.restriction);
  const reviewPolicy = {
    quorum_rules: { required_approvals: 1 },
    veto_rules: { min_veto_count: 1 },
    expiry_rules: { decision_timeout_seconds: 604_800 },
    role_separation_rules: { proposer_cannot_review: true },
    min_reviewers: 1,
    decision_timeout_seconds: 604_800,
  } as const;
  const policyDigest = await sha256ContentHash(reviewPolicy);
  const catalogDigest = await sha256ContentHash({
    dataset_digest: ECOMMERCE_DEMO_BUNDLE_DIGEST,
    catalog_fence: "adb-ecommerce-v1",
  });
  const closurePolicyDigest = await sha256ContentHash({
    policy_version: "ecommerce-semantic-policy@1.0.0",
    mode: "SHADOW",
  });
  const releaseDigest = await sha256ContentHash({
    semantic_domain: SEMANTIC_DOMAIN,
    workspace_id: scope.workspaceId,
    environment: scope.environment,
    bundle_digest: projection.bundleHash,
    executable_digest: executableDigest,
    relationship_digest: relationshipDigest,
    restriction_digest: restrictionDigest,
    release_generation: 1,
  });
  const decisionDigest = await sha256ContentHash({
    packet_id: SEMANTIC_IDS.packet,
    reviewer: scope.principalId,
    decision: "APPROVE",
  });
  const packetDigest = await sha256ContentHash({
    packet_id: SEMANTIC_IDS.packet,
    bundle_digest: projection.bundleHash,
    kind: "CANDIDATE_REVIEW",
  });
  const revisionDigest = await sha256ContentHash({
    revision_id: SEMANTIC_IDS.revision,
    bundle_digest: projection.bundleHash,
  });
  const idempotencyDigest = await sha256ContentHash({
    attempt_id: SEMANTIC_IDS.attempt,
    release_digest: releaseDigest,
  });
  const bootstrapPacketDigest = await sha256ContentHash({
    workspace_id: scope.workspaceId,
    semantic_domain: SEMANTIC_DOMAIN,
    datasource_id: ECOMMERCE_DEMO_DATASOURCE_ID,
    policy_digest: policyDigest,
  });
  const counts = {
    metric_count: bundle.metrics.length,
    dimension_count: bundle.dimensions.length,
    relationship_count: bundle.relationships.length,
    entity_count: bundle.business_ontology?.entities.length ?? 0,
    term_count: bundle.business_ontology?.terms.length ?? 0,
  };

  await client.query("select pg_catalog.set_config('app.semantic_domain', $1::text, true)", [
    SEMANTIC_DOMAIN,
  ]);
  const existing = await client.query<{
    release_digest: string;
    executable_projection_hash: string;
    relationship_projection_hash: string;
    runtime_restriction_projection_hash: string;
  }>(
    `select release_digest, executable_projection_hash, relationship_projection_hash,
            runtime_restriction_projection_hash
       from semantic.semantic_source_release
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text and release_id = $5::uuid`,
    [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN, SEMANTIC_IDS.release],
  );
  if (existing.rows[0]) {
    const release = existing.rows[0];
    if (
      release.release_digest !== releaseDigest ||
      release.executable_projection_hash !== executableDigest ||
      release.relationship_projection_hash !== relationshipDigest ||
      release.runtime_restriction_projection_hash !== restrictionDigest
    ) {
      throw new Error("ECOMMERCE_DEMO_SEMANTIC_RELEASE_CONFLICT");
    }
    return {
      status: "ALREADY_PUBLISHED",
      semantic_domain: SEMANTIC_DOMAIN,
      release_id: SEMANTIC_IDS.release,
      release_digest: releaseDigest,
      bundle_digest: projection.bundleHash,
      ...counts,
    };
  }

  const domain = await client.query<{ datasource_id: string }>(
    `select datasource_id::text from semantic.semantic_domain_registry
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text`,
    [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN],
  );
  if (domain.rows[0] && domain.rows[0].datasource_id !== ECOMMERCE_DEMO_DATASOURCE_ID) {
    throw new Error("ECOMMERCE_DEMO_SEMANTIC_DOMAIN_CONFLICT");
  }
  if (!domain.rows[0]) {
    const membership = await client.query<{ membership_version: string }>(
      `select membership_version::text from app_data_agent.memberships
        where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
          and principal_id = $4::uuid and revoked_at is null`,
      [scope.appId, scope.workspaceId, scope.environment, scope.principalId],
    );
    if (!membership.rows[0]) throw new Error("ECOMMERCE_DEMO_SEMANTIC_REVIEWER_INVALID");
    await client.query(
      "select semantic.lock_semantic_authority_fence($1::uuid, $2::uuid, $3::text, $4::text)",
      [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN],
    );
    await client.query(
      `insert into semantic.semantic_domain_bootstrap (
         app_id, tenant_id, environment, semantic_domain, bootstrap_id,
         bootstrap_packet_digest, signer_one_principal, signer_two_principal,
         signer_one_signature, signer_two_signature, initial_review_policy_digest,
         initial_catalog_fence_digest, initial_compiler_dependency_digest,
         bootstrap_nonce, bootstrap_expires_at, is_closed, closed_at
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid,
         $6::text, $7::text, $8::text, $9::text, $10::text, $11::text,
         $12::text, $13::text, $14::uuid, pg_catalog.clock_timestamp() + interval '10 minutes',
         true, pg_catalog.clock_timestamp())`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        SEMANTIC_IDS.bootstrap,
        bootstrapPacketDigest,
        "ecommerce-demo-bootstrap-owner-1",
        "ecommerce-demo-bootstrap-owner-2",
        await sha256ContentHash("ecommerce-demo-bootstrap-signature-1"),
        await sha256ContentHash("ecommerce-demo-bootstrap-signature-2"),
        policyDigest,
        catalogDigest,
        projection.bundleHash,
        SEMANTIC_IDS.bootstrapNonce,
      ],
    );
    await client.query(
      `insert into semantic.semantic_domain_registry (
         app_id, tenant_id, environment, semantic_domain, datasource_id,
         domain_display_name, created_by
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::text, $7::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        ECOMMERCE_DEMO_DATASOURCE_ID,
        "E-commerce 电商经营分析",
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_reviewer_policy_revision (
         app_id, tenant_id, environment, semantic_domain, policy_version,
         policy_digest, policy_payload, quorum_rules, veto_rules, expiry_rules,
         role_separation_rules, min_reviewers, decision_timeout_seconds, created_by
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, 1,
         $5::text, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
         $10::jsonb, 1, 604800, $11::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        policyDigest,
        reviewPolicy,
        reviewPolicy.quorum_rules,
        reviewPolicy.veto_rules,
        reviewPolicy.expiry_rules,
        reviewPolicy.role_separation_rules,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_reviewer_assignment (
         app_id, tenant_id, environment, semantic_domain, assignment_id,
         principal, semantic_role, membership_version, policy_version, assigned_by
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid,
         $6::text, 'admin_reviewer', $7::bigint, 1, $6::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        SEMANTIC_IDS.reviewerAssignment,
        scope.principalId,
        membership.rows[0].membership_version,
      ],
    );
    await client.query(
      `insert into semantic.semantic_reviewer_policy_pointer (
         app_id, tenant_id, environment, semantic_domain,
         current_policy_version, current_policy_digest, updated_by
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, 1, $5::text, $6::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        policyDigest,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_catalog_fence (
         app_id, tenant_id, environment, semantic_domain,
         catalog_epoch, catalog_digest, schema_digest
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, 0, $5::text, $5::text)`,
      [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN, catalogDigest],
    );
    await client.query(
      `insert into semantic.semantic_dependency_pointer (
         app_id, tenant_id, environment, semantic_domain, current_catalog_epoch,
         current_catalog_digest, current_compiler_bundle_digest,
         current_closure_policy_digest, updated_by
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, 0,
         $5::text, $6::text, $7::text, $8::text)`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        catalogDigest,
        projection.bundleHash,
        closurePolicyDigest,
        scope.principalId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_active_pointer (
         app_id, tenant_id, environment, semantic_domain,
         current_release_generation, updated_by
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, 0, $5::text)`,
      [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN, scope.principalId],
    );
    await client.query(
      `insert into semantic.semantic_runtime_activation (
         app_id, tenant_id, environment, semantic_domain, runtime_mode,
         activation_generation, current_release_generation
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, 'LEGACY', 1, 0)`,
      [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN],
    );
    await client.query(
      `update semantic.semantic_domain_registry
          set domain_description = $5::text, updated_at = pg_catalog.clock_timestamp()
        where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
          and semantic_domain = $4::text`,
      [
        scope.appId,
        scope.workspaceId,
        scope.environment,
        SEMANTIC_DOMAIN,
        "AgenticDataBench E-commerce Demo v1：客户、订单、商品、卖家、履约、评价与跨平台分析语义。",
      ],
    );
  }

  const candidatePayload = {
    schema_version: "ecommerce-semantic-candidate@1.0.0",
    source_bundle: bundle,
    compiler: {
      bundle_digest: projection.bundleHash,
      executable_digest: executableDigest,
      relationship_digest: relationshipDigest,
      restriction_digest: restrictionDigest,
    },
  };
  await client.query(
    `insert into semantic.semantic_candidate (
       app_id, tenant_id, environment, semantic_domain, candidate_id,
       proposer_principal, current_revision_id, candidate_status
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::text, $7::uuid, 'PUBLISHED')`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.candidate,
      SEMANTIC_IDS.curatorPrincipal,
      SEMANTIC_IDS.revision,
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
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.candidate,
      SEMANTIC_IDS.revision,
      SEMANTIC_IDS.sourceRevision,
      candidatePayload,
      revisionDigest,
      SEMANTIC_IDS.curatorPrincipal,
      "安装固定且经过人工确认的 E-commerce Demo v1 语义模型。",
    ],
  );
  const reviewPacket = {
    schema_version: "ecommerce-semantic-review-packet@1.0.0",
    title: "发布 E-commerce Demo v1 语义模型",
    description: "32 指标、15 维度、14 实体、46 中文术语与 8 条可执行关系。",
    risk_level: "HIGH",
    change_class: "MAJOR",
    bundle_digest: projection.bundleHash,
  };
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
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.packet,
      packetDigest,
      reviewPacket,
      SEMANTIC_IDS.candidate,
      reviewPolicy.quorum_rules,
      reviewPolicy.veto_rules,
      JSON.stringify([SEMANTIC_IDS.curatorPrincipal]),
      SEMANTIC_IDS.curatorPrincipal,
    ],
  );
  await client.query(
    `insert into semantic.semantic_review_decision (
       app_id, tenant_id, environment, semantic_domain, packet_id, decision_id,
       principal, semantic_role, decision, decision_reason, decision_digest
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::text, 'admin_reviewer', 'APPROVE', $8::text, $9::text)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.packet,
      SEMANTIC_IDS.decision,
      scope.principalId,
      "项目所有者确认将固定 E-commerce 语义资产发布到 Demo Workspace。",
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
       $7::uuid, 'COMMITTED', $8::text, 0, 1, $9::uuid, $10::text,
       $11::uuid, $12::text, $13::uuid, $14::text, 1, $15::text, $16::uuid)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.attempt,
      SEMANTIC_IDS.packet,
      SEMANTIC_IDS.candidate,
      projection.bundleHash,
      SEMANTIC_IDS.executableProjection,
      executableDigest,
      SEMANTIC_IDS.relationshipProjection,
      relationshipDigest,
      SEMANTIC_IDS.restrictionProjection,
      restrictionDigest,
      idempotencyDigest,
      SEMANTIC_IDS.release,
    ],
  );
  await client.query(
    `insert into semantic.semantic_source_release (
       app_id, tenant_id, environment, semantic_domain, release_id, release_generation,
       attempt_id, packet_id, candidate_id, release_digest, compiler_bundle_digest,
       executable_projection_ref, executable_projection_hash,
       relationship_projection_ref, relationship_projection_hash,
       runtime_restriction_projection_ref, runtime_restriction_projection_hash,
       quorum_snapshot, decision_set_digest, published_by
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, 1,
       $6::uuid, $7::uuid, $8::uuid, $9::text, $10::text,
       $11::uuid, $12::text, $13::uuid, $14::text, $15::uuid, $16::text,
       $17::jsonb, $18::text, $19::text)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.release,
      SEMANTIC_IDS.attempt,
      SEMANTIC_IDS.packet,
      SEMANTIC_IDS.candidate,
      releaseDigest,
      projection.bundleHash,
      SEMANTIC_IDS.executableProjection,
      executableDigest,
      SEMANTIC_IDS.relationshipProjection,
      relationshipDigest,
      SEMANTIC_IDS.restrictionProjection,
      restrictionDigest,
      { required_approvals: 1, approvals: 1, reviewer_principals: [scope.principalId] },
      decisionDigest,
      scope.principalId,
    ],
  );
  await client.query(
    `insert into semantic.semantic_executable_projection (
       app_id, tenant_id, environment, semantic_domain, projection_id, release_id,
       projection_digest, projection_payload
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid, $7::text, $8::jsonb)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.executableProjection,
      SEMANTIC_IDS.release,
      executableDigest,
      projection.semantic,
    ],
  );
  await client.query(
    `insert into semantic.semantic_relationship_projection (
       app_id, tenant_id, environment, semantic_domain, projection_id, release_id,
       datasource_id, catalog_epoch, projection_digest, projection_payload
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::uuid, 0, $8::text, $9::jsonb)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.relationshipProjection,
      SEMANTIC_IDS.release,
      ECOMMERCE_DEMO_DATASOURCE_ID,
      relationshipDigest,
      projection.relationship,
    ],
  );
  await client.query(
    `insert into semantic.semantic_runtime_restriction_projection (
       app_id, tenant_id, environment, semantic_domain, projection_id, release_id,
       projection_digest, platform_policy_digest, compiler_bundle_digest,
       pointer_generation, restriction_payload
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid,
       $7::text, $8::text, $9::text, 2, $10::jsonb)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.restrictionProjection,
      SEMANTIC_IDS.release,
      restrictionDigest,
      closurePolicyDigest,
      projection.bundleHash,
      projection.restriction,
    ],
  );
  await client.query(
    `update semantic.semantic_active_pointer
        set current_release_id = $5::uuid, current_release_generation = 1,
            current_release_digest = $6::text, pointer_generation = pointer_generation + 1,
            updated_at = pg_catalog.clock_timestamp(), updated_by = $7::text
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text and current_release_generation = 0`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.release,
      releaseDigest,
      scope.principalId,
    ],
  );
  await client.query(
    `update semantic.semantic_runtime_activation
        set runtime_mode = 'SHADOW', current_release_id = $5::uuid,
            current_release_generation = 1, activation_generation = activation_generation + 1,
            updated_at = pg_catalog.clock_timestamp()
      where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
        and semantic_domain = $4::text and current_release_generation = 0`,
    [scope.appId, scope.workspaceId, scope.environment, SEMANTIC_DOMAIN, SEMANTIC_IDS.release],
  );
  const outboxDigest = await sha256ContentHash({
    event: "SOURCE_RELEASE_ACTIVATED",
    release_digest: releaseDigest,
  });
  await client.query(
    `insert into semantic.semantic_outbox (
       app_id, tenant_id, environment, semantic_domain, event_id, event_type,
       counter_kind, axis_generation, observed_release_generation,
       event_payload, event_digest
     ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid,
       'SOURCE_RELEASE_ACTIVATED', 'RELEASE', 1, 1, $6::jsonb, $7::text)`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      SEMANTIC_DOMAIN,
      SEMANTIC_IDS.outboxEvent,
      {
        release_id: SEMANTIC_IDS.release,
        release_digest: releaseDigest,
        relationship_projection_id: SEMANTIC_IDS.relationshipProjection,
        relationship_projection_digest: relationshipDigest,
      },
      outboxDigest,
    ],
  );

  return {
    status: "PUBLISHED",
    semantic_domain: SEMANTIC_DOMAIN,
    release_id: SEMANTIC_IDS.release,
    release_digest: releaseDigest,
    bundle_digest: projection.bundleHash,
    ...counts,
  };
}

export function resolveEcommerceDemoConnectionConfiguration(
  environment: NodeJS.ProcessEnv,
  deploymentEnvironment: string,
): EcommerceDemoConnectionConfiguration {
  const password = environment.DATA_AGENT_ECOMMERCE_READER_PASSWORD?.trim();
  if (
    deploymentEnvironment !== "local" &&
    (!password || password === ECOMMERCE_DEMO_LOCAL_PASSWORD)
  ) {
    throw new Error("ECOMMERCE_DEMO_PRODUCTION_PASSWORD_REQUIRED");
  }
  return configurationSchema.parse({
    host: environment.DATA_AGENT_ECOMMERCE_HOST?.trim() || "127.0.0.1",
    port: Number(environment.DATA_AGENT_ECOMMERCE_PORT ?? "5432"),
    database: environment.DATA_AGENT_ECOMMERCE_DATABASE?.trim() || "data_agent",
    password: password || ECOMMERCE_DEMO_LOCAL_PASSWORD,
  });
}

function providerLocatorHash(): string {
  return `sha256:${createHash("sha256").update(SECRET_LOCATOR).digest("hex")}`;
}

export async function attachEcommerceDemoToWorkspace(
  client: ClientBase,
  scopeInput: unknown,
  configurationInput: unknown,
): Promise<EcommerceDemoBootstrapResult> {
  const scope = scopeSchema.parse(scopeInput);
  const configuration = configurationSchema.parse(configurationInput);
  const ready = await client.query<{ ready: boolean }>(
    `select exists (
       select 1
       from app_data_agent.demo_dataset_active_versions as active
       join app_data_agent.demo_dataset_versions as version
         on version.dataset_id = active.dataset_id and version.bundle_digest = active.bundle_digest
       where active.dataset_id = 'agenticdatabench-ecommerce'
         and active.bundle_digest = $1::text
         and version.status = 'READY'
         and version.raw_table_count = 12
         and version.mart_table_count = 14
         and version.view_count = 5
     ) as ready`,
    [ECOMMERCE_DEMO_BUNDLE_DIGEST],
  );
  if (ready.rows[0]?.ready !== true) throw new Error("ECOMMERCE_DEMO_DATASET_NOT_READY");

  const authority = await client.query<{ allowed: boolean }>(
    `select exists (
       select 1 from app_data_agent.workspaces as workspace
       join app_data_agent.memberships as membership
         on membership.app_id = workspace.app_id
        and membership.tenant_id = workspace.workspace_id
        and membership.environment = workspace.environment
       where workspace.app_id = $1::uuid and workspace.workspace_id = $2::uuid
         and workspace.environment = $3::text and workspace.lifecycle = 'ACTIVE'
         and membership.principal_id = $4::uuid and membership.revoked_at is null
         and membership.workspace_role = 'WORKSPACE_ADMIN'
     ) as allowed`,
    [scope.appId, scope.workspaceId, scope.environment, scope.principalId],
  );
  if (authority.rows[0]?.allowed !== true)
    throw new Error("ECOMMERCE_DEMO_WORKSPACE_AUTHORITY_INVALID");

  const existing = await client.query<{ exists: boolean }>(
    `select exists (
       select 1 from app_data_agent.demo_workspace_receipts
       where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
         and dataset_id = 'agenticdatabench-ecommerce' and bundle_digest = $4::text
     ) as exists`,
    [scope.appId, scope.workspaceId, scope.environment, ECOMMERCE_DEMO_BUNDLE_DIGEST],
  );

  await client.query(
    "select pg_catalog.set_config('data_agent.allow_demo_workspace_bootstrap', 'true', true)",
  );
  await client.query("select app_data_agent.configure_ecommerce_demo_reader($1::text)", [
    configuration.password,
  ]);
  await client.query(
    `insert into app_data_agent.secret_refs (
       app_id, tenant_id, environment, secret_ref_id, owner_principal_id,
       secret_name, provider_ref_hash, version, status
     ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid,
       'EcommerceDemoReader', $6::text, 1, 'ACTIVE')
     on conflict (app_id, tenant_id, environment, secret_ref_id) do nothing`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
      providerLocatorHash(),
    ],
  );
  const secret = await client.query<{ valid: boolean }>(
    `select exists (
       select 1 from app_data_agent.secret_refs
       where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
         and secret_ref_id = $4::uuid and owner_principal_id = $5::uuid
         and secret_name = 'EcommerceDemoReader' and provider_ref_hash = $6::text
         and version = 1 and status = 'ACTIVE'
     ) as valid`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
      providerLocatorHash(),
    ],
  );
  if (secret.rows[0]?.valid !== true) throw new Error("ECOMMERCE_DEMO_SECRET_REF_CONFLICT");
  await client.query(
    `insert into app_data_agent.datasource_connections (
       app_id, tenant_id, environment, datasource_id, name, datasource_type,
       host, port, database_name, username, credential_ref_id, secret_ref_id,
       secret_version, rotation_state, ssl_mode, schema_name, status,
       last_tested_at, created_by_principal_id
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::uuid, 'AgenticDataBench E-commerce Demo',
       'postgresql', $5::text, $6::integer, $7::text, 'data_agent_ecommerce_reader',
       $8::uuid, $9::uuid, 1, 'ACTIVE', 'disable', 'demo_adb_ecommerce_mart',
       'ACTIVE', pg_catalog.clock_timestamp(), $10::uuid
     ) on conflict (app_id, tenant_id, environment, datasource_id) do update set
       name = excluded.name,
       host = excluded.host,
       port = excluded.port,
       database_name = excluded.database_name,
       username = excluded.username,
       credential_ref_id = excluded.credential_ref_id,
       secret_ref_id = excluded.secret_ref_id,
       secret_version = excluded.secret_version,
       rotation_state = excluded.rotation_state,
       ssl_mode = excluded.ssl_mode,
       schema_name = excluded.schema_name,
       status = 'ACTIVE',
       last_tested_at = excluded.last_tested_at,
       updated_at = pg_catalog.clock_timestamp()`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_DATASOURCE_ID,
      configuration.host,
      configuration.port,
      configuration.database,
      ECOMMERCE_DEMO_CREDENTIAL_REF_ID,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
    ],
  );
  await client.query(
    `insert into app_data_agent.demo_workspace_receipts (
       app_id, tenant_id, environment, dataset_id, bundle_digest, datasource_id,
       secret_ref_id, created_by_principal_id, status
     ) values (
       $1::uuid, $2::uuid, $3::text, 'agenticdatabench-ecommerce', $4::text,
       $5::uuid, $6::uuid, $7::uuid, 'READY'
     ) on conflict (app_id, tenant_id, environment, dataset_id, bundle_digest) do nothing`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_BUNDLE_DIGEST,
      ECOMMERCE_DEMO_DATASOURCE_ID,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
    ],
  );

  const semanticRelease = await publishEcommerceDemoSemanticRelease(client, scope);

  return {
    schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0",
    terminal: "SUCCEEDED",
    reason_code: existing.rows[0]?.exists
      ? "ECOMMERCE_DEMO_ALREADY_ATTACHED"
      : "ECOMMERCE_DEMO_ATTACHED",
    workspace_id: scope.workspaceId,
    datasource_id: ECOMMERCE_DEMO_DATASOURCE_ID,
    bundle_digest: ECOMMERCE_DEMO_BUNDLE_DIGEST,
    credential_rotated: true,
    semantic_release: semanticRelease,
  };
}
