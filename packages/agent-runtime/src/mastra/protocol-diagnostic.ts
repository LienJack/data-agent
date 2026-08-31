import { MastraExecutionError, MODEL_PROTOCOL_STAGES } from "./errors.js";

const fields = new Set([
  "schema_version",
  "kind",
  "sections",
  "public_summary",
  "body_text",
  "source_refs",
  "artifact_refs",
  "content",
  "text",
  "output_text",
  "chunk_type",
  "delta",
  "tool_call_id",
  "tool_name",
  "arguments",
  "usage",
  "availability",
  "input_tokens",
  "output_tokens",
  "observed_tool_calls",
  "confidence",
  "summary",
]);
const codes = new Set([
  "invalid_type",
  "too_big",
  "too_small",
  "unrecognized_keys",
  "invalid_value",
  "invalid_union",
  "invalid_format",
  "custom",
  "not_multiple_of",
  "invalid_key",
  "invalid_element",
]);

/** Private log projection only: never serialize the error, messages or provider values. */
export function modelProtocolDiagnostic(error: unknown) {
  if (!(error instanceof MastraExecutionError) || error.code !== "MODEL_STREAM_PROTOCOL_VIOLATION")
    return null;
  try {
    return {
      stage:
        error.protocol_stage && MODEL_PROTOCOL_STAGES.includes(error.protocol_stage)
          ? error.protocol_stage
          : "UNKNOWN",
      issues: (error.protocol_issues ?? []).slice(0, 8).map((issue) => ({
        code: codes.has(issue.code) ? issue.code : "unknown",
        path: issue.path
          .slice(0, 12)
          .map((part) =>
            typeof part === "number" && Number.isInteger(part) && part >= 0 && part <= 63
              ? part
              : typeof part === "string" && fields.has(part)
                ? part
                : "$field",
          ),
      })),
    };
  } catch {
    return { stage: "UNKNOWN", issues: [] };
  }
}
