"use client";

import {
  SEMANTIC_IMPORT_MAX_BYTES,
  type SemanticDatasourceMapping,
  type SemanticImportJob,
  type SemanticImportState,
  type SemanticImportTarget,
  type SemanticWorkspaceExport,
  type WorkspaceAccessProjection,
} from "@data-agent/contracts";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveWorkspaceId, workspaceRequestHeaders } from "@/lib/api-client";

interface SemanticPortabilityPanelProps {
  readonly workspaces: readonly WorkspaceAccessProjection[];
}

interface ApiFailure {
  readonly error?: { readonly message?: string };
}

const stateLabel: Readonly<Record<SemanticImportState, string>> = {
  UPLOADED: "已上传",
  VALIDATED: "已校验",
  AWAITING_DATASOURCE_MAPPING: "待映射",
  READY: "可创建草稿",
  DRAFT_CREATED: "草稿已创建",
  FAILED: "失败",
  CANCELLED: "已取消",
};

function stateVariant(
  state: SemanticImportState,
): "secondary" | "warning" | "success" | "danger" | "outline" {
  if (state === "DRAFT_CREATED" || state === "READY") return "success";
  if (state === "FAILED") return "danger";
  if (state === "CANCELLED") return "outline";
  if (state === "AWAITING_DATASOURCE_MAPPING") return "warning";
  return "secondary";
}

