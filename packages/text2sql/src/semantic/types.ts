import {
  boundParameterSchema,
  fieldReferenceSchema,
  parameterReferenceSchema,
  semanticQueryContentSchema,
  typedPredicateSchema,
} from "@data-agent/contracts";
import type { z } from "zod";
import type { mandatoryPredicateSchema } from "../grounding/types.js";

export {
  boundParameterSchema,
  fieldReferenceSchema,
  parameterReferenceSchema,
  typedPredicateSchema,
};

export const semanticQueryDraftSchema = semanticQueryContentSchema;

export type FieldReference = z.infer<typeof fieldReferenceSchema>;
export type TypedPredicate = z.infer<typeof typedPredicateSchema>;
export type BoundParameter = z.infer<typeof boundParameterSchema>;
export type SemanticQueryDraft = z.infer<typeof semanticQueryDraftSchema>;
export type MandatoryPolicyPredicate = z.infer<typeof mandatoryPredicateSchema>;
