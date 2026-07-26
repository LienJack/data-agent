import { describe, expect, it } from "vitest";
import {
  AuthorityEvidenceError,
  authorizeReleaseDecision,
  authorizeRunTerminal,
  RELEASE_DECISION_REASON_PAIRS,
  type ReleaseAuthorityContext,
  RUN_TERMINAL_REASON_PAIRS,
  releaseDecisionSchema,
  runTerminalSchema,
} from "../src/runs/index.js";
import { createAuthoritativeReadyFixture } from "./authority-fixtures.js";
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

  it("READY Schema 不是权威提交，授权入口会拒绝未提交 Certificate", async () => {
    const fixture = await createAuthoritativeReadyFixture();
    const ready = {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: environments.test,
      run_id: ids.run,
      terminal: "READY",
      reason_code: "RUN_READY",
      observed_at: "2026-07-25T00:00:00.000Z",
      authority: deterministicAuthority,
      artifact_refs: [fixture.certificateReference],
    };

    expect(runTerminalSchema.safeParse(ready).success).toBe(true);
    await expect(
      authorizeRunTerminal(ready, {
        ...fixture.authority,
        verifyCommitted: async () => false,
      }),
    ).rejects.toBeInstanceOf(AuthorityEvidenceError);
    await expect(
      authorizeRunTerminal(ready, {
        principalId: "principal-fixture",
        verifyCommitted: async () => true,
        resolveL2: async () => null,
        verifyCommitterCapability: async () => true,
      }),
    ).rejects.toThrow("不存在、未授权或不匹配");
    await expect(authorizeRunTerminal(ready, fixture.authority)).resolves.toMatchObject({
      terminal: "READY",
    });
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

  it("GO Schema 不是发布权威，授权入口会验证全部 Committed Evidence", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const { authority: releaseAuthority, decisionInput: decision } = fixture;

    expect(releaseDecisionSchema.safeParse(decision).success).toBe(true);
    await expect(
      authorizeReleaseDecision(decision, {
        ...releaseAuthority,
        verifyCommitted: async () => false,
      }),
    ).rejects.toBeInstanceOf(AuthorityEvidenceError);
    await expect(
      authorizeReleaseDecision(decision, {
        ...releaseAuthority,
        resolveScoreCard: async () => null,
      }),
    ).rejects.toThrow("权威 ScoreCard");
    await expect(authorizeReleaseDecision(decision, releaseAuthority)).resolves.toMatchObject({
      decision: "GO",
    });
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
      ).rejects.toBeInstanceOf(AuthorityEvidenceError);
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
    ).rejects.toThrow("同一 Release Policy Version");
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
    ).rejects.toThrow("确定性 PASS、Safety Counter 全为零");
  });
});
