import { describe, expect, it } from "vitest";
import {
  type AuthoritativeMetamorphicOracleReceipt,
  artifactReferenceIdentity,
  isAuthoritativeMetamorphicFixtureReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
  isAuthoritativeResultOracleReceipt,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  l2ArtifactDocumentSchema,
  verifyL2ArtifactDocument,
} from "../src/index.js";
import { createAuthoritativeReadyFixture } from "./authority-fixtures.js";

describe("Metamorphic authority recursion", () => {
  it("contracts/server 不暴露可注入闭包的旧 registrar 或 verify*Closure API", async () => {
    const serverExports = Object.keys(await import("../src/server.js"));

    expect(serverExports).not.toContain("registerMetamorphicFixtureAuthority");
    expect(serverExports).not.toContain("registerMetamorphicOracleAuthority");
    expect(serverExports).not.toContain("registerResultOracleReceiptAuthority");
    expect(serverExports.filter((name) => /^verify.*Closure$/u.test(name))).toEqual([]);
  });

  it("fails closed when the recursive L2 chain has no branded Meta resolver", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const evidence = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(fixture.references.evidence),
    );
    const {
      resolveAuthoritativeMetamorphicOracleReceipt: _missingResolver,
      ...withoutMetamorphicAuthority
    } = fixture.authority;

    await expect(verifyL2ArtifactDocument(evidence, withoutMetamorphicAuthority)).rejects.toThrow(
      "MetamorphicOracleReceipt",
    );
  });

  it("resolves each branded revision once per recursive verification and deep-freezes it", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const evidence = l2ArtifactDocumentSchema.parse(
      await fixture.authority.resolveL2(fixture.references.evidence),
    );
    const fixtureCalls = new Map<string, number>();
    const metaCalls = new Map<string, number>();
    const resultCalls = new Map<string, number>();
    const sandboxReceiptCalls = new Map<string, number>();
    const sandboxResultCalls = new Map<string, number>();
    const count = (
      calls: Map<string, number>,
      reference: Parameters<typeof artifactReferenceIdentity>[0],
    ) => {
      const identity = artifactReferenceIdentity(reference);
      calls.set(identity, (calls.get(identity) ?? 0) + 1);
    };
    const countedAuthority = {
      ...fixture.authority,
      resolveAuthoritativeMetamorphicFixtureReceipt: async (
        reference: Parameters<typeof artifactReferenceIdentity>[0],
      ) => {
        count(fixtureCalls, reference);
        return fixture.authority.resolveAuthoritativeMetamorphicFixtureReceipt?.(reference) ?? null;
      },
      resolveAuthoritativeMetamorphicOracleReceipt: async (
        reference: Parameters<typeof artifactReferenceIdentity>[0],
      ) => {
        count(metaCalls, reference);
        return fixture.authority.resolveAuthoritativeMetamorphicOracleReceipt?.(reference) ?? null;
      },
      resolveAuthoritativeResultOracleReceipt: async (
        reference: Parameters<typeof artifactReferenceIdentity>[0],
        metamorphic: AuthoritativeMetamorphicOracleReceipt,
      ) => {
        count(resultCalls, reference);
        return (
          fixture.authority.resolveAuthoritativeResultOracleReceipt?.(reference, metamorphic) ??
          null
        );
      },
      resolveAuthoritativeSandboxExecutionReceipt: async (
        reference: Parameters<typeof artifactReferenceIdentity>[0],
      ) => {
        count(sandboxReceiptCalls, reference);
        return fixture.authority.resolveAuthoritativeSandboxExecutionReceipt?.(reference) ?? null;
      },
      resolveAuthoritativeSandboxResult: async (
        reference: Parameters<typeof artifactReferenceIdentity>[0],
      ) => {
        count(sandboxResultCalls, reference);
        return fixture.authority.resolveAuthoritativeSandboxResult?.(reference) ?? null;
      },
    };

    await expect(verifyL2ArtifactDocument(evidence, countedAuthority)).resolves.toBeDefined();
    for (const calls of [
      fixtureCalls,
      metaCalls,
      resultCalls,
      sandboxReceiptCalls,
      sandboxResultCalls,
    ]) {
      expect([...calls.values()].every((value) => value === 1)).toBe(true);
    }

    const [fixtureReceipt, metaReceipt, sandboxReceipt, sandboxResult] = await Promise.all([
      fixture.authority.resolveAuthoritativeMetamorphicFixtureReceipt?.(
        fixture.references.metamorphicFixture,
      ),
      fixture.authority.resolveAuthoritativeMetamorphicOracleReceipt?.(
        fixture.references.metamorphicOracle,
      ),
      fixture.authority.resolveAuthoritativeSandboxExecutionReceipt?.(
        fixture.references.sandboxReceipt,
      ),
      fixture.authority.resolveAuthoritativeSandboxResult?.(fixture.references.sandboxResult),
    ]);
    const resultReceipt = metaReceipt
      ? await fixture.authority.resolveAuthoritativeResultOracleReceipt?.(
          fixture.references.resultOracle,
          metaReceipt,
        )
      : null;
    expect(isAuthoritativeMetamorphicFixtureReceipt(fixtureReceipt)).toBe(true);
    expect(isAuthoritativeMetamorphicOracleReceipt(metaReceipt)).toBe(true);
    expect(isAuthoritativeResultOracleReceipt(resultReceipt)).toBe(true);
    expect(isAuthoritativeSandboxExecutionReceipt(sandboxReceipt)).toBe(true);
    expect(isAuthoritativeSandboxResult(sandboxResult)).toBe(true);
    expect(Object.isFrozen(fixtureReceipt)).toBe(true);
    expect(Object.isFrozen(fixtureReceipt?.cases[0]?.witness)).toBe(true);
    expect(Object.isFrozen(metaReceipt?.relation_samples)).toBe(true);
    expect(Object.isFrozen(resultReceipt?.invariant_verdicts)).toBe(true);
    expect(isAuthoritativeMetamorphicFixtureReceipt(structuredClone(fixtureReceipt))).toBe(false);
    expect(isAuthoritativeMetamorphicOracleReceipt(structuredClone(metaReceipt))).toBe(false);
    expect(isAuthoritativeResultOracleReceipt(structuredClone(resultReceipt))).toBe(false);
  });

  it("rejects a selection probe executed against a snapshot outside its fixture case", async () => {
    for (const relation of ["fanOut", "nullAnti", "partition", "distinctFact"] as const) {
      await expect(
        createAuthoritativeReadyFixture({
          selectionProbeSnapshotTokens: {
            [relation]: "snapshot-outside-fixture-case",
          },
        }),
        relation,
      ).rejects.toThrow("Selection Probe");
    }
  });

  it("ignores an injected always-true policy and rejects a hash-consistent mutation bound to the wrong case", async () => {
    await expect(
      createAuthoritativeReadyFixture({
        authorityPolicyInjection: "FIXTURE_ALWAYS_TRUE",
        mutationRecordBinding: "FAN_OUT_WRONG_CASE",
      }),
    ).rejects.toThrow("FixtureMutationRecord");
  });

  it("accepts one branded whole/left/right SQL variant closure at L2", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const metamorphic = await fixture.authority.resolveAuthoritativeMetamorphicOracleReceipt?.(
      fixture.references.metamorphicOracle,
    );
    if (!metamorphic || !isAuthoritativeMetamorphicOracleReceipt(metamorphic)) {
      throw new Error("测试 Fixture 缺少权威 MetamorphicOracleReceipt。");
    }
    const halfOpen = metamorphic.relation_samples[2];
    if (halfOpen.relation_kind !== "HALF_OPEN_ADDITIVE_PARTITION") {
      throw new Error("测试 Fixture 缺少 half-open relation。");
    }
    const [baseline, left, right] = await Promise.all([
      fixture.authority.resolveAuthoritativeSandboxExecutionReceipt?.(
        metamorphic.baseline.sandbox_execution_receipt_ref,
      ),
      fixture.authority.resolveAuthoritativeSandboxExecutionReceipt?.(
        halfOpen.left_partition.sandbox_execution_receipt_ref,
      ),
      fixture.authority.resolveAuthoritativeSandboxExecutionReceipt?.(
        halfOpen.right_partition.sandbox_execution_receipt_ref,
      ),
    ]);

    expect(
      new Set(
        [baseline, left, right].map((receipt) =>
          receipt ? artifactReferenceIdentity(receipt.sql_artifact_ref) : null,
        ),
      ).size,
    ).toBe(3);
    expect(
      [baseline, left, right].map((receipt) =>
        receipt ? artifactReferenceIdentity(receipt.sql_artifact_ref) : null,
      ),
    ).toEqual(fixture.references.halfOpenSqlArtifacts.map(artifactReferenceIdentity));
  });

  it("rejects a branded Meta object issued under another Result Authority chain", async () => {
    const [leftFixture, rightFixture] = await Promise.all([
      createAuthoritativeReadyFixture(),
      createAuthoritativeReadyFixture(),
    ]);
    const foreignMetamorphic =
      await rightFixture.authority.resolveAuthoritativeMetamorphicOracleReceipt?.(
        rightFixture.references.metamorphicOracle,
      );
    if (!foreignMetamorphic) {
      throw new Error("测试 Fixture 缺少 foreign MetamorphicOracleReceipt。");
    }

    await expect(
      leftFixture.authority.resolveAuthoritativeResultOracleReceipt?.(
        leftFixture.references.resultOracle,
        foreignMetamorphic,
      ),
    ).rejects.toThrow("同一 Metamorphic");
  });

  it("rejects a Result resolver that re-authorizes Meta instead of consuming the supplied object", async () => {
    await expect(
      createAuthoritativeReadyFixture({
        resultResolverMode: "REAUTHORIZE_META",
      }),
    ).rejects.toThrow("同一次 Meta 解析");
  });

  it("rejects reused or swapped half-open SQL bindings in the server Meta closure", async () => {
    for (const halfOpenQueryVariantBindings of ["REUSE_BASELINE", "SWAP"] as const) {
      await expect(
        createAuthoritativeReadyFixture({ halfOpenQueryVariantBindings }),
        halfOpenQueryVariantBindings,
      ).rejects.toThrow("computed verdict");
    }
  });

  it("rejects Meta evaluation that predates Fixture issuance", async () => {
    await expect(
      createAuthoritativeReadyFixture({
        fixtureIssuedAt: "2026-07-25T00:00:00.006Z",
        metamorphicEvaluatedAt: "2026-07-25T00:00:00.005Z",
      }),
    ).rejects.toThrow("不能早于 Fixture");
  });
});
