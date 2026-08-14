"use client";

import { useEffect } from "react";
import { ChatArea } from "@/components/qa/chat-area";
import { ChatInput } from "@/components/qa/chat-input";
import { TrajectoryView } from "@/components/qa/trajectory-view";
import { useQAStore, useQAView } from "@/lib/qa-store";

/**
 * Q&A 对话页面。
 *
 * 对话式交互页面：
 * 对话历史已统一进入全局 Workspace Sidebar；页面只保留主对话区域，
 * 避免出现两条并列侧栏。
 */
export default function QAPage() {
  const view = useQAView();
  const setView = useQAStore((state) => state.setView);
  const openTrajectory = useQAStore((state) => state.openTrajectory);
  const openConversation = useQAStore((state) => state.openConversation);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const runId = parameters.get("run");
    const sequence = Number(parameters.get("event"));
    const tab = parameters.get("tab");
    if (runId && Number.isSafeInteger(sequence) && sequence > 0) {
      const focus = { runId, sequence };
      if (tab === "trajectory") openTrajectory(focus);
      if (tab === "conversation") openConversation(focus);
    } else if (tab === "trajectory") {
      setView("trajectory");
    }
  }, [openConversation, openTrajectory, setView]);
  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--color-bg-primary)]">
      <nav
        className="flex h-11 shrink-0 items-end gap-6 border-b border-[var(--color-border-default)] px-5"
        aria-label="对话视图"
      >
        {(["conversation", "trajectory"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-current={view === candidate ? "page" : undefined}
            onClick={() => setView(candidate)}
            className={`h-full border-b-2 px-1 text-sm ${view === candidate ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
          >
            {candidate === "conversation" ? "对话" : "轨迹"}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {view === "conversation" ? <ChatArea /> : <TrajectoryView />}
      </div>
      {view === "conversation" && <ChatInput />}
    </div>
  );
}
