import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  canonicalImmutableIdSchema,
  canonicalU2TimestampSchema,
  workspaceScopedAuthoritySchema,
} from "../workspaces/defaults.js";
import { workspaceIdempotencyKeySchema } from "../workspaces/identity.js";

export const SEMANTIC_BOOTSTRAP_POLICY_VIEW_VERSION =
  "semantic-bootstrap-policy-view@1.0.0" as const;
export const VERIFIED_DOMAIN_BOOTSTRAP_RECEIPT_VERSION =
  "verified-domain-bootstrap-receipt@1.0.0" as const;
export const SEMANTIC_BOOTSTRAP_VALIDATION_RECEIPT_VERSION =
  "semantic-bootstrap-validation-receipt@1.0.0" as const;
export const INITIAL_SEMANTIC_RELEASE_SET_VERSION = "initial-semantic-release-set@1.0.0" as const;
export const SEMANTIC_PACKAGE_ADMISSION_RECEIPT_VERSION =
  "semantic-package-admission-receipt@1.0.0" as const;
export const FIRST_RELEASE_ADMISSION_RECEIPT_VERSION =
  "first-release-admission-receipt@1.0.0" as const;

const positiveRevisionSchema = z.number().int().positive().safe();
const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSameScope(
  expected: z.infer<typeof workspaceScopedAuthoritySchema>,
  actual: z.infer<typeof workspaceScopedAuthoritySchema>,
  label: string,
): void {
  if (
    expected.app_id !== actual.app_id ||
    expected.tenant_id !== actual.tenant_id ||
    expected.workspace_id !== actual.workspace_id ||
    expected.environment !== actual.environment
  ) {
    throw new TypeError(`${label} has a cross-scope Authority binding.`);
  }
}

function assertTimestampOrder(start: string, end: string, label: string): void {
  if (Date.parse(start) >= Date.parse(end)) {
    throw new TypeError(`${label} valid_until/expires_at must be later than its start timestamp.`);
  }
}

const contentAddressedPolicyReferenceSchema = z.strictObject({
  policy_id: versionIdentifierSchema,
  policy_version: versionIdentifierSchema,
  policy_hash: contentHashSchema,
});

export const semanticBootstrapPolicyReferenceSchema = z.strictObject({
  policy_id: canonicalImmutableIdSchema,
  policy_revision: positiveRevisionSchema,
  policy_hash: contentHashSchema,
});

const mandatoryManifestReferenceSchema = z.strictObject({
  manifest_id: canonicalImmutableIdSchema,
  manifest_version: versionIdentifierSchema,
  manifest_hash: contentHashSchema,
});

const semanticSourceBoundaryReferenceSchema = z.strictObject({
  boundary_id: versionIdentifierSchema,
  boundary_version: versionIdentifierSchema,
  boundary_hash: contentHashSchema,
});

const semanticBootstrapPolicyViewDraftSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_BOOTSTRAP_POLICY_VIEW_VERSION),
    policy_id: canonicalImmutableIdSchema,
    policy_revision: positiveRevisionSchema,
    scope: workspaceScopedAuthoritySchema,
    semantic_domain: semanticDomainSchema,
    mandatory_manifest: mandatoryManifestReferenceSchema,
    coverage_policy: contentAddressedPolicyReferenceSchema,
    lowerability_policy: contentAddressedPolicyReferenceSchema,
    source_boundary: semanticSourceBoundaryReferenceSchema,
    valid_from: canonicalU2TimestampSchema,
    valid_until: canonicalU2TimestampSchema,
  })
  .superRefine((policy, ctx) => {
    if (Date.parse(policy.valid_from) >= Date.parse(policy.valid_until)) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Bootstrap Policy valid_until 必须晚于 valid_from。",
        path: ["valid_until"],
      });
    }
  });

export const semanticBootstrapPolicyViewSchema = semanticBootstrapPolicyViewDraftSchema.extend({
  policy_hash: contentHashSchema,
});

const semanticBootstrapPolicyViewBuilderInputSchema = semanticBootstrapPolicyViewDraftSchema.extend(
  { policy_hash: contentHashSchema.optional() },
);

export const semanticCandidateSetRootReferenceSchema = z.strictObject({
  candidate_id: canonicalImmutableIdSchema,
  revision_id: canonicalImmutableIdSchema,
  revision: positiveRevisionSchema,
  revision_digest: contentHashSchema,
  candidate_set_hash: contentHashSchema,
});

const semanticDomainBootstrapPacketDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-domain-bootstrap-packet@1.0.0"),
    packet_id: canonicalImmutableIdSchema,
    scope: workspaceScopedAuthoritySchema,
    semantic_domain: semanticDomainSchema,
    datasource_id: canonicalImmutableIdSchema,
    audience: z.literal("SEMANTIC_BOOTSTRAP_VERIFIER"),
    candidate_set_root: semanticCandidateSetRootReferenceSchema,
    release_set_id: canonicalImmutableIdSchema,
    policy_ref: semanticBootstrapPolicyReferenceSchema,
    nonce_hash: contentHashSchema,
    issued_at: canonicalU2TimestampSchema,
    expires_at: canonicalU2TimestampSchema,
  })
  .superRefine((packet, ctx) => {
    if (Date.parse(packet.issued_at) >= Date.parse(packet.expires_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Domain Bootstrap Packet expires_at 必须晚于 issued_at。",
        path: ["expires_at"],
      });
    }
  });

export const semanticDomainBootstrapPacketSchema = semanticDomainBootstrapPacketDraftSchema.extend({
  packet_digest: contentHashSchema,
});

const semanticDomainBootstrapPacketBuilderInputSchema =
  semanticDomainBootstrapPacketDraftSchema.extend({ packet_digest: contentHashSchema.optional() });

