import {
  publicSemanticGovernanceError,
  type SemanticGovernanceError,
} from "./semantic-governance-error";

export type SemanticGovernanceBackendConfig =
  | { readonly backend: "mock" }
  | { readonly backend: "postgres"; readonly connectionString: string };

interface SemanticGovernanceEnvironment {
  readonly SEMANTIC_GOVERNANCE_BACKEND?: string;
  readonly DATABASE_URL?: string;
  readonly NODE_ENV?: string;
}

interface SemanticGovernanceDependencies {
  readonly hasAuthorityResolver: boolean;
}

export function parseSemanticGovernanceBackend(
  environment: SemanticGovernanceEnvironment,
  dependencies: SemanticGovernanceDependencies,
): SemanticGovernanceBackendConfig {
  const backend = environment.SEMANTIC_GOVERNANCE_BACKEND;
  if (!backend) {
    throw publicSemanticGovernanceError("SEMANTIC_BACKEND_NOT_CONFIGURED");
  }
  if (backend !== "mock" && backend !== "postgres") {
    throw publicSemanticGovernanceError("SEMANTIC_BACKEND_INVALID");
  }
  if (backend === "mock") {
    if (environment.NODE_ENV === "production") {
      throw publicSemanticGovernanceError("SEMANTIC_MOCK_FORBIDDEN");
    }
    return { backend };
  }
  if (!environment.DATABASE_URL) {
    throw publicSemanticGovernanceError("SEMANTIC_DATABASE_NOT_CONFIGURED");
  }
  if (!dependencies.hasAuthorityResolver) {
    throw publicSemanticGovernanceError("SEMANTIC_AUTHORITY_NOT_CONFIGURED");
  }
  return { backend, connectionString: environment.DATABASE_URL };
}

export type { SemanticGovernanceError };
