import { createHash } from "node:crypto";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type {
  AnalysisAgentFinalResponse,
  AnalysisOperatorFinalizationResult,
  GovernedOperatorResultRef,
} from "@data-agent/contracts/ports";
import {
  type AnalysisAuthorityCommit,
  type AnalysisAuthorityCommitReceipt,
  type AnalysisContextJournalEntry,
  type AnalysisPublicationV2Command,
  type AnalysisPublicationV2Receipt,
  type AnalysisResultStage,
  type AnalysisResultStageCommand,
  type AnalysisResultStageExecutionSnapshot,
  analysisContextJournalAppendCommandSchema,
  assertAnalysisContextJournalTransition,
  buildAnalysisContextJournalAppend,
  buildAnalysisResultStageCommand,
  verifyAnalysisContextJournalEntry,
  verifyAnalysisResultStageCommand,
} from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import type { ResearchAuthorityCapabilityResolver } from "../runs/research-authority-capabilities.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type { AnalysisResultStagedClosure } from "./result-publisher.js";

type Identity = {
  readonly lease: RunWorkLease;
  readonly node_id: string;
  readonly context_generation: number;
  readonly runtime_digest: `sha256:${string}`;
  readonly policy_version: string;
  readonly operator_registry_digest: `sha256:${string}`;
};

type RecoveryIdentity = Pick<Identity, "lease" | "node_id" | "context_generation">;

const ANALYSIS_RESULT_STAGE_RETENTION_MS = 15 * 60 * 1_000;

export interface RecoveredAnalysisResultStage {
  readonly identity: Omit<Identity, "lease" | "node_id" | "context_generation">;
  readonly stage: AnalysisResultStage;
  readonly loaded: Awaited<ReturnType<AnalysisLifecycleAuthorityPort["load"]>>;
  readonly journal_phase: AnalysisContextJournalEntry["event"]["event_type"];
}

export interface AnalysisLifecyclePersistenceAuthority {
  readAnalysisContextJournal(
    capabilityInput: unknown,
    input: {
      readonly scope: RunWorkLease["scope"];
      readonly run_id: string;
      readonly node_id: string;
      readonly attempt_id: string;
      readonly context_generation: number;
    },
  ): Promise<
    | { readonly ok: true; readonly entries: readonly AnalysisContextJournalEntry[] }
    | { readonly ok: false; readonly error_code: string }
  >;
  appendAnalysisContextJournal(
    capabilityInput: unknown,
    command: unknown,
  ): Promise<
    | { readonly ok: true; readonly entry: AnalysisContextJournalEntry }
    | { readonly ok: false; readonly error_code: string }
  >;
  stageAnalysisResult(
    capabilityInput: unknown,
    command: unknown,
    journalCommand: unknown,
    contents: readonly Uint8Array[],
  ): Promise<
    | {
        readonly ok: true;
        readonly stage: AnalysisResultStage;
        readonly journal_entry: AnalysisContextJournalEntry;
      }
    | { readonly ok: false; readonly error_code: string }
  >;
  commitAnalysisAuthority(
    capabilityInput: unknown,
    command: unknown,
    journalCommand: unknown,
  ): Promise<
    | {
        readonly ok: true;
        readonly receipt: AnalysisAuthorityCommitReceipt;
        readonly journal_entry: AnalysisContextJournalEntry;
      }
    | { readonly ok: false; readonly error_code: string }
  >;
  commitAnalysisPublication(
    capabilityInput: unknown,
    command: AnalysisPublicationV2Command,
  ): Promise<
    | { readonly ok: true; readonly receipt: AnalysisPublicationV2Receipt }
    | { readonly ok: false; readonly error_code: string }
  >;
  readAnalysisResultStage(
    capabilityInput: unknown,
    input: Identity & { readonly stage: AnalysisResultStage },
  ): Promise<
    | {
        readonly ok: true;
        readonly stage_command: AnalysisResultStageCommand;
        readonly oracle_record: null | {
          readonly receipt_payload: Readonly<Record<string, unknown>>;
          readonly receipt_hash: `sha256:${string}`;
        };
        readonly explanation_record: null | {
          readonly explanation: AnalysisAgentFinalResponse;
          readonly explanation_hash: `sha256:${string}`;
          readonly provider_invocation_ref: {
            readonly resource_id: string;
            readonly resource_revision: 1;
            readonly resource_hash: `sha256:${string}`;
          };
        };
        readonly artifacts: readonly {
          readonly artifact_name: string;
          readonly artifact_kind: "RESULT" | "TABLE" | "CHART";
          readonly media_type: "application/json";
          readonly content_sha256: `sha256:${string}`;
          readonly bytes: number;
          readonly content: Uint8Array;
        }[];
      }
    | { readonly ok: false; readonly error_code: string }
  >;
  recordAnalysisStageOracle(
    capabilityInput: unknown,
    command: unknown,
    journalCommand: unknown,
  ): Promise<
    | { readonly ok: true; readonly journal_entry: AnalysisContextJournalEntry }
    | { readonly ok: false; readonly error_code: string }
  >;
  recordAnalysisStageExplanation(
    capabilityInput: unknown,
    command: unknown,
    journalCommand: unknown,
  ): Promise<
    | { readonly ok: true; readonly journal_entry: AnalysisContextJournalEntry }
    | { readonly ok: false; readonly error_code: string }
  >;
}

