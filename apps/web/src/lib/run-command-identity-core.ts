import { createHash } from "node:crypto";

const IDENTITY_DOMAIN = "data-agent/run-command-identity@1";

const identityKinds = ["run", "command", "event", "outbox", "audit"] as const;

type IdentityKind = (typeof identityKinds)[number];

function deterministicUuidV8(material: string): string {
  const bytes = createHash("sha256").update(material, "utf8").digest().subarray(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new TypeError("RUN_COMMAND_IDENTITY_DIGEST_INVALID");
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveRunCommandIdentities(input: {
  workspace_id: string;
  principal_id: string;
  idempotency_key: string;
}) {
  const prefix = [
    IDENTITY_DOMAIN,
    input.workspace_id.toLowerCase(),
    input.principal_id.toLowerCase(),
    input.idempotency_key,
  ].join("\u0000");
  const entries = identityKinds.map((kind) => [
    `${kind}_id`,
    deterministicUuidV8(`${prefix}\u0000${kind satisfies IdentityKind}`),
  ]);
  return Object.fromEntries(entries) as Record<`${IdentityKind}_id`, string>;
}

export function deriveIdempotentOperationId(input: {
  operation_kind: string;
  workspace_id: string;
  principal_id: string;
  idempotency_key: string;
}) {
  return deterministicUuidV8(
    [
      IDENTITY_DOMAIN,
      input.operation_kind,
      input.workspace_id.toLowerCase(),
      input.principal_id.toLowerCase(),
      input.idempotency_key,
    ].join("\u0000"),
  );
}
