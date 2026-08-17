import type { ArtifactReference } from "@data-agent/contracts";
import type { ProductProfileToolPort } from "../mastra-profile-composition.js";

export interface Text2SqlToolDependencies {
  readonly readRelease: ProductProfileToolPort["invoke"];
  readonly compile: ProductProfileToolPort["invoke"];
  readonly execute: ProductProfileToolPort["invoke"];
}

export function createText2SqlTools(
  dependencies: Text2SqlToolDependencies,
): ProductProfileToolPort {
  return {
    async invoke(input): Promise<ArtifactReference | null> {
      if (
        input.task.profile_id !== "governed-text2sql-agent" ||
        input.profile.revision.profile_id !== "governed-text2sql-agent"
      ) {
        throw new TypeError("TEXT2SQL_AGENT_PROFILE_DENIED");
      }
      switch (input.tool_id) {
        case "semantic.release.read":
          return dependencies.readRelease(input);
        case "sql.compiler.compile":
          return dependencies.compile(input);
        case "sql.sandbox.execute":
          return dependencies.execute(input);
        default:
          throw new TypeError("TEXT2SQL_AGENT_TOOL_DENIED");
      }
    },
  };
}
