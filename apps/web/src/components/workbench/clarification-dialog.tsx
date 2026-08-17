"use client";

import {
  type InterruptionReplyReceipt,
  interruptionReplyReceiptSchema,
  type RunInterruption,
  runInterruptionSchema,
} from "@data-agent/contracts";
import { CheckCircle, ShieldWarning, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getRun, resolveWorkspaceId, workspaceRequestHeaders } from "@/lib/api-client";
import { useWorkbenchStore } from "@/lib/workbench-store";

type DialogState =
  | { readonly kind: "loading" }
  | { readonly kind: "idle" }
  | { readonly kind: "open"; readonly interruption: RunInterruption }
  | { readonly kind: "submitting"; readonly interruption: RunInterruption }
  | { readonly kind: "stale"; readonly message: string }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "error"; readonly message: string };

interface ClarificationDialogProps {
  readonly workspaceId?: string;
  readonly runId?: string | null;
  readonly onResolved?: (receipt: InterruptionReplyReceipt) => void | Promise<void>;
}

interface ApiEnvelope {
  readonly data?: unknown;
  readonly error?: { readonly code?: string; readonly message?: string };
}

function endpoint(workspaceId: string, runId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/interruptions`;
}

async function loadInterruption(
  workspaceId: string,
  runId: string,
): Promise<RunInterruption | null> {
  const response = await fetch(endpoint(workspaceId, runId), {
    cache: "no-store",
    headers: workspaceRequestHeaders(workspaceId),
  });
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
  if (!response.ok) {
    const error = new Error(body.error?.message ?? `澄清状态加载失败 (${response.status})`);
    Object.assign(error, { status: response.status, code: body.error?.code });
    throw error;
  }
  if (body.data === null) return null;
  return runInterruptionSchema.parse(body.data);
}

async function submitReply(
  workspaceId: string,
  runId: string,
  responseBody:
    | { readonly kind: "FREE_TEXT"; readonly text: string }
    | { readonly kind: "OPTION"; readonly option_id: string },
): Promise<InterruptionReplyReceipt> {
  const response = await fetch(endpoint(workspaceId, runId), {
    method: "POST",
    headers: workspaceRequestHeaders(workspaceId),
    body: JSON.stringify({ idempotency_key: crypto.randomUUID(), response: responseBody }),
  });
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
  if (!response.ok || body.data === undefined) {
    const error = new Error(body.error?.message ?? `澄清回复失败 (${response.status})`);
    Object.assign(error, { status: response.status, code: body.error?.code });
    throw error;
  }
  return interruptionReplyReceiptSchema.parse(body.data);
}

function errorState(error: unknown): DialogState {
  const status = error instanceof Error && "status" in error ? Number(error.status) : 0;
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (status === 403) return { kind: "permission-denied" };
  if (status === 409 || /CONFLICT|STALE/.test(code)) {
    return { kind: "stale", message: error instanceof Error ? error.message : "澄清状态已变化。" };
  }
  return { kind: "error", message: error instanceof Error ? error.message : "澄清请求失败。" };
}

export function ClarificationDialogView({
  state,
  text,
  selectedOption,
  onTextChange,
  onOptionChange,
  onClose,
  onRetry,
  onSubmit,
  dialogRef,
  textareaRef,
  onKeyDown,
}: {
  readonly state: Exclude<DialogState, { readonly kind: "idle" } | { readonly kind: "loading" }>;
  readonly text: string;
  readonly selectedOption: string;
  readonly onTextChange: (value: string) => void;
  readonly onOptionChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onSubmit: () => void;
  readonly dialogRef?: React.RefObject<HTMLDivElement | null>;
  readonly textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  readonly onKeyDown?: (event: React.KeyboardEvent) => void;
}) {
  const actionable = state.kind === "open" || state.kind === "submitting";
  const interruption = actionable ? state.interruption : null;
  const busy = state.kind === "submitting";
  const canSubmit = Boolean(selectedOption || text.trim());
  const unavailableMessage =
    state.kind === "permission-denied"
      ? "当前角色不能回复该 Run 的澄清。请联系工作空间管理员。"
      : state.kind === "stale" || state.kind === "error"
        ? state.message
        : "澄清暂不可用。";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-clarification-title"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-default)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              Run interruption
            </p>
            <h2 id="run-clarification-title" className="mt-1 text-base font-semibold">
              {state.kind === "permission-denied"
                ? "无权回复澄清"
                : state.kind === "stale"
                  ? "澄清状态已更新"
                  : state.kind === "error"
                    ? "澄清暂不可用"
                    : "需要你的确认"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="关闭澄清窗口"
            title="关闭"
          >
            <X size={17} />
          </button>
        </header>

        <div className="px-5 py-5">
          {interruption ? (
            <>
              <p className="text-sm leading-6 text-[var(--color-text-primary)]">
                {interruption.question}
              </p>
              {interruption.options.length > 0 && (
                <fieldset className="mt-4 grid gap-2">
                  <legend className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
                    选择一个明确答案
                  </legend>
                  {interruption.options.map((option) => (
                    <label
                      key={option.option_id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded border border-[var(--color-border-default)] px-3 text-sm has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-bg-secondary)]"
                    >
                      <input
                        type="radio"
                        name="clarification-option"
                        value={option.option_id}
                        checked={selectedOption === option.option_id}
                        onChange={(event) => onOptionChange(event.target.value)}
                        disabled={busy}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="mt-4 grid gap-1.5">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {interruption.options.length > 0 ? "或补充说明" : "回复"}
                </span>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(event) => onTextChange(event.target.value)}
                  placeholder="补充业务口径、时间范围或筛选条件"
                  rows={4}
                  maxLength={4_000}
                  disabled={busy}
                  className="w-full resize-none rounded border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 text-sm leading-6 outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]"
                />
              </label>
              <p className="mt-3 font-mono text-[10px] text-[var(--color-text-muted)]">
                VERSION {interruption.version} · FENCE {interruption.worker_fence} · CHECKPOINT{" "}
                {interruption.checkpoint_ref.snapshot_version}
              </p>
            </>
          ) : (
            <div className="flex items-start gap-3 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4">
              <ShieldWarning size={19} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                {unavailableMessage}
              </p>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--color-border-default)] px-5 py-4">
          {!interruption && state.kind !== "permission-denied" && (
            <Button type="button" variant="secondary" onClick={onRetry}>
              重新加载
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            稍后处理
          </Button>
          {interruption && (
            <Button type="button" loading={busy} disabled={!canSubmit} onClick={onSubmit}>
              <CheckCircle size={15} weight="fill" />
              提交并恢复 Run
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function ClarificationDialog({
  workspaceId,
  runId,
  onResolved,
}: ClarificationDialogProps = {}) {
  const storedRunId = useWorkbenchStore((store) => store.activeRunId);
  const resolvedWorkspaceId = workspaceId || resolveWorkspaceId();
  const resolvedRunId = runId === undefined ? storedRunId : runId;
  const [state, setState] = useState<DialogState>({ kind: "idle" });
  const [text, setText] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [dismissedHash, setDismissedHash] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const reload = useCallback(async () => {
    if (!resolvedWorkspaceId || !resolvedRunId) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const interruption = await loadInterruption(resolvedWorkspaceId, resolvedRunId);
      setState(interruption?.state === "OPEN" ? { kind: "open", interruption } : { kind: "idle" });
    } catch (error) {
      setState(errorState(error));
    }
  }, [resolvedRunId, resolvedWorkspaceId]);

  useEffect(() => void reload(), [reload]);

  const visible =
    state.kind !== "idle" &&
    state.kind !== "loading" &&
    (!("interruption" in state) || state.interruption.interruption_hash !== dismissedHash);

  useEffect(() => {
    if (!visible) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [visible]);

  function close() {
    if ("interruption" in state) setDismissedHash(state.interruption.interruption_hash);
    previousFocusRef.current?.focus();
  }

  async function submit() {
    if (state.kind !== "open" || !resolvedRunId || !resolvedWorkspaceId) return;
    setState({ kind: "submitting", interruption: state.interruption });
    try {
      const receipt = await submitReply(
        resolvedWorkspaceId,
        resolvedRunId,
        selectedOption
          ? { kind: "OPTION", option_id: selectedOption }
          : { kind: "FREE_TEXT", text: text.trim() },
      );
      setText("");
      setSelectedOption("");
      setState({ kind: "idle" });
      if (onResolved) {
        await onResolved(receipt);
      } else {
        const resumed = await getRun(resolvedRunId, resolvedWorkspaceId);
        const store = useWorkbenchStore.getState();
        store.setProjection(resumed);
        store.setConnection("connecting");
        store.setCurrentAction("正在恢复…");
      }
      previousFocusRef.current?.focus();
    } catch (error) {
      setState(errorState(error));
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!visible) return null;
  return (
    <ClarificationDialogView
      state={state}
      text={text}
      selectedOption={selectedOption}
      onTextChange={(value) => {
        setText(value);
        if (value.trim()) setSelectedOption("");
      }}
      onOptionChange={(value) => {
        setSelectedOption(value);
        setText("");
      }}
      onClose={close}
      onRetry={() => void reload()}
      onSubmit={() => void submit()}
      dialogRef={dialogRef}
      textareaRef={textareaRef}
      onKeyDown={handleKeyDown}
    />
  );
}
