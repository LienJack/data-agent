import type { ProductProfileToolPort } from "../mastra-profile-composition.js";

export interface SemanticManagementToolDependencies {
  readonly readCatalog: ProductProfileToolPort["invoke"];
  readonly writeCandidate: ProductProfileToolPort["invoke"];
}

export function createSemanticManagementTools(
  dependencies: SemanticManagementToolDependencies,
): ProductProfileToolPort {
  return {
    async invoke(input) {
      if (
        input.task.profile_id !== "semantic-management-agent" ||
        input.profile.revision.profile_id !== "semantic-management-agent"
      ) {
        throw new TypeError("SEMANTIC_AGENT_PROFILE_DENIED");
      }
      switch (input.tool_id) {
        case "semantic.catalog.read":
          return dependencies.readCatalog(input);
        case "semantic.candidate.write":
          return dependencies.writeCandidate(input);
        default:
          throw new TypeError("SEMANTIC_AGENT_TOOL_DENIED");
      }
    },
  };
}
