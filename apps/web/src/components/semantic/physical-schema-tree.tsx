import type { PhysicalSchemaSnapshot } from "@data-agent/contracts";

export function PhysicalSchemaTree({ snapshot }: { snapshot: PhysicalSchemaSnapshot }) {
  return (
    <section
      aria-label="Physical Schema tree"
      data-snapshot-content-hash={snapshot.snapshot_content_hash}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)]"
    >
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Physical Schema
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {snapshot.content.database_identity.database_name} · PostgreSQL{" "}
              {snapshot.content.engine_version.major}.{snapshot.content.engine_version.minor}
            </p>
          </div>
          <code className="max-w-full truncate text-[11px] text-[var(--color-text-secondary)]">
            {snapshot.snapshot_content_hash}
          </code>
        </div>
      </header>

      <div className="divide-y divide-[var(--color-border)]">
        {snapshot.content.relations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            allowlist 中没有可见 relation。
          </p>
        ) : (
          snapshot.content.relations.map((relation) => (
            <details
              key={`${relation.identity.schema_name}.${relation.identity.relation_name}`}
              className="group px-4 py-3"
            >
              <summary className="cursor-pointer list-none text-sm text-[var(--color-text-primary)]">
                <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                  {relation.identity.schema_name}.
                </span>
                <span className="font-medium">{relation.identity.relation_name}</span>
                <span className="ml-2 rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                  {relation.relation_kind}
                </span>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="text-[var(--color-text-secondary)]">
                    <tr>
                      <th className="pb-2 font-medium">Column</th>
                      <th className="pb-2 font-medium">Physical type</th>
                      <th className="pb-2 font-medium">Nullable</th>
                      <th className="pb-2 font-medium">Default / Generated</th>
                      <th className="pb-2 font-medium">Comment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text-primary)]">
                    {relation.columns.map((column) => (
                      <tr key={column.column_name}>
                        <td className="py-2 font-mono">{column.column_name}</td>
                        <td className="py-2 font-mono text-[var(--color-text-secondary)]">
                          {column.formatted_type}
                        </td>
                        <td className="py-2">{column.nullable ? "YES" : "NO"}</td>
                        <td className="max-w-64 truncate py-2 font-mono text-[var(--color-text-secondary)]">
                          {column.generated_expression ??
                            column.default_expression ??
                            column.identity_generation ??
                            "—"}
                        </td>
                        <td className="max-w-64 truncate py-2 text-[var(--color-text-secondary)]">
                          {column.comment ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">
                PK {relation.primary_key?.constraint_name ?? "—"} · FK{" "}
                {relation.foreign_keys.length} · Unique {relation.unique_constraints.length} · Check{" "}
                {relation.check_constraints.length} · Index {relation.indexes.length}
              </p>
            </details>
          ))
        )}
      </div>
    </section>
  );
}