export interface AnalysisLifecycleAuthorityPort {
  recoverStage(input: RecoveryIdentity): Promise<RecoveredAnalysisResultStage | null>;
  stage(
    input: Identity & {
      readonly closure: AnalysisResultStagedClosure;
      readonly governed_results: readonly GovernedOperatorResultRef[];
      readonly operator_finalization: AnalysisOperatorFinalizationResult;
      readonly execution_snapshot: AnalysisResultStageExecutionSnapshot;
    },
  ): Promise<AnalysisResultStage>;
  load(input: Identity & { readonly stage: AnalysisResultStage }): Promise<
    AnalysisResultStagedClosure & {
      readonly governed_operator_results: readonly GovernedOperatorResultRef[];
      readonly operator_finalization: AnalysisOperatorFinalizationResult;
      readonly execution_snapshot: AnalysisResultStageExecutionSnapshot;
      readonly stage_expires_at: string;
      readonly oracle_record: null | {
        readonly receipt_payload: Readonly<Record<string, unknown>>;
        readonly receipt_hash: `sha256:${string}`;
      };
      readonly explanation_record: null | {
        readonly explanation: AnalysisAgentFinalResponse;
        readonly explanation_hash: `sha256:${string}`;
        readonly provider_invocation_ref: {
          readonly resource_id: string;
          readonly resource_revision: 1;
          readonly resource_hash: `sha256:${string}`;
        };
      };
    }
  >;
  freeze(input: Identity & { readonly stage: AnalysisResultStage }): Promise<void>;
  recordOracle(
    input: Identity & {
      readonly stage: AnalysisResultStage;
      readonly oracle_receipt: unknown;
    },
  ): Promise<`sha256:${string}`>;
  recordExplanation(
    input: Identity & {
      readonly stage: AnalysisResultStage;
      readonly explanation: AnalysisAgentFinalResponse;
      readonly provider_invocation_ref: {
        readonly resource_id: string;
        readonly resource_revision: 1;
        readonly resource_hash: `sha256:${string}`;
      };
    },
  ): Promise<`sha256:${string}`>;
  commit(
    input: Identity & {
      readonly command: AnalysisAuthorityCommit;
    },
  ): Promise<AnalysisAuthorityCommitReceipt>;
  prepareAuthorityJournal(
    input: Identity & { readonly command: AnalysisAuthorityCommit },
  ): Promise<ReturnType<typeof analysisContextJournalAppendCommandSchema.parse>>;
  commitPublication(command: AnalysisPublicationV2Command): Promise<AnalysisPublicationV2Receipt>;
  cleanup(input: Identity & { readonly stage: AnalysisResultStage }): Promise<void>;
}

