"use client";

import { INBOX_GROUPS, type InboxGroup, type InboxItem } from "@data-agent/contracts";
import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, Spinner } from "@/components/ui";
import { fetchInboxItems, fetchPacketDetail } from "@/lib/semantic-api";
import { useSemanticStore } from "@/lib/semantic-store";
import { cn, relativeTime } from "@/lib/utils";

/** 风险等级对应的颜色和标签 */
const riskConfig: Record<string, { label: string; className: string }> = {
  critical: {
    label: "严重",
    className: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  high: {
    label: "高",
    className: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  medium: {
    label: "中",
    className: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  low: {
    label: "低",
    className: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
};

/** 变更类别中文标签 */
const changeClassLabels: Record<string, string> = {
  metric: "指标",
  formula: "公式",
  relationship: "关系",
  binding: "绑定",
  governance: "治理",
  other: "其他",
};

export function ReviewInbox() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activeGroup, setActiveGroup] = useState<InboxGroup>("my-decision");
  const [items, setItems] = useState<InboxItem[]>([]);

  const loadItems = useCallback(async (group: InboxGroup) => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await fetchInboxItems(group);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(activeGroup);
  }, [activeGroup, loadItems]);

  const handleSelectItem = async (item: InboxItem) => {
    setLoading(true);
    try {
      const data = await fetchPacketDetail(item.packetId);
      if (data) {
        useSemanticStore.getState().setPacketDetail(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 分组导航 */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {INBOX_GROUPS.map((group) => (
          <button
            type="button"
            key={group.id}
            onClick={() => setActiveGroup(group.id)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              activeGroup === group.id
                ? "text-[var(--color-accent)] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <EmptyState
          title="加载失败"
          description={error}
          action={
            <button
              type="button"
              onClick={() => void loadItems(activeGroup)}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
            >
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="暂无审核项" description="当前分组没有待处理的审核请求" />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              type="button"
              key={item.packetId}
              onClick={() => handleSelectItem(item)}
              className="flex w-full items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
            >
              {/* 风险等级指示器 */}
              <div
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  riskConfig[item.riskLevel]?.className,
                )}
              >
                {riskConfig[item.riskLevel]?.label}
              </div>

              {/* 内容 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {item.title}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {changeClassLabels[item.changeClass] ?? item.changeClass}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                  <span>{item.domain}</span>
                  <span>·</span>
                  <span>{item.proposer}</span>
                  <span>·</span>
                  <span>{relativeTime(item.createdAt)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                  <span>
                    Quorum: {item.quorum.current}/{item.quorum.required}
                  </span>
                  {item.currentDecision === "pending" && (
                    <span className="text-[var(--color-warning)]">待决策</span>
                  )}
                </div>
              </div>

              {/* 到期时间 */}
              <div className="shrink-0 text-right text-xs text-[var(--color-text-tertiary)]">
                <div>到期</div>
                <div>{relativeTime(item.expiresAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
