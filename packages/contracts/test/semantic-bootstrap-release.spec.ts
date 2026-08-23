import { describe, expect, it } from "vitest";
import {
  buildFirstReleaseAdmissionReceipt,
  buildInitialSemanticReleaseSet,
  buildSemanticBootstrapCapabilityTombstone,
  buildSemanticBootstrapPolicyView,
  buildSemanticBootstrapValidationReceipt,
  buildSemanticPackageAdmissionReceipt,
  buildVerifiedDomainBootstrapReceipt,
  firstReleaseAdmissionReceiptSchema,
  publishInitialSemanticReleaseCommandSchema,
  semanticBootstrapPolicyViewSchema,
  semanticPublisherGrantReferenceSchema,
  verifyFirstReleaseAdmissionReceipt,
  verifyInitialSemanticReleaseSet,
  verifyPublishedInitialSemanticReleaseBundle,
  verifySemanticBootstrapValidationReceipt,
  verifySemanticPackageAdmissionReceipt,
  verifyVerifiedDomainBootstrapReceipt,
} from "../src/semantic/semantic-bootstrap-release.js";

const H = (character: string) => `sha256:${character.repeat(64)}` as const;

const scope = {
  app_id: "00000000-0000-4000-8000-000000000501",
  tenant_id: "00000000-0000-4000-8000-000000000502",
  workspace_id: "00000000-0000-4000-8000-000000000502",
  environment: "test",
} as const;

const policyInput = {
  schema_version: "semantic-bootstrap-policy-view@1.0.0" as const,
  policy_id: "00000000-0000-4000-8000-000000000503",
  policy_revision: 1,
  scope,
  semantic_domain: "commerce",
  mandatory_manifest: {
    manifest_id: "00000000-0000-4000-8000-000000000504",
    manifest_version: "mandatory-release-manifest@1.0.0",
    manifest_hash: H("4"),
  },
  coverage_policy: {
    policy_id: "semantic-coverage-floor",
    policy_version: "semantic-coverage-floor@1.0.0",
    policy_hash: H("5"),
  },
  lowerability_policy: {
    policy_id: "semantic-lowerability",
    policy_version: "semantic-lowerability@1.0.0",
    policy_hash: H("6"),
  },
  source_boundary: {
    boundary_id: "semantic-bootstrap-source-boundary",
    boundary_version: "semantic-bootstrap-source-boundary@1.0.0",
    boundary_hash: H("7"),
  },
  valid_from: "2026-08-17T00:00:00.000Z",
  valid_until: "2026-08-18T00:00:00.000Z",
} as const;

const candidateRoot = {
  candidate_id: "00000000-0000-4000-8000-000000000505",
  revision_id: "00000000-0000-4000-8000-000000000506",
  revision: 1,
  revision_digest: H("8"),
  candidate_set_hash: H("9"),
} as const;

function packageEntry(suffix: "a" | "b") {
  const isA = suffix === "a";
  return {
    namespace_id: isA
      ? "00000000-0000-4000-8000-00000000050a"
      : "00000000-0000-4000-8000-00000000050b",
    package_id: isA
      ? "00000000-0000-4000-8000-00000000051a"
      : "00000000-0000-4000-8000-00000000051b",
    package_version: 1,
    package_hash: H(isA ? "a" : "b"),
    candidate_revision: candidateRoot,
    validation_receipt: {
      receipt_id: isA
        ? "00000000-0000-4000-8000-00000000052a"
        : "00000000-0000-4000-8000-00000000052b",
      receipt_hash: H(isA ? "c" : "d"),
    },
    preview_binding: {
      preview_id: isA
        ? "00000000-0000-4000-8000-00000000053a"
        : "00000000-0000-4000-8000-00000000053b",
      preview_hash: H(isA ? "e" : "f"),
      projection_id: isA
        ? "00000000-0000-4000-8000-00000000054a"
        : "00000000-0000-4000-8000-00000000054b",
      projection_hash: H(isA ? "1" : "2"),
    },
    mandatory: isA,
    gates: {
      coverage: "PASS" as const,
      lowerability: "PASS" as const,
      source_boundary: "PASS" as const,
      mapping_evidence: "PASS" as const,
      join_evidence: "PASS" as const,
      formula_compiler: "PASS" as const,
      query_dry_run: "PASS" as const,
    },
  };
}

