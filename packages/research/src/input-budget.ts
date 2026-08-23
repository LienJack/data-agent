import {
  artifactReferenceIdentity,
  l2ArtifactDocumentSchema,
  parseL2ResearchDocumentCandidate,
  U6_WIRE_LIMITS,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";

const MAX_TRAVERSAL_DEPTH = U6_WIRE_LIMITS.max_dependency_depth * 2;
const MAX_CONTAINER_ENTRIES = U6_WIRE_LIMITS.max_artifact_input_refs;
const MAX_TRAVERSAL_OCCURRENCES =
  U6_WIRE_LIMITS.max_recursive_closure_nodes * U6_WIRE_LIMITS.max_dependency_depth;
const MAX_TOTAL_VALUE_OCCURRENCES =
  U6_WIRE_LIMITS.max_recursive_closure_nodes * U6_WIRE_LIMITS.max_artifact_input_refs;

export interface ResearchInputArrayLimit {
  readonly path: readonly string[];
  readonly max_items: number;
}

export interface ResearchInputBudgetOptions {
  /**
   * Boundary-specific array caps are checked before the recursive closure walk.
   * Paths only follow own data properties, so an accessor is never invoked.
   */
  readonly array_limits?: readonly ResearchInputArrayLimit[];
}

export interface ResearchInputBudget {
  readonly recursive_closure_nodes: number;
  readonly conservative_utf8_bytes: number;
  readonly maximum_depth: number;
}

type TraversalFrame =
  | {
      readonly kind: "ENTER";
      readonly value: unknown;
      readonly depth: number;
      readonly document_budget?: DocumentContainerBudget;
      readonly document_depth?: number;
    }
  | {
      readonly kind: "EXIT";
      readonly value: object;
      readonly document_budget?: DocumentContainerBudget;
      readonly closes_document?: boolean;
    };

interface DocumentContainerBudget {
  readonly root: object;
  readonly rootDepth: number;
  readonly uniqueContainers: Set<object>;
  readonly ordinaryObjects: Set<object>;
  bytes: number;
  maxInternalDepth: number;
}

function limitFailure(message: string): ResearchKernelResult<never> {
  return researchKernelFailure("RESEARCH_RESOURCE_LIMIT_EXCEEDED", message);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inertArrayLength(value: object): number | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !descriptor ||
    !Object.hasOwn(descriptor, "value") ||
    descriptor.enumerable ||
    typeof descriptor.value !== "number" ||
    !Number.isSafeInteger(descriptor.value) ||
    descriptor.value < 0
  ) {
    return null;
  }
  return descriptor.value;
}

function jsonStringUtf8Bytes(value: string, remaining: number): number | null {
  // UTF-8 is never shorter than the UTF-16 code-unit count for ASCII-heavy
  // payloads. This cheap guard avoids scanning a single already-oversized string.
  if (value.length + 2 > remaining) return null;

  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f) {
      // JSON may use a two-byte short escape for five control characters, but
      // six bytes is a deliberately conservative bound for every control byte.
      bytes += 6;
    } else if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        // Well-formed JSON escapes a lone surrogate as "\\udxxx".
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
    if (bytes > remaining) return null;
  }
  return bytes;
}

