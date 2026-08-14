import { z } from "zod";
import { environmentSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const ATTRIBUTION_PROFILE_REQUEST_VERSION = "attribution-profile-request@1" as const;

export const PROFILE_REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "DEDUPED",
  "TRIAGED",
  "LINKED",
  "DECLINED",
  "CLOSED",
  "EXPIRED",
  "WITHDRAWN",
] as const;

export const PROFILE_REQUEST_TYPES = ["PROFILE_ACCESS"] as const;

/**
 * Attribution profile request: lifecycle for requesting attribution profile access.
 * Status may follow: DRAFT -> SUBMITTED -> DEDUPED|TRIAGED -> DECLINED|LINKED -> CLOSED
 * Terminal states: DEDUPED, DECLINED, CLOSED, EXPIRED, WITHDRAWN
 */
export const attributionProfileRequestSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  request_id: immutableIdSchema,
  subject_id: z.string().min(1).max(256),
  requester: z.string().min(1).max(256),
  request_type: z.enum(PROFILE_REQUEST_TYPES),
  status: z.enum(PROFILE_REQUEST_STATUSES),
  request_reason: z.string().max(2048).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type AttributionProfileRequest = z.infer<typeof attributionProfileRequestSchema>;
