"use client";

import { useCallback } from "react";
import { ReviewDetail } from "@/components/semantic/review-detail";
import { ReviewInbox } from "@/components/semantic/review-inbox";
import { useSemanticStore } from "@/lib/semantic-store";

/**
 * 语义审核页面 — 参考 DataFoundry 工作区模式。
 *
 * 紧凑布局，信息密度高，与主页保持一致的视觉风格。
 */
export default function SemanticReviewPage() {
  const view = useSemanticStore((s) => s.view);
  const setView = useSemanticStore((s) => s.setView);

  const handleBack = useCallback(() => {
    setView({ kind: "inbox", group: "my-decision", items: [] });
  }, [setView]);

  return (
    <div className="workspace-container">
      <div className="workspace-section">
        <div className="mb-4">
          <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
            语义治理 · 审核工作台
          </h1>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            审阅和管理语义控制平面的提案、变更与发布
          </p>
        </div>

        {view.kind === "detail" ? (
          <ReviewDetail packetId={view.packet.id} onBack={handleBack} />
        ) : (
          <ReviewInbox />
        )}
      </div>
    </div>
  );
}
