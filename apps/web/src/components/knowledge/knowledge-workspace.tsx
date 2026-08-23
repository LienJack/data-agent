"use client";

import {
  type EmbeddingProfileRevision,
  embeddingProfileRevisionSchema,
  type KnowledgeBaseRevision,
  type KnowledgeDocumentBlock,
  type KnowledgeDocumentBlockReference,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentRevision,
  type KnowledgeUsageReference,
  knowledgeBaseMutationResultSchema,
  knowledgeBaseRevisionSchema,
  knowledgeCorrectionAnnotationSchema,
  knowledgeDocumentDetailSchema,
  knowledgeDocumentRevisionSchema,
  knowledgeEvidenceSelectionSchema,
  type WorkspaceFileRevision,
  workspaceFileRevisionSchema,
} from "@data-agent/contracts";
import {
  ArrowClockwise,
  ArrowRight,
  Check,
  FileMd,
  FolderOpen,
  UploadSimple,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workspaceRequestHeaders } from "@/lib/api-client";

type Props = { readonly workspaceId: string };

const knowledgeListSchema = z.strictObject({
  knowledge_bases: z.array(knowledgeBaseRevisionSchema),
  embedding_profiles: z.array(embeddingProfileRevisionSchema),
});
const uploadResultSchema = z.strictObject({
  file: workspaceFileRevisionSchema,
  scan_job: z.unknown(),
});

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

async function requestData<T>(
  workspaceId: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...workspaceRequestHeaders(workspaceId),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly data?: unknown;
    readonly error?: { readonly message?: string; readonly code?: string };
  };
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? body.error?.code ?? `请求失败 (${response.status})`);
  }
  return schema.parse(body.data);
}

function baseStatusVariant(status: KnowledgeBaseRevision["status"]) {
  if (status === "READY") return "success" as const;
  if (status === "FAILED" || status === "DELETED") return "danger" as const;
  if (status === "STALE") return "warning" as const;
  return "secondary" as const;
}

function blockLabel(block: KnowledgeDocumentBlock): string {
  switch (block.kind) {
    case "HEADING":
      return "标题";
    case "PARAGRAPH":
      return "段落";
    case "LIST":
      return "列表";
    case "TABLE":
      return "表格";
    case "CODE":
      return "代码";
  }
}

function referenceIdentity(block: KnowledgeDocumentBlockReference): string {
  return `${block.document_ref.document_id}:${String(block.document_ref.revision).padStart(16, "0")}:${block.block_id}:${block.block_hash}`;
}

export function knowledgeUsageIdentity(usage: KnowledgeUsageReference): string {
  return `${usage.usage_kind}:${usage.subject_id}:${usage.subject_revision}:${referenceIdentity(usage.evidence_ref)}`;
}

