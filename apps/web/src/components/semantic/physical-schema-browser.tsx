"use client";

import {
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
  type SchemaDriftEvent,
  type SemanticCandidateOperation,
  schemaDriftEventSchema,
  schemaFeaturePacketSchema,
  semanticCandidateOperationSchema,
  semanticChangeProposalSchema,
  semanticCompileTerminalSchema,
} from "@data-agent/contracts";
import { useState } from "react";
import { z } from "zod";
import { resolveWorkspaceId, workspaceRequestHeaders } from "@/lib/api-client";
import { PhysicalSchemaDiff } from "./physical-schema-diff";
import { PhysicalSchemaTree } from "./physical-schema-tree";

interface ApiEnvelope {
  readonly data?: unknown;
  readonly error?: { readonly code?: string; readonly message?: string };
}

const compileBundleSchema = z.strictObject({
  compile_run_id: z.uuid(),
  source_revision_id: z.uuid(),
  input_digest: z.string(),
  feature_packet: schemaFeaturePacketSchema,
  agent_receipt: z.record(z.string(), z.unknown()),
  terminal: z.union([z.literal("RUNNING"), semanticCompileTerminalSchema]),
  proposal: semanticChangeProposalSchema.nullable(),
  candidate_id: z.uuid().nullable(),
  candidate_revision_id: z.uuid().nullable(),
  failure_code: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

type CompileBundle = z.infer<typeof compileBundleSchema>;

const targetLabels: Record<SemanticCandidateOperation["target_type"], string> = {
  BUSINESS_ENTITY_TYPE: "业务实体",
  DIMENSION: "维度",
  METRIC: "指标",
  RELATIONSHIP: "关系",
  PHYSICAL_BINDING: "物理绑定",
};

async function readEnvelope(response: Response): Promise<ApiEnvelope> {
  const body = (await response.json()) as ApiEnvelope;
  if (!response.ok) throw new Error(body.error?.message ?? body.error?.code ?? "请求失败");
  return body;
}

export function PhysicalSchemaBrowser() {
  const [datasourceId, setDatasourceId] = useState("");
  const [schemas, setSchemas] = useState("public");
  const [snapshotId, setSnapshotId] = useState("");
  const [baseSnapshotId, setBaseSnapshotId] = useState("");
  const [snapshot, setSnapshot] = useState<PhysicalSchemaSnapshot | null>(null);
  const [drift, setDrift] = useState<SchemaDriftEvent | null>(null);
  const [semanticDomain, setSemanticDomain] = useState("revenue");
  const [compile, setCompile] = useState<CompileBundle | null>(null);
  const [selectedOperationIds, setSelectedOperationIds] = useState<Set<string>>(new Set());
  const [operationDrafts, setOperationDrafts] = useState<Record<string, string>>({});
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSnapshot(targetSnapshotId = snapshotId) {
    setBusy(true);
    setError(null);
    try {
      const envelope = await readEnvelope(
        await fetch(`/api/schema-snapshots/${encodeURIComponent(targetSnapshotId)}`, {
          cache: "no-store",
          headers: workspaceRequestHeaders(),
        }),
      );
      const parsed = physicalSchemaSnapshotSchema.parse(envelope.data);
      setSnapshot(parsed);
      setSnapshotId(parsed.snapshot_id);
      if (baseSnapshotId) {
        const diffEnvelope = await readEnvelope(
          await fetch(
            `/api/schema-snapshots/${encodeURIComponent(parsed.snapshot_id)}/diff?baseSnapshotId=${encodeURIComponent(baseSnapshotId)}`,
            { cache: "no-store", headers: workspaceRequestHeaders() },
          ),
        );
        setDrift(schemaDriftEventSchema.parse(diffEnvelope.data));
      } else {
        setDrift(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取物理快照");
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        schema_version: "schema-scan-request@1.0.0",
        datasource_id: datasourceId,
        include_schemas: schemas
          .split(",")
          .map((schema) => schema.trim())
          .filter(Boolean),
        page_size: 250,
        statement_timeout_ms: 10_000,
        ...(baseSnapshotId ? { base_snapshot_id: baseSnapshotId } : {}),
        idempotency_key: crypto.randomUUID(),
      };
      const envelope = await readEnvelope(
        await fetch(
          `/api/workspaces/${encodeURIComponent(resolveWorkspaceId())}/datasources/${encodeURIComponent(datasourceId)}/schema-scans`,
          {
            method: "POST",
            headers: workspaceRequestHeaders(),
            body: JSON.stringify(body),
          },
        ),
      );
      const result = envelope.data as {
        snapshot?: unknown;
        drift?: unknown;
        scan?: { terminal?: string };
      };
      if (!result.snapshot) {
        setError(`扫描结束：${result.scan?.terminal ?? "UNKNOWN"}`);
        return;
      }
      const parsed = physicalSchemaSnapshotSchema.parse(result.snapshot);
      setSnapshot(parsed);
      setSnapshotId(parsed.snapshot_id);
      setDrift(result.drift ? schemaDriftEventSchema.parse(result.drift) : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法启动物理结构扫描");
    } finally {
      setBusy(false);
    }
  }

  async function compileSemanticCandidate() {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    setCandidateId(null);
    try {
      const envelope = await readEnvelope(
        await fetch("/api/semantic/candidate-compiles", {
          method: "POST",
          headers: workspaceRequestHeaders(),
          body: JSON.stringify({
            schema_version: "semantic-compile-request@1.0.0",
            semantic_domain: semanticDomain,
            snapshot_id: snapshot.snapshot_id,
            idempotency_key: crypto.randomUUID(),
          }),
        }),
      );
      const parsed = compileBundleSchema.parse(envelope.data);
      setCompile(parsed);
      const operations = parsed.proposal?.operations ?? [];
      setSelectedOperationIds(new Set(operations.map((operation) => operation.operation_id)));
      setOperationDrafts(
        Object.fromEntries(
          operations.map((operation) => [
            operation.operation_id,
            JSON.stringify(operation, null, 2),
          ]),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法生成语义候选");
    } finally {
      setBusy(false);
    }
  }

  function toggleOperation(operationId: string) {
    setSelectedOperationIds((current) => {
      const next = new Set(current);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }

  async function submitCandidate() {
    if (!compile?.proposal || selectedOperationIds.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const editedOperations = compile.proposal.operations
        .filter((operation) => selectedOperationIds.has(operation.operation_id))
        .map((operation) =>
          semanticCandidateOperationSchema.parse(
            JSON.parse(operationDrafts[operation.operation_id] ?? "null"),
          ),
        );
      const envelope = await readEnvelope(
        await fetch(
          `/api/semantic/candidate-compiles/${encodeURIComponent(compile.compile_run_id)}/submit`,
          {
            method: "POST",
            headers: workspaceRequestHeaders(),
            body: JSON.stringify({
              schema_version: "semantic-compile-submit@1.0.0",
              semantic_domain: semanticDomain,
              selected_operation_ids: editedOperations.map((operation) => operation.operation_id),
              edited_operations: editedOperations,
              idempotency_key: crypto.randomUUID(),
            }),
          },
        ),
      );
      const result = z
        .strictObject({ candidate_id: z.uuid(), revision_id: z.uuid() })
        .passthrough()
        .parse(envelope.data);
      setCandidateId(result.candidate_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法提交人工审核");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
        物理证据，未发布为业务语义。外键、列名和类型不会自动成为 Join、实体或指标定义。
      </div>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Snapshot selector
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--color-text-secondary)]">
            当前 snapshot ID
            <input
              value={snapshotId}
              onChange={(event) => setSnapshotId(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]"
              placeholder="UUID"
            />
          </label>
          <label className="text-xs text-[var(--color-text-secondary)]">
            Base snapshot ID（可选）
            <input
              value={baseSnapshotId}
              onChange={(event) => setBaseSnapshotId(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]"
              placeholder="用于 drift 比较"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !snapshotId}
          onClick={() => void loadSnapshot()}
          className="mt-3 rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
        >
          读取快照
        </button>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">启动只读扫描</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--color-text-secondary)]">
            Datasource ID
            <input
              value={datasourceId}
              onChange={(event) => setDatasourceId(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-xs text-[var(--color-text-primary)]"
            />
          </label>
          <label className="text-xs text-[var(--color-text-secondary)]">
            Schema allowlist（逗号分隔）
            <input
              value={schemas}
              onChange={(event) => setSchemas(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-xs text-[var(--color-text-primary)]"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !datasourceId}
          onClick={() => void startScan()}
          className="mt-3 rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? "处理中…" : "扫描 PostgreSQL catalog"}
        </button>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
      {snapshot ? <PhysicalSchemaTree snapshot={snapshot} /> : null}
      {drift ? <PhysicalSchemaDiff drift={drift} /> : null}

      {snapshot ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                语义候选编译
              </h2>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                当前输出为未发布候选，提交后仍需人工审核。
              </p>
            </div>
            <label className="w-full text-xs text-[var(--color-text-secondary)] sm:w-56">
              语义域
              <input
                value={semanticDomain}
                onChange={(event) => setSemanticDomain(event.target.value)}
                className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]"
              />
            </label>
            <button
              type="button"
              disabled={busy || !semanticDomain}
              onClick={() => void compileSemanticCandidate()}
              className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {busy ? "编译中…" : "生成语义建议"}
            </button>
          </div>

          {compile ? (
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <span className="font-medium text-[var(--color-text-primary)]">
                  {compile.terminal}
                </span>
                <span className="text-[var(--color-text-secondary)]">
                  {compile.feature_packet.features.length} 条物理特征
                </span>
                <span className="font-mono text-[var(--color-text-tertiary)]">
                  {compile.compile_run_id}
                </span>
              </div>
              {compile.failure_code ? (
                <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {compile.failure_code}
                </p>
              ) : null}

              {compile.proposal ? (
                <div className="mt-4">
                  <p className="text-sm text-[var(--color-text-primary)]">
                    {compile.proposal.summary}
                  </p>
                  <div className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                    {compile.proposal.operations.map((operation) => (
                      <div key={operation.operation_id} className="py-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${operation.target_id}`}
                            checked={selectedOperationIds.has(operation.operation_id)}
                            onChange={() => toggleOperation(operation.operation_id)}
                            className="mt-1 size-4"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-[var(--color-text-primary)]">
                                {operation.target_id}
                              </span>
                              <span className="text-[var(--color-text-secondary)]">
                                {targetLabels[operation.target_type]} · {operation.action}
                              </span>
                              <span className="text-[var(--color-text-tertiary)]">
                                置信度 {Math.round(operation.confidence * 100)}%
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                              {operation.impact.summary}
                            </p>
                            {operation.assumptions.length > 0 ? (
                              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                                假设：{operation.assumptions.join("；")}
                              </p>
                            ) : null}
                            {operation.open_questions.length > 0 ? (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                待确认：{operation.open_questions.join("；")}
                              </p>
                            ) : null}
                            <textarea
                              aria-label={`${operation.target_id} 操作内容`}
                              value={operationDrafts[operation.operation_id] ?? ""}
                              onChange={(event) =>
                                setOperationDrafts((current) => ({
                                  ...current,
                                  [operation.operation_id]: event.target.value,
                                }))
                              }
                              rows={10}
                              spellCheck={false}
                              className="mt-3 max-h-80 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 font-mono text-xs leading-5 text-[var(--color-text-primary)]"
                            />
                            <p className="mt-2 break-all text-[11px] text-[var(--color-text-tertiary)]">
                              证据：{operation.evidence_refs.join(" · ")}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={busy || selectedOperationIds.size === 0 || candidateId !== null}
                      onClick={() => void submitCandidate()}
                      className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {candidateId ? "已提交" : "提交人工审核"}
                    </button>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      已选择 {selectedOperationIds.size} / {compile.proposal.operations.length}
                    </span>
                    {candidateId ? (
                      <span className="break-all font-mono text-xs text-[var(--color-text-primary)]">
                        Candidate {candidateId}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
