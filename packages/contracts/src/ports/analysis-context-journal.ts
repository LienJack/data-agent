import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import { sandboxResultRefSchema } from "../artifacts/research/references.js";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "../common/index.js";
import { governedOperatorResultRefSchema } from "./governed-operator-result.js";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const versionIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$/u);

export const analysisContextJournalEventSchema = z.discriminatedUnion("event_type", [
  z.strictObject({
    event_type: z.literal("MODEL_CELL_COMMITTED"),
    cell_id: identifierSchema,
    source_ref: artifactReferenceSchema,
    source_sha256: contentHashSchema,
    timeout_ms: z.number().int().positive().max(30_000),
  }),
  z.strictObject({
    event_type: z.literal("OPERATOR_INTENT_COMMITTED"),
    call_id: identifierSchema,
    operator_id: versionIdentifierSchema,
    program_hash: contentHashSchema,
    request_sha256: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("OPERATOR_RESULT_COMMITTED"),
    governed_result: governedOperatorResultRefSchema,
  }),
  z.strictObject({
    event_type: z.literal("SERVER_BINDING_COMMITTED"),
    binding_id: identifierSchema,
    binding_template_version: z.literal("governed-result-binding@1.0.0"),
    result_symbol: z.string().regex(/^__da_gov_[a-f0-9]{24}$/u),
    result_ref: sandboxResultRefSchema,
    result_sha256: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("PUBLISH_STAGE_CREATED"),
    stage_id: immutableIdSchema,
    stage_hash: contentHashSchema,
    closure_hash: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("CONTEXT_FROZEN"),
    stage_id: immutableIdSchema,
    stage_hash: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("ORACLE_VERIFIED"),
    stage_id: immutableIdSchema,
    oracle_receipt_hash: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("EXPLANATION_BOUND"),
    stage_id: immutableIdSchema,
    explanation_hash: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("AUTHORITY_COMMITTED"),
    stage_id: immutableIdSchema,
    authority_commit_hash: contentHashSchema,
  }),
  z.strictObject({
    event_type: z.literal("CLEANUP_VERIFIED"),
    stage_id: immutableIdSchema,
    residual_sandboxes: z.literal(0),
    residual_egress_sidecars: z.literal(0),
  }),
]);

