import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { effectiveRunConfigReferenceSchema } from "./effective-config.js";
import { snapshotReferenceSchema } from "./runtime.js";

const positiveVersionSchema = z.number().int().positive().safe();
const workerFenceSchema = z.number().int().positive().safe();
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const interruptionOptionSchema = z.strictObject({
  option_id: versionIdentifierSchema,
  label: z.string().trim().min(1).max(256),
});

const canonicalInterruptionOptionsSchema = z
  .array(interruptionOptionSchema)
  .max(32)
  .superRefine((options, context) => {
    options.forEach((option, index) => {
      if (index > 0 && (options[index - 1]?.option_id ?? "") >= option.option_id) {
        context.addIssue({
          code: "custom",
          message: "Interruption options must be unique and sorted by option_id.",
          path: [index, "option_id"],
        });
      }
    });
  });

const runInterruptionDraftSchema = z
  .strictObject({
    schema_version: z.literal("run-interruption@1.0.0"),
    scope: appScopeSchema,
    interruption_id: immutableIdSchema,
    run_id: immutableIdSchema,
    kind: z.literal("CLARIFICATION"),
    question: z.string().trim().min(1).max(4_000),
    options: canonicalInterruptionOptionsSchema,
    checkpoint_ref: snapshotReferenceSchema,
    worker_fence: workerFenceSchema,
    state: z.enum(["OPEN", "ANSWERED"]),
    version: positiveVersionSchema,
    opened_at: timestampSchema,
    answered_at: timestampSchema.nullable(),
  })
  .superRefine((interruption, context) => {
    const open = interruption.state === "OPEN";
    if (
      (open && (interruption.version !== 1 || interruption.answered_at !== null)) ||
      (!open && (interruption.version !== 2 || interruption.answered_at === null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Interruption state, version, and answered_at do not form a valid state.",
      });
    }
  });

export const runInterruptionSchema = runInterruptionDraftSchema.safeExtend({
  interruption_hash: contentHashSchema,
});

