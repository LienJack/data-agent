"use client";

import type { DatasourceAdapterRegistrySnapshot } from "@data-agent/contracts";
import { CheckCircle, Database, File, LockKey, WarningCircle } from "@phosphor-icons/react";
import { DataSourceMark } from "@/components/data-sources/data-source-mark";

const capabilityOrder = ["CONNECTION", "SCHEMA_SCAN", "GOVERNED_QUERY"] as const;
const capabilityLabels = {
  CONNECTION: "连接",
  SCHEMA_SCAN: "Schema",
  GOVERNED_QUERY: "查询",
} as const;

function rank(value: "BLOCKED" | (typeof capabilityOrder)[number]): number {
  return value === "BLOCKED" ? -1 : capabilityOrder.indexOf(value);
}

export function DatasourceGallery({
  snapshot,
}: {
  readonly snapshot: DatasourceAdapterRegistrySnapshot;
}) {
  return (
    <section aria-labelledby="datasource-gallery-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="datasource-gallery-title" className="text-sm font-semibold">
            Adapter Registry
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {snapshot.platform_ready ? "5 / 5 已认证" : "认证未闭合"}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          {snapshot.platform_ready ? <CheckCircle size={15} /> : <WarningCircle size={15} />}
          {snapshot.platform_ready ? "READY" : "BLOCKED"}
        </span>
      </div>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {snapshot.items.map(({ descriptor, certification, effective_capability }) => (
          <li
            key={descriptor.adapter_id}
            className="min-w-0 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3"
          >
            <div className="flex items-start gap-2.5">
              <DataSourceMark type={descriptor.adapter_id} size="sm" />
              <div className="min-w-0">
                <h3 className="truncate text-xs font-semibold">{descriptor.display_name}</h3>
                <p className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">
                  {descriptor.driver.package_name}@{descriptor.driver.version}
                </p>
              </div>
            </div>
            <fieldset className="mt-3 flex items-center gap-1">
              <legend className="sr-only">Adapter 能力</legend>
              {capabilityOrder.map((capability, index) => {
                const ready = rank(effective_capability) >= index;
                return (
                  <span
                    key={capability}
                    className={`inline-flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded border px-1 text-[9px] ${
                      ready
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-[var(--color-border-default)] text-[var(--color-text-muted)]"
                    }`}
                  >
                    {ready ? <CheckCircle size={11} /> : <LockKey size={11} />}
                    <span className="truncate">{capabilityLabels[capability]}</span>
                  </span>
                );
              })}
            </fieldset>
            <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-1">
                {descriptor.category === "FILE" ? <File size={12} /> : <Database size={12} />}
                {descriptor.category}
              </span>
              <span>{certification?.result ?? "NOT_CERTIFIED"}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
