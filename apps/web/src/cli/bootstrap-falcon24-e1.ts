import { execFile } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildBuiltinTeamMaterialization,
  type DataAgentSpecialistProfileId,
} from "@data-agent/agent-runtime";
import { type SemanticChangeSet, verifySemanticChangeSet } from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import { verifyFalcon24RetainedAssetsManifest } from "@data-agent/contracts/evals";
import {
  buildInitialSemanticReleaseSet,
  buildSemanticBootstrapPolicyView,
  buildSemanticBootstrapValidationReceipt,
  buildSemanticDomainBootstrapPacket,
  semanticBootstrapPolicyViewSchema,
  semanticBootstrapValidationReceiptSchema,
  verifiedDomainBootstrapReceiptSchema,
} from "@data-agent/contracts/semantic";
import type { VersionedResourceReference } from "@data-agent/contracts/workspaces";
import { createPostgresPrivilegedGrantAuthority } from "@data-agent/platform/authz";
import { createPostgresModelControlRepository } from "@data-agent/platform/models";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24AuthorityEpoch } from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import {
  bootstrapFalcon24E1,
  createPostgresGreenfieldBootstrapReleaseAuthority,
  deriveFalcon24E1BootstrapId,
} from "@data-agent/platform/semantic-postgres";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import { compileSemanticPublicationProjection } from "@data-agent/semantic/production";
import pg from "pg";
import { z } from "zod";
import { verifyOpenSandboxAnalysisAttestation } from "../../../../scripts/verify-opensandbox-analysis-attestation.js";
import { fetchProviderModelCatalog } from "../lib/model-discovery";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const DEFAULT_STAGING_ID = "00000000-0000-4000-8000-00000000e130";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const execFileAsync = promisify(execFile);

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  staging_id: z.uuid(),
  environment: z.string().min(1).max(64),
  model_api_key: z.string().trim().min(1).optional(),
});

type RetainedManifest = Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>;

const semanticChangeSetBridgeResultSchema = z.strictObject({
  blueprint_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  datasource_id: z.uuid(),
  assertion_count: z.number().int().positive().safe(),
  competency_case_count: z.number().int().positive().safe(),
  change_set: z.unknown(),
});

export async function buildFalcon24E1SemanticChangeSet(input: {
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly semantic_domain: "falcon24";
  };
  readonly base_release: {
    readonly release_id: string;
    readonly generation: number;
    readonly release_hash: `sha256:${string}`;
  };
  readonly revision: number;
}): Promise<{
  readonly blueprint_hash: string;
  readonly datasource_id: string;
  readonly assertion_count: number;
  readonly competency_case_count: number;
  readonly change_set: SemanticChangeSet;
}> {
  const encodedInput = Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      resolve(REPOSITORY_ROOT, "node_modules/tsx/dist/cli.mjs"),
      resolve(REPOSITORY_ROOT, "scripts/build-falcon24-e1-semantic-change-set.ts"),
      `--input=${encodedInput}`,
    ],
    { cwd: REPOSITORY_ROOT, maxBuffer: 16 * 1024 * 1024 },
  );
  if (stderr.trim().length > 0) {
    throw new TypeError("FALCON24_E1_SEMANTIC_CHANGE_SET_BRIDGE_FAILED");
  }
  const parsed = semanticChangeSetBridgeResultSchema.parse(JSON.parse(stdout));
  return Object.freeze({
    ...parsed,
    change_set: await verifySemanticChangeSet(parsed.change_set),
  });
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function required<T>(
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message?: string; retryable?: boolean } },
): T {
  if (!result.ok) {
    throw Object.assign(new TypeError(result.error.code), { port_error: result.error });
  }
  return result.value;
}

function id(retainedHash: string, kind: string, key: string): string {
  return deriveFalcon24E1BootstrapId(retainedHash, kind, key);
}

