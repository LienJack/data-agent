import { generateKeyPairSync, sign } from "node:crypto";
import {
  buildFirstReleaseAdmissionReceipt,
  buildInitialSemanticReleaseSet,
  buildSemanticBootstrapCapabilityTombstone,
  buildSemanticBootstrapPolicyView,
  buildSemanticBootstrapValidationReceipt,
  buildSemanticDomainBootstrapPacket,
  buildSemanticPackageAdmissionReceipt,
  buildVerifiedDomainBootstrapReceipt,
  canonicalizeJson,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresGreenfieldBootstrapReleaseAuthority } from "../../src/semantic/greenfield-bootstrap-release-authority.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const H = (character: string) => `sha256:${character.repeat(64)}` as const;
const ids = {
  app: "00000000-0000-4000-8000-000000000601",
  tenant: "00000000-0000-4000-8000-000000000602",
  deployment: "00000000-0000-4000-8000-000000000603",
  principal: "00000000-0000-4000-8000-000000000604",
  attestor: "00000000-0000-4000-8000-000000000605",
  policy: "00000000-0000-4000-8000-000000000606",
  packet: "00000000-0000-4000-8000-000000000607",
  candidate: "00000000-0000-4000-8000-000000000608",
  revision: "00000000-0000-4000-8000-000000000609",
  releaseSet: "00000000-0000-4000-8000-000000000610",
  receipt: "00000000-0000-4000-8000-000000000611",
  datasource: "00000000-0000-4000-8000-000000000612",
} as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "OWNER",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!capability.ok) throw new Error("test Authority missing");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const result = handle(text, values);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

async function fixture() {
  const scope = {
    app_id: ids.app,
    tenant_id: ids.tenant,
    workspace_id: ids.tenant,
    environment: "test",
  } as const;
  const policy = await buildSemanticBootstrapPolicyView({
    schema_version: "semantic-bootstrap-policy-view@1.0.0",
    policy_id: ids.policy,
    policy_revision: 1,
    scope,
    semantic_domain: "commerce",
    mandatory_manifest: {
      manifest_id: ids.candidate,
      manifest_version: "mandatory-release-manifest@1.0.0",
      manifest_hash: H("1"),
    },
    coverage_policy: {
      policy_id: "coverage",
      policy_version: "coverage@1.0.0",
      policy_hash: H("2"),
    },
    lowerability_policy: {
      policy_id: "lowerability",
      policy_version: "lowerability@1.0.0",
      policy_hash: H("3"),
    },
    source_boundary: {
      boundary_id: "source-boundary",
      boundary_version: "source-boundary@1.0.0",
      boundary_hash: H("4"),
    },
    valid_from: "2026-08-17T00:00:00.000Z",
    valid_until: "2026-08-18T00:00:00.000Z",
  });
  const candidateSetRoot = {
    candidate_id: ids.candidate,
    revision_id: ids.revision,
    revision: 1,
    revision_digest: H("5"),
    candidate_set_hash: H("6"),
  } as const;
  const packet = await buildSemanticDomainBootstrapPacket({
    schema_version: "semantic-domain-bootstrap-packet@1.0.0",
    packet_id: ids.packet,
    scope,
    semantic_domain: "commerce",
    datasource_id: ids.datasource,
    audience: "SEMANTIC_BOOTSTRAP_VERIFIER",
    candidate_set_root: candidateSetRoot,
    release_set_id: ids.releaseSet,
    policy_ref: {
      policy_id: policy.policy_id,
      policy_revision: policy.policy_revision,
      policy_hash: policy.policy_hash,
    },
    nonce_hash: H("7"),
    issued_at: "2026-08-17T00:01:00.000Z",
    expires_at: "2026-08-17T00:11:00.000Z",
  });
  const workspaceAdmin = generateKeyPairSync("ed25519");
  const platformAttestor = generateKeyPairSync("ed25519");
  const packetBytes = Buffer.from(canonicalizeJson(packet), "utf8");
  const workspaceSignature = sign(null, packetBytes, workspaceAdmin.privateKey).toString(
    "base64url",
  );
  const platformSignature = sign(null, packetBytes, platformAttestor.privateKey).toString(
    "base64url",
  );
  const workspaceJwk = workspaceAdmin.publicKey.export({ format: "jwk" });
  const platformJwk = platformAttestor.publicKey.export({ format: "jwk" });
  const workspacePublic = { format: "JWK" as const, ...workspaceJwk };
  const platformPublic = { format: "JWK" as const, ...platformJwk };
  const workspaceMaterialHash = await sha256ContentHash(workspacePublic);
  const platformMaterialHash = await sha256ContentHash(platformPublic);
  const workspaceSignatureHash = await sha256ContentHash(workspaceSignature);
  const platformSignatureHash = await sha256ContentHash(platformSignature);
  const signerContext = {
    workspace_admin: {
      principal_id: ids.principal,
      key_id: "workspace-admin-key",
      key_revision: 1,
      role: "WORKSPACE_ADMIN",
      purpose: "SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE",
      status: "ACTIVE",
      public_material: workspacePublic,
      public_material_hash: workspaceMaterialHash,
      activation_receipt_hash: H("8"),
    },
    platform_attestor: {
      principal_id: ids.attestor,
      key_id: "platform-attestor-key",
      key_revision: 1,
      role: "PLATFORM_ATTESTOR",
      purpose: "PLATFORM_ATTESTATION",
      status: "ACTIVE",
      public_material: platformPublic,
      public_material_hash: platformMaterialHash,
      activation_receipt_hash: H("9"),
    },
  } as const;
  const receipt = await buildVerifiedDomainBootstrapReceipt({
    schema_version: "verified-domain-bootstrap-receipt@1.0.0",
    receipt_id: ids.receipt,
    scope,
    semantic_domain: "commerce",
    datasource_id: ids.datasource,
    packet_digest: packet.packet_digest,
    candidate_set_root: candidateSetRoot,
    release_set_id: ids.releaseSet,
    policy_ref: packet.policy_ref,
    workspace_admin: {
      principal_id: ids.principal,
      key_id: "workspace-admin-key",
      key_revision: 1,
      public_material_hash: workspaceMaterialHash,
      activation_receipt_hash: H("8"),
      signature_hash: workspaceSignatureHash,
    },
    platform_attestor: {
      principal_id: ids.attestor,
      key_id: "platform-attestor-key",
      key_revision: 1,
      public_material_hash: platformMaterialHash,
      activation_receipt_hash: H("9"),
      signature_hash: platformSignatureHash,
    },
    nonce_hash: packet.nonce_hash,
    issued_at: packet.issued_at,
    expires_at: packet.expires_at,
    verified_at: "2026-08-17T00:02:00.000Z",
  });
  return {
    packet,
    signerContext,
    receipt,
    workspaceSignature,
    platformSignature,
  };
}

