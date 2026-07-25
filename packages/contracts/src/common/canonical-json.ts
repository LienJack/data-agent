export type ContentHash = `sha256:${string}`;

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
