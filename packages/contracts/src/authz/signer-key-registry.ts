import { z } from "zod";
import { immutableIdSchema, versionIdentifierSchema } from "../common/index.js";

export const signerRegistryRoleSchema = z.enum(["WORKSPACE_ADMIN", "PLATFORM_ATTESTOR"]);
export const signerKeyStatusSchema = z.enum(["STAGED", "ACTIVE", "COMPROMISED", "RETIRED"]);
export const signerKeyPurposeSchema = z.enum([
  "SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE",
  "PLATFORM_ATTESTATION",
]);

const ED25519_FIELD_PRIME = (1n << 255n) - 19n;
const ED25519_SUBGROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;

function mod(value: bigint) {
  const reduced = value % ED25519_FIELD_PRIME;
  return reduced >= 0n ? reduced : reduced + ED25519_FIELD_PRIME;
}

function modPow(base: bigint, exponent: bigint) {
  let result = 1n;
  let factor = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = mod(result * factor);
    factor = mod(factor * factor);
    remaining >>= 1n;
  }
  return result;
}

const ED25519_D = mod(-121665n * modPow(121666n, ED25519_FIELD_PRIME - 2n));
const ED25519_SQRT_M1 = modPow(2n, (ED25519_FIELD_PRIME - 1n) / 4n);

function decodeBase64Url(value: string): Uint8Array | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const output: number[] = [];
  let buffer = 0;
  let bufferedBits = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    buffer = buffer * 64 + digit;
    bufferedBits += 6;
    while (bufferedBits >= 8) {
      bufferedBits -= 8;
      const divisor = 2 ** bufferedBits;
      output.push(Math.floor(buffer / divisor) & 0xff);
      buffer %= divisor;
    }
  }
  if (buffer !== 0 || output.length !== 32) return null;
  return Uint8Array.from(output);
}

function littleEndianInteger(bytes: Uint8Array) {
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(bytes[index] ?? 0);
  }
  return result;
}

type ExtendedEdwardsPoint = readonly [x: bigint, y: bigint, z: bigint, t: bigint];

function addExtendedEdwardsPoints(
  first: ExtendedEdwardsPoint,
  second: ExtendedEdwardsPoint,
): ExtendedEdwardsPoint {
  const [x1, y1, z1, t1] = first;
  const [x2, y2, z2, t2] = second;
  const a = mod((y1 - x1) * (y2 - x2));
  const b = mod((y1 + x1) * (y2 + x2));
  const c = mod(2n * ED25519_D * t1 * t2);
  const d = mod(2n * z1 * z2);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}

function scalarMultiplyExtendedEdwardsPoint(
  point: ExtendedEdwardsPoint,
  scalar: bigint,
): ExtendedEdwardsPoint {
  let result: ExtendedEdwardsPoint = [0n, 1n, 1n, 0n];
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addExtendedEdwardsPoints(result, addend);
    addend = addExtendedEdwardsPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

/**
 * Synchronously validates the RFC 8032 compressed Edwards point itself. This
 * does not establish possession of the matching private key; U5 must run an
 * activation challenge before a registry key becomes operational authority.
 */
function isCanonicalPrimeOrderEd25519Point(encoded: string) {
  const bytes = decodeBase64Url(encoded);
  if (!bytes) return false;
  const encodedY = Uint8Array.from(bytes);
  const sign = (encodedY[31] ?? 0) >> 7;
  encodedY[31] = (encodedY[31] ?? 0) & 0x7f;
  const y = littleEndianInteger(encodedY);
  if (y >= ED25519_FIELD_PRIME) return false;

  const ySquared = mod(y * y);
  const denominator = mod(ED25519_D * ySquared + 1n);
  if (denominator === 0n) return false;
  const xSquared = mod((ySquared - 1n) * modPow(denominator, ED25519_FIELD_PRIME - 2n));
  let x = modPow(xSquared, (ED25519_FIELD_PRIME + 3n) / 8n);
  if (mod(x * x) !== xSquared) x = mod(x * ED25519_SQRT_M1);
  if (mod(x * x) !== xSquared) return false;
  if (x === 0n && sign === 1) return false;
  if (Number(x & 1n) !== sign) x = ED25519_FIELD_PRIME - x;

  const point: ExtendedEdwardsPoint = [x, y, 1n, mod(x * y)];
  if (x === 0n && y === 1n) return false;
  const [subgroupX, subgroupY, subgroupZ] = scalarMultiplyExtendedEdwardsPoint(
    point,
    ED25519_SUBGROUP_ORDER,
  );
  return subgroupX === 0n && mod(subgroupY - subgroupZ) === 0n;
}

const publicJwkMaterialSchema = z.strictObject({
  format: z.literal("JWK"),
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  // An Ed25519 public key is exactly 32 bytes. Its canonical unpadded
  // base64url representation is 43 characters and the final sextet has
  // its two unused low bits cleared.
  x: z
    .string()
    .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
    .refine(isCanonicalPrimeOrderEd25519Point, {
      message: "JWK x 必须是 canonical、非 identity 的 Ed25519 主素数阶子群 public point。",
    }),
});

export const publicVerificationMaterialSchema = publicJwkMaterialSchema;

export const signerKeyRegistryEntrySchema = z
  .strictObject({
    key_id: versionIdentifierSchema,
    revision: z.number().int().positive().safe().optional(),
    role: signerRegistryRoleSchema,
    algorithm: z.literal("Ed25519"),
    purpose: signerKeyPurposeSchema,
    status: signerKeyStatusSchema,
    public_material: publicVerificationMaterialSchema,
  })
  .superRefine((entry, ctx) => {
    const expectedPurpose =
      entry.role === "WORKSPACE_ADMIN"
        ? "SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE"
        : "PLATFORM_ATTESTATION";
    if (entry.purpose !== expectedPurpose) {
      ctx.addIssue({
        code: "custom",
        message: "Signer role 与 key purpose 不匹配。",
        path: ["purpose"],
      });
    }
  });

export const signerKeyRegistrySchema = z
  .strictObject({
    schema_version: z.literal("signer-key-registry@1.0.0"),
    workspace_id: immutableIdSchema,
    keys: z.array(signerKeyRegistryEntrySchema).min(2).max(1_000),
  })
  .superRefine((registry, ctx) => {
    const keyIds = new Set(registry.keys.map((entry) => entry.key_id));
    if (keyIds.size !== registry.keys.length) {
      ctx.addIssue({ code: "custom", message: "Signer key_id 必须唯一。", path: ["keys"] });
    }
    const publicMaterials = new Set(
      registry.keys.map((entry) => JSON.stringify(entry.public_material)),
    );
    if (publicMaterials.size !== registry.keys.length) {
      ctx.addIssue({
        code: "custom",
        message: "独立 Signer role 不能复用同一 public verification material。",
        path: ["keys"],
      });
    }
    for (const role of signerRegistryRoleSchema.options) {
      if (!registry.keys.some((entry) => entry.role === role && entry.status === "ACTIVE")) {
        ctx.addIssue({
          code: "custom",
          message: `Signer Registry 缺少 ACTIVE ${role} verification key。`,
          path: ["keys"],
        });
      }
    }
  });

export type SignerRegistryRole = z.infer<typeof signerRegistryRoleSchema>;
export type SignerKeyRegistryEntry = z.infer<typeof signerKeyRegistryEntrySchema>;
export type SignerKeyRegistry = z.infer<typeof signerKeyRegistrySchema>;
