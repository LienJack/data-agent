import * as publicApi from "@data-agent/text2sql";
import * as serverApi from "@data-agent/text2sql/server";
import { describe, expect, it } from "vitest";

describe("@data-agent/text2sql 公共 API", () => {
  it("只暴露 ACL-first、类型化编译、七道 Gate、封口与 Artifact 投影入口", () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        "EXECUTION_GATE_REASON_CODES",
        "INTENT_GATE_REASON_CODES",
        "LOGICAL_PLAN_VALIDATION_REASON_CODES",
        "POLICY_GATE_REASON_CODES",
        "POSTGRESQL_COMPILATION_REASON_CODES",
        "POSTGRESQL_COMPILER_VERSION",
        "RESOURCE_GATE_REASON_CODES",
        "RESULT_GATE_REASON_CODES",
        "SEMANTIC_GATE_REASON_CODES",
        "STRUCTURAL_GATE_REASON_CODES",
        "BOUNDED_REPAIR_LIMITS",
        "BOUNDED_REPAIR_VERSION",
        "TEXT2SQL_GATE_EVALUATOR_VERSION",
        "TEXT2SQL_GATE_REASON_CODES",
        "TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB",
        "buildLogicalPlan",
        "buildSemanticQuery",
        "attemptBoundedRepair",
        "compilePostgresqlLogicalPlan",
        "compileQueryContract",
        "compileSqlDialect",
        "computeRepairEpisodeHash",
        "computeRepairFrozenBundleHash",
        "computeRepairPatchScriptHash",
        "computeRepairReceiptHash",
        "computeRepairTraceHash",
        "computeResultOracleEvidenceHash",
        "computeSqlSandboxInputHash",
        "createAclFirstGrounder",
        "createGateReceiptPayload",
        "createGroundingPackagePayload",
        "createLogicalPlanPayload",
        "createSemanticQueryPayload",
        "evaluatePostExecutionGates",
        "evaluatePreExecutionGates",
        "isPostgresqlCompilation",
        "isValidatedLogicalPlan",
        "postgresqlExplainEstimateSchema",
        "resourcePolicySchema",
        "repairFrozenBundleSchema",
        "repairPatchOperationSchema",
        "repairReceiptSchema",
        "repairTraceSchema",
        "resultOracleVerdictSchema",
        "sealExecutionPermit",
        "sealRepairFrozenBundle",
        "sealValidationReceipt",
        "validateLogicalPlan",
      ].sort(),
    );
    expect("groundQueryContract" in publicApi).toBe(false);
    expect("registerPostgresqlCompilation" in publicApi).toBe(false);
    expect("registerAuthoritativeLogicalPlanBinding" in publicApi).toBe(false);
    expect("registerTrustedLogicalPlanCompilerAuthority" in publicApi).toBe(false);
    expect("registerTrustedGateArtifactAuthority" in publicApi).toBe(false);
    expect("registerTrustedResourceAdmission" in publicApi).toBe(false);
    expect("registerTrustedResultOracleAuthority" in publicApi).toBe(false);
    expect("registerTrustedMetamorphicFixtureAuthority" in publicApi).toBe(false);
    expect("registerTrustedMetamorphicOracleVerifier" in publicApi).toBe(false);
    expect("createTrustedGateEvaluation" in publicApi).toBe(false);
  });

  it("服务端 Composition Root 可从显式 server 子路径组合，且不扩大普通根入口", () => {
    expect(Object.keys(serverApi).sort()).toEqual(
      [
        "authorizeRepairTrace",
        "createBoundedRepairTrace",
        "loadCurrentRepairSession",
        "registerAuthoritativeLogicalPlanBinding",
        "registerTrustedGateArtifactAuthority",
        "registerTrustedLogicalPlanCompilerAuthority",
        "registerTrustedMetamorphicFixtureAuthority",
        "registerTrustedMetamorphicOracleVerifier",
        "registerTrustedResourceAdmission",
        "registerTrustedRepairAuthority",
        "registerTrustedResultOracleAuthority",
      ].sort(),
    );
  });
});
