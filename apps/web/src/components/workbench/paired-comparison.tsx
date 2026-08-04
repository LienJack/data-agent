"use client";

interface PairedComparisonProps {
  baseline: string;
  candidate: string;
  improvement: boolean;
  metrics?: {
    name: string;
    baseline: number;
    candidate: number;
  }[];
}

export function PairedComparison({
  baseline,
  candidate,
  improvement,
  metrics,
}: PairedComparisonProps) {
  return (
    <div className="space-y-4" aria-label="成对对比">
      <div className="flex items-center justify-between rounded-lg bg-[var(--color-bg-secondary)] p-3">
        <div className="text-center">
          <p className="text-xs text-[var(--color-text-tertiary)]">基线</p>
          <p className="mt-1 text-sm font-mono font-medium">{baseline}</p>
        </div>
        <div className="text-center">
          <span
            className={`text-lg font-bold ${
              improvement ? "text-[var(--color-success)]" : "text-[var(--color-error)]"
            }`}
            aria-label={improvement ? "对比结果: 改善" : "对比结果: 退步"}
          >
            {improvement ? "↑" : "↓"}
          </span>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--color-text-tertiary)]">候选</p>
          <p className="mt-1 text-sm font-mono font-medium">{candidate}</p>
        </div>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="space-y-2" aria-label="指标详情">
          {metrics.map((metric) => (
            <div
              key={metric.name}
              className="flex items-center justify-between rounded-md bg-[var(--color-bg-secondary)] px-3 py-2"
            >
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                {metric.name}
              </span>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-[var(--color-text-tertiary)]">
                  基线: <span className="font-mono font-medium">{metric.baseline}</span>
                </span>
                <span className="text-[var(--color-text-tertiary)]">
                  候选:{" "}
                  <span
                    className={`font-mono font-medium ${
                      metric.candidate >= metric.baseline
                        ? "text-[var(--color-success)]"
                        : "text-[var(--color-error)]"
                    }`}
                  >
                    {metric.candidate}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
