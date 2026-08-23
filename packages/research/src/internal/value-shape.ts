export function exactObjectKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}
