import { describe, expect, it } from "vitest";
import * as platform from "../../src/index.js";

describe("platform package public surface", () => {
  it("exports only production, scope-aware U2/U4 entry points", () => {
    expect(Object.keys(platform).sort()).toEqual([
      "PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL",
      "PersistenceBoundaryError",
      "adaptPgPool",
      "containsPotentialPlaintextSecret",
      "createCacheNamespace",
      "createPostgresCapabilityAuthority",
      "createPostgresDatasourceEgress",
      "createPostgresRepository",
      "createPostgresRunControl",
      "createPostgresRunEventStore",
      "createPostgresRunQueue",
      "createPostgresSecretRefRepository",
      "createScopedUpstashCache",
      "createStorageNamespace",
      "withAppTransaction",
    ]);
  });

  it("does not expose process-local authorities or raw provider adapters", () => {
    expect(platform).not.toHaveProperty("createDeploymentRegistry");
    expect(platform).not.toHaveProperty("createLifecycleEvidenceAuthority");
    expect(platform).not.toHaveProperty("LifecycleRegistry");
    expect(platform).not.toHaveProperty("SecretRegistry");
    expect(platform).not.toHaveProperty("createDatasourceEgressPolicyRegistry");
    expect(platform).not.toHaveProperty("createUpstashRedisRestClient");
    expect(platform).not.toHaveProperty("createUpstashRedisRestClientFromEnv");
  });
});
