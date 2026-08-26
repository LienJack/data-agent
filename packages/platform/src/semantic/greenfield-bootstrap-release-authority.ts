import { createPublicKey, verify } from "node:crypto";
import {
  canonicalizeJson,
  contentHashSchema,
  initialSemanticReleaseSetSchema,
  loadInitialSemanticReleaseCommandSchema,
  loadInitialSemanticReleaseResultSchema,
  type PortResult,
  publicVerificationMaterialSchema,
  publishInitialSemanticReleaseCommandSchema,
  publishInitialSemanticReleaseResultSchema,
  semanticDomainBootstrapPacketSchema,
  sha256ContentHash,
  verifiedDomainBootstrapReceiptSchema,
  verifyPublishedInitialSemanticReleaseBundle,
  verifySemanticDomainBootstrapPacket,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface JsonValueRow {
  readonly value: unknown;
}

const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);

const signerContextEntrySchema = z.strictObject({
  principal_id: z.uuid().transform((value) => value.toLowerCase()),
  key_id: z.string().min(1).max(128),
  key_revision: z.number().int().positive().safe(),
  role: z.enum(["WORKSPACE_ADMIN", "PLATFORM_ATTESTOR"]),
  purpose: z.enum(["SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE", "PLATFORM_ATTESTATION"]),
  status: z.literal("ACTIVE"),
  public_material: publicVerificationMaterialSchema,
  public_material_hash: contentHashSchema,
  activation_receipt_hash: contentHashSchema,
});

const signerContextSchema = z
  .strictObject({
    workspace_admin: signerContextEntrySchema,
    platform_attestor: signerContextEntrySchema,
  })
  .superRefine((context, refinement) => {
    if (
      context.workspace_admin.role !== "WORKSPACE_ADMIN" ||
      context.workspace_admin.purpose !== "SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE" ||
      context.platform_attestor.role !== "PLATFORM_ATTESTOR" ||
      context.platform_attestor.purpose !== "PLATFORM_ATTESTATION"
    ) {
      refinement.addIssue({ code: "custom", message: "Signer role/purpose mismatch." });
    }
    if (
      context.workspace_admin.principal_id === context.platform_attestor.principal_id ||
      context.workspace_admin.key_id === context.platform_attestor.key_id ||
      context.workspace_admin.public_material_hash ===
        context.platform_attestor.public_material_hash
    ) {
      refinement.addIssue({ code: "custom", message: "Signer separation mismatch." });
    }
  });

const verifyDomainInputSchema = z.strictObject({
  packet: semanticDomainBootstrapPacketSchema,
  workspace_admin_signature: signatureSchema,
  platform_attestor_signature: signatureSchema,
});

export interface PostgresGreenfieldBootstrapReleaseAuthority {
  verifyDomain(capability: unknown, input: unknown): Promise<PortResult<unknown>>;
  publishInitial(capability: unknown, command: unknown): Promise<PortResult<unknown>>;
  loadInitial(capability: unknown, command: unknown): Promise<PortResult<unknown>>;
}

