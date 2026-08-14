"use client";

import type { ModelProvider } from "@data-agent/contracts";
import { useEffect, useState } from "react";
import { ProviderMark } from "@/components/settings/provider-mark";
import type { ModelVendorId } from "@/lib/model-types";
import { useQAActiveConversationId, useQAConversations, useQAStore } from "@/lib/qa-store";
import { ResourceCardPicker } from "./resource-card-picker";

interface ModelOption {
  id: string;
  name: string;
  modelName: string;
  baseUrl: string;
  vendorId: ModelVendorId;
  provider: ModelProvider;
  isSystemDefault: boolean;
}

/**
 * 模型选择器。
 *
 * 下拉菜单，从 Model Settings 获取可用模型。
 * 选择后更新当前对话的模型绑定。
 */
export function ModelSelector() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();
  const updateResources = useQAStore((state) => state.updateActiveConversationResources);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await fetch("/api/models");
        if (response.ok) {
          const json = (await response.json()) as { data: ModelOption[] };
          setModels(
            [...json.data].sort(
              (left, right) => Number(right.isSystemDefault) - Number(left.isSystemDefault),
            ),
          );
        }
      } catch {
        // 静默失败
      }
    };
    loadModels();
  }, []);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const activeModelId = activeConversation?.modelId ?? "";

  return (
    <ResourceCardPicker
      label="模型"
      value={activeModelId}
      placeholder="系统默认模型"
      options={models.map((model) => ({
        id: model.id,
        title: model.name,
        description: model.modelName,
        mark: <ProviderMark vendorId={model.vendorId} size="sm" />,
        badge: model.isSystemDefault ? "默认" : undefined,
      }))}
      onChange={(modelId) => updateResources({ modelId })}
    />
  );
}