async function authorityFixture() {
  const policy = await buildSemanticBootstrapPolicyView(policyInput);
  const verifiedDomain = await buildVerifiedDomainBootstrapReceipt({
    schema_version: "verified-domain-bootstrap-receipt@1.0.0",
    receipt_id: "00000000-0000-4000-8000-000000000507",
    scope,
    semantic_domain: "commerce",
    datasource_id: "00000000-0000-4000-8000-000000000519",
    packet_digest: H("0"),
    candidate_set_root: candidateRoot,
    release_set_id: "00000000-0000-4000-8000-000000000508",
    policy_ref: {
      policy_id: policy.policy_id,
      policy_revision: policy.policy_revision,
      policy_hash: policy.policy_hash,
    },
    workspace_admin: {
      principal_id: "00000000-0000-4000-8000-000000000509",
      key_id: "workspace-admin-key",
      key_revision: 1,
      public_material_hash: H("1"),
      activation_receipt_hash: H("2"),
      signature_hash: H("3"),
    },
    platform_attestor: {
      principal_id: "00000000-0000-4000-8000-00000000050c",
      key_id: "platform-attestor-key",
      key_revision: 1,
      public_material_hash: H("a"),
      activation_receipt_hash: H("b"),
      signature_hash: H("c"),
    },
    nonce_hash: H("d"),
    issued_at: "2026-08-17T00:01:00.000Z",
    expires_at: "2026-08-17T00:11:00.000Z",
    verified_at: "2026-08-17T00:02:00.000Z",
  });
  const validation = await buildSemanticBootstrapValidationReceipt({
    schema_version: "semantic-bootstrap-validation-receipt@1.0.0",
    receipt_id: "00000000-0000-4000-8000-00000000050d",
    scope,
    semantic_domain: "commerce",
    candidate_set_root: candidateRoot,
    policy_ref: verifiedDomain.policy_ref,
    schema_snapshot: {
      snapshot_id: "00000000-0000-4000-8000-00000000050e",
      snapshot_revision: 1,
      snapshot_hash: H("e"),
    },
    source_bundle: {
      bundle_id: "00000000-0000-4000-8000-00000000050f",
      bundle_version: 1,
      bundle_hash: H("f"),
    },
    packages: [packageEntry("b"), packageEntry("a")],
    outcome: "PASS",
    validator_version: "semantic-bootstrap-validator@1.0.0",
    validated_at: "2026-08-17T00:03:00.000Z",
  });
  const releaseSet = await buildInitialSemanticReleaseSet({
    schema_version: "initial-semantic-release-set@1.0.0",
    release_set_id: verifiedDomain.release_set_id,
    scope,
    semantic_domain: "commerce",
    release_id: "00000000-0000-4000-8000-000000000510",
    generation: 1,
    base_release_id: null,
    candidate_set_root: candidateRoot,
    policy_ref: verifiedDomain.policy_ref,
    validation_ref: {
      receipt_id: validation.receipt_id,
      receipt_hash: validation.receipt_hash,
    },
    packages: validation.packages,
    runtime_projections: {
      executable: {
        projection_id: "00000000-0000-4000-8000-000000000511",
        projection_hash: H("1"),
      },
      relationship: {
        projection_id: "00000000-0000-4000-8000-000000000512",
        projection_hash: H("2"),
      },
      runtime_restriction: {
        projection_id: "00000000-0000-4000-8000-000000000513",
        projection_hash: H("3"),
      },
    },
    published_at: "2026-08-17T00:04:00.000Z",
  });
  return { policy, verifiedDomain, validation, releaseSet };
}

