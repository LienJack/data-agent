import { describe, expect, it } from "vitest";
import {
  buildContentAddressedGreenfieldBootstrapCandidate,
  computeBusinessSourceBundleHash,
  computeMandatoryReleaseManifestHash,
  FALCON_BOOTSTRAP_SOURCE_DIGEST,
  falconInputBoundarySchema,
  greenfieldBootstrapInputSchema,
  signerKeyRegistrySchema,
} from "../src/capabilities/index.js";
import * as greenfieldBootstrapContracts from "../src/semantic/greenfield-bootstrap.js";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  snapshot: "00000000-0000-4000-8000-000000000002",
  source: "00000000-0000-4000-8000-000000000003",
  policy: "00000000-0000-4000-8000-000000000004",
  manifest: "00000000-0000-4000-8000-000000000005",
  release: "00000000-0000-4000-8000-000000000006",
} as const;
const hash = `sha256:${"a".repeat(64)}`;

function input() {
  return {
    schema_version: "greenfield-bootstrap-input@1.0.0",
    workspace: {
      workspace_id: ids.workspace,
      purpose: "FALCON_EVALUATION",
      active_release: null,
      generation: 0,
      existing_run_count: 0,
      existing_file_count: 0,
      existing_payload_count: 0,
    },
    schema_snapshot: {
      snapshot_id: ids.snapshot,
      snapshot_content_hash: hash,
      datasource_id: "falcon-postgresql",
    },
    business_source_bundle: {
      bundle_version: "falcon-business-v1",
      bundle_hash: hash,
      sources: [{ source_id: ids.source, content_hash: hash, media_type: "text/markdown" }],
    },
    bootstrap_policy: {
      policy_id: ids.policy,
      policy_version: "bootstrap-policy-v1",
      policy_hash: hash,
      semantic_coverage_floor_version: "semantic-coverage-floor@1.0.0",
    },
    mandatory_release_manifest: {
      manifest_id: ids.manifest,
      manifest_hash: hash,
      required_capability_ids: ["S01", "S05", "S08", "S11", "S12"],
    },
    initial_release_target: {
      release_set_id: ids.release,
      generation: 1,
      base_release: null,
      release_label: "falcon-initial-v1",
    },
    semantic_generation_input: {
      boundary: "FALCON_BOOTSTRAP_CORPUS",
      source_commit: "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5",
      corpus_hash: FALCON_BOOTSTRAP_SOURCE_DIGEST,
      database_ids: Array.from(
        { length: 28 },
        (_, index) => `falcon_db_${String(index + 1).padStart(2, "0")}`,
      ),
    },
  } as const;
}

