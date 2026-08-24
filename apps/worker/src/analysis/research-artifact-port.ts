import { createHash } from "node:crypto";
import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisProgramPayload,
  type ArtifactReference,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ResearchEnvelopeContentHash,
  type DerivedAnalysisEvidencePayload,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  parseL2ResearchDocumentCandidate,
  type ResearchBriefV3Payload,
  researchArtifactCommitInputSchema,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import {
  type AnalysisContextJournalEntry,
  analysisContextJournalEntrySchema,
  assertAnalysisContextJournalTransition,
  buildAnalysisContextJournalAppend,
  buildGovernedOperatorResultCommit,
  type GovernedOperatorResultRef,
  governedOperatorResultRefSchema,
  type ResearchArtifactAuthorityPort,
  verifyAnalysisContextJournalEntry,
} from "@data-agent/contracts/ports";
import type { ResearchAuthorityCapabilityResolver } from "../runs/research-authority-capabilities.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type { AnalysisArtifactCommitPort, AnalysisCellSourceArtifactPort } from "./executor.js";
import type { AnalysisGovernedResultAuthorityPort } from "./governed-result-bridge.js";

type AnalysisPayload =
  | ResearchBriefV3Payload
  | AnalysisProgramPayload
  | DerivedAnalysisEvidencePayload
  | AnalysisCompletionReceiptPayload;

function rawSha256(content: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

interface AnalysisSystemArtifactAuthority {
  commitAnalysisSystem(
    capabilityInput: unknown,
    command: unknown,
    content: Uint8Array | null,
  ): Promise<
    | { readonly ok: true; readonly created: boolean; readonly reference: ArtifactReference }
    | { readonly ok: false; readonly error_code: string }
  >;
}

export interface AnalysisGovernedResultPersistenceAuthority {
  appendAnalysisContextJournal(
    capabilityInput: unknown,
    command: unknown,
  ): Promise<
    | { readonly ok: true; readonly entry: AnalysisContextJournalEntry }
    | { readonly ok: false; readonly error_code: string }
  >;
  commitGovernedOperatorResult(
    capabilityInput: unknown,
    command: unknown,
    journalCommand: unknown,
    requestContent: Uint8Array,
    content: Uint8Array,
  ): Promise<
    | {
        readonly ok: true;
        readonly created: boolean;
        readonly result: GovernedOperatorResultRef;
        readonly journal_entry: AnalysisContextJournalEntry;
      }
    | { readonly ok: false; readonly error_code: string }
  >;
  readGovernedOperatorResult(
    capabilityInput: unknown,
    result: GovernedOperatorResultRef,
  ): Promise<
    | {
        readonly ok: true;
        readonly result_content: Uint8Array;
        readonly request_content: Uint8Array;
        readonly receipt_payload: Readonly<Record<string, unknown>>;
      }
    | { readonly ok: false; readonly error_code: string }
  >;
  readAnalysisContextJournal(
    capabilityInput: unknown,
    input: {
      readonly scope: GovernedOperatorResultRef["scope"];
      readonly run_id: string;
      readonly node_id: string;
      readonly attempt_id: string;
      readonly context_generation: number;
    },
  ): Promise<
    | { readonly ok: true; readonly entries: readonly AnalysisContextJournalEntry[] }
    | { readonly ok: false; readonly error_code: string }
  >;
}

function schemaVersion(payload: AnalysisPayload): string {
  const tuple = L2_RESEARCH_WIRE_VERSION_MATRIX.find(
    ([artifactType, , protocolVersion]) =>
      artifactType === payload.artifact_type && protocolVersion === payload.protocol_version,
  );
  if (!tuple) throw new TypeError("ANALYSIS_RESEARCH_WIRE_VERSION_UNREGISTERED");
  return tuple[1];
}

async function candidate(input: {
  readonly payload: AnalysisPayload;
  readonly lease: Parameters<AnalysisArtifactCommitPort["commitL2"]>[0]["lease"];
  readonly idempotency_key: string;
  readonly created_at: string;
}) {
  const artifactId = deterministicAnalysisUuid(
    `analysis-l2\0${input.lease.run_id}\0${input.idempotency_key}\0${input.payload.artifact_type}`,
  );
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: artifactId,
      artifact_type: input.payload.artifact_type,
      ...input.lease.scope,
      run_id: input.lease.run_id,
      revision: 1,
      parent_ref: null,
      attempt_id: input.lease.attempt_id,
      producer: { kind: "deterministic", id: "analysis-program-executor@1" },
      input_refs: collectL2ResearchPayloadArtifactReferences(input.payload),
      schema_version: schemaVersion(input.payload),
      semantic_version: "1.0.0",
      policy_version: "analysis-program-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: await sha256ContentHash({ placeholder: artifactId }),
      status: "CANDIDATE",
      created_at: input.created_at,
    },
    payload: input.payload,
  });
  return parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ResearchEnvelopeContentHash(draft),
    },
  });
}