export interface PostgresGreenfieldBootstrapReleaseAuthorityOptions {
  readonly verifier_pool: SqlPool;
  readonly publisher_pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function failure(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

function mapDatabaseError(error: unknown): PortResult<never> | null {
  const message = error instanceof Error ? error.message : "";
  for (const marker of [
    "SEMANTIC_BOOTSTRAP_CANDIDATE_SET_ROOT_INVALID",
    "SEMANTIC_BOOTSTRAP_CAPABILITY_CLOSED",
    "SEMANTIC_BOOTSTRAP_IDEMPOTENCY_CONFLICT",
    "SEMANTIC_BOOTSTRAP_KEY_NOT_ACTIVE",
    "SEMANTIC_BOOTSTRAP_LOAD_INVALID",
    "SEMANTIC_BOOTSTRAP_PACKET_INVALID",
    "SEMANTIC_BOOTSTRAP_POLICY_INVALID",
    "SEMANTIC_BOOTSTRAP_POLICY_STALE",
    "SEMANTIC_BOOTSTRAP_PUBLISHER_GRANT_INVALID",
    "SEMANTIC_BOOTSTRAP_PUBLISH_COMMAND_INVALID",
    "SEMANTIC_BOOTSTRAP_RELEASE_NOT_FOUND",
    "SEMANTIC_BOOTSTRAP_RELEASE_SET_INVALID",
    "SEMANTIC_BOOTSTRAP_SCOPE_INVALID",
    "SEMANTIC_BOOTSTRAP_SCOPE_MISMATCH",
    "SEMANTIC_BOOTSTRAP_VALIDATION_GATE_FAILED",
    "SEMANTIC_BOOTSTRAP_VALIDATION_INVALID",
    "SEMANTIC_BOOTSTRAP_VALIDATION_STALE",
    "SEMANTIC_BOOTSTRAP_VERIFIED_COMMIT_INVALID",
    "SEMANTIC_BOOTSTRAP_VERIFIED_RECEIPT_STALE",
  ]) {
    if (message.includes(marker)) {
      return failure(marker, "Semantic Bootstrap Authority 拒绝该请求。");
    }
  }
  return null;
}

function exactValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_BOOTSTRAP_DATABASE_CONTRACT_INVALID",
      "Semantic Bootstrap RPC 必须返回唯一结果。",
      false,
    );
  }
  return rows[0].value;
}

function databaseContractInvalid(message: string): never {
  throw new PersistenceBoundaryError(
    "SEMANTIC_BOOTSTRAP_DATABASE_CONTRACT_INVALID",
    message,
    false,
  );
}

async function verifySignerMaterial(
  entry: z.infer<typeof signerContextEntrySchema>,
): Promise<void> {
  if ((await sha256ContentHash(entry.public_material)) !== entry.public_material_hash) {
    databaseContractInvalid("Signer public material hash 不匹配。");
  }
}

function verifyEd25519Signature(
  publicMaterial: z.infer<typeof publicVerificationMaterialSchema>,
  packetBytes: Uint8Array,
  signature: string,
): boolean {
  const signatureBytes = Buffer.from(signature, "base64url");
  if (signatureBytes.byteLength !== 64) return false;
  const { format: _format, ...jwk } = publicMaterial;
  const key = createPublicKey({ key: jwk, format: "jwk" });
  return verify(null, packetBytes, key, signatureBytes);
}

async function verifyDomainReceiptCorrelation(
  packet: z.infer<typeof semanticDomainBootstrapPacketSchema>,
  context: z.infer<typeof signerContextSchema>,
  workspaceSignature: string,
  platformSignature: string,
  input: unknown,
) {
  const receipt = verifiedDomainBootstrapReceiptSchema.safeParse(input);
  if (!receipt.success) databaseContractInvalid("Verified Domain Receipt strict schema 无效。");
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    databaseContractInvalid("Verified Domain Receipt raw authority 无效。");
  }
  const { receipt_hash: rawReceiptHash, ...rawDraft } = input as Record<string, unknown>;
  if (
    typeof rawReceiptHash !== "string" ||
    (await sha256ContentHash(rawDraft)) !== rawReceiptHash
  ) {
    databaseContractInvalid("Verified Domain Receipt canonical hash 无效。");
  }
  if (
    receipt.data.scope.app_id !== packet.scope.app_id ||
    receipt.data.scope.tenant_id !== packet.scope.tenant_id ||
    receipt.data.scope.workspace_id !== packet.scope.workspace_id ||
    receipt.data.scope.environment !== packet.scope.environment ||
    receipt.data.semantic_domain !== packet.semantic_domain ||
    receipt.data.datasource_id !== packet.datasource_id ||
    receipt.data.packet_digest !== packet.packet_digest ||
    receipt.data.release_set_id !== packet.release_set_id ||
    receipt.data.policy_ref.policy_hash !== packet.policy_ref.policy_hash ||
    receipt.data.candidate_set_root.candidate_set_hash !==
      packet.candidate_set_root.candidate_set_hash ||
    receipt.data.nonce_hash !== packet.nonce_hash ||
    receipt.data.workspace_admin.principal_id !== context.workspace_admin.principal_id ||
    receipt.data.workspace_admin.key_id !== context.workspace_admin.key_id ||
    receipt.data.workspace_admin.key_revision !== context.workspace_admin.key_revision ||
    receipt.data.workspace_admin.public_material_hash !==
      context.workspace_admin.public_material_hash ||
    receipt.data.workspace_admin.activation_receipt_hash !==
      context.workspace_admin.activation_receipt_hash ||
    receipt.data.workspace_admin.signature_hash !== (await sha256ContentHash(workspaceSignature)) ||
    receipt.data.platform_attestor.principal_id !== context.platform_attestor.principal_id ||
    receipt.data.platform_attestor.key_id !== context.platform_attestor.key_id ||
    receipt.data.platform_attestor.key_revision !== context.platform_attestor.key_revision ||
    receipt.data.platform_attestor.public_material_hash !==
      context.platform_attestor.public_material_hash ||
    receipt.data.platform_attestor.activation_receipt_hash !==
      context.platform_attestor.activation_receipt_hash ||
    receipt.data.platform_attestor.signature_hash !== (await sha256ContentHash(platformSignature))
  ) {
    databaseContractInvalid("Verified Domain Receipt 与签名 packet/key Authority 不闭合。");
  }
  return receipt.data;
}

