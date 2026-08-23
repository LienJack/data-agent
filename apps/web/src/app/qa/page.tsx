"use client";

import { ChatCircleDots, Path } from "@phosphor-icons/react";
import { useEffect } from "react";
import { ChatArea } from "@/components/qa/chat-area";
import { ChatInput } from "@/components/qa/chat-input";
import { QAInspector } from "@/components/qa/qa-inspector";
import { ResolutionTraceView } from "@/components/qa/resolution-trace-view";
import { parseQAInspectorTarget } from "@/lib/qa-inspector-target";
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
  const selectConversation = useQAStore((state) => state.selectConversation);
  const restoreInspector = useQAStore((state) => state.restoreInspector);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const runId = parameters.get("run");
    const conversationId = parameters.get("conversation");
    const sequence = Number(parameters.get("event"));
    const tab = parameters.get("tab");
    const inspectorTarget = parseQAInspectorTarget(parameters);
    void (async () => {
      if (conversationId)
        await selectConversation(conversationId, { preserveInspectorQuery: true });
      restoreInspector(inspectorTarget);
      if (runId && Number.isSafeInteger(sequence) && sequence > 0) {
        const focus = { runId, sequence };
        if (tab === "trajectory") openTrajectory(focus);
        if (tab === "conversation") openConversation(focus);
      } else if (tab === "trajectory") {
        setView("trajectory");
      }
    })();
  }, [openConversation, openTrajectory, restoreInspector, selectConversation, setView]);
  return (
    <div className="qa-page-frame min-w-0 bg-transparent">
      <nav
        className="surface-floating page-command-bar col-start-1 row-start-1 flex h-12 shrink-0 items-center gap-1 border-b px-3 sm:px-5"
        aria-label="对话视图"
      >
        {(["conversation", "trajectory"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-current={view === candidate ? "page" : undefined}
            onClick={() => setView(candidate)}
            className={`control-pressable flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-xs font-medium ${view === candidate ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]"}`}
          >
            {candidate === "conversation" ? (
              <ChatCircleDots aria-hidden="true" size={15} />
            ) : (
              <Path aria-hidden="true" size={15} />
            )}
            {candidate === "conversation" ? "对话" : "轨迹"}
          </button>
        ))}
      </nav>
      <div className="col-start-1 row-start-2 min-h-0 overflow-hidden">
        {view === "conversation" ? <ChatArea /> : <ResolutionTraceView />}
      </div>
      {view === "conversation" && (
        <div className="col-start-1 row-start-3">
          <ChatInput />
        </div>
      )}
      <QAInspector />
    </div>
  );
}