export function createResearchAnalysisArtifactPort(input: {
  readonly authority: ResearchArtifactAuthorityPort & AnalysisSystemArtifactAuthority;
  readonly capabilities: ResearchAuthorityCapabilityResolver;
  readonly now?: () => Date;
}): AnalysisArtifactCommitPort {
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async commitL2(command: Parameters<AnalysisArtifactCommitPort["commitL2"]>[0]) {
      const document = await candidate({
        payload: command.payload,
        lease: command.lease,
        idempotency_key: command.idempotency_key,
        created_at: now().toISOString(),
      });
      const commit = researchArtifactCommitInputSchema.parse({
        schema_version: "1.0.0",
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        principal_id: command.principal_id,
        idempotency_key: command.idempotency_key,
        commit_id: deterministicAnalysisUuid(
          `analysis-l2-commit\0${command.lease.run_id}\0${command.idempotency_key}`,
        ),
        attempt_id: command.lease.attempt_id,
        worker_fence: command.lease.worker_fence,
        candidate: document,
        expected_parent_ref: null,
      });
      const result = await input.authority.commitCurrent(
        input.capabilities.forArtifactType(command.payload.artifact_type),
        commit,
      );
      if (!result.ok) throw new TypeError(result.error.code);
      return result.value.reference;
    },

    async commitSystem(command: Parameters<AnalysisArtifactCommitPort["commitSystem"]>[0]) {
      const result = await input.authority.commitAnalysisSystem(
        input.capabilities.forArtifactType(command.reference.artifact_type),
        {
          schema_version: "1.0.0",
          scope: command.lease.scope,
          run_id: command.lease.run_id,
          principal_id: command.principal_id,
          idempotency_key: command.idempotency_key,
          attempt_id: command.lease.attempt_id,
          worker_fence: command.lease.worker_fence,
          reference: command.reference,
          payload: command.payload as Record<string, unknown>,
        },
        command.content,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      return result.reference;
    },

    async resolveCommitted(
      reference: Parameters<AnalysisArtifactCommitPort["resolveCommitted"]>[0],
    ) {
      const result = await input.authority.readHistorical(
        input.capabilities.forDomain("REPORT_READ"),
        reference,
      );
      if (!result.ok) throw new TypeError(result.error.code);
      return result.value?.document ?? null;
    },
  });
}

type JournalCursor = {
  seq: number;
  entry_hash: `sha256:${string}` | null;
  event_type: AnalysisContextJournalEntry["event"]["event_type"] | null;
  runtime_digest: `sha256:${string}` | null;
  policy_version: string | null;
  operator_registry_digest: `sha256:${string}` | null;
  model_cell_count: number;
  last_entry: AnalysisContextJournalEntry | null;
};

function journalKey(input: {
  readonly lease: Parameters<AnalysisGovernedResultAuthorityPort["commitModelCell"]>[0]["lease"];
  readonly node_id: string;
  readonly context_generation: number;
}) {
  return [
    input.lease.scope.app_id,
    input.lease.scope.tenant_id,
    input.lease.scope.environment,
    input.lease.run_id,
    input.node_id,
    input.lease.attempt_id,
    input.context_generation,
  ].join("\0");
}

