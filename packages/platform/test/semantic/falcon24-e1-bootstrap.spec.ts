import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFirstReleaseAdmissionReceipt,
  buildInitialSemanticReleaseSet,
  buildSemanticBootstrapCapabilityTombstone,
  buildSemanticBootstrapValidationReceipt,
  buildSemanticPackageAdmissionReceipt,
  modelCatalogEntrySchema,
  modelCertificationPublicViewSchema,
  modelProviderConnectionSchema,
  sha256ContentHash,
  verifyFalcon24E1StagingReceipt,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  bootstrapFalcon24E1,
  deriveFalcon24E1BootstrapId,
  type Falcon24E1BootstrapDependencies,
} from "../../src/semantic/falcon24-e1-bootstrap.js";
import { buildFalcon24SemanticReleaseAuthorityProof } from "../../src/semantic/falcon24-retained-authority-proof.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const retained = JSON.parse(
  readFileSync(resolve(root, "infra/falcon/e1/retained-assets-manifest.json"), "utf8"),
) as Record<string, unknown> & {
  manifest_hash: `sha256:${string}`;
  semantics: { source_bundle_hash: `sha256:${string}` };
  analysis_runtime: {
    attestation_hash: `sha256:${string}`;
    operator_manifest_hash: `sha256:${string}`;
    operator_registry_digest: `sha256:${string}`;
    source_bundle_hash: `sha256:${string}`;
    production_gate: "HOLD";
    production_isolation_proven: false;
  };
  llm: { manifest_hash: `sha256:${string}` };
};
const llm = JSON.parse(
  readFileSync(resolve(root, "infra/falcon/e1/llm-provider-model-profile.json"), "utf8"),
);
const H = (character: string) => `sha256:${character.repeat(64)}` as const;
const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "00000000-0000-4000-8000-00000000e124",
  principal: "00000000-0000-4000-8000-00000000e125",
  deployment: "00000000-0000-4000-8000-000000000001",
  staging: "00000000-0000-4000-8000-00000000e130",
  candidate: "00000000-0000-5000-8000-00000000e201",
  revision: "00000000-0000-5000-8000-00000000e202",
  releaseSet: "00000000-0000-5000-8000-00000000e203",
  release: "00000000-0000-5000-8000-00000000e204",
  policy: "00000000-0000-5000-8000-00000000e205",
  namespace: "00000000-0000-5000-8000-00000000e206",
  package: "00000000-0000-5000-8000-00000000e207",
  validation: "00000000-0000-5000-8000-00000000e208",
  packageValidation: "00000000-0000-5000-8000-00000000e209",
  preview: "00000000-0000-5000-8000-00000000e210",
  projection: "00000000-0000-5000-8000-00000000e211",
  verified: "00000000-0000-5000-8000-00000000e212",
  grant: "00000000-0000-5000-8000-00000000e213",
} as const;

