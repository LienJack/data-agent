import { describe, expect, it } from "vitest";
import { createAclFirstGrounder } from "../../src/grounding/acl-first-grounder.js";
import {
  analystPolicy,
  commerceCatalog,
  fixturePrincipalId,
  netRevenueContract,
} from "../support/commerce-fixture.js";

describe("ACL-first Grounding 安全顺序", () => {
  it("Policy 缺失时不读取 Catalog，也不调用 Retriever", async () => {
    const calls: string[] = [];
    const grounder = createAclFirstGrounder({
      policy: {
        async authorize() {
          calls.push("policy");
          return { ok: true, value: null };
        },
      },
      catalog: {
        async project() {
          calls.push("catalog");
          return { ok: true, value: commerceCatalog };
        },
      },
      retrieval: {
        async retrieve() {
          calls.push("retrieval");
          return { ok: true, value: [] };
        },
      },
    });

    await expect(
      grounder.ground({
        query_contract: netRevenueContract(),
        principal_id: fixturePrincipalId,
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_POLICY_MISSING",
    });
    expect(calls).toEqual(["policy"]);
  });

  it("Retriever 只接收 ACL 与 Catalog 的交集，越权对象从未进入检索输入", async () => {
    const observedAllowedIds: string[][] = [];
    const grounder = createAclFirstGrounder({
      policy: {
        async authorize() {
          return { ok: true, value: analystPolicy };
        },
      },
      catalog: {
        async project() {
          return { ok: true, value: commerceCatalog };
        },
      },
      retrieval: {
        async retrieve(input) {
          observedAllowedIds.push([...input.allowed_object_ids]);
          return {
            ok: true,
            value: input.allowed_object_ids.map((objectId, index) => ({
              object_id: objectId,
              score: 1 - index / 10,
            })),
          };
        },
      },
    });

    const result = await grounder.ground({
      query_contract: netRevenueContract(),
      principal_id: fixturePrincipalId,
      max_context_objects: 32,
    });

    expect(result.state).toBe("READY");
    expect(observedAllowedIds).toHaveLength(1);
    expect(observedAllowedIds[0]).toEqual(
      expect.arrayContaining(["metric.net_revenue", "dimension.customer_segment"]),
    );
    expect(observedAllowedIds[0]).not.toContain("metric.executive_revenue");
  });

  it("Policy Receipt 的 Principal 漂移时在读取 Catalog 前失败关闭", async () => {
    const calls: string[] = [];
    const grounder = createAclFirstGrounder({
      policy: {
        async authorize(input) {
          calls.push(
            `${input.app_id}:${input.tenant_id}:${input.environment}:${input.run_id}:${input.principal_id}`,
          );
          return {
            ok: true,
            value: { ...analystPolicy, principal_id: "other@example.test" },
          };
        },
      },
      catalog: {
        async project() {
          calls.push("catalog");
          return { ok: true, value: commerceCatalog };
        },
      },
      retrieval: {
        async retrieve() {
          calls.push("retrieval");
          return { ok: true, value: [] };
        },
      },
    });

    await expect(
      grounder.ground({
        query_contract: netRevenueContract(),
        principal_id: fixturePrincipalId,
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_POLICY_SCOPE_MISMATCH",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(fixturePrincipalId);
  });

  it("Policy Snapshot 的 Tenant 漂移时在读取 Catalog 前失败关闭", async () => {
    const calls: string[] = [];
    const grounder = createAclFirstGrounder({
      policy: {
        async authorize() {
          calls.push("policy");
          return {
            ok: true,
            value: {
              ...analystPolicy,
              scope: {
                ...analystPolicy.scope,
                tenant_id: "00000000-0000-4000-8000-000000000999",
              },
            },
          };
        },
      },
      catalog: {
        async project() {
          calls.push("catalog");
          return { ok: true, value: commerceCatalog };
        },
      },
      retrieval: {
        async retrieve() {
          calls.push("retrieval");
          return { ok: true, value: [] };
        },
      },
    });

    await expect(
      grounder.ground({
        query_contract: netRevenueContract(),
        principal_id: fixturePrincipalId,
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_POLICY_SCOPE_MISMATCH",
    });
    expect(calls).toEqual(["policy"]);
  });

  it("Catalog Snapshot 的 Run 漂移时在检索前失败关闭", async () => {
    const calls: string[] = [];
    const grounder = createAclFirstGrounder({
      policy: {
        async authorize() {
          calls.push("policy");
          return { ok: true, value: analystPolicy };
        },
      },
      catalog: {
        async project() {
          calls.push("catalog");
          return {
            ok: true,
            value: {
              ...commerceCatalog,
              run_id: "00000000-0000-4000-8000-000000000999",
            },
          };
        },
      },
      retrieval: {
        async retrieve() {
          calls.push("retrieval");
          return { ok: true, value: [] };
        },
      },
    });

    await expect(
      grounder.ground({
        query_contract: netRevenueContract(),
        principal_id: fixturePrincipalId,
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_CATALOG_SCOPE_MISMATCH",
    });
    expect(calls).toEqual(["policy", "catalog"]);
  });
});
