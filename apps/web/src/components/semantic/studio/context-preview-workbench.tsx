"use client";

import { resolvedContextCommitResultSchema } from "@data-agent/contracts";
import { MagnifyingGlass, SpinnerGap } from "@phosphor-icons/react";
import { useState } from "react";
import { useWorkspaceI18n } from "@/i18n";
import { ContextPreview, type SemanticContextPreviewState } from "./context-preview";

export function ContextPreviewWorkbench({ workspaceId }: { readonly workspaceId: string }) {
  const { t } = useWorkspaceI18n();
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<SemanticContextPreviewState>({ kind: "IDLE" });

  async function resolveContext() {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || state.kind === "RESOLVING") return;
    setState({ kind: "RESOLVING" });
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/context/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ question: normalizedQuestion }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        readonly data?: unknown;
        readonly error?: { readonly code?: string };
      };
      if (!response.ok || payload.data === undefined) {
        setState({ kind: "ERROR", code: payload.error?.code ?? "RESOLVED_CONTEXT_UNAVAILABLE" });
        return;
      }
      setState({ kind: "RESOLVED", result: resolvedContextCommitResultSchema.parse(payload.data) });
    } catch {
      setState({ kind: "ERROR", code: "RESOLVED_CONTEXT_RESPONSE_INVALID" });
    }
  }

  return (
    <section
      className="border border-[var(--color-border-default)] bg-white"
      aria-label={t("context.preview")}
    >
      <form
        className="flex flex-col gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] p-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void resolveContext();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("context.question")}</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={4_000}
            placeholder={t("context.questionPlaceholder")}
            className="h-9 w-full border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={question.trim().length === 0 || state.kind === "RESOLVING"}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 bg-[var(--color-accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === "RESOLVING" ? (
            <SpinnerGap className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <MagnifyingGlass className="size-4" aria-hidden="true" />
          )}
          {t("context.resolve")}
        </button>
      </form>
      <ContextPreview state={state} />
    </section>
  );
}
