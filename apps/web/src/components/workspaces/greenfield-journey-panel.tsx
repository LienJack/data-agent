"use client";

import { ArrowRight, CheckCircle, ShieldWarning } from "@phosphor-icons/react";
import { useWorkspaceI18n } from "@/i18n";
import {
  GREENFIELD_STAGE_DEFINITIONS,
  type GreenfieldStage,
  WORKSPACE_STATUS_AXES,
} from "@/lib/workspace-journey";

const primaryStages = GREENFIELD_STAGE_DEFINITIONS.filter(
  ({ stage }) => stage !== "POLICY_MISSING" && stage !== "POLICY_EXPIRED",
);

export function GreenfieldJourneyPanel({
  currentStage = null,
}: {
  readonly currentStage?: GreenfieldStage | null;
}) {
  const { locale, t } = useWorkspaceI18n();

  return (
    <section
      className="border-y border-[var(--color-border-default)] bg-[var(--color-bg-primary)]"
      aria-labelledby="greenfield-journey-title"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
        <div>
          <h2 id="greenfield-journey-title" className="text-sm font-semibold">
            {t("journey.title")}
          </h2>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {t("journey.description")}
          </p>
        </div>
        {currentStage ? (
          <code className="text-[10px] text-[var(--color-text-secondary)]">{currentStage}</code>
        ) : null}
      </header>

      <ol className="grid border-t border-[var(--color-border-default)] sm:grid-cols-2 xl:grid-cols-7">
        {primaryStages.map((definition, index) => {
          const active = definition.stage === currentStage;
          const ready = currentStage === "PUBLISHED_V1_READY" && !definition.blocks_qa;
          return (
            <li
              key={definition.stage}
              className={`relative min-w-0 border-b border-[var(--color-border-default)] px-3 py-3 sm:border-r xl:border-b-0 ${
                active ? "bg-amber-50" : "bg-[var(--color-bg-primary)]"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <div className="flex items-center gap-1.5">
                {ready ? (
                  <CheckCircle aria-hidden="true" className="text-emerald-600" size={14} />
                ) : (
                  <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                )}
                <span className="truncate text-[11px] font-semibold">
                  {definition.title[locale]}
                </span>
              </div>
              <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">{definition.owner}</p>
              <p className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-[var(--color-text-secondary)]">
                <ArrowRight aria-hidden="true" className="mt-0.5 shrink-0" size={11} />
                {definition.next_action[locale]}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-px border-t border-[var(--color-border-default)] bg-[var(--color-border-default)] sm:grid-cols-2 xl:grid-cols-4">
        {WORKSPACE_STATUS_AXES.map(({ axis, states }, index) => {
          const labels = [
            "journey.taskAxis",
            "journey.evidenceAxis",
            "journey.benchmarkAxis",
            "journey.releaseAxis",
          ] as const;
          return (
            <div key={axis} className="bg-[var(--color-bg-canvas)] px-4 py-3">
              <p className="text-[10px] font-semibold text-[var(--color-text-secondary)]">
                {t(labels[index] ?? "journey.axes")}
              </p>
              <p className="mt-1 break-words font-mono text-[9px] leading-4 text-[var(--color-text-muted)]">
                {states.join(" / ")}
              </p>
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-2 border-t border-[var(--color-border-default)] px-5 py-2 font-mono text-[9px] text-[var(--color-text-muted)]">
        <ShieldWarning aria-hidden="true" size={12} />
        {t("journey.disclaimer")}
      </p>
    </section>
  );
}