async function cursor(entries: readonly AnalysisContextJournalEntry[]) {
  let seq = 0;
  let entryHash: `sha256:${string}` | null = null;
  let eventType: AnalysisContextJournalEntry["event"]["event_type"] | null = null;
  for (const raw of entries) {
    const entry = await verifyAnalysisContextJournalEntry(raw);
    if (
      entry.seq !== seq + 1 ||
      entry.prev_entry_hash !== entryHash ||
      entry.expected_prev_seq !== seq ||
      entry.expected_prev_entry_hash !== entryHash
    ) {
      throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_HASH_CHAIN_INVALID");
    }
    assertAnalysisContextJournalTransition(eventType, entry.event.event_type);
    seq = entry.seq;
    entryHash = entry.entry_hash as `sha256:${string}`;
    eventType = entry.event.event_type;
  }
  return { seq, entry_hash: entryHash, event_type: eventType } as const;
}

export function createResearchAnalysisLifecycleAuthorityPort(input: {
  readonly authority: AnalysisLifecyclePersistenceAuthority;
  readonly capabilities: ResearchAuthorityCapabilityResolver;
  readonly now?: () => Date;
}): AnalysisLifecycleAuthorityPort {
  const now = input.now ?? (() => new Date());
  const stageExpiration = () =>
    new Date(now().getTime() + ANALYSIS_RESULT_STAGE_RETENTION_MS).toISOString();
  const capability = () => input.capabilities.forArtifactType("SandboxResult");
  const load = async (identity: RecoveryIdentity) => {
    const result = await input.authority.readAnalysisContextJournal(capability(), {
      scope: identity.lease.scope,
      run_id: identity.lease.run_id,
      node_id: identity.node_id,
      attempt_id: identity.lease.attempt_id,
      context_generation: identity.context_generation,
    });
    if (!result.ok) throw new TypeError(result.error_code);
    return { ...(await cursor(result.entries)), entries: result.entries } as const;
  };
  const journal = async (
    identity: Identity,
    event: Parameters<typeof buildAnalysisContextJournalAppend>[0]["event"],
  ) => {
    const current = await load(identity);
    const replay = current.entries.find(
      (entry) =>
        entry.event.event_type === event.event_type &&
        canonicalizeJson(entry.event) === canonicalizeJson(event),
    );
    if (replay) {
      const {
        seq: _seq,
        prev_entry_hash: _prevEntryHash,
        entry_hash: _entryHash,
        created_at: _createdAt,
        schema_version: _schemaVersion,
        ...appendMaterial
      } = replay;
      return analysisContextJournalAppendCommandSchema.parse({
        ...appendMaterial,
        schema_version: "analysis-context-journal-append@1.0.0",
      });
    }
    assertAnalysisContextJournalTransition(current.event_type, event.event_type);
    return buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope: identity.lease.scope,
      run_id: identity.lease.run_id,
      principal_id: identity.lease.principal_id,
      node_id: identity.node_id,
      attempt_id: identity.lease.attempt_id,
      context_generation: identity.context_generation,
      worker_fence: identity.lease.worker_fence,
      expected_prev_seq: current.seq,
      expected_prev_entry_hash: current.entry_hash,
      runtime_digest: identity.runtime_digest,
      policy_version: identity.policy_version,
      operator_registry_digest: identity.operator_registry_digest,
      event,
    });
  };
  const append = async (
    identity: Identity,
    event: Parameters<typeof buildAnalysisContextJournalAppend>[0]["event"],
  ) => {
    const result = await input.authority.appendAnalysisContextJournal(
      capability(),
      await journal(identity, event),
    );
    if (!result.ok) throw new TypeError(result.error_code);
    return verifyAnalysisContextJournalEntry(result.entry);
  };

  const port: AnalysisLifecycleAuthorityPort = {
    async recoverStage(recoveryInput) {
      const current = await load(recoveryInput);
      const first = current.entries[0];
      const stageEvent = current.entries.find(
        (entry) => entry.event.event_type === "PUBLISH_STAGE_CREATED",
      );
      if (!first || !stageEvent || stageEvent.event.event_type !== "PUBLISH_STAGE_CREATED") {
        return null;
      }
      for (const entry of current.entries) {
        if (
          entry.scope.app_id !== recoveryInput.lease.scope.app_id ||
          entry.scope.tenant_id !== recoveryInput.lease.scope.tenant_id ||
          entry.scope.environment !== recoveryInput.lease.scope.environment ||
          entry.run_id !== recoveryInput.lease.run_id ||
          entry.node_id !== recoveryInput.node_id ||
          entry.attempt_id !== recoveryInput.lease.attempt_id ||
          entry.context_generation !== recoveryInput.context_generation
        ) {
          throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_IDENTITY_MISMATCH");
        }
        if ("stage_id" in entry.event && entry.event.stage_id !== stageEvent.event.stage_id) {
          throw new TypeError("ANALYSIS_CONTEXT_JOURNAL_STAGE_IDENTITY_MISMATCH");
        }
      }
      const identity = {
        lease: recoveryInput.lease,
        node_id: recoveryInput.node_id,
        context_generation: recoveryInput.context_generation,
        runtime_digest: first.runtime_digest as `sha256:${string}`,
        policy_version: first.policy_version,
        operator_registry_digest: first.operator_registry_digest as `sha256:${string}`,
      } as const;
      const provisionalStage = {
        schema_version: "analysis-result-stage@1.0.0" as const,
        stage_id: stageEvent.event.stage_id,
        stage_hash: stageEvent.event.stage_hash,
        closure_hash: stageEvent.event.closure_hash,
        status: "STAGED" as const,
        created: false,
        expires_at: stageExpiration(),
      };
      const loaded = await port.load({ ...identity, stage: provisionalStage });
      const stage = Object.freeze({
        ...provisionalStage,
        expires_at: loaded.stage_expires_at,
      });
      return Object.freeze({
        identity: Object.freeze({
          runtime_digest: identity.runtime_digest,
          policy_version: identity.policy_version,
          operator_registry_digest: identity.operator_registry_digest,
        }),
        stage,
        loaded,
        journal_phase: current.event_type as AnalysisContextJournalEntry["event"]["event_type"],
      });
    },
    async stage(stageInput) {
      const stageId = deterministicAnalysisUuid(
        `analysis-stage\0${stageInput.lease.run_id}\0${stageInput.node_id}\0${stageInput.closure.closure_hash}`,
      );
      const command = await buildAnalysisResultStageCommand({
        schema_version: "analysis-result-stage-command@1.0.0",
        scope: stageInput.lease.scope,
        run_id: stageInput.lease.run_id,
        principal_id: stageInput.lease.principal_id,
        node_id: stageInput.node_id,
        attempt_id: stageInput.lease.attempt_id,
        context_generation: stageInput.context_generation,
        worker_fence: stageInput.lease.worker_fence,
        idempotency_key: `analysis-stage:${stageInput.node_id}:${stageInput.closure.closure_hash}`,
        stage_id: stageId,
        publish_id: stageInput.closure.publish_id,
        contract_hash: stageInput.closure.contract_hash,
        manifest_hash: stageInput.closure.manifest_hash,
        closure_hash: stageInput.closure.closure_hash,
        analytical_value_hashes: [...stageInput.closure.analytical_value_hashes],
        governed_operator_results: [...stageInput.governed_results],
        operator_finalization: stageInput.operator_finalization,
        execution_snapshot: stageInput.execution_snapshot,
        artifacts: stageInput.closure.artifacts.map(
          ({ content: _content, ...artifact }) => artifact,
        ),
        expires_at: stageExpiration(),
      });
      const journalCommand = await journal(stageInput, {
        event_type: "PUBLISH_STAGE_CREATED",
        stage_id: stageId,
        stage_hash: command.stage_hash,
        closure_hash: command.closure_hash,
      });
      const result = await input.authority.stageAnalysisResult(
        capability(),
        command,
        journalCommand,
        stageInput.closure.artifacts.map(({ content }) => content),
      );
      if (!result.ok) throw new TypeError(result.error_code);
      await verifyAnalysisContextJournalEntry(result.journal_entry);
      if (
        result.stage.stage_id !== stageId ||
        result.stage.stage_hash !== command.stage_hash ||
        result.stage.closure_hash !== command.closure_hash
      ) {
        throw new TypeError("ANALYSIS_RESULT_STAGE_AUTHORITY_SUBSTITUTION");
      }
      return result.stage;
    },
    async freeze(freezeInput) {
      await append(freezeInput, {
        event_type: "CONTEXT_FROZEN",
        stage_id: freezeInput.stage.stage_id,
        stage_hash: freezeInput.stage.stage_hash,
      });
    },
    async load(loadInput) {
      const result = await input.authority.readAnalysisResultStage(capability(), loadInput);
      if (!result.ok) throw new TypeError(result.error_code);
      const command = await verifyAnalysisResultStageCommand(result.stage_command);
      if (
        command.stage_id !== loadInput.stage.stage_id ||
        command.stage_hash !== loadInput.stage.stage_hash ||
        command.closure_hash !== loadInput.stage.closure_hash ||
        result.artifacts.length !== command.artifacts.length
      ) {
        throw new TypeError("ANALYSIS_RESULT_STAGE_READ_SUBSTITUTION");
      }
      const artifacts = command.artifacts.map((declared) => {
        const artifact = result.artifacts.find(
          ({ artifact_name: artifactName }) => artifactName === declared.artifact_name,
        );
        if (!artifact) throw new TypeError("ANALYSIS_RESULT_STAGE_CONTENT_MISSING");
        const observedHash = `sha256:${createHash("sha256").update(artifact.content).digest("hex")}`;
        if (
          declared.artifact_name !== artifact.artifact_name ||
          declared.content_sha256 !== observedHash ||
          artifact.content_sha256 !== observedHash ||
          artifact.bytes !== artifact.content.byteLength
        ) {
          throw new TypeError("ANALYSIS_RESULT_STAGE_CONTENT_HASH_MISMATCH");
        }
        return Object.freeze({ ...artifact, content: artifact.content.slice() });
      });
      return Object.freeze({
        schema_version: "analysis-result-staged-closure@1.0.0",
        publish_id: command.publish_id,
        contract_hash: command.contract_hash as `sha256:${string}`,
        manifest_hash: command.manifest_hash as `sha256:${string}`,
        closure_hash: command.closure_hash as `sha256:${string}`,
        analytical_value_hashes: Object.freeze(
          command.analytical_value_hashes.map((value) =>
            Object.freeze({
              symbol_name: value.symbol_name,
              value_hash: value.value_hash as `sha256:${string}`,
            }),
          ),
        ),
        artifacts: Object.freeze(artifacts),
        governed_operator_results: Object.freeze([...command.governed_operator_results]),
        operator_finalization: command.operator_finalization,
        execution_snapshot: command.execution_snapshot,
        stage_expires_at: command.expires_at,
        oracle_record: result.oracle_record,
        explanation_record: result.explanation_record,
      });
    },
    async recordOracle(oracleInput) {
      const oracleHash = (await sha256ContentHash(
        oracleInput.oracle_receipt,
      )) as `sha256:${string}`;
      const journalCommand = await journal(oracleInput, {
        event_type: "ORACLE_VERIFIED",
        stage_id: oracleInput.stage.stage_id,
        oracle_receipt_hash: oracleHash,
      });
      const result = await input.authority.recordAnalysisStageOracle(
        capability(),
        {
          schema_version: "analysis-stage-oracle-record@1.0.0",
          scope: oracleInput.lease.scope,
          run_id: oracleInput.lease.run_id,
          principal_id: oracleInput.lease.principal_id,
          attempt_id: oracleInput.lease.attempt_id,
          worker_fence: oracleInput.lease.worker_fence,
          node_id: oracleInput.node_id,
          context_generation: oracleInput.context_generation,
          stage_id: oracleInput.stage.stage_id,
          stage_hash: oracleInput.stage.stage_hash,
          receipt_payload: oracleInput.oracle_receipt,
          receipt_hash: oracleHash,
        },
        journalCommand,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      await verifyAnalysisContextJournalEntry(result.journal_entry);
      return oracleHash;
    },
    async recordExplanation(explanationInput) {
      const explanationHash = (await sha256ContentHash(
        explanationInput.explanation,
      )) as `sha256:${string}`;
      const journalCommand = await journal(explanationInput, {
        event_type: "EXPLANATION_BOUND",
        stage_id: explanationInput.stage.stage_id,
        explanation_hash: explanationHash,
      });
      const result = await input.authority.recordAnalysisStageExplanation(
        capability(),
        {
          schema_version: "analysis-stage-explanation-record@1.0.0",
          scope: explanationInput.lease.scope,
          run_id: explanationInput.lease.run_id,
          principal_id: explanationInput.lease.principal_id,
          attempt_id: explanationInput.lease.attempt_id,
          worker_fence: explanationInput.lease.worker_fence,
          node_id: explanationInput.node_id,
          context_generation: explanationInput.context_generation,
          stage_id: explanationInput.stage.stage_id,
          stage_hash: explanationInput.stage.stage_hash,
          explanation: explanationInput.explanation,
          explanation_hash: explanationHash,
          provider_invocation_ref: explanationInput.provider_invocation_ref,
        },
        journalCommand,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      await verifyAnalysisContextJournalEntry(result.journal_entry);
      return explanationHash;
    },
    async commit(commitInput) {
      const journalCommand = await journal(commitInput, {
        event_type: "AUTHORITY_COMMITTED",
        stage_id: commitInput.command.stage_id,
        authority_commit_hash: commitInput.command.authority_commit_hash,
      });
      const result = await input.authority.commitAnalysisAuthority(
        capability(),
        commitInput.command,
        journalCommand,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      await verifyAnalysisContextJournalEntry(result.journal_entry);
      if (result.receipt.authority_commit_hash !== commitInput.command.authority_commit_hash) {
        throw new TypeError("ANALYSIS_AUTHORITY_COMMIT_SUBSTITUTION");
      }
      return result.receipt;
    },
    async prepareAuthorityJournal(commitInput) {
      return journal(commitInput, {
        event_type: "AUTHORITY_COMMITTED",
        stage_id: commitInput.command.stage_id,
        authority_commit_hash: commitInput.command.authority_commit_hash,
      });
    },
    async commitPublication(command) {
      const result = await input.authority.commitAnalysisPublication(capability(), command);
      if (!result.ok) throw new TypeError(result.error_code);
      if (result.receipt.publication_hash !== command.publication_hash) {
        throw new TypeError("FALCON24_ANALYSIS_PUBLICATION_SUBSTITUTION");
      }
      return result.receipt;
    },
    async cleanup(cleanupInput) {
      await append(cleanupInput, {
        event_type: "CLEANUP_VERIFIED",
        stage_id: cleanupInput.stage.stage_id,
        residual_sandboxes: 0,
        residual_egress_sidecars: 0,
      });
    },
  };
  return Object.freeze(port);
}

export const analysisLifecycleAuthorityInternals = Object.freeze({
  cursor,
  stage_retention_ms: ANALYSIS_RESULT_STAGE_RETENTION_MS,
});
