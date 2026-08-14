"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Separator, Spinner, Tabs } from "@/components/ui";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useCanDecideOnPacket,
  useCurrentUser,
  useCurrentUserId,
  useSemanticRole,
} from "@/hooks/use-semantic-auth";
import { fetchPacketDetail, submitDecision } from "@/lib/semantic-api";
import { useSemanticStore } from "@/lib/semantic-store";
import type { ReviewDecision, SemanticReviewPacket } from "@/lib/semantic-types";
import { SEMANTIC_ROLE_LABELS } from "@/lib/semantic-types";
import { formatDateTime } from "@/lib/utils";

interface ReviewDetailProps {
  packetId: string;
  onBack: () => void;
}

/** 风险等级配置 */
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

const statusLabels: Record<string, string> = {
  active: "生效中",
  candidate: "待审核",
  stale: "已过期",
  rejected: "已拒绝",
  "approved-not-published": "已批准未发布",
  published: "已发布",
  "rolled-back": "已回滚",
};

export function ReviewDetail({ packetId, onBack }: ReviewDetailProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [packet, setPacket] = useState<SemanticReviewPacket | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionComment, setDecisionComment] = useState("");
  const currentUser = useCurrentUser();
  const currentUserId = useCurrentUserId();
  const semanticRole = useSemanticRole();

  const storePacket = useSemanticStore((s) => s.packets[packetId]);

  // ── 权限检查 Hook（必须在任何条件 return 之前调用） ──────────────────────

  const { canDecide, reason: cannotDecideReason } = useCanDecideOnPacket(
    packet ?? { proposer: { id: "" }, status: "candidate" },
  );
  const isReviewer = useMemo(
    () => (packet ? packet.reviewers.some((r) => r.id === currentUserId) : false),
    [packet, currentUserId],
  );

  // ── 数据加载 ──────────────────────────────────────────────────────────────

  const loadPacket = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await fetchPacketDetail(packetId);
      if (data) {
        setPacket(data);
        useSemanticStore.getState().setPacketDetail(data);
      } else {
        setError("未找到审核包");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [packetId]);

  useEffect(() => {
    if (storePacket) {
      setPacket(storePacket);
      setLoading(false);
    } else {
      void loadPacket();
    }
  }, [storePacket, loadPacket]);

  const handleDecision = useCallback(
    async (decision: ReviewDecision) => {
      if (!packet) return;
      setDecisionLoading(true);
      try {
        const result = await submitDecision(packetId, decision, decisionComment);
        if (result.success) {
          useSemanticStore
            .getState()
            .recordDecision(packetId, "user-001", decision, decisionComment);
          setDecisionComment("");
        }
      } catch (err) {
        console.error("Decision failed:", err);
      } finally {
        setDecisionLoading(false);
      }
    },
    [packet, packetId, decisionComment],
  );

  // ── 加载 / 错误状态 ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !packet) {
    return (
      <EmptyState
        title="加载失败"
        description={error ?? "未找到审核包"}
        action={<Button onClick={onBack}>返回收件箱</Button>}
      />
    );
  }

  // ── Tabs 定义 ─────────────────────────────────────────────────────────────

  const tabs = [
    {
      id: "overview",
      label: "概览",
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--color-text-tertiary)]">域</span>
              <p className="font-medium">{packet.domain}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-tertiary)]">状态</span>
              <p className="font-medium">{statusLabels[packet.status] ?? packet.status}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-tertiary)]">提案人</span>
              <p className="font-medium">{packet.proposer.name}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-tertiary)]">版本</span>
              <p className="font-medium">v{packet.version}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-tertiary)]">创建时间</span>
              <p className="font-medium">{formatDateTime(packet.createdAt)}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-tertiary)]">到期时间</span>
              <p className="font-medium">{formatDateTime(packet.expiresAt)}</p>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="mb-1 text-sm font-medium">描述</h4>
            <p className="text-sm text-[var(--color-text-secondary)]">{packet.description}</p>
          </div>

          <Separator />

          <div>
            <h4 className="mb-2 text-sm font-medium">
              审核人 ({packet.quorum.current}/{packet.quorum.required})
            </h4>
            <div className="space-y-2">
              {packet.reviewers.map((reviewer) => (
                <div
                  key={reviewer.id}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2"
                >
                  <span className="text-sm">{reviewer.name}</span>
                  <Badge
                    variant={
                      reviewer.decision === "approved"
                        ? "success"
                        : reviewer.decision === "rejected"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {reviewer.decision === "approved"
                      ? "已批准"
                      : reviewer.decision === "rejected"
                        ? "已拒绝"
                        : "待决策"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "diff",
      label: "Diff",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">{packet.diff.summary}</p>
          {packet.diff.modifications.map((entry) => (
            <div key={entry.path} className="rounded-md border border-[var(--color-border)]">
              <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs font-medium">
                {entry.path}
              </div>
              <div className="space-y-1 p-3 font-mono text-xs">
                {entry.before && (
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-[var(--color-error)]">-</span>
                    <span className="text-[var(--color-text-secondary)]">{entry.before}</span>
                  </div>
                )}
                {entry.after && (
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-[var(--color-success)]">+</span>
                    <span className="text-[var(--color-text-primary)]">{entry.after}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {packet.diff.additions.map((entry) => (
            <div key={entry.path} className="rounded-md border border-[var(--color-border)]">
              <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs font-medium">
                {entry.path}
              </div>
              <div className="p-3 font-mono text-xs">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-[var(--color-success)]">+</span>
                  <span className="text-[var(--color-text-primary)]">{entry.after}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "impact",
      label: "影响分析",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">{packet.impact.summary}</p>
          <div>
            <h4 className="mb-1 text-sm font-medium">受影响查询</h4>
            <ul className="space-y-1">
              {packet.impact.affectedQueries.map((q) => (
                <li key={q} className="text-sm text-[var(--color-text-secondary)]">
                  {q}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-medium">受影响评测</h4>
            <ul className="space-y-1">
              {packet.impact.affectedEvals.map((e) => (
                <li key={e} className="text-sm text-[var(--color-text-secondary)]">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: "lineage",
      label: "溯源",
      content: (
        <div className="space-y-3">
          {packet.lineage.map((entry, i) => (
            <div key={entry.action + entry.version} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="size-2 rounded-full bg-[var(--color-accent)]" />
                {i < packet.lineage.length - 1 && (
                  <div className="h-full w-px bg-[var(--color-border)]" />
                )}
              </div>
              <div className="pb-4">
                <div className="text-sm font-medium">{entry.action}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">
                  {entry.actor} · {formatDateTime(entry.timestamp)}
                </div>
                {entry.comment && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    {entry.comment}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ),
    },
  ];

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            ← 返回
          </button>
          <h2 className="text-lg font-semibold">{packet.title}</h2>
          <Badge
            variant={
              packet.riskLevel === "critical" || packet.riskLevel === "high"
                ? "destructive"
                : packet.riskLevel === "medium"
                  ? "warning"
                  : "default"
            }
          >
            {riskConfig[packet.riskLevel]?.label}风险
          </Badge>
        </div>
      </div>

      {/* 详情 Tabs */}
      <Tabs tabs={tabs} />

      <Separator />

      {/* 角色信息 */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-tertiary)]">当前身份：</span>
          <span className="font-medium">{currentUser.name}</span>
          <Badge variant="outline">{SEMANTIC_ROLE_LABELS[semanticRole]}</Badge>
        </div>
      </div>

      {/* 决策区 */}
      {packet.status === "candidate" && (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
          <h4 className="text-sm font-medium">做出决策</h4>

          {canDecide && isReviewer ? (
            <>
              <textarea
                placeholder="决策备注（可选）"
                value={decisionComment}
                onChange={(e) => setDecisionComment(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  variant="default"
                  loading={decisionLoading}
                  onClick={() => void handleDecision("approved")}
                >
                  批准
                </Button>
                <Button
                  variant="destructive"
                  loading={decisionLoading}
                  onClick={() => void handleDecision("rejected")}
                >
                  拒绝
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="无权决策"
              description={
                cannotDecideReason ??
                (isReviewer ? "你不是该审核包的审核人" : "当前角色无权审批此提案")
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