async function verifyPublishedBundle(input: unknown, expectedCommand?: unknown) {
  const schema = expectedCommand
    ? publishInitialSemanticReleaseResultSchema
    : loadInitialSemanticReleaseResultSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) databaseContractInvalid("Initial Release bundle strict schema 无效。");
  try {
    await verifyPublishedInitialSemanticReleaseBundle(parsed.data);
  } catch {
    databaseContractInvalid("Initial Release bundle Authority 闭包无效。");
  }
  const releaseSet = initialSemanticReleaseSetSchema.parse(parsed.data.release_set);
  if (
    parsed.data.first_release_receipt.release_set_ref.release_set_id !==
      releaseSet.release_set_id ||
    parsed.data.first_release_receipt.release_set_ref.release_set_hash !==
      releaseSet.release_set_hash ||
    parsed.data.tombstone.release_set_ref.release_set_hash !== releaseSet.release_set_hash ||
    parsed.data.package_admissions.length !== releaseSet.packages.length
  ) {
    databaseContractInvalid("Initial Release bundle 的 Release Set 闭包不一致。");
  }
  if (expectedCommand) {
    const command = publishInitialSemanticReleaseCommandSchema.parse(expectedCommand);
    if (
      parsed.data.release_set.release_set_hash !== command.release_set.release_set_hash ||
      parsed.data.first_release_receipt.verified_domain_ref.receipt_hash !==
        command.verified_domain_ref.receipt_hash ||
      parsed.data.first_release_receipt.validation_ref.receipt_hash !==
        command.validation_ref.receipt_hash ||
      parsed.data.first_release_receipt.policy_ref.policy_hash !== command.policy_ref.policy_hash ||
      parsed.data.first_release_receipt.grant_ref.grant_hash !== command.grant_ref.grant_hash ||
      ("request_hash" in parsed.data &&
        parsed.data.request_hash !== (await sha256ContentHash(command)))
    ) {
      databaseContractInvalid("Initial Release publish result 与 command 不闭合。");
    }
  }
  return parsed.data;
}