const verifiedSignerReferenceSchema = z.strictObject({
  principal_id: canonicalImmutableIdSchema,
  key_id: versionIdentifierSchema,
  key_revision: positiveRevisionSchema,
  public_material_hash: contentHashSchema,
  activation_receipt_hash: contentHashSchema,
  signature_hash: contentHashSchema,
});

const verifiedDomainBootstrapReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal(VERIFIED_DOMAIN_BOOTSTRAP_RECEIPT_VERSION),
    receipt_id: canonicalImmutableIdSchema,
    scope: workspaceScopedAuthoritySchema,
    semantic_domain: semanticDomainSchema,
    datasource_id: canonicalImmutableIdSchema,
    packet_digest: contentHashSchema,
    candidate_set_root: semanticCandidateSetRootReferenceSchema,
    release_set_id: canonicalImmutableIdSchema,
    policy_ref: semanticBootstrapPolicyReferenceSchema,
    workspace_admin: verifiedSignerReferenceSchema,
    platform_attestor: verifiedSignerReferenceSchema,
    nonce_hash: contentHashSchema,
    issued_at: canonicalU2TimestampSchema,
    expires_at: canonicalU2TimestampSchema,
    verified_at: canonicalU2TimestampSchema,
  })
  .superRefine((receipt, ctx) => {
    if (Date.parse(receipt.issued_at) >= Date.parse(receipt.expires_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Verified Domain Bootstrap Receipt expires_at 必须晚于 issued_at。",
        path: ["expires_at"],
      });
    }
    if (
      Date.parse(receipt.verified_at) < Date.parse(receipt.issued_at) ||
      Date.parse(receipt.verified_at) >= Date.parse(receipt.expires_at)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "verified_at 必须位于已签发且未过期的时间窗口内。",
        path: ["verified_at"],
      });
    }
    const admin = receipt.workspace_admin;
    const attestor = receipt.platform_attestor;
    if (admin.principal_id === attestor.principal_id) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Admin 与 Platform Attestor signer principal 必须分离。",
        path: ["platform_attestor", "principal_id"],
      });
    }
    if (admin.key_id === attestor.key_id) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Admin 与 Platform Attestor signer key 必须分离。",
        path: ["platform_attestor", "key_id"],
      });
    }
    if (admin.public_material_hash === attestor.public_material_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace Admin 与 Platform Attestor signer public material 必须分离。",
        path: ["platform_attestor", "public_material_hash"],
      });
    }
  });

export const verifiedDomainBootstrapReceiptSchema =
  verifiedDomainBootstrapReceiptDraftSchema.extend({ receipt_hash: contentHashSchema });

const verifiedDomainBootstrapReceiptBuilderInputSchema =
  verifiedDomainBootstrapReceiptDraftSchema.extend({ receipt_hash: contentHashSchema.optional() });

const semanticSchemaSnapshotReferenceSchema = z.strictObject({
  snapshot_id: canonicalImmutableIdSchema,
  snapshot_revision: positiveRevisionSchema,
  snapshot_hash: contentHashSchema,
});

const semanticSourceBundleReferenceSchema = z.strictObject({
  bundle_id: canonicalImmutableIdSchema,
  bundle_version: positiveRevisionSchema,
  bundle_hash: contentHashSchema,
});

const ontologyPackageValidationReferenceSchema = z.strictObject({
  receipt_id: canonicalImmutableIdSchema,
  receipt_hash: contentHashSchema,
});

const ontologyPackagePreviewBindingReferenceSchema = z.strictObject({
  preview_id: canonicalImmutableIdSchema,
  preview_hash: contentHashSchema,
  projection_id: canonicalImmutableIdSchema,
  projection_hash: contentHashSchema,
});

export const semanticBootstrapAdmissionGateSchema = z.enum(["PASS", "FAIL"]);

export const semanticBootstrapPackageEntrySchema = z.strictObject({
  namespace_id: canonicalImmutableIdSchema,
  package_id: canonicalImmutableIdSchema,
  package_version: positiveRevisionSchema,
  package_hash: contentHashSchema,
  candidate_revision: semanticCandidateSetRootReferenceSchema,
  validation_receipt: ontologyPackageValidationReferenceSchema,
  preview_binding: ontologyPackagePreviewBindingReferenceSchema,
  mandatory: z.boolean(),
  gates: z.strictObject({
    coverage: semanticBootstrapAdmissionGateSchema,
    lowerability: semanticBootstrapAdmissionGateSchema,
    source_boundary: semanticBootstrapAdmissionGateSchema,
    mapping_evidence: semanticBootstrapAdmissionGateSchema,
    join_evidence: semanticBootstrapAdmissionGateSchema,
    formula_compiler: semanticBootstrapAdmissionGateSchema,
    query_dry_run: semanticBootstrapAdmissionGateSchema,
  }),
});

function packageIdentity(entry: z.infer<typeof semanticBootstrapPackageEntrySchema>): string {
  return `${entry.namespace_id}:${entry.package_id}:${entry.package_version}:${entry.package_hash}`;
}

function canonicalizePackageEntries(
  entries: ReadonlyArray<z.infer<typeof semanticBootstrapPackageEntrySchema>>,
): Array<z.infer<typeof semanticBootstrapPackageEntrySchema>> {
  const parsed = entries.map((entry) => semanticBootstrapPackageEntrySchema.parse(entry));
  const identities = new Set<string>();
  for (const entry of parsed) {
    const identity = packageIdentity(entry);
    if (identities.has(identity)) {
      throw new TypeError(`Semantic bootstrap package set contains duplicate package: ${identity}`);
    }
    identities.add(identity);
  }
  return parsed.sort((left, right) => compareStable(packageIdentity(left), packageIdentity(right)));
}

