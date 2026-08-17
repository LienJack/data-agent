"use client";

import type { WorkspaceFileReference, WorkspaceFileRevision } from "@data-agent/contracts";
import { ArrowClockwise, Paperclip, UploadSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWorkspaceId } from "@/lib/api-client";

interface FileAttachmentSelectorProps {
  readonly sessionId: string | null;
  readonly disabled: boolean;
  readonly selected: readonly WorkspaceFileReference[];
  readonly onChange: (files: readonly WorkspaceFileReference[]) => void;
}

function route(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/files`;
}

export function FileAttachmentSelector({
  sessionId,
  disabled,
  selected,
  onChange,
}: FileAttachmentSelectorProps) {
  const [files, setFiles] = useState<WorkspaceFileRevision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const workspaceId = resolveWorkspaceId();
    if (!workspaceId || !sessionId) {
      setFiles([]);
      return;
    }
    const response = await fetch(
      `${route(workspaceId)}?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("附件列表加载失败");
    const json = (await response.json()) as { data: WorkspaceFileRevision[] };
    setFiles(json.data);
  }, [sessionId]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "附件列表加载失败"),
    );
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      const workspaceId = resolveWorkspaceId();
      if (!workspaceId || !sessionId) return;
      setBusy(true);
      setError(undefined);
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("session_id", sessionId);
        form.set("idempotency_key", crypto.randomUUID());
        const response = await fetch(route(workspaceId), { method: "POST", body: form });
        if (!response.ok) throw new Error("附件上传或扫描任务创建失败");
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "附件上传失败");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [refresh, sessionId],
  );

  const selectedIds = new Set(selected.map((file) => file.file_id));
  return (
    <details className="relative">
      <summary
        className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--color-border-default)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
        aria-label="选择工作空间附件"
      >
        <Paperclip className="size-4" aria-hidden="true" />
        附件{selected.length > 0 ? ` ${selected.length}` : ""}
      </summary>
      <div className="absolute bottom-11 right-0 z-30 w-80 rounded-xl border border-[var(--color-border-default)] bg-white p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">会话附件</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded p-1 hover:bg-[var(--color-bg-tertiary)]"
              aria-label="刷新附件状态"
            >
              <ArrowClockwise className="size-4" />
            </button>
            <button
              type="button"
              disabled={disabled || busy || !sessionId}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40"
            >
              <UploadSimple className="size-4" /> 上传
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.csv,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
        </div>
        {error && <p className="mb-2 text-xs text-[var(--color-status-danger)]">{error}</p>}
        <div className="max-h-52 space-y-1 overflow-y-auto">
          {files.length === 0 && (
            <p className="py-4 text-center text-xs text-[var(--color-text-muted)]">
              暂无附件。上传后需等待扫描完成。
            </p>
          )}
          {files.map((file) => {
            const ready = file.status === "READY";
            return (
              <label
                key={`${file.file_id}:${file.revision_hash}`}
                className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-bg-tertiary)]"
              >
                <input
                  type="checkbox"
                  disabled={!ready || disabled}
                  checked={selectedIds.has(file.file_id)}
                  onChange={(event) => {
                    const reference = {
                      file_id: file.file_id,
                      revision: file.revision,
                      revision_hash: file.revision_hash,
                    };
                    onChange(
                      event.target.checked
                        ? [...selected.filter((item) => item.file_id !== file.file_id), reference]
                        : selected.filter((item) => item.file_id !== file.file_id),
                    );
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-xs">{file.original_filename}</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {ready ? "可用" : file.status === "QUARANTINED" ? "扫描中" : "已拒绝"}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}
