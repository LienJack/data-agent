/**
 * Published F9 lifecycle management service.
 *
 * Implements the U13.2 Published F9 lifecycle management for:
 * - CapabilityDirectory: pre-question discovery
 * - EligibilityDecision: frozen-question eligibility
 * - ProfileRequest: profile access request lifecycle
 * - SafetyVerdict: published attribution safety verdicts
 * - ProfileProjection: profile projections for attribution analysis
 *
 * Each method delegates to the 10621 PostgreSQL RPCs via withAppTransaction.
 *
 * @server-only
 */

import type { PortResult } from "@data-agent/contracts";
import { z } from "zod";
import {
  type AppTransactionOptions,
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

// ────────────────────────────────────────────────────────────────
// 1. Shared Zod Schemas for input/output validation
// ────────────────────────────────────────────────────────────────

const appScopeSchema = z.strictObject({
  app_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  environment: z.string().min(1),
});

type AppScope = z.infer<typeof appScopeSchema>;

// ────────────────────────────────────────────────────────────────
// 2. Capability Directory
// ────────────────────────────────────────────────────────────────

const publishCapabilityDirectoryInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  directory_hash: z.string().min(1),
  capabilities: z.record(z.string(), z.unknown()),
});

type PublishCapabilityDirectoryInput = z.infer<typeof publishCapabilityDirectoryInputSchema>;

const publishCapabilityDirectoryResultSchema = z.strictObject({
  directory_id: z.string().uuid(),
  published_at: z.string(),
});

type PublishCapabilityDirectoryResult = z.infer<typeof publishCapabilityDirectoryResultSchema>;

const getLatestCapabilityDirectoryInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
});

type GetLatestCapabilityDirectoryInput = z.infer<typeof getLatestCapabilityDirectoryInputSchema>;

// ────────────────────────────────────────────────────────────────
// 3. Eligibility Decision
// ────────────────────────────────────────────────────────────────

const recordEligibilityDecisionInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  request_id: z.string().uuid(),
  subject_id: z.string().min(1),
  eligibility_criteria: z.array(z.record(z.string(), z.unknown())),
  overall_eligible: z.boolean(),
  decision: z.enum(["ELIGIBLE", "INELIGIBLE", "DEFERRED"]),
  decided_by: z.string().min(1),
  frozen_question_hash: z.string().min(1),
  expires_at: z.string().optional(),
});

type RecordEligibilityDecisionInput = z.infer<typeof recordEligibilityDecisionInputSchema>;

const recordEligibilityDecisionResultSchema = z.strictObject({
  decision_id: z.string().uuid(),
  decision: z.string(),
  overall_eligible: z.boolean(),
  decided_at: z.string(),
});

type RecordEligibilityDecisionResult = z.infer<typeof recordEligibilityDecisionResultSchema>;

// ────────────────────────────────────────────────────────────────
// 4. Profile Request Lifecycle
// ────────────────────────────────────────────────────────────────

const createProfileRequestInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  subject_id: z.string().min(1),
  requester: z.string().min(1),
  request_type: z.enum(["PROFILE_ACCESS"]),
  request_reason: z.string().optional(),
});

type CreateProfileRequestInput = z.infer<typeof createProfileRequestInputSchema>;

const profileRequestResultSchema = z.strictObject({
  request_id: z.string().uuid(),
  status: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

type ProfileRequestResult = z.infer<typeof profileRequestResultSchema>;

const profileRequestIdInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  request_id: z.string().uuid(),
});

type ProfileRequestIdInput = z.infer<typeof profileRequestIdInputSchema>;

// ────────────────────────────────────────────────────────────────
// 5. Safety Verdict
// ────────────────────────────────────────────────────────────────

const recordSafetyVerdictInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: z.string().uuid(),
  evidence_id: z.string().uuid(),
  verdict: z.enum(["GO", "HOLD", "STOP"]),
  verdict_reason: z.string().min(1),
  verdict_dimensions: z.array(z.record(z.string(), z.unknown())),
  determined_by: z.string().min(1),
  evidence_hash: z.string().min(1),
  auto_approve: z.boolean().default(false),
  ttl_seconds: z.number().int().default(3600),
});

type RecordSafetyVerdictInput = z.infer<typeof recordSafetyVerdictInputSchema>;

const recordSafetyVerdictResultSchema = z.strictObject({
  verdict_id: z.string().uuid(),
  verdict: z.string(),
  determined_at: z.string(),
});

type RecordSafetyVerdictResult = z.infer<typeof recordSafetyVerdictResultSchema>;

const getLatestSafetyVerdictInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: z.string().uuid(),
});

type GetLatestSafetyVerdictInput = z.infer<typeof getLatestSafetyVerdictInputSchema>;

// ────────────────────────────────────────────────────────────────
// 6. Profile Projection
// ────────────────────────────────────────────────────────────────

const createProfileProjectionInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  source_release_id: z.string().uuid(),
  profile_name: z.string().min(1),
  profile_version: z.string().min(1),
  lowering_rule_set: z.record(z.string(), z.unknown()),
  contribution_endpoints: z.array(z.record(z.string(), z.unknown())),
});

type CreateProfileProjectionInput = z.infer<typeof createProfileProjectionInputSchema>;

const createProfileProjectionResultSchema = z.strictObject({
  profile_id: z.string().uuid(),
  is_active: z.boolean(),
  created_at: z.string(),
});

type CreateProfileProjectionResult = z.infer<typeof createProfileProjectionResultSchema>;

const updateProfileProjectionInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  profile_id: z.string().uuid(),
  lowering_rule_set: z.record(z.string(), z.unknown()).optional(),
  contribution_endpoints: z.array(z.record(z.string(), z.unknown())).optional(),
  is_active: z.boolean().optional(),
});

type UpdateProfileProjectionInput = z.infer<typeof updateProfileProjectionInputSchema>;

const getActiveProfileProjectionInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  profile_id: z.string().uuid().optional(),
});

type GetActiveProfileProjectionInput = z.infer<typeof getActiveProfileProjectionInputSchema>;

// ────────────────────────────────────────────────────────────────
// 7. Service Interface
// ────────────────────────────────────────────────────────────────

export interface PublishedF9LifecycleService {
  /** Publish a capability directory */
  publishCapabilityDirectory(
    capabilityInput: unknown,
    input: PublishCapabilityDirectoryInput,
  ): Promise<PortResult<PublishCapabilityDirectoryResult>>;

  /** Get the latest capability directory */
  getLatestCapabilityDirectory(
    capabilityInput: unknown,
    input: GetLatestCapabilityDirectoryInput,
  ): Promise<PortResult<Record<string, unknown> | null>>;

  /** Record an eligibility decision */
  recordEligibilityDecision(
    capabilityInput: unknown,
    input: RecordEligibilityDecisionInput,
  ): Promise<PortResult<RecordEligibilityDecisionResult>>;

  /** Get the latest eligibility decision for a subject + frozen question hash */
  getLatestEligibilityDecision(
    capabilityInput: unknown,
    input: GetLatestCapabilityDirectoryInput & { subject_id: string; frozen_question_hash: string },
  ): Promise<PortResult<Record<string, unknown> | null>>;

