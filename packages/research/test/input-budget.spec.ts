import { U6_WIRE_LIMITS } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { preflightResearchInput } from "../src/input-budget.js";
import { compileHypothesisSetCandidate, compileResearchBriefCandidate } from "../src/planning.js";
import { sealResearchDocument } from "./document-fixtures.js";
import { hypotheses, reference, researchBriefInput } from "./fixtures.js";

function expectResourceLimit(result: ReturnType<typeof preflightResearchInput>): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "RESEARCH_RESOURCE_LIMIT_EXCEEDED",
      retryable: false,
    },
  });
}

describe("Research input resource preflight", () => {
  it("在 schema map 前拒绝超上限的重复有效 Hypothesis 数组", async () => {
    const valid = hypotheses()[0];
    if (!valid) throw new TypeError("Hypothesis fixture 为空。");
    const result = await compileHypothesisSetCandidate({
      brief_ref: reference("ResearchBrief", "21"),
      hypotheses: Array.from({ length: U6_WIRE_LIMITS.max_hypotheses + 1 }, () => valid),
      mechanism_validator_version: "mechanism-validator@1.0.0",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_RESOURCE_LIMIT_EXCEEDED" },
    });
  });

  it("以迭代遍历拒绝循环引用，且返回结构化 failure 而不是抛异常", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    let result: ReturnType<typeof preflightResearchInput> | undefined;

    expect(() => {
      result = preflightResearchInput(cyclic);
    }).not.toThrow();
    if (!result) throw new TypeError("preflight 未返回结果。");
    expectResourceLimit(result);
  });

  it("公共 builder 只读取 descriptor，拒绝 accessor 且不触发 getter", async () => {
    let getterTouched = false;
    const input = {
      brief_ref: reference("ResearchBrief", "21"),
      get hypotheses(): never {
        getterTouched = true;
        throw new Error("getter 不应执行");
      },
      mechanism_validator_version: "mechanism-validator@1.0.0",
    };

    await expect(compileHypothesisSetCandidate(input)).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_RESOURCE_LIMIT_EXCEEDED" },
    });
    expect(getterTouched).toBe(false);
  });

  it("普通 derivation 深度 32 通过、33 失败，不借 Document 物理深度放宽", () => {
    const nestedObject = (edges: number): Record<string, unknown> => {
      const root: Record<string, unknown> = {};
      let cursor = root;
      for (let depth = 0; depth < edges; depth += 1) {
        const next: Record<string, unknown> = {};
        cursor.next = next;
        cursor = next;
      }
      return root;
    };

    expect(preflightResearchInput(nestedObject(U6_WIRE_LIMITS.max_dependency_depth))).toMatchObject(
      {
        ok: true,
      },
    );
    expectResourceLimit(
      preflightResearchInput(nestedObject(U6_WIRE_LIMITS.max_dependency_depth + 1)),
    );
  });

  it("仍以物理深度故障保险拒绝异常的 Document 内嵌套", () => {
    const root: Record<string, unknown> = {
      envelope: {},
      payload: {},
    };
    let cursor = root.payload as Record<string, unknown>;
    for (let depth = 0; depth <= U6_WIRE_LIMITS.max_dependency_depth; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    expectResourceLimit(preflightResearchInput(root));
  });

  it("拒绝超过闭包节点预算的宽树", () => {
    const input = {
      groups: Array.from({ length: 256 }, () => ({
        a: {},
        b: {},
        c: {},
        d: {},
      })),
    };
    expectResourceLimit(preflightResearchInput(input));
  });

  it("只把 strict Document 作为聚合闭包逻辑节点，同时逐个检查内部预算", async () => {
    const brief = await compileResearchBriefCandidate(researchBriefInput());
    if (!brief.ok) throw new TypeError(brief.error.message);
    const documents = await Promise.all(
      Array.from({ length: 32 }, (_, index) => sealResearchDocument(brief.value, 80_000 + index)),
    );
    const aggregate = {
      resolutions: documents.map((document) => ({
        document,
        derivation_input: { replay: true },
      })),
    };

    expect(preflightResearchInput(aggregate)).toMatchObject({
      ok: true,
      value: {
        recursive_closure_nodes: expect.any(Number),
      },
    });
  });

  it("多个分别低于单文档上限的伪 Document 不能绕过全局 1024 节点预算", () => {
    const fakeDocuments = Array.from({ length: 32 }, (_, index) => ({
      envelope: {
        artifact_type: "SyntheticDocument",
        input_refs: [],
        sequence: index,
      },
      payload: {
        rows: Array.from({ length: 32 }, (__, row) => ({
          id: `${index}:${row}`,
          value: { observed: true },
        })),
      },
    }));

    expectResourceLimit(preflightResearchInput({ documents: fakeDocuments }));
  });

  it("伪 Document 不能在 strict 分类完成前重置普通闭包深度", () => {
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 31; depth += 1) {
      nested = { next: nested };
    }
    const fakeDocument = {
      envelope: {},
      payload: nested,
    };

    expectResourceLimit(preflightResearchInput({ document: fakeDocument }));
  });

  it("不能用伪 Document 包装绕过单文档 JSON container 上限", () => {
    const oversizedDocument = {
      envelope: { artifact_type: "SyntheticDocument", input_refs: [] },
      payload: {
        groups: Array.from({ length: 256 }, () => ({
          a: {},
          b: {},
          c: {},
          d: {},
        })),
      },
    };

    expectResourceLimit(preflightResearchInput({ document: oversizedDocument }));
  });

  it("共享 DAG 即使只有少量 identity，也不能绕过 container 展开预算", () => {
    let shared: unknown = {};
    for (let depth = 0; depth < 3; depth += 1) {
      shared = {
        branches: Array.from({ length: 256 }, () => shared),
      };
    }
    expectResourceLimit(preflightResearchInput(shared));
  });

  it("单 Document 内按 unique container 计 1024 节点，但共享 DAG 仍受展开预算约束", () => {
    const leaf = {};
    const shared = {
      branches: Array.from({ length: 256 }, () => leaf),
    };
    const document = {
      envelope: {},
      payload: {
        rows: Array.from({ length: 256 }, () => shared),
      },
    };

    expectResourceLimit(preflightResearchInput(document));
  });

  it("primitive 的每次展开也受 total-value occurrence 后备上限约束", () => {
    const primitiveLeaf = Array.from({ length: 256 }, () => 0);
    const primitiveGroup = Array.from({ length: 256 }, () => primitiveLeaf);
    const primitiveAdjacencyTree = Array.from({ length: 127 }, () => primitiveGroup);

    expectResourceLimit(preflightResearchInput(primitiveAdjacencyTree));
  });

  it("total-value occurrence 在 262144 通过、262145 失败", () => {
    const buildBoundaryGraph = (firstExtraLeafLength: 255 | 256) => {
      const regularLeaf = Array.from({ length: 254 }, () => 0);
      const regularGroup = Array.from({ length: 256 }, () => regularLeaf);
      const extra = [
        Array.from({ length: firstExtraLeafLength }, () => 0),
        Array.from({ length: 253 }, () => 0),
        Array.from({ length: 253 }, () => 0),
        Array.from({ length: 253 }, () => 0),
      ];
      return [regularGroup, regularGroup, regularGroup, regularGroup, extra];
    };

    expect(preflightResearchInput(buildBoundaryGraph(255))).toMatchObject({
      ok: true,
      value: { recursive_closure_nodes: 0 },
    });
    expectResourceLimit(preflightResearchInput(buildBoundaryGraph(256)));
  });

  it("重复 invalid Document candidate 复用 null 分类缓存，但仍累计展开预算", () => {
    const invalidCandidate = {
      envelope: { artifact_type: "SyntheticDocument" },
      payload: { observed: true },
    };
    const result = preflightResearchInput({
      candidates: [invalidCandidate, invalidCandidate],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        recursive_closure_nodes: 4,
      },
    });
  });

  it("strict Research Document 可以包含共享内部 identity，且仍按内容闭包验证", async () => {
    const input = researchBriefInput();
    const sharedContainerRef = input.scope.metric_refs[0]?.container_ref;
    if (!sharedContainerRef) throw new TypeError("ResearchBrief fixture 缺少 Metric container。");
    const brief = await compileResearchBriefCandidate({
      ...input,
      scope: {
        ...input.scope,
        metric_refs: [
          { container_ref: sharedContainerRef, node_id: "net-revenue" },
          { container_ref: sharedContainerRef, node_id: "gross-revenue" },
        ],
      },
    });
    if (!brief.ok) throw new TypeError(brief.error.message);
    const firstMetric = brief.value.scope.metric_refs[0];
    const secondMetric = brief.value.scope.metric_refs[1];
    if (!firstMetric || !secondMetric) throw new TypeError("ResearchBrief metric fixture 不完整。");
    const sharedPayload = {
      ...brief.value,
      scope: {
        ...brief.value.scope,
        metric_refs: [
          firstMetric,
          {
            ...secondMetric,
            container_ref: firstMetric.container_ref,
          },
        ],
      },
    };
    const document = await sealResearchDocument(sharedPayload, 90_000);

    expect(preflightResearchInput({ document })).toMatchObject({
      ok: true,
      value: { recursive_closure_nodes: 2 },
    });
  });

  it("在 schema/canonicalize/hash 前拒绝超过 16 MiB 的输入", async () => {
    const brief = researchBriefInput();
    const result = await compileResearchBriefCandidate({
      ...brief,
      scope: {
        ...brief.scope,
        subject: "a".repeat(U6_WIRE_LIMITS.max_resolved_closure_bytes + 1),
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_RESOURCE_LIMIT_EXCEEDED" },
    });
  });

  it("拒绝 non-plain object 与 Symbol key", () => {
    expectResourceLimit(preflightResearchInput(new Date(0)));

    const symbolBearing = { value: 1 } as Record<PropertyKey, unknown>;
    symbolBearing[Symbol("hidden")] = "hidden";
    expectResourceLimit(preflightResearchInput(symbolBearing));

    let inheritedGetterTouched = false;
    const customArray = new Array(1);
    const customArrayPrototype = Object.create(Array.prototype);
    Object.defineProperty(customArrayPrototype, "0", {
      enumerable: true,
      get: () => {
        inheritedGetterTouched = true;
        throw new Error("继承 getter 不应执行");
      },
    });
    Object.setPrototypeOf(customArray, customArrayPrototype);
    expectResourceLimit(preflightResearchInput(customArray));
    expect(inheritedGetterTouched).toBe(false);
  });

  it("超长 Array 在 ownKeys 物化前失败关闭", () => {
    let ownKeysTouched = false;
    const oversized = new Proxy(new Array(U6_WIRE_LIMITS.max_artifact_input_refs + 1), {
      ownKeys(target) {
        ownKeysTouched = true;
        return Reflect.ownKeys(target);
      },
    });

    expectResourceLimit(preflightResearchInput(oversized));
    expect(ownKeysTouched).toBe(false);
  });

  it("Proxy trap 异常被收敛为资源 failure，Transport 仍须先反序列化为 inert JSON", () => {
    const proxied = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("untrusted proxy trap");
        },
      },
    );
    expect(() => preflightResearchInput(proxied)).not.toThrow();
    expectResourceLimit(preflightResearchInput(proxied));
  });
});