async function publishedBundleFixture() {
  const signed = await fixture();
  const scope = signed.packet.scope;
  const packageEntry = {
    namespace_id: "00000000-0000-4000-8000-000000000620",
    package_id: "00000000-0000-4000-8000-000000000621",
    package_version: 1,
    package_hash: H("a"),
    candidate_revision: signed.packet.candidate_set_root,
    validation_receipt: {
      receipt_id: "00000000-0000-4000-8000-000000000622",
      receipt_hash: H("b"),
    },
    preview_binding: {
      preview_id: "00000000-0000-4000-8000-000000000623",
      preview_hash: H("c"),
      projection_id: "00000000-0000-4000-8000-000000000624",
      projection_hash: H("d"),
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
  const validation = await buildSemanticBootstrapValidationReceipt({
    schema_version: "semantic-bootstrap-validation-receipt@1.0.0",
    receipt_id: "00000000-0000-4000-8000-000000000625",
    scope,
    semantic_domain: signed.packet.semantic_domain,
    candidate_set_root: signed.packet.candidate_set_root,
    policy_ref: signed.packet.policy_ref,
    schema_snapshot: {
      snapshot_id: "00000000-0000-4000-8000-000000000626",
      snapshot_revision: 1,
      snapshot_hash: H("e"),
    },
    source_bundle: {
      bundle_id: "00000000-0000-4000-8000-000000000627",
      bundle_version: 1,
      bundle_hash: H("f"),
    },
    packages: [packageEntry],
    outcome: "PASS",
    validator_version: "semantic-bootstrap-validator@1.0.0",
    validated_at: "2026-08-17T00:03:00.000Z",
  });
  const releaseSet = await buildInitialSemanticReleaseSet({
    schema_version: "initial-semantic-release-set@1.0.0",
    release_set_id: signed.packet.release_set_id,
    scope,
    semantic_domain: signed.packet.semantic_domain,
    release_id: "00000000-0000-4000-8000-000000000628",
    generation: 1,
    base_release_id: null,
    candidate_set_root: signed.packet.candidate_set_root,
    policy_ref: signed.packet.policy_ref,
    validation_ref: {
      receipt_id: validation.receipt_id,
      receipt_hash: validation.receipt_hash,
    },
    packages: validation.packages,
    runtime_projections: {
      executable: {
        projection_id: "00000000-0000-4000-8000-000000000629",
        projection_hash: H("1"),
      },
      relationship: {
        projection_id: "00000000-0000-4000-8000-000000000630",
        projection_hash: H("2"),
      },
      runtime_restriction: {
        projection_id: "00000000-0000-4000-8000-000000000631",
        projection_hash: H("3"),
      },
    },
    published_at: "2026-08-17T00:04:00.000Z",
  });
  const releasePackage = releaseSet.packages[0];
  if (releasePackage === undefined) throw new Error("fixture release package missing");
  const admission = await buildSemanticPackageAdmissionReceipt({
    schema_version: "semantic-package-admission-receipt@1.0.0",
    receipt_id: "00000000-0000-4000-8000-000000000632",
    scope,
    semantic_domain: signed.packet.semantic_domain,
    release_set_ref: {
      release_set_id: releaseSet.release_set_id,
      release_set_hash: releaseSet.release_set_hash,
    },
    package: releasePackage,
    admission: "ADMITTED",
    admitted_at: releaseSet.published_at,
  });
  const firstRelease = await buildFirstReleaseAdmissionReceipt({
    schema_version: "first-release-admission-receipt@1.0.0",
    receipt_id: "00000000-0000-4000-8000-000000000633",
    scope,
    semantic_domain: signed.packet.semantic_domain,
    approval_mode: "SYSTEM_BOOTSTRAP_POLICY",
    release_set_ref: admission.release_set_ref,
    policy_ref: signed.packet.policy_ref,
    verified_domain_ref: {
      receipt_id: signed.receipt.receipt_id,
      receipt_hash: signed.receipt.receipt_hash,
    },
    validation_ref: releaseSet.validation_ref,
    grant_ref: {
      grant_id: "00000000-0000-4000-8000-000000000634",
      grant_hash: H("4"),
    },
    package_admissions: [
      {
        receipt_id: admission.receipt_id,
        receipt_hash: admission.receipt_hash,
        package_id: admission.package.package_id,
        package_version: admission.package.package_version,
        package_hash: admission.package.package_hash,
      },
    ],
    decision_set_digest: releaseSet.release_set_hash,
    admitted_at: releaseSet.published_at,
  });
  const tombstone = await buildSemanticBootstrapCapabilityTombstone({
    schema_version: "semantic-bootstrap-capability-tombstone@1.0.0",
    tombstone_id: "00000000-0000-4000-8000-000000000635",
    scope,
    semantic_domain: signed.packet.semantic_domain,
    release_set_ref: admission.release_set_ref,
    first_release_receipt_ref: {
      receipt_id: firstRelease.receipt_id,
      receipt_hash: firstRelease.receipt_hash,
    },
    consumed_grant_ref: firstRelease.grant_ref,
    closed_at: releaseSet.published_at,
  });
  const command = {
    schema_version: "publish-initial-semantic-release-command@1.0.0",
    command_id: "00000000-0000-4000-8000-000000000636",
    idempotency_key: "u5-platform-publish-0001",
    scope,
    semantic_domain: signed.packet.semantic_domain,
    verified_domain_ref: firstRelease.verified_domain_ref,
    policy_ref: firstRelease.policy_ref,
    grant_ref: firstRelease.grant_ref,
    validation_ref: firstRelease.validation_ref,
    release_set: releaseSet,
  } as const;
  return { admission, command, firstRelease, releaseSet, tombstone };
}

describe("PostgreSQL Greenfield Bootstrap Release Authority", () => {
  it("verifies both Ed25519 signatures before committing only hash-safe material", async () => {
    const access = authority();
    const input = await fixture();
    const scripted = scriptedPool((text) => {
      if (text.includes("load_semantic_bootstrap_signer_context")) {
        return { rows: [{ value: input.signerContext }], rowCount: 1 };
      }
      if (text.includes("commit_verified_semantic_domain_bootstrap")) {
        return { rows: [{ value: input.receipt }], rowCount: 1 };
      }
      return undefined;
    });
    const result = await createPostgresGreenfieldBootstrapReleaseAuthority({
      verifier_pool: scripted.pool,
      publisher_pool: scripted.pool,
      authorizer: access.authorizer,
    }).verifyDomain(access.capability, {
      packet: input.packet,
      workspace_admin_signature: input.workspaceSignature,
      platform_attestor_signature: input.platformSignature,
    });
    expect(result).toEqual({ ok: true, value: input.receipt });
    const commit = scripted.calls.find((call) =>
      call.text.includes("commit_verified_semantic_domain_bootstrap"),
    );
    expect(commit).toBeDefined();
    expect(JSON.stringify(commit?.values)).not.toContain(input.workspaceSignature);
    expect(JSON.stringify(commit?.values)).not.toContain(input.platformSignature);
  });

  it("rejects a substituted signature before the commit RPC", async () => {
    const access = authority();
    const input = await fixture();
    const scripted = scriptedPool((text) =>
      text.includes("load_semantic_bootstrap_signer_context")
        ? { rows: [{ value: input.signerContext }], rowCount: 1 }
        : undefined,
    );
    const result = await createPostgresGreenfieldBootstrapReleaseAuthority({
      verifier_pool: scripted.pool,
      publisher_pool: scripted.pool,
      authorizer: access.authorizer,
    }).verifyDomain(access.capability, {
      packet: input.packet,
      workspace_admin_signature: input.platformSignature,
      platform_attestor_signature: input.platformSignature,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_BOOTSTRAP_SIGNATURE_INVALID", retryable: false },
    });
    expect(
      scripted.calls.some((call) =>
        call.text.includes("commit_verified_semantic_domain_bootstrap"),
      ),
    ).toBe(false);
  });

  it("rejects a self-consistent but substituted database receipt", async () => {
    const access = authority();
    const input = await fixture();
    const substituted = await buildVerifiedDomainBootstrapReceipt({
      ...input.receipt,
      receipt_hash: undefined,
      release_set_id: "00000000-0000-4000-8000-000000000699",
    });
    const scripted = scriptedPool((text) => {
      if (text.includes("load_semantic_bootstrap_signer_context")) {
        return { rows: [{ value: input.signerContext }], rowCount: 1 };
      }
      if (text.includes("commit_verified_semantic_domain_bootstrap")) {
        return { rows: [{ value: substituted }], rowCount: 1 };
      }
      return undefined;
    });
    const result = await createPostgresGreenfieldBootstrapReleaseAuthority({
      verifier_pool: scripted.pool,
      publisher_pool: scripted.pool,
      authorizer: access.authorizer,
    }).verifyDomain(access.capability, {
      packet: input.packet,
      workspace_admin_signature: input.workspaceSignature,
      platform_attestor_signature: input.platformSignature,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_BOOTSTRAP_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("rejects a publish bundle whose first-release receipt hash is substituted", async () => {
    const access = authority();
    const fixture = await publishedBundleFixture();
    const resultValue = {
      schema_version: "publish-initial-semantic-release-result@1.0.0",
      disposition: "CREATED",
      request_hash: await sha256ContentHash(fixture.command),
      release_set: fixture.releaseSet,
      package_admissions: [fixture.admission],
      first_release_receipt: { ...fixture.firstRelease, receipt_hash: H("9") },
      tombstone: fixture.tombstone,
    };
    const scripted = scriptedPool((text) =>
      text.includes("publish_initial_semantic_release_set")
        ? { rows: [{ value: resultValue }], rowCount: 1 }
        : undefined,
    );
    const result = await createPostgresGreenfieldBootstrapReleaseAuthority({
      verifier_pool: scripted.pool,
      publisher_pool: scripted.pool,
      authorizer: access.authorizer,
    }).publishInitial(access.capability, fixture.command);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_BOOTSTRAP_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });
});
