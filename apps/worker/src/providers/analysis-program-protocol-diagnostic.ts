import { z } from "zod";
import { analysisProgramCandidateSchema } from "../analysis/analysis-program-compiler.js";

const MAX_CAPTURE_BYTES = 65_536;
const pathFieldSchema = z.enum([
  "schema_version",
  "objective_hash",
  "nodes",
  "node_id",
  "method_registry_entry_ids",
  "metric_ids",
  "dimension_ids",
  "time_window",
  "comparison_window",
  "start",
  "end",
  "timezone",
  "semantics",
  "parameters",
  "result_schema_version",
  "claim_strength",
  "operator_obligations",
  "dependency_node_ids",
  "activation_rule",
  "kind",
  "source_node_id",
  "policy_threshold_id",
  "minimum_points",
  "criticality",
  "$field",
]);
const issueCodeSchema = z.enum([
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
  "unknown",
]);
const diagnosticSchema = z.strictObject({
  schema_version: z.literal("analysis-program-protocol-diagnostic@1.0.0"),
  state: z.enum([
    "EMPTY",
    "INVALID_JSON",
    "NON_OBJECT",
    "SCHEMA_VALID",
    "SCHEMA_INVALID",
    "CAPTURE_LIMIT",
    "VALIDATION_UNAVAILABLE",
  ]),
  issues: z
    .array(
      z.strictObject({
        code: issueCodeSchema,
        path: z.array(z.union([pathFieldSchema, z.number().int().min(0).max(63)])).max(12),
      }),
    )
    .max(8),
});
type Diagnostic = z.infer<typeof diagnosticSchema>;

// The private text buffer never leaves this closure. Only allowlisted structural
// paths/codes are projected; no values, unknown keys, raw text or provider errors.
export function createAnalysisProgramProtocolDiagnostic() {
  let text = "";
  let bytes = 0;
  let capped = false;
  return {
    append(delta: string) {
      if (capped) return;
      bytes += Buffer.byteLength(delta, "utf8");
      if (bytes > MAX_CAPTURE_BYTES) {
        text = "";
        capped = true;
        return;
      }
      text += delta;
    },
    finish(): Diagnostic {
      const result = (
        state: Diagnostic["state"],
        issues: Diagnostic["issues"] = [],
      ): Diagnostic => ({
        schema_version: "analysis-program-protocol-diagnostic@1.0.0",
        state,
        issues,
      });
      if (capped) return result("CAPTURE_LIMIT");
      if (!text.trim()) return result("EMPTY");
      let candidate: unknown;
      try {
        candidate = JSON.parse(text);
      } catch {
        return result("INVALID_JSON");
      }
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
        return result("NON_OBJECT");
      try {
        const parsed = analysisProgramCandidateSchema.safeParse(candidate);
        if (parsed.success) return result("SCHEMA_VALID");
        return result(
          "SCHEMA_INVALID",
          parsed.error.issues.slice(0, 8).map((issue) => ({
            code: issueCodeSchema.safeParse(issue.code).success ? issue.code : "unknown",
            path: issue.path.slice(0, 12).map((part) => {
              if (typeof part === "number" && Number.isInteger(part) && part >= 0 && part <= 63)
                return part;
              const known = pathFieldSchema.safeParse(part);
              return known.success ? known.data : "$field";
            }),
          })),
        );
      } catch {
        return result("VALIDATION_UNAVAILABLE");
      }
    },
  };
}

export function publicAnalysisProgramProtocolDiagnostic(details: unknown): string | null {
  const parsed = z.strictObject({ analysis_program_protocol: diagnosticSchema }).safeParse(details);
  return parsed.success ? JSON.stringify(parsed.data.analysis_program_protocol) : null;
}