export async function buildRunInterruption(input: unknown) {
  const draft = runInterruptionDraftSchema.parse(input);
  return deepFreeze(
    runInterruptionSchema.parse({
      ...draft,
      interruption_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyRunInterruption(input: unknown) {
  const interruption = runInterruptionSchema.parse(input);
  const { interruption_hash: _hash, ...draft } = interruption;
  if ((await sha256ContentHash(draft)) !== interruption.interruption_hash) {
    throw new TypeError("RUN_INTERRUPTION_HASH_MISMATCH");
  }
  return interruption;
}

const runInterruptionOpenCommandDraftSchema = z.strictObject({
  schema_version: z.literal("run-interruption-open-command@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: idempotencyKeySchema,
  actor_principal_id: immutableIdSchema,
  interruption: runInterruptionSchema,
});

export const runInterruptionOpenCommandSchema = runInterruptionOpenCommandDraftSchema.extend({
  command_hash: contentHashSchema,
});

export async function buildRunInterruptionOpenCommand(input: unknown) {
  const draft = runInterruptionOpenCommandDraftSchema.parse(input);
  await verifyRunInterruption(draft.interruption);
  return deepFreeze(
    runInterruptionOpenCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyRunInterruptionOpenCommand(input: unknown) {
  const command = runInterruptionOpenCommandSchema.parse(input);
  await verifyRunInterruption(command.interruption);
  const { command_hash: _hash, ...draft } = command;
  if ((await sha256ContentHash(draft)) !== command.command_hash) {
    throw new TypeError("RUN_INTERRUPTION_OPEN_COMMAND_HASH_MISMATCH");
  }
  return command;
}

export const interruptionResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("FREE_TEXT"),
    text: z.string().trim().min(1).max(4_000),
  }),
  z.strictObject({
    kind: z.literal("OPTION"),
    option_id: versionIdentifierSchema,
  }),
]);

const interruptionReplyCommandDraftSchema = z.strictObject({
  schema_version: z.literal("interruption-reply-command@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: idempotencyKeySchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  interruption_id: immutableIdSchema,
  expected_version: positiveVersionSchema,
  expected_worker_fence: workerFenceSchema,
  actor_principal_id: immutableIdSchema,
  response: interruptionResponseSchema,
  submitted_at: timestampSchema,
});

export const interruptionReplyCommandSchema = interruptionReplyCommandDraftSchema.extend({
  command_hash: contentHashSchema,
});

export async function buildInterruptionReplyCommand(input: unknown) {
  const draft = interruptionReplyCommandDraftSchema.parse(input);
  return deepFreeze(
    interruptionReplyCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyInterruptionReplyCommand(input: unknown) {
  const command = interruptionReplyCommandSchema.parse(input);
  const { command_hash: _hash, ...draft } = command;
  if ((await sha256ContentHash(draft)) !== command.command_hash) {
    throw new TypeError("INTERRUPTION_REPLY_COMMAND_HASH_MISMATCH");
  }
  return command;
}

export const effectiveConfigRevalidationReferenceSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
  config_ref: effectiveRunConfigReferenceSchema,
  revalidated_at: timestampSchema,
});

const sessionBranchDraftSchema = z.strictObject({
  schema_version: z.literal("session-branch@1.0.0"),
  scope: appScopeSchema,
  branch_id: immutableIdSchema,
  parent_conversation_id: immutableIdSchema,
  parent_run_id: immutableIdSchema,
  parent_event_sequence: positiveVersionSchema,
  parent_checkpoint_ref: snapshotReferenceSchema,
  effective_config_revalidation: effectiveConfigRevalidationReferenceSchema,
  child_conversation_id: immutableIdSchema,
  created_by_principal_id: immutableIdSchema,
  created_at: timestampSchema,
});

export const sessionBranchSchema = sessionBranchDraftSchema.extend({
  branch_hash: contentHashSchema,
});

export async function buildSessionBranch(input: unknown) {
  const draft = sessionBranchDraftSchema.parse(input);
  return deepFreeze(
    sessionBranchSchema.parse({ ...draft, branch_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifySessionBranch(input: unknown) {
  const branch = sessionBranchSchema.parse(input);
  const { branch_hash: _hash, ...draft } = branch;
  if ((await sha256ContentHash(draft)) !== branch.branch_hash) {
    throw new TypeError("SESSION_BRANCH_HASH_MISMATCH");
  }
  return branch;
}

const sessionBranchCommandDraftSchema = z.strictObject({
  schema_version: z.literal("session-branch-command@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: idempotencyKeySchema,
  branch: sessionBranchSchema,
});

export const sessionBranchCommandSchema = sessionBranchCommandDraftSchema.extend({
  command_hash: contentHashSchema,
});

export async function buildSessionBranchCommand(input: unknown) {
  const draft = sessionBranchCommandDraftSchema.parse(input);
  await verifySessionBranch(draft.branch);
  return deepFreeze(
    sessionBranchCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySessionBranchCommand(input: unknown) {
  const command = sessionBranchCommandSchema.parse(input);
  await verifySessionBranch(command.branch);
  const { command_hash: _hash, ...draft } = command;
  if ((await sha256ContentHash(draft)) !== command.command_hash) {
    throw new TypeError("SESSION_BRANCH_COMMAND_HASH_MISMATCH");
  }
  return command;
}

const recoveryDispositionSchema = z.enum(["COMMITTED", "REPLAYED"]);
const runInterruptionOpenReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("run-interruption-open-receipt@1.0.0"),
  disposition: recoveryDispositionSchema,
  command_hash: contentHashSchema,
  interruption: runInterruptionSchema,
  committed_at: timestampSchema,
});
export const runInterruptionOpenReceiptSchema = runInterruptionOpenReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

const interruptionReplyReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("interruption-reply-receipt@1.0.0"),
  disposition: recoveryDispositionSchema,
  command_hash: contentHashSchema,
  interruption: runInterruptionSchema,
  reply_id: immutableIdSchema,
  response_hash: contentHashSchema,
  resume: z.strictObject({
    command_id: immutableIdSchema,
    event_id: immutableIdSchema,
    outbox_id: immutableIdSchema,
    projection_version: positiveVersionSchema,
  }),
  committed_at: timestampSchema,
});
export const interruptionReplyReceiptSchema = interruptionReplyReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

const sessionBranchReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("session-branch-receipt@1.0.0"),
  disposition: recoveryDispositionSchema,
  command_hash: contentHashSchema,
  branch: sessionBranchSchema,
  committed_at: timestampSchema,
});
export const sessionBranchReceiptSchema = sessionBranchReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

async function buildReceipt<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  input: unknown,
) {
  const draft = schema.parse(input);
  return deepFreeze({ ...draft, receipt_hash: await sha256ContentHash(draft) });
}

async function verifyReceipt<T extends Record<string, unknown> & { receipt_hash: string }>(
  schema: z.ZodType<T>,
  input: unknown,
  errorCode: string,
) {
  const receipt = schema.parse(input);
  const { receipt_hash: _hash, ...draft } = receipt;
  if ((await sha256ContentHash(draft)) !== receipt.receipt_hash) throw new TypeError(errorCode);
  return receipt;
}

export async function buildRunInterruptionOpenReceipt(input: unknown) {
  const draft = runInterruptionOpenReceiptDraftSchema.parse(input);
  await verifyRunInterruption(draft.interruption);
  return runInterruptionOpenReceiptSchema.parse(
    await buildReceipt(runInterruptionOpenReceiptDraftSchema, draft),
  );
}

export async function verifyRunInterruptionOpenReceipt(input: unknown) {
  const receipt = await verifyReceipt(
    runInterruptionOpenReceiptSchema,
    input,
    "RUN_INTERRUPTION_OPEN_RECEIPT_HASH_MISMATCH",
  );
  await verifyRunInterruption(receipt.interruption);
  return receipt;
}

export async function buildInterruptionReplyReceipt(input: unknown) {
  const draft = interruptionReplyReceiptDraftSchema.parse(input);
  await verifyRunInterruption(draft.interruption);
  return interruptionReplyReceiptSchema.parse(
    await buildReceipt(interruptionReplyReceiptDraftSchema, draft),
  );
}

export async function verifyInterruptionReplyReceipt(input: unknown) {
  const receipt = await verifyReceipt(
    interruptionReplyReceiptSchema,
    input,
    "INTERRUPTION_REPLY_RECEIPT_HASH_MISMATCH",
  );
  await verifyRunInterruption(receipt.interruption);
  return receipt;
}

export async function buildSessionBranchReceipt(input: unknown) {
  const draft = sessionBranchReceiptDraftSchema.parse(input);
  await verifySessionBranch(draft.branch);
  return sessionBranchReceiptSchema.parse(
    await buildReceipt(sessionBranchReceiptDraftSchema, draft),
  );
}

export async function verifySessionBranchReceipt(input: unknown) {
  const receipt = await verifyReceipt(
    sessionBranchReceiptSchema,
    input,
    "SESSION_BRANCH_RECEIPT_HASH_MISMATCH",
  );
  await verifySessionBranch(receipt.branch);
  return receipt;
}

export type RunInterruption = z.infer<typeof runInterruptionSchema>;
export type RunInterruptionOpenCommand = z.infer<typeof runInterruptionOpenCommandSchema>;
export type InterruptionReplyCommand = z.infer<typeof interruptionReplyCommandSchema>;
export type InterruptionReplyReceipt = z.infer<typeof interruptionReplyReceiptSchema>;
export type SessionBranch = z.infer<typeof sessionBranchSchema>;
export type SessionBranchCommand = z.infer<typeof sessionBranchCommandSchema>;
export type SessionBranchReceipt = z.infer<typeof sessionBranchReceiptSchema>;
