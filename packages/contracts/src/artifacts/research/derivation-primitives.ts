import { type ContentHash, sha256ContentHash } from "../../common/index.js";
import { type ArtifactReference, artifactReferenceIdentity } from "../envelope.js";
import { U6_WIRE_LIMITS } from "./primitives.js";

export type ResearchHashJson =
  | null
  | boolean
  | string
  | number
  | readonly ResearchHashJson[]
  | { readonly [key: string]: ResearchHashJson };

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;
/**
 * Research Hash v2 inherits U6 Wire resource limits. Shared DAG nodes count
 * once per expanded occurrence because canonical JSON repeats each reference.
 */
const MAX_RESEARCH_HASH_CONTAINER_OCCURRENCES =
  U6_WIRE_LIMITS.max_recursive_closure_nodes * U6_WIRE_LIMITS.max_dependency_depth;
const MAX_RESEARCH_HASH_VALUE_OCCURRENCES =
  U6_WIRE_LIMITS.max_recursive_closure_nodes * U6_WIRE_LIMITS.max_artifact_input_refs;

interface ResearchHashBudget {
  containerOccurrences: number;
  valueOccurrences: number;
  serializedBytes: number;
}

function createResearchHashBudget(): ResearchHashBudget {
  return {
    containerOccurrences: 0,
    valueOccurrences: 0,
    serializedBytes: 0,
  };
}

function consumeSerializedBytes(budget: ResearchHashBudget, bytes: number): void {
  budget.serializedBytes += bytes;
  if (budget.serializedBytes > U6_WIRE_LIMITS.max_resolved_closure_bytes) {
    throw new TypeError("Research Hash 展开后的 canonical JSON 超过 Wire 字节上限。");
  }
}

function consumeValueOccurrence(budget: ResearchHashBudget, depth: number): void {
  if (depth > U6_WIRE_LIMITS.max_dependency_depth) {
    throw new TypeError("Research Hash 嵌套深度超过 Wire 上限。");
  }
  budget.valueOccurrences += 1;
  if (budget.valueOccurrences > MAX_RESEARCH_HASH_VALUE_OCCURRENCES) {
    throw new TypeError("Research Hash 展开后的 value 次数超过 Wire 上限。");
  }
}

function consumeContainerOccurrence(budget: ResearchHashBudget): void {
  budget.containerOccurrences += 1;
  if (budget.containerOccurrences > MAX_RESEARCH_HASH_CONTAINER_OCCURRENCES) {
    throw new TypeError("Research Hash 展开后的 container 次数超过 Wire 上限。");
  }
}

function reflection<Result>(operation: string, reflect: () => Result): Result {
  try {
    return reflect();
  } catch (cause) {
    throw new TypeError(`Research Hash 无法安全反射 ${operation}。`, { cause });
  }
}

function serializedStringUtf8Bytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      throw new TypeError("Research Hash string 不接受 U+0000。");
    }

    if (codeUnit <= 0x1f) {
      bytes +=
        codeUnit === 0x08 ||
        codeUnit === 0x09 ||
        codeUnit === 0x0a ||
        codeUnit === 0x0c ||
        codeUnit === 0x0d
          ? 2
          : 6;
      continue;
    }

    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      bytes += 2;
      continue;
    }

    if (codeUnit <= 0x7f) {
      bytes += 1;
      continue;
    }

    if (codeUnit <= 0x7ff) {
      bytes += 2;
      continue;
    }

    if (codeUnit >= HIGH_SURROGATE_START && codeUnit <= HIGH_SURROGATE_END) {
      if (index + 1 >= value.length) {
        throw new TypeError("Research Hash string 不接受孤立 UTF-16 high surrogate。");
      }
      const lowSurrogate = value.charCodeAt(index + 1);
      if (lowSurrogate < LOW_SURROGATE_START || lowSurrogate > LOW_SURROGATE_END) {
        throw new TypeError("Research Hash string 不接受孤立 UTF-16 high surrogate。");
      }
      bytes += 4;
      index += 1;
      continue;
    }

    if (codeUnit >= LOW_SURROGATE_START && codeUnit <= LOW_SURROGATE_END) {
      throw new TypeError("Research Hash string 不接受孤立 UTF-16 low surrogate。");
    }

    bytes += 3;
  }
  return bytes;
}

function dataPropertyValue(target: object, key: PropertyKey): unknown {
  const descriptor = reflection(`own property descriptor ${String(key)}`, () =>
    Object.getOwnPropertyDescriptor(target, key),
  );
  if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new TypeError("Research Hash 字段必须是 enumerable data property。");
  }
  const value: unknown = descriptor.value;
  return value;
}