export function KnowledgeWorkspace({ workspaceId }: Props) {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [bases, setBases] = useState<readonly KnowledgeBaseRevision[]>([]);
  const [profiles, setProfiles] = useState<readonly EmbeddingProfileRevision[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly WorkspaceFileRevision[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<readonly KnowledgeDocumentRevision[]>([]);
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<KnowledgeDocumentDetail | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<readonly string[]>([]);
  const [semanticDomain, setSemanticDomain] = useState("ecommerce");
  const [annotationKind, setAnnotationKind] = useState<"CORRECTION" | "SUPPLEMENT">("CORRECTION");
  const [annotationText, setAnnotationText] = useState("");
  const [annotationReason, setAnnotationReason] = useState("");
  const [newBaseName, setNewBaseName] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  function uploadSessionId(): string {
    sessionIdRef.current ??= crypto.randomUUID();
    return sessionIdRef.current;
  }

  const selectedBase = useMemo(
    () => bases.find((base) => base.knowledge_base_id === selectedBaseId) ?? null,
    [bases, selectedBaseId],
  );
  const readyProfile = profiles.find((profile) => profile.status === "READY") ?? null;
  const markdownFiles = workspaceFiles.filter(
    (file) =>
      file.status === "READY" &&
      file.visibility === "WORKSPACE" &&
      (file.detected_mime === "text/markdown" || file.original_filename.endsWith(".md")),
  );

  const loadAssets = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [knowledge, files] = await Promise.all([
        requestData(workspaceId, "knowledge-bases", knowledgeListSchema),
        requestData(workspaceId, "files", z.array(workspaceFileRevisionSchema)),
      ]);
      setBases(knowledge.knowledge_bases);
      setProfiles(knowledge.embedding_profiles);
      setWorkspaceFiles(files);
      setSelectedBaseId((current) =>
        knowledge.knowledge_bases.some((base) => base.knowledge_base_id === current)
          ? current
          : (knowledge.knowledge_bases[0]?.knowledge_base_id ?? null),
      );
      setSelectedFileId((current) =>
        files.some((file) => file.file_id === current)
          ? current
          : (files.find(
              (file) =>
                file.status === "READY" &&
                file.visibility === "WORKSPACE" &&
                (file.detected_mime === "text/markdown" || file.original_filename.endsWith(".md")),
            )?.file_id ?? ""),
      );
      setState({ kind: "ready" });
    } catch (cause) {
      setState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "知识资产加载失败。",
      });
    }
  }, [workspaceId]);

  const loadDocuments = useCallback(
    async (knowledgeBaseId: string) => {
      try {
        const rows = await requestData(
          workspaceId,
          `knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`,
          z.array(knowledgeDocumentRevisionSchema),
        );
        setDocuments(rows);
        const first = rows[0];
        setSelectedDocumentKey(first ? `${first.document_id}:${first.revision}` : null);
        setDetail(null);
        setSelectedBlockIds([]);
      } catch (cause) {
        setDocuments([]);
        setActionStatus(cause instanceof Error ? cause.message : "文档版本加载失败。");
      }
    },
    [workspaceId],
  );

  const loadDetail = useCallback(
    async (document: KnowledgeDocumentRevision) => {
      if (!selectedBaseId) return;
      setDetail(null);
      setSelectedBlockIds([]);
      try {
        setDetail(
          await requestData(
            workspaceId,
            `knowledge-bases/${encodeURIComponent(selectedBaseId)}/documents/${encodeURIComponent(document.document_id)}/${document.revision}`,
            knowledgeDocumentDetailSchema,
          ),
        );
      } catch (cause) {
        setActionStatus(cause instanceof Error ? cause.message : "文档内容加载失败。");
      }
    },
    [selectedBaseId, workspaceId],
  );

  useEffect(() => void loadAssets(), [loadAssets]);
  useEffect(() => {
    if (selectedBaseId) void loadDocuments(selectedBaseId);
  }, [loadDocuments, selectedBaseId]);
  useEffect(() => {
    const document = documents.find(
      (candidate) => `${candidate.document_id}:${candidate.revision}` === selectedDocumentKey,
    );
    if (document) void loadDetail(document);
  }, [documents, loadDetail, selectedDocumentKey]);

  async function createBaseFromFile(file: WorkspaceFileRevision, name: string) {
    if (!readyProfile) throw new Error("没有 READY Embedding Profile，无法创建 Knowledge Base。");
    return requestData(workspaceId, "knowledge-bases", knowledgeBaseMutationResultSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        source_file_refs: [
          { file_id: file.file_id, revision: file.revision, revision_hash: file.revision_hash },
        ],
        embedding_profile_ref: {
          profile_id: readyProfile.profile_id,
          revision: readyProfile.revision,
          profile_hash: readyProfile.profile_hash,
        },
        acl: { visibility: "WORKSPACE", principal_ids: [] },
        idempotency_key: crypto.randomUUID(),
      }),
    });
  }

  async function createFromExisting() {
    const file = markdownFiles.find((candidate) => candidate.file_id === selectedFileId);
    if (!file || !newBaseName.trim()) return;
    setBusy(true);
    setActionStatus("正在创建知识资产并提交索引任务…");
    try {
      await createBaseFromFile(file, newBaseName.trim());
      setNewBaseName("");
      setActionStatus("已创建 Knowledge Base；Worker 正在解析 Markdown 和建立索引。");
      await loadAssets();
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : "Knowledge Base 创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function waitForScannedFile(fileId: string): Promise<WorkspaceFileRevision> {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const files = await requestData(
        workspaceId,
        `files?sessionId=${encodeURIComponent(uploadSessionId())}`,
        z.array(workspaceFileRevisionSchema),
      );
      const file = files.find((candidate) => candidate.file_id === fileId);
      if (file?.status === "READY") return file;
      if (file?.status === "REJECTED" || file?.status === "DELETED") {
        throw new Error(`Markdown 扫描未通过：${file.status}`);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    throw new Error("Markdown 扫描仍未完成，可在任务中心查看并重试。");
  }

  async function uploadMarkdown(file: File) {
    if (!file.name.toLocaleLowerCase().endsWith(".md")) {
      setActionStatus("MVP 只接受 .md Markdown 文件。");
      return;
    }
    setBusy(true);
    setActionStatus("正在上传 Markdown…");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("session_id", uploadSessionId());
      form.set("idempotency_key", crypto.randomUUID());
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || body.data === undefined) {
        throw new Error(body.error?.message ?? "Markdown 上传失败。");
      }
      const uploaded = uploadResultSchema.parse(body.data);
      setActionStatus("上传完成，正在等待安全扫描…");
      const ready = await waitForScannedFile(uploaded.file.file_id);
      setActionStatus("扫描通过，正在提升为 Workspace 公司资产…");
      const promoted = await requestData(
        workspaceId,
        `files/${encodeURIComponent(ready.file_id)}`,
        workspaceFileRevisionSchema,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "PROMOTE",
            revision: ready.revision,
            revision_hash: ready.revision_hash,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      );
      const baseName = newBaseName.trim() || file.name.replace(/\.md$/i, "");
      await createBaseFromFile(promoted, baseName);
      setNewBaseName("");
      setActionStatus("知识资产已创建；Markdown 解析和索引任务正在后台运行。");
      await loadAssets();
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : "Markdown 导入失败。");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function freezeSelection() {
    if (!selectedBase || !detail || selectedBlockIds.length === 0) return;
    setBusy(true);
    setActionStatus("正在冻结 exact Evidence Selection…");
    try {
      const selectedBlocks = detail.blocks
        .filter((block) => selectedBlockIds.includes(block.block_id))
        .sort((left, right) => referenceIdentity(left).localeCompare(referenceIdentity(right)));
      const selection = await requestData(
        workspaceId,
        `knowledge-bases/${encodeURIComponent(selectedBase.knowledge_base_id)}/evidence-selections`,
        knowledgeEvidenceSelectionSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            knowledge_base_ref: {
              knowledge_base_id: selectedBase.knowledge_base_id,
              revision: selectedBase.revision,
              revision_hash: selectedBase.revision_hash,
            },
            intended_semantic_domain: semanticDomain,
            block_refs: selectedBlocks.map((block) => ({
              document_ref: block.document_ref,
              block_id: block.block_id,
              block_hash: block.block_hash,
            })),
          }),
        },
      );
      window.location.assign(
        `/w/${encodeURIComponent(workspaceId)}/semantic?domain=${encodeURIComponent(semanticDomain)}&evidenceSelectionId=${encodeURIComponent(selection.selection_id)}&evidenceSelectionHash=${encodeURIComponent(selection.selection_hash)}`,
      );
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : "证据选择创建失败。");
      setBusy(false);
    }
  }

  async function createKnowledgeRevision() {
    if (!selectedBase) return;
    setBusy(true);
    setActionStatus("正在创建新的不可变 Knowledge Revision…");
    try {
      await requestData(
        workspaceId,
        `knowledge-bases/${encodeURIComponent(selectedBase.knowledge_base_id)}/rebuild`,
        knowledgeBaseMutationResultSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            knowledge_base_ref: {
              knowledge_base_id: selectedBase.knowledge_base_id,
              revision: selectedBase.revision,
              revision_hash: selectedBase.revision_hash,
            },
            idempotency_key: crypto.randomUUID(),
          }),
        },
      );
      setActionStatus(
        "新 Knowledge Revision 已创建并开始解析。旧 Document/Block 引用保持不变；系统不会自动创建语义 Candidate。",
      );
      await loadAssets();
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : "Knowledge Revision 创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function createAnnotation() {
    if (
      !selectedBase ||
      !detail ||
      selectedBlockIds.length !== 1 ||
      !annotationText.trim() ||
      !annotationReason.trim()
    ) {
      return;
    }
    const block = detail.blocks.find((item) => item.block_id === selectedBlockIds[0]);
    if (!block) return;
    setBusy(true);
    setActionStatus("正在保存不可变纠错注释…");
    try {
      await requestData(
        workspaceId,
        `knowledge-bases/${encodeURIComponent(selectedBase.knowledge_base_id)}/annotations`,
        knowledgeCorrectionAnnotationSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            knowledge_base_ref: {
              knowledge_base_id: selectedBase.knowledge_base_id,
              revision: selectedBase.revision,
              revision_hash: selectedBase.revision_hash,
            },
            block_ref: {
              document_ref: block.document_ref,
              block_id: block.block_id,
              block_hash: block.block_hash,
            },
            annotation_kind: annotationKind,
            correction_text: annotationText.trim(),
            reason: annotationReason.trim(),
          }),
        },
      );
      setAnnotationText("");
      setAnnotationReason("");
      setActionStatus("纠错注释已保存；原段落及所有旧证据引用未被改写。");
      await loadDetail(detail.document);
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : "纠错注释保存失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full bg-[var(--color-bg-secondary)]">
      <div className="page-frame">
        <header className="page-heading">
          <div>
            <span className="page-eyebrow">Knowledge authority</span>
            <h1 className="page-title">知识库</h1>
            <p className="page-description">
              管理不可变 Markdown
              版本、段落证据和下游语义使用。知识更新只提示影响，不会自动修改正式语义层。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void loadAssets()} disabled={busy}>
              <ArrowClockwise aria-hidden="true" size={15} /> 刷新
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={busy || !readyProfile}>
              <UploadSimple aria-hidden="true" size={15} /> 上传 Markdown
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadMarkdown(file);
              }}
            />
          </div>
        </header>

        <section className="mt-5 grid gap-3 border-y border-[var(--color-border-default)] py-4 lg:grid-cols-[minmax(180px,0.7fr)_minmax(260px,1.2fr)_auto]">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              资产名称
            </span>
            <input
              value={newBaseName}
              onChange={(event) => setNewBaseName(event.target.value)}
              placeholder="例如：交易指标口径"
              className="h-10 w-full rounded-[5px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 text-sm focus:border-[var(--color-border-focused)] focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              已有 Workspace Markdown
            </span>
            <select
              value={selectedFileId}
              onChange={(event) => setSelectedFileId(event.target.value)}
              className="h-10 w-full rounded-[5px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 text-sm"
            >
              <option value="">选择已扫描文件</option>
              {markdownFiles.map((file) => (
                <option key={`${file.file_id}:${file.revision}`} value={file.file_id}>
                  {file.original_filename} · r{file.revision}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button
              variant="secondary"
              disabled={busy || !newBaseName.trim() || !selectedFileId || !readyProfile}
              onClick={() => void createFromExisting()}
            >
              创建并索引
            </Button>
          </div>
        </section>

        {actionStatus && (
          <p
            className="mt-3 border-l-2 border-[var(--color-accent)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
            aria-live="polite"
          >
            {actionStatus}
          </p>
        )}
        {state.kind === "error" && (
          <p className="mt-3 border-l-2 border-[var(--color-status-danger)] px-3 py-2 text-sm text-[var(--color-status-danger)]">
            {state.message}
          </p>
        )}

        <div className="mt-6 grid min-h-[620px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--color-border-default)] lg:border-b-0 lg:border-r">
            <div className="flex h-12 items-center justify-between border-b border-[var(--color-border-default)] px-3">
              <h2 className="text-sm font-semibold">知识资产</h2>
              <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                {bases.length}
              </span>
            </div>
            <div className="divide-y divide-[var(--color-border-default)]">
              {bases.map((base) => {
                const active = base.knowledge_base_id === selectedBaseId;
                return (
                  <button
                    type="button"
                    key={`${base.knowledge_base_id}:${base.revision}`}
                    onClick={() => setSelectedBaseId(base.knowledge_base_id)}
                    className={`w-full px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${
                      active
                        ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,white)]"
                        : "hover:bg-[var(--color-bg-tertiary)]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <FolderOpen
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                        size={16}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{base.name}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <Badge variant={baseStatusVariant(base.status)}>{base.status}</Badge>
                          <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                            r{base.revision}
                          </span>
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
              {state.kind === "loading" && (
                <p className="p-4 text-xs text-[var(--color-text-muted)]">正在加载…</p>
              )}
              {state.kind === "ready" && bases.length === 0 && (
                <p className="p-4 text-xs leading-5 text-[var(--color-text-muted)]">
                  上传 Markdown 创建第一个公司知识资产。
                </p>
              )}
            </div>
          </aside>

          <section className="min-w-0">
            {selectedBase ? (
              <>
                <div className="border-b border-[var(--color-border-default)] px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{selectedBase.name}</h2>
                      <p className="mt-1 font-mono text-[9px] text-[var(--color-text-muted)]">
                        {selectedBase.knowledge_base_id} · revision {selectedBase.revision}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={baseStatusVariant(selectedBase.status)}>
                        {selectedBase.status}
                      </Badge>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        {selectedBase.source_file_refs.length} sources
                      </span>
                      <Button
                        variant="secondary"
                        disabled={busy || selectedBase.status !== "READY"}
                        onClick={() => void createKnowledgeRevision()}
                      >
                        创建新 Revision
                      </Button>
                    </div>
                  </div>
                  <nav
                    className="mt-3 flex gap-2 overflow-x-auto pb-1"
                    aria-label="Knowledge document revisions"
                  >
                    {documents.map((document) => {
                      const key = `${document.document_id}:${document.revision}`;
                      return (
                        <button
                          type="button"
                          key={key}
                          onClick={() => setSelectedDocumentKey(key)}
                          className={`shrink-0 rounded-[5px] border px-2.5 py-1.5 text-[11px] ${
                            selectedDocumentKey === key
                              ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,white)] text-[var(--color-accent)]"
                              : "border-[var(--color-border-default)] text-[var(--color-text-secondary)]"
                          }`}
                        >
                          Document r{document.revision} · {document.block_count} blocks
                        </button>
                      );
                    })}
                    {documents.length === 0 && (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {selectedBase.status === "READY"
                          ? "没有已提交的 Markdown Document。"
                          : "等待 Worker 解析和索引。"}
                      </span>
                    )}
                  </nav>
                </div>

                {detail ? (
                  <div className="grid min-h-[500px] xl:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="divide-y divide-[var(--color-border-default)]">
                      {detail.blocks.map((block) => {
                        const selected = selectedBlockIds.includes(block.block_id);
                        return (
                          <label
                            key={block.block_id}
                            className={`grid cursor-pointer grid-cols-[22px_minmax(0,1fr)] gap-2 px-4 py-3 transition-colors ${
                              selected
                                ? "bg-[color-mix(in_srgb,var(--color-accent)_6%,white)]"
                                : "hover:bg-[var(--color-bg-tertiary)]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) =>
                                setSelectedBlockIds((current) =>
                                  event.target.checked
                                    ? [...current, block.block_id]
                                    : current.filter((id) => id !== block.block_id),
                                )
                              }
                              className="mt-1 accent-[var(--color-accent)]"
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                                <span className="font-semibold uppercase">{blockLabel(block)}</span>
                                <span>
                                  line {block.start_line}–{block.end_line}
                                </span>
                                <code className="truncate">{block.block_id}</code>
                              </span>
                              <span
                                className={`mt-1.5 block whitespace-pre-wrap text-sm leading-6 ${block.kind === "CODE" ? "font-mono text-xs" : ""}`}
                              >
                                {block.canonical_text}
                              </span>
                              {block.heading_ancestry.length > 0 && (
                                <span className="mt-2 block text-[10px] text-[var(--color-text-muted)]">
                                  {block.heading_ancestry.join(" / ")}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <aside className="border-t border-[var(--color-border-default)] p-4 xl:border-l xl:border-t-0">
                      <h3 className="text-sm font-semibold">生成语义候选</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                        只有选中段落会成为业务事实证据。Schema
                        和当前语义层仅用于字段映射与冲突检查。
                      </p>
                      <label className="mt-4 block space-y-1">
                        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                          语义域
                        </span>
                        <input
                          value={semanticDomain}
                          onChange={(event) => setSemanticDomain(event.target.value)}
                          className="h-9 w-full rounded-[5px] border border-[var(--color-border-default)] px-2 text-xs"
                        />
                      </label>
                      <div className="mt-4 border-y border-[var(--color-border-default)] py-3">
                        <div className="flex items-center justify-between text-xs">
                          <span>已选段落</span>
                          <strong className="font-mono">{selectedBlockIds.length}</strong>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span>纠错注释</span>
                          <strong className="font-mono">{detail.annotations.length}</strong>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span>下游使用</span>
                          <strong className="font-mono">{detail.usage.length}</strong>
                        </div>
                      </div>
                      <Button
                        className="mt-4 w-full"
                        disabled={busy || selectedBlockIds.length === 0 || !semanticDomain.trim()}
                        onClick={() => void freezeSelection()}
                      >
                        <Check aria-hidden="true" size={15} /> 选择证据并交给 Agent
                      </Button>
                      <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-[var(--color-text-muted)]">
                        <ArrowRight aria-hidden="true" className="mt-0.5 shrink-0" size={12} />
                        创建 Evidence Selection 不会自动保存 Candidate Revision，也不会影响已发布
                        Release。
                      </p>
                      <div className="mt-5 border-t border-[var(--color-border-default)] pt-4">
                        <h4 className="text-xs font-semibold">纠错或补充注释</h4>
                        <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-muted)]">
                          只选择一个段落。注释绑定 exact Block，并以当前 Knowledge Revision
                          为生效版本。
                        </p>
                        <select
                          aria-label="注释类型"
                          value={annotationKind}
                          onChange={(event) =>
                            setAnnotationKind(event.target.value as "CORRECTION" | "SUPPLEMENT")
                          }
                          className="mt-3 h-8 w-full rounded-[5px] border border-[var(--color-border-default)] px-2 text-xs"
                        >
                          <option value="CORRECTION">纠错</option>
                          <option value="SUPPLEMENT">补充</option>
                        </select>
                        <textarea
                          aria-label="纠错内容"
                          value={annotationText}
                          onChange={(event) => setAnnotationText(event.target.value)}
                          placeholder="修正后的口径或补充说明"
                          rows={3}
                          className="mt-2 w-full resize-y rounded-[5px] border border-[var(--color-border-default)] p-2 text-xs"
                        />
                        <input
                          aria-label="纠错原因"
                          value={annotationReason}
                          onChange={(event) => setAnnotationReason(event.target.value)}
                          placeholder="原因"
                          className="mt-2 h-8 w-full rounded-[5px] border border-[var(--color-border-default)] px-2 text-xs"
                        />
                        <Button
                          variant="secondary"
                          className="mt-2 w-full"
                          disabled={
                            busy ||
                            selectedBlockIds.length !== 1 ||
                            !annotationText.trim() ||
                            !annotationReason.trim()
                          }
                          onClick={() => void createAnnotation()}
                        >
                          保存不可变注释
                        </Button>
                      </div>
                      {detail.annotations.length > 0 ? (
                        <div className="mt-4 border-t border-[var(--color-border-default)] pt-3">
                          <h4 className="text-xs font-semibold">已有注释</h4>
                          <ul className="mt-2 space-y-2">
                            {detail.annotations.map((annotation) => (
                              <li
                                key={annotation.annotation_id}
                                className="border-l-2 border-[var(--color-status-warning)] pl-2 text-[10px] leading-4"
                              >
                                <strong>{annotation.annotation_kind}</strong> · Knowledge r
                                {annotation.effective_knowledge_base_revision}
                                <span className="mt-0.5 block text-[var(--color-text-secondary)]">
                                  {annotation.correction_text}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {detail.usage.length > 0 ? (
                        <div className="mt-4 border-t border-[var(--color-border-default)] pt-3">
                          <h4 className="text-xs font-semibold">下游使用记录</h4>
                          <ul className="mt-2 space-y-1 font-mono text-[9px] text-[var(--color-text-muted)]">
                            {detail.usage.map((usage) => (
                              <li key={knowledgeUsageIdentity(usage)}>
                                {usage.usage_kind} · {usage.semantic_domain} · r
                                {usage.subject_revision}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </aside>
                  </div>
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center text-xs text-[var(--color-text-muted)]">
                    <FileMd aria-hidden="true" className="mr-2" size={18} />
                    {documents.length > 0
                      ? "正在加载 Markdown blocks…"
                      : "选择或等待一个已解析文档版本。"}
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-[500px] items-center justify-center text-sm text-[var(--color-text-muted)]">
                选择或创建一个 Knowledge Base。
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
