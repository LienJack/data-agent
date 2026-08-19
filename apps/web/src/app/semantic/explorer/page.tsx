import Link from "next/link";
import { ExplorerWorkspace } from "@/components/semantic/explorer/explorer-workspace";

function explorerEnabled(): boolean {
  return (
    process.env.SEMANTIC_EXPLORER_ENABLED === "1" ||
    process.env.SEMANTIC_EXPLORER_ENABLED === "true"
  );
}

export default function SemanticExplorerPage({
  returnHref = "/workspaces",
}: {
  returnHref?: string;
}) {
  return (
    <main className="min-h-screen bg-[var(--color-bg-secondary)] px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[1680px]">
        <header className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            PostgreSQL authority · read only
          </p>
          <h1 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
            Semantic Layer Explorer
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--color-text-secondary)]">
            从同一份 immutable release 快照浏览语义对象、关系、版本差异与 lineage。Candidate
            仅在独立对比带显示，不会成为运行时真值。
          </p>
        </header>

        {explorerEnabled() ? (
          <ExplorerWorkspace />
        ) : (
          <section className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-8 text-center">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Semantic Explorer 当前未启用
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-[var(--color-text-secondary)]">
              设置服务端 SEMANTIC_EXPLORER_ENABLED 后才能读取已发布语义快照。关闭功能不会修改 active
              pointer、release 或 projection。
            </p>
            <Link
              href={returnHref}
              className="mt-4 inline-flex rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
            >
              返回 Review Workspace
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
