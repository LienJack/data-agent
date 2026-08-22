import { describe, expect, expectTypeOf, it } from "vitest";
import {
  RUNTIME_BUILD_IDENTITY_VERSION,
  type RuntimeBuildIdentity,
  runtimeBuildIdentitySchema,
} from "../src/operations/runtime-build-identity.js";

function validIdentity(): RuntimeBuildIdentity {
  return {
    schema_version: RUNTIME_BUILD_IDENTITY_VERSION,
    consumer_role: "web",
    generation_id: `sha256:${"a".repeat(64)}`,
    build_id: `sha256:${"b".repeat(64)}`,
    built_at: "2026-08-22T00:00:00.000Z",
    git_commit: "c".repeat(40),
    git_dirty: true,
  };
}

describe("RuntimeBuildIdentity contract", () => {
  it("解析四类受管理进程的安全 portable identity", () => {
    for (const consumerRole of [
      "web",
      "worker",
      "relationship-indexer",
      "semantic-authoring",
    ] as const) {
      expect(
        runtimeBuildIdentitySchema.parse({
          ...validIdentity(),
          consumer_role: consumerRole,
        }),
      ).toMatchObject({ consumer_role: consumerRole });
    }

    expectTypeOf(validIdentity().build_id).toEqualTypeOf<`sha256:${string}`>();
  });

  it("拒绝未知字段、未知角色、非内容哈希和不可审计 Git provenance", () => {
    const identity = validIdentity();
    for (const candidate of [
      { ...identity, package_digests: ["internal"] },
      { ...identity, consumer_role: "scheduler" },
      { ...identity, build_id: "latest" },
      { ...identity, generation_id: `sha256:${"A".repeat(64)}` },
      { ...identity, git_commit: "unknown" },
      { ...identity, built_at: "yesterday" },
    ]) {
      expect(runtimeBuildIdentitySchema.safeParse(candidate).success).toBe(false);
    }
  });
});
