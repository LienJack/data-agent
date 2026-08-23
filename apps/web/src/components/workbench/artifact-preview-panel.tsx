"use client";

import {
  type ArtifactPreviewResult,
  type ArtifactReference,
  artifactPreviewResultSchema,
  artifactReferenceIdentity,
} from "@data-agent/contracts";
import { useEffect, useRef, useState } from "react";
import { resolveWorkspaceId, workspaceRequestHeaders } from "@/lib/api-client";
import { ArtifactWorkspace } from "./artifact-workspace";

type PreviewState =
  | { kind: "loading" }
  | { kind: "ready"; preview: ArtifactPreviewResult }
  | { kind: "error"; code: string; message: string };

export function ArtifactPreviewPanel({
  reference,
  pageSize = 50,
}: {
  readonly reference: ArtifactReference;
  readonly pageSize?: number;
}) {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    const controller = new AbortController();
    setState({ kind: "loading" });
    const workspaceId = resolveWorkspaceId();
    const query = new URLSearchParams({
      reference: JSON.stringify(reference),
      offset: String(offset),
      limit: String(pageSize),
    });
    void fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(reference.artifact_id)}?${query.toString()}`,
      { headers: workspaceRequestHeaders(workspaceId), signal: controller.signal },
    )
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        if (!response.ok) {
          throw Object.assign(new Error(body?.error?.message ?? "Artifact 预览失败"), {
            code: body?.error?.code ?? "ARTIFACT_PREVIEW_FAILED",
          });
        }
        const preview = artifactPreviewResultSchema.parse(body);
        if (
          artifactReferenceIdentity(preview.source_ref) !== artifactReferenceIdentity(reference)
        ) {
          throw Object.assign(new Error("Artifact 预览返回了不同的 Source Reference。"), {
            code: "ARTIFACT_PREVIEW_SOURCE_DRIFT",
          });
        }
        return preview;
      })
      .then((preview) => {
        if (generation.current === currentGeneration) setState({ kind: "ready", preview });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        setState({
          kind: "error",
          code:
            typeof error === "object" && error && "code" in error
              ? String(error.code)
              : "ARTIFACT_PREVIEW_INVALID",
          message: error instanceof Error ? error.message : "Artifact 预览失败",
        });
      });
    return () => controller.abort();
  }, [offset, pageSize, reference]);

  if (state.kind === "loading") {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="正在加载 Artifact">
        <div className="h-4 w-3/5 animate-pulse rounded bg-[var(--color-bg-overlay)]" />
        <div className="h-28 animate-pulse rounded bg-[var(--color-bg-overlay)]" />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="border-l-2 border-[var(--color-error)] bg-red-50 px-3 py-3">
        <p className="text-xs font-semibold text-red-800">Artifact 预览失败</p>
        <p className="mt-1 text-xs text-red-700">{state.message}</p>
        <code className="mt-2 block font-mono text-[10px] text-red-700">{state.code}</code>
      </div>
    );
  }
  return (
    <ArtifactWorkspace
      preview={state.preview}
      onPageChange={(nextOffset) => setOffset(Math.max(0, nextOffset))}
    />
  );
}