function hasCanonicalPackageOrder(
  expected: ReadonlyArray<z.infer<typeof semanticBootstrapPackageEntrySchema>>,
  actual: ReadonlyArray<z.infer<typeof semanticBootstrapPackageEntrySchema>>,
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((entry, index) => {
    const actualEntry = actual[index];
    return actualEntry !== undefined && packageIdentity(entry) === packageIdentity(actualEntry);
  });
}

function assertPackageSetClosure(
  root: z.infer<typeof semanticCandidateSetRootReferenceSchema>,
  packages: ReadonlyArray<z.infer<typeof semanticBootstrapPackageEntrySchema>>,
): void {
  for (const entry of packages) {
    if (
      entry.candidate_revision.candidate_id !== root.candidate_id ||
      entry.candidate_revision.revision_id !== root.revision_id ||
      entry.candidate_revision.revision !== root.revision ||
      entry.candidate_revision.revision_digest !== root.revision_digest ||
      entry.candidate_revision.candidate_set_hash !== root.candidate_set_hash
    ) {
      throw new TypeError(
        `Package ${entry.package_id} does not derive from the Candidate Set Root.`,
      );
    }
    if (Object.values(entry.gates).some((gate) => gate !== "PASS")) {
      throw new TypeError(`Admitted package ${entry.package_id} contains a failed mandatory gate.`);
    }
  }
}

const semanticBootstrapValidationReceiptDraftSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_BOOTSTRAP_VALIDATION_RECEIPT_VERSION),
  receipt_id: canonicalImmutableIdSchema,
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  candidate_set_root: semanticCandidateSetRootReferenceSchema,
  policy_ref: semanticBootstrapPolicyReferenceSchema,
  schema_snapshot: semanticSchemaSnapshotReferenceSchema,
  source_bundle: semanticSourceBundleReferenceSchema,
  packages: z.array(semanticBootstrapPackageEntrySchema).min(1).max(10_000),
  outcome: z.literal("PASS"),
  validator_version: versionIdentifierSchema,
  validated_at: canonicalU2TimestampSchema,
});

export const semanticBootstrapValidationReceiptSchema =
  semanticBootstrapValidationReceiptDraftSchema.extend({ receipt_hash: contentHashSchema });

const semanticBootstrapValidationReceiptBuilderInputSchema =
  semanticBootstrapValidationReceiptDraftSchema.extend({
    receipt_hash: contentHashSchema.optional(),
  });

const runtimeProjectionReferenceSchema = z.strictObject({
  projection_id: canonicalImmutableIdSchema,
  projection_hash: contentHashSchema,
});

const semanticBootstrapValidationReferenceSchema = z.strictObject({
  receipt_id: canonicalImmutableIdSchema,
  receipt_hash: contentHashSchema,
});

const initialSemanticReleaseSetDraftSchema = z.strictObject({
  schema_version: z.literal(INITIAL_SEMANTIC_RELEASE_SET_VERSION),
  release_set_id: canonicalImmutableIdSchema,
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  release_id: canonicalImmutableIdSchema,
  generation: z.literal(1),
  base_release_id: z.null(),
  candidate_set_root: semanticCandidateSetRootReferenceSchema,
  policy_ref: semanticBootstrapPolicyReferenceSchema,
  validation_ref: semanticBootstrapValidationReferenceSchema,
  packages: z.array(semanticBootstrapPackageEntrySchema).min(1).max(10_000),
  runtime_projections: z.strictObject({
    executable: runtimeProjectionReferenceSchema,
    relationship: runtimeProjectionReferenceSchema,
    runtime_restriction: runtimeProjectionReferenceSchema,
  }),
  published_at: canonicalU2TimestampSchema,
});

export const initialSemanticReleaseSetSchema = initialSemanticReleaseSetDraftSchema.extend({
  release_set_hash: contentHashSchema,
});

const initialSemanticReleaseSetBuilderInputSchema = initialSemanticReleaseSetDraftSchema.extend({
  release_set_hash: contentHashSchema.optional(),
});

export const semanticReleaseSetReferenceSchema = z.strictObject({
  release_set_id: canonicalImmutableIdSchema,
  release_set_hash: contentHashSchema,
});

const semanticPackageAdmissionReceiptDraftSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_PACKAGE_ADMISSION_RECEIPT_VERSION),
  receipt_id: canonicalImmutableIdSchema,
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  release_set_ref: semanticReleaseSetReferenceSchema,
  package: semanticBootstrapPackageEntrySchema,
  admission: z.literal("ADMITTED"),
  admitted_at: canonicalU2TimestampSchema,
});

export const semanticPackageAdmissionReceiptSchema =
  semanticPackageAdmissionReceiptDraftSchema.extend({ receipt_hash: contentHashSchema });

const semanticPackageAdmissionReceiptBuilderInputSchema =
  semanticPackageAdmissionReceiptDraftSchema.extend({ receipt_hash: contentHashSchema.optional() });

export const semanticPublisherGrantReferenceSchema = z.strictObject({
  grant_id: canonicalImmutableIdSchema,
  grant_hash: contentHashSchema,
});

export const createSemanticPublisherGrantCommandSchema = z
  .strictObject({
    schema_version: z.literal("semantic-publisher-grant-create-command@1.0.0"),
    command_id: canonicalImmutableIdSchema,
    idempotency_key: workspaceIdempotencyKeySchema,
    scope: workspaceScopedAuthoritySchema,
    semantic_domain: semanticDomainSchema,
    issuer: z.strictObject({
      principal_id: canonicalImmutableIdSchema,
      key_id: versionIdentifierSchema,
      key_revision: positiveRevisionSchema,
    }),
    operator_principal_id: canonicalImmutableIdSchema,
    audience: z.literal("SEMANTIC_BOOTSTRAP_PUBLISHER"),
    release_set_id: canonicalImmutableIdSchema,
    candidate_set_hash: contentHashSchema,
    policy_ref: semanticBootstrapPolicyReferenceSchema,
    revocation_epoch: z.number().int().nonnegative().safe(),
    issued_at: canonicalU2TimestampSchema,
    expires_at: canonicalU2TimestampSchema,
  })
  .superRefine((command, ctx) => {
    if (Date.parse(command.issued_at) >= Date.parse(command.expires_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Publisher Grant expires_at 必须晚于 issued_at。",
        path: ["expires_at"],
      });
    }
  });

