import { logicalOperationSchema, logicalPlanContentSchema } from "@data-agent/contracts";
import type { z } from "zod";
import type { semanticQueryDraftSchema } from "../semantic/types.js";

export const logicalOperationDraftSchema = logicalOperationSchema;
export const logicalPlanDraftSchema = logicalPlanContentSchema;

export type LogicalOperationDraft = z.infer<typeof logicalOperationDraftSchema>;
export type LogicalPlanDraft = z.infer<typeof logicalPlanDraftSchema>;
export type SemanticQueryInput = z.infer<typeof semanticQueryDraftSchema>;
