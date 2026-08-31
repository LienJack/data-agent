import { analysisAgentFinalResponseSchema } from "@data-agent/contracts/ports";
import { z } from "zod";

/** A per-request narrowing of the original response, never a replacement response. */
export function analysisFinalResponseSchema(summaryConstraint?: string) {
  if (summaryConstraint === undefined) return analysisAgentFinalResponseSchema;
  const parsed = analysisAgentFinalResponseSchema.shape.summary_zh.parse(summaryConstraint);
  if (parsed !== summaryConstraint) throw new TypeError("ANALYSIS_FINAL_CONSTRAINT_INVALID");
  return analysisAgentFinalResponseSchema.extend({ summary_zh: z.literal(parsed) });
}

export function assertAnalysisFinalSummary(summary: string, constraint?: string): void {
  if (constraint !== undefined && summary !== constraint) {
    throw new TypeError("ANALYSIS_FINAL_SUMMARY_CONSTRAINT_MISMATCH");
  }
}