export const createSemanticPublisherGrantResultSchema = z.strictObject({
  schema_version: z.literal("semantic-publisher-grant-create-result@1.0.0"),
  grant_ref: semanticPublisherGrantReferenceSchema,
  request_hash: contentHashSchema,
  disposition: z.enum(["CREATED", "REPLAYED"]),
});

const receiptReferenceSchema = z.strictObject({
  receipt_id: canonicalImmutableIdSchema,
  receipt_hash: contentHashSchema,
});

export const semanticPackageAdmissionReferenceSchema = receiptReferenceSchema.extend({
  package_id: canonicalImmutableIdSchema,
  package_version: positiveRevisionSchema,
  package_hash: contentHashSchema,
});

function packageAdmissionIdentity(
  entry: z.infer<typeof semanticPackageAdmissionReferenceSchema>,
): string {
  return `${entry.package_id}:${entry.package_version}:${entry.package_hash}:${entry.receipt_id}`;
}

function canonicalizePackageAdmissionReferences(
  entries: ReadonlyArray<z.infer<typeof semanticPackageAdmissionReferenceSchema>>,
): Array<z.infer<typeof semanticPackageAdmissionReferenceSchema>> {
  const parsed = entries.map((entry) => semanticPackageAdmissionReferenceSchema.parse(entry));
  const packageIds = new Set<string>();
  const receiptIds = new Set<string>();
  for (const entry of parsed) {
    const packageId = `${entry.package_id}:${entry.package_version}:${entry.package_hash}`;
    if (packageIds.has(packageId) || receiptIds.has(entry.receipt_id)) {
      throw new TypeError("First Release Admission contains duplicate package/receipt reference.");
    }
    packageIds.add(packageId);
    receiptIds.add(entry.receipt_id);
  }
  return parsed.sort((left, right) =>
    compareStable(packageAdmissionIdentity(left), packageAdmissionIdentity(right)),
  );
}

function hasCanonicalPackageAdmissionOrder(
  expected: ReadonlyArray<z.infer<typeof semanticPackageAdmissionReferenceSchema>>,
  actual: ReadonlyArray<z.infer<typeof semanticPackageAdmissionReferenceSchema>>,
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((entry, index) => {
    const actualEntry = actual[index];
    return (
      actualEntry !== undefined &&
      packageAdmissionIdentity(entry) === packageAdmissionIdentity(actualEntry)
    );
  });
}

const firstReleaseAdmissionReceiptDraftSchema = z.strictObject({
  schema_version: z.literal(FIRST_RELEASE_ADMISSION_RECEIPT_VERSION),
  receipt_id: canonicalImmutableIdSchema,
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  approval_mode: z.literal("SYSTEM_BOOTSTRAP_POLICY"),
  release_set_ref: semanticReleaseSetReferenceSchema,
  policy_ref: semanticBootstrapPolicyReferenceSchema,
  verified_domain_ref: receiptReferenceSchema,
  validation_ref: receiptReferenceSchema,
  grant_ref: semanticPublisherGrantReferenceSchema,
  package_admissions: z.array(semanticPackageAdmissionReferenceSchema).min(1).max(10_000),
  decision_set_digest: contentHashSchema,
  admitted_at: canonicalU2TimestampSchema,
});

export const firstReleaseAdmissionReceiptSchema = firstReleaseAdmissionReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

const firstReleaseAdmissionReceiptBuilderInputSchema =
  firstReleaseAdmissionReceiptDraftSchema.extend({ receipt_hash: contentHashSchema.optional() });

const semanticBootstrapCapabilityTombstoneDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-bootstrap-capability-tombstone@1.0.0"),
  tombstone_id: canonicalImmutableIdSchema,
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  release_set_ref: semanticReleaseSetReferenceSchema,
  first_release_receipt_ref: receiptReferenceSchema,
  consumed_grant_ref: semanticPublisherGrantReferenceSchema,
  closed_at: canonicalU2TimestampSchema,
});

export const semanticBootstrapCapabilityTombstoneSchema =
  semanticBootstrapCapabilityTombstoneDraftSchema.extend({
    tombstone_hash: contentHashSchema,
  });

const semanticBootstrapCapabilityTombstoneBuilderInputSchema =
  semanticBootstrapCapabilityTombstoneDraftSchema.extend({
    tombstone_hash: contentHashSchema.optional(),
  });

export const publishInitialSemanticReleaseCommandSchema = z.strictObject({
  schema_version: z.literal("publish-initial-semantic-release-command@1.0.0"),
  command_id: canonicalImmutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  verified_domain_ref: receiptReferenceSchema,
  policy_ref: semanticBootstrapPolicyReferenceSchema,
  grant_ref: semanticPublisherGrantReferenceSchema,
  validation_ref: receiptReferenceSchema,
  release_set: initialSemanticReleaseSetSchema,
});

