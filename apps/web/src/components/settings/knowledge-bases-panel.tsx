"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { ArrowRight, Books } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

type Props = { readonly workspaces: readonly WorkspaceAccessProjection[] };

export function KnowledgeBasesPanel({ workspaces }: Props) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspace.workspace_id ?? "");
  const workspace = workspaces.find((item) => item.workspace.workspace_id === workspaceId);

  return (
    <section className="border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Knowledge authority
          </p>
          <h2 className="mt-1 text-lg font-semibold">知识库资产已迁移到独立工作区</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            Markdown 上传、不可变
            Revision、段落选择、纠错注释、使用情况和语义生成统一在知识库页面维护。
            设置页不再提供第二套创建、重建或检索入口。
          </p>
        </div>
        <div className="grid min-w-64 gap-2">
          <label className="text-[10px] text-[var(--color-text-muted)]">
            Workspace
            <select
              aria-label="Knowledge Workspace"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="mt-1 min-h-10 w-full border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-sm"
            >
              {workspaces.map((item) => (
                <option key={item.workspace.workspace_id} value={item.workspace.workspace_id}>
                  {item.workspace.display_name}
                </option>
              ))}
            </select>
          </label>
          {workspace ? (
            <Link
              href={`/w/${encodeURIComponent(workspace.workspace.workspace_id)}/knowledge`}
              className="inline-flex min-h-10 items-center justify-center gap-2 bg-[var(--color-accent)] px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              <Books className="size-4" />
              打开知识库
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <p className="border border-dashed border-[var(--color-border-default)] p-3 text-xs text-[var(--color-text-muted)]">
              当前没有可访问的 Workspace。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
