"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ProviderModelView } from "@/lib/model-provider-view";

interface ModelCertificationDialogProps {
  readonly model: ProviderModelView;
  readonly pending: boolean;
  readonly isRecertification: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function ModelCertificationDialog(props: ModelCertificationDialogProps) {
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
      className="m-auto w-[calc(100%-1.5rem)] max-w-md rounded-lg border border-[var(--color-border-default)] bg-white p-5 text-[var(--color-text-primary)] shadow-2xl shadow-slate-950/10 backdrop:bg-slate-950/25"
    >
      <div className="flex size-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
        <ShieldCheck aria-hidden="true" size={18} weight="fill" />
      </div>
      <h3 id={titleId} className="mt-4 text-base font-semibold">
        {props.isRecertification ? "重新认证模型" : "认证模型"}
      </h3>
      <p id={descriptionId} className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
        将使用服务端凭据请求一次供应商模型目录。API 成功返回非空数据即认证通过，并保存
        <span className="font-mono font-medium"> {props.model.model_id}</span> config v
        {props.model.config_version} 的认证状态。
      </p>
      {props.isRecertification && (
        <p className="mt-3 border-l-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
          新认证成功前，当前有效认证继续服务；本次失败不会中断已有工作空间。
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={props.pending} onClick={props.onCancel}>
          取消
        </Button>
        <Button type="button" loading={props.pending} onClick={props.onConfirm}>
          <ShieldCheck aria-hidden="true" size={14} />
          确认{props.isRecertification ? "重新认证" : "认证"}
        </Button>
      </div>
    </dialog>
  );
}
