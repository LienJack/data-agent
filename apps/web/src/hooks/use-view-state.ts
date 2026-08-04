import { useMemo } from "react";
import type { ViewState } from "@/components/ui/state-block";

/**
 * 创建 ViewState 判别联合的辅助 hook。
 *
 * 符合 .trellis/spec/frontend/type-safety.md 约定：
 * - 使用判别联合穷尽所有状态
 * - 不在组件中做本地字符串比较
 * - 所有状态都有对应的 UI 表现
 *
 * @example
 * ```tsx
 * const viewState = useViewState({
 *   loading: isLoading,
 *   error: error,
 *   data: projection,
 *   isEmpty: (d) => !d,
 *   emptyTitle: "暂无数据",
 * });
 *
 * return <StateBlock state={viewState} />;
 * ```
 */

interface UseViewStateOptions<T> {
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息（有值表示出错） */
  error?: string | null;
  /** 数据（null/undefined 表示空） */
  data: T | null | undefined;
  /** 自定义空值判断函数 */
  isEmpty?: (data: T) => boolean;
  /** 空状态标题 */
  emptyTitle?: string;
  /** 空状态描述 */
  emptyDescription?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 是否无权限 */
  permissionDenied?: boolean;
}

export function useViewState<T>({
  loading,
  error,
  data,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  permissionDenied,
}: UseViewStateOptions<T>): ViewState {
  return useMemo<ViewState>(() => {
    if (permissionDenied) {
      return { kind: "permission-denied" };
    }

    if (loading) {
      return { kind: "loading" };
    }

    if (error) {
      return { kind: "error", message: error, onRetry };
    }

    if (data == null || (isEmpty?.(data) ?? false)) {
      return {
        kind: "empty",
        title: emptyTitle,
        description: emptyDescription,
      };
    }

    return { kind: "success", children: null };
  }, [loading, error, data, isEmpty, emptyTitle, emptyDescription, onRetry, permissionDenied]);
}