export function createPostgresGreenfieldBootstrapReleaseAuthority(
  options: PostgresGreenfieldBootstrapReleaseAuthorityOptions,
): PostgresGreenfieldBootstrapReleaseAuthority {
  return {
    async verifyDomain(capabilityInput, input) {
      const parsed = verifyDomainInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("SEMANTIC_BOOTSTRAP_INPUT_INVALID", "签名 packet 不符合严格契约。");
      }
      const { packet, workspace_admin_signature, platform_attestor_signature } = parsed.data;
      try {
        await verifySemanticDomainBootstrapPacket(packet);
      } catch {
        return failure("SEMANTIC_BOOTSTRAP_INPUT_INVALID", "签名 packet digest 无效。");
      }
      return withAppTransaction(
        options.verifier_pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "semantic.verify_bootstrap_domain",
          correlation_id: packet.packet_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            packet.semantic_domain,
          ]);
          const loaded = await client.query<JsonValueRow>(
            "select semantic.load_semantic_bootstrap_signer_context($1::jsonb) as value",
            [packet],
          );
          const context = signerContextSchema.safeParse(exactValue(loaded.rows));
          if (!context.success) databaseContractInvalid("Signer context strict schema 无效。");
          await Promise.all([
            verifySignerMaterial(context.data.workspace_admin),
            verifySignerMaterial(context.data.platform_attestor),
          ]);
          const packetBytes = Buffer.from(canonicalizeJson(packet), "utf8");
          if (
            !verifyEd25519Signature(
              context.data.workspace_admin.public_material,
              packetBytes,
              workspace_admin_signature,
            ) ||
            !verifyEd25519Signature(
              context.data.platform_attestor.public_material,
              packetBytes,
              platform_attestor_signature,
            )
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_BOOTSTRAP_SIGNATURE_INVALID",
              "Semantic Bootstrap Ed25519 signature 验证失败。",
              false,
            );
          }
          const safeCommit = {
            packet,
            workspace_admin: {
              principal_id: context.data.workspace_admin.principal_id,
              key_id: context.data.workspace_admin.key_id,
              key_revision: context.data.workspace_admin.key_revision,
              public_material_hash: context.data.workspace_admin.public_material_hash,
              activation_receipt_hash: context.data.workspace_admin.activation_receipt_hash,
              signature_hash: await sha256ContentHash(workspace_admin_signature),
            },
            platform_attestor: {
              principal_id: context.data.platform_attestor.principal_id,
              key_id: context.data.platform_attestor.key_id,
              key_revision: context.data.platform_attestor.key_revision,
              public_material_hash: context.data.platform_attestor.public_material_hash,
              activation_receipt_hash: context.data.platform_attestor.activation_receipt_hash,
              signature_hash: await sha256ContentHash(platform_attestor_signature),
            },
          };
          const committed = await client.query<JsonValueRow>(
            "select semantic.commit_verified_semantic_domain_bootstrap($1::jsonb) as value",
            [safeCommit],
          );
          return verifyDomainReceiptCorrelation(
            packet,
            context.data,
            workspace_admin_signature,
            platform_attestor_signature,
            exactValue(committed.rows),
          );
        },
      );
    },

    async publishInitial(capabilityInput, commandInput) {
      const parsed = publishInitialSemanticReleaseCommandSchema.safeParse(commandInput);
      if (!parsed.success) {
        return failure("SEMANTIC_BOOTSTRAP_INPUT_INVALID", "Initial Release command 无效。");
      }
      return withAppTransaction(
        options.publisher_pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "semantic.publish_initial_release",
          correlation_id: parsed.data.command_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            parsed.data.semantic_domain,
          ]);
          const result = await client.query<JsonValueRow>(
            "select semantic.publish_initial_semantic_release_set($1::jsonb) as value",
            [parsed.data],
          );
          return verifyPublishedBundle(exactValue(result.rows), parsed.data);
        },
      );
    },

    async loadInitial(capabilityInput, commandInput) {
      const parsed = loadInitialSemanticReleaseCommandSchema.safeParse(commandInput);
      if (!parsed.success) {
        return failure("SEMANTIC_BOOTSTRAP_INPUT_INVALID", "Initial Release load command 无效。");
      }
      return withAppTransaction(
        options.publisher_pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.load_initial_release",
          correlation_id: parsed.data.release_set_ref.release_set_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            parsed.data.semantic_domain,
          ]);
          const result = await client.query<JsonValueRow>(
            "select semantic.load_initial_semantic_release_set($1::jsonb) as value",
            [parsed.data],
          );
          return verifyPublishedBundle(exactValue(result.rows));
        },
      );
    },
  };
}
