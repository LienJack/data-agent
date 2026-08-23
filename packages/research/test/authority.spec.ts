import type { ControlledFixtureContract } from "@data-agent/contracts";
import {
  createResearchKernelCandidateAuthority,
  getControlledFixtureHandle,
  getKernelVerifiedCandidateMetadata,
  isControlledFixtureHandle,
  isKernelVerifiedReportReadyCandidate,
  isResearchKernelCandidateAuthority,
  materializeControlledProtocolInput,
  runControlledProtocolKernel,
  sealKernelVerifiedReportReadyCandidate,
} from "@data-agent/research/server";
import { describe, expect, it } from "vitest";
import {
  createResearchKernelCandidateAuthority as createRawResearchKernelCandidateAuthority,
  sealKernelVerifiedReportReadyCandidate as sealRawKernelVerifiedReportReadyCandidate,
} from "../src/server/candidate-authority.js";
import { runControlledProtocolKernel as runRawControlledProtocolKernel } from "../src/server/controlled-composition.js";
import {
  getControlledFixtureHandle as getRawControlledFixtureHandle,
  projectControlledProtocolInputFromFixture,
  readControlledFixtureContract,
} from "../src/server/controlled-fixture.js";
import { controlledMutationCases } from "./controlled.js";

async function publicControlledHandle() {
  return getControlledFixtureHandle(
    "retail-revenue-investigation-v1",
    "u6-controlled-fixture@1.0.0",
  );
}

async function publicBaseEvaluation() {
  const handle = await publicControlledHandle();
  return runControlledProtocolKernel(materializeControlledProtocolInput(handle));
}

const forbiddenOracleKey = (key: string) =>
  key === "expected" ||
  key.startsWith("expected_") ||
  [
    "mutation_id",
    "public_terminal",
    "certificate_issued",
    "grant_issued",
    "partial_preconditions",
    "proof",
    "finalization",
    "candidate_path",
  ].includes(key) ||
  key.includes("certificate") ||
  key.includes("grant");

function rejectOracleReads<T extends object>(root: T): T {
  const proxies = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    const known = proxies.get(value);
    if (known) return known;
    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        if (typeof property === "string" && forbiddenOracleKey(property)) {
          throw new Error(`ORACLE_READ:${property}`);
        }
        return wrap(Reflect.get(target, property, receiver));
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };
  return wrap(root) as T;
}

