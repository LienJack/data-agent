import type {
  SemanticBindingImpactSafeProjection,
  SemanticExplorerCandidateComparison,
} from "@data-agent/contracts";

interface CandidateComparisonBandProps {
  readonly comparison: SemanticExplorerCandidateComparison | null;
  readonly impact?: SemanticBindingImpactSafeProjection | null;
}

const RISK_CLASS = {
  LOW: "bg-[#edf8f1] text-[#28643d]",
  MEDIUM: "bg-[#fff6df] text-[#80530c]",
  HIGH: "bg-[#fff0df] text-[#8a4b15]",
  CRITICAL: "bg-[#f8e3df] text-[#8b3f31]",
} as const;

export function CandidateComparisonBand({
  comparison,
  impact = null,
}: CandidateComparisonBandProps) {
  if (!comparison && !impact) return null;
  const stale = comparison?.comparison_state.state === "stale";
  return (
    <section
      aria-label="语义绑定影响与候选版本对比"
      className="overflow-hidden rounded-[14px] border border-[var(--color-border-default)] bg-white"
    >
      {impact ? <BindingImpactSummary impact={impact} /> : null}
      {comparison ? (
        <div
          className={`px-4 py-3 ${
            impact ? "border-t border-[var(--color-border-default)]" : ""
          } ${stale ? "bg-[#fff9ec]" : "bg-[var(--color-accent-soft)]/45"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                  stale
                    ? "bg-[#fff1d6] text-[#80530c]"
                    : "bg-white text-[var(--color-accent-hover)]"
                }`}
              >
                {stale ? "STALE" : comparison.candidate_status}
              </span>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Candidate 对比（不属于活动对象集合）
              </h2>
            </div>
            <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
              revision {comparison.revision_number}
            </span>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            {comparison.diff.summary} · {comparison.diff.operations.length} 个确定性操作
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-tertiary)]">
            candidate {comparison.candidate_id} · revision {comparison.revision_id}
          </p>
          {stale ? (
            <p className="mt-2 text-xs font-medium text-[#80530c]">
              漂移原因：{comparison.comparison_state.reason_code}。此候选不会进入 published
              counts、graph 或 runtime。
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-accent-hover)]">
              仅供比较；仍需进入现有验证与治理流程，Explorer 不执行审批、发布或回滚。
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function BindingImpactSummary({
  impact,
}: {
  readonly impact: SemanticBindingImpactSafeProjection;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            Schema Drift Binding Impact
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
            {impact.status === "REVIEW_REQUIRED"
              ? "需要人工审核"
              : impact.status === "MANUAL_INVESTIGATION"
                ? "需要人工调查"
                : "无需语义变更"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-[10px] font-bold ${RISK_CLASS[impact.risk_level]}`}>
            {impact.risk_level}
          </span>
          <span className="bg-[var(--color-bg-overlay)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-secondary)]">
            {impact.status}
          </span>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ImpactDatum label="直接影响" value={String(impact.direct_impact_count)} />
        <ImpactDatum label="传递影响" value={String(impact.transitive_impact_count)} />
        <ImpactDatum label="Release generation" value={String(impact.release.generation)} mono />
        <ImpactDatum label="Candidate" value={impact.candidate_ref ? "DRAFT / 待验证" : "未创建"} />
      </dl>

      <div className="mt-3 grid gap-3 border-t border-[var(--color-border-default)] pt-3 lg:grid-cols-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
            建议动作
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
            {impact.suggested_actions.length > 0
              ? impact.suggested_actions.join(" · ")
              : "NO_SEMANTIC_ACTION"}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
            人工原因
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
            {impact.manual_reason_codes.length > 0 ? impact.manual_reason_codes.join(" · ") : "无"}
          </p>
        </div>
      </div>
      <p className="mt-3 break-all font-mono text-[9px] leading-4 text-[var(--color-text-tertiary)]">
        exact release {impact.release.release_id} · {impact.release.release_digest}
      </p>
      <p className="break-all font-mono text-[9px] leading-4 text-[var(--color-text-tertiary)]">
        impact {impact.impact_id} · drift {impact.drift_event_id}
      </p>
    </div>
  );
}

function ImpactDatum({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="border-l-2 border-[var(--color-border-overlay)] pl-3">
      <dt className="text-[9px] text-[var(--color-text-tertiary)]">{label}</dt>
      <dd
        className={`mt-1 text-[11px] font-semibold text-[var(--color-text-secondary)] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
