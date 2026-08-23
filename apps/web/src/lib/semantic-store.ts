import type {
  InboxGroup,
  InboxItem,
  SemanticReviewDecisionView as ReviewDecision,
  ReviewPacketStatus,
  SemanticReviewPacket,
  SemanticViewState,
} from "@data-agent/contracts";
import { create } from "zustand";

// ─── Store 类型 ────────────────────────────────────────────────────────────────

interface SemanticActions {
  /** 设置当前视图 */
  setView: (view: SemanticViewState) => void;
  /** 设置收件箱数据 */
  setInboxItems: (group: InboxGroup, items: InboxItem[]) => void;
  /** 设置审核包详情 */
  setPacketDetail: (packet: SemanticReviewPacket) => void;
  /** 更新审核包状态 */
  updatePacketStatus: (packetId: string, status: ReviewPacketStatus) => void;
  /** 记录审核决策 */
  recordDecision: (
    packetId: string,
    reviewerId: string,
    decision: ReviewDecision,
    comment?: string,
  ) => void;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;
  /** 设置错误 */
  setError: (error: string | undefined) => void;
  /** 重置 */
  reset: () => void;
}

export interface SemanticStore {
  view: SemanticViewState;
  inbox: Record<InboxGroup, InboxItem[]>;
  packets: Record<string, SemanticReviewPacket>;
  loading: boolean;
  error: string | undefined;
}

export type SemanticStoreBound = SemanticStore & SemanticActions;

// ─── 初始状态 ──────────────────────────────────────────────────────────────────

const initialInbox: Record<InboxGroup, InboxItem[]> = {
  "my-decision": [],
  "waiting-others": [],
  expiring: [],
  completed: [],
};

const initialState: SemanticStore = {
  view: { kind: "inbox", group: "my-decision", items: [] },
  inbox: initialInbox,
  packets: {},
  loading: false,
  error: undefined,
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useSemanticStore = create<SemanticStoreBound>((set) => ({
  ...initialState,

  setView: (view) => set({ view }),

  setInboxItems: (group, items) =>
    set((state) => ({
      inbox: { ...state.inbox, [group]: items },
      view: state.view.kind === "inbox" ? { ...state.view, items } : state.view,
    })),

  setPacketDetail: (packet) =>
    set((state) => ({
      packets: { ...state.packets, [packet.id]: packet },
      view: { kind: "detail", packet },
    })),

  updatePacketStatus: (packetId, status) =>
    set((state) => {
      const packet = state.packets[packetId];
      if (!packet) return state;
      return {
        packets: {
          ...state.packets,
          [packetId]: { ...packet, status },
        },
      };
    }),

  recordDecision: (packetId, reviewerId, decision, comment) =>
    set((state) => {
      const packet = state.packets[packetId];
      if (!packet) return state;

      const newDecision = {
        reviewerId,
        reviewerName: packet.reviewers.find((r) => r.id === reviewerId)?.name ?? "未知",
        decision,
        decidedAt: new Date().toISOString(),
        comment,
        reauthenticated: true,
      };

      const updatedReviewers = packet.reviewers.map((r) =>
        r.id === reviewerId ? { ...r, decision, decidedAt: new Date().toISOString(), comment } : r,
      );

      return {
        packets: {
          ...state.packets,
          [packetId]: {
            ...packet,
            decisions: [...packet.decisions, newDecision],
            reviewers: updatedReviewers,
            quorum: {
              ...packet.quorum,
              current: packet.quorum.current + 1,
            },
          },
        },
      };
    }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useInboxItems = (group: InboxGroup) => useSemanticStore((s) => s.inbox[group]);

export const usePacketDetail = (packetId: string) => useSemanticStore((s) => s.packets[packetId]);

export const useSemanticLoading = () => useSemanticStore((s) => s.loading);

export const useSemanticError = () => useSemanticStore((s) => s.error);

export const useCurrentView = () => useSemanticStore((s) => s.view);
