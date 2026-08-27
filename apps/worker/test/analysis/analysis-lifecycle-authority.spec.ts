import { createHash } from "node:crypto";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type AnalysisContextJournalAppendCommand,
  type AnalysisContextJournalEntry,
  type AnalysisResultStageCommand,
  analysisAgentFinalResponseSchema,
  analysisAuthorityCommitSchema,
  analysisContextJournalAppendCommandSchema,
  analysisContextJournalEntrySchema,
  analysisResultStageCommandSchema,
  buildAnalysisAuthorityCommit,
  buildAnalysisContextJournalAppend,
  buildAnalysisContextJournalEntryHash,
} from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AnalysisLifecyclePersistenceAuthority,
  analysisLifecycleAuthorityInternals,
  createResearchAnalysisLifecycleAuthorityPort,
} from "../../src/analysis/analysis-lifecycle-authority.js";
import type { ResearchAuthorityCapabilityResolver } from "../../src/runs/research-authority-capabilities.js";

const id = (suffix: number) => `93000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const lease = {
  scope,
  run_id: id(3),
  principal_id: id(4),
  attempt_id: id(5),
  worker_fence: 7,
  expires_at: "2026-08-24T01:00:00.000Z",
} as unknown as RunWorkLease;
const identity = {
  lease,
  node_id: "question-1",
  context_generation: 1,
  runtime_digest: hash("a"),
  policy_version: "analysis-cell-policy@1.0.0",
  operator_registry_digest: hash("b"),
} as const;

function rawHash(content: Uint8Array) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
}

function isContentHash(value: string): value is `sha256:${string}` {
  return /^sha256:[0-9a-f]{64}$/u.test(value);
}

const stageOracleRecordSchema = z.object({
  receipt_payload: z.record(z.string(), z.unknown()),
  receipt_hash: z.templateLiteral(["sha256:", z.string()]),
});
const stageExplanationRecordSchema = z.object({
  explanation: analysisAgentFinalResponseSchema,
  explanation_hash: z.templateLiteral(["sha256:", z.string()]),
  provider_invocation_ref: z.strictObject({
    resource_id: z.string(),
    resource_revision: z.literal(1),
    resource_hash: z.templateLiteral(["sha256:", z.string()]),
  }),
});

describe("durable analysis lifecycle authority", () => {
  it("stages bytes before freeze and reloads only the PostgreSQL-authoritative closure", async () => {
    const entries: AnalysisContextJournalEntry[] = [];
    const modelCell = await buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope,
      run_id: lease.run_id,
      principal_id: lease.principal_id,
      node_id: identity.node_id,
      attempt_id: lease.attempt_id,
      context_generation: 1,
      worker_fence: lease.worker_fence,
      expected_prev_seq: 0,
      expected_prev_entry_hash: null,
      runtime_digest: identity.runtime_digest,
      policy_version: identity.policy_version,
      operator_registry_digest: identity.operator_registry_digest,
      event: {
        event_type: "MODEL_CELL_COMMITTED",
        cell_id: "cell-1",
        source_ref: {
          artifact_id: id(6),
          artifact_type: "SensitiveExecutionArtifact",
          ...scope,
          run_id: lease.run_id,
          revision: 1,
          content_hash: hash("c"),
        },
        source_sha256: hash("c"),
        timeout_ms: 1_000,
      },
    });
    const toEntry = async (
      command: AnalysisContextJournalAppendCommand,
    ): Promise<AnalysisContextJournalEntry> => {
      const seq = entries.length + 1;
      const prevEntryHash = entries.at(-1)?.entry_hash ?? null;
      return analysisContextJournalEntrySchema.parse({
        ...command,
        schema_version: "analysis-context-journal-entry@1.0.0",
        seq,
        prev_entry_hash: prevEntryHash,
        entry_hash: await buildAnalysisContextJournalEntryHash(command, seq, prevEntryHash),
        created_at: "2026-08-24T00:00:00.000Z",
      });
    };
    entries.push(await toEntry(modelCell));
    let stagedCommand: AnalysisResultStageCommand | null = null;
    let stagedContents: readonly Uint8Array[] = [];
    let oracleRecord: z.infer<typeof stageOracleRecordSchema> | null = null;
    let explanationRecord: z.infer<typeof stageExplanationRecordSchema> | null = null;
    const authority: AnalysisLifecyclePersistenceAuthority = {
      async readAnalysisContextJournal() {
        return { ok: true, entries };
      },
      async appendAnalysisContextJournal(_capability, command) {
        const typed = analysisContextJournalAppendCommandSchema.parse(command);
        const replay = entries.find((entry) => entry.append_hash === typed.append_hash);
        if (replay) return { ok: true, entry: replay };
        const entry = await toEntry(typed);
        entries.push(entry);
        return { ok: true, entry };
      },
      async stageAnalysisResult(_capability, command, journalCommand, contents) {
        const typed = analysisResultStageCommandSchema.parse(command);
        const typedJournal = analysisContextJournalAppendCommandSchema.parse(journalCommand);
        stagedCommand = typed;
        stagedContents = contents.map((content) => content.slice());
        const entry = await toEntry(typedJournal);
        entries.push(entry);
        return {
          ok: true,
          stage: {
            schema_version: "analysis-result-stage@1.0.0",
            stage_id: typed.stage_id,
            stage_hash: typed.stage_hash,
            closure_hash: typed.closure_hash,
            status: "STAGED",
            created: true,
            expires_at: typed.expires_at,
          },
          journal_entry: entry,
        } as const;
      },
      async readAnalysisResultStage() {
        if (!stagedCommand) throw new TypeError("TEST_STAGE_NOT_CREATED");
        return {
          ok: true,
          stage_command: stagedCommand,
          oracle_record: oracleRecord,
          explanation_record: explanationRecord,
          artifacts: stagedCommand.artifacts.map((artifact, index) => {
            const content = stagedContents[index];
            if (!content) throw new TypeError("TEST_STAGE_CONTENT_MISSING");
            const contentHash = artifact.content_sha256;
            if (!isContentHash(contentHash)) throw new TypeError("TEST_STAGE_HASH_INVALID");
            return { ...artifact, content_sha256: contentHash, content: content.slice() };
          }),
        } as const;
      },
      async recordAnalysisStageOracle(_capability, command, journalCommand) {
        const typed = stageOracleRecordSchema.parse(command);
        const typedJournal = analysisContextJournalAppendCommandSchema.parse(journalCommand);
        oracleRecord = {
          receipt_payload: typed.receipt_payload,
          receipt_hash: typed.receipt_hash,
        };
        const replay = entries.find((entry) => entry.append_hash === typedJournal.append_hash);
        const entry = replay ?? (await toEntry(typedJournal));
        if (!replay) entries.push(entry);
        return { ok: true, journal_entry: entry } as const;
      },
      async recordAnalysisStageExplanation(_capability, command, journalCommand) {
        const typed = stageExplanationRecordSchema.parse(command);
        const typedJournal = analysisContextJournalAppendCommandSchema.parse(journalCommand);
        explanationRecord = {
          explanation: typed.explanation,
          explanation_hash: typed.explanation_hash,
          provider_invocation_ref: typed.provider_invocation_ref,
        };
        const replay = entries.find((entry) => entry.append_hash === typedJournal.append_hash);
        const entry = replay ?? (await toEntry(typedJournal));
        if (!replay) entries.push(entry);
        return { ok: true, journal_entry: entry } as const;
      },
      async commitAnalysisAuthority(_capability, command, journalCommand) {
        const typed = analysisAuthorityCommitSchema.parse(command);
        const typedJournal = analysisContextJournalAppendCommandSchema.parse(journalCommand);
        const replay = entries.find((entry) => entry.append_hash === typedJournal.append_hash);
        const entry = replay ?? (await toEntry(typedJournal));
        if (!replay) entries.push(entry);
        return {
          ok: true,
          receipt: {
            schema_version: "analysis-authority-commit-receipt@1.0.0",
            created: true,
            authority_commit_hash: typed.authority_commit_hash,
            stage_id: typed.stage_id,
            stage_hash: typed.stage_hash,
            references: [
              ...typed.output_bindings.map((binding) => binding.reference),
              typed.sandbox_receipt_ref,
            ],
            public_event_id: typed.public_event_id,
          },
          journal_entry: entry,
        } as const;
      },
      async commitAnalysisPublication(_capability, command) {
        return {
          ok: true,
          receipt: {
            schema_version: "falcon24-analysis-publication-receipt@2.0.0",
            created: true,
            publication_hash: command.publication_hash,
            public_event_id: command.public_event_id,
            references: command.nodes.flatMap((node) => [
              ...node.authority_commit.output_bindings.map((binding) => binding.reference),
              node.authority_commit.sandbox_receipt_ref,
            ]),
          },
        } as const;
      },
    };
    const lifecycle = createResearchAnalysisLifecycleAuthorityPort({
      authority,
      capabilities: {
        forArtifactType() {
          return { authority_capability_id: id(7) };
        },
      } as unknown as ResearchAuthorityCapabilityResolver,
      now: () => new Date("2026-08-24T00:59:00.000Z"),
    });
    const artifactInputs = [
      {
        artifact_name: "result",
        artifact_kind: "RESULT" as const,
        content: new TextEncoder().encode('{"result":1}'),
      },
      {
        artifact_name: "table:trend",
        artifact_kind: "TABLE" as const,
        content: new TextEncoder().encode('{"rows":[]}'),
      },
      {
        artifact_name: "chart:trend",
        artifact_kind: "CHART" as const,
        content: new TextEncoder().encode('{"chart":{}}'),
      },
    ];
    const documents = artifactInputs.map(({ content }) => content);
    const closure = {
      schema_version: "analysis-result-staged-closure@1.0.0" as const,
      publish_id: "publish-1",
      contract_hash: hash("d"),
      manifest_hash: hash("e"),
      closure_hash: hash("f"),
      analytical_value_hashes: [{ symbol_name: "result_document", value_hash: hash("1") }],
      artifacts: artifactInputs.map(({ artifact_name, artifact_kind, content }) => ({
        artifact_name,
        artifact_kind,
        media_type: "application/json" as const,
        content,
        content_sha256: rawHash(content),
        bytes: content.byteLength,
      })),
    };

    const stage = await lifecycle.stage({
      ...identity,
      closure,
      governed_results: [],
      operator_finalization: {
        schema_version: "statistical-operator-finalization-result@1.0.0",
        operator_registry_digest: identity.operator_registry_digest,
        operator_receipts: [],
        operator_receipt_closure_hash: hash("9"),
      },
      execution_snapshot: {
        schema_version: "analysis-result-stage-execution-snapshot@1.0.0",
        request_hash: hash("8"),
        runtime_profile: "CORE_ANALYSIS",
        runtime: {
          agent_image: "agent@sha256:test",
          operator_image: "operator@sha256:test",
          agent_sandbox_id: "agent-1",
          operator_sandbox_id: "operator-1",
          secure_access: true,
        },
        cells: [],
        provider_invocation_refs: [],
        started_at: "2026-08-24T00:00:00.000Z",
        finished_at: "2026-08-24T00:00:01.000Z",
        elapsed_ms: 1_000,
      },
    });
    const restartedLifecycle = createResearchAnalysisLifecycleAuthorityPort({
      authority,
      capabilities: {
        forArtifactType() {
          return { authority_capability_id: id(7) };
        },
      } as unknown as ResearchAuthorityCapabilityResolver,
      now: () => new Date("2026-08-24T01:00:00.000Z"),
    });
    const recoveredStage = await restartedLifecycle.recoverStage({
      lease,
      node_id: identity.node_id,
      context_generation: identity.context_generation,
    });
    expect(recoveredStage?.journal_phase).toBe("PUBLISH_STAGE_CREATED");
    expect(recoveredStage?.loaded.operator_finalization.operator_receipt_closure_hash).toBe(
      hash("9"),
    );
    expect(recoveredStage?.loaded.execution_snapshot.request_hash).toBe(hash("8"));
    expect(stage.expires_at).toBe("2026-08-24T01:14:00.000Z");
    expect(stage.expires_at).not.toBe(lease.expires_at);
    expect(recoveredStage?.stage.expires_at).toBe(stage.expires_at);
    expect(analysisLifecycleAuthorityInternals.stage_retention_ms).toBe(15 * 60 * 1_000);
    await lifecycle.freeze({ ...identity, stage });
    const loaded = await lifecycle.load({ ...identity, stage });
    const oracleReceipt = { schema_version: "oracle@1", verdict: "PASS" };
    const oracleHash = await lifecycle.recordOracle({
      ...identity,
      stage,
      oracle_receipt: oracleReceipt,
    });
    const explanation = {
      schema_version: "analysis-agent-final@1.0.0" as const,
      summary_zh: "结论经过独立 Oracle 验证。",
    };
    const explanationHash = await lifecycle.recordExplanation({
      ...identity,
      stage,
      explanation,
      provider_invocation_ref: {
        resource_id: id(40),
        resource_revision: 1,
        resource_hash: hash("7"),
      },
    });
    const receiptPayload = { schema_version: "sandbox-receipt@1", status: "SUCCEEDED" };
    const receiptHash = await sha256ContentHash(receiptPayload);
    const outputBindings = closure.artifacts.map((artifact, index) => ({
      stage_artifact: {
        artifact_name: artifact.artifact_name,
        artifact_kind: artifact.artifact_kind,
        media_type: artifact.media_type,
        content_sha256: artifact.content_sha256,
        bytes: artifact.bytes,
      },
      reference: {
        artifact_id: id(10 + index),
        artifact_type: "SandboxResult" as const,
        ...scope,
        run_id: lease.run_id,
        revision: 1,
        content_hash: artifact.content_sha256,
      },
    }));
    const authorityCommand = await buildAnalysisAuthorityCommit({
      schema_version: "analysis-authority-commit@1.0.0",
      scope,
      run_id: lease.run_id,
      principal_id: lease.principal_id,
      node_id: identity.node_id,
      attempt_id: lease.attempt_id,
      worker_fence: lease.worker_fence,
      idempotency_key: "analysis-authority:question-1",
      analysis_program_ref: {
        artifact_id: id(20),
        artifact_type: "AnalysisProgram",
        ...scope,
        run_id: lease.run_id,
        revision: 1,
        content_hash: hash("8"),
      },
      stage_id: stage.stage_id,
      stage_hash: stage.stage_hash,
      closure_hash: stage.closure_hash,
      operator_receipt_closure_hash: hash("9"),
      oracle_receipt_payload: oracleReceipt,
      oracle_receipt_hash: oracleHash,
      explanation,
      explanation_hash: explanationHash,
      output_bindings: outputBindings,
      sandbox_receipt_ref: {
        artifact_id: id(30),
        artifact_type: "SandboxExecutionReceipt",
        ...scope,
        run_id: lease.run_id,
        revision: 1,
        content_hash: receiptHash,
      },
      sandbox_receipt_payload: receiptPayload,
      sandbox_receipt_hash: receiptHash,
      public_event_id: id(31),
    });
    await lifecycle.commit({ ...identity, command: authorityCommand });
    await lifecycle.cleanup({ ...identity, stage });
    const committedEntryCount = entries.length;
    await restartedLifecycle.recordOracle({
      ...identity,
      stage,
      oracle_receipt: oracleReceipt,
    });
    await restartedLifecycle.recordExplanation({
      ...identity,
      stage,
      explanation,
      provider_invocation_ref: {
        resource_id: id(40),
        resource_revision: 1,
        resource_hash: hash("7"),
      },
    });
    await restartedLifecycle.commit({ ...identity, command: authorityCommand });
    await restartedLifecycle.cleanup({ ...identity, stage });
    expect(entries).toHaveLength(committedEntryCount);

    expect(loaded.closure_hash).toBe(closure.closure_hash);
    expect(loaded.artifacts.map(({ content }) => [...content])).toEqual(
      documents.map((content) => [...content]),
    );
    expect(entries.map(({ event }) => event.event_type)).toEqual([
      "MODEL_CELL_COMMITTED",
      "PUBLISH_STAGE_CREATED",
      "CONTEXT_FROZEN",
      "ORACLE_VERIFIED",
      "EXPLANATION_BOUND",
      "AUTHORITY_COMMITTED",
      "CLEANUP_VERIFIED",
    ]);
    expect(stagedContents).not.toBe(documents);
  });
});