function deterministicSigner(retainedHash: string, purpose: string) {
  const seed = createHash("sha256")
    .update(`falcon24-e1-disposable-signer:${retainedHash}:${purpose}`)
    .digest();
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([prefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const { d: _privateScalar, ...publicJwk } = privateKey.export({ format: "jwk" });
  return { privateKey, publicMaterial: { format: "JWK" as const, ...publicJwk } };
}

async function setAuthorityContext(
  client: pg.PoolClient,
  scope: { app_id: string; tenant_id: string; environment: string },
  principalId: string,
  deploymentId: string,
) {
  await client.query("select pg_catalog.set_config('data_agent.app_id',$1,true)", [scope.app_id]);
  await client.query("select pg_catalog.set_config('data_agent.tenant_id',$1,true)", [
    scope.tenant_id,
  ]);
  await client.query("select pg_catalog.set_config('data_agent.environment',$1,true)", [
    scope.environment,
  ]);
  await client.query("select pg_catalog.set_config('data_agent.principal_id',$1,true)", [
    principalId,
  ]);
  await client.query("select pg_catalog.set_config('data_agent.role','owner',true)");
  await client.query("select pg_catalog.set_config('data_agent.deployment_id',$1,true)", [
    deploymentId,
  ]);
  await client.query("select pg_catalog.set_config('app.semantic_domain','falcon24',true)");
}

async function loadVerifiedDomainReceipt(input: {
  pool: pg.Pool;
  packet: Awaited<ReturnType<typeof buildSemanticDomainBootstrapPacket>>;
  principal_id: string;
  deployment_id: string;
  workspace_signature: string;
  platform_signature: string;
  workspace_signer: {
    principal_id: string;
    key_id: string;
    key_revision: number;
  };
  platform_signer: {
    principal_id: string;
    key_id: string;
    key_revision: number;
  };
}) {
  const client = await input.pool.connect();
  try {
    await client.query("begin read only");
    await setAuthorityContext(client, input.packet.scope, input.principal_id, input.deployment_id);
    const result = await client.query<{ value: unknown }>(
      `select receipt_json as value
         from semantic.verified_semantic_domain_bootstrap_receipts
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and semantic_domain=$4::text and packet_id=$5::uuid and packet_digest=$6::text
          and release_set_id=$7::uuid and candidate_set_hash=$8::text and policy_hash=$9::text`,
      [
        input.packet.scope.app_id,
        input.packet.scope.tenant_id,
        input.packet.scope.environment,
        input.packet.semantic_domain,
        input.packet.packet_id,
        input.packet.packet_digest,
        input.packet.release_set_id,
        input.packet.candidate_set_root.candidate_set_hash,
        input.packet.policy_ref.policy_hash,
      ],
    );
    await client.query("commit");
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new TypeError("FALCON24_E1_VERIFIED_DOMAIN_REPLAY_AMBIGUOUS");
    }
    const raw = result.rows[0]?.value;
    const receipt = verifiedDomainBootstrapReceiptSchema.parse(raw);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new TypeError("FALCON24_E1_VERIFIED_DOMAIN_REPLAY_INVALID");
    }
    const { receipt_hash: rawHash, ...rawDraft } = raw as Record<string, unknown>;
    if (
      rawHash !== receipt.receipt_hash ||
      (await sha256ContentHash(rawDraft)) !== receipt.receipt_hash ||
      receipt.datasource_id !== input.packet.datasource_id ||
      receipt.nonce_hash !== input.packet.nonce_hash ||
      receipt.workspace_admin.principal_id !== input.workspace_signer.principal_id ||
      receipt.workspace_admin.key_id !== input.workspace_signer.key_id ||
      receipt.workspace_admin.key_revision !== input.workspace_signer.key_revision ||
      receipt.workspace_admin.signature_hash !==
        (await sha256ContentHash(input.workspace_signature)) ||
      receipt.platform_attestor.principal_id !== input.platform_signer.principal_id ||
      receipt.platform_attestor.key_id !== input.platform_signer.key_id ||
      receipt.platform_attestor.key_revision !== input.platform_signer.key_revision ||
      receipt.platform_attestor.signature_hash !==
        (await sha256ContentHash(input.platform_signature))
    ) {
      throw new TypeError("FALCON24_E1_VERIFIED_DOMAIN_REPLAY_CORRUPT");
    }
    return receipt;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function insertSemanticPrerequisites(input: {
  pool: pg.Pool;
  retained: RetainedManifest;
  scope: { app_id: string; tenant_id: string; workspace_id: string; environment: string };
  principal_id: string;
  deployment_id: string;
  datasource_id: string;
  change_set: SemanticChangeSet;
  graph_projection: Awaited<ReturnType<typeof compileSemanticPublicationProjection>>;
}) {
  const retainedHash = input.retained.manifest_hash;
  const sourceRevisionId = id(retainedHash, "semantic-source-revision", "falcon24");
  const candidateId = id(retainedHash, "semantic-candidate", "falcon24");
  const revisionId = id(retainedHash, "semantic-candidate-revision", "falcon24");
  const namespaceId = id(retainedHash, "ontology-namespace", "falcon24");
  const packageId = id(retainedHash, "ontology-package", "falcon24");
  const packageValidationId = id(retainedHash, "ontology-package-validation", "falcon24");
  const previewId = id(retainedHash, "ontology-preview", "falcon24");
  const projectionId = id(retainedHash, "semantic-graph-projection", "falcon24");
  const graphId = id(retainedHash, "semantic-graph", "falcon24");
  const policyId = id(retainedHash, "semantic-bootstrap-policy", "falcon24");
  const releaseSetId = id(retainedHash, "semantic-release-set", "falcon24");
  const packageMaterial = {
    schema_version: "falcon24-e1-ontology-package@1.0.0",
    source_bundle_hash: input.retained.semantics.source_bundle_hash,
    change_set: input.change_set,
  };
  const packageHash = await sha256ContentHash(packageMaterial);
  const sourcePayload = {
    assertions: input.change_set.assertions,
    competency_results: input.change_set.competency_results,
    validation: input.change_set.validation,
  };
  const sourceDigest = await sha256ContentHash(sourcePayload);
  const projectionPayload = input.graph_projection.graph_projection;
  const projectionHash = await sha256ContentHash(projectionPayload);
  const candidateSetHash = await sha256ContentHash({
    revision_digest: input.change_set.change_set_hash,
    package_hash: packageHash,
    source_bundle_hash: input.retained.semantics.source_bundle_hash,
  });
  const packageValidationDocument = {
    schema_version: "falcon24-e1-package-validation@1.0.0",
    outcome: "PASS",
    change_set_hash: input.change_set.change_set_hash,
    projection_hash: projectionHash,
  };
  const packageValidationHash = await sha256ContentHash(packageValidationDocument);
  const previewDocument = {
    schema_version: "falcon24-e1-package-preview@1.0.0",
    package_hash: packageHash,
    projection_hash: projectionHash,
  };
  const previewHash = await sha256ContentHash(previewDocument);
  const candidateRoot = {
    candidate_id: candidateId,
    revision_id: revisionId,
    revision: 1,
    revision_digest: input.change_set.change_set_hash,
    candidate_set_hash: candidateSetHash,
  } as const;
  const packageEntry = {
    namespace_id: namespaceId,
    package_id: packageId,
    package_version: 1,
    package_hash: packageHash,
    candidate_revision: candidateRoot,
    validation_receipt: {
      receipt_id: packageValidationId,
      receipt_hash: packageValidationHash,
    },
    preview_binding: {
      preview_id: previewId,
      preview_hash: previewHash,
      projection_id: projectionId,
      projection_hash: projectionHash,
    },
    mandatory: true,
    gates: {
      coverage: "PASS",
      lowerability: "PASS",
      source_boundary: "PASS",
      mapping_evidence: "PASS",
      join_evidence: "PASS",
      formula_compiler: "PASS",
      query_dry_run: "PASS",
    },
  } as const;
  const policy = await buildSemanticBootstrapPolicyView({
    schema_version: "semantic-bootstrap-policy-view@1.0.0",
    policy_id: policyId,
    policy_revision: 1,
    scope: input.scope,
    semantic_domain: "falcon24",
    mandatory_manifest: {
      manifest_id: id(retainedHash, "semantic-mandatory-manifest", "falcon24"),
      manifest_version: "falcon24-e1-mandatory-manifest@1.0.0",
      manifest_hash: await sha256ContentHash({ package_hash: packageHash, mandatory: true }),
    },
    coverage_policy: {
      policy_id: "falcon24-e1-coverage",
      policy_version: "falcon24-e1-coverage@1.0.0",
      policy_hash: await sha256ContentHash({
        definition_count: input.change_set.assertions.length,
      }),
    },
    lowerability_policy: {
      policy_id: "falcon24-e1-lowerability",
      policy_version: "falcon24-e1-lowerability@1.0.0",
      policy_hash: await sha256ContentHash(input.change_set.validation),
    },
    source_boundary: {
      boundary_id: "falcon24-e1-retained-source",
      boundary_version: "falcon24-e1-retained-source@1.0.0",
      boundary_hash: input.retained.semantics.source_bundle_hash,
    },
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2036-01-01T00:00:00.000Z",
  });
  const workspaceSigner = deterministicSigner(retainedHash, "workspace-admin");
  const platformSigner = deterministicSigner(retainedHash, "platform-attestor");
  const workspacePublicHash = await sha256ContentHash(workspaceSigner.publicMaterial);
  const platformPublicHash = await sha256ContentHash(platformSigner.publicMaterial);
  const workspaceActivationHash = await sha256ContentHash({
    signer: "workspace-admin",
    retained_hash: retainedHash,
  });
  const platformActivationHash = await sha256ContentHash({
    signer: "platform-attestor",
    retained_hash: retainedHash,
  });
  const attestorPrincipal = id(retainedHash, "platform-attestor-principal", "falcon24");
  const workspaceKeyId = `falcon24-e1-workspace-${retainedHash.slice(7, 23)}`;
  const platformKeyId = `falcon24-e1-platform-${retainedHash.slice(7, 23)}`;

  const client = await input.pool.connect();
  try {
    await client.query("begin");
    await setAuthorityContext(client, input.scope, input.principal_id, input.deployment_id);
    await client.query(
      `insert into semantic.semantic_source_revision(
         app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
         source_payload,source_digest,author_principal,change_class)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,1,$5::jsonb,$6::text,$7::uuid,'MAJOR')
       on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        sourceRevisionId,
        sourcePayload,
        sourceDigest,
        input.principal_id,
      ],
    );
    await client.query(
      `insert into semantic.semantic_candidate(
         app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
         current_revision_id,candidate_status)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,$5::uuid,$6::uuid,'PUBLISHING')
       on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        candidateId,
        input.principal_id,
        revisionId,
      ],
    );
    await client.query(
      `insert into semantic.semantic_candidate_revision(
         app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,
         revision_number,source_revision_id,revision_payload,revision_digest,
         author_principal,change_class)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,$5::uuid,1,$6::uuid,
         $7::jsonb,$8::text,$9::uuid,'MAJOR') on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        candidateId,
        revisionId,
        sourceRevisionId,
        { candidate_set_hash: candidateSetHash, packages: [packageEntry] },
        input.change_set.change_set_hash,
        input.principal_id,
      ],
    );
    await client.query(
      `insert into semantic.semantic_graph_projection(
         app_id,tenant_id,environment,semantic_domain,projection_id,graph_id,
         source_revision_id,source_revision_digest,source_digest,registry_digest,
         compiler_version,projection_payload,projection_storage_digest,node_count,edge_count,created_by)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,$5::uuid,$6::uuid,$7::text,
         $8::text,$9::text,'falcon24-e1-bootstrap@1.0.0',$10::jsonb,$11::text,$12::bigint,
         $13::bigint,$14::uuid) on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        projectionId,
        graphId,
        sourceRevisionId,
        sourceDigest,
        input.retained.semantics.source_bundle_hash,
        input.retained.semantics.competency_closure_hash,
        projectionPayload,
        projectionHash,
        projectionPayload.nodes.length,
        projectionPayload.edges.length,
        input.principal_id,
      ],
    );
    await client.query(
      `insert into semantic.ontology_package_candidates(
         app_id,tenant_id,environment,semantic_domain,namespace_id,package_id,package_version,
         package_hash,candidate_id,revision_id,revision_digest,package_json,committed_by)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,$5::uuid,1,$6::text,$7::uuid,
         $8::uuid,$9::text,$10::jsonb,$11::uuid) on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        namespaceId,
        packageId,
        packageHash,
        candidateId,
        revisionId,
        input.change_set.change_set_hash,
        packageMaterial,
        input.principal_id,
      ],
    );
    await client.query(
      `insert into semantic.ontology_package_validation_receipts(
         app_id,tenant_id,environment,semantic_domain,receipt_id,namespace_id,package_id,
         package_version,package_hash,source_binding_hash,compiler_digest,validator_version,
         valid,receipt_json,receipt_hash,committed_by)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,$5::uuid,$6::uuid,1,$7::text,
         $8::text,$9::text,'falcon24-e1-validator@1.0.0',true,$10::jsonb,$11::text,$12::uuid)
       on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        packageValidationId,
        namespaceId,
        packageId,
        packageHash,
        input.retained.semantics.source_bundle_hash,
        input.change_set.change_set_hash,
        packageValidationDocument,
        packageValidationHash,
        input.principal_id,
      ],
    );
    await client.query(
      `insert into semantic.ontology_package_preview_bindings(
         app_id,tenant_id,environment,semantic_domain,preview_id,namespace_id,package_id,
         package_version,package_hash,validation_receipt_id,validation_receipt_hash,
         projection_id,projection_storage_digest,preview_json,preview_hash,committed_by)
       values($1::uuid,$2::uuid,$3::text,'falcon24',$4::uuid,$5::uuid,$6::uuid,1,$7::text,
         $8::uuid,$9::text,$10::uuid,$11::text,$12::jsonb,$13::text,$14::uuid)
       on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        previewId,
        namespaceId,
        packageId,
        packageHash,
        packageValidationId,
        packageValidationHash,
        projectionId,
        projectionHash,
        previewDocument,
        previewHash,
        input.principal_id,
      ],
    );
    await client.query(
      `insert into semantic.semantic_bootstrap_signer_key_revisions(
         app_id,tenant_id,environment,semantic_domain,key_id,key_revision,principal_id,
         signer_role,key_purpose,key_status,public_material,public_material_hash,
         activation_receipt_hash,revocation_epoch)
       values
         ($1::uuid,$2::uuid,$3::text,'falcon24',$4::text,1,$5::uuid,'WORKSPACE_ADMIN',
          'SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE','ACTIVE',$6::jsonb,$7::text,$8::text,0),
         ($1::uuid,$2::uuid,$3::text,'falcon24',$9::text,1,$10::uuid,'PLATFORM_ATTESTOR',
          'PLATFORM_ATTESTATION','ACTIVE',$11::jsonb,$12::text,$13::text,0)
       on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        workspaceKeyId,
        input.principal_id,
        workspaceSigner.publicMaterial,
        workspacePublicHash,
        workspaceActivationHash,
        platformKeyId,
        attestorPrincipal,
        platformSigner.publicMaterial,
        platformPublicHash,
        platformActivationHash,
      ],
    );
    const committedPolicy = await client.query<{ value: unknown }>(
      "select semantic.commit_semantic_bootstrap_policy($1::jsonb) as value",
      [policy],
    );
    const committedPolicyValue = semanticBootstrapPolicyViewSchema.parse(
      committedPolicy.rows[0]?.value,
    );
    if (committedPolicyValue.policy_hash !== policy.policy_hash) {
      throw new TypeError("FALCON24_E1_SEMANTIC_POLICY_COMMIT_INVALID");
    }
    const closure = await client.query<{ count: string }>(
      `select pg_catalog.count(*)::text as count
         from semantic.ontology_package_preview_bindings preview
         join semantic.ontology_package_validation_receipts validation
           using(app_id,tenant_id,environment,semantic_domain,namespace_id,package_id,package_version)
         join semantic.ontology_package_candidates candidate
           using(app_id,tenant_id,environment,semantic_domain,namespace_id,package_id,package_version)
        where preview.app_id=$1::uuid and preview.tenant_id=$2::uuid
          and preview.environment=$3::text and preview.semantic_domain='falcon24'
          and preview.package_hash=$4::text and validation.receipt_hash=$5::text
          and candidate.revision_digest=$6::text`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        packageHash,
        packageValidationHash,
        input.change_set.change_set_hash,
      ],
    );
    if (closure.rows[0]?.count !== "1") {
      throw new TypeError("FALCON24_E1_SEMANTIC_PREREQUISITE_CLOSURE_INVALID");
    }
    const identityClosure = await client.query<{
      source_count: string;
      candidate_count: string;
      revision_count: string;
      projection_count: string;
      signer_count: string;
    }>(
      `select
         (select pg_catalog.count(*)::text from semantic.semantic_source_revision
           where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
             and semantic_domain='falcon24' and revision_id=$4::uuid
             and source_digest=$5::text and source_payload=$6::jsonb) as source_count,
         (select pg_catalog.count(*)::text from semantic.semantic_candidate
           where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
             and semantic_domain='falcon24' and candidate_id=$7::uuid
             and current_revision_id=$8::uuid) as candidate_count,
         (select pg_catalog.count(*)::text from semantic.semantic_candidate_revision
           where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
             and semantic_domain='falcon24' and candidate_id=$7::uuid and revision_id=$8::uuid
             and source_revision_id=$4::uuid and revision_digest=$9::text) as revision_count,
         (select pg_catalog.count(*)::text from semantic.semantic_graph_projection
           where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
             and semantic_domain='falcon24' and projection_id=$10::uuid and graph_id=$11::uuid
             and source_revision_id=$4::uuid and source_revision_digest=$5::text
             and source_digest=$22::text and registry_digest=$23::text
             and projection_storage_digest=$12::text and projection_payload=$13::jsonb) as projection_count,
         (select pg_catalog.count(*)::text from semantic.semantic_bootstrap_signer_key_revisions
           where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
             and semantic_domain='falcon24' and key_status='ACTIVE'
             and ((key_id=$14::text and principal_id=$15::uuid and public_material_hash=$16::text
                   and activation_receipt_hash=$17::text)
               or (key_id=$18::text and principal_id=$19::uuid and public_material_hash=$20::text
                   and activation_receipt_hash=$21::text))) as signer_count`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        sourceRevisionId,
        sourceDigest,
        sourcePayload,
        candidateId,
        revisionId,
        input.change_set.change_set_hash,
        projectionId,
        graphId,
        projectionHash,
        projectionPayload,
        workspaceKeyId,
        input.principal_id,
        workspacePublicHash,
        workspaceActivationHash,
        platformKeyId,
        attestorPrincipal,
        platformPublicHash,
        platformActivationHash,
        input.retained.semantics.source_bundle_hash,
        input.retained.semantics.competency_closure_hash,
      ],
    );
    const exactIdentity = identityClosure.rows[0];
    if (
      exactIdentity?.source_count !== "1" ||
      exactIdentity.candidate_count !== "1" ||
      exactIdentity.revision_count !== "1" ||
      exactIdentity.projection_count !== "1" ||
      exactIdentity.signer_count !== "2"
    ) {
      throw Object.assign(new TypeError("FALCON24_E1_SEMANTIC_PREREQUISITE_IDENTITY_DRIFT"), {
        evidence: exactIdentity,
      });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return {
    candidateRoot,
    packageEntry,
    policy,
    releaseSetId,
    signer: {
      workspace: {
        principal_id: input.principal_id,
        key_id: workspaceKeyId,
        key_revision: 1,
        private_key: workspaceSigner.privateKey,
      },
      platform: {
        principal_id: attestorPrincipal,
        key_id: platformKeyId,
        key_revision: 1,
        private_key: platformSigner.privateKey,
      },
    },
    sourceDigest,
    projectionHash,
  };
}

