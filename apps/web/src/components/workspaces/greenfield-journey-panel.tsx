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
    <details
      className="surface-reading group rounded-[var(--radius-panel)] border"
      open={Boolean(currentStage)}
    >
      <summary className="control-pressable flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
        <span>
          <span id="greenfield-journey-title" className="block text-xs font-semibold">
            {t("journey.title")}
          </span>
          <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-muted)]">
            {currentStage ?? t("journey.description")}
          </span>
        </span>
        <ArrowRight
          aria-hidden="true"
          className="shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-90"
          size={15}
        />
      </summary>

      <div className="border-t border-[var(--color-border-default)] px-5 pb-5">
        <ol className="relative ml-1 border-l border-[var(--color-border-default)] py-2">
          {primaryStages.map((definition, index) => {
            const active = definition.stage === currentStage;
            const ready = currentStage === "PUBLISHED_V1_READY" && !definition.blocks_qa;
            return (
              <li
                key={definition.stage}
                className="relative py-2 pl-5"
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={`absolute -left-[7px] top-[13px] flex size-[13px] items-center justify-center rounded-full border ${
                    active
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                      : ready
                        ? "border-[var(--color-success)] bg-white"
                        : "border-[var(--color-border-overlay)] bg-white"
                  }`}
                >
                  {ready ? (
                    <CheckCircle
                      aria-hidden="true"
                      className="text-[var(--color-success)]"
                      size={11}
                      weight="fill"
                    />
                  ) : null}
                </span>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold">{definition.title[locale]}</span>
                  <span className="font-mono text-[8px] text-[var(--color-text-muted)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-muted)]">
                  {definition.owner} · {definition.next_action[locale]}
                </p>
              </li>
            );
          })}
        </ol>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {WORKSPACE_STATUS_AXES.map(({ axis, states }, index) => {
            const axisLabels = [
              "journey.taskAxis",
              "journey.evidenceAxis",
              "journey.benchmarkAxis",
              "journey.releaseAxis",
            ] as const;
            return (
              <div key={axis} className="rounded-[10px] bg-[var(--color-bg-overlay)] px-3 py-2.5">
                <p className="text-[9px] font-semibold text-[var(--color-text-secondary)]">
                  {t(axisLabels[index] ?? "journey.axes")}
                </p>
                <p className="mt-1 line-clamp-2 font-mono text-[8px] leading-4 text-[var(--color-text-muted)]">
                  {states.join(" / ")}
                </p>
              </div>
            );
          })}
        </div>

        <p className="mt-4 flex items-start gap-2 border-t border-[var(--color-border-default)] pt-3 font-mono text-[8px] leading-4 text-[var(--color-text-muted)]">
          <ShieldWarning aria-hidden="true" className="mt-0.5 shrink-0" size={11} />
          {t("journey.disclaimer")}
        </p>
      </div>
    </details>
  );
}
