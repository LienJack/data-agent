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

const finishReasons = new Set(["stop", "length", "tool-calls", "content-filter", "error", "other"]);
const textStates = new Set(["EMPTY", "WHITESPACE", "NON_JSON"]);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Private log projection only: never serialize the error, messages or provider values. */
export function modelProtocolDiagnostic(error: unknown) {
  if (!(error instanceof MastraExecutionError) || error.code !== "MODEL_STREAM_PROTOCOL_VIOLATION")
    return null;
  try {
    const response = error.protocol_response;
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
      ...(response
        ? {
            response: {
              finish_reason: finishReasons.has(response.finish_reason)
                ? response.finish_reason
                : "unknown",
              text_state: textStates.has(response.text_state) ? response.text_state : "UNKNOWN",
              text_utf8_bytes: count(response.text_utf8_bytes),
              streamed_text_utf8_bytes: count(response.streamed_text_utf8_bytes),
              text_delta_chunks: count(response.text_delta_chunks),
              observed_tool_calls: count(response.observed_tool_calls),
              output_tokens: count(response.output_tokens),
            },
          }
        : {}),
    };
  } catch {
    return { stage: "UNKNOWN", issues: [] };
  }
}