export const publishInitialSemanticReleaseResultSchema = z.strictObject({
  schema_version: z.literal("publish-initial-semantic-release-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  request_hash: contentHashSchema,
  release_set: initialSemanticReleaseSetSchema,
  package_admissions: z.array(semanticPackageAdmissionReceiptSchema).min(1),
  first_release_receipt: firstReleaseAdmissionReceiptSchema,
  tombstone: semanticBootstrapCapabilityTombstoneSchema,
});

export const loadInitialSemanticReleaseCommandSchema = z.strictObject({
  schema_version: z.literal("load-initial-semantic-release-command@1.0.0"),
  scope: workspaceScopedAuthoritySchema,
  semantic_domain: semanticDomainSchema,
  release_set_ref: semanticReleaseSetReferenceSchema,
});

export const loadInitialSemanticReleaseResultSchema = z.strictObject({
  schema_version: z.literal("load-initial-semantic-release-result@1.0.0"),
  release_set: initialSemanticReleaseSetSchema,
  package_admissions: z.array(semanticPackageAdmissionReceiptSchema).min(1),
  first_release_receipt: firstReleaseAdmissionReceiptSchema,
  tombstone: semanticBootstrapCapabilityTombstoneSchema,
});

export async function computeSemanticBootstrapPolicyHash(input: unknown) {
  return sha256ContentHash(semanticBootstrapPolicyViewDraftSchema.parse(input));
}

export async function buildSemanticBootstrapPolicyView(input: unknown) {
  const parsed = semanticBootstrapPolicyViewBuilderInputSchema.parse(input);
  const { policy_hash: _ignored, ...draft } = parsed;
  const policy = semanticBootstrapPolicyViewSchema.parse({
    ...draft,
    policy_hash: await computeSemanticBootstrapPolicyHash(draft),
  });
  return deepFreeze(policy);
}

export async function verifySemanticBootstrapPolicyView(input: unknown): Promise<true> {
  const policy = semanticBootstrapPolicyViewSchema.parse(input);
  const { policy_hash: actual, ...draft } = policy;
  if ((await computeSemanticBootstrapPolicyHash(draft)) !== actual) {
    throw new TypeError("Semantic Bootstrap Policy hash mismatch.");
  }
  return true;
}

export async function computeVerifiedDomainBootstrapReceiptHash(input: unknown) {
  return sha256ContentHash(verifiedDomainBootstrapReceiptDraftSchema.parse(input));
}

export async function computeSemanticDomainBootstrapPacketDigest(input: unknown) {
  return sha256ContentHash(semanticDomainBootstrapPacketDraftSchema.parse(input));
}

export async function buildSemanticDomainBootstrapPacket(input: unknown) {
  const parsed = semanticDomainBootstrapPacketBuilderInputSchema.parse(input);
  const { packet_digest: _ignored, ...draft } = parsed;
  const packet = semanticDomainBootstrapPacketSchema.parse({
    ...draft,
    packet_digest: await computeSemanticDomainBootstrapPacketDigest(draft),
  });
  return deepFreeze(packet);
}

export async function verifySemanticDomainBootstrapPacket(input: unknown): Promise<true> {
  const packet = semanticDomainBootstrapPacketSchema.parse(input);
  const { packet_digest: actual, ...draft } = packet;
  if ((await computeSemanticDomainBootstrapPacketDigest(draft)) !== actual) {
    throw new TypeError("Semantic Domain Bootstrap Packet digest mismatch.");
  }
  return true;
}

export async function buildVerifiedDomainBootstrapReceipt(input: unknown) {
  const parsed = verifiedDomainBootstrapReceiptBuilderInputSchema.parse(input);
  const { receipt_hash: _ignored, ...draft } = parsed;
  assertTimestampOrder(draft.issued_at, draft.expires_at, "Verified Domain Bootstrap Receipt");
  const receipt = verifiedDomainBootstrapReceiptSchema.parse({
    ...draft,
    receipt_hash: await computeVerifiedDomainBootstrapReceiptHash(draft),
  });
  return deepFreeze(receipt);
}

export async function verifyVerifiedDomainBootstrapReceipt(input: unknown): Promise<true> {
  const receipt = verifiedDomainBootstrapReceiptSchema.parse(input);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await computeVerifiedDomainBootstrapReceiptHash(draft)) !== actual) {
    throw new TypeError("Verified Domain Bootstrap Receipt hash mismatch.");
  }
  return true;
}

export async function computeSemanticBootstrapValidationReceiptHash(input: unknown) {
  return sha256ContentHash(semanticBootstrapValidationReceiptDraftSchema.parse(input));
}

export async function buildSemanticBootstrapValidationReceipt(input: unknown) {
  const parsed = semanticBootstrapValidationReceiptBuilderInputSchema.parse(input);
  const { receipt_hash: _ignored, ...uncanonicalized } = parsed;
  const draft = semanticBootstrapValidationReceiptDraftSchema.parse({
    ...uncanonicalized,
    packages: canonicalizePackageEntries(uncanonicalized.packages),
  });
  assertPackageSetClosure(draft.candidate_set_root, draft.packages);
  const receipt = semanticBootstrapValidationReceiptSchema.parse({
    ...draft,
    receipt_hash: await computeSemanticBootstrapValidationReceiptHash(draft),
  });
  return deepFreeze(receipt);
}

export async function verifySemanticBootstrapValidationReceipt(input: unknown): Promise<true> {
  const receipt = semanticBootstrapValidationReceiptSchema.parse(input);
  const canonicalPackages = canonicalizePackageEntries(receipt.packages);
  if (!hasCanonicalPackageOrder(canonicalPackages, receipt.packages)) {
    throw new TypeError("Semantic Bootstrap Validation package order is not canonical.");
  }
  assertPackageSetClosure(receipt.candidate_set_root, receipt.packages);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await computeSemanticBootstrapValidationReceiptHash(draft)) !== actual) {
    throw new TypeError("Semantic Bootstrap Validation Receipt hash mismatch.");
  }
  return true;
}

