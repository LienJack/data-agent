import { describe, expect, it } from "vitest";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  assertResearchHashJson,
  canonicalizeJson,
  computeResearchKernelHashV2,
  orderedDistinctReferencesV2,
  U6_WIRE_LIMITS,
} from "../src/index.js";

const GOLDEN_DOMAIN = "u6-research-kernel-golden@1";

function makeReference(artifactId: string, revision = 1): ArtifactReference {
  return {
    app_id: "00000000-0000-4000-8000-000000000001",
    tenant_id: "00000000-0000-4000-8000-000000000002",
    environment: "test",
    run_id: "00000000-0000-4000-8000-000000000003",
    artifact_id: artifactId,
    artifact_type: "ResearchBrief",
    revision,
    content_hash: `sha256:${"a".repeat(64)}`,
  };
}

describe("Research Hash v2", () => {
  it.each([
    {
      value: null,
      digest: "sha256:51dacd1978a6947cdcbde96adec1ea904902e13413dd68d51ec8002d73655848",
    },
    {
      value: Object.freeze({
        z: 0,
        a: Object.freeze(["汉字", true, null, 9_007_199_254_740_991]),
      }),
      digest: "sha256:0bdc423617d839a21b608aa2035f5d7bc5398e99a4ad3e9a3bb1f15d5ac5256b",
    },
    {
      value: Object.freeze({
        refs: Object.freeze(["a", "b"]),
        nested: Object.freeze({
          quote: '"',
          slash: "\\",
          control: "\n",
        }),
      }),
      digest: "sha256:a6a35ba5cc1bc49654d895abeb22b83eb246d7bf2f584480782bda4db32ce65b",
    },
    {
      value: Object.freeze({
        "\uE000": "pua",
        "😀": "face",
      }),
      digest: "sha256:8d5d2a6a2f5bccb7968d5413b934a36cd4c5eac366d71e9390f661528452f888",
    },
  ])("重放冻结 golden vector %#", async ({ value, digest }) => {
    await expect(computeResearchKernelHashV2(GOLDEN_DOMAIN, value)).resolves.toBe(digest);
  });

  it("把 -0 规范为 0，并接受合法 surrogate pair、null prototype 与共享 DAG", async () => {
    await expect(computeResearchKernelHashV2(GOLDEN_DOMAIN, -0)).resolves.toBe(
      await computeResearchKernelHashV2(GOLDEN_DOMAIN, 0),
    );

    const nullPrototypeValue: Record<string, unknown> = Object.create(null);
    nullPrototypeValue.emoji = "😀";
    nullPrototypeValue.count = 1;

    const shared = Object.freeze({ value: "共享节点" });
    const dag = Object.freeze({
      left: shared,
      right: shared,
      null_prototype: nullPrototypeValue,
    });

    expect(() => assertResearchHashJson(dag)).not.toThrow();
    await expect(computeResearchKernelHashV2("合法😀domain", dag)).resolves.toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it.each([
    ["float", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["negative unsafe integer", Number.MIN_SAFE_INTEGER - 1],
    ["BigInt", 1n],
    ["undefined", undefined],
    ["function", () => 1],
    ["symbol", Symbol("research-hash")],
  ])("拒绝不属于严格值域的 %s", (_label, value) => {
    expect(() => assertResearchHashJson(value)).toThrow(TypeError);
  });

  it.each([
    ["U+0000 value", { value: "a\u0000b" }],
    ["isolated high surrogate value", { value: "\uD83D" }],
    ["isolated low surrogate value", { value: "\uDE00" }],
    ["U+0000 key", { ["bad\u0000key"]: true }],
    ["isolated high surrogate key", { ["bad\uD83D"]: true }],
    ["isolated low surrogate key", { ["bad\uDE00"]: true }],
  ])("拒绝非法 Unicode scalar sequence：%s", (_label, value) => {
    expect(() => assertResearchHashJson(value)).toThrow(TypeError);
  });

  it.each(["bad\u0000domain", "bad\uD83Ddomain", "bad\uDE00domain"])(
    "拒绝非法 hash domain：%s",
    async (domain) => {
      await expect(computeResearchKernelHashV2(domain, null)).rejects.toThrow(TypeError);
    },
  );

  it("拒绝 sparse array、额外 own property 与自定义 array prototype", () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = "present";

    const withExtraProperty = [1, 2];
    Object.defineProperty(withExtraProperty, "extra", {
      value: true,
      enumerable: true,
      configurable: true,
    });

    class CustomArray extends Array<number> {}

    expect(() => assertResearchHashJson(sparse)).toThrow(TypeError);
    expect(() => assertResearchHashJson(withExtraProperty)).toThrow(TypeError);
    expect(() => assertResearchHashJson(new CustomArray(1, 2))).toThrow(TypeError);
  });

  it("拒绝 object 自定义 prototype、non-enumerable 与 symbol property", () => {
    const customPrototype: Record<string, unknown> = Object.create({ inherited: true });
    customPrototype.value = 1;

    const withNonEnumerable = { visible: true };
    Object.defineProperty(withNonEnumerable, "hidden", {
      value: 1,
      enumerable: false,
      configurable: true,
    });

    const withSymbol = { visible: true };
    Object.defineProperty(withSymbol, Symbol("hidden"), {
      value: 1,
      enumerable: true,
      configurable: true,
    });

    expect(() => assertResearchHashJson(customPrototype)).toThrow(TypeError);
    expect(() => assertResearchHashJson(withNonEnumerable)).toThrow(TypeError);
    expect(() => assertResearchHashJson(withSymbol)).toThrow(TypeError);
  });

  it("拒绝 accessor 且绝不执行 getter", async () => {
    let objectGetterCalls = 0;
    const objectWithAccessor = {};
    Object.defineProperty(objectWithAccessor, "dangerous", {
      enumerable: true,
      configurable: true,
      get() {
        objectGetterCalls += 1;
        return "forged";
      },
    });

    let arrayGetterCalls = 0;
    const arrayWithAccessor = [1];
    Object.defineProperty(arrayWithAccessor, "0", {
      enumerable: true,
      configurable: true,
      get() {
        arrayGetterCalls += 1;
        return 1;
      },
    });

    await expect(computeResearchKernelHashV2(GOLDEN_DOMAIN, objectWithAccessor)).rejects.toThrow(
      TypeError,
    );
    expect(() => assertResearchHashJson(arrayWithAccessor)).toThrow(TypeError);
    expect(objectGetterCalls).toBe(0);
    expect(arrayGetterCalls).toBe(0);
  });

  it("拒绝 object 与 array cycle，但不误拒绝共享 DAG", () => {
    const objectCycle: Record<string, unknown> = {};
    objectCycle.self = objectCycle;

    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);

    expect(() => assertResearchHashJson(objectCycle)).toThrow(TypeError);
    expect(() => assertResearchHashJson(arrayCycle)).toThrow(TypeError);
  });

  it("继承 U6 Wire 的深度、展开次数与容器宽度上限", () => {
    let tooDeep: unknown = null;
    for (let depth = 0; depth <= U6_WIRE_LIMITS.max_dependency_depth; depth += 1) {
      tooDeep = [tooDeep];
    }

    let expandedDag: unknown = Object.freeze({ leaf: true });
    for (let depth = 0; depth < 18; depth += 1) {
      expandedDag = Object.freeze({
        left: expandedDag,
        right: expandedDag,
      });
    }

    const tooWide = Array.from({ length: U6_WIRE_LIMITS.max_artifact_input_refs + 1 }, () => null);
    const repeatedChunk = "x".repeat(Math.ceil(U6_WIRE_LIMITS.max_resolved_closure_bytes / 32));
    const expandedBytes = Array.from({ length: 33 }, () => repeatedChunk);

    expect(() => assertResearchHashJson(tooDeep)).toThrow(TypeError);
    expect(() => assertResearchHashJson(expandedDag)).toThrow(TypeError);
    expect(() => assertResearchHashJson(tooWide)).toThrow(TypeError);
    expect(() => assertResearchHashJson(expandedBytes)).toThrow(TypeError);
  });

  it("把反射 trap 的异常封装为 TypeError", () => {
    const reflectionFailure = new Proxy(
      {},
      {
        ownKeys() {
          throw new RangeError("reflection failed");
        },
      },
    );

    expect(() => assertResearchHashJson(reflectionFailure)).toThrow(TypeError);
  });

  it("Hash 只消费校验时捕获的 data descriptor，不再次读取 Proxy value", async () => {
    let objectValueReads = 0;
    const objectValue = new Proxy(
      { slipped: 1 },
      {
        getOwnPropertyDescriptor(target, key) {
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) {
          if (key === "slipped") {
            objectValueReads += 1;
            return 1.5;
          }
          return Reflect.get(target, key, receiver);
        },
      },
    );

    let arrayValueReads = 0;
    const arrayValue = new Proxy([1], {
      getOwnPropertyDescriptor(target, key) {
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key, receiver) {
        if (key === "0") {
          arrayValueReads += 1;
          return 1.5;
        }
        return Reflect.get(target, key, receiver);
      },
    });

    await expect(computeResearchKernelHashV2("proxy-object-snapshot@2", objectValue)).resolves.toBe(
      await computeResearchKernelHashV2("proxy-object-snapshot@2", { slipped: 1 }),
    );
    await expect(computeResearchKernelHashV2("proxy-array-snapshot@2", arrayValue)).resolves.toBe(
      await computeResearchKernelHashV2("proxy-array-snapshot@2", [1]),
    );
    expect(objectValueReads).toBe(0);
    expect(arrayValueReads).toBe(0);
  });
});

describe("Artifact Reference v2 排序", () => {
  it("按完整 identity 升序返回新数组，不修改输入", () => {
    const higher = makeReference("00000000-0000-4000-8000-000000000020");
    const lower = makeReference("00000000-0000-4000-8000-000000000010");
    const input = Object.freeze([higher, lower]);

    const result = orderedDistinctReferencesV2(input);

    expect(result).not.toBe(input);
    expect(input).toEqual([higher, lower]);
    expect(result.map(artifactReferenceIdentity)).toEqual(
      [higher, lower].map(artifactReferenceIdentity).sort(),
    );
  });

  it("先按完整 identity 检测 duplicate 并失败关闭", () => {
    const original = makeReference("00000000-0000-4000-8000-000000000010");
    const duplicate = { ...original };

    expect(() => orderedDistinctReferencesV2([original, duplicate])).toThrow(TypeError);
  });

  it("不会把仅 artifact_id 相同但 revision 不同的 Reference 当成 duplicate", () => {
    const revisionOne = makeReference("00000000-0000-4000-8000-000000000010", 1);
    const revisionTwo = makeReference("00000000-0000-4000-8000-000000000010", 2);

    expect(orderedDistinctReferencesV2([revisionTwo, revisionOne])).toHaveLength(2);
  });

  it("identity 与冻结的 canonical tuple 完全一致", () => {
    const reference = makeReference("00000000-0000-4000-8000-000000000010");

    expect(artifactReferenceIdentity(reference)).toBe(
      canonicalizeJson([
        reference.app_id,
        reference.tenant_id,
        reference.environment,
        reference.run_id,
        reference.artifact_id,
        reference.artifact_type,
        reference.revision,
        reference.content_hash,
      ]),
    );
  });
});