async function verifyJournal(
  entries: readonly AnalysisContextJournalEntry[],
): Promise<JournalCursor> {
  let cursor: JournalCursor = {
    seq: 0,
    entry_hash: null,
    event_type: null,
    runtime_digest: null,
    policy_version: null,
    operator_registry_digest: null,
    model_cell_count: 0,
    last_entry: null,
  };
  for (const raw of entries) {
    const entry = await verifyAnalysisContextJournalEntry(raw);
    if (
      entry.seq !== cursor.seq + 1 ||
      entry.prev_entry_hash !== cursor.entry_hash ||
      entry.expected_prev_seq !== cursor.seq ||
      entry.expected_prev_entry_hash !== cursor.entry_hash
    ) {
      throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_HASH_CHAIN_INVALID");
    }
    assertAnalysisContextJournalTransition(cursor.event_type, entry.event.event_type);
    cursor = {
      seq: entry.seq,
      entry_hash: entry.entry_hash as `sha256:${string}`,
      event_type: entry.event.event_type,
      runtime_digest: entry.runtime_digest as `sha256:${string}`,
      policy_version: entry.policy_version,
      operator_registry_digest: entry.operator_registry_digest as `sha256:${string}`,
      model_cell_count:
        cursor.model_cell_count + (entry.event.event_type === "MODEL_CELL_COMMITTED" ? 1 : 0),
      last_entry: entry,
    };
  }
  return cursor;
}