export async function computeInitialSemanticReleaseSetHash(input: unknown) {
  return sha256ContentHash(initialSemanticReleaseSetDraftSchema.parse(input));
}

export async function buildInitialSemanticReleaseSet(input: unknown) {
  const parsed = initialSemanticReleaseSetBuilderInputSchema.parse(input);
  const { release_set_hash: _ignored, ...uncanonicalized } = parsed;
  const draft = initialSemanticReleaseSetDraftSchema.parse({
    ...uncanonicalized,
    packages: canonicalizePackageEntries(uncanonicalized.packages),
  });
  assertPackageSetClosure(draft.candidate_set_root, draft.packages);
  const releaseSet = initialSemanticReleaseSetSchema.parse({
    ...draft,
    release_set_hash: await computeInitialSemanticReleaseSetHash(draft),
  });
  return deepFreeze(releaseSet);
}

export async function verifyInitialSemanticReleaseSet(input: unknown): Promise<true> {
  const releaseSet = initialSemanticReleaseSetSchema.parse(input);
  const canonicalPackages = canonicalizePackageEntries(releaseSet.packages);
  if (!hasCanonicalPackageOrder(canonicalPackages, releaseSet.packages)) {
    throw new TypeError("Initial Semantic Release Set package order is not canonical.");
  }
  assertPackageSetClosure(releaseSet.candidate_set_root, releaseSet.packages);
  const { release_set_hash: actual, ...draft } = releaseSet;
  if ((await computeInitialSemanticReleaseSetHash(draft)) !== actual) {
    throw new TypeError("Initial Semantic Release Set hash mismatch.");
  }
  return true;
}

export async function computeSemanticPackageAdmissionReceiptHash(input: unknown) {
  return sha256ContentHash(semanticPackageAdmissionReceiptDraftSchema.parse(input));
}

export async function buildSemanticPackageAdmissionReceipt(input: unknown) {
  const parsed = semanticPackageAdmissionReceiptBuilderInputSchema.parse(input);
  const { receipt_hash: _ignored, ...draft } = parsed;
  assertPackageSetClosure(draft.package.candidate_revision, [draft.package]);
  const receipt = semanticPackageAdmissionReceiptSchema.parse({
    ...draft,
    receipt_hash: await computeSemanticPackageAdmissionReceiptHash(draft),
  });
  return deepFreeze(receipt);
}

export async function verifySemanticPackageAdmissionReceipt(input: unknown): Promise<true> {
  const receipt = semanticPackageAdmissionReceiptSchema.parse(input);
  assertPackageSetClosure(receipt.package.candidate_revision, [receipt.package]);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await computeSemanticPackageAdmissionReceiptHash(draft)) !== actual) {
    throw new TypeError("Semantic Package Admission Receipt hash mismatch.");
  }
  return true;
}

export async function computeFirstReleaseAdmissionReceiptHash(input: unknown) {
  return sha256ContentHash(firstReleaseAdmissionReceiptDraftSchema.parse(input));
}

export async function computeSemanticBootstrapCapabilityTombstoneHash(input: unknown) {
  return sha256ContentHash(semanticBootstrapCapabilityTombstoneDraftSchema.parse(input));
}

export async function buildSemanticBootstrapCapabilityTombstone(input: unknown) {
  const parsed = semanticBootstrapCapabilityTombstoneBuilderInputSchema.parse(input);
  const { tombstone_hash: _ignored, ...draft } = parsed;
  return deepFreeze(
    semanticBootstrapCapabilityTombstoneSchema.parse({
      ...draft,
      tombstone_hash: await computeSemanticBootstrapCapabilityTombstoneHash(draft),
    }),
  );
}

export async function verifySemanticBootstrapCapabilityTombstone(input: unknown): Promise<true> {
  const tombstone = semanticBootstrapCapabilityTombstoneSchema.parse(input);
  const { tombstone_hash: actual, ...draft } = tombstone;
  if ((await computeSemanticBootstrapCapabilityTombstoneHash(draft)) !== actual) {
    throw new TypeError("Semantic Bootstrap Capability Tombstone hash mismatch.");
  }
  return true;
}

export async function buildFirstReleaseAdmissionReceipt(input: unknown) {
  const parsed = firstReleaseAdmissionReceiptBuilderInputSchema.parse(input);
  const { receipt_hash: _ignored, ...uncanonicalized } = parsed;
  const draft = firstReleaseAdmissionReceiptDraftSchema.parse({
    ...uncanonicalized,
    package_admissions: canonicalizePackageAdmissionReferences(uncanonicalized.package_admissions),
  });
  if (draft.decision_set_digest !== draft.release_set_ref.release_set_hash) {
    throw new TypeError("First Release decision_set_digest must equal the Release Set hash.");
  }
  const receipt = firstReleaseAdmissionReceiptSchema.parse({
    ...draft,
    receipt_hash: await computeFirstReleaseAdmissionReceiptHash(draft),
  });
  return deepFreeze(receipt);
}