describe("Server-only candidate authority 与 fixture registry", () => {
  it("Fixture Handle 由 WeakSet/WeakMap 身份保护，clone/spread/plain object 全部失效", async () => {
    const handle = await publicControlledHandle();
    expect(isControlledFixtureHandle(handle)).toBe(true);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(isControlledFixtureHandle({ ...handle })).toBe(false);
    expect(isControlledFixtureHandle(structuredClone(handle))).toBe(false);
    expect(isControlledFixtureHandle(JSON.parse(JSON.stringify(handle)))).toBe(false);
    expect(
      isControlledFixtureHandle({
        fixture_id: handle.fixture_id,
        protocol_version: handle.protocol_version,
        fixture_hash: handle.fixture_hash,
      }),
    ).toBe(false);
  });

  it("受控投影即使置于递归 Proxy 下也不读取任何 oracle 字段", async () => {
    const handle = await getRawControlledFixtureHandle(
      "retail-revenue-investigation-v1",
      "u6-controlled-fixture@1.0.0",
    );
    const fixture = readControlledFixtureContract(handle);
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.mutation_registry)).toBe(true);
    // Proxy 必须包裹可配置属性；冻结后的 production object 另由上方断言保护。
    const protectedFixture = rejectOracleReads(
      structuredClone(fixture) as ControlledFixtureContract,
    );
    expect(() => projectControlledProtocolInputFromFixture(protectedFixture)).not.toThrow();
  });

  it("Registry 输出只含事实输入，递归排除 expected/mutation/public/certificate/grant 字段", async () => {
    const input = materializeControlledProtocolInput(await publicControlledHandle());
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenOracleKey(key), `禁止字段泄漏：${key}`).toBe(false);
        visit(child);
      }
    };
    visit(input);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.observations)).toBe(true);
  });

  it("Candidate Authority 只封装真实完整 Kernel Candidate，不获得持久化/Public READY 权限", async () => {
    const evaluation = await publicBaseEvaluation();
    const authority = createResearchKernelCandidateAuthority();
    expect(isResearchKernelCandidateAuthority(authority)).toBe(true);
    expect(isResearchKernelCandidateAuthority({ ...authority })).toBe(false);
    expect(isResearchKernelCandidateAuthority(structuredClone(authority))).toBe(false);
    expect(isResearchKernelCandidateAuthority(JSON.parse(JSON.stringify(authority)))).toBe(false);

    const sealed = sealKernelVerifiedReportReadyCandidate(authority, evaluation);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(isKernelVerifiedReportReadyCandidate(sealed.value)).toBe(true);
    expect(isKernelVerifiedReportReadyCandidate({ ...sealed.value })).toBe(false);
    expect(isKernelVerifiedReportReadyCandidate(structuredClone(sealed.value))).toBe(false);
    expect(isKernelVerifiedReportReadyCandidate(JSON.parse(JSON.stringify(sealed.value)))).toBe(
      false,
    );
    expect(sealed.value).toMatchObject({
      verification_scope: "KERNEL_CANDIDATE_ONLY",
      persistence_authority: "NONE",
      can_commit_public_terminal: false,
    });
    expect(sealed.value).not.toHaveProperty("public_terminal");
    expect(sealed.value).not.toHaveProperty("current_readiness");
    expect(sealed.value).not.toHaveProperty("grant");
    expect(getKernelVerifiedCandidateMetadata(sealed.value)).toEqual({
      kernel_trace: ["OBSERVATION", "COVERAGE", "STOP", "REPORTING", "READINESS"],
      verification_scope: "KERNEL_CANDIDATE_ONLY",
      persistence_authority: "NONE",
      can_commit_public_terminal: false,
    });
  });

  it("伪造 Authority 或 clone Kernel Evaluation 都不能获得 Candidate Seal", async () => {
    const evaluation = await publicBaseEvaluation();
    const authority = createResearchKernelCandidateAuthority();
    const clonedEvaluation = structuredClone(evaluation);
    expect(sealKernelVerifiedReportReadyCandidate(authority, clonedEvaluation)).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
    expect(
      sealKernelVerifiedReportReadyCandidate({ ...authority } as typeof authority, evaluation),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("真实但未达到 STOP_READY 的 branded Kernel Evaluation 也不能获得 Candidate Seal", async () => {
    const cases = await controlledMutationCases();
    const selected = [
      {
        case_id: "citation-only",
        outcome_kind: "RESEARCH_STOP_CANDIDATE",
      },
      {
        case_id: "supervisor-certificate-bypass",
        outcome_kind: "READINESS_REJECTED",
      },
      {
        case_id: "current-ready-revocation-race",
        outcome_kind: "REVOCATION_REQUIRED",
      },
    ] as const;
    const evaluations = await Promise.all(
      selected.map(async ({ case_id, outcome_kind }) => {
        const testCase = cases.find((candidate) => candidate.case_id === case_id);
        if (!testCase) throw new Error(`${case_id} mutation fixture 缺失。`);
        const evaluation = await runRawControlledProtocolKernel(testCase.kernel_input);
        expect(evaluation.kernel_outcome.kind).toBe(outcome_kind);
        return evaluation;
      }),
    );

    for (const evaluation of evaluations) {
      expect(
        sealRawKernelVerifiedReportReadyCandidate(
          createRawResearchKernelCandidateAuthority(),
          evaluation,
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
      });
    }
  }, 30_000);

  it("clone/spread/空假设或谓词篡改输入均丢失受控品牌，无法进入 Kernel", async () => {
    const input = materializeControlledProtocolInput(await publicControlledHandle());
    const cloned = structuredClone(input);
    const jsonRoundTripped = JSON.parse(JSON.stringify(input));
    const emptyHypotheses = { ...input, hypotheses: [] };
    const predicateTamper = {
      ...input,
      hypotheses: input.hypotheses.map((hypothesis, index) =>
        index === 0
          ? {
              ...hypothesis,
              support_predicate: { operator: "GTE" as const, threshold: 0 },
            }
          : hypothesis,
      ),
    };
    await expect(runControlledProtocolKernel(cloned as typeof input)).rejects.toThrow(
      "CONTROLLED_RESEARCH_PROTOCOL_INPUT_REQUIRED",
    );
    await expect(runControlledProtocolKernel(jsonRoundTripped as typeof input)).rejects.toThrow(
      "CONTROLLED_RESEARCH_PROTOCOL_INPUT_REQUIRED",
    );
    await expect(runControlledProtocolKernel(emptyHypotheses as typeof input)).rejects.toThrow(
      "CONTROLLED_RESEARCH_PROTOCOL_INPUT_REQUIRED",
    );
    await expect(runControlledProtocolKernel(predicateTamper as typeof input)).rejects.toThrow(
      "CONTROLLED_RESEARCH_PROTOCOL_INPUT_REQUIRED",
    );
  });
});