async function semanticFixture() {
  const scope = {
    app_id: ids.app,
    tenant_id: ids.tenant,
    workspace_id: ids.tenant,
    environment: "local",
  } as const;
  const candidateRoot = {
    candidate_id: ids.candidate,
    revision_id: ids.revision,
    revision: 1,
    revision_digest: H("1"),
    candidate_set_hash: H("2"),
  } as const;
  const policyRef = { policy_id: ids.policy, policy_revision: 1, policy_hash: H("3") } as const;
  const packageEntry = {
    namespace_id: ids.namespace,
    package_id: ids.package,
    package_version: 1,
    package_hash: H("4"),
    candidate_revision: candidateRoot,
    validation_receipt: { receipt_id: ids.packageValidation, receipt_hash: H("5") },
    preview_binding: {
      preview_id: ids.preview,
      preview_hash: H("6"),
      projection_id: ids.projection,
      projection_hash: H("7"),
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
    receipt_id: ids.validation,
    scope,
    semantic_domain: "falcon24",
    candidate_set_root: candidateRoot,
    policy_ref: policyRef,
    schema_snapshot: {
      snapshot_id: "00000000-0000-5000-8000-00000000e214",
      snapshot_revision: 1,
      snapshot_hash: H("8"),
    },
    source_bundle: {
      bundle_id: "00000000-0000-5000-8000-00000000e215",
      bundle_version: 1,
      bundle_hash: retained.semantics.source_bundle_hash,
    },
    packages: [packageEntry],
    outcome: "PASS",
    validator_version: "falcon24-e1-validator@1.0.0",
    validated_at: "2026-08-26T01:00:00.000Z",
  });
  const releaseSet = await buildInitialSemanticReleaseSet({
    schema_version: "initial-semantic-release-set@1.0.0",
    release_set_id: ids.releaseSet,
    scope,
    semantic_domain: "falcon24",
    release_id: ids.release,
    generation: 1,
    base_release_id: null,
    candidate_set_root: candidateRoot,
    policy_ref: policyRef,
    validation_ref: { receipt_id: validation.receipt_id, receipt_hash: validation.receipt_hash },
    packages: validation.packages,
    runtime_projections: {
      executable: {
        projection_id: "00000000-0000-5000-8000-00000000e216",
        projection_hash: H("9"),
      },
      relationship: {
        projection_id: "00000000-0000-5000-8000-00000000e217",
        projection_hash: H("a"),
      },
      runtime_restriction: {
        projection_id: "00000000-0000-5000-8000-00000000e218",
        projection_hash: H("b"),
      },
    },
    published_at: "2026-08-26T01:01:00.000Z",
  });
  const releaseRef = {
    release_set_id: releaseSet.release_set_id,
    release_set_hash: releaseSet.release_set_hash,
  };
  const admission = await buildSemanticPackageAdmissionReceipt({
    schema_version: "semantic-package-admission-receipt@1.0.0",
    receipt_id: "00000000-0000-5000-8000-00000000e219",
    scope,
    semantic_domain: "falcon24",
    release_set_ref: releaseRef,
    package: packageEntry,
    admission: "ADMITTED",
    admitted_at: releaseSet.published_at,
  });
  const grantRef = { grant_id: ids.grant, grant_hash: H("c") } as const;
  const firstRelease = await buildFirstReleaseAdmissionReceipt({
    schema_version: "first-release-admission-receipt@1.0.0",
    receipt_id: "00000000-0000-5000-8000-00000000e220",
    scope,
    semantic_domain: "falcon24",
    approval_mode: "SYSTEM_BOOTSTRAP_POLICY",
    release_set_ref: releaseRef,
    policy_ref: policyRef,
    verified_domain_ref: { receipt_id: ids.verified, receipt_hash: H("d") },
    validation_ref: releaseSet.validation_ref,
    grant_ref: grantRef,
    package_admissions: [
      {
        receipt_id: admission.receipt_id,
        receipt_hash: admission.receipt_hash,
        package_id: packageEntry.package_id,
        package_version: packageEntry.package_version,
        package_hash: packageEntry.package_hash,
      },
    ],
    decision_set_digest: releaseSet.release_set_hash,
    admitted_at: releaseSet.published_at,
  });
  const tombstone = await buildSemanticBootstrapCapabilityTombstone({
    schema_version: "semantic-bootstrap-capability-tombstone@1.0.0",
    tombstone_id: "00000000-0000-5000-8000-00000000e221",
    scope,
    semantic_domain: "falcon24",
    release_set_ref: releaseRef,
    first_release_receipt_ref: {
      receipt_id: firstRelease.receipt_id,
      receipt_hash: firstRelease.receipt_hash,
    },
    consumed_grant_ref: grantRef,
    closed_at: releaseSet.published_at,
  });
  const command = {
    schema_version: "publish-initial-semantic-release-command@1.0.0",
    command_id: "00000000-0000-5000-8000-00000000e222",
    idempotency_key: "falcon24-e1-publish-0001",
    scope,
    semantic_domain: "falcon24",
    verified_domain_ref: firstRelease.verified_domain_ref,
    policy_ref: policyRef,
    grant_ref: grantRef,
    validation_ref: releaseSet.validation_ref,
    release_set: releaseSet,
  } as const;
  const published = {
    schema_version: "publish-initial-semantic-release-result@1.0.0" as const,
    disposition: "CREATED" as "CREATED" | "REPLAYED",
    request_hash: await sha256ContentHash(command),
    release_set: releaseSet,
    package_admissions: [admission],
    first_release_receipt: firstRelease,
    tombstone,
  };
  const loaded = {
    schema_version: "load-initial-semantic-release-result@1.0.0" as const,
    release_set: releaseSet,
    package_admissions: [admission],
    first_release_receipt: firstRelease,
    tombstone,
  };
  return { command, loaded, published, validation };
}