function projectArray(
  value: readonly unknown[],
  active: WeakSet<object>,
  budget: ResearchHashBudget,
  depth: number,
): readonly ResearchHashJson[] {
  consumeContainerOccurrence(budget);
  const prototype = reflection("array prototype", () => Object.getPrototypeOf(value));
  if (prototype !== Array.prototype) {
    throw new TypeError("Research Hash array prototype 必须是 Array.prototype。");
  }

  const keys = reflection("array own keys", () => Reflect.ownKeys(value));
  const lengthDescriptor = reflection("array length descriptor", () =>
    Object.getOwnPropertyDescriptor(value, "length"),
  );
  const lengthValue: unknown = lengthDescriptor?.value;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable !== false ||
    typeof lengthValue !== "number" ||
    !Number.isSafeInteger(lengthValue) ||
    lengthValue < 0
  ) {
    throw new TypeError("Research Hash array length 必须是标准 data property。");
  }
  if (lengthValue > U6_WIRE_LIMITS.max_artifact_input_refs) {
    throw new TypeError("Research Hash array 长度超过 Wire 容器上限。");
  }
  consumeSerializedBytes(budget, 2 + Math.max(0, lengthValue - 1));

  const projected: ResearchHashJson[] = [];
  let elementCount = 0;
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      throw new TypeError("Research Hash array 不接受额外 own property。");
    }

    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= lengthValue) {
      throw new TypeError("Research Hash array own property 必须是有效 element index。");
    }

    projected[index] = projectValue(dataPropertyValue(value, key), active, budget, depth + 1);
    elementCount += 1;
  }

  if (elementCount !== lengthValue) {
    throw new TypeError("Research Hash 不接受 sparse array。");
  }
  return projected;
}

function projectObject(
  value: object,
  active: WeakSet<object>,
  budget: ResearchHashBudget,
  depth: number,
): { readonly [key: string]: ResearchHashJson } {
  consumeContainerOccurrence(budget);
  const prototype = reflection("object prototype", () => Object.getPrototypeOf(value));
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Research Hash 只接受 Object.prototype 或 null prototype 对象。");
  }

  const projected: Record<string, ResearchHashJson> = {};
  const keys = reflection("object own keys", () => Reflect.ownKeys(value));
  if (keys.length > U6_WIRE_LIMITS.max_artifact_input_refs) {
    throw new TypeError("Research Hash object 字段数超过 Wire 容器上限。");
  }
  consumeSerializedBytes(budget, 2 + Math.max(0, keys.length - 1));
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError("Research Hash object 不接受 symbol key。");
    }
    consumeSerializedBytes(budget, serializedStringUtf8Bytes(key) + 1);
    Object.defineProperty(projected, key, {
      value: projectValue(dataPropertyValue(value, key), active, budget, depth + 1),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return projected;
}

function projectValue(
  value: unknown,
  active: WeakSet<object>,
  budget: ResearchHashBudget,
  depth: number,
): ResearchHashJson {
  consumeValueOccurrence(budget, depth);
  if (value === null) {
    consumeSerializedBytes(budget, 4);
    return value;
  }

  if (typeof value === "boolean") {
    consumeSerializedBytes(budget, value ? 4 : 5);
    return value;
  }

  if (typeof value === "string") {
    consumeSerializedBytes(budget, serializedStringUtf8Bytes(value));
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Research Hash number 必须是 SafeInteger。");
    }
    consumeSerializedBytes(budget, Object.is(value, -0) ? 1 : String(value).length);
    return value;
  }

  if (typeof value !== "object") {
    throw new TypeError(`Research Hash 不接受 ${typeof value}。`);
  }

  if (active.has(value)) {
    throw new TypeError("Research Hash 不接受循环引用。");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return projectArray(value, active, budget, depth);
    }
    return projectObject(value, active, budget, depth);
  } finally {
    active.delete(value);
  }
}

export function projectResearchHashJson(value: unknown): ResearchHashJson {
  return projectValue(value, new WeakSet<object>(), createResearchHashBudget(), 0);
}

export function assertResearchHashJson(value: unknown): asserts value is ResearchHashJson {
  projectResearchHashJson(value);
}

export async function computeResearchKernelHashV2(
  hashDomain: string,
  value: unknown,
): Promise<ContentHash> {
  const projected = projectValue(
    {
      hash_domain: hashDomain,
      value,
    },
    new WeakSet<object>(),
    createResearchHashBudget(),
    -1,
  );
  return sha256ContentHash(projected);
}

export function orderedDistinctReferencesV2<Reference extends ArtifactReference>(
  references: readonly Reference[],
): Reference[] {
  const identified = references.map((reference) => ({
    identity: artifactReferenceIdentity(reference),
    reference,
  }));

  const identities = new Set<string>();
  for (const { identity } of identified) {
    if (identities.has(identity)) {
      throw new TypeError("Artifact Reference v2 set 不接受 duplicate identity。");
    }
    identities.add(identity);
  }

  return identified
    .sort(({ identity: left }, { identity: right }) => (left < right ? -1 : left > right ? 1 : 0))
    .map(({ reference }) => reference);
}