async function prepareSemanticBootstrap(input: {
  pool: pg.Pool;
  retained: RetainedManifest;
  capability: unknown;
  authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  scope: { app_id: string; tenant_id: string; workspace_id: string; environment: string };
  principal_id: string;
  deployment_id: string;
}) {
  const genesis = {
    release_id: id(input.retained.manifest_hash, "semantic-genesis-release", "falcon24"),
    generation: 0,
    release_hash: await sha256ContentHash({ semantic_domain: "falcon24", generation: 0 }),
  };
  const prepared = await buildFalcon24E1SemanticChangeSet({
    scope: {
      app_id: input.scope.app_id,
      tenant_id: input.scope.tenant_id,
      environment: input.scope.environment,
      semantic_domain: "falcon24",
    },
    base_release: genesis,
    revision: 1,
  });
  if (prepared.assertion_count !== input.retained.semantics.expected_definition_count) {
    throw new TypeError("FALCON24_E1_SEMANTIC_DEFINITION_COUNT_MISMATCH");
  }
  const projection = await compileSemanticPublicationProjection(prepared.change_set);
  const prerequisites = await insertSemanticPrerequisites({
    ...input,
    datasource_id: prepared.datasource_id,
    change_set: prepared.change_set,
    graph_projection: projection,
  });
  const authority = createPostgresGreenfieldBootstrapReleaseAuthority({
    verifier_pool: adaptPgPool(input.pool),
    publisher_pool: adaptPgPool(input.pool),
    authorizer: input.authorizer,
  });
  const policyRef = {
    policy_id: prerequisites.policy.policy_id,
    policy_revision: prerequisites.policy.policy_revision,
    policy_hash: prerequisites.policy.policy_hash,
  };
  const packet = await buildSemanticDomainBootstrapPacket({
    schema_version: "semantic-domain-bootstrap-packet@1.0.0",
    packet_id: id(input.retained.manifest_hash, "semantic-bootstrap-packet", "falcon24"),
    scope: input.scope,
    semantic_domain: "falcon24",
    datasource_id: prepared.datasource_id,
    audience: "SEMANTIC_BOOTSTRAP_VERIFIER",
    candidate_set_root: prerequisites.candidateRoot,
    release_set_id: prerequisites.releaseSetId,
    policy_ref: policyRef,
    nonce_hash: await sha256ContentHash({
      retained_hash: input.retained.manifest_hash,
      staging: "falcon24-e1",
    }),
    issued_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2036-01-01T00:00:00.000Z",
  });
  const packetBytes = Buffer.from(canonicalizeJson(packet), "utf8");
  const workspaceSignature = sign(
    null,
    packetBytes,
    prerequisites.signer.workspace.private_key,
  ).toString("base64url");
  const platformSignature = sign(
    null,
    packetBytes,
    prerequisites.signer.platform.private_key,
  ).toString("base64url");
  const verified =
    (await loadVerifiedDomainReceipt({
      pool: input.pool,
      packet,
      principal_id: input.principal_id,
      deployment_id: input.deployment_id,
      workspace_signature: workspaceSignature,
      platform_signature: platformSignature,
      workspace_signer: prerequisites.signer.workspace,
      platform_signer: prerequisites.signer.platform,
    })) ??
    (required(
      await authority.verifyDomain(input.capability, {
        packet,
        workspace_admin_signature: workspaceSignature,
        platform_attestor_signature: platformSignature,
      }),
    ) as { receipt_id: string; receipt_hash: `sha256:${string}` });
  const grantAuthority = createPostgresPrivilegedGrantAuthority({
    pool: adaptPgPool(input.pool),
    authorizer: input.authorizer,
  });
  const grant = required(
    await grantAuthority.createPublisherGrant(input.capability, {
      schema_version: "semantic-publisher-grant-create-command@1.0.0",
      command_id: id(input.retained.manifest_hash, "semantic-publisher-grant-command", "falcon24"),
      idempotency_key: `falcon24-e1-grant-${input.retained.manifest_hash.slice(7, 31)}`,
      scope: input.scope,
      semantic_domain: "falcon24",
      issuer: {
        principal_id: prerequisites.signer.workspace.principal_id,
        key_id: prerequisites.signer.workspace.key_id,
        key_revision: prerequisites.signer.workspace.key_revision,
      },
      operator_principal_id: input.principal_id,
      audience: "SEMANTIC_BOOTSTRAP_PUBLISHER",
      release_set_id: prerequisites.releaseSetId,
      candidate_set_hash: prerequisites.candidateRoot.candidate_set_hash,
      policy_ref: policyRef,
      revocation_epoch: 0,
      issued_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2036-01-01T00:00:00.000Z",
    }),
  );
  const validation = await buildSemanticBootstrapValidationReceipt({
    schema_version: "semantic-bootstrap-validation-receipt@1.0.0",
    receipt_id: id(input.retained.manifest_hash, "semantic-bootstrap-validation", "falcon24"),
    scope: input.scope,
    semantic_domain: "falcon24",
    candidate_set_root: prerequisites.candidateRoot,
    policy_ref: policyRef,
    schema_snapshot: {
      snapshot_id: id(input.retained.manifest_hash, "schema-snapshot", "falcon-db-24"),
      snapshot_revision: 1,
      snapshot_hash: input.retained.active_dataset.active_subset_hash,
    },
    source_bundle: {
      bundle_id: id(input.retained.manifest_hash, "semantic-source-bundle", "falcon24"),
      bundle_version: 1,
      bundle_hash: input.retained.semantics.source_bundle_hash,
    },
    packages: [prerequisites.packageEntry],
    outcome: "PASS",
    validator_version: "falcon24-e1-validator@1.0.0",
    validated_at: "2026-08-26T00:00:00.000Z",
  });
  const client = await input.pool.connect();
  try {
    await client.query("begin");
    await setAuthorityContext(client, input.scope, input.principal_id, input.deployment_id);
    const result = await client.query<{ value: unknown }>(
      "select semantic.commit_semantic_bootstrap_validation($1::jsonb) as value",
      [validation],
    );
    const committedValidation = semanticBootstrapValidationReceiptSchema.parse(
      result.rows[0]?.value,
    );
    if (committedValidation.receipt_hash !== validation.receipt_hash) {
      throw new TypeError("FALCON24_E1_SEMANTIC_VALIDATION_COMMIT_INVALID");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const releaseSet = await buildInitialSemanticReleaseSet({
    schema_version: "initial-semantic-release-set@1.0.0",
    release_set_id: prerequisites.releaseSetId,
    scope: input.scope,
    semantic_domain: "falcon24",
    release_id: id(input.retained.manifest_hash, "semantic-release", "falcon24"),
    generation: 1,
    base_release_id: null,
    candidate_set_root: prerequisites.candidateRoot,
    policy_ref: policyRef,
    validation_ref: { receipt_id: validation.receipt_id, receipt_hash: validation.receipt_hash },
    packages: [prerequisites.packageEntry],
    runtime_projections: {
      executable: {
        projection_id: id(input.retained.manifest_hash, "runtime-projection", "executable"),
        projection_hash: await sha256ContentHash(projection.executable_projection),
      },
      relationship: {
        projection_id: id(input.retained.manifest_hash, "runtime-projection", "relationship"),
        projection_hash: prerequisites.projectionHash,
      },
      runtime_restriction: {
        projection_id: id(input.retained.manifest_hash, "runtime-projection", "restriction"),
        projection_hash: await sha256ContentHash(projection.restriction_projection),
      },
    },
    published_at: "2026-08-26T00:01:00.000Z",
  });
  return {
    authority,
    definition_keys: prepared.change_set.assertions.map(({ canonical_key: key }) => key).sort(),
    validation_receipt: validation,
    publish_command: {
      schema_version: "publish-initial-semantic-release-command@1.0.0" as const,
      command_id: id(input.retained.manifest_hash, "semantic-publish-command", "falcon24"),
      idempotency_key: `falcon24-e1-publish-${input.retained.manifest_hash.slice(7, 31)}`,
      scope: input.scope,
      semantic_domain: "falcon24",
      verified_domain_ref: {
        receipt_id: verified.receipt_id,
        receipt_hash: verified.receipt_hash,
      },
      policy_ref: policyRef,
      grant_ref: grant.grant_ref,
      validation_ref: {
        receipt_id: validation.receipt_id,
        receipt_hash: validation.receipt_hash,
      },
      release_set: releaseSet,
    },
  };
}

async function ensureModelSecretRef(input: {
  pool: pg.Pool;
  retained_hash: string;
  scope: { app_id: string; tenant_id: string; environment: string };
  principal_id: string;
  deployment_id: string;
}) {
  const secretRefId = id(input.retained_hash, "model-secret-ref", "falcon24-analysis-deepseek");
  const credentialRefId = id(
    input.retained_hash,
    "model-credential-ref",
    "falcon24-analysis-deepseek",
  );
  const client = await input.pool.connect();
  try {
    await client.query("begin");
    await setAuthorityContext(client, input.scope, input.principal_id, input.deployment_id);
    await client.query(
      `insert into app_data_agent.secret_refs(
         app_id,tenant_id,environment,secret_ref_id,owner_principal_id,secret_name,
         provider_ref_hash,version,status)
       values($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,'Falcon24E1ModelApiKey',
         app_data_agent.u2_canonical_sha256(
           pg_catalog.to_jsonb('env:FALCON24_E1_MODEL_API_KEY'::text)),1,'ACTIVE')
       on conflict do nothing`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        secretRefId,
        input.principal_id,
      ],
    );
    const closure = await client.query<{ count: string }>(
      `select pg_catalog.count(*)::text as count
         from app_data_agent.secret_refs
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and secret_ref_id=$4::uuid and owner_principal_id=$5::uuid
          and secret_name='Falcon24E1ModelApiKey'
          and provider_ref_hash=app_data_agent.u2_canonical_sha256(
            pg_catalog.to_jsonb('env:FALCON24_E1_MODEL_API_KEY'::text))
          and version=1 and status='ACTIVE'`,
      [
        input.scope.app_id,
        input.scope.tenant_id,
        input.scope.environment,
        secretRefId,
        input.principal_id,
      ],
    );
    if (closure.rows[0]?.count !== "1") {
      throw new TypeError("FALCON24_E1_MODEL_SECRET_REF_IDENTITY_CONFLICT");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return {
    schema_version: "global-model-credential-ref@1.0.0" as const,
    app_id: input.scope.app_id,
    environment: input.scope.environment,
    credential_ref_id: credentialRefId,
    secret_ref_id: secretRefId,
    secret_version: 1,
    rotation_state: "ACTIVE" as const,
  };
}

async function agentProfileProof(input: {
  retained_hash: string;
  scope: { app_id: string; tenant_id: string; environment: string };
  model_profile_id: string;
  model_config_version: number;
  model_projection_hash: `sha256:${string}`;
}) {
  const resource = async (kind: string, profileId: string, sourceHash: string) => ({
    resource_id: id(input.retained_hash, kind, profileId),
    resource_revision: 1,
    resource_hash: await sha256ContentHash({
      kind,
      profile_id: profileId,
      source_hash: sourceHash,
    }),
  });
  const resourceMap = async (
    kind: string,
    sourceHash: string,
  ): Promise<Readonly<Record<DataAgentSpecialistProfileId, VersionedResourceReference>>> => ({
    "governed-analysis-agent": await resource(kind, "governed-analysis-agent", sourceHash),
    "governed-text2sql-agent": await resource(kind, "governed-text2sql-agent", sourceHash),
    "report-writing-agent": await resource(kind, "report-writing-agent", sourceHash),
    "semantic-management-agent": await resource(kind, "semantic-management-agent", sourceHash),
  });
  const built = await buildBuiltinTeamMaterialization({
    scope: {
      app_id: input.scope.app_id,
      tenant_id: input.scope.tenant_id,
      environment: input.scope.environment,
    },
    model_profile_refs: await resourceMap("disposable-role-model", input.model_projection_hash),
    context_policy_refs: await resourceMap("disposable-context-policy", input.retained_hash),
    execution_safety_policy_refs: await resourceMap(
      "disposable-safety-policy",
      input.retained_hash,
    ),
  });
  return {
    schema_version: "falcon24-e1-agent-profile-build-proof@1.0.0" as const,
    source_model_profile_id: input.model_profile_id,
    source_model_config_version: input.model_config_version,
    source_model_projection_hash: input.model_projection_hash,
    profile_count: 4 as const,
    profile_bundle_hash: await sha256ContentHash({
      profile_revisions: built.profile_revisions.map((profile) => profile.revision_hash),
      skill_revisions: built.skill_revisions.map((skill) => skill.revision_hash),
    }),
    materialized: false as const,
  };
}

export async function runFalcon24E1Bootstrap(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  if (environment[CONFIRMATION_VARIABLE] !== "YES") {
    return {
      schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0" as const,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_E1_BOOTSTRAP_CONFIRMATION_REQUIRED" as const,
    };
  }
  const configuration = configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    workspace_id: environment.WORKER_TENANT_ID ?? DEFAULT_WORKSPACE_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    staging_id: environment.FALCON24_E1_STAGING_ID ?? DEFAULT_STAGING_ID,
    environment: environment.FALCON24_E1_ENVIRONMENT ?? "local",
    model_api_key: environment.FALCON24_E1_MODEL_API_KEY,
  });
  if (
    environment.NODE_ENV === "production" ||
    configuration.environment === "prod" ||
    configuration.environment === "production"
  ) {
    throw new TypeError("FALCON24_E1_PRODUCTION_SIGNER_PROVISION_REQUIRED");
  }
  const root = REPOSITORY_ROOT;
  const retained = await verifyFalcon24RetainedAssetsManifest(
    json(resolve(root, "infra/falcon/e1/retained-assets-manifest.json")),
  );
  const llmManifest = json(resolve(root, retained.llm.manifest_path));
  const runtimeAttestation = await verifyOpenSandboxAnalysisAttestation(root);
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    application_name: "data-agent-falcon24-e1-bootstrap",
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
    const capability = required(
      await capabilityAuthority.resolveForServerContext({
        deployment_id: configuration.deployment_id,
        tenant_id: configuration.workspace_id,
        principal_id: configuration.principal_id,
        access: "WRITE",
      }),
    );
    if (
      capability.scope.app_id !== APP_ID ||
      capability.scope.environment !== configuration.environment
    ) {
      throw new TypeError("FALCON24_E1_BOOTSTRAP_SCOPE_MISMATCH");
    }
    const scope = {
      app_id: capability.scope.app_id,
      tenant_id: capability.scope.tenant_id,
      workspace_id: capability.scope.tenant_id,
      environment: capability.scope.environment,
    };
    const semantic = await prepareSemanticBootstrap({
      pool,
      retained,
      capability,
      authorizer: capabilityAuthority.authorizer,
      scope,
      principal_id: configuration.principal_id,
      deployment_id: configuration.deployment_id,
    });
    const credentialRef = configuration.model_api_key
      ? await ensureModelSecretRef({
          pool,
          retained_hash: retained.manifest_hash,
          scope,
          principal_id: configuration.principal_id,
          deployment_id: configuration.deployment_id,
        })
      : null;
    const result = await bootstrapFalcon24E1(
      {
        capability,
        admin_context: {
          deployment_id: configuration.deployment_id,
          principal_id: configuration.principal_id,
        },
        staging_id: configuration.staging_id,
        retained_manifest: retained,
        llm_manifest: llmManifest,
        llm_manifest_hash: retained.llm.manifest_hash,
        credential_ref: credentialRef,
        semantic: {
          definition_keys: semantic.definition_keys,
          source_bundle_hash: retained.semantics.source_bundle_hash,
          validation_receipt: semantic.validation_receipt,
          publish_command: semantic.publish_command,
          forbidden_release_ids: [],
          forbidden_release_hashes: [],
        },
        forbidden_model_profile_ids: [],
        forbidden_certification_refs: [],
        runtime_attestation: runtimeAttestation,
      },
      {
        semantic_authority: semantic.authority,
        model_control: createPostgresModelControlRepository(sqlPool),
        epoch_authority: createPostgresFalcon24AuthorityEpoch({
          pool: sqlPool,
          authorizer: capabilityAuthority.authorizer,
        }),
        async authenticate_model({ model }) {
          const apiKey = configuration.model_api_key;
          if (!apiKey) throw new TypeError("FALCON24_E1_MODEL_API_KEY_REQUIRED");
          const discovered = await fetchProviderModelCatalog({
            vendorId: "deepseek",
            baseUrl: model.base_url,
            apiKey,
          });
          if (!discovered.some(({ id: discoveredId }) => discoveredId === model.model_id)) {
            throw new TypeError("FALCON24_E1_MODEL_ID_NOT_AUTHENTICATED");
          }
          return { response_item_count: discovered.length };
        },
        build_agent_profiles: (model) =>
          agentProfileProof({ retained_hash: retained.manifest_hash, scope, ...model }),
      },
    );
    return {
      schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0" as const,
      terminal: result.terminal,
      bootstrap: result,
      production_readiness: result.runtime_attestation.production_isolation_proven ? "GO" : "HOLD",
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const result = await runFalcon24E1Bootstrap();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.terminal === "NOT_RUN") process.exitCode = 2;
  } catch (error) {
    const reasonCode =
      error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
        ? error.message
        : "FALCON24_E1_BOOTSTRAP_FAILED";
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0",
        terminal: "HOLD",
        reason_code: reasonCode,
        production_readiness: "HOLD",
      })}\n`,
    );
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (executedPath === fileURLToPath(import.meta.url)) await main();