function definitionKeys() {
  return Array.from({ length: 149 }, (_, index) => `definition.${String(index).padStart(3, "0")}`);
}

async function harness(options: { credential?: boolean; existingCertification?: boolean } = {}) {
  const semantic = await semanticFixture();
  const providers: ReturnType<typeof modelProviderConnectionSchema.parse>[] = [];
  const models: ReturnType<typeof modelCatalogEntrySchema.parse>[] = [];
  const certifications: ReturnType<typeof modelCertificationPublicViewSchema.parse>[] = [];
  const receiptHashes = new Map<string, string>();
  let publishCount = 0;
  let authenticationCalls = 0;
  const dependencies: Falcon24E1BootstrapDependencies = {
    semantic_authority: {
      async publishInitial() {
        publishCount += 1;
        return {
          ok: true,
          value: {
            ...semantic.published,
            disposition: publishCount === 1 ? "CREATED" : "REPLAYED",
          },
        };
      },
      async loadInitial() {
        return { ok: true, value: semantic.loaded };
      },
    },
    model_control: {
      async listProviderConnections() {
        return { ok: true, value: providers };
      },
      async listModels() {
        return { ok: true, value: models };
      },
      async listModelAuthentications() {
        return { ok: true, value: certifications };
      },
      async applyProviderConnectionCommand(_context, raw) {
        const command = raw as Record<string, unknown>;
        const provider = modelProviderConnectionSchema.parse({
          schema_version: "model-provider-connection@1.0.0",
          app_id: ids.app,
          environment: "local",
          provider_connection_id: command.provider_connection_id,
          vendor_id: command.vendor_id,
          runtime_provider: command.runtime_provider,
          display_name: command.display_name,
          base_url: command.base_url,
          credential_ref: command.credential_ref,
          source: "manual",
          status: "ACTIVE",
          health: command.credential_ref ? "configured" : "untested",
          config_version: Number(command.expected_config_version) + 1,
          created_by: ids.principal,
          created_at: "2026-08-26T01:00:00.000Z",
          updated_at: "2026-08-26T01:00:00.000Z",
        });
        const index = providers.findIndex(
          ({ provider_connection_id: id }) => id === provider.provider_connection_id,
        );
        if (index < 0) providers.push(provider);
        else providers[index] = provider;
        return { ok: true, value: provider };
      },
      async applyProviderSelection(_context, raw) {
        const command = raw as Record<string, unknown>;
        const item = (command.models as Array<Record<string, unknown>>)[0];
        if (!item) throw new Error("selection model missing");
        const provider = providers.find(
          ({ provider_connection_id: id }) => id === command.provider_connection_id,
        );
        if (!provider) throw new Error("selection provider missing");
        const model = modelCatalogEntrySchema.parse({
          schema_version: "model-catalog-entry@1.0.0",
          app_id: ids.app,
          environment: "local",
          model_profile_id: item.model_profile_id,
          provider_connection_id: provider.provider_connection_id,
          provider: provider.runtime_provider,
          model_id: item.model_id,
          display_name: item.display_name,
          base_url: provider.base_url,
          capabilities: item.capabilities,
          credential_ref: provider.credential_ref,
          status: "DISABLED",
          config_version: Number(item.expected_config_version) + 1,
          is_system_default: false,
          created_by: ids.principal,
          created_at: "2026-08-26T01:00:00.000Z",
          updated_at: "2026-08-26T01:00:00.000Z",
        });
        const index = models.findIndex(({ model_profile_id: id }) => id === model.model_profile_id);
        if (index < 0) models.push(model);
        else models[index] = model;
        return { ok: true, value: [model] };
      },
      async applyModelCommand(_context, raw) {
        const command = raw as Record<string, unknown>;
        const model = modelCatalogEntrySchema.parse({
          schema_version: "model-catalog-entry@1.0.0",
          app_id: ids.app,
          environment: "local",
          model_profile_id: command.model_profile_id,
          provider_connection_id: command.provider_connection_id,
          provider: command.provider,
          model_id: command.model_id,
          display_name: command.display_name,
          base_url: command.base_url,
          capabilities: command.capabilities,
          credential_ref: command.credential_ref,
          status: command.status,
          config_version: Number(command.expected_config_version) + 1,
          is_system_default: command.is_system_default,
          created_by: ids.principal,
          created_at: "2026-08-26T01:00:00.000Z",
          updated_at: "2026-08-26T01:00:00.000Z",
        });
        const index = models.findIndex(({ model_profile_id: id }) => id === model.model_profile_id);
        if (index < 0) models.push(model);
        else models[index] = model;
        if (options.existingCertification) {
          certifications.push(
            modelCertificationPublicViewSchema.parse({
              schema_version: "model-certification-view@1.0.0",
              model_profile_id: model.model_profile_id,
              model_config_version: model.config_version,
              provider: model.provider,
              model_id: model.model_id,
              state: "PASS",
              completed_at: "2026-08-26T01:01:00.000Z",
            }),
          );
        }
        return { ok: true, value: model };
      },
      async recordModelAuthentication(_context, raw) {
        const command = raw as Record<string, unknown>;
        const model = models.find(({ model_profile_id: id }) => id === command.model_profile_id);
        if (!model) throw new Error("model missing");
        const certification = modelCertificationPublicViewSchema.parse({
          schema_version: "model-certification-view@1.0.0",
          model_profile_id: model.model_profile_id,
          model_config_version: model.config_version,
          provider: model.provider,
          model_id: model.model_id,
          state: "PASS",
          completed_at: "2026-08-26T01:01:00.000Z",
        });
        certifications.push(certification);
        return { ok: true, value: certification };
      },
    },
    epoch_authority: {
      async loadCurrent() {
        return { ok: true, value: null };
      },
      async beginStaging() {
        return {
          ok: true,
          value: {
            schema_version: "falcon24-e1-staging-session@1.0.0",
            staging_id: ids.staging,
            retained_assets_hash: retained.manifest_hash,
            status: "STAGED",
          },
        };
      },
      async recordReceipt(_capability, receipt) {
        const candidate = await verifyFalcon24E1StagingReceipt(receipt);
        const previous = receiptHashes.get(candidate.component);
        if (previous && previous !== candidate.receipt_hash) {
          return {
            ok: false,
            error: {
              code: "FALCON24_E1_STAGING_RECEIPT_CONFLICT",
              message: "conflict",
              retryable: false,
            },
          };
        }
        receiptHashes.set(candidate.component, candidate.receipt_hash);
        return { ok: true, value: candidate };
      },
    },
    async authenticate_model() {
      authenticationCalls += 1;
      return { response_item_count: 1 };
    },
    async build_agent_profiles(input) {
      return {
        schema_version: "falcon24-e1-agent-profile-build-proof@1.0.0",
        source_model_profile_id: input.model_profile_id,
        source_model_config_version: input.model_config_version,
        source_model_projection_hash: input.model_projection_hash,
        profile_count: 4,
        profile_bundle_hash: await sha256ContentHash({ model: input, profiles: 4 }),
        materialized: false,
      };
    },
  };
  const credential = options.credential
    ? {
        schema_version: "global-model-credential-ref@1.0.0" as const,
        app_id: ids.app,
        environment: "local",
        credential_ref_id: "00000000-0000-5000-8000-00000000e230",
        secret_ref_id: "00000000-0000-5000-8000-00000000e231",
        secret_version: 1,
        rotation_state: "ACTIVE" as const,
      }
    : null;
  return {
    authenticationCalls: () => authenticationCalls,
    dependencies,
    modelProfileId: deriveFalcon24E1BootstrapId(
      retained.manifest_hash,
      "model-profile",
      "falcon24-analysis-deepseek",
    ),
    receiptHashes,
    semantic,
    input: {
      capability: {},
      admin_context: { deployment_id: ids.deployment, principal_id: ids.principal },
      staging_id: ids.staging,
      retained_manifest: retained,
      llm_manifest: llm,
      llm_manifest_hash: retained.llm.manifest_hash,
      credential_ref: credential,
      semantic: {
        definition_keys: definitionKeys(),
        source_bundle_hash: retained.semantics.source_bundle_hash,
        validation_receipt: semantic.validation,
        publish_command: semantic.command,
        forbidden_release_ids: [],
        forbidden_release_hashes: [],
      },
      forbidden_model_profile_ids: [],
      forbidden_certification_refs: [],
      runtime_attestation: {
        schema_version: "falcon24-e1-runtime-attestation-proof@1.0.0",
        attestation_hash: retained.analysis_runtime.attestation_hash,
        operator_manifest_hash: retained.analysis_runtime.operator_manifest_hash,
        operator_registry_digest: retained.analysis_runtime.operator_registry_digest,
        source_bundle_hash: retained.analysis_runtime.source_bundle_hash,
        attestation_evidence_hash: await sha256ContentHash({ attestation: "verified" }),
        production_gate: retained.analysis_runtime.production_gate,
        production_isolation_proven: retained.analysis_runtime.production_isolation_proven,
      },
    },
  };
}

