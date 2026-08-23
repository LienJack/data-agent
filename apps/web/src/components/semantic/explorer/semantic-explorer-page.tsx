import Link from "next/link";
import { workspacePath } from "@/lib/workspace-routes";
import { ExplorerWorkspace } from "./explorer-workspace";

export function SemanticExplorerPage({ workspaceId }: { readonly workspaceId: string }) {
  return (
    <main className="min-h-screen bg-[var(--color-bg-secondary)] px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[1680px]">
        <header className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            PostgreSQL authority · read only
          </p>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                Semantic Layer Explorer
              </h1>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--color-text-secondary)]">
                从同一份 immutable release 快照浏览语义对象、关系、版本差异与 lineage。Candidate
                仅在独立对比带显示，不会成为运行时真值。
              </p>
            </div>
            <Link
              href={workspacePath(workspaceId)}
              className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)]"
            >
              返回工作空间
            </Link>
          </div>
        </header>
        <ExplorerWorkspace key={workspaceId} workspaceId={workspaceId} />
      </div>
    </main>
  );
}
