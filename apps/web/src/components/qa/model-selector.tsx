"use client";

import { useEffect, useMemo } from "react";
import { ProviderMark } from "@/components/settings/provider-mark";
import type { ModelVendorId } from "@/lib/model-types";
import {
  useQAActiveConversationId,
  useQAConversations,
  useQAResourceCatalog,
  useQAResourceCatalogState,
  useQAResourceError,
  useQAResourceSwitching,
  useQASending,
  useQAStore,
} from "@/lib/qa-store";
import { ResourceCardPicker } from "./resource-card-picker";

const readinessLabels = {
  AVAILABLE: "可运行",
  CERTIFICATION_REQUIRED: "待认证",
  CREDENTIAL_UNAVAILABLE: "缺少凭据",
  CONTEXT_WINDOW_UNVERIFIED: "上下文窗口未认证",
  DISABLED: "已停用",
  STALE: "配置已过期",
} as const;

export function ModelSelector({
  placement = "top",
  compact = true,
}: {
  placement?: "top" | "bottom";
  compact?: boolean;
} = {}) {
  const catalog = useQAResourceCatalog();
  const catalogState = useQAResourceCatalogState();
  const resourceError = useQAResourceError();
  const switching = useQAResourceSwitching();
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();
  const sending = useQASending();
  const loadCatalog = useQAStore((state) => state.loadResourceCatalog);
  const updateResources = useQAStore((state) => state.updateActiveConversationResources);

  useEffect(() => {
    if (catalogState === "idle") loadCatalog();
  }, [catalogState, loadCatalog]);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const options = useMemo(
    () =>
      (catalog?.models ?? []).map((model) => ({
        id: model.model_profile_id,
        title: model.display_name,
        description: [
          `${model.provider} · ${model.model_id}`,
          model.profile_version,
          model.certification_receipt_ref === null
            ? "无当前执行认证"
            : `认证 r${model.certification_receipt_ref.revision}`,
          model.effective_context_ceiling_tokens === null
            ? null
            : `Context ${model.effective_context_ceiling_tokens.toLocaleString()}`,
          model.effective_output_ceiling_tokens === null
            ? null
            : `Output ${model.effective_output_ceiling_tokens.toLocaleString()}`,
        ]
          .filter((value): value is string => value !== null)
          .join(" · "),
        mark: <ProviderMark vendorId={model.provider as ModelVendorId} size="sm" />,
        badge: readinessLabels[model.readiness],
        disabled: !model.selectable,
        disabledReason: model.selectable
          ? undefined
          : `${readinessLabels[model.readiness]}，暂不能用于新分析`,
      })),
    [catalog],
  );

  return (
    <ResourceCardPicker
      label="模型"
      value={activeConversation?.modelProfileId ?? ""}
      placeholder="选择模型"
      options={options}
      onChange={(modelProfileId) => updateResources({ modelProfileId })}
      placement={placement}
      align="right"
      compact={compact}
      disabled={sending}
      pending={switching}
      status={catalogState}
      error={resourceError}
      onRetry={loadCatalog}
    />
  );
}