describe("Falcon24 E1 fresh bootstrap", () => {
  it("replays one Generation 1 release and five staging receipts without activation", async () => {
    const test = await harness();
    const first = await bootstrapFalcon24E1(test.input, test.dependencies);
    const hashes = new Map(test.receiptHashes);
    const replay = await bootstrapFalcon24E1(test.input, test.dependencies);
    expect(first).toMatchObject({
      terminal: "STAGED_HOLD",
      current_epoch: null,
      semantic: { generation: 1, publication_disposition: "CREATED" },
      model: { readiness: "HOLD", credential_bound: false },
      agent_profiles: { profile_count: 4, materialized: false },
      runtime_attestation: { production_gate: "HOLD", production_isolation_proven: false },
    });
    expect(replay.semantic.publication_disposition).toBe("REPLAYED");
    expect(test.receiptHashes).toEqual(hashes);
    expect(test.receiptHashes.size).toBe(5);
    expect(test.authenticationCalls()).toBe(0);
  });

  it("requires a fresh authentication before credential-bound readiness", async () => {
    const test = await harness({ credential: true });
    const result = await bootstrapFalcon24E1(test.input, test.dependencies);
    expect(result.model).toMatchObject({ readiness: "READY", credential_bound: true });
    expect(test.authenticationCalls()).toBe(1);
    expect(result.terminal).toBe("STAGED_HOLD");
  });

  it("rejects old release and certification identities", async () => {
    const oldRelease = await harness();
    await expect(
      bootstrapFalcon24E1(
        {
          ...oldRelease.input,
          semantic: {
            ...oldRelease.input.semantic,
            forbidden_release_ids: [ids.release],
          },
        },
        oldRelease.dependencies,
      ),
    ).rejects.toThrow("FALCON24_E1_SEMANTIC_RELEASE_IDENTITY_INVALID");

    const oldCertification = await harness({ credential: true, existingCertification: true });
    await expect(
      bootstrapFalcon24E1(
        {
          ...oldCertification.input,
          forbidden_certification_refs: [
            { model_profile_id: oldCertification.modelProfileId, model_config_version: 2 },
          ],
        },
        oldCertification.dependencies,
      ),
    ).rejects.toThrow("FALCON24_E1_OLD_MODEL_CERTIFICATION_REJECTED");
    expect(oldCertification.authenticationCalls()).toBe(0);
  });

  it("fails closed on semantic key or runtime attestation drift", async () => {
    const semanticExportDrift = await semanticFixture();
    await expect(
      buildFalcon24SemanticReleaseAuthorityProof({
        retained_semantics: {
          ...(retained.semantics as Parameters<
            typeof buildFalcon24SemanticReleaseAuthorityProof
          >[0]["retained_semantics"]),
          database_export_hash: H("f"),
        },
        definition_keys: definitionKeys(),
        loaded_release: semanticExportDrift.loaded,
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_RETAINED_EXPORT_INVALID");

    const semanticDrift = await harness();
    await expect(
      bootstrapFalcon24E1(
        {
          ...semanticDrift.input,
          semantic: {
            ...semanticDrift.input.semantic,
            definition_keys: semanticDrift.input.semantic.definition_keys.slice(1),
          },
        },
        semanticDrift.dependencies,
      ),
    ).rejects.toThrow("FALCON24_E1_SEMANTIC_DEFINITION_SET_INVALID");

    const runtimeDrift = await harness();
    await expect(
      bootstrapFalcon24E1(
        {
          ...runtimeDrift.input,
          runtime_attestation: {
            ...runtimeDrift.input.runtime_attestation,
            operator_registry_digest: H("f"),
          },
        },
        runtimeDrift.dependencies,
      ),
    ).rejects.toThrow("FALCON24_E1_RUNTIME_ATTESTATION_MISMATCH");
  });
});
