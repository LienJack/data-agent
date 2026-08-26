import {
  buildFalcon24RunExecutionPolicy,
  DEFAULT_RUN_EXECUTION_POLICY,
} from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import {
  createFalcon24AnalysisRuntime,
  falcon24AnalysisRuntimeInternals,
} from "../../src/evals/falcon24-analysis-runtime.js";

const id = (suffix: number) => `36000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const encodedKey = Buffer.alloc(32, 7).toString("base64");
const validEnvironment = {
  DATA_AGENT_ANALYSIS_INPUT_KEY_BASE64: encodedKey,
  DATA_AGENT_ANALYSIS_PYTHON_SOURCE_KEY_BASE64: encodedKey,
  ANALYSIS_SANDBOX_ENABLED: "true",
  ANALYSIS_SANDBOX_SERVER_DOMAIN: "opensandbox.test:443",
  ANALYSIS_SANDBOX_SERVER_PROTOCOL: "https",
  ANALYSIS_SANDBOX_API_KEY: "falcon24-test-opensandbox-api-key",
  ANALYSIS_SANDBOX_USE_SERVER_PROXY: "true",
  ANALYSIS_SANDBOX_SECURE_ACCESS: "true",
  ANALYSIS_SANDBOX_AGENT_CORE_IMAGE: "agent-core@sha256:test",
  ANALYSIS_SANDBOX_AGENT_ML_IMAGE: "agent-ml@sha256:test",
  ANALYSIS_SANDBOX_AGENT_CAUSAL_IMAGE: "agent-causal@sha256:test",
  ANALYSIS_SANDBOX_OPERATOR_IMAGE: "operator@sha256:test",
} satisfies NodeJS.ProcessEnv;

function createRuntime(environment: NodeJS.ProcessEnv) {
  return createFalcon24AnalysisRuntime({
    pool: {} as never,
    research_authority: {} as never,
    sensitive_artifacts: {} as never,
    research_capabilities: {
      forArtifactType: () => ({ authority: "research" }) as never,
      forDomain: () => ({ authority: "research" }) as never,
    },
    app_capability_input: { authority: "application" },
    public_artifacts: {} as never,
    environment,
  });
}

describe("Falcon24 production analysis runtime", () => {
  it("只接受与语义案例一致的 exact strict lease policy", () => {
    const campaignId = "falcon24-root-v13-final-20260826";
    const caseId = "falcon24-business-review-18m";
    const strict = buildFalcon24RunExecutionPolicy({
      campaign_id: campaignId,
      case_id: caseId,
      run_variant: "COLD",
      repetition: 1,
    });
    expect(() =>
      falcon24AnalysisRuntimeInternals.assertFalcon24AnalysisLeasePolicy({
        execution_policy: strict,
      } as never),
    ).not.toThrow();
    expect(() =>
      falcon24AnalysisRuntimeInternals.assertFalcon24AnalysisLeasePolicy({
        execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      } as never),
    ).toThrow("FALCON24_ANALYSIS_RUN_EXECUTION_POLICY_MISMATCH");
    expect(() =>
      falcon24AnalysisRuntimeInternals.assertFalcon24ResolvedCase(
        caseId,
        "falcon24-delivery-experience-12m",
      ),
    ).toThrow("FALCON24_ANALYSIS_RUN_EXECUTION_POLICY_MISMATCH");
  });

  it("constructs the single governed runtime only with all hard controls", () => {
    expect(createRuntime(validEnvironment)).toMatchObject({ analyze: expect.any(Function) });
  });

  it.each([
    [
      { ...validEnvironment, DATA_AGENT_ANALYSIS_INPUT_KEY_BASE64: undefined },
      "ANALYSIS_INPUT_ENCRYPTION_CONFIG_REQUIRED",
    ],
    [
      { ...validEnvironment, DATA_AGENT_ANALYSIS_PYTHON_SOURCE_KEY_BASE64: undefined },
      "ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_REQUIRED",
    ],
    [
      { ...validEnvironment, ANALYSIS_SANDBOX_SERVER_DOMAIN: undefined },
      "ANALYSIS_SANDBOX_CONFIGURATION_INVALID",
    ],
    [
      { ...validEnvironment, ANALYSIS_SANDBOX_USE_SERVER_PROXY: undefined },
      "ANALYSIS_SANDBOX_CONFIGURATION_INVALID",
    ],
  ] as const)("fails closed for incomplete production controls", (environment, errorCode) => {
    expect(() => createRuntime(environment)).toThrow(errorCode);
  });

  it("derives deterministic, run-scoped artifact references and semantic field types", () => {
    const factory = falcon24AnalysisRuntimeInternals.referenceFactory();
    const lease = {
      scope: { app_id: id(2), tenant_id: id(3), environment: "test" },
      run_id: id(4),
    } as never;
    const first = factory.createSystem({
      artifact_type: "SandboxExecutionReceipt",
      label: "source",
      content_hash: `sha256:${"a".repeat(64)}`,
      lease,
    });
    const second = factory.createSystem({
      artifact_type: "SandboxExecutionReceipt",
      label: "source",
      content_hash: `sha256:${"a".repeat(64)}`,
      lease,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ run_id: id(4), app_id: id(2), tenant_id: id(3) });
    expect(
      falcon24AnalysisRuntimeInternals.schemaType({
        name: "order_date",
        kind: "DATE",
        nullable: false,
      }),
    ).toBe("DATE");
    expect(
      falcon24AnalysisRuntimeInternals.schemaType({
        name: "order_total",
        kind: "FLOAT64",
        nullable: false,
      }),
    ).toBe("NUMBER");
    expect(
      falcon24AnalysisRuntimeInternals.schemaType({
        name: "date_like_label",
        kind: "UTF8",
        nullable: false,
      }),
    ).toBe("STRING");
  });
});
