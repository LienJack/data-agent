"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import type {
  SemanticDimension,
  SemanticMetric,
  SemanticModel,
  SemanticRelation,
  TableMapping,
} from "@/lib/data-link-types";
import { createProposal } from "@/lib/semantic-api";
import { useWorkspaceId } from "@/lib/use-workspace-id";
import { workspacePath } from "@/lib/workspace-routes";

interface SemanticEditorProps {
  /** 编辑模式：新建或修改 */
  mode: "new" | "edit";
  /** 修改模式下的已有模型 */
  model?: SemanticModel;
}

/**
 * 语义定义编辑器。
 *
 * 支持新建和修改语义定义。
 * 编辑完成后先保存为治理候选草稿；验证通过后才能进入审核流程。
 */
export function SemanticEditor({ mode, model }: SemanticEditorProps) {
  const router = useRouter();
  const workspaceId = useWorkspaceId();
  const [name, setName] = useState(model?.name ?? "");
  const [description, setDescription] = useState(model?.description ?? "");
  const [domain, setDomain] = useState(model?.domain ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !domain.trim()) {
      setError("请填写模型名称和域");
      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      const result = await createProposal({
        title: name.trim(),
        description: description.trim(),
        domain: domain.trim(),
        changeClass: "other",
        riskLevel: "medium",
        diff: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          domain: domain.trim(),
          metrics: model?.metrics ?? [],
          dimensions: model?.dimensions ?? [],
          tableMappings: model?.tableMappings ?? [],
          relationships: model?.relationships ?? [],
        }),
      });

      // M0 只创建 DRAFT，不伪造尚未存在的 ReviewPacket。
      router.push(
        workspacePath(
          workspaceId,
          `semantic?candidateId=${encodeURIComponent(result.candidate_id)}&status=draft`,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交审核失败");
    } finally {
      setSubmitting(false);
    }
  }, [name, description, domain, model, router, workspaceId]);

  const tabs = [
    {
      id: "basic",
      label: "基本信息",
      content: (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="semantic-model-name"
              className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
            >
              模型名称
            </label>
            <input
              id="semantic-model-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：销售额分析模型"
              className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="semantic-model-description"
              className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
            >
              描述
            </label>
            <textarea
              id="semantic-model-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="语义模型的简要描述"
              rows={3}
              className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="semantic-model-domain"
              className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
            >
              域
            </label>
            <input
              id="semantic-model-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="例如：sales、marketing"
              className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
            />
          </div>
        </div>
      ),
    },
    {
      id: "metrics",
      label: "指标",
      badge: model?.metrics.length ?? 0,
      content: <MetricsEditor metrics={model?.metrics ?? []} />,
    },
    {
      id: "dimensions",
      label: "维度",
      badge: model?.dimensions.length ?? 0,
      content: <DimensionsEditor dimensions={model?.dimensions ?? []} />,
    },
    {
      id: "tables",
      label: "表映射",
      badge: model?.tableMappings.length ?? 0,
      content: <TableMappingsEditor mappings={model?.tableMappings ?? []} />,
    },
    {
      id: "relationships",
      label: "关系",
      badge: model?.relationships.length ?? 0,
      content: <RelationshipsEditor relationships={model?.relationships ?? []} />,
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
          {mode === "new" ? "新建语义定义" : `编辑: ${model?.name}`}
        </h1>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          保存后先生成候选草稿，完成验证后才能提交审核
        </p>
      </div>

      <Separator className="mb-4" />

      <Tabs tabs={tabs} />

      {error && (
        <div className="mt-4 rounded-md bg-red-900/20 px-3 py-2 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <Button variant="primary" size="md" loading={submitting} onClick={handleSubmit}>
          保存候选草稿
        </Button>
        <Button variant="secondary" size="md" onClick={() => router.back()}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ─── 编辑器子组件（暂为只读展示） ───────────────────────────────────────────────

function MetricsEditor({ metrics }: { metrics: SemanticMetric[] }) {
  if (metrics.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        暂未定义指标。保存基础信息后可在详情页添加指标定义。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {metrics.map((m) => (
        <div
          key={m.id}
          className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{m.name}</span>
            <Badge variant="secondary">{m.aggregation}</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{m.formula}</p>
        </div>
      ))}
    </div>
  );
}

function DimensionsEditor({ dimensions }: { dimensions: SemanticDimension[] }) {
  if (dimensions.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        暂未定义维度。保存基础信息后可在详情页添加维度定义。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {dimensions.map((d) => (
        <div
          key={d.id}
          className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3"
        >
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{d.name}</span>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {d.table}.{d.column}
          </p>
        </div>
      ))}
    </div>
  );
}

function TableMappingsEditor({ mappings }: { mappings: TableMapping[] }) {
  if (mappings.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        暂未定义表映射。保存基础信息后可在详情页添加表映射。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {mappings.map((m) => (
        <div
          key={m.table}
          className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3"
        >
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{m.table}</span>
          {m.alias && (
            <span className="ml-2 text-xs text-[var(--color-text-muted)]">({m.alias})</span>
          )}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{m.columns.length} 列</p>
        </div>
      ))}
    </div>
  );
}

function RelationshipsEditor({ relationships }: { relationships: SemanticRelation[] }) {
  if (relationships.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        暂未定义关系。保存基础信息后可在详情页添加关系定义。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {relationships.map((r) => (
        <div
          key={r.id}
          className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-3"
        >
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{r.name}</span>
          <span className="ml-2 text-xs text-[var(--color-text-muted)]">({r.type})</span>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {r.sourceTable}.{r.sourceColumn} → {r.targetTable}.{r.targetColumn}
          </p>
        </div>
      ))}
    </div>
  );
}
