import { describe, expect, it } from "vitest";
import { parseSemanticGovernanceBackend } from "../src/lib/semantic-governance-config";

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : undefined;
  }
}

describe("semantic governance backend selection", () => {
  it("fails when the backend is not configured", () => {
    expect(
      errorCode(() => parseSemanticGovernanceBackend({}, { hasAuthorityResolver: false })),
    ).toBe("SEMANTIC_BACKEND_NOT_CONFIGURED");
  });

  it("fails for an unknown backend", () => {
    expect(
      errorCode(() =>
        parseSemanticGovernanceBackend(
          { SEMANTIC_GOVERNANCE_BACKEND: "automatic" },
          { hasAuthorityResolver: true },
        ),
      ),
    ).toBe("SEMANTIC_BACKEND_INVALID");
  });

  it("forbids mock in production", () => {
    expect(
      errorCode(() =>
        parseSemanticGovernanceBackend(
          { SEMANTIC_GOVERNANCE_BACKEND: "mock", NODE_ENV: "production" },
          { hasAuthorityResolver: false },
        ),
      ),
    ).toBe("SEMANTIC_MOCK_FORBIDDEN");
  });

  it("allows an explicitly selected local mock", () => {
    expect(
      parseSemanticGovernanceBackend(
        { SEMANTIC_GOVERNANCE_BACKEND: "mock", NODE_ENV: "development" },
        { hasAuthorityResolver: false },
      ),
    ).toEqual({ backend: "mock" });
  });

  it("requires both database and authority for postgres", () => {
    expect(
      errorCode(() =>
        parseSemanticGovernanceBackend(
          { SEMANTIC_GOVERNANCE_BACKEND: "postgres" },
          { hasAuthorityResolver: true },
        ),
      ),
    ).toBe("SEMANTIC_DATABASE_NOT_CONFIGURED");
    expect(
      errorCode(() =>
        parseSemanticGovernanceBackend(
          { SEMANTIC_GOVERNANCE_BACKEND: "postgres", DATABASE_URL: "postgresql://db/app" },
          { hasAuthorityResolver: false },
        ),
      ),
    ).toBe("SEMANTIC_AUTHORITY_NOT_CONFIGURED");
  });
});
