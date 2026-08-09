import type { SchemaDriftEvent, SchemaDriftOperation } from "@data-agent/contracts";

function operationTarget(operation: SchemaDriftOperation): string {
  if (operation.operation_kind === "RELATION_ADDED") {
    return `${operation.after.identity.schema_name}.${operation.after.identity.relation_name}`;
  }
  if (operation.operation_kind === "RELATION_REMOVED") {
    return `${operation.before.identity.schema_name}.${operation.before.identity.relation_name}`;
  }
  if ("column_name" in operation.identity) {
    return `${operation.identity.relation.schema_name}.${operation.identity.relation.relation_name}.${operation.identity.column_name}`;
  }
  if ("object_name" in operation.identity) {
    return `${operation.identity.relation.schema_name}.${operation.identity.relation.relation_name}.${operation.identity.object_name}`;
  }
  return `${operation.identity.schema_name}.${operation.identity.relation_name}`;
}

export function PhysicalSchemaDiff({ drift }: { drift: SchemaDriftEvent }) {
  return (
    <section
      aria-label="Physical Schema drift"
      data-current-snapshot-content-hash={drift.current_snapshot_content_hash}
      data-base-snapshot-content-hash={drift.base_snapshot_content_hash}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)]"
    >
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Physical Drift</h2>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {drift.severity} · Binding impact {drift.binding_impact}
          </span>
        </div>
      </header>
      {drift.operations.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          两个快照没有物理差异。
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {drift.operations.map((operation) => (
            <li
              key={`${operation.operation_kind}:${operationTarget(operation)}:${JSON.stringify(operation)}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
            >
              <div>
                <span className="font-medium text-[var(--color-text-primary)]">
                  {operation.operation_kind}
                </span>
                <code className="ml-2 text-[var(--color-text-secondary)]">
                  {operationTarget(operation)}
                </code>
              </div>
              <span className="text-[var(--color-text-secondary)]">{operation.severity}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
