import type {
  SemanticExplorerCandidateComparison,
  SemanticExplorerDiff,
  SemanticExplorerReleaseTimeline,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";
import { useState } from "react";
import { CandidateComparisonBand } from "./candidate-comparison-band";

interface ReleaseControlsProps {
  readonly busy: boolean;
  readonly comparison: SemanticExplorerCandidateComparison | null;
  readonly diff: SemanticExplorerDiff | null;
  readonly snapshot: SemanticExplorerSnapshot;
  readonly timeline: SemanticExplorerReleaseTimeline | null;
  readonly onCompareCandidate: (candidateId: string, revisionId: string) => void;
  readonly onDiff: (baseReleaseId: string) => void;
  readonly onReleaseSelect: (releaseId: string) => void;
}

export function ReleaseControls({
  busy,
  comparison,
  diff,
  snapshot,
  timeline,
  onCompareCandidate,
  onDiff,
  onReleaseSelect,
}: ReleaseControlsProps) {
  const [baseReleaseId, setBaseReleaseId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const releases = timeline?.releases ?? [];

  return (
    <div className="space-y-3">
      <CandidateComparisonBand comparison={comparison} />
      <section className="grid gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">
              Release timeline
            </h2>
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              exact immutable release
            </span>
          </div>
          {releases.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {releases.map((release) => {
                const identity = release.release_identity;
                const selected = identity.release_id === snapshot.release_identity.release_id;
                return (
                  <button
                    key={identity.release_id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onReleaseSelect(identity.release_id)}
                    className={`min-w-40 rounded-md border px-3 py-2 text-left text-[11px] ${
                      selected
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-border-default)] hover:bg-[var(--color-bg-tertiary)]"
                    }`}
                  >
                    <span className="block font-semibold text-[var(--color-text-primary)]">
                      Generation {identity.release_generation}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-[var(--color-text-tertiary)]">
                      {identity.release_id.slice(0, 8)}…
                    </span>
                    <span className="mt-1 block text-[10px] text-[var(--color-text-secondary)]">
                      {release.is_current_at_observation ? "当前指针" : "历史版本"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">时间线尚未加载。</p>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-64 flex-1 text-[10px] text-[var(--color-text-tertiary)]">
              Base release
              <select
                value={baseReleaseId}
                onChange={(event) => setBaseReleaseId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-2 py-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
              >
                <option value="">选择 exact base release</option>
                {releases
                  .filter(
                    (release) =>
                      release.release_identity.release_id !== snapshot.release_identity.release_id,
                  )
                  .map((release) => (
                    <option
                      key={release.release_identity.release_id}
                      value={release.release_identity.release_id}
                    >
                      generation {release.release_identity.release_generation} ·{" "}
                      {release.release_identity.release_id}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !baseReleaseId}
              onClick={() => onDiff(baseReleaseId)}
              className="rounded-md border border-[var(--color-border-default)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40"
            >
              比较到所选版本
            </button>
          </div>
          {diff ? (
            <p className="mt-2 rounded-md bg-[var(--color-bg-secondary)] p-2 text-[11px] text-[var(--color-text-secondary)]">
              对象 +{diff.objects.added.length} / −{diff.objects.removed.length} / Δ
              {diff.objects.changed.length}；边 +{diff.edges.added.length} / −
              {diff.edges.removed.length} / Δ{diff.edges.changed.length}
            </p>
          ) : null}
        </div>

        <form
          className="border-t border-[var(--color-border-default)] pt-3 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0"
          onSubmit={(event) => {
            event.preventDefault();
            onCompareCandidate(candidateId, revisionId);
          }}
        >
          <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">
            Candidate comparison
          </h2>
          <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
            单独读取 exact candidate + revision，不合并到活动快照。
          </p>
          <input
            aria-label="Candidate ID"
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
            placeholder="Candidate UUID"
            className="mt-2 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-2 py-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
          />
          <input
            aria-label="Revision ID"
            value={revisionId}
            onChange={(event) => setRevisionId(event.target.value)}
            placeholder="Revision UUID"
            className="mt-2 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-2 py-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
          />
          <button
            type="submit"
            disabled={busy || !candidateId || !revisionId}
            className="mt-2 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
          >
            读取候选对比
          </button>
        </form>
      </section>
    </div>
  );
}