function workspacePath(workspaceId: string, suffix: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/semantic/portability/${suffix}`;
}

async function api<T>(workspaceId: string, suffix: string, init?: RequestInit): Promise<T> {
  const response = await fetch(workspacePath(workspaceId, suffix), {
    cache: "no-store",
    ...init,
    headers: { ...workspaceRequestHeaders(workspaceId), ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as ApiFailure & { readonly data?: T };
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? `请求失败 (${response.status})`);
  }
  return body.data;
}

function operation(schemaVersion: "semantic-import-command@1.0.0") {
  return {
    schema_version: schemaVersion,
    operation_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
  };
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SemanticPortabilityPanel({ workspaces }: SemanticPortabilityPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [imports, setImports] = useState<readonly SemanticImportJob[]>([]);
  const [targets, setTargets] = useState<readonly SemanticImportTarget[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string>();
  const [mappingValues, setMappingValues] = useState<Readonly<Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const routed = resolveWorkspaceId();
    const initial = workspaces.some((item) => item.workspace.workspace_id === routed)
      ? routed
      : (workspaces[0]?.workspace.workspace_id ?? "");
    setWorkspaceId(initial);
  }, [workspaces]);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(undefined);
    try {
      const [nextImports, nextTargets] = await Promise.all([
        api<readonly SemanticImportJob[]>(workspaceId, "imports"),
        api<readonly SemanticImportTarget[]>(workspaceId, "targets"),
      ]);
      setImports(nextImports);
      setTargets(nextTargets);
      setSelectedImportId((current) =>
        current && nextImports.some((item) => item.import_id === current)
          ? current
          : nextImports[0]?.import_id,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "语义移植控制台加载失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => void reload(), [reload]);

  const selectedWorkspace = workspaces.find((item) => item.workspace.workspace_id === workspaceId);
  const canWrite = selectedWorkspace?.allowed_actions.includes("SEMANTIC_EDIT") ?? false;
  const selectedImport = imports.find((item) => item.import_id === selectedImportId);

  useEffect(() => {
    if (!selectedImport) {
      setMappingValues({});
      return;
    }
    setMappingValues(
      Object.fromEntries(
        selectedImport.mappings.map((mapping) => [
          mapping.logical_ref,
          `${mapping.target_datasource_id}|${mapping.target_semantic_domain}`,
        ]),
      ),
    );
  }, [selectedImport]);

  const mappings = useMemo<readonly SemanticDatasourceMapping[]>(() => {
    if (!selectedImport) return [];
    return selectedImport.datasource_refs.flatMap((reference) => {
      const [targetDatasourceId, targetSemanticDomain] = (
        mappingValues[reference.logical_ref] ?? ""
      ).split("|");
      return targetDatasourceId && targetSemanticDomain
        ? [
            {
              logical_ref: reference.logical_ref,
              target_datasource_id: targetDatasourceId,
              target_semantic_domain: targetSemanticDomain,
            },
          ]
        : [];
    });
  }, [mappingValues, selectedImport]);

  async function exportSemantic() {
    if (!workspaceId) return;
    setPending("export");
    setError(undefined);
    try {
      const response = await fetch(workspacePath(workspaceId, "export"), {
        cache: "no-store",
        headers: workspaceRequestHeaders(workspaceId),
      });
      const body = (await response.json().catch(() => ({}))) as ApiFailure &
        SemanticWorkspaceExport;
      if (!response.ok) throw new Error(body.error?.message ?? `导出失败 (${response.status})`);
      const blob = new Blob([`${JSON.stringify(body, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `semantic-workspace-${workspaceId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("已导出当前工作空间的已发布语义版本。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "语义导出失败");
    } finally {
      setPending(undefined);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !workspaceId) return;
    if (file.size > SEMANTIC_IMPORT_MAX_BYTES) {
      setError("文件超过 1 MiB 上限。");
      return;
    }
    setPending("upload");
    setError(undefined);
    setNotice(undefined);
    try {
      const document = JSON.parse(await file.text()) as unknown;
      const importId = crypto.randomUUID();
      const created = await api<SemanticImportJob>(workspaceId, "imports", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "semantic-import-upload@1.0.0",
          operation_id: importId,
          idempotency_key: crypto.randomUUID(),
          file_name: file.name,
          byte_size: file.size,
          document,
        }),
      });
      setNotice("文件校验通过。请显式映射每个逻辑数据源后运行预检。");
      await reload();
      setSelectedImportId(created.import_id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "语义文件上传失败");
    } finally {
      setPending(undefined);
    }
  }

  async function runAction(kind: "mapping" | "dry-run" | "commit" | "cancel") {
    if (!selectedImport || !workspaceId) return;
    setPending(kind);
    setError(undefined);
    setNotice(undefined);
    try {
      const suffix = `imports/${encodeURIComponent(selectedImport.import_id)}/${
        kind === "mapping" ? "mappings" : kind
      }`;
      const body =
        kind === "mapping"
          ? {
              schema_version: "semantic-import-mapping@1.0.0",
              operation_id: crypto.randomUUID(),
              idempotency_key: crypto.randomUUID(),
              mappings,
            }
          : operation("semantic-import-command@1.0.0");
      const updated = await api<SemanticImportJob>(workspaceId, suffix, {
        method: kind === "mapping" ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      setImports((current) =>
        current.map((item) => (item.import_id === updated.import_id ? updated : item)),
      );
      setNotice(
        kind === "commit"
          ? "导入已创建待治理草稿；仍需在语义治理中审核和发布。"
          : kind === "dry-run"
            ? updated.state === "READY"
              ? "预检通过，可以创建待治理草稿。"
              : "预检未通过，请修正映射后重试。"
            : kind === "mapping"
              ? "数据源映射已保存。"
              : "导入任务已取消。",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "语义导入操作失败");
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section aria-labelledby="semantic-portability-title">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Semantic portability
            </p>
            <Badge variant="outline">JSON · v1</Badge>
          </div>
          <h2 id="semantic-portability-title" className="mt-1 text-lg font-semibold">
            语义导入与导出
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-text-secondary)]">
            导出已发布版本；导入必须绑定当前工作空间的数据源，并且只生成待治理草稿。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="选择语义移植工作空间"
            value={workspaceId}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              setSelectedImportId(undefined);
            }}
            className="h-8 min-w-44 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 text-xs outline-none focus:border-[var(--color-accent)]"
          >
            {workspaces.map((item) => (
              <option key={item.workspace.workspace_id} value={item.workspace.workspace_id}>
                {item.workspace.display_name}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={exportSemantic} loading={pending === "export"}>
            导出已发布版本
          </Button>
          <Button
            onClick={() => fileRef.current?.click()}
            loading={pending === "upload"}
            disabled={!canWrite || !workspaceId}
          >
            上传 JSON
          </Button>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={upload}
          />
        </div>
      </div>

      <div className="mt-5 grid overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--color-border-default)] lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
            <p className="text-xs font-semibold">导入任务</p>
            <button
              type="button"
              onClick={() => void reload()}
              className="text-[11px] text-[var(--color-accent)] hover:underline"
            >
              刷新
            </button>
          </div>
          {loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : imports.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-xs font-medium">暂无导入任务</p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                上传小于 1 MiB 的语义 JSON 后，从这里继续映射和预检。
              </p>
            </div>
          ) : (
            <div className="max-h-[420px] divide-y divide-[var(--color-border-default)] overflow-y-auto">
              {imports.map((item) => (
                <button
                  key={item.import_id}
                  type="button"
                  onClick={() => setSelectedImportId(item.import_id)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-tertiary)] ${
                    item.import_id === selectedImportId ? "bg-[var(--color-bg-canvas)]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{item.file_name}</span>
                    <Badge variant={stateVariant(item.state)}>{stateLabel[item.state]}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                    {item.document_content_hash.slice(0, 20)}…
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                    {timestamp(item.updated_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="min-h-[310px] p-4 sm:p-5">
          {!selectedImport ? (
            <div className="flex min-h-[270px] items-center justify-center text-center">
              <div>
                <p className="text-sm font-medium">选择任务以继续</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  导入不会自动匹配数据源，也不会直接发布语义。
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{selectedImport.file_name}</h3>
                    <Badge variant={stateVariant(selectedImport.state)}>
                      {stateLabel[selectedImport.state]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                    {selectedImport.datasource_refs.length} 个逻辑数据源 ·{" "}
                    {selectedImport.byte_size} bytes
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={
                      !canWrite || mappings.length !== selectedImport.datasource_refs.length
                    }
                    loading={pending === "mapping"}
                    onClick={() => void runAction("mapping")}
                  >
                    保存映射
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!canWrite || selectedImport.mappings.length === 0}
                    loading={pending === "dry-run"}
                    onClick={() => void runAction("dry-run")}
                  >
                    运行预检
                  </Button>
                  <Button
                    disabled={!canWrite || selectedImport.state !== "READY"}
                    loading={pending === "commit"}
                    onClick={() => void runAction("commit")}
                  >
                    创建待治理草稿
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={
                      !canWrite ||
                      ["DRAFT_CREATED", "FAILED", "CANCELLED"].includes(selectedImport.state)
                    }
                    loading={pending === "cancel"}
                    onClick={() => void runAction("cancel")}
                  >
                    取消
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {selectedImport.datasource_refs.map((reference) => (
                  <label
                    key={reference.logical_ref}
                    className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-3"
                  >
                    <span className="block truncate font-mono text-[11px] font-medium">
                      {reference.logical_ref}
                    </span>
                    <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                      {reference.display_name} · {reference.dialect}
                    </span>
                    <select
                      value={mappingValues[reference.logical_ref] ?? ""}
                      disabled={
                        !canWrite ||
                        ["DRAFT_CREATED", "FAILED", "CANCELLED"].includes(selectedImport.state)
                      }
                      onChange={(event) =>
                        setMappingValues((current) => ({
                          ...current,
                          [reference.logical_ref]: event.target.value,
                        }))
                      }
                      className="mt-3 h-8 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 text-xs outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
                    >
                      <option value="">选择当前工作空间的数据源 / 语义域</option>
                      {targets.flatMap((target) =>
                        target.semantic_domains.map((domain) => (
                          <option
                            key={`${target.datasource_id}:${domain}`}
                            value={`${target.datasource_id}|${domain}`}
                          >
                            {target.display_name} / {domain}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                ))}
              </div>

              {selectedImport.preview && (
                <div className="mt-5 border-t border-[var(--color-border-default)] pt-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold">预检结果</p>
                    <Badge variant={selectedImport.preview.compatible ? "success" : "warning"}>
                      {selectedImport.preview.compatible ? "兼容" : "需要处理"}
                    </Badge>
                  </div>
                  {selectedImport.preview.conflicts.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-[var(--color-error)]">
                      {selectedImport.preview.conflicts.map((conflict) => (
                        <li key={`${conflict.code}:${conflict.logical_ref}`}>
                          {conflict.logical_ref ? `${conflict.logical_ref} · ` : ""}
                          {conflict.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                      {selectedImport.preview.domains.length} 个语义域将作为独立待治理草稿创建。
                    </p>
                  )}
                </div>
              )}

              {selectedImport.state === "DRAFT_CREATED" && (
                <div className="mt-5 rounded-md border border-emerald-800/50 bg-emerald-950/20 p-3">
                  <p className="text-xs font-semibold text-[var(--color-success)]">
                    已创建 {selectedImport.candidates.length} 个待治理草稿
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                    receipt {selectedImport.receipt_id}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!canWrite && workspaceId && (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          当前角色为只读权限，可以导出和查看任务，但不能上传、映射或创建草稿。
        </p>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-red-800/50 bg-red-950/20 px-3 py-2 text-xs text-[var(--color-error)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-xs text-[var(--color-success)]">
          {notice}
        </div>
      )}
    </section>
  );
}
