import { create } from "zustand";
import {
  createDataSource,
  deleteDataSource,
  fetchDataSources,
  testConnection,
} from "./datasource-api";
import type {
  CreateDataSourceInput,
  DataSourceConnection,
  TestConnectionResult,
} from "./datasource-types";

/**
 * Data Sources 状态管理。
 *
 * 管理数据源连接的列表、添加、删除和测试连接状态。
 */

interface DataSourceState {
  connections: DataSourceConnection[];
  loading: boolean;
  error: string | undefined;
  /** 测试连接状态 */
  testingId: string | null;
  testResult: TestConnectionResult | null;
  /** 对话框状态 */
  showForm: boolean;
}

import type { TestConnectionInput } from "./datasource-types";

interface DataSourceActions {
  loadConnections: () => Promise<void>;
  addConnection: (input: CreateDataSourceInput) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  testConnection: (input: TestConnectionInput) => Promise<TestConnectionResult>;
  setShowForm: (show: boolean) => void;
  clearError: () => void;
  reset: () => void;
}

export type DataSourceStore = DataSourceState & DataSourceActions;

const initialState: DataSourceState = {
  connections: [],
  loading: false,
  error: undefined,
  testingId: null,
  testResult: null,
  showForm: false,
};

export const useDataSourceStore = create<DataSourceStore>((set, get) => ({
  ...initialState,

  loadConnections: async () => {
    set({ loading: true, error: undefined });
    try {
      const connections = await fetchDataSources();
      set({ connections, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载数据源失败", loading: false });
    }
  },

  addConnection: async (input) => {
    set({ loading: true, error: undefined });
    try {
      await createDataSource(input);
      const connections = await fetchDataSources();
      set({ connections, loading: false, showForm: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "添加数据源失败", loading: false });
    }
  },

  removeConnection: async (id) => {
    set({ loading: true, error: undefined });
    try {
      await deleteDataSource(id);
      const connections = get().connections.filter((c) => c.id !== id);
      set({ connections, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除数据源失败", loading: false });
    }
  },

  testConnection: async (input) => {
    set({ testingId: "new", testResult: null });
    try {
      const result = await testConnection(input);
      set({ testingId: null, testResult: result });
      return result;
    } catch (err) {
      const result: TestConnectionResult = {
        success: false,
        message: err instanceof Error ? err.message : "测试连接失败",
      };
      set({ testingId: null, testResult: result });
      return result;
    }
  },

  setShowForm: (show) => set({ showForm: show }),

  clearError: () => set({ error: undefined }),

  reset: () => set(initialState),
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useDataSourceConnections = () => useDataSourceStore((s) => s.connections);
export const useDataSourceLoading = () => useDataSourceStore((s) => s.loading);
export const useDataSourceError = () => useDataSourceStore((s) => s.error);
export const useDataSourceShowForm = () => useDataSourceStore((s) => s.showForm);
export const useDataSourceTestResult = () => useDataSourceStore((s) => s.testResult);
