import { describe, expect, it } from "vitest";
import * as publicApi from "../src/index.js";

describe("@data-agent/text2sql 公共 API", () => {
  it("只暴露 ACL-first、类型化构建、验证与 Artifact 投影入口", () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        "LOGICAL_PLAN_VALIDATION_REASON_CODES",
        "buildLogicalPlan",
        "buildSemanticQuery",
        "compileQueryContract",
        "createAclFirstGrounder",
        "createGroundingPackagePayload",
        "createLogicalPlanPayload",
        "createSemanticQueryPayload",
        "isValidatedLogicalPlan",
        "validateLogicalPlan",
      ].sort(),
    );
    expect("groundQueryContract" in publicApi).toBe(false);
  });
});