  /** Create a draft profile request */
  createProfileRequest(
    capabilityInput: unknown,
    input: CreateProfileRequestInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Submit a draft profile request (DRAFT → SUBMITTED) */
  submitProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Triage a submitted profile request (SUBMITTED → TRIAGED) */
  triageProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Dedupe a submitted profile request (SUBMITTED → DEDUPED) */
  dedupeProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Link a triaged profile request (TRIAGED → LINKED) */
  linkProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Decline a submitted/triaged profile request (SUBMITTED|TRIAGED → DECLINED) */
  declineProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Close a linked/declined profile request (LINKED|DECLINED → CLOSED) */
  closeProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Expire a draft/submitted/triaged profile request (DRAFT|SUBMITTED|TRIAGED → EXPIRED) */
  expireProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Withdraw a draft/submitted profile request (DRAFT|SUBMITTED → WITHDRAWN) */
  withdrawProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<ProfileRequestResult>>;

  /** Get a profile request by ID */
  getProfileRequest(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
  ): Promise<PortResult<Record<string, unknown> | null>>;

  /** Record a safety verdict */
  recordSafetyVerdict(
    capabilityInput: unknown,
    input: RecordSafetyVerdictInput,
  ): Promise<PortResult<RecordSafetyVerdictResult>>;

  /** Get the latest safety verdict for a run */
  getLatestSafetyVerdict(
    capabilityInput: unknown,
    input: GetLatestSafetyVerdictInput,
  ): Promise<PortResult<Record<string, unknown> | null>>;

  /** Create a profile projection */
  createProfileProjection(
    capabilityInput: unknown,
    input: CreateProfileProjectionInput,
  ): Promise<PortResult<CreateProfileProjectionResult>>;

  /** Update a profile projection */
  updateProfileProjection(
    capabilityInput: unknown,
    input: UpdateProfileProjectionInput,
  ): Promise<PortResult<{ profile_id: string; updated_at: string }>>;

  /** Get the active profile projection (optionally by profile_id) */
  getActiveProfileProjection(
    capabilityInput: unknown,
    input: GetActiveProfileProjectionInput,
  ): Promise<PortResult<Record<string, unknown> | null>>;
}

// ────────────────────────────────────────────────────────────────
// 8. PostgreSQL Implementation
// ────────────────────────────────────────────────────────────────

export interface PublishedF9LifecycleOptions {
  readonly pool: SqlPool;
  readonly authorizer?: TransactionalCapabilityAuthorizer;
}

export function createPublishedF9LifecycleService(
  options: PublishedF9LifecycleOptions,
): PublishedF9LifecycleService {
  const { pool, authorizer } = options;

  async function tx<R>(
    capabilityInput: unknown,
    fn: (client: SqlClient) => Promise<PortResult<R>>,
    input: { scope: AppScope },
    txOptions?: AppTransactionOptions,
  ): Promise<PortResult<R>> {
    const result = await withAppTransaction(
      pool,
      authorizer!,
      capabilityInput,
      txOptions!,
      async (ctx) => fn(ctx.client),
    );
    return result.ok ? result.value : { ok: false, error: result.error };
  }

  return {
    // ─── Capability Directory ──────────────────────────────────

    async publishCapabilityDirectory(capabilityInput, input) {
      const parsed = publishCapabilityDirectoryInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, directory_hash, capabilities } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            publish_capability_directory: Record<string, unknown>;
          }>(
            `select app_data_agent.publish_capability_directory(
            $1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb
          ) as publish_capability_directory`,
            [
              scope.app_id,
              scope.tenant_id,
              scope.environment,
              directory_hash,
              JSON.stringify(capabilities),
            ],
          );
          const row = result.rows[0]?.publish_capability_directory;
          if (!row) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError(
                "EMPTY_RESULT",
                "No result from publish_capability_directory",
              ),
            };
          }
          const parsedResult = publishCapabilityDirectoryResultSchema.safeParse(row);
          if (!parsedResult.success) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError("INVALID_RESPONSE", parsedResult.error.message),
            };
          }
          return { ok: true as const, value: parsedResult.data };
        },
        input,
      );
    },

    async getLatestCapabilityDirectory(capabilityInput, input) {
      const parsed = getLatestCapabilityDirectoryInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            get_latest_capability_directory: Record<string, unknown> | null;
          }>(
            `select app_data_agent.get_latest_capability_directory(
            $1::uuid, $2::uuid, $3::text
          ) as get_latest_capability_directory`,
            [scope.app_id, scope.tenant_id, scope.environment],
          );
          return {
            ok: true as const,
            value: result.rows[0]?.get_latest_capability_directory ?? null,
          };
        },
        input,
      );
    },

    // ─── Eligibility Decision ──────────────────────────────────

    async recordEligibilityDecision(capabilityInput, input) {
      const parsed = recordEligibilityDecisionInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const {
        scope,
        request_id,
        subject_id,
        eligibility_criteria,
        overall_eligible,
        decision,
        decided_by,
        frozen_question_hash,
        expires_at,
      } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            record_eligibility_decision: Record<string, unknown>;
          }>(
            `select app_data_agent.record_eligibility_decision(
            $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::jsonb,
            $7::boolean, $8::text, $9::text, $10::text, $11::timestamptz
          ) as record_eligibility_decision`,
            [
              scope.app_id,
              scope.tenant_id,
              scope.environment,
              request_id,
              subject_id,
              JSON.stringify(eligibility_criteria),
              overall_eligible,
              decision,
              decided_by,
              frozen_question_hash,
              expires_at ?? null,
            ],
          );
          const row = result.rows[0]?.record_eligibility_decision;
          if (!row) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError(
                "EMPTY_RESULT",
                "No result from record_eligibility_decision",
              ),
            };
          }
          const parsedResult = recordEligibilityDecisionResultSchema.safeParse(row);
          if (!parsedResult.success) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError("INVALID_RESPONSE", parsedResult.error.message),
            };
          }
          return { ok: true as const, value: parsedResult.data };
        },
        input,
      );
    },

    async getLatestEligibilityDecision(capabilityInput, input) {
      const parsed = getLatestCapabilityDirectoryInputSchema
        .extend({ subject_id: z.string().min(1), frozen_question_hash: z.string().min(1) })
        .safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, subject_id, frozen_question_hash } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            get_latest_eligibility_decision: Record<string, unknown> | null;
          }>(
            `select app_data_agent.get_latest_eligibility_decision(
            $1::uuid, $2::uuid, $3::text, $4::text, $5::text
          ) as get_latest_eligibility_decision`,
            [scope.app_id, scope.tenant_id, scope.environment, subject_id, frozen_question_hash],
          );
          return {
            ok: true as const,
            value: result.rows[0]?.get_latest_eligibility_decision ?? null,
          };
        },
        input,
      );
    },

    // ─── Profile Request ───────────────────────────────────────

    async createProfileRequest(capabilityInput, input) {
      const parsed = createProfileRequestInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, subject_id, requester, request_type, request_reason } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{ create_profile_request: Record<string, unknown> }>(
            `select app_data_agent.create_profile_request(
            $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text
          ) as create_profile_request`,
            [
              scope.app_id,
              scope.tenant_id,
              scope.environment,
              subject_id,
              requester,
              request_type,
              request_reason ?? null,
            ],
          );
          const row = result.rows[0]?.create_profile_request;
          if (!row) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError(
                "EMPTY_RESULT",
                "No result from create_profile_request",
              ),
            };
          }
          const parsedResult = profileRequestResultSchema.safeParse(row);
          if (!parsedResult.success) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError("INVALID_RESPONSE", parsedResult.error.message),
            };
          }
          return { ok: true as const, value: parsedResult.data };
        },
        input,
      );
    },

    async submitProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "submit_profile_request");
    },

    async triageProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "triage_profile_request");
    },

    async dedupeProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "dedupe_profile_request");
    },

    async linkProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "link_profile_request");
    },

    async declineProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "decline_profile_request");
    },

    async closeProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "close_profile_request");
    },

    async expireProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "expire_profile_request");
    },

    async withdrawProfileRequest(capabilityInput, input) {
      return executeProfileRequestTransition(capabilityInput, input, "withdraw_profile_request");
    },

    async getProfileRequest(capabilityInput, input) {
      const parsed = profileRequestIdInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, request_id } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            get_profile_request: Record<string, unknown> | null;
          }>(
            `select app_data_agent.get_profile_request(
            $1::uuid, $2::uuid, $3::text, $4::uuid
          ) as get_profile_request`,
            [scope.app_id, scope.tenant_id, scope.environment, request_id],
          );
          return { ok: true as const, value: result.rows[0]?.get_profile_request ?? null };
        },
        input,
      );
    },

    // ─── Safety Verdict ────────────────────────────────────────

    async recordSafetyVerdict(capabilityInput, input) {
      const parsed = recordSafetyVerdictInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const {
        scope,
        run_id,
        evidence_id,
        verdict,
        verdict_reason,
        verdict_dimensions,
        determined_by,
        evidence_hash,
        auto_approve,
        ttl_seconds,
      } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{ record_safety_verdict: Record<string, unknown> }>(
            `select app_data_agent.record_safety_verdict(
            $1::uuid, $2::uuid, $3::text,
            $4::uuid, $5::uuid, $6::text, $7::text, $8::jsonb,
            $9::text, $10::text, $11::boolean, $12::integer
          ) as record_safety_verdict`,
            [
              scope.app_id,
              scope.tenant_id,
              scope.environment,
              run_id,
              evidence_id,
              verdict,
              verdict_reason,
              JSON.stringify(verdict_dimensions),
              determined_by,
              evidence_hash,
              auto_approve,
              ttl_seconds,
            ],
          );
          const row = result.rows[0]?.record_safety_verdict;
          if (!row) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError(
                "EMPTY_RESULT",
                "No result from record_safety_verdict",
              ),
            };
          }
          const parsedResult = recordSafetyVerdictResultSchema.safeParse(row);
          if (!parsedResult.success) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError("INVALID_RESPONSE", parsedResult.error.message),
            };
          }
          return { ok: true as const, value: parsedResult.data };
        },
        input,
      );
    },

    async getLatestSafetyVerdict(capabilityInput, input) {
      const parsed = getLatestSafetyVerdictInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, run_id } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            get_latest_safety_verdict: Record<string, unknown> | null;
          }>(
            `select app_data_agent.get_latest_safety_verdict(
            $1::uuid, $2::uuid, $3::text, $4::uuid
          ) as get_latest_safety_verdict`,
            [scope.app_id, scope.tenant_id, scope.environment, run_id],
          );
          return { ok: true as const, value: result.rows[0]?.get_latest_safety_verdict ?? null };
        },
        input,
      );
    },

    // ─── Profile Projection ────────────────────────────────────

    async createProfileProjection(capabilityInput, input) {
      const parsed = createProfileProjectionInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const {
        scope,
        source_release_id,
        profile_name,
        profile_version,
        lowering_rule_set,
        contribution_endpoints,
      } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{ create_profile_projection: Record<string, unknown> }>(
            `select app_data_agent.create_profile_projection(
            $1::uuid, $2::uuid, $3::text,
            $4::uuid, $5::text, $6::text, $7::jsonb, $8::jsonb
          ) as create_profile_projection`,
            [
              scope.app_id,
              scope.tenant_id,
              scope.environment,
              source_release_id,
              profile_name,
              profile_version,
              JSON.stringify(lowering_rule_set),
              JSON.stringify(contribution_endpoints),
            ],
          );
          const row = result.rows[0]?.create_profile_projection;
          if (!row) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError(
                "EMPTY_RESULT",
                "No result from create_profile_projection",
              ),
            };
          }
          const parsedResult = createProfileProjectionResultSchema.safeParse(row);
          if (!parsedResult.success) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError("INVALID_RESPONSE", parsedResult.error.message),
            };
          }
          return { ok: true as const, value: parsedResult.data };
        },
        input,
      );
    },

    async updateProfileProjection(capabilityInput, input) {
      const parsed = updateProfileProjectionInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, profile_id, lowering_rule_set, contribution_endpoints, is_active } =
        parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{ update_profile_projection: Record<string, unknown> }>(
            `select app_data_agent.update_profile_projection(
            $1::uuid, $2::uuid, $3::text, $4::uuid,
            $5::jsonb, $6::jsonb, $7::boolean
          ) as update_profile_projection`,
            [
              scope.app_id,
              scope.tenant_id,
              scope.environment,
              profile_id,
              lowering_rule_set ? JSON.stringify(lowering_rule_set) : null,
              contribution_endpoints ? JSON.stringify(contribution_endpoints) : null,
              is_active ?? null,
            ],
          );
          const row = result.rows[0]?.update_profile_projection;
          if (!row) {
            return {
              ok: false as const,
              error: new PersistenceBoundaryError(
                "EMPTY_RESULT",
                "No result from update_profile_projection",
              ),
            };
          }
          return { ok: true as const, value: row as { profile_id: string; updated_at: string } };
        },
        input,
      );
    },

    async getActiveProfileProjection(capabilityInput, input) {
      const parsed = getActiveProfileProjectionInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
        };
      }
      const { scope, profile_id } = parsed.data;

      return tx(
        capabilityInput,
        async (client) => {
          const result = await client.query<{
            get_active_profile_projection: Record<string, unknown> | null;
          }>(
            `select app_data_agent.get_active_profile_projection(
            $1::uuid, $2::uuid, $3::text, $4::uuid
          ) as get_active_profile_projection`,
            [scope.app_id, scope.tenant_id, scope.environment, profile_id ?? null],
          );
          return {
            ok: true as const,
            value: result.rows[0]?.get_active_profile_projection ?? null,
          };
        },
        input,
      );
    },
  };

  // ─── Helper: Execute a profile request state transition ──────

  async function executeProfileRequestTransition(
    capabilityInput: unknown,
    input: ProfileRequestIdInput,
    rpcName: string,
  ): Promise<PortResult<ProfileRequestResult>> {
    const parsed = profileRequestIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: new PersistenceBoundaryError("INVALID_INPUT", parsed.error.message),
      };
    }
    const { scope, request_id } = parsed.data;

    return tx(
      capabilityInput,
      async (client) => {
        const result = await client.query<Record<string, Record<string, unknown>>>(
          `select app_data_agent.${rpcName}(
          $1::uuid, $2::uuid, $3::text, $4::uuid
        ) as result`,
          [scope.app_id, scope.tenant_id, scope.environment, request_id],
        );
        const row = result.rows[0]?.result;
        if (!row) {
          return {
            ok: false as const,
            error: new PersistenceBoundaryError("EMPTY_RESULT", `No result from ${rpcName}`),
          };
        }
        const parsedResult = profileRequestResultSchema.safeParse(row);
        if (!parsedResult.success) {
          return {
            ok: false as const,
            error: new PersistenceBoundaryError("INVALID_RESPONSE", parsedResult.error.message),
          };
        }
        return { ok: true as const, value: parsedResult.data };
      },
      input,
    );
  }
}