export async function verifyFirstReleaseAdmissionReceipt(input: {
  readonly receipt: unknown;
  readonly release_set: unknown;
  readonly policy: unknown;
  readonly verified_domain: unknown;
  readonly validation: unknown;
  readonly package_admissions: readonly unknown[];
}): Promise<true> {
  const receipt = firstReleaseAdmissionReceiptSchema.parse(input.receipt);
  const releaseSet = initialSemanticReleaseSetSchema.parse(input.release_set);
  const policy = semanticBootstrapPolicyViewSchema.parse(input.policy);
  const verifiedDomain = verifiedDomainBootstrapReceiptSchema.parse(input.verified_domain);
  const validation = semanticBootstrapValidationReceiptSchema.parse(input.validation);
  const packageAdmissions = input.package_admissions.map((entry) =>
    semanticPackageAdmissionReceiptSchema.parse(entry),
  );
  await Promise.all([
    verifySemanticBootstrapPolicyView(policy),
    verifyVerifiedDomainBootstrapReceipt(verifiedDomain),
    verifySemanticBootstrapValidationReceipt(validation),
    verifyInitialSemanticReleaseSet(releaseSet),
    ...packageAdmissions.map(verifySemanticPackageAdmissionReceipt),
  ]);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await computeFirstReleaseAdmissionReceiptHash(draft)) !== actual) {
    throw new TypeError("First Release Admission Receipt hash mismatch.");
  }
  for (const authority of [
    policy.scope,
    verifiedDomain.scope,
    validation.scope,
    releaseSet.scope,
  ]) {
    assertSameScope(receipt.scope, authority, "First Release Admission");
  }
  if (
    receipt.semantic_domain !== releaseSet.semantic_domain ||
    receipt.semantic_domain !== policy.semantic_domain ||
    receipt.semantic_domain !== verifiedDomain.semantic_domain ||
    receipt.semantic_domain !== validation.semantic_domain ||
    receipt.release_set_ref.release_set_id !== releaseSet.release_set_id ||
    receipt.release_set_ref.release_set_hash !== releaseSet.release_set_hash ||
    receipt.decision_set_digest !== releaseSet.release_set_hash ||
    receipt.policy_ref.policy_id !== policy.policy_id ||
    receipt.policy_ref.policy_revision !== policy.policy_revision ||
    receipt.policy_ref.policy_hash !== policy.policy_hash ||
    receipt.verified_domain_ref.receipt_id !== verifiedDomain.receipt_id ||
    receipt.verified_domain_ref.receipt_hash !== verifiedDomain.receipt_hash ||
    receipt.validation_ref.receipt_id !== validation.receipt_id ||
    receipt.validation_ref.receipt_hash !== validation.receipt_hash
  ) {
    throw new TypeError("First Release Admission Authority correlation mismatch.");
  }
  if (
    releaseSet.validation_ref.receipt_id !== validation.receipt_id ||
    releaseSet.validation_ref.receipt_hash !== validation.receipt_hash ||
    releaseSet.policy_ref.policy_hash !== policy.policy_hash ||
    verifiedDomain.policy_ref.policy_hash !== policy.policy_hash ||
    releaseSet.candidate_set_root.candidate_set_hash !==
      validation.candidate_set_root.candidate_set_hash ||
    releaseSet.candidate_set_root.candidate_set_hash !==
      verifiedDomain.candidate_set_root.candidate_set_hash
  ) {
    throw new TypeError("Release Set does not close over verified policy/candidate validation.");
  }
  const expectedRefs = canonicalizePackageAdmissionReferences(
    packageAdmissions.map((admission) => ({
      receipt_id: admission.receipt_id,
      receipt_hash: admission.receipt_hash,
      package_id: admission.package.package_id,
      package_version: admission.package.package_version,
      package_hash: admission.package.package_hash,
    })),
  );
  const actualRefs = canonicalizePackageAdmissionReferences(receipt.package_admissions);
  if (!hasCanonicalPackageAdmissionOrder(actualRefs, receipt.package_admissions)) {
    throw new TypeError("First Release package admission order is not canonical.");
  }
  if (
    expectedRefs.length !== releaseSet.packages.length ||
    actualRefs.length !== expectedRefs.length ||
    validation.packages.length !== releaseSet.packages.length
  ) {
    throw new TypeError("First Release package admission count mismatch.");
  }
  for (const [index, expected] of expectedRefs.entries()) {
    const actualRef = actualRefs[index];
    const releasePackage = releaseSet.packages[index];
    const validationPackage = validation.packages[index];
    const admission = packageAdmissions.find((entry) => entry.receipt_id === expected.receipt_id);
    if (
      actualRef === undefined ||
      releasePackage === undefined ||
      validationPackage === undefined ||
      admission === undefined ||
      packageAdmissionIdentity(actualRef) !== packageAdmissionIdentity(expected) ||
      admission.release_set_ref.release_set_hash !== releaseSet.release_set_hash ||
      admission.release_set_ref.release_set_id !== releaseSet.release_set_id ||
      admission.semantic_domain !== receipt.semantic_domain ||
      packageIdentity(validationPackage) !== packageIdentity(releasePackage) ||
      packageIdentity(admission.package) !== packageIdentity(releasePackage)
    ) {
      throw new TypeError("First Release package admission correlation mismatch.");
    }
    assertSameScope(receipt.scope, admission.scope, "Package Admission");
  }
  return true;
}

