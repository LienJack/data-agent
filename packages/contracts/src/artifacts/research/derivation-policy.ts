import {
  appScopeSchema,
  type ContentHash,
  canonicalizeJson,
  computeResearchKernelHashV2,
  contentHashSchema,
  databaseUtcTimestampSchema,
  immutableIdSchema,
  parseInertWireInput,
  researchBudgetLimitSchema,
  versionIdentifierSchema,
  z,
} from "./derivation-wire-shared.js";

export const u6DerivationPolicyManifestSchema = z.strictObject({
  protocol_version: z.literal("u6-derivation-policy-manifest@1.0.0"),
  scope: appScopeSchema,
  deployment_id: immutableIdSchema,
  budget_policy: z.strictObject({
    tenant_policy_version: versionIdentifierSchema,
    limits: researchBudgetLimitSchema,
    top_up_allowed: z.boolean(),
    tenant_policy_hash: contentHashSchema,
  }),
  enumerator: z.strictObject({
    enumerator_version: versionIdentifierSchema,
    eig_policy_version: versionIdentifierSchema,
    input_schema_version: z.literal("candidate-enumerator-input@1.0.0"),
    implementation_digest: contentHashSchema,
    enumerator_version_hash: contentHashSchema,
  }),
  manifest_hash: contentHashSchema,
});

const provisionDerivationPolicyInputWithoutHashSchema = z.strictObject({
  protocol_version: z.literal("u6-derivation-policy-manifest@1.0.0"),
  operation_id: immutableIdSchema,
  manifest: u6DerivationPolicyManifestSchema,
});

export const provisionDerivationPolicyInputSchema =
  provisionDerivationPolicyInputWithoutHashSchema.extend({
    request_hash: contentHashSchema,
  });

export const provisionedDerivationPolicySchema = z.strictObject({
  operation_id: immutableIdSchema,
  manifest_hash: contentHashSchema,
  tenant_policy_version: versionIdentifierSchema,
  enumerator_version: versionIdentifierSchema,
  created: z.boolean(),
  committed_at: databaseUtcTimestampSchema,
});

async function sha256Utf8(value: string): Promise<ContentHash> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

export async function computeU6DerivationPolicyManifestHash(input: unknown): Promise<ContentHash> {
  const manifest = parseInertWireInput(u6DerivationPolicyManifestSchema, input);
  const { manifest_hash: _manifestHash, ...material } = manifest;
  return computeResearchKernelHashV2("u6-derivation-policy-manifest@1", material);
}

export async function verifyU6DerivationPolicyManifest(
  input: unknown,
): Promise<U6DerivationPolicyManifest> {
  const manifest = parseInertWireInput(u6DerivationPolicyManifestSchema, input);
  const expectedTenantPolicyHash = await computeResearchKernelHashV2("u6-tenant-budget-policy@1", {
    scope: manifest.scope,
    tenant_policy_version: manifest.budget_policy.tenant_policy_version,
    limits: manifest.budget_policy.limits,
    top_up_allowed: manifest.budget_policy.top_up_allowed,
  });
  if (expectedTenantPolicyHash !== manifest.budget_policy.tenant_policy_hash) {
    throw new TypeError("Derivation Policy tenant_policy_hash 与 exact material 不匹配。");
  }

  const expectedEnumeratorVersionHash = await computeResearchKernelHashV2(
    "u6-enumerator-version@1",
    {
      scope: manifest.scope,
      enumerator_version: manifest.enumerator.enumerator_version,
      eig_policy_version: manifest.enumerator.eig_policy_version,
      input_schema_version: manifest.enumerator.input_schema_version,
      implementation_digest: manifest.enumerator.implementation_digest,
    },
  );
  if (expectedEnumeratorVersionHash !== manifest.enumerator.enumerator_version_hash) {
    throw new TypeError("Derivation Policy enumerator_version_hash 与 exact material 不匹配。");
  }

  const expectedManifestHash = await computeU6DerivationPolicyManifestHash(manifest);
  if (expectedManifestHash !== manifest.manifest_hash) {
    throw new TypeError("Derivation Policy manifest_hash 与 committed manifest 不匹配。");
  }
  return manifest;
}

export async function computeProvisionDerivationPolicyRequestHash(
  input: unknown,
): Promise<ContentHash> {
  const command = parseInertWireInput(provisionDerivationPolicyInputWithoutHashSchema, input);
  return sha256Utf8(`${command.protocol_version}\0${canonicalizeJson(command)}`);
}

export async function verifyProvisionDerivationPolicyInput(
  input: unknown,
): Promise<ProvisionDerivationPolicyInput> {
  const command = parseInertWireInput(provisionDerivationPolicyInputSchema, input);
  await verifyU6DerivationPolicyManifest(command.manifest);
  const { request_hash: _requestHash, ...material } = command;
  const expectedRequestHash = await computeProvisionDerivationPolicyRequestHash(material);
  if (expectedRequestHash !== command.request_hash) {
    throw new TypeError("Provision Derivation Policy request_hash 与 strict command 不匹配。");
  }
  return command;
}

export async function verifyProvisionedDerivationPolicy(
  input: unknown,
  result: unknown,
): Promise<ProvisionedDerivationPolicy> {
  const command = await verifyProvisionDerivationPolicyInput(input);
  const provisioned = parseInertWireInput(provisionedDerivationPolicySchema, result);
  if (
    provisioned.operation_id !== command.operation_id ||
    provisioned.manifest_hash !== command.manifest.manifest_hash ||
    provisioned.tenant_policy_version !== command.manifest.budget_policy.tenant_policy_version ||
    provisioned.enumerator_version !== command.manifest.enumerator.enumerator_version
  ) {
    throw new TypeError(
      "Provision result 未逐字绑定 operation/manifest/policy/enumerator version。",
    );
  }
  return provisioned;
}

export type U6DerivationPolicyManifest = z.infer<typeof u6DerivationPolicyManifestSchema>;
export type ProvisionDerivationPolicyInput = z.infer<typeof provisionDerivationPolicyInputSchema>;
export type ProvisionedDerivationPolicy = z.infer<typeof provisionedDerivationPolicySchema>;
