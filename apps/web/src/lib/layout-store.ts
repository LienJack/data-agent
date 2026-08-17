"use client";

import { create } from "zustand";

// ─── Store 类型 ────────────────────────────────────────────────────────────────

interface LayoutState {
  /** 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
}

interface LayoutActions {
  /** 切换侧边栏折叠状态 */
  toggleSidebar: () => void;
  /** 设置侧边栏折叠状态 */
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export type LayoutStore = LayoutState & LayoutActions;

// ─── Store ──────────────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebarCollapsed: false,

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useSidebarCollapsed = () => useLayoutStore((s) => s.sidebarCollapsed);
