"use client";

import { useCallback } from "react";
import { ReviewDetail } from "@/components/semantic/review-detail";
import { ReviewInbox } from "@/components/semantic/review-inbox";
import { useSemanticStore } from "@/lib/semantic-store";

export default function SemanticReviewPage() {
  const view = useSemanticStore((s) => s.view);
  const setView = useSemanticStore((s) => s.setView);

  const handleBack = useCallback(() => {
    setView({ kind: "inbox", group: "my-decision", items: [] });
  }, [setView]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">语义治理 · 审核工作台</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          审阅和管理语义控制平面的提案、变更与发布
        </p>
      </div>

      {view.kind === "detail" ? (
        <ReviewDetail packetId={view.packet.id} onBack={handleBack} />
      ) : (
        <ReviewInbox />
      )}
    </div>
  );
}