const analysisContextJournalAppendMaterialSchema = z.strictObject({
  schema_version: z.literal("analysis-context-journal-append@1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  node_id: identifierSchema,
  attempt_id: immutableIdSchema,
  context_generation: z.number().int().positive(),
  worker_fence: z.number().int().positive(),
  expected_prev_seq: z.number().int().nonnegative(),
  expected_prev_entry_hash: contentHashSchema.nullable(),
  runtime_digest: contentHashSchema,
  policy_version: versionIdentifierSchema,
  operator_registry_digest: contentHashSchema,
  event: analysisContextJournalEventSchema,
});

export const analysisContextJournalAppendCommandSchema =
  analysisContextJournalAppendMaterialSchema.extend({ append_hash: contentHashSchema });

export const analysisContextJournalEntrySchema = analysisContextJournalAppendMaterialSchema.extend({
  schema_version: z.literal("analysis-context-journal-entry@1.0.0"),
  append_hash: contentHashSchema,
  seq: z.number().int().positive(),
  prev_entry_hash: contentHashSchema.nullable(),
  entry_hash: contentHashSchema,
  created_at: z.string().datetime({ offset: true }),
});

export type AnalysisContextJournalEvent = z.infer<typeof analysisContextJournalEventSchema>;
export type AnalysisContextJournalAppendCommand = z.infer<
  typeof analysisContextJournalAppendCommandSchema
>;
export type AnalysisContextJournalEntry = z.infer<typeof analysisContextJournalEntrySchema>;

export async function buildAnalysisContextJournalAppend(
  input: z.input<typeof analysisContextJournalAppendMaterialSchema>,
): Promise<AnalysisContextJournalAppendCommand> {
  const material = analysisContextJournalAppendMaterialSchema.parse(input);
  return deepFreeze(
    analysisContextJournalAppendCommandSchema.parse({
      ...material,
      append_hash: await sha256ContentHash({
        hash_domain: "analysis-context-journal-append@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyAnalysisContextJournalAppend(
  input: unknown,
): Promise<AnalysisContextJournalAppendCommand> {
  const command = analysisContextJournalAppendCommandSchema.parse(input);
  const { append_hash: observedHash, ...material } = command;
  const expectedHash = await sha256ContentHash({
    hash_domain: "analysis-context-journal-append@1.0.0",
    value: analysisContextJournalAppendMaterialSchema.parse(material),
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_APPEND_HASH_MISMATCH");
  }
  if (
    (command.expected_prev_seq === 0) !== (command.expected_prev_entry_hash === null)
  ) {
    throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_PREDECESSOR_INVALID");
  }
  return deepFreeze(command);
}

export async function verifyAnalysisContextJournalEntry(
  input: unknown,
): Promise<AnalysisContextJournalEntry> {
  const entry = analysisContextJournalEntrySchema.parse(input);
  await verifyAnalysisContextJournalAppend({
    schema_version: "analysis-context-journal-append@1.0.0",
    scope: entry.scope,
    run_id: entry.run_id,
    principal_id: entry.principal_id,
    node_id: entry.node_id,
    attempt_id: entry.attempt_id,
    context_generation: entry.context_generation,
    worker_fence: entry.worker_fence,
    expected_prev_seq: entry.expected_prev_seq,
    expected_prev_entry_hash: entry.expected_prev_entry_hash,
    runtime_digest: entry.runtime_digest,
    policy_version: entry.policy_version,
    operator_registry_digest: entry.operator_registry_digest,
    event: entry.event,
    append_hash: entry.append_hash,
  });
  const expectedEntryHash = await buildAnalysisContextJournalEntryHash(
    {
      schema_version: "analysis-context-journal-append@1.0.0",
      scope: entry.scope,
      run_id: entry.run_id,
      principal_id: entry.principal_id,
      node_id: entry.node_id,
      attempt_id: entry.attempt_id,
      context_generation: entry.context_generation,
      worker_fence: entry.worker_fence,
      expected_prev_seq: entry.expected_prev_seq,
      expected_prev_entry_hash: entry.expected_prev_entry_hash,
      runtime_digest: entry.runtime_digest,
      policy_version: entry.policy_version,
      operator_registry_digest: entry.operator_registry_digest,
      event: entry.event,
      append_hash: entry.append_hash,
    },
    entry.seq,
    entry.prev_entry_hash,
  );
  if (entry.entry_hash !== expectedEntryHash) {
    throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_ENTRY_HASH_MISMATCH");
  }
  return deepFreeze(entry);
}

export async function buildAnalysisContextJournalEntryHash(
  command: AnalysisContextJournalAppendCommand,
  seq: number,
  prevEntryHash: string | null,
): Promise<`sha256:${string}`> {
  const payload = canonicalizeJson({ command, seq, prev_entry_hash: prevEntryHash });
  const domain = new TextEncoder().encode("analysis-context-journal-entry@1.0.0\0");
  const value = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(domain.byteLength + value.byteLength);
  bytes.set(domain);
  bytes.set(value, domain.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const journalTransitions: Readonly<Record<AnalysisContextJournalEvent["event_type"], readonly AnalysisContextJournalEvent["event_type"][]>> =
  Object.freeze({
    MODEL_CELL_COMMITTED: ["MODEL_CELL_COMMITTED", "OPERATOR_INTENT_COMMITTED", "PUBLISH_STAGE_CREATED"],
    OPERATOR_INTENT_COMMITTED: ["OPERATOR_RESULT_COMMITTED"],
    OPERATOR_RESULT_COMMITTED: ["SERVER_BINDING_COMMITTED"],
    SERVER_BINDING_COMMITTED: ["MODEL_CELL_COMMITTED", "OPERATOR_INTENT_COMMITTED", "PUBLISH_STAGE_CREATED"],
    PUBLISH_STAGE_CREATED: ["CONTEXT_FROZEN"],
    CONTEXT_FROZEN: ["ORACLE_VERIFIED"],
    ORACLE_VERIFIED: ["EXPLANATION_BOUND"],
    EXPLANATION_BOUND: ["AUTHORITY_COMMITTED"],
    AUTHORITY_COMMITTED: ["CLEANUP_VERIFIED"],
    CLEANUP_VERIFIED: [],
  });

export function assertAnalysisContextJournalTransition(
  previous: AnalysisContextJournalEvent["event_type"] | null,
  next: AnalysisContextJournalEvent["event_type"],
): void {
  if (previous === null) {
    if (next !== "MODEL_CELL_COMMITTED") {
      throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_INITIAL_EVENT_INVALID");
    }
    return;
  }
  if (!journalTransitions[previous].includes(next)) {
    throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_TRANSITION_INVALID");
  }
}
