"use client";

import type {
  ArtifactPreviewResult,
  ArtifactWorkspaceTableProjection,
} from "@data-agent/contracts";
import dynamic from "next/dynamic";
import { useId } from "react";

const GovernedVChart = dynamic(() => import("./governed-vchart"), {
  ssr: false,
  loading: () => (
    <div
      className="h-[320px] rounded-lg bg-[var(--color-bg-overlay)] motion-safe:animate-pulse"
      role="status"
      aria-label="正在加载图表"
    />
  ),
});

function artifactReferenceHref(reference: ArtifactPreviewResult["source_ref"]): string {
  return `/api/workspaces/${reference.tenant_id}/artifacts/${reference.artifact_id}?reference=${encodeURIComponent(JSON.stringify(reference))}`;
}

export interface ArtifactWorkspaceProps {
  readonly preview: ArtifactPreviewResult;
  readonly exportActions?: Readonly<{
    csv?: string;
    xlsx?: string;
  }>;
  readonly onPageChange?: (offset: number) => void;
}

function keyedRows(rows: readonly Record<string, string | number | boolean | null>[]) {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const identity = JSON.stringify(row);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { row, key: `${identity}:${occurrence}` };
  });
}

function SourceIdentity({ preview }: { readonly preview: ArtifactPreviewResult }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
      <span>{preview.source_ref.artifact_type}</span>
      <span>rev {preview.source_ref.revision}</span>
      <code className="font-mono">{preview.source_ref.content_hash}</code>
    </div>
  );
}

