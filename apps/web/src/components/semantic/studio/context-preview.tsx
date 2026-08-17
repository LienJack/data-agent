"use client";

import type { ResolvedContextCommitResult, ResolvedContextState } from "@data-agent/contracts";
import { Database, ShieldCheck, SpinnerGap, WarningCircle } from "@phosphor-icons/react";

export type SemanticContextPreviewState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "RESOLVING" }
  | { readonly kind: "RESOLVED"; readonly result: ResolvedContextCommitResult }
  | { readonly kind: "ERROR"; readonly code: string };

const STATE_PRESENTATION: Record<
  ResolvedContextState,
  { readonly label: string; readonly className: string }
> = {
  READY: { label: "可用", className: "bg-[#e3efe9] text-[#285b4b]" },
  PARTIAL: { label: "部分可用", className: "bg-[#fff1d6] text-[#80530c]" },
  NEEDS_CLARIFICATION: { label: "需要澄清", className: "bg-[#fff1d6] text-[#80530c]" },
  REJECTED: { label: "已拒绝", className: "bg-[#f8e3df] text-[#8b3f31]" },
  STALE: { label: "已过期", className: "bg-[#e9ecea] text-[#59665f]" },
};

function shortHash(hash: string): string {
  return `${hash.slice(0, 15)}...${hash.slice(-8)}`;
}

function EmptyPreview({
  state,
}: {
  readonly state: Exclude<SemanticContextPreviewState, { kind: "RESOLVED" }>;
}) {
  const resolving = state.kind === "RESOLVING";
  const failed = state.kind === "ERROR";
  return (
    <section
      aria-busy={resolving}
      aria-label="Context Preview"
      className="grid min-h-40 place-items-center border border-[#d7ddd9] bg-[#f8faf8] px-5 py-8 text-center"
    >
      <div>
        {resolving ? (
          <SpinnerGap className="mx-auto size-5 animate-spin text-[#356b5a]" aria-hidden="true" />
        ) : failed ? (
          <WarningCircle className="mx-auto size-5 text-[#a34b39]" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mx-auto size-5 text-[#82908a]" aria-hidden="true" />
        )}
        <p className="mt-3 text-xs font-semibold text-[#34413b]">
          {resolving ? "正在解析上下文" : failed ? "上下文解析失败" : "尚未解析上下文"}
        </p>
        {failed ? (
          <code className="mt-2 block text-[10px] text-[#8b3f31]">{state.code}</code>
        ) : null}
      </div>
    </section>
  );
}

export function ContextPreview({ state }: { readonly state: SemanticContextPreviewState }) {
  if (state.kind !== "RESOLVED") return <EmptyPreview state={state} />;

  const { package: contextPackage, receipt } = state.result;
  const presentation = STATE_PRESENTATION[receipt.state];
  return (
    <section
      aria-label="Context Preview"
      className="overflow-hidden border border-[#d7ddd9] bg-white text-[#34413b]"
      data-context-package-hash={contextPackage.package_hash}
      data-context-state={receipt.state}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d7ddd9] bg-[#f8faf8] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6f7b75]">
            Context Preview
          </p>
          <p className="mt-1 truncate font-mono text-[10px] text-[#7b8781]">
            {contextPackage.package_id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[#6f7b75]">{receipt.route}</span>
          <span className={`px-2 py-1 text-[10px] font-semibold ${presentation.className}`}>
            {presentation.label}
          </span>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <IdentityRow
              label="Published Release"
              value={`${contextPackage.semantic_release.resource_id} · r${contextPackage.semantic_release.resource_revision}`}
              hash={contextPackage.semantic_release.resource_hash}
            />
            <IdentityRow
              label="Schema Snapshot"
              value={`${contextPackage.schema_snapshot.resource_id} · r${contextPackage.schema_snapshot.resource_revision}`}
              hash={contextPackage.schema_snapshot.resource_hash}
            />
          </div>

          {contextPackage.route_decision.clarification_candidates.length > 0 ? (
            <section className="mt-4 border-l-2 border-[#d19a2d] bg-[#fff9ec] px-3 py-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#80530c]">
                澄清候选
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
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6f7b75]">
              Evidence Projection
            </h3>
            {contextPackage.evidence.length > 0 ? (
              <ul className="mt-2 divide-y divide-[#e2e7e4] border-y border-[#e2e7e4]">
                {contextPackage.evidence.map((evidence) => (
                  <li
                    className="grid gap-1 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]"
                    key={`${evidence.evidence_kind}:${evidence.evidence_id}`}
                  >
                    <span className="font-mono text-[10px] text-[#6f7b75]">
                      {evidence.evidence_kind} · {evidence.evidence_id}
                    </span>
                    <span className="text-[11px] leading-5 text-[#48554f]">{evidence.summary}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-[#7b8781]">没有纳入 Evidence 摘要。</p>
            )}
          </section>
        </div>

        <aside className="border-t border-[#d7ddd9] bg-[#f8faf8] px-4 py-4 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-[#356b5a]" aria-hidden="true" />
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#59665f]">
              Context Capacity
            </h3>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 border-y border-[#d7ddd9] py-3 text-center">
            <CapacityStat label="上限" value={contextPackage.capacity.max_context_bytes} />
            <CapacityStat label="已纳入" value={contextPackage.capacity.included_bytes} />
            <CapacityStat label="已裁剪" value={contextPackage.capacity.cropped_bytes} />
          </dl>
          <ul className="mt-3 space-y-2">
            {contextPackage.capacity.items.map((item) => (
              <li
                className="flex items-start justify-between gap-3 text-[10px]"
                key={`${item.item_kind}:${item.item_id}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[#44514b]">{item.item_id}</span>
                  <span className="font-mono text-[#7b8781]">{item.reason_code}</span>
                </span>
                <span className="shrink-0 font-mono text-[#59665f]">{item.disposition}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 break-all font-mono text-[9px] leading-4 text-[#7b8781]">
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
    <div className="min-w-0 border-l-2 border-[#c2d2cb] pl-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7b8781]">{label}</p>
      <p className="mt-1 truncate font-mono text-[10px] text-[#44514b]">{value}</p>
      <p className="mt-1 font-mono text-[9px] text-[#8a948f]">{shortHash(hash)}</p>
    </div>
  );
}

function CapacityStat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt className="text-[9px] text-[#7b8781]">{label}</dt>
      <dd className="mt-1 font-mono text-[11px] font-semibold text-[#34413b]">{value}</dd>
    </div>
  );
}
