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
  PYTHON_SANDBOX_AUTH_TOKEN: "falcon24-test-sandbox-authorization-token",
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
    sandbox: {} as never,
    environment,
  });
}

describe("Falcon24 production analysis runtime", () => {
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
      { ...validEnvironment, PYTHON_SANDBOX_AUTH_TOKEN: undefined },
      "ANALYSIS_PYTHON_SANDBOX_AUTHORIZATION_REQUIRED",
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
      artifact_type: "SandboxProgram",
      label: "source",
      content_hash: `sha256:${"a".repeat(64)}`,
      lease,
    });
    const second = factory.createSystem({
      artifact_type: "SandboxProgram",
      label: "source",
      content_hash: `sha256:${"a".repeat(64)}`,
      lease,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ run_id: id(4), app_id: id(2), tenant_id: id(3) });
    expect(
      falcon24AnalysisRuntimeInternals.schemaType({
        name: "order_date",
        kind: "UTF8",
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
  });
});