function ArtifactWorkspaceTable({
  projection,
  range,
  onPageChange,
}: {
  readonly projection: ArtifactWorkspaceTableProjection;
  readonly range?: ArtifactPreviewResult["viewport"];
  readonly onPageChange?: (offset: number) => void;
}) {
  const start = range ? range.offset + (projection.rows.length > 0 ? 1 : 0) : 1;
  const end = range ? range.offset + projection.rows.length : projection.rows.length;
  const total = range?.total_rows ?? projection.total_rows;
  const previousEnabled = Boolean(range && range.offset > 0 && onPageChange);
  const nextEnabled = Boolean(
    range && onPageChange && total !== null && range.offset + projection.rows.length < total,
  );
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            {projection.columns.map((column) => (
              <th
                className="whitespace-nowrap border-b border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-bg-tertiary)_78%,transparent)] px-3 py-2 font-semibold"
                key={column.key}
                scope="col"
              >
                {column.label}
                <span className="ml-1 font-mono text-[9px] font-normal text-[var(--color-text-muted)]">
                  {column.data_type}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keyedRows(projection.rows).map(({ row, key }) => (
            <tr className="hover:bg-[var(--color-bg-overlay)]" key={key}>
              {projection.columns.map((column) => (
                <td
                  className="border-b border-[var(--color-border-default)] px-3 py-2 align-top tabular-nums"
                  key={column.key}
                >
                  {row[column.key] === null ? (
                    <>
                      <span className="sr-only">空值</span>
                      <span aria-hidden="true" className="text-[var(--color-text-muted)]">
                        —
                      </span>
                    </>
                  ) : (
                    String(row[column.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {range ? (
        <footer className="flex items-center justify-between gap-3 px-4 py-3 text-[11px] text-[var(--color-text-muted)]">
          <span>
            {start}–{end} / {total ?? "?"}
            {range.truncated ? " · 已分页" : ""}
          </span>
          {onPageChange ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!previousEnabled}
                onClick={() => onPageChange(Math.max(0, range.offset - range.limit))}
                className="rounded-md border border-[var(--color-border-default)] px-2 py-1 font-medium text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={!nextEnabled}
                onClick={() => onPageChange(range.offset + range.limit)}
                className="rounded-md border border-[var(--color-border-default)] px-2 py-1 font-medium text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

export function ArtifactWorkspace({
  preview,
  exportActions,
  onPageChange,
}: ArtifactWorkspaceProps) {
  const chartDescriptionId = useId();
  const projection = preview.projection;
  const previewV2 = preview.schema_version === "artifact-preview-result@2.0.0" ? preview : null;
  const previewV3 = preview.schema_version === "artifact-preview-result@3.0.0" ? preview : null;
  const governedChart = previewV3?.projection ?? previewV2?.projection ?? null;
  const previewV1 = preview.schema_version === "artifact-preview-result@1.0.0" ? preview : null;
  const chartV1 = previewV1?.projection.kind === "CHART" ? previewV1.projection : null;
  return (
    <section
      aria-label="Artifact 工作区"
      className="overflow-hidden rounded-2xl border border-white/60 bg-[color-mix(in_srgb,var(--color-bg-surface)_92%,transparent)] shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl"
      data-artifact-id={preview.source_ref.artifact_id}
      data-artifact-type={preview.source_ref.artifact_type}
      data-artifact-revision={preview.source_ref.revision}
      data-content-hash={preview.source_ref.content_hash}
      data-testid="artifact-preview-ready"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
        <SourceIdentity preview={preview} />
        {projection.kind === "TABLE" && exportActions ? (
          <div className="flex items-center gap-2">
            {exportActions.csv ? (
              <a className="text-xs font-medium underline" download href={exportActions.csv}>
                CSV
              </a>
            ) : null}
            {exportActions.xlsx ? (
              <a className="text-xs font-medium underline" download href={exportActions.xlsx}>
                XLSX
              </a>
            ) : null}
          </div>
        ) : null}
      </header>

      {projection.kind === "MARKDOWN" ? (
        <div className="whitespace-pre-wrap px-5 py-4 text-sm leading-7">
          {projection.plain_text}
          {projection.links.length > 0 ? (
            <ul className="mt-4 list-disc pl-5">
              {projection.links.map((link) => (
                <li key={`${link.href}:${link.label}`}>
                  <a href={link.href} rel="noreferrer noopener" target="_blank">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {projection.kind === "SQL" ? (
        <pre className="max-h-[520px] overflow-auto bg-slate-950 px-5 py-4 text-xs leading-6 text-slate-100">
          <code>{projection.sql}</code>
        </pre>
      ) : null}

      {projection.kind === "TABLE" ? (
        <ArtifactWorkspaceTable
          projection={projection}
          range={preview.viewport}
          onPageChange={onPageChange}
        />
      ) : null}

      {governedChart ? (
        <div className="px-5 py-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              {governedChart.title}
            </h2>
            <div
              id={chartDescriptionId}
              className="mt-1 space-y-1 text-xs text-[var(--color-text-muted)]"
            >
              {governedChart.description ? <p>{governedChart.description}</p> : null}
              <p>
                {governedChart.unit ? `单位：${governedChart.unit} · ` : ""}
                {preview.viewport.offset + (governedChart.table.rows.length > 0 ? 1 : 0)}–
                {preview.viewport.offset + governedChart.table.rows.length} /{" "}
                {preview.viewport.total_rows ?? "?"}
                {preview.viewport.truncated ? " · 已截断" : ""}
              </p>
            </div>
          </div>
          <GovernedVChart projection={governedChart} describedBy={chartDescriptionId} />
          <details
            className="mt-3 rounded-xl border border-[var(--color-border-default)]"
            data-testid="chart-source-table"
            open
          >
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
              查看数据表（与图表同源）
            </summary>
            <ArtifactWorkspaceTable
              projection={governedChart.table}
              range={preview.viewport}
              onPageChange={onPageChange}
            />
          </details>
          <p className="mt-3 break-all font-mono text-[9px] text-[var(--color-text-muted)]">
            dataset {(previewV3 ?? previewV2)?.provenance.dataset_hash}
          </p>
          <details className="mt-2 text-[10px] text-[var(--color-text-muted)]">
            <summary className="cursor-pointer font-semibold">治理来源</summary>
            <dl className="mt-2 grid gap-1 border-l border-[var(--color-border-default)] pl-3 font-mono">
              <div>
                <dt className="inline font-sans">QueryEvidence：</dt>{" "}
                <dd className="inline break-all">
                  {previewV3
                    ? `${previewV3.source_refs.query_evidence_refs.length} refs`
                    : `rev ${previewV2?.source_refs[0].revision} · ${previewV2?.source_refs[0].content_hash}`}
                </dd>
              </div>
              <div>
                <dt className="inline font-sans">Context package：</dt>{" "}
                <dd className="inline break-all">
                  {(previewV3 ?? previewV2)?.provenance.semantic_context.package_id} ·{" "}
                  {(previewV3 ?? previewV2)?.provenance.semantic_context.package_hash}
                </dd>
              </div>
              <div>
                <dt className="inline font-sans">Context receipt：</dt>{" "}
                <dd className="inline break-all">
                  {(previewV3 ?? previewV2)?.provenance.semantic_context.receipt_id} ·{" "}
                  {(previewV3 ?? previewV2)?.provenance.semantic_context.receipt_hash}
                </dd>
              </div>
              {previewV3 ? (
                <>
                  <div>
                    <dt className="inline font-sans">Derived evidence：</dt>{" "}
                    <dd className="inline break-all">
                      rev {previewV3.source_refs.derived_evidence_ref.revision} ·{" "}
                      {previewV3.source_refs.derived_evidence_ref.content_hash}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-sans">Algorithm / Runtime：</dt>{" "}
                    <dd className="inline break-all">
                      {previewV3.provenance.algorithm_version} ·{" "}
                      {previewV3.provenance.runtime_profile} · {previewV3.provenance.agent_image} ·{" "}
                      {previewV3.provenance.operator_image}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
          </details>
        </div>
      ) : null}

      {chartV1 ? (
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold">{chartV1.title}</h2>
          <dl className="mt-3 grid gap-2">
            {keyedRows(chartV1.table.rows).map(({ row, key }) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4" key={key}>
                <dt>{String(row[chartV1.x_key] ?? "—")}</dt>
                <dd className="font-mono">{String(row[chartV1.y_key] ?? "—")}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {projection.kind === "REPORT" ? (
        <article className="px-5 py-4">
          <h1 className="text-xl font-semibold">{projection.title}</h1>
          {projection.sections.map((section) => (
            <section className="mt-5" key={section.heading}>
              <h2 className="text-base font-semibold">{section.heading}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{section.body_text}</p>
              <ul className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                {section.source_refs.map((reference) => (
                  <li
                    key={`${reference.artifact_id}:${reference.revision}:${reference.content_hash}`}
                  >
                    <a href={artifactReferenceHref(reference)}>
                      {reference.artifact_type} · rev {reference.revision} ·{" "}
                      {reference.content_hash}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      ) : null}
    </section>
  );
}
