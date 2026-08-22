"use client";

import type { ResolvedContextCommitResult, ResolvedContextState } from "@data-agent/contracts";
import { Database, ShieldCheck, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";

export type SemanticContextPreviewState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "RESOLVING" }
  | { readonly kind: "RESOLVED"; readonly result: ResolvedContextCommitResult }
  | { readonly kind: "ERROR"; readonly code: string };

const STATE_PRESENTATION: Record<
  ResolvedContextState,
  { readonly labelKey: MessageKey; readonly className: string }
> = {
  READY: {
    labelKey: "context.state.READY",
    className: "bg-[var(--color-accent-soft)] text-[var(--color-accent-hover)]",
  },
  PARTIAL: { labelKey: "context.state.PARTIAL", className: "bg-[#fff1d6] text-[#80530c]" },
  NEEDS_CLARIFICATION: {
    labelKey: "context.state.NEEDS_CLARIFICATION",
    className: "bg-[#fff1d6] text-[#80530c]",
  },
  REJECTED: { labelKey: "context.state.REJECTED", className: "bg-[#f8e3df] text-[#8b3f31]" },
  STALE: {
    labelKey: "context.state.STALE",
    className: "bg-[#e9ecea] text-[var(--color-text-secondary)]",
  },
};

function shortHash(hash: string): string {
  return `${hash.slice(0, 15)}...${hash.slice(-8)}`;
}

function EmptyPreview({
  state,
}: {
  readonly state: Exclude<SemanticContextPreviewState, { kind: "RESOLVED" }>;
}) {
  const { t } = useWorkspaceI18n();
  const resolving = state.kind === "RESOLVING";
  const failed = state.kind === "ERROR";
  return (
    <section
      aria-busy={resolving}
      aria-label={t("context.preview")}
      className="grid min-h-40 place-items-center border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] px-5 py-8 text-center"
    >
      <div>
        {resolving ? (
          <SpinnerGap
            className="mx-auto size-5 animate-spin text-[var(--color-accent)]"
            aria-hidden="true"
          />
        ) : failed ? (
          <WarningCircle className="mx-auto size-5 text-[#a34b39]" aria-hidden="true" />
        ) : (
          <ShieldCheck
            className="mx-auto size-5 text-[var(--color-text-muted)]"
            aria-hidden="true"
          />
        )}
        <p className="mt-3 text-xs font-semibold text-[var(--color-text-secondary)]">
          {resolving ? t("context.resolving") : failed ? t("context.failed") : t("context.idle")}
        </p>
        {failed ? (
          <code className="mt-2 block text-[10px] text-[#8b3f31]">{state.code}</code>
        ) : null}
      </div>
    </section>
  );
}

export function ContextPreview({ state }: { readonly state: SemanticContextPreviewState }) {
  const { t } = useWorkspaceI18n();
  if (state.kind !== "RESOLVED") return <EmptyPreview state={state} />;

  const { package: contextPackage, receipt } = state.result;
  const presentation = STATE_PRESENTATION[receipt.state];
  return (
    <section
      aria-label={t("context.preview")}
      className="overflow-hidden border border-[var(--color-border-default)] bg-white text-[var(--color-text-secondary)]"
      data-context-package-hash={contextPackage.package_hash}
      data-context-state={receipt.state}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            {t("context.preview")}
          </p>
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
            {contextPackage.package_id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
            {receipt.route}
          </span>
          <span className={`px-2 py-1 text-[10px] font-semibold ${presentation.className}`}>
            {t(presentation.labelKey)}
          </span>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <IdentityRow
              label={t("context.release")}
              value={`${contextPackage.semantic_release.resource_id} · r${contextPackage.semantic_release.resource_revision}`}
              hash={contextPackage.semantic_release.resource_hash}
            />
            <IdentityRow
              label={t("context.schema")}
              value={`${contextPackage.schema_snapshot.resource_id} · r${contextPackage.schema_snapshot.resource_revision}`}
              hash={contextPackage.schema_snapshot.resource_hash}
            />
          </div>

          {contextPackage.route_decision.clarification_candidates.length > 0 ? (
            <section className="mt-4 border-l-2 border-[#d19a2d] bg-[#fff9ec] px-3 py-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#80530c]">
                {t("context.clarification")}
              </h3>
              <ul className="mt-2 space-y-1 text-[11px] text-[#5f553f]">
                {contextPackage.route_decision.clarification_candidates.map((candidate) => (
                  <li key={`${candidate.candidate_kind}:${candidate.candidate_id}`}>
                    {candidate.label} · {candidate.candidate_kind}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              {t("context.evidence")}
            </h3>
            {contextPackage.evidence.length > 0 ? (
              <ul className="mt-2 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
                {contextPackage.evidence.map((evidence) => (
                  <li
                    className="grid gap-1 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]"
                    key={`${evidence.evidence_kind}:${evidence.evidence_id}`}
                  >
                    <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                      {evidence.evidence_kind} · {evidence.evidence_id}
                    </span>
                    <span className="text-[11px] leading-5 text-[var(--color-text-secondary)]">
                      {evidence.summary}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                {t("context.noEvidence")}
              </p>
            )}
          </section>
        </div>

        <aside className="border-t border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] px-4 py-4 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-[var(--color-accent)]" aria-hidden="true" />
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
              {t("context.capacity")}
            </h3>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 border-y border-[var(--color-border-default)] py-3 text-center">
            <CapacityStat
              label={t("context.limit")}
              value={contextPackage.capacity.max_context_bytes}
            />
            <CapacityStat
              label={t("context.included")}
              value={contextPackage.capacity.included_bytes}
            />
            <CapacityStat
              label={t("context.cropped")}
              value={contextPackage.capacity.cropped_bytes}
            />
          </dl>
          <ul className="mt-3 space-y-2">
            {contextPackage.capacity.items.map((item) => (
              <li
                className="flex items-start justify-between gap-3 text-[10px]"
                key={`${item.item_kind}:${item.item_id}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-text-secondary)]">
                    {item.item_id}
                  </span>
                  <span className="font-mono text-[var(--color-text-muted)]">
                    {item.reason_code}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[var(--color-text-secondary)]">
                  {item.disposition}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 break-all font-mono text-[9px] leading-4 text-[var(--color-text-muted)]">
            package {shortHash(contextPackage.package_hash)}
          </p>
        </aside>
      </div>
    </section>
  );
}

function IdentityRow({
  label,
  value,
  hash,
}: {
  readonly label: string;
  readonly value: string;
  readonly hash: string;
}) {
  return (
    <div className="min-w-0 border-l-2 border-[var(--color-border-overlay)] pl-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
        {value}
      </p>
      <p className="mt-1 font-mono text-[9px] text-[var(--color-text-muted)]">{shortHash(hash)}</p>
    </div>
  );
}

function CapacityStat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt className="text-[9px] text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 font-mono text-[11px] font-semibold text-[var(--color-text-secondary)]">
        {value}
      </dd>
    </div>
  );
}
