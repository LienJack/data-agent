export type ContentHash = `sha256:${string}`;

/**
 * Canonical JSON authority follows ECMAScript JSON serialization:
 *
 * - numbers use JSON.stringify's finite-number rendering;
 * - object keys use UTF-16 code-unit ordering;
 * - the resulting string is hashed as UTF-8.
 *
 * This is the TypeScript content-hash contract. PostgreSQL-persisted runtime
 * envelopes use the database's own canonicalizer and propagate the hash
 * returned by that authority; callers must not assume byte parity between
 * ECMAScript NumberToString and PostgreSQL numeric rendering.
 */
function canonicalizeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON 不接受 NaN 或 Infinity。");
  }
  return JSON.stringify(value);
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return canonicalizeNumber(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON 只接受普通对象。");
    }

    const fields = Object.entries(value)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, fieldValue]) => `${JSON.stringify(key)}:${canonicalizeJson(fieldValue)}`);
    return `{${fields.join(",")}}`;
  }

  throw new TypeError(`Canonical JSON 不接受 ${typeof value}。`);
}

export async function sha256ContentHash(value: unknown): Promise<ContentHash> {
  const bytes = new TextEncoder().encode(canonicalizeJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}