describe("Semantic bootstrap release contracts", () => {
  it("canonicalizes package order and rejects duplicate package identities", async () => {
    const first = await authorityFixture();
    const secondValidation = await buildSemanticBootstrapValidationReceipt({
      ...first.validation,
      receipt_hash: undefined,
      packages: [...first.validation.packages].reverse(),
    });
    expect(secondValidation.receipt_hash).toBe(first.validation.receipt_hash);
    expect(secondValidation.packages.map((entry) => entry.package_id)).toEqual(
      first.validation.packages.map((entry) => entry.package_id),
    );
    await expect(verifySemanticBootstrapValidationReceipt(secondValidation)).resolves.toBe(true);

    await expect(
      buildSemanticBootstrapValidationReceipt({
        ...first.validation,
        receipt_hash: undefined,
        packages: [first.validation.packages[0], first.validation.packages[0]],
      }),
    ).rejects.toThrow(/duplicate|重复/i);
  });

  it("rejects same-principal, same-key and same-public-material signer substitution", async () => {
    const { verifiedDomain } = await authorityFixture();
    for (const platformAttestor of [
      {
        ...verifiedDomain.platform_attestor,
        principal_id: verifiedDomain.workspace_admin.principal_id,
      },
      { ...verifiedDomain.platform_attestor, key_id: verifiedDomain.workspace_admin.key_id },
      {
        ...verifiedDomain.platform_attestor,
        public_material_hash: verifiedDomain.workspace_admin.public_material_hash,
      },
    ]) {
      await expect(
        buildVerifiedDomainBootstrapReceipt({
          ...verifiedDomain,
          receipt_hash: undefined,
          platform_attestor: platformAttestor,
        }),
      ).rejects.toThrow(/signer|principal|key|material/i);
    }
  });

  it("strictly rejects raw signatures, private keys and usable grant nonces", async () => {
    await expect(
      semanticBootstrapPolicyViewSchema.parseAsync({ ...policyInput, private_key: "secret" }),
    ).rejects.toThrow();
    await expect(
      semanticPublisherGrantReferenceSchema.parseAsync({
        grant_id: "00000000-0000-4000-8000-000000000514",
        grant_hash: H("4"),
        nonce: "usable-nonce",
      }),
    ).rejects.toThrow();
    const { verifiedDomain } = await authorityFixture();
    await expect(
      buildVerifiedDomainBootstrapReceipt({
        ...verifiedDomain,
        receipt_hash: undefined,
        workspace_admin: { ...verifiedDomain.workspace_admin, signature: "raw-signature" },
      }),
    ).rejects.toThrow();
  });

  it("builds and verifies one exact first-release closure", async () => {
    const { policy, verifiedDomain, validation, releaseSet } = await authorityFixture();
    const admissions = await Promise.all(
      releaseSet.packages.map((entry, index) =>
        buildSemanticPackageAdmissionReceipt({
          schema_version: "semantic-package-admission-receipt@1.0.0",
          receipt_id:
            index === 0
              ? "00000000-0000-4000-8000-000000000515"
              : "00000000-0000-4000-8000-000000000516",
          scope,
          semantic_domain: "commerce",
          release_set_ref: {
            release_set_id: releaseSet.release_set_id,
            release_set_hash: releaseSet.release_set_hash,
          },
          package: entry,
          admission: "ADMITTED",
          admitted_at: "2026-08-17T00:04:00.000Z",
        }),
      ),
    );
    const firstRelease = await buildFirstReleaseAdmissionReceipt({
      schema_version: "first-release-admission-receipt@1.0.0",
      receipt_id: "00000000-0000-4000-8000-000000000517",
      scope,
      semantic_domain: "commerce",
      approval_mode: "SYSTEM_BOOTSTRAP_POLICY",
      release_set_ref: {
        release_set_id: releaseSet.release_set_id,
        release_set_hash: releaseSet.release_set_hash,
      },
      policy_ref: verifiedDomain.policy_ref,
      verified_domain_ref: {
        receipt_id: verifiedDomain.receipt_id,
        receipt_hash: verifiedDomain.receipt_hash,
      },
      validation_ref: {
        receipt_id: validation.receipt_id,
        receipt_hash: validation.receipt_hash,
      },
      grant_ref: {
        grant_id: "00000000-0000-4000-8000-000000000514",
        grant_hash: H("4"),
      },
      package_admissions: admissions.map((receipt) => ({
        receipt_id: receipt.receipt_id,
        receipt_hash: receipt.receipt_hash,
        package_id: receipt.package.package_id,
        package_version: receipt.package.package_version,
        package_hash: receipt.package.package_hash,
      })),
      decision_set_digest: releaseSet.release_set_hash,
      admitted_at: "2026-08-17T00:04:00.000Z",
    });
    const tombstone = await buildSemanticBootstrapCapabilityTombstone({
      schema_version: "semantic-bootstrap-capability-tombstone@1.0.0",
      tombstone_id: "00000000-0000-4000-8000-000000000518",
      scope,
      semantic_domain: "commerce",
      release_set_ref: firstRelease.release_set_ref,
      first_release_receipt_ref: {
        receipt_id: firstRelease.receipt_id,
        receipt_hash: firstRelease.receipt_hash,
      },
      consumed_grant_ref: firstRelease.grant_ref,
      closed_at: "2026-08-17T00:04:00.000Z",
    });
    const firstAdmission = admissions[0];
    if (firstAdmission === undefined) throw new Error("fixture admission missing");

    await expect(verifyVerifiedDomainBootstrapReceipt(verifiedDomain)).resolves.toBe(true);
    await expect(verifyInitialSemanticReleaseSet(releaseSet)).resolves.toBe(true);
    await Promise.all(admissions.map(verifySemanticPackageAdmissionReceipt));
    await expect(
      verifyFirstReleaseAdmissionReceipt({
        receipt: firstRelease,
        release_set: releaseSet,
        policy,
        verified_domain: verifiedDomain,
        validation,
        package_admissions: admissions,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyPublishedInitialSemanticReleaseBundle({
        release_set: releaseSet,
        package_admissions: admissions,
        first_release_receipt: firstRelease,
        tombstone,
      }),
    ).resolves.toBe(true);

    const tampered = firstReleaseAdmissionReceiptSchema.parse({
      ...firstRelease,
      decision_set_digest: H("9"),
    });
    await expect(
      verifyFirstReleaseAdmissionReceipt({
        receipt: tampered,
        release_set: releaseSet,
        policy,
        verified_domain: verifiedDomain,
        validation,
        package_admissions: admissions,
      }),
    ).rejects.toThrow(/hash|digest/i);
    await expect(
      verifyPublishedInitialSemanticReleaseBundle({
        release_set: releaseSet,
        package_admissions: admissions,
        first_release_receipt: { ...firstRelease, receipt_hash: H("9") },
        tombstone,
      }),
    ).rejects.toThrow(/hash/i);
    await expect(
      verifyPublishedInitialSemanticReleaseBundle({
        release_set: releaseSet,
        package_admissions: [firstAdmission, firstAdmission],
        first_release_receipt: firstRelease,
        tombstone,
      }),
    ).rejects.toThrow(/admission|duplicate/i);
  });

  it("keeps the publish command strict and bearer-free", async () => {
    const { verifiedDomain, validation, releaseSet } = await authorityFixture();
    const command = {
      schema_version: "publish-initial-semantic-release-command@1.0.0",
      command_id: "00000000-0000-4000-8000-000000000518",
      idempotency_key: "u5-bootstrap-release-0001",
      scope,
      semantic_domain: "commerce",
      verified_domain_ref: {
        receipt_id: verifiedDomain.receipt_id,
        receipt_hash: verifiedDomain.receipt_hash,
      },
      policy_ref: verifiedDomain.policy_ref,
      grant_ref: {
        grant_id: "00000000-0000-4000-8000-000000000514",
        grant_hash: H("4"),
      },
      validation_ref: {
        receipt_id: validation.receipt_id,
        receipt_hash: validation.receipt_hash,
      },
      release_set: releaseSet,
    };
    expect(publishInitialSemanticReleaseCommandSchema.parse(command)).toEqual(command);
    await expect(
      publishInitialSemanticReleaseCommandSchema.parseAsync({ ...command, grant_nonce: "secret" }),
    ).rejects.toThrow();
  });
});
