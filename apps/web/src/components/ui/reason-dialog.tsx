"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "./button";

interface ReasonDialogProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly reasonLabel: string;
  readonly confirmLabel: string;
  readonly reason: string;
  readonly pending?: boolean;
  readonly destructive?: boolean;
  readonly error?: string;
  readonly onReasonChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
}

export function ReasonDialog(props: ReasonDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!props.pending) props.onCancel();
      }}
      className="m-auto w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-[var(--color-border-default)] bg-white p-5 text-[var(--color-text-primary)] shadow-2xl shadow-slate-950/10 backdrop:bg-slate-950/25 backdrop:backdrop-blur-[2px]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
        {props.eyebrow}
      </p>
      <h3 id={titleId} className="mt-2 text-lg font-semibold tracking-[-0.02em]">
        {props.title}
      </h3>
      <p id={descriptionId} className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
        {props.description}
      </p>
      {props.error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {props.error}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const reason = props.reason.trim();
          if (reason) props.onConfirm(reason);
        }}
      >
        <label className="mt-5 block text-[11px] font-medium">
          {props.reasonLabel}
          <textarea
            required
            rows={3}
            maxLength={500}
            value={props.reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            className="mt-1.5 w-full resize-none rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-[var(--color-border-focused)]"
            placeholder="说明本次操作的业务原因，便于后续审计"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={props.pending} onClick={props.onCancel}>
            取消
          </Button>
          <Button
            type="submit"
            variant={props.destructive ? "danger" : "primary"}
            className={
              props.destructive
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : undefined
            }
            loading={props.pending}
            disabled={!props.reason.trim()}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
