import type { ArtifactPreviewResult } from "@data-agent/contracts";

function artifactReferenceHref(reference: ArtifactPreviewResult["source_ref"]): string {
  return `/api/workspaces/${reference.tenant_id}/artifacts/${reference.artifact_id}?reference=${encodeURIComponent(JSON.stringify(reference))}`;
}

export interface ArtifactWorkspaceProps {
  readonly preview: ArtifactPreviewResult;
  readonly exportActions?: Readonly<{
    csv?: string;
    xlsx?: string;
  }>;
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

export function ArtifactWorkspace({ preview, exportActions }: ArtifactWorkspaceProps) {
  const projection = preview.projection;
  return (
    <section
      aria-label="Artifact 工作区"
      className="overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white"
      data-artifact-id={preview.source_ref.artifact_id}
      data-content-hash={preview.source_ref.content_hash}
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
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {projection.columns.map((column) => (
                  <th
                    className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] px-3 py-2 font-semibold"
                    key={column.key}
                    scope="col"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keyedRows(projection.rows).map(({ row, key }) => (
                <tr key={key}>
                  {projection.columns.map((column) => (
                    <td
                      className="border-b border-[var(--color-border-default)] px-3 py-2 align-top"
                      key={column.key}
                    >
                      {row[column.key] === null ? "—" : String(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[11px] text-[var(--color-text-muted)]">
            {preview.viewport.offset + 1}–{preview.viewport.offset + projection.rows.length} /{" "}
            {projection.total_rows}
          </p>
        </div>
      ) : null}

      {projection.kind === "CHART" ? (
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold">{projection.title}</h2>
          <dl className="mt-3 grid gap-2">
            {keyedRows(projection.table.rows).map(({ row, key }) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4" key={key}>
                <dt>{String(row[projection.x_key] ?? "—")}</dt>
                <dd className="font-mono">{String(row[projection.y_key] ?? "—")}</dd>
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