describe("greenfield semantic bootstrap contracts", () => {
  it("accepts only generation-zero empty Greenfield workspace input", () => {
    expect(greenfieldBootstrapInputSchema.parse(input())).toEqual(input());
    for (const workspace of [
      { ...input().workspace, active_release: ids.release },
      { ...input().workspace, generation: 1 },
      { ...input().workspace, existing_run_count: 1 },
    ]) {
      expect(() => greenfieldBootstrapInputSchema.parse({ ...input(), workspace })).toThrow();
    }
  });

  it("rejects historical references and sealed/public Falcon contamination", () => {
    for (const forbidden of [
      { historical_release_ref: ids.release },
      { run_ref: ids.release },
      { file_ref: ids.release },
      { payload_ref: ids.release },
      { migration_ref: ids.release },
    ]) {
      expect(() => greenfieldBootstrapInputSchema.parse({ ...input(), ...forbidden })).toThrow();
    }
    for (const forbidden of [
      { gold_sql: "select 1" },
      { expected: [[1]] },
      { oracle_feedback: "leak" },
      { registry: "TEST" },
    ]) {
      expect(() =>
        greenfieldBootstrapInputSchema.parse({
          ...input(),
          semantic_generation_input: { ...input().semantic_generation_input, ...forbidden },
        }),
      ).toThrow();
    }
  });

  it("keeps Falcon corpus, public case and sealed oracle branches mutually exclusive", () => {
    const publicCase = {
      boundary: "FALCON_PUBLIC_CASE",
      case_id: "falcon-db24-001",
      database_id: "falcon_db_24",
      registry: "DEMO",
      question: "查询订单总额",
    } as const;
    expect(falconInputBoundarySchema.parse(publicCase)).toEqual(publicCase);
    expect(() =>
      falconInputBoundarySchema.parse({ ...publicCase, expected_result_hash: hash }),
    ).toThrow();
    for (const registry of ["DEMO", "TUNING", "LOCAL_HOLDOUT", "OFFICIAL_TEST_BLIND"] as const) {
      expect(falconInputBoundarySchema.parse({ ...publicCase, registry })).toMatchObject({
        case_id: publicCase.case_id,
        database_id: publicCase.database_id,
        registry,
        question: publicCase.question,
      });
      expect(
        falconInputBoundarySchema.parse({
          boundary: "FALCON_SEALED_ORACLE",
          case_id: publicCase.case_id,
          database_id: publicCase.database_id,
          registry,
          oracle_material_hash: hash,
          oracle_policy_version: "falcon-oracle-v1",
        }),
      ).toMatchObject({
        case_id: publicCase.case_id,
        database_id: publicCase.database_id,
        registry,
      });
    }
  });

  it("requires the fixed 28-database corpus and binds Journey generation to its source bundle", () => {
    expect(() =>
      greenfieldBootstrapInputSchema.parse({
        ...input(),
        semantic_generation_input: {
          ...input().semantic_generation_input,
          database_ids: input().semantic_generation_input.database_ids.slice(0, 27),
        },
      }),
    ).toThrow();

    const journey = {
      ...input(),
      workspace: { ...input().workspace, purpose: "JOURNEY" },
      semantic_generation_input: {
        boundary: "JOURNEY_BOOTSTRAP_SOURCES",
        source_bundle_hash: `sha256:${"b".repeat(64)}`,
      },
    } as const;
    expect(() => greenfieldBootstrapInputSchema.parse(journey)).toThrow();
    expect(() =>
      greenfieldBootstrapInputSchema.parse({
        ...input(),
        semantic_generation_input: {
          ...input().semantic_generation_input,
          source_commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    ).toThrow();
    expect(() =>
      greenfieldBootstrapInputSchema.parse({
        ...input(),
        semantic_generation_input: {
          ...input().semantic_generation_input,
          corpus_hash: `sha256:${"b".repeat(64)}`,
        },
      }),
    ).toThrow();
    expect(() =>
      greenfieldBootstrapInputSchema.parse({
        ...input(),
        semantic_generation_input: {
          ...input().semantic_generation_input,
          database_ids: [
            ...input().semantic_generation_input.database_ids.slice(0, -1),
            input().semantic_generation_input.database_ids[0],
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      greenfieldBootstrapInputSchema.parse({
        ...input(),
        semantic_generation_input: {
          ...input().semantic_generation_input,
          database_ids: [
            ...input().semantic_generation_input.database_ids.slice(0, -1),
            "falcon_db_29",
          ],
        },
      }),
    ).toThrow();
  });

  it("builds only a canonically content-addressed non-authoritative candidate", async () => {
    const draft = input();
    const businessSourceBundle = {
      ...draft.business_source_bundle,
      bundle_hash: await computeBusinessSourceBundleHash(draft.business_source_bundle),
    };
    const mandatoryReleaseManifest = {
      ...draft.mandatory_release_manifest,
      manifest_hash: await computeMandatoryReleaseManifestHash(draft.mandatory_release_manifest),
    };
    await expect(
      buildContentAddressedGreenfieldBootstrapCandidate({
        ...draft,
        business_source_bundle: businessSourceBundle,
        mandatory_release_manifest: mandatoryReleaseManifest,
      }),
    ).resolves.toMatchObject({
      business_source_bundle: { bundle_hash: businessSourceBundle.bundle_hash },
      mandatory_release_manifest: { manifest_hash: mandatoryReleaseManifest.manifest_hash },
    });
    await expect(
      buildContentAddressedGreenfieldBootstrapCandidate({
        ...draft,
        business_source_bundle: businessSourceBundle,
        mandatory_release_manifest: {
          ...mandatoryReleaseManifest,
          required_capability_ids: ["S01"],
        },
      }),
    ).rejects.toThrow(/canonical|hash/i);

    expect("verifyGreenfieldBootstrapInput" in greenfieldBootstrapContracts).toBe(false);
    expect("isVerifiedGreenfieldBootstrapInput" in greenfieldBootstrapContracts).toBe(false);
    expect("VerifiedGreenfieldBootstrapInput" in greenfieldBootstrapContracts).toBe(false);
    const candidate = await buildContentAddressedGreenfieldBootstrapCandidate({
      ...draft,
      business_source_bundle: businessSourceBundle,
      mandatory_release_manifest: mandatoryReleaseManifest,
    });
    expect(JSON.parse(JSON.stringify(candidate))).toEqual(candidate);
    expect(candidate.workspace).toEqual(draft.workspace);
  });

  it("accepts only role-separated public Ed25519 verification keys", () => {
    const registry = {
      schema_version: "signer-key-registry@1.0.0",
      workspace_id: ids.workspace,
      keys: [
        {
          key_id: "workspace-admin-key-v1",
          role: "WORKSPACE_ADMIN",
          algorithm: "Ed25519",
          purpose: "SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE",
          status: "ACTIVE",
          public_material: {
            format: "JWK",
            kty: "OKP",
            crv: "Ed25519",
            x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
          },
        },
        {
          key_id: "platform-attestor-key-v1",
          role: "PLATFORM_ATTESTOR",
          algorithm: "Ed25519",
          purpose: "PLATFORM_ATTESTATION",
          status: "ACTIVE",
          public_material: {
            format: "JWK",
            kty: "OKP",
            crv: "Ed25519",
            x: "PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw",
          },
        },
      ],
    } as const;
    expect(signerKeyRegistrySchema.parse(registry)).toEqual(registry);
    expect(() =>
      signerKeyRegistrySchema.parse({
        ...registry,
        keys: registry.keys.map((key) => ({ ...key, secret_material: "forbidden" })),
      }),
    ).toThrow();
    expect(() =>
      signerKeyRegistrySchema.parse({
        ...registry,
        keys: registry.keys.map((key) => ({ ...key, role: "WORKSPACE_ADMIN" })),
      }),
    ).toThrow();
    expect(() =>
      signerKeyRegistrySchema.parse({
        ...registry,
        keys: registry.keys.map((key) => ({
          ...key,
          public_material: registry.keys[0].public_material,
        })),
      }),
    ).toThrow();
    expect(() =>
      signerKeyRegistrySchema.parse({
        ...registry,
        keys: registry.keys.map((key, index) =>
          index === 0
            ? {
                ...key,
                public_material: { ...key.public_material, x: "YWJjZA" },
              }
            : key,
        ),
      }),
    ).toThrow();
    expect(() =>
      signerKeyRegistrySchema.parse({
        ...registry,
        keys: registry.keys.map((key, index) =>
          index === 0
            ? {
                ...key,
                public_material: {
                  ...key.public_material,
                  x: `${key.public_material.x.slice(0, -1)}B`,
                },
              }
            : key,
        ),
      }),
    ).toThrow();

    for (const invalidPoint of [
      // Encoded Edwards identity (0, 1).
      "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      // Canonical point of order 2 (0, -1).
      "7P_______________________________________38",
      // y = p is a non-canonical field encoding.
      "7f_______________________________________38",
      // Canonical field element that does not decode to an Edwards point.
      "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      // RFC 8032 vector plus the order-2 torsion point: on-curve but outside [L].
      "FqVn_n1O9UgqtAEsNpv4xfEejQwlWdzaUP3llwj4ruU",
    ]) {
      expect(() =>
        signerKeyRegistrySchema.parse({
          ...registry,
          keys: registry.keys.map((key, index) =>
            index === 0
              ? { ...key, public_material: { ...key.public_material, x: invalidPoint } }
              : key,
          ),
        }),
      ).toThrow();
    }
  });
});
