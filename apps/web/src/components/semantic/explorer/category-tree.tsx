import type {
  SemanticExplorerDomainSummary,
  SemanticExplorerObjectKind,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";
import { EXPLORER_KIND_LABELS, EXPLORER_KINDS } from "./view-model";

interface CategoryTreeProps {
  readonly category: SemanticExplorerObjectKind | null;
  readonly domain: string;
  readonly domains: readonly SemanticExplorerDomainSummary[];
  readonly snapshot: SemanticExplorerSnapshot;
  readonly onCategoryChange: (kind: SemanticExplorerObjectKind | null) => void;
  readonly onDomainChange: (domain: string) => void;
}

export function CategoryTree({
  category,
  domain,
  domains,
  snapshot,
  onCategoryChange,
  onDomainChange,
}: CategoryTreeProps) {
  return (
    <nav aria-label="语义域与对象分类" className="space-y-4">
      <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
        Domain
        <select
          aria-label="选择语义域"
          value={domain}
          onChange={(event) => onDomainChange(event.target.value)}
          className="mt-1.5 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-xs text-[var(--color-text-primary)]"
        >
          {domains.map((item) => (
            <option key={item.semantic_domain} value={item.semantic_domain}>
              {item.display_name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
          Published objects
        </p>
        <div className="space-y-1">
          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => onCategoryChange(null)}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs ${
              category === null
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
            }`}
          >
            <span>全部对象</span>
            <span className="font-mono tabular-nums">{snapshot.counts.total_objects}</span>
          </button>
          {EXPLORER_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={category === kind}
              onClick={() => onCategoryChange(kind)}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs ${
                category === kind
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              }`}
            >
              <span>{EXPLORER_KIND_LABELS[kind]}</span>
              <span className="font-mono tabular-nums">{snapshot.counts.by_object_kind[kind]}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
