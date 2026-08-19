import { create } from "zustand";
import { createModel, deleteModel, fetchModels } from "./model-api";
import type { CreateModelConfigInput, ModelConfigListItem } from "./model-types";

/**
 * Model Settings 状态管理。
 *
 * 管理模型配置的列表、添加和删除操作。
 * 遵循 Data Sources 模块的模式（datasource-store.ts）。
 */

interface ModelSettingsState {
  models: ModelConfigListItem[];
  loading: boolean;
  error: string | undefined;
  /** 对话框状态 */
  showForm: boolean;
}

interface ModelSettingsActions {
  loadModels: () => Promise<void>;
  addModel: (input: CreateModelConfigInput) => Promise<void>;
  addModels: (inputs: readonly CreateModelConfigInput[]) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  setShowForm: (show: boolean) => void;
  clearError: () => void;
}

export type ModelSettingsStore = ModelSettingsState & ModelSettingsActions;

const initialState: ModelSettingsState = {
  models: [],
  loading: false,
  error: undefined,
  showForm: false,
};

export const useModelSettingsStore = create<ModelSettingsStore>((set, get) => ({
  ...initialState,

  loadModels: async () => {
    set({ loading: true, error: undefined });
    try {
      const models = await fetchModels();
      set({ models, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载模型配置失败", loading: false });
    }
  },

  addModel: async (input) => {
    set({ loading: true, error: undefined });
    try {
      await createModel(input);
      const models = await fetchModels();
      set({ models, loading: false, showForm: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "添加模型配置失败", loading: false });
    }
  },

  addModels: async (inputs) => {
    set({ loading: true, error: undefined });
    try {
      await Promise.all(inputs.map((input) => createModel(input)));
      const models = await fetchModels();
      set({ models, loading: false, showForm: false });
    } catch (err) {
      const error = err instanceof Error ? err : new Error("添加模型配置失败");
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  removeModel: async (id) => {
    set({ loading: true, error: undefined });
    try {
      await deleteModel(id);
      const models = get().models.filter((m) => m.id !== id);
      set({ models, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除模型配置失败", loading: false });
    }
  },

  setShowForm: (show) => set({ showForm: show }),

  clearError: () => set({ error: undefined }),
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useModelConfigs = () => useModelSettingsStore((s) => s.models);
export const useModelSettingsLoading = () => useModelSettingsStore((s) => s.loading);
export const useModelSettingsError = () => useModelSettingsStore((s) => s.error);
export const useModelSettingsShowForm = () => useModelSettingsStore((s) => s.showForm);