export async function verifyPublishedInitialSemanticReleaseBundle(input: {
  readonly release_set: unknown;
  readonly package_admissions: readonly unknown[];
  readonly first_release_receipt: unknown;
  readonly tombstone: unknown;
}): Promise<true> {
  const releaseSet = initialSemanticReleaseSetSchema.parse(input.release_set);
  const packageAdmissions = input.package_admissions.map((entry) =>
    semanticPackageAdmissionReceiptSchema.parse(entry),
  );
  const firstRelease = firstReleaseAdmissionReceiptSchema.parse(input.first_release_receipt);
  const tombstone = semanticBootstrapCapabilityTombstoneSchema.parse(input.tombstone);
  await Promise.all([
    verifyInitialSemanticReleaseSet(releaseSet),
    ...packageAdmissions.map(verifySemanticPackageAdmissionReceipt),
    verifySemanticBootstrapCapabilityTombstone(tombstone),
  ]);
  const { receipt_hash: firstReleaseHash, ...firstReleaseDraft } = firstRelease;
  if ((await computeFirstReleaseAdmissionReceiptHash(firstReleaseDraft)) !== firstReleaseHash) {
    throw new TypeError("First Release Admission Receipt hash mismatch.");
  }
  for (const authority of [
    firstRelease.scope,
    tombstone.scope,
    ...packageAdmissions.map((entry) => entry.scope),
  ]) {
    assertSameScope(releaseSet.scope, authority, "Published Initial Semantic Release bundle");
  }
  if (
    firstRelease.semantic_domain !== releaseSet.semantic_domain ||
    tombstone.semantic_domain !== releaseSet.semantic_domain ||
    packageAdmissions.some((entry) => entry.semantic_domain !== releaseSet.semantic_domain) ||
    firstRelease.release_set_ref.release_set_id !== releaseSet.release_set_id ||
    firstRelease.release_set_ref.release_set_hash !== releaseSet.release_set_hash ||
    firstRelease.decision_set_digest !== releaseSet.release_set_hash ||
    firstRelease.policy_ref.policy_id !== releaseSet.policy_ref.policy_id ||
    firstRelease.policy_ref.policy_revision !== releaseSet.policy_ref.policy_revision ||
    firstRelease.policy_ref.policy_hash !== releaseSet.policy_ref.policy_hash ||
    firstRelease.validation_ref.receipt_id !== releaseSet.validation_ref.receipt_id ||
    firstRelease.validation_ref.receipt_hash !== releaseSet.validation_ref.receipt_hash ||
    tombstone.release_set_ref.release_set_id !== releaseSet.release_set_id ||
    tombstone.release_set_ref.release_set_hash !== releaseSet.release_set_hash ||
    tombstone.first_release_receipt_ref.receipt_id !== firstRelease.receipt_id ||
    tombstone.first_release_receipt_ref.receipt_hash !== firstRelease.receipt_hash ||
    tombstone.consumed_grant_ref.grant_id !== firstRelease.grant_ref.grant_id ||
    tombstone.consumed_grant_ref.grant_hash !== firstRelease.grant_ref.grant_hash
  ) {
    throw new TypeError("Published Initial Semantic Release Authority correlation mismatch.");
  }
  if (
    packageAdmissions.length !== releaseSet.packages.length ||
    firstRelease.package_admissions.length !== releaseSet.packages.length
  ) {
    throw new TypeError("Published Initial Semantic Release package count mismatch.");
  }
  const canonicalFirstReleaseRefs = canonicalizePackageAdmissionReferences(
    firstRelease.package_admissions,
  );
  if (
    !hasCanonicalPackageAdmissionOrder(canonicalFirstReleaseRefs, firstRelease.package_admissions)
  ) {
    throw new TypeError("Published Initial Semantic Release package order is not canonical.");
  }
  const releasePackages = new Map(
    releaseSet.packages.map((entry) => [packageIdentity(entry), entry] as const),
  );
  const firstReleaseRefs = new Map(
    firstRelease.package_admissions.map((entry) => [
      `${entry.package_id}:${entry.package_version}:${entry.package_hash}`,
      entry,
    ]),
  );
  if (
    releasePackages.size !== releaseSet.packages.length ||
    firstReleaseRefs.size !== firstRelease.package_admissions.length
  ) {
    throw new TypeError("Published Initial Semantic Release contains duplicate package identity.");
  }
  const seenReceipts = new Set<string>();
  for (const [index, admission] of packageAdmissions.entries()) {
    const packageKey = packageIdentity(admission.package);
    const releasePackage = releasePackages.get(packageKey);
    const orderedReleasePackage = releaseSet.packages[index];
    const receiptRef = firstReleaseRefs.get(
      `${admission.package.package_id}:${admission.package.package_version}:${admission.package.package_hash}`,
    );
    if (
      releasePackage === undefined ||
      orderedReleasePackage === undefined ||
      receiptRef === undefined ||
      seenReceipts.has(admission.receipt_id) ||
      admission.release_set_ref.release_set_id !== releaseSet.release_set_id ||
      admission.release_set_ref.release_set_hash !== releaseSet.release_set_hash ||
      packageIdentity(admission.package) !== packageIdentity(orderedReleasePackage) ||
      receiptRef.receipt_id !== admission.receipt_id ||
      receiptRef.receipt_hash !== admission.receipt_hash
    ) {
      throw new TypeError("Published Initial Semantic Release package admission mismatch.");
    }
    seenReceipts.add(admission.receipt_id);
  }
  return true;
}

export type SemanticBootstrapPolicyView = z.infer<typeof semanticBootstrapPolicyViewSchema>;
export type SemanticDomainBootstrapPacket = z.infer<typeof semanticDomainBootstrapPacketSchema>;
export type VerifiedDomainBootstrapReceipt = z.infer<typeof verifiedDomainBootstrapReceiptSchema>;
export type SemanticBootstrapPackageEntry = z.infer<typeof semanticBootstrapPackageEntrySchema>;
export type SemanticBootstrapValidationReceipt = z.infer<
  typeof semanticBootstrapValidationReceiptSchema
>;
export type InitialSemanticReleaseSet = z.infer<typeof initialSemanticReleaseSetSchema>;
export type SemanticPackageAdmissionReceipt = z.infer<typeof semanticPackageAdmissionReceiptSchema>;
export type FirstReleaseAdmissionReceipt = z.infer<typeof firstReleaseAdmissionReceiptSchema>;
export type PublishInitialSemanticReleaseCommand = z.infer<
  typeof publishInitialSemanticReleaseCommandSchema
>;
export type PublishInitialSemanticReleaseResult = z.infer<
  typeof publishInitialSemanticReleaseResultSchema
>;
export type CreateSemanticPublisherGrantCommand = z.infer<
  typeof createSemanticPublisherGrantCommandSchema
>;
export type CreateSemanticPublisherGrantResult = z.infer<
  typeof createSemanticPublisherGrantResultSchema
>;
