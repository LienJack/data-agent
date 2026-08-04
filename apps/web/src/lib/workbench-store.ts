import { create } from "zustand";
import type {
  Hypothesis,
  RunConnectionState,
  RunProjection,
  WorkbenchState,
} from "./run-projection";
import { createEmptyWorkbenchState } from "./run-projection";

// ─── Store 类型 ────────────────────────────────────────────────────────────────

interface WorkbenchActions {
  setProjection: (projection: RunProjection) => void;
  setQuestion: (question: string) => void;
  setClarification: (clarification: string) => void;
  addHypothesis: (hypothesis: Hypothesis) => void;
  updateHypothesis: (id: string, updates: Partial<Hypothesis>) => void;
  setCurrentAction: (action: string) => void;
  setAuthorityState: (state: WorkbenchState["authorityState"]) => void;
  setSectionStatus: (
    section: keyof WorkbenchState["sections"],
    status: WorkbenchState["sections"][keyof WorkbenchState["sections"]],
  ) => void;
  setError: (error: string | undefined) => void;
  setBusy: (busy: boolean) => void;
  setClarificationPending: (pending: boolean) => void;
  setConnection: (connection: RunConnectionState) => void;
  setActiveRunId: (runId: string | null) => void;
  setProjectionVersion: (version: number) => void;
  reset: () => void;
  hydrate: (state: WorkbenchState) => void;
}

export type WorkbenchStore = WorkbenchState & WorkbenchActions;

// ─── Store ──────────────────────────────────────────────────────────────────

export const useWorkbenchStore = create<WorkbenchStore>((set) => ({
  ...createEmptyWorkbenchState(),

  setProjection: (projection) =>
    set({ projection, sections: { ...createEmptyWorkbenchState().sections, query: "ready" } }),

  setQuestion: (question) =>
    set((state) => ({
      projection: state.projection ? { ...state.projection, question } : null,
    })),

  setClarification: (clarification) =>
    set((state) => ({
      projection: state.projection ? { ...state.projection, clarification } : null,
    })),

  addHypothesis: (hypothesis) =>
    set((state) => ({
      projection: state.projection
        ? {
            ...state.projection,
            hypothesis: [...(state.projection.hypothesis ?? []), hypothesis],
          }
        : null,
      sections: { ...state.sections, hypothesis: "ready" },
    })),

  updateHypothesis: (id, updates) =>
    set((state) => ({
      projection: state.projection
        ? {
            ...state.projection,
            hypothesis: state.projection.hypothesis?.map((h) =>
              h.id === id ? { ...h, ...updates } : h,
            ),
          }
        : null,
    })),

  setCurrentAction: (currentAction) => set({ currentAction }),

  setAuthorityState: (authorityState) => set({ authorityState }),

  setSectionStatus: (section, status) =>
    set((state) => ({
      sections: { ...state.sections, [section]: status },
    })),

  setError: (error) => set({ error }),

  setBusy: (busy) => set({ busy }),

  setClarificationPending: (clarificationPending) => set({ clarificationPending }),

  setConnection: (connection) => set({ connection }),

  setActiveRunId: (activeRunId) => set({ activeRunId }),

  setProjectionVersion: (projectionVersion) => set({ projectionVersion }),

  reset: () => set(createEmptyWorkbenchState()),

  hydrate: (state) => set(state),
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useWorkbenchProjection = () => useWorkbenchStore((s) => s.projection);
export const useWorkbenchSections = () => useWorkbenchStore((s) => s.sections);
export const useWorkbenchSectionStatus = (section: keyof WorkbenchState["sections"]) =>
  useWorkbenchStore((s) => s.sections[section]);
export const useWorkbenchAuthority = () =>
  useWorkbenchStore((s) => ({
    authorityState: s.authorityState,
    coreL2Verdict: s.coreL2Verdict,
    attributionF9Status: s.attributionF9Status,
    fixtureEvidenceVerdict: s.fixtureEvidenceVerdict,
    currentAction: s.currentAction,
  }));
export const useWorkbenchError = () => useWorkbenchStore((s) => s.error);
export const useWorkbenchBusy = () => useWorkbenchStore((s) => s.busy);
export const useWorkbenchClarification = () => useWorkbenchStore((s) => s.clarificationPending);
export const useRunConnection = () => useWorkbenchStore((s) => s.connection);
export const useActiveRunId = () => useWorkbenchStore((s) => s.activeRunId);
export const useProjectionVersion = () => useWorkbenchStore((s) => s.projectionVersion);