function primitiveJsonBytes(value: unknown, remaining: number): number | null {
  if (value === null) return remaining >= 4 ? 4 : null;
  switch (typeof value) {
    case "string":
      return jsonStringUtf8Bytes(value, remaining);
    case "boolean":
      return remaining >= 5 ? 5 : null;
    case "number": {
      const rendered = Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : "null";
      return rendered.length <= remaining ? rendered.length : null;
    }
    default:
      return null;
  }
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function isPotentialDocument(value: object, ownKeys: readonly PropertyKey[]): boolean {
  if (
    Array.isArray(value) ||
    ownKeys.length !== 2 ||
    !ownKeys.includes("envelope") ||
    !ownKeys.includes("payload")
  ) {
    return false;
  }
  const envelope = Object.getOwnPropertyDescriptor(value, "envelope");
  const payload = Object.getOwnPropertyDescriptor(value, "payload");
  if (
    !envelope ||
    !payload ||
    !Object.hasOwn(envelope, "value") ||
    !Object.hasOwn(payload, "value") ||
    !envelope.enumerable ||
    !payload.enumerable
  ) {
    return false;
  }
  return (
    typeof envelope.value === "object" &&
    envelope.value !== null &&
    !Array.isArray(envelope.value) &&
    typeof payload.value === "object" &&
    payload.value !== null &&
    !Array.isArray(payload.value)
  );
}

function strictDocumentIdentity(value: object): string | null {
  const payloadDescriptor = Object.getOwnPropertyDescriptor(value, "payload");
  const payload =
    payloadDescriptor && Object.hasOwn(payloadDescriptor, "value")
      ? payloadDescriptor.value
      : undefined;
  const protocolDescriptor =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? Object.getOwnPropertyDescriptor(payload, "protocol_version")
      : undefined;
  const researchFirst =
    protocolDescriptor !== undefined &&
    Object.hasOwn(protocolDescriptor, "value") &&
    typeof protocolDescriptor.value === "string";

  const parseResearchIdentity = (): string | null => {
    try {
      return artifactReferenceIdentity(parseL2ResearchDocumentCandidate(value).envelope);
    } catch {
      return null;
    }
  };
  const parseL2Identity = (): string | null => {
    const document = l2ArtifactDocumentSchema.safeParse(value);
    return document.success ? artifactReferenceIdentity(document.data.envelope) : null;
  };

  if (researchFirst) {
    return parseResearchIdentity() ?? parseL2Identity();
  }
  return parseL2Identity() ?? parseResearchIdentity();
}

function inspectArrayLimit(
  root: unknown,
  limit: ResearchInputArrayLimit,
): ResearchKernelResult<null> {
  let current = root;
  for (const segment of limit.path) {
    if (typeof current !== "object" || current === null) {
      return researchKernelSuccess(null);
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (!descriptor) return researchKernelSuccess(null);
    if (!Object.hasOwn(descriptor, "value")) {
      return limitFailure(`输入路径 ${limit.path.join(".")} 含 accessor，资源预算预检拒绝执行。`);
    }
    current = descriptor.value;
  }
  if (Array.isArray(current)) {
    const length = inertArrayLength(current);
    if (length === null) {
      return limitFailure(`输入路径 ${limit.path.join(".")} 必须是 inert Array。`);
    }
    if (length > limit.max_items) {
      return limitFailure(
        `输入数组 ${limit.path.join(".")} 长度 ${length} 超过上限 ${limit.max_items}。`,
      );
    }
  }
  return researchKernelSuccess(null);
}

/**
 * Synchronous, non-recursive preflight for every nested Research boundary.
 *
 * It intentionally reads property descriptors rather than property values.
 * Accessors, symbol keys and non-plain objects are rejected before Zod,
 * canonicalization, hashing or derivation replay can inspect the input.
 *
 * JavaScript cannot portably identify a Proxy. A transport boundary must still
 * deserialize untrusted wire bytes into inert JSON before calling this kernel;
 * any Proxy trap remains outside the guarantees of this in-process preflight.
 */
export function preflightResearchInput(
  input: unknown,
  options: ResearchInputBudgetOptions = {},
): ResearchKernelResult<ResearchInputBudget> {
  try {
    for (const limit of options.array_limits ?? []) {
      const checked = inspectArrayLimit(input, limit);
      if (!checked.ok) return checked;
    }

    let recursiveClosureNodes = 0;
    let conservativeUtf8Bytes = 0;
    let maximumDepth = 0;
    let traversalOccurrences = 0;
    let totalValueOccurrences = 0;
    let strictDocumentCount = 0;
    let invalidDocumentCandidateCount = 0;
    const activeAncestors = new WeakSet<object>();
    const countedOrdinaryObjects = new WeakSet<object>();
    const countedArtifactIdentities = new Set<string>();
    const strictDocumentIdentityCache = new WeakMap<object, string | null>();
    const stack: TraversalFrame[] = [{ kind: "ENTER", value: input, depth: 0 }];

    const addLogicalNodes = (count: number): boolean => {
      recursiveClosureNodes += count;
      return recursiveClosureNodes <= U6_WIRE_LIMITS.max_recursive_closure_nodes;
    };
    const addBytes = (bytes: number, documentBudget?: DocumentContainerBudget): boolean => {
      conservativeUtf8Bytes += bytes;
      if (documentBudget) documentBudget.bytes += bytes;
      return (
        conservativeUtf8Bytes <= U6_WIRE_LIMITS.max_resolved_closure_bytes &&
        (documentBudget?.bytes ?? 0) <= U6_WIRE_LIMITS.max_artifact_bytes
      );
    };
    const byteLimitMessage = (documentBudget?: DocumentContainerBudget): string => {
      return documentBudget && documentBudget.bytes > U6_WIRE_LIMITS.max_artifact_bytes
        ? `单个 Document 保守 UTF-8 字节数超过 ${U6_WIRE_LIMITS.max_artifact_bytes}。`
        : `输入闭包保守 UTF-8 字节数超过 ${U6_WIRE_LIMITS.max_resolved_closure_bytes}。`;
    };
    const logicalNodeLimitMessage = (): string =>
      `输入 artifact/derivation 闭包节点数 ${recursiveClosureNodes} 超过 ${
        U6_WIRE_LIMITS.max_recursive_closure_nodes
      }（strict Documents=${strictDocumentCount}, invalid document candidates=${invalidDocumentCandidateCount}）。`;

    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      if (frame.kind === "EXIT") {
        activeAncestors.delete(frame.value);
        if (frame.closes_document && frame.document_budget) {
          const cachedIdentity = strictDocumentIdentityCache.get(frame.document_budget.root);
          const identity =
            cachedIdentity !== undefined
              ? cachedIdentity
              : strictDocumentIdentity(frame.document_budget.root);
          if (cachedIdentity === undefined) {
            strictDocumentIdentityCache.set(frame.document_budget.root, identity);
          }
          if (identity === null) {
            invalidDocumentCandidateCount += 1;
            if (
              frame.document_budget.rootDepth + frame.document_budget.maxInternalDepth >
              U6_WIRE_LIMITS.max_dependency_depth
            ) {
              return limitFailure(
                `伪 Document 展开后的普通闭包深度超过 ${U6_WIRE_LIMITS.max_dependency_depth}。`,
              );
            }
            for (const ordinaryObject of frame.document_budget.ordinaryObjects) {
              if (!countedOrdinaryObjects.has(ordinaryObject)) {
                countedOrdinaryObjects.add(ordinaryObject);
                if (!addLogicalNodes(1)) {
                  return limitFailure(logicalNodeLimitMessage());
                }
              }
            }
          } else if (!countedArtifactIdentities.has(identity)) {
            strictDocumentCount += 1;
            countedArtifactIdentities.add(identity);
            if (!addLogicalNodes(1)) {
              return limitFailure(logicalNodeLimitMessage());
            }
          }
        }
        continue;
      }

      maximumDepth = Math.max(maximumDepth, frame.depth);
      totalValueOccurrences += 1;
      if (totalValueOccurrences > MAX_TOTAL_VALUE_OCCURRENCES) {
        return limitFailure(`输入闭包总 value 展开次数超过 ${MAX_TOTAL_VALUE_OCCURRENCES}。`);
      }
      if (frame.depth > MAX_TRAVERSAL_DEPTH) {
        return limitFailure(`输入闭包深度 ${frame.depth} 超过上限 ${MAX_TRAVERSAL_DEPTH}。`);
      }
      if (
        frame.document_budget === undefined &&
        frame.depth > U6_WIRE_LIMITS.max_dependency_depth
      ) {
        return limitFailure(
          `输入 artifact/derivation 闭包深度 ${frame.depth} 超过上限 ${U6_WIRE_LIMITS.max_dependency_depth}。`,
        );
      }
      if (frame.document_budget !== undefined) {
        if (
          frame.document_depth === undefined ||
          frame.document_depth > U6_WIRE_LIMITS.max_dependency_depth
        ) {
          return limitFailure(
            `单个 Document 内嵌套深度超过 ${U6_WIRE_LIMITS.max_dependency_depth}。`,
          );
        }
        frame.document_budget.maxInternalDepth = Math.max(
          frame.document_budget.maxInternalDepth,
          frame.document_depth,
        );
      }

      if (typeof frame.value !== "object" || frame.value === null) {
        const bytes = primitiveJsonBytes(
          frame.value,
          U6_WIRE_LIMITS.max_resolved_closure_bytes - conservativeUtf8Bytes,
        );
        if (bytes === null) {
          return limitFailure("输入包含非 JSON primitive，或保守 UTF-8 字节预算已超限。");
        }
        if (!addBytes(bytes, frame.document_budget)) {
          return limitFailure(byteLimitMessage(frame.document_budget));
        }
        continue;
      }

      if (activeAncestors.has(frame.value)) {
        return limitFailure("输入闭包包含循环引用。");
      }
      traversalOccurrences += 1;
      if (traversalOccurrences > MAX_TRAVERSAL_OCCURRENCES) {
        return limitFailure(`输入闭包 container 展开次数超过 ${MAX_TRAVERSAL_OCCURRENCES}。`);
      }

      const isArray = Array.isArray(frame.value);
      const arrayLength = isArray ? inertArrayLength(frame.value) : null;
      if ((isArray && arrayLength === null) || (!isArray && !isPlainObject(frame.value))) {
        return limitFailure("输入闭包只允许 Array、plain object 与 JSON primitive。");
      }
      if (arrayLength !== null && arrayLength > MAX_CONTAINER_ENTRIES) {
        return limitFailure(`输入数组长度超过 ${MAX_CONTAINER_ENTRIES}。`);
      }
      activeAncestors.add(frame.value);

      const ownKeys = Reflect.ownKeys(frame.value);
      if (ownKeys.some((key) => typeof key === "symbol")) {
        return limitFailure("输入闭包不允许 Symbol key。");
      }

      const startsDocument =
        frame.document_budget === undefined && isPotentialDocument(frame.value, ownKeys);
      const documentBudget =
        frame.document_budget ??
        (startsDocument
          ? {
              root: frame.value,
              rootDepth: frame.depth,
              uniqueContainers: new Set<object>(),
              ordinaryObjects: new Set<object>(),
              bytes: 0,
              maxInternalDepth: 0,
            }
          : undefined);
      const documentDepth =
        frame.document_budget !== undefined ? frame.document_depth : startsDocument ? 0 : undefined;

      if (documentBudget === undefined) {
        // Arrays are bounded adjacency/collection edges, not artifact or
        // derivation nodes. They still consume depth, bytes, entry and total
        // traversal-occurrence budgets.
        if (!isArray && !countedOrdinaryObjects.has(frame.value)) {
          countedOrdinaryObjects.add(frame.value);
          if (!addLogicalNodes(1)) {
            return limitFailure(logicalNodeLimitMessage());
          }
        }
      } else {
        if (!documentBudget.uniqueContainers.has(frame.value)) {
          documentBudget.uniqueContainers.add(frame.value);
          if (documentBudget.uniqueContainers.size > U6_WIRE_LIMITS.max_recursive_closure_nodes) {
            return limitFailure(
              `单个 Document 内 unique JSON container 数超过 ${U6_WIRE_LIMITS.max_recursive_closure_nodes}。`,
            );
          }
        }
        if (!isArray) {
          documentBudget.ordinaryObjects.add(frame.value);
        }
      }
      stack.push({
        kind: "EXIT",
        value: frame.value,
        ...(documentBudget === undefined ? {} : { document_budget: documentBudget }),
        ...(startsDocument ? { closes_document: true } : {}),
      });

      if (isArray) {
        if (ownKeys.length - 1 > MAX_CONTAINER_ENTRIES) {
          return limitFailure(`输入数组长度或自有元素数超过 ${MAX_CONTAINER_ENTRIES}。`);
        }
        if (!addBytes(2 + Math.max(0, (arrayLength ?? 0) - 1), documentBudget)) {
          return limitFailure(byteLimitMessage(documentBudget));
        }
        const presentIndices = new Set<number>();
        for (const key of ownKeys) {
          if (key === "length") continue;
          if (typeof key !== "string" || !isCanonicalArrayIndex(key, arrayLength ?? 0)) {
            return limitFailure("输入数组不允许 Symbol、非索引或越界自有属性。");
          }
          const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
            return limitFailure("输入数组元素必须是 enumerable data property。");
          }
          const index = Number(key);
          presentIndices.add(index);
          stack.push({
            kind: "ENTER",
            value: descriptor.value,
            depth: frame.depth + 1,
            ...(documentBudget === undefined
              ? {}
              : {
                  document_budget: documentBudget,
                  document_depth: (documentDepth ?? 0) + 1,
                }),
          });
        }
        const sparseSlots = (arrayLength ?? 0) - presentIndices.size;
        if (sparseSlots > 0 && !addBytes(sparseSlots * 4, documentBudget)) {
          return limitFailure(byteLimitMessage(documentBudget));
        }
        continue;
      }

      if (ownKeys.length > MAX_CONTAINER_ENTRIES) {
        return limitFailure(`输入对象自有字段数超过 ${MAX_CONTAINER_ENTRIES}。`);
      }
      if (!addBytes(2, documentBudget)) {
        return limitFailure(byteLimitMessage(documentBudget));
      }
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          return limitFailure("输入闭包不允许 Symbol key。");
        }
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
          return limitFailure("输入对象字段必须是 enumerable data property，禁止 accessor。");
        }
        const keyBytes = jsonStringUtf8Bytes(
          key,
          U6_WIRE_LIMITS.max_resolved_closure_bytes - conservativeUtf8Bytes,
        );
        if (keyBytes === null || !addBytes(keyBytes + 2, documentBudget)) {
          return limitFailure(byteLimitMessage(documentBudget));
        }
        stack.push({
          kind: "ENTER",
          value: descriptor.value,
          depth: frame.depth + 1,
          ...(documentBudget === undefined
            ? {}
            : {
                document_budget: documentBudget,
                document_depth: (documentDepth ?? 0) + 1,
              }),
        });
      }
    }

    return researchKernelSuccess({
      recursive_closure_nodes: recursiveClosureNodes,
      conservative_utf8_bytes: conservativeUtf8Bytes,
      maximum_depth: maximumDepth,
    });
  } catch {
    return limitFailure(
      "输入对象在 descriptor/prototype 预算检查中拒绝检查；Transport 必须先提供 inert JSON。",
    );
  }
}
