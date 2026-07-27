import { describe, expect, it } from "vitest";
import * as platform from "../../src/index.js";

describe("platform package public surface", () => {
  it("exports only production, scope-aware U2/U4/U6 entry points", () => {
    expect(Object.keys(platform).sort()).toEqual([
      "PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL",
      "PersistenceBoundaryError",
      "PythonSqlSandboxProtocolError",
      "adaptPgPool",
      "containsPotentialPlaintextSecret",
      "createCacheNamespace",
      "createCoordinatedSandboxPort",
      "createPostgresCapabilityAuthority",
      "createPostgresDatasourceEgress",
      "createPostgresRepository",
      "createPostgresResearchAuthority",
      "createPostgresRunControl",
      "createPostgresRunEventStore",
      "createPostgresRunQueue",
      "createPostgresSecretRefRepository",
      "createPostgresText2SqlSandboxAuthority",
      "createPythonSqlSandboxClient",
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
    expect(platform).not.toHaveProperty("startSingleExecutionNdjsonProcess");
    expect(platform).not.toHaveProperty("capabilityInputSchema");
    expect(platform).not.toHaveProperty("historicalDocumentSchema");
    expect(platform).not.toHaveProperty("ResearchAuthorityTransportError");
  });
});