export function createResearchGovernedResultAuthorityPort(input: {
  readonly authority: AnalysisGovernedResultPersistenceAuthority;
  readonly capabilities: ResearchAuthorityCapabilityResolver;
  readonly source_artifacts: AnalysisCellSourceArtifactPort;
}): AnalysisGovernedResultAuthorityPort {
  const cursors = new Map<string, JournalCursor>();

  const cursorFor = async (identity: {
    readonly lease: Parameters<AnalysisGovernedResultAuthorityPort["commitModelCell"]>[0]["lease"];
    readonly node_id: string;
    readonly context_generation: number;
  }) => {
    const key = journalKey(identity);
    const current = cursors.get(key);
    if (current) return { key, cursor: current };
    const loaded = await input.authority.readAnalysisContextJournal(
      input.capabilities.forArtifactType("SandboxResult"),
      {
        scope: identity.lease.scope,
        run_id: identity.lease.run_id,
        node_id: identity.node_id,
        attempt_id: identity.lease.attempt_id,
        context_generation: identity.context_generation,
      },
    );
    if (!loaded.ok) throw new TypeError(loaded.error_code);
    const cursor = await verifyJournal(loaded.entries);
    cursors.set(key, cursor);
    return { key, cursor };
  };

  const append = async (appendInput: {
    readonly lease: Parameters<AnalysisGovernedResultAuthorityPort["commitModelCell"]>[0]["lease"];
    readonly node_id: string;
    readonly context_generation: number;
    readonly runtime_digest?: `sha256:${string}`;
    readonly policy_version?: string;
    readonly operator_registry_digest?: `sha256:${string}`;
    readonly event: Parameters<typeof buildAnalysisContextJournalAppend>[0]["event"];
  }) => {
    const { key, cursor } = await cursorFor(appendInput);
    const runtimeDigest = appendInput.runtime_digest ?? cursor.runtime_digest;
    const policyVersion = appendInput.policy_version ?? cursor.policy_version;
    const registryDigest = appendInput.operator_registry_digest ?? cursor.operator_registry_digest;
    if (!runtimeDigest || !policyVersion || !registryDigest) {
      throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_RUNTIME_IDENTITY_REQUIRED");
    }
    if (
      cursor.last_entry?.event.event_type === appendInput.event.event_type &&
      canonicalizeJson(cursor.last_entry.event) === canonicalizeJson(appendInput.event)
    ) {
      return cursor.last_entry;
    }
    assertAnalysisContextJournalTransition(cursor.event_type, appendInput.event.event_type);
    const command = await buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope: appendInput.lease.scope,
      run_id: appendInput.lease.run_id,
      principal_id: appendInput.lease.principal_id,
      node_id: appendInput.node_id,
      attempt_id: appendInput.lease.attempt_id,
      context_generation: appendInput.context_generation,
      worker_fence: appendInput.lease.worker_fence,
      expected_prev_seq: cursor.seq,
      expected_prev_entry_hash: cursor.entry_hash,
      runtime_digest: runtimeDigest,
      policy_version: policyVersion,
      operator_registry_digest: registryDigest,
      event: appendInput.event,
    });
    const result = await input.authority.appendAnalysisContextJournal(
      input.capabilities.forArtifactType("SandboxResult"),
      command,
    );
    if (!result.ok) throw new TypeError(result.error_code);
    const entry = analysisContextJournalEntrySchema.parse(result.entry);
    const updated: JournalCursor = {
      seq: entry.seq,
      entry_hash: entry.entry_hash as `sha256:${string}`,
      event_type: entry.event.event_type,
      runtime_digest: entry.runtime_digest as `sha256:${string}`,
      policy_version: entry.policy_version,
      operator_registry_digest: entry.operator_registry_digest as `sha256:${string}`,
      model_cell_count:
        cursor.model_cell_count + (entry.event.event_type === "MODEL_CELL_COMMITTED" ? 1 : 0),
      last_entry: entry,
    };
    if (
      entry.seq !== cursor.seq + 1 ||
      entry.prev_entry_hash !== cursor.entry_hash ||
      entry.expected_prev_seq !== cursor.seq ||
      entry.expected_prev_entry_hash !== cursor.entry_hash
    ) {
      throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_APPEND_CORRELATION_INVALID");
    }
    cursors.set(key, updated);
    return entry;
  };

  const loadVerifiedResult = async (resultRef: GovernedOperatorResultRef) => {
    const result = await input.authority.readGovernedOperatorResult(
      input.capabilities.forArtifactType("SandboxResult"),
      resultRef,
    );
    if (!result.ok) throw new TypeError(result.error_code);
    let decodedResult: unknown;
    try {
      decodedResult = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(result.result_content),
      ) as unknown;
    } catch {
      throw new TypeError("GOVERNED_OPERATOR_RESULT_CONTENT_HASH_MISMATCH");
    }
    if (
      result.result_content.byteLength !== resultRef.result_bytes ||
      rawSha256(result.request_content) !== resultRef.request_sha256 ||
      (await sha256ContentHash(decodedResult)) !== resultRef.result_sha256 ||
      (await sha256ContentHash(result.receipt_payload)) !== resultRef.receipt_ref.content_hash
    ) {
      throw new TypeError("GOVERNED_OPERATOR_RESULT_CONTENT_HASH_MISMATCH");
    }
    return Object.freeze({
      result_content: result.result_content.slice(),
      request_content: result.request_content.slice(),
      receipt_payload: result.receipt_payload,
    });
  };

  return Object.freeze({
    async commitModelCell(
      command: Parameters<AnalysisGovernedResultAuthorityPort["commitModelCell"]>[0],
    ) {
      const { cursor } = await cursorFor(command);
      if (
        cursor.last_entry?.event.event_type === "MODEL_CELL_COMMITTED" &&
        cursor.last_entry.event.cell_id === command.cell_id &&
        cursor.last_entry.event.source_sha256 === command.source_sha256
      ) {
        return {
          journal_seq: cursor.last_entry.seq,
          source_ref: cursor.last_entry.event.source_ref,
        };
      }
      if (cursor.model_cell_count > 31) {
        throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_MODEL_CELL_LIMIT_EXCEEDED");
      }
      const sourceRef = await input.source_artifacts.commit({
        lease: command.lease,
        analysis_program: command.analysis_program,
        analysis_program_ref: command.analysis_program_ref,
        node_id: command.node_id,
        generation_attempt: cursor.model_cell_count,
        provider_invocation_ref: command.provider_invocation_ref,
        source_sha256: command.source_sha256,
        source_text: command.source,
      });
      const entry = await append({
        ...command,
        event: {
          event_type: "MODEL_CELL_COMMITTED",
          cell_id: command.cell_id,
          source_ref: sourceRef,
          source_sha256: command.source_sha256,
          timeout_ms: command.timeout_ms,
        },
      });
      return { journal_seq: entry.seq, source_ref: sourceRef };
    },
    async commitOperatorIntent(
      command: Parameters<AnalysisGovernedResultAuthorityPort["commitOperatorIntent"]>[0],
    ) {
      const entry = await append({
        ...command,
        event: {
          event_type: "OPERATOR_INTENT_COMMITTED",
          call_id: command.call_id,
          operator_id: command.operator_id,
          program_hash: command.program_hash,
          request_sha256: command.request_sha256,
        },
      });
      return { journal_seq: entry.seq };
    },
    async commit(command: Parameters<AnalysisGovernedResultAuthorityPort["commit"]>[0]) {
      const { key, cursor } = await cursorFor(command);
      if (cursor.last_entry?.event.event_type === "OPERATOR_RESULT_COMMITTED") {
        const existingResult = cursor.last_entry.event.governed_result;
        if (
          existingResult.call_id === command.call_id &&
          existingResult.operator_id === command.operator_id &&
          existingResult.program_hash === command.program_hash &&
          existingResult.request_sha256 === command.request_sha256 &&
          existingResult.result_sha256 === command.result_sha256
        ) {
          return existingResult;
        }
      }
      assertAnalysisContextJournalTransition(cursor.event_type, "OPERATOR_RESULT_COMMITTED");
      const receiptHash = await sha256ContentHash(command.receipt_payload);
      const resultRef = {
        artifact_id: deterministicAnalysisUuid(
          `governed-operator-result\0${command.lease.run_id}\0${command.node_id}\0${command.call_id}\0${command.operator_id}\0${command.program_hash}`,
        ),
        artifact_type: "SandboxResult" as const,
        ...command.lease.scope,
        run_id: command.lease.run_id,
        revision: 1,
        content_hash: command.result_sha256,
      };
      const receiptRef = {
        artifact_id: deterministicAnalysisUuid(
          `governed-operator-result-receipt\0${command.lease.run_id}\0${command.node_id}\0${command.call_id}\0${command.operator_id}\0${command.program_hash}`,
        ),
        artifact_type: "SandboxExecutionReceipt" as const,
        ...command.lease.scope,
        run_id: command.lease.run_id,
        revision: 1,
        content_hash: receiptHash,
      };
      const governedResult = governedOperatorResultRefSchema.parse({
        schema_version: "governed-operator-result-ref@1.0.0",
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        node_id: command.node_id,
        attempt_id: command.lease.attempt_id,
        context_generation: command.context_generation,
        call_id: command.call_id,
        operator_id: command.operator_id,
        program_hash: command.program_hash,
        request_sha256: command.request_sha256,
        result_artifact_ref: resultRef,
        result_sha256: command.result_sha256,
        result_bytes: command.result_content.byteLength,
        shape: command.shape,
        receipt_ref: receiptRef,
        worker_fence: command.lease.worker_fence,
      });
      const commit = await buildGovernedOperatorResultCommit({
        schema_version: "governed-operator-result-commit@1.0.0",
        principal_id: command.lease.principal_id,
        result: governedResult,
        idempotency_key: `operator-result:${command.program_hash}:${command.node_id}:${command.call_id}`,
        operator_registry_digest: command.operator_registry_digest,
        result_receipt_payload: command.receipt_payload,
        result_receipt_hash: receiptHash,
      });
      if (!cursor.runtime_digest || !cursor.policy_version || !cursor.operator_registry_digest) {
        throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_RUNTIME_IDENTITY_REQUIRED");
      }
      const journal = await buildAnalysisContextJournalAppend({
        schema_version: "analysis-context-journal-append@1.0.0",
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        principal_id: command.lease.principal_id,
        node_id: command.node_id,
        attempt_id: command.lease.attempt_id,
        context_generation: command.context_generation,
        worker_fence: command.lease.worker_fence,
        expected_prev_seq: cursor.seq,
        expected_prev_entry_hash: cursor.entry_hash,
        runtime_digest: cursor.runtime_digest,
        policy_version: cursor.policy_version,
        operator_registry_digest: cursor.operator_registry_digest,
        event: { event_type: "OPERATOR_RESULT_COMMITTED", governed_result: governedResult },
      });
      const result = await input.authority.commitGovernedOperatorResult(
        input.capabilities.forArtifactType("SandboxResult"),
        commit,
        journal,
        command.request_content,
        command.result_content,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      const entry = analysisContextJournalEntrySchema.parse(result.journal_entry);
      if (
        canonicalizeJson(result.result) !== canonicalizeJson(governedResult) ||
        entry.seq !== cursor.seq + 1 ||
        entry.prev_entry_hash !== cursor.entry_hash
      ) {
        throw new TypeError("GOVERNED_OPERATOR_RESULT_AUTHORITY_SUBSTITUTION");
      }
      cursors.set(key, {
        ...cursor,
        seq: entry.seq,
        entry_hash: entry.entry_hash as `sha256:${string}`,
        event_type: "OPERATOR_RESULT_COMMITTED",
        last_entry: entry,
      });
      return governedOperatorResultRefSchema.parse(result.result);
    },
    async load(command: Parameters<AnalysisGovernedResultAuthorityPort["load"]>[0]) {
      return loadVerifiedResult(command.result);
    },
    async commitBinding(
      command: Parameters<AnalysisGovernedResultAuthorityPort["commitBinding"]>[0],
    ) {
      const entry = await append({
        lease: command.lease,
        node_id: command.result.node_id,
        context_generation: command.result.context_generation,
        event: {
          event_type: "SERVER_BINDING_COMMITTED",
          binding_id: command.binding_id,
          binding_template_version: command.binding_template_version,
          result_symbol: command.result_symbol,
          result_ref: command.result.result_artifact_ref,
          result_sha256: command.result_sha256,
        },
      });
      return { journal_seq: entry.seq };
    },
    async replay(command: Parameters<AnalysisGovernedResultAuthorityPort["replay"]>[0]) {
      const loaded = await input.authority.readAnalysisContextJournal(
        input.capabilities.forArtifactType("SandboxResult"),
        {
          scope: command.lease.scope,
          run_id: command.lease.run_id,
          node_id: command.node_id,
          attempt_id: command.lease.attempt_id,
          context_generation: command.context_generation,
        },
      );
      if (!loaded.ok) throw new TypeError(loaded.error_code);
      await verifyJournal(loaded.entries);
      const results = new Map<string, GovernedOperatorResultRef>();
      const pendingResults = new Map<string, GovernedOperatorResultRef>();
      const actions = [];
      const recoveredResults = [];
      for (const entry of loaded.entries) {
        if (entry.event.event_type === "MODEL_CELL_COMMITTED") {
          const source = await input.source_artifacts.load({
            lease: command.lease,
            node_id: command.node_id,
            context_generation: command.context_generation,
            journal_seq: entry.seq,
            source_ref: entry.event.source_ref,
          });
          if (source.source_sha256 !== entry.event.source_sha256) {
            throw new TypeError("ANALYSIS_CONTEXT_MODEL_CELL_SOURCE_HASH_MISMATCH");
          }
          actions.push(
            Object.freeze({
              action_type: "MODEL_CELL" as const,
              journal_seq: entry.seq,
              cell_id: entry.event.cell_id,
              source: source.source,
              source_sha256: source.source_sha256,
              timeout_ms: entry.event.timeout_ms,
            }),
          );
          continue;
        }
        if (entry.event.event_type === "OPERATOR_RESULT_COMMITTED") {
          results.set(
            entry.event.governed_result.result_artifact_ref.artifact_id,
            entry.event.governed_result,
          );
          pendingResults.set(
            entry.event.governed_result.result_artifact_ref.artifact_id,
            entry.event.governed_result,
          );
          continue;
        }
        if (entry.event.event_type !== "SERVER_BINDING_COMMITTED") continue;
        const governed = results.get(entry.event.result_ref.artifact_id);
        if (
          !governed ||
          governed.result_sha256 !== entry.event.result_sha256 ||
          governed.result_artifact_ref.content_hash !== entry.event.result_ref.content_hash
        ) {
          throw new TypeError("ANALYSIS_CONTEXT_SERVER_BINDING_RESULT_MISSING");
        }
        pendingResults.delete(entry.event.result_ref.artifact_id);
        const persisted = await loadVerifiedResult(governed);
        actions.push(
          Object.freeze({
            action_type: "SERVER_BINDING" as const,
            journal_seq: entry.seq,
            governed_result: governed,
            authoritative_content: persisted.result_content.slice(),
            expected_symbol: entry.event.result_symbol,
            expected_binding_id: entry.event.binding_id,
          }),
        );
        recoveredResults.push(
          Object.freeze({
            result: governed,
            request_content: persisted.request_content.slice(),
            receipt_payload: persisted.receipt_payload,
            binding: {
              binding_id: entry.event.binding_id,
              result_symbol: entry.event.result_symbol,
              result_sha256: entry.event.result_sha256 as `sha256:${string}`,
              journal_seq: entry.seq,
            },
          }),
        );
      }
      return Object.freeze({
        actions: Object.freeze(actions),
        pending_results: Object.freeze([...pendingResults.values()]),
        recovered_results: Object.freeze(recoveredResults),
      });
    },
  });
}

export const researchAnalysisArtifactPortInternals = Object.freeze({
  deterministicAnalysisUuid,
  verifyJournal,
});
