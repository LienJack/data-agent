export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }
  seen.add(objectValue);

  for (const key of Reflect.ownKeys(objectValue)) {
    deepFreeze(Reflect.get(objectValue, key), seen);
  }

  return Object.freeze(value);
}
