/**
 * Modified from DeepSeek Harness ui-layout/columns.ts concession solver.
 * Fixed upstream commit and MIT notice: components/qa/DEEPSEEK_HARNESS_MIT_NOTICE.md
 */
export const QA_INSPECTOR_CENTER_MIN = 640;
export const QA_INSPECTOR_MIN = 320;
export const QA_INSPECTOR_MAX = 520;
export const QA_INSPECTOR_DEFAULT = 360;
export const QA_TOPBAR_HEIGHT = 52;
export const QA_MOBILE_BOTTOM_NAV_HEIGHT = 64;

export interface QAInspectorColumns {
  center: number;
  details: number;
}

/** Mirrors the fixed Q&A viewport shell in design-system.css. */
export function computeQAShellHeight(viewportHeight: number, mobile: boolean): number {
  return Math.max(
    0,
    Math.round(viewportHeight) - QA_TOPBAR_HEIGHT - (mobile ? QA_MOBILE_BOTTOM_NAV_HEIGHT : 0),
  );
}

export function clampInspectorWidth(width: number): number {
  return Math.min(QA_INSPECTOR_MAX, Math.max(QA_INSPECTOR_MIN, Math.round(width)));
}

/** Harness-derived concession chain: shrink details, then derive it closed. */
export function computeInspectorColumns(
  containerWidth: number,
  preferredWidth: number,
  selected: boolean,
): QAInspectorColumns {
  const available = Math.max(0, Math.round(containerWidth));
  if (!selected) return { center: available, details: 0 };
  const preferred = clampInspectorWidth(preferredWidth);
  if (available - preferred >= QA_INSPECTOR_CENTER_MIN) {
    return { center: available - preferred, details: preferred };
  }
  const conceded = available - QA_INSPECTOR_CENTER_MIN;
  if (conceded >= QA_INSPECTOR_MIN) {
    return { center: QA_INSPECTOR_CENTER_MIN, details: conceded };
  }
  return { center: available, details: 0 };
}
