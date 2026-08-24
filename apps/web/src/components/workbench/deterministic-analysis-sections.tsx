import type { DeterministicAnalysisRunProjection } from "@data-agent/contracts";

const tierLabels = {
  FACT: "事实",
  PATTERN: "模式",
  DRIVER: "驱动候选",
  INTERPRETATION: "解释",
  RECOMMENDATION_CANDIDATE: "建议候选",
} as const;

const evidenceLabels = {
  L2_OBSERVATION: "L2 观测",
  L4_DISCOVERY: "L4 根因候选",
  L5_CERTIFIED: "L5 已认证",
} as const;

function shortHash(value: string) {
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function terminalTone(terminal: DeterministicAnalysisRunProjection["terminal"]) {
  if (terminal === "READY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (terminal === "PARTIAL") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

export function DeterministicAnalysisSections({
  analysis,
}: {
  readonly analysis: DeterministicAnalysisRunProjection;
}) {
  const acceptedFindings = analysis.findings.filter(({ status }) => status === "ACCEPTED");
  const candidateFindings = analysis.findings.filter(({ status }) => status !== "ACCEPTED");

  return (
    <section
      className="border-t border-[var(--color-border-default)] py-7"
      aria-labelledby="deterministic-analysis-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Deterministic Analysis
          </p>
          <h2
            id="deterministic-analysis-heading"
            className="mt-1 text-lg font-semibold tracking-[-0.01em]"
          >
            自动分析证据链
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
            只显示已提交节点、受验收 Finding 与安全投影；原始执行材料和私有诊断不在此视图公开。
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${terminalTone(analysis.terminal)}`}
        >
          {analysis.terminal}
        </span>
      </div>

      <div className="mt-5 overflow-x-auto border-y border-[var(--color-border-default)]">
        <table className="w-full min-w-[680px] border-collapse text-left text-[12px]">
          <thead className="bg-[var(--color-bg-canvas)] text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">节点</th>
              <th className="px-3 py-2 font-semibold">Skill</th>
              <th className="px-3 py-2 font-semibold">重要性</th>
              <th className="px-3 py-2 font-semibold">状态</th>
              <th className="px-3 py-2 font-semibold">证据</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-default)]">
            {analysis.nodes.map((node) => (
              <tr key={node.node_id}>
                <td className="px-3 py-3 font-medium text-[var(--color-text-primary)]">
                  {node.node_id}
                </td>
                <td className="px-3 py-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
                  {node.skill_id}
                </td>
                <td className="px-3 py-3 text-[var(--color-text-secondary)]">
                  {node.criticality === "CRITICAL" ? "关键" : "可选"}
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-[10px]">{node.status}</span>
                  {node.reason_codes.length > 0 ? (
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      {node.reason_codes.join(" · ")}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {node.evidence_ref ? shortHash(node.evidence_ref.content_hash) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <h3 className="text-sm font-semibold">已验收 Findings</h3>
          {acceptedFindings.length > 0 ? (
            <ol className="mt-3 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
              {acceptedFindings.map((finding) => (
                <li key={finding.finding_id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="font-semibold text-[var(--color-text-secondary)]">
                      {tierLabels[finding.tier]}
                    </span>
                    <span className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[var(--color-text-muted)]">
                      {evidenceLabels[finding.evidence_level]}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] font-medium leading-6">{finding.statement}</p>
                  <p className="mt-1 font-mono text-[9px] text-[var(--color-text-muted)]">
                    {finding.evidence_ref.artifact_type} · rev {finding.evidence_ref.revision} ·{" "}
                    {shortHash(finding.evidence_ref.content_hash)}
                  </p>
                  {finding.disclosure_codes.length > 0 ? (
                    <p className="mt-1 text-[10px] text-amber-700">
                      {finding.disclosure_codes.join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
              当前没有可作为已接受结论显示的 Finding。
            </p>
          )}
          {candidateFindings.length > 0 ? (
            <details className="mt-4 border-l-2 border-amber-300 pl-3">
              <summary className="cursor-pointer text-[12px] font-semibold text-amber-800">
                查看 {candidateFindings.length} 个候选 / HOLD Finding
              </summary>
              <ul className="mt-2 space-y-2 text-[12px] text-[var(--color-text-secondary)]">
                {candidateFindings.map((finding) => (
                  <li key={finding.finding_id}>
                    {tierLabels[finding.tier]} · {finding.statement} · {finding.status}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <aside className="border-l border-[var(--color-border-default)] pl-5" aria-label="根因等级">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
            Root Cause Ladder
          </p>
          <p className="mt-2 text-sm font-semibold">{analysis.root_cause.level}</p>
          <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
            {analysis.root_cause.level === "L5_CERTIFIED"
              ? "已绑定当前 Identification Certificate；因果措辞仍必须披露假设边界。"
              : analysis.root_cause.level === "L4_DISCOVERY"
                ? "仅为根因候选，不代表因果识别。"
                : analysis.root_cause.level === "HOLD"
                  ? "识别、重叠、反驳或前沿门存在缺口。"
                  : "本次运行未进入根因调查。"}
          </p>
          {analysis.root_cause.disclosures.length > 0 ? (
            <ul className="mt-3 space-y-1 text-[10px] text-amber-700">
              {analysis.root_cause.disclosures.map((disclosure) => (
                <li key={disclosure}>{disclosure}</li>
              ))}
            </ul>
          ) : null}
        </aside>
      </div>

      <details className="mt-6 border-y border-[var(--color-border-default)] py-3">
        <summary className="cursor-pointer text-[12px] font-semibold">
          方法与 Evidence Drawer
        </summary>
        <div className="mt-3 divide-y divide-[var(--color-border-default)]">
          {analysis.methods.map((method) => (
            <dl
              key={`${method.evidence_ref.artifact_id}:${method.evidence_ref.revision}`}
              className="grid gap-x-4 gap-y-1 py-3 text-[10px] sm:grid-cols-[130px_minmax(0,1fr)]"
            >
              <dt className="text-[var(--color-text-muted)]">Skill / Algorithm</dt>
              <dd className="font-mono">
                {method.skill_id} · {method.algorithm_version}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Program / Receipt</dt>
              <dd className="break-all font-mono">
                {shortHash(method.analysis_program_ref.content_hash)} ·{" "}
                {shortHash(method.receipt_ref.content_hash)}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Runtime / Images</dt>
              <dd className="break-all font-mono">
                {method.runtime_profile} · {method.agent_image} · {method.operator_image}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Parameter / Input</dt>
              <dd className="break-all font-mono">
                {shortHash(method.parameter_hash)} · {shortHash(method.input_closure_hash)}
              </dd>
              <dt className="text-[var(--color-text-muted)]">样本 / 限制</dt>
              <dd>
                {method.sample_size} · {method.limitation_codes.join(" · ") || "无"}
              </dd>
            </dl>
          ))}
        </div>
      </details>

      {analysis.limitations.length > 0 ? (
        <div className="mt-5 border-l-2 border-amber-300 pl-3">
          <h3 className="text-[11px] font-semibold text-amber-800">统一限制披露</h3>
          <ul className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--color-text-secondary)]">
            {analysis.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
