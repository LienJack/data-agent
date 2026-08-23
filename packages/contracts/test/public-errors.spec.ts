import { describe, expect, it } from "vitest";
import {
  authorizeReleaseDecision,
  authorizeRunTerminal,
  CurrentAuthorityProtocolError,
  RELEASE_DECISION_REASON_PAIRS,
  type ReleaseAuthorityContext,
  RUN_TERMINAL_REASON_PAIRS,
  releaseDecisionSchema,
  runTerminalSchema,
} from "../src/runs/index.js";
import {
  environments,
  ids,
  makeArtifactReference,
  makeGoReleaseDecision,
  makeRequiredGoEvidenceReferences,
} from "./fixtures.js";
import { createAuthoritativeReleaseFixture } from "./release-authority-fixtures.js";

const deterministicAuthority = {
  kind: "deterministic",
  id: "release-gate",
  policy_version: "1.0.0",
} as const;

describe("公开 Run Terminal", () => {
  it.each(RUN_TERMINAL_REASON_PAIRS)("%s 使用稳定 Reason Code %s", (terminal, reason) => {
    const value = runTerminalSchema.parse({
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      terminal,
      reason_code: reason,
      observed_at: "2026-07-25T00:00:00.000Z",
      authority: deterministicAuthority,
      ...(terminal === "READY"
        ? { artifact_refs: [makeArtifactReference("ReportReadyCertificate")] }
        : {}),
    });

    expect(runTerminalSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("拒绝未知 Terminal 和错配 Reason Code", () => {
    expect(
      runTerminalSchema.safeParse({
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
        run_id: ids.run,
        terminal: "SUCCESS",
        reason_code: "RUN_READY",
        observed_at: "2026-07-25T00:00:00.000Z",
        authority: deterministicAuthority,
      }).success,
    ).toBe(false);
    expect(
      runTerminalSchema.safeParse({
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
        run_id: ids.run,
        terminal: "READY",
        reason_code: "RUN_CANCELLED",
        observed_at: "2026-07-25T00:00:00.000Z",
        authority: deterministicAuthority,
        artifact_refs: [makeArtifactReference("ReportReadyCertificate")],
      }).success,
    ).toBe(false);
  });

  it("READY 必须绑定内容寻址的 ReportReadyCertificate", () => {
    expect(
      runTerminalSchema.safeParse({
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
        run_id: ids.run,
        terminal: "READY",
        reason_code: "RUN_READY",
        observed_at: "2026-07-25T00:00:00.000Z",
        authority: deterministicAuthority,
      }).success,
    ).toBe(false);
  });

  it("旧 READY API 固定拒绝并要求 Current Readiness 消费事务", async () => {
    let authorityCalls = 0;
    const ready = {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      terminal: "READY",
      reason_code: "RUN_READY",
      observed_at: "2026-07-25T00:00:00.000Z",
      authority: deterministicAuthority,
      artifact_refs: [makeArtifactReference("ReportReadyCertificate")],
    };

    expect(runTerminalSchema.safeParse(ready).success).toBe(true);
    await expect(
      authorizeRunTerminal(ready, {
        principalId: "principal-fixture",
        verifyCommitted: async () => {
          authorityCalls += 1;
          return true;
        },
        resolveL2: async () => {
          authorityCalls += 1;
          return null;
        },
        verifyCommitterCapability: async () => {
          authorityCalls += 1;
          return true;
        },
      }),
    ).rejects.toMatchObject({
      code: "CURRENT_READY_CONSUMPTION_REQUIRED",
      retryable: false,
    });
    expect(authorityCalls).toBe(0);
  });

  it.each([
    ["STALE", "RUN_STALE", "CURRENT_READY_CONSUMPTION_REQUIRED"],
    ["PARTIAL", "EVIDENCE_PARTIAL", "RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED"],
    [
      "NEEDS_MORE_RESEARCH",
      "EVIDENCE_COVERAGE_INSUFFICIENT",
      "RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED",
    ],
    ["INCONCLUSIVE", "ANALYSIS_INCONCLUSIVE", "RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED"],
  ] as const)("旧 %s API 固定拒绝专用 Authority 终态", async (terminal, reasonCode, code) => {
    await expect(
      authorizeRunTerminal(
        {
          app_id: ids.appA,
          tenant_id: ids.tenantA,
          environment: environments.test,
          run_id: ids.run,
          terminal,
          reason_code: reasonCode,
          observed_at: "2026-07-25T00:00:00.000Z",
          authority: deterministicAuthority,
        },
        {
          principalId: "principal-fixture",
          verifyCommitted: async () => true,
          resolveL2: async () => null,
          verifyCommitterCapability: async () => true,
        },
      ),
    ).rejects.toMatchObject({ code, retryable: false });
  });

  it("READY 不能借用其他 Scope 的 Certificate", () => {
    expect(
      runTerminalSchema.safeParse({
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
        run_id: ids.run,
        terminal: "READY",
        reason_code: "RUN_READY",
        observed_at: "2026-07-25T00:00:00.000Z",
        authority: deterministicAuthority,
        artifact_refs: [
          {
            ...makeArtifactReference("ReportReadyCertificate"),
            app_id: ids.appB,
            tenant_id: ids.tenantB,
            environment: environments.test,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("发布决策", () => {
  it.each(RELEASE_DECISION_REASON_PAIRS)("%s 使用稳定 Reason Code %s", (decision, reason) => {
    const value = releaseDecisionSchema.parse({
      decision_id: ids.decision,
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      decision,
      reason_code: reason,
      evidence_refs: decision === "GO" ? makeRequiredGoEvidenceReferences() : [],
      ...(decision === "GO"
        ? { release_manifest_ref: makeArtifactReference("ReleaseManifest") }
        : {}),
      authority: deterministicAuthority,
      release_policy_version: "1.0.0",
      decided_at: "2026-07-25T00:00:00.000Z",
    });

    expect(releaseDecisionSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("没有 Evidence 时不能构造 GO", () => {
    expect(
      releaseDecisionSchema.safeParse({
        decision_id: ids.decision,
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
        run_id: ids.run,
        decision: "GO",
        reason_code: "RELEASE_EVIDENCE_COMPLETE",
        evidence_refs: [],
        release_manifest_ref: makeArtifactReference("ReleaseManifest"),
        authority: deterministicAuthority,
        release_policy_version: "1.0.0",
        decided_at: "2026-07-25T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("GO 不能只绑定任意 UUID，必须引用版本化 ReleaseManifest", () => {
    expect(
      releaseDecisionSchema.safeParse({
        decision_id: ids.decision,
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
        run_id: ids.run,
        decision: "GO",
        reason_code: "RELEASE_EVIDENCE_COMPLETE",
        evidence_refs: [ids.artifact],
        authority: deterministicAuthority,
        release_policy_version: "1.0.0",
        decided_at: "2026-07-25T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("GO 不能用普通业务 Artifact 冒充发布级 Evidence", () => {
    const decision = makeGoReleaseDecision();

    expect(
      releaseDecisionSchema.safeParse({
        ...decision,
        evidence_refs: [
          makeArtifactReference("QuestionFrame"),
          ...decision.evidence_refs.filter(
            (reference) => reference.artifact_type !== "ReportReadyCertificate",
          ),
        ],
      }).success,
    ).toBe(false);
  });

  it("旧 GO API 固定拒绝并要求 current-ready Release Commit", async () => {
    const decision = makeGoReleaseDecision();
    let authorityCalls = 0;
    const counted = async () => {
      authorityCalls += 1;
      return null;
    };
    expect(releaseDecisionSchema.safeParse(decision).success).toBe(true);
    await expect(
      authorizeReleaseDecision(decision, {
        principalId: "principal-fixture",
        verifyCommitted: async () => {
          authorityCalls += 1;
          return true;
        },
        resolveL2: counted,
        verifyCommitterCapability: async () => {
          authorityCalls += 1;
          return true;
        },
        resolveScoreCard: counted,
        resolveBenchmarkAdapterReceipt: counted,
        resolveSandboxExecutionReceipt: counted,
        resolveModelCertificationReceipt: counted,
        resolveReleaseManifest: counted,
      }),
    ).rejects.toMatchObject({
      code: "CURRENT_RELEASE_COMMIT_REQUIRED",
      retryable: false,
    });
    expect(authorityCalls).toBe(0);
  });

  it("GO 逐类拒绝仅已提交但未获领域品牌的 Evidence", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const brokenAuthorities: Array<[string, ReleaseAuthorityContext]> = [
      [
        "ScoreCard",
        {
          ...fixture.authority,
          resolveScoreCard: async () => null,
        },
      ],
      [
        "BenchmarkAdapterReceipt",
        {
          ...fixture.authority,
          resolveBenchmarkAdapterReceipt: async () => null,
        },
      ],
      [
        "SandboxExecutionReceipt",
        {
          ...fixture.authority,
          resolveSandboxExecutionReceipt: async () => null,
        },
      ],
      [
        "ModelCertificationReceipt",
        {
          ...fixture.authority,
          resolveModelCertificationReceipt: async () => null,
        },
      ],
      [
        "ReleaseManifest",
        {
          ...fixture.authority,
          resolveReleaseManifest: async () => null,
        },
      ],
    ];

    for (const [artifactType, authority] of brokenAuthorities) {
      await expect(
        authorizeReleaseDecision(fixture.decisionInput, authority),
        artifactType,
      ).rejects.toBeInstanceOf(CurrentAuthorityProtocolError);
    }
  });

  it("GO 拒绝 Release Policy 漂移", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    await expect(
      authorizeReleaseDecision(
        {
          ...fixture.decisionInput,
          release_policy_version: "2.0.0",
        },
        fixture.authority,
      ),
    ).rejects.toMatchObject({ code: "CURRENT_RELEASE_COMMIT_REQUIRED" });
  });

  it.each([
    { label: "FAIL ScoreCard", options: { scoreVerdict: "FAIL" as const } },
    {
      label: "INCONCLUSIVE ScoreCard",
      options: { scoreVerdict: "INCONCLUSIVE" as const },
    },
    { label: "非零 Safety Counter", options: { safetyViolationCount: 1 } },
  ])("GO 拒绝 $label", async ({ options }) => {
    const fixture = await createAuthoritativeReleaseFixture(options);
    await expect(
      authorizeReleaseDecision(fixture.decisionInput, fixture.authority),
    ).rejects.toMatchObject({ code: "CURRENT_RELEASE_COMMIT_REQUIRED" });
  });

  it.each(["HOLD", "NO_GO", "ROLLBACK"] as const)("%s 仍可通过旧授权入口", async (decision) => {
    const reasonCode = {
      HOLD: "RELEASE_EVIDENCE_INCOMPLETE",
      NO_GO: "RELEASE_SAFETY_GATE_FAILED",
      ROLLBACK: "RELEASE_REGRESSION_DETECTED",
    }[decision] as
      | "RELEASE_EVIDENCE_INCOMPLETE"
      | "RELEASE_SAFETY_GATE_FAILED"
      | "RELEASE_REGRESSION_DETECTED";
    const fixture = await createAuthoritativeReleaseFixture();
    await expect(
      authorizeReleaseDecision(
        {
          ...fixture.decisionInput,
          decision,
          reason_code: reasonCode,
          evidence_refs: [],
          release_manifest_ref: undefined,
        },
        fixture.authority,
      ),
    ).resolves.toMatchObject({ decision });
  });
});
