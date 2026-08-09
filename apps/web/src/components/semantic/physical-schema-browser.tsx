"use client";

import {
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
  type SchemaDriftEvent,
  schemaDriftEventSchema,
} from "@data-agent/contracts";
import { useState } from "react";
import { PhysicalSchemaDiff } from "./physical-schema-diff";
import { PhysicalSchemaTree } from "./physical-schema-tree";

interface ApiEnvelope {
  readonly data?: unknown;
  readonly error?: { readonly code?: string; readonly message?: string };
}

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSnapshot(targetSnapshotId = snapshotId) {
    setBusy(true);
    setError(null);
    try {
      const envelope = await readEnvelope(
        await fetch(`/api/schema-snapshots/${encodeURIComponent(targetSnapshotId)}`, {
          cache: "no-store",
        }),
      );
      const parsed = physicalSchemaSnapshotSchema.parse(envelope.data);
      setSnapshot(parsed);
      setSnapshotId(parsed.snapshot_id);
      if (baseSnapshotId) {
        const diffEnvelope = await readEnvelope(
          await fetch(
            `/api/schema-snapshots/${encodeURIComponent(parsed.snapshot_id)}/diff?baseSnapshotId=${encodeURIComponent(baseSnapshotId)}`,
            { cache: "no-store" },
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
        await fetch(`/api/datasources/${encodeURIComponent(datasourceId)}/schema-scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
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
    </div>
  );
}
