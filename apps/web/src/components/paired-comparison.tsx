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
    <div className="space-y-4">
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
          >
            {improvement ? "↑" : "↓"}
          </span>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {improvement ? "提升" : "下降"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--color-text-tertiary)]">候选</p>
          <p className="mt-1 text-sm font-mono font-medium">{candidate}</p>
        </div>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            指标对比
          </h4>
          {metrics.map((metric) => {
            const delta = metric.candidate - metric.baseline;
            const pctChange =
              metric.baseline > 0 ? ((delta / metric.baseline) * 100).toFixed(1) : "N/A";
            return (
              <div key={metric.name} className="rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{metric.name}</span>
                  <span
                    className={`text-xs font-medium ${
                      delta > 0
                        ? "text-[var(--color-success)]"
                        : delta < 0
                          ? "text-[var(--color-error)]"
                          : "text-[var(--color-text-tertiary)]"
                    }`}
                  >
                    {delta > 0 ? "+" : ""}
                    {pctChange}%
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-[var(--color-text-tertiary)]">
                      <span>基线: {metric.baseline.toFixed(2)}</span>
                      <span>候选: {metric.candidate.toFixed(2)}</span>
                    </div>
                    <div className="mt-1 flex h-2 rounded-full bg-[var(--color-bg-tertiary)]">
                      <div
                        className="rounded-l-full bg-[var(--color-text-tertiary)]"
                        style={{
                          width: `${Math.min(metric.baseline * 100, 100)}%`,
                        }}
                      />
                      <div
                        className="rounded-r-full bg-[var(--color-accent)]"
                        style={{
                          width: `${Math.min((metric.candidate - metric.baseline) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
