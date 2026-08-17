import type { ArtifactReference } from "@data-agent/contracts";
import type { ProductProfileToolPort } from "../mastra-profile-composition.js";

export interface ReportWritingToolDependencies {
  readonly readEvidence: ProductProfileToolPort["invoke"];
  readonly projectReport: ProductProfileToolPort["invoke"];
}

export function createReportWritingTools(
  dependencies: ReportWritingToolDependencies,
): ProductProfileToolPort {
  return {
    async invoke(input): Promise<ArtifactReference | null> {
      if (
        input.task.profile_id !== "report-writing-agent" ||
        input.profile.revision.profile_id !== "report-writing-agent"
      ) {
        throw new TypeError("REPORT_AGENT_PROFILE_DENIED");
      }
      switch (input.tool_id) {
        case "evidence.read":
          return dependencies.readEvidence(input);
        case "report.project":
          return dependencies.projectReport(input);
        default:
          throw new TypeError("REPORT_AGENT_TOOL_DENIED");
      }
    },
  };
}
