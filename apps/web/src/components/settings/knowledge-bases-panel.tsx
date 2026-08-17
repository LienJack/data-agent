"use client";

import {
  type EmbeddingProfileRevision,
  embeddingProfileRevisionSchema,
  type KnowledgeBaseRevision,
  type KnowledgeDebugSearchResult,
  knowledgeBaseMutationResultSchema,
  knowledgeBaseRevisionSchema,
  knowledgeDebugSearchResultSchema,
  type WorkspaceAccessProjection,
  type WorkspaceFileRevision,
  workspaceFileRevisionSchema,
} from "@data-agent/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workspaceRequestHeaders } from "@/lib/api-client";

type Props = { readonly workspaces: readonly WorkspaceAccessProjection[] };

const listSchema = z.strictObject({
  knowledge_bases: z.array(knowledgeBaseRevisionSchema),
  embedding_profiles: z.array(embeddingProfileRevisionSchema),
});

async function requestJson<T>(
  workspaceId: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...workspaceRequestHeaders(workspaceId),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly data?: unknown;
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? `请求失败 (${response.status})`);
  }
  return schema.parse(body.data);
}

function statusVariant(status: KnowledgeBaseRevision["status"]) {
  if (status === "READY") return "success" as const;
  if (status === "FAILED" || status === "DELETED") return "danger" as const;
  if (status === "STALE") return "warning" as const;
  return "secondary" as const;
}

