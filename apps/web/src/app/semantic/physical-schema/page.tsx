import { PhysicalSchemaBrowser } from "@/components/semantic/physical-schema-browser";

export default function PhysicalSchemaPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-secondary)] px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-4">
          <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
            语义层 · Physical Schema
          </h1>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            浏览 PostgreSQL catalog 快照与确定性 drift；这里只展示物理证据，不代表已发布语义。
          </p>
        </header>
        <PhysicalSchemaBrowser />
      </div>
    </main>
  );
}