export function KnowledgeBasesPanel({ workspaces }: Props) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspace.workspace_id ?? "");
  const [bases, setBases] = useState<readonly KnowledgeBaseRevision[]>([]);
  const [profiles, setProfiles] = useState<readonly EmbeddingProfileRevision[]>([]);
  const [files, setFiles] = useState<readonly WorkspaceFileRevision[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<readonly string[]>([]);
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<KnowledgeDebugSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const [knowledge, fileRows] = await Promise.all([
        requestJson(workspaceId, "knowledge-bases", listSchema),
        requestJson(workspaceId, "files", z.array(workspaceFileRevisionSchema)),
      ]);
      setBases(knowledge.knowledge_bases);
      setProfiles(knowledge.embedding_profiles);
      setFiles(
        fileRows.filter((file) => file.status === "READY" && file.visibility === "WORKSPACE"),
      );
      setProfileId((current) =>
        knowledge.embedding_profiles.some((profile) => profile.profile_id === current)
          ? current
          : (knowledge.embedding_profiles.find((profile) => profile.status === "READY")
              ?.profile_id ?? ""),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge Base 加载失败。");
    }
  }, [workspaceId]);

  useEffect(() => void load(), [load]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profile_id === profileId),
    [profileId, profiles],
  );

  async function createBase() {
    if (!selectedProfile || selectedFiles.length === 0 || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson(workspaceId, "knowledge-bases", knowledgeBaseMutationResultSchema, {
        method: "POST",
        body: JSON.stringify({
          name,
          source_file_refs: files
            .filter((file) => selectedFiles.includes(file.file_id))
            .map((file) => ({
              file_id: file.file_id,
              revision: file.revision,
              revision_hash: file.revision_hash,
            }))
            .sort((left, right) =>
              `${left.file_id}:${left.revision}:${left.revision_hash}`.localeCompare(
                `${right.file_id}:${right.revision}:${right.revision_hash}`,
              ),
            ),
          embedding_profile_ref: {
            profile_id: selectedProfile.profile_id,
            revision: selectedProfile.revision,
            profile_hash: selectedProfile.profile_hash,
          },
          acl: { visibility: "WORKSPACE", principal_ids: [] },
          idempotency_key: crypto.randomUUID(),
        }),
      });
      setName("");
      setSelectedFiles([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge Base 创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(base: KnowledgeBaseRevision) {
    setBusy(true);
    setError(null);
    try {
      await requestJson(
        workspaceId,
        `knowledge-bases/${base.knowledge_base_id}/rebuild`,
        knowledgeBaseMutationResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_ref: {
              knowledge_base_id: base.knowledge_base_id,
              revision: base.revision,
              revision_hash: base.revision_hash,
            },
            idempotency_key: crypto.randomUUID(),
          }),
        },
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge Base 重建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function search(base: KnowledgeBaseRevision) {
    if (!base.active_generation_ref || !query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setSearchResult(
        await requestJson(
          workspaceId,
          `knowledge-bases/${base.knowledge_base_id}/search`,
          knowledgeDebugSearchResultSchema,
          {
            method: "POST",
            body: JSON.stringify({
              schema_version: "knowledge-debug-search-request@1.0.0",
              knowledge_base_ref: {
                knowledge_base_id: base.knowledge_base_id,
                revision: base.revision,
                revision_hash: base.revision_hash,
              },
              generation_ref: base.active_generation_ref,
              query,
              limit: 5,
            }),
          },
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge 调试检索失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Knowledge authority
          </p>
          <h2 className="mt-1 text-lg font-semibold">Knowledge Bases</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
            仅使用已扫描并提升到 Workspace 的文件；索引未 READY 时不会进入新 Run。
          </p>
        </div>
        <select
          aria-label="Knowledge Workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="min-h-10 border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-sm"
        >
          {workspaces.map((workspace) => (
            <option key={workspace.workspace.workspace_id} value={workspace.workspace.workspace_id}>
              {workspace.workspace.display_name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      <div className="grid gap-3 border border-[var(--color-border-default)] p-4 lg:grid-cols-[1fr_1fr_auto]">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Knowledge Base 名称"
          className="min-h-10 border border-[var(--color-border-default)] bg-transparent px-3 text-sm"
        />
        <select
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          className="min-h-10 border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-sm"
        >
          <option value="">选择 READY Embedding Profile</option>
          {profiles
            .filter((profile) => profile.status === "READY")
            .map((profile) => (
              <option key={`${profile.profile_id}:${profile.revision}`} value={profile.profile_id}>
                {profile.provider} / {profile.model_id} · {profile.dimensions}d
              </option>
            ))}
        </select>
        <Button
          disabled={busy || !name.trim() || !profileId || selectedFiles.length === 0}
          onClick={createBase}
        >
          创建并索引
        </Button>
        <div className="lg:col-span-3">
          <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">来源文件</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {files.map((file) => (
              <label
                key={`${file.file_id}:${file.revision}`}
                className="flex gap-2 border border-[var(--color-border-default)] p-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={selectedFiles.includes(file.file_id)}
                  onChange={(event) =>
                    setSelectedFiles((current) =>
                      event.target.checked
                        ? [...current, file.file_id]
                        : current.filter((id) => id !== file.file_id),
                    )
                  }
                />
                <span className="truncate">
                  {file.original_filename} · r{file.revision}
                </span>
              </label>
            ))}
            {files.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">暂无 READY Workspace 文件。</p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {bases.map((base) => (
          <article
            key={`${base.knowledge_base_id}:${base.revision}`}
            className="border border-[var(--color-border-default)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{base.name}</h3>
                  <Badge variant={statusVariant(base.status)}>{base.status}</Badge>
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {base.knowledge_base_id} · r{base.revision} · {base.source_file_refs.length}{" "}
                  sources
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || base.status !== "READY"}
                  onClick={() => rebuild(base)}
                >
                  重建
                </Button>
              </div>
            </div>
            {base.status === "READY" && base.active_generation_ref && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="检索调试（只返回证据引用）"
                  className="min-h-10 flex-1 border border-[var(--color-border-default)] bg-transparent px-3 text-sm"
                />
                <Button disabled={busy || !query.trim()} onClick={() => search(base)}>
                  检索证据
                </Button>
              </div>
            )}
          </article>
        ))}
        {bases.length === 0 && (
          <div className="border border-dashed border-[var(--color-border-default)] p-6 text-sm text-[var(--color-text-muted)]">
            暂无 Knowledge Base。
          </div>
        )}
      </div>

      {searchResult && (
        <div className="border border-[var(--color-border-default)] p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">检索证据</h3>
            <Badge variant={searchResult.status === "READY" ? "success" : "warning"}>
              {searchResult.status}
            </Badge>
          </div>
          {searchResult.reason_code && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {searchResult.reason_code}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {searchResult.receipt?.hits.map((hit) => (
              <div
                key={hit.evidence_hash}
                className="border-l-2 border-[var(--color-accent)] pl-3 text-xs"
              >
                <p>
                  File {hit.source_file_ref.file_id} · score {hit.score.toFixed(4)}
                </p>
                <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  bytes {hit.citation.start_byte}–{hit.citation.end_byte} ·{" "}
                  {hit.citation.excerpt_hash}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
