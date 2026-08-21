"use client";

import {
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  DotsThree,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWorkspaceI18n } from "@/i18n";
import { qaConversationHref } from "@/lib/qa-inspector-target";
import {
  useQAActiveConversationId,
  useQAConversations,
  useQADirectoryQuery,
  useQADirectoryView,
  useQAExpandedFolderIds,
  useQAFolders,
  useQAPendingDirectoryIds,
  useQAStore,
} from "@/lib/qa-store";
import type { Conversation } from "@/lib/qa-types";

const UNGROUPED_ID = "__ungrouped__";
const DEFAULT_VISIBLE_COUNT = 5;

type EditorState =
  | { readonly kind: "create-folder"; readonly value: string }
  | { readonly kind: "rename-folder"; readonly id: string; readonly value: string }
  | { readonly kind: "rename-conversation"; readonly id: string; readonly value: string }
  | { readonly kind: "move-conversation"; readonly id: string; readonly folderId: string }
  | { readonly kind: "delete-folder"; readonly id: string; readonly name: string }
  | { readonly kind: "trash-conversation"; readonly id: string; readonly title: string };

function copy(locale: string, zhCN: string, enUS: string): string {
  return locale === "zh-CN" ? zhCN : enUS;
}

function liveStateClass(state: Conversation["liveState"]): string {
  if (state === "RUNNING") return "bg-sky-500 animate-pulse";
  if (state === "WAITING_APPROVAL" || state === "WAITING_ANSWER") return "bg-amber-500";
  if (state === "FAILED") return "bg-red-500";
  if (state === "COMPLETED") return "bg-emerald-500";
  return "bg-[var(--color-border-strong)]";
}

function daysUntil(value: string | undefined): number | null {
  if (!value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

function relativeTime(value: string, locale: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return copy(locale, "刚刚", "now");
  if (elapsedMinutes < 60) return copy(locale, `${elapsedMinutes}分钟`, `${elapsedMinutes}m`);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return copy(locale, `${elapsedHours}小时`, `${elapsedHours}h`);
  const elapsedDays = Math.floor(elapsedHours / 24);
  return copy(locale, `${elapsedDays}天`, `${elapsedDays}d`);
}

function ActionButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly destructive?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={props.onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] hover:bg-[var(--color-bg-tertiary)] ${
        props.destructive ? "text-red-600" : "text-[var(--color-text-secondary)]"
      }`}
    >
      {props.children}
      <span>{props.label}</span>
    </button>
  );
}

function RowMenu(props: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [opensUpward, setOpensUpward] = useState(false);

  const updatePlacement = () => {
    const details = detailsRef.current;
    if (!details?.open) return;
    const summary = details.querySelector("summary");
    const menu = details.querySelector<HTMLElement>("[role='menu']");
    if (!summary || !menu) return;
    const boundary = details.closest<HTMLElement>("[data-directory-menu-boundary]");
    const boundaryRect = boundary?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const summaryRect = summary.getBoundingClientRect();
    const availableBelow = boundaryRect.bottom - summaryRect.bottom;
    const availableAbove = summaryRect.top - boundaryRect.top;
    setOpensUpward(availableBelow < menu.scrollHeight + 8 && availableAbove > availableBelow);
  };

  return (
    <details ref={detailsRef} onToggle={updatePlacement} className="group/menu relative shrink-0">
      <summary
        aria-label={props.label}
        aria-disabled={props.disabled}
        className={`flex size-7 list-none items-center justify-center rounded-md text-[var(--color-text-muted)] marker:content-none hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] [&::-webkit-details-marker]:hidden ${
          props.disabled ? "pointer-events-none opacity-40" : "cursor-pointer"
        }`}
      >
        <DotsThree aria-hidden="true" size={17} weight="bold" />
      </summary>
      <div
        role="menu"
        className={`absolute right-0 z-30 w-44 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] p-1 shadow-lg ${
          opensUpward ? "bottom-8" : "top-8"
        }`}
      >
        {props.children}
      </div>
    </details>
  );
}

export function ConversationDirectory(props: {
  readonly qaHref: string;
  readonly onNavigate?: () => void;
  readonly className?: string;
}) {
  const { locale } = useWorkspaceI18n();
  const router = useRouter();
  const conversations = useQAConversations();
  const folders = useQAFolders();
  const activeConversationId = useQAActiveConversationId();
  const directoryView = useQADirectoryView();
  const directoryQuery = useQADirectoryQuery();
  const expandedFolderIds = useQAExpandedFolderIds();
  const pendingIds = useQAPendingDirectoryIds();
  const store = useQAStore();
  const [search, setSearch] = useState(directoryQuery);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const directoryRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const editorKind = editor?.kind;
  useEffect(() => {
    if (!editorKind) return;
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusRef.current =
      activeElement?.closest("details")?.querySelector<HTMLElement>("summary") ?? activeElement;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("input, select, button:not([disabled])")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorKind]);

  const closeEditor = () => {
    setEditor(null);
    window.requestAnimationFrame(() => {
      const previous = returnFocusRef.current;
      if (previous?.isConnected) {
        previous.focus();
        return;
      }
      directoryRef.current
        ?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]")
        ?.focus();
    });
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditor();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), button:not([disabled])",
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [folders],
  );
  const byFolder = useMemo(() => {
    const grouped = new Map<string, Conversation[]>();
    const visibleFolderIds = new Set(folders.map((folder) => folder.folder_id));
    for (const conversation of conversations) {
      const key =
        conversation.folderId && visibleFolderIds.has(conversation.folderId)
          ? conversation.folderId
          : UNGROUPED_ID;
      const items = grouped.get(key) ?? [];
      items.push(conversation);
      grouped.set(key, items);
    }
    for (const items of grouped.values()) {
      items.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt));
    }
    return grouped;
  }, [conversations, folders]);

  const openConversation = (conversation: Conversation) => {
    void store.selectConversation(conversation.id);
    router.push(qaConversationHref(props.qaHref, conversation.id));
    props.onNavigate?.();
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void store.setDirectoryQuery(search);
  };

  const submitEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    let completed = false;
    if (editor.kind === "create-folder") completed = await store.createFolder(editor.value);
    if (editor.kind === "rename-folder")
      completed = await store.renameFolder(editor.id, editor.value);
    if (editor.kind === "rename-conversation")
      completed = await store.renameConversation(editor.id, editor.value);
    if (editor.kind === "move-conversation")
      completed = await store.moveConversation(editor.id, editor.folderId || null);
    if (editor.kind === "delete-folder") completed = await store.deleteFolder(editor.id);
    if (editor.kind === "trash-conversation") completed = await store.trashConversation(editor.id);
    if (completed) closeEditor();
  };

  const renderConversation = (conversation: Conversation, index: number) => {
    const pending = pendingIds.includes(conversation.id);
    const remainingDays = daysUntil(conversation.purgeAfter);
    return (
      <div
        key={conversation.id}
        role="presentation"
        className={`group flex min-h-9 items-center gap-1 rounded-lg pl-2 pr-1 ${
          activeConversationId === conversation.id
            ? "bg-[var(--color-bg-primary)] shadow-sm"
            : "hover:bg-[var(--color-bg-primary)]/70"
        } ${pending ? "pointer-events-none opacity-55" : ""}`}
      >
        <button
          type="button"
          role="treeitem"
          aria-level={2}
          aria-current={activeConversationId === conversation.id ? "page" : undefined}
          onClick={() => openConversation(conversation)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${liveStateClass(conversation.liveState)}`}
            title={conversation.liveState}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] text-[var(--color-text-secondary)]">
              {conversation.title}
            </span>
            {directoryView === "trash" && remainingDays !== null && (
              <span className="block text-[9px] text-[var(--color-text-muted)]">
                {copy(locale, `${remainingDays} 天后清理`, `Purges in ${remainingDays} days`)}
              </span>
            )}
          </span>
          <span
            className="shrink-0 text-[9px] text-[var(--color-text-muted)]"
            title={conversation.updatedAt}
          >
            {relativeTime(conversation.updatedAt, locale)}
          </span>
          {conversation.unreadCompleted && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
              title={copy(locale, "有未读结果", "Unread result")}
            />
          )}
        </button>
        <RowMenu
          label={copy(locale, `管理对话：${conversation.title}`, `Manage ${conversation.title}`)}
          disabled={pending}
        >
          {directoryView !== "trash" && (
            <ActionButton
              label={copy(locale, "重命名", "Rename")}
              onClick={() =>
                setEditor({
                  kind: "rename-conversation",
                  id: conversation.id,
                  value: conversation.title,
                })
              }
            >
              <PencilSimple aria-hidden="true" size={14} />
            </ActionButton>
          )}
          {directoryView === "active" && (
            <>
              <ActionButton
                label={copy(locale, "移动到文件夹", "Move to folder")}
                onClick={() =>
                  setEditor({
                    kind: "move-conversation",
                    id: conversation.id,
                    folderId: conversation.folderId ?? "",
                  })
                }
              >
                <Folder aria-hidden="true" size={14} />
              </ActionButton>
              <ActionButton
                label={copy(locale, "上移", "Move up")}
                onClick={() =>
                  void store.reorderConversation(conversation.id, Math.max(0, index - 1))
                }
              >
                <ArrowUp aria-hidden="true" size={14} />
              </ActionButton>
              <ActionButton
                label={copy(locale, "下移", "Move down")}
                onClick={() => void store.reorderConversation(conversation.id, index + 1)}
              >
                <ArrowDown aria-hidden="true" size={14} />
              </ActionButton>
              <ActionButton
                label={copy(locale, "归档", "Archive")}
                onClick={() => void store.archiveConversation(conversation.id)}
              >
                <Archive aria-hidden="true" size={14} />
              </ActionButton>
            </>
          )}
          {directoryView === "archived" && (
            <ActionButton
              label={copy(locale, "恢复到对话", "Restore")}
              onClick={() => void store.restoreConversation(conversation.id)}
            >
              <ArrowCounterClockwise aria-hidden="true" size={14} />
            </ActionButton>
          )}
          {directoryView === "trash" ? (
            <ActionButton
              label={copy(locale, "从回收站恢复", "Restore from trash")}
              onClick={() => void store.restoreConversationFromTrash(conversation.id)}
            >
              <ArrowCounterClockwise aria-hidden="true" size={14} />
            </ActionButton>
          ) : (
            <ActionButton
              destructive
              label={copy(locale, "移到回收站", "Move to trash")}
              onClick={() =>
                setEditor({
                  kind: "trash-conversation",
                  id: conversation.id,
                  title: conversation.title,
                })
              }
            >
              <Trash aria-hidden="true" size={14} />
            </ActionButton>
          )}
        </RowMenu>
      </div>
    );
  };

  const renderGroup = (
    folderId: string,
    label: string,
    items: readonly Conversation[],
    folderIndex: number,
  ) => {
    const expanded = expandedFolderIds.includes(folderId);
    const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE_COUNT);
    const folder = folders.find((candidate) => candidate.folder_id === folderId);
    const pending = pendingIds.includes(folderId);
    return (
      <section key={folderId} role="presentation" className="mt-1">
        <div className={`group flex min-h-8 items-center gap-1 ${pending ? "opacity-55" : ""}`}>
          <button
            type="button"
            role="treeitem"
            aria-level={1}
            onClick={() => store.toggleFolderExpanded(folderId)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-[var(--color-bg-primary)]/70"
            aria-expanded={expanded}
          >
            {expanded ? (
              <CaretDown aria-hidden="true" size={12} />
            ) : (
              <CaretRight aria-hidden="true" size={12} />
            )}
            {expanded ? (
              <FolderOpen aria-hidden="true" className="text-[var(--color-accent)]" size={15} />
            ) : (
              <Folder aria-hidden="true" className="text-[var(--color-text-muted)]" size={15} />
            )}
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{label}</span>
            <span className="text-[9px] text-[var(--color-text-muted)]">{items.length}</span>
          </button>
          {folder && directoryView !== "trash" && (
            <RowMenu
              label={copy(locale, `管理文件夹：${label}`, `Manage folder ${label}`)}
              disabled={pending}
            >
              <ActionButton
                label={copy(locale, "重命名", "Rename")}
                onClick={() =>
                  setEditor({ kind: "rename-folder", id: folder.folder_id, value: folder.name })
                }
              >
                <PencilSimple aria-hidden="true" size={14} />
              </ActionButton>
              {directoryView === "active" ? (
                <>
                  <ActionButton
                    label={copy(locale, "上移", "Move up")}
                    onClick={() =>
                      void store.reorderFolder(folder.folder_id, Math.max(0, folderIndex - 1))
                    }
                  >
                    <ArrowUp aria-hidden="true" size={14} />
                  </ActionButton>
                  <ActionButton
                    label={copy(locale, "下移", "Move down")}
                    onClick={() => void store.reorderFolder(folder.folder_id, folderIndex + 1)}
                  >
                    <ArrowDown aria-hidden="true" size={14} />
                  </ActionButton>
                  <ActionButton
                    label={copy(locale, "归档文件夹", "Archive folder")}
                    onClick={() => void store.archiveFolder(folder.folder_id)}
                  >
                    <Archive aria-hidden="true" size={14} />
                  </ActionButton>
                </>
              ) : (
                <ActionButton
                  label={copy(locale, "恢复文件夹", "Restore folder")}
                  onClick={() => void store.restoreFolder(folder.folder_id)}
                >
                  <ArrowCounterClockwise aria-hidden="true" size={14} />
                </ActionButton>
              )}
              <ActionButton
                destructive
                label={copy(locale, "删除文件夹", "Delete folder")}
                onClick={() =>
                  setEditor({ kind: "delete-folder", id: folder.folder_id, name: folder.name })
                }
              >
                <Trash aria-hidden="true" size={14} />
              </ActionButton>
            </RowMenu>
          )}
        </div>
        {items.length > 0 && (
          <fieldset className="m-0 ml-3 min-w-0 border-y-0 border-r-0 border-l border-[var(--color-border-default)] p-0 pl-1">
            {visible.map(renderConversation)}
          </fieldset>
        )}
        {items.length > DEFAULT_VISIBLE_COUNT && (
          <button
            type="button"
            onClick={() => store.toggleFolderExpanded(folderId)}
            className="ml-6 mt-0.5 h-7 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            {expanded
              ? copy(locale, "收起", "Collapse")
              : copy(
                  locale,
                  `展开其余 ${items.length - DEFAULT_VISIBLE_COUNT} 个对话`,
                  `Show ${items.length - DEFAULT_VISIBLE_COUNT} more`,
                )}
          </button>
        )}
      </section>
    );
  };

  return (
    <div ref={directoryRef} className={props.className}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
          {copy(locale, "对话工作区", "Conversation workspace")}
        </p>
        {directoryView === "active" && (
          <button
            type="button"
            onClick={() => setEditor({ kind: "create-folder", value: "" })}
            className="flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-text-primary)]"
            aria-label={copy(locale, "新建文件夹", "New folder")}
          >
            <Folder aria-hidden="true" size={15} />
            <Plus aria-hidden="true" className="-ml-1.5 -mt-2" size={9} weight="bold" />
          </button>
        )}
      </div>

      <form onSubmit={submitSearch} className="relative mt-2">
        <label>
          <span className="sr-only">{copy(locale, "搜索我的对话", "Search my conversations")}</span>
          <MagnifyingGlass
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            size={14}
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy(locale, "搜索我的对话", "Search my conversations")}
            className="h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] pl-8 pr-8 text-[12px] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
          />
        </label>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              void store.setDirectoryQuery("");
            }}
            className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-muted)]"
            aria-label={copy(locale, "清除搜索", "Clear search")}
          >
            <X aria-hidden="true" size={12} />
          </button>
        )}
      </form>

      <div
        className="mt-2 grid grid-cols-3 rounded-lg bg-[var(--color-bg-tertiary)] p-0.5"
        role="tablist"
      >
        {(["active", "archived", "trash"] as const).map((view) => (
          <button
            type="button"
            role="tab"
            key={view}
            aria-selected={directoryView === view}
            onClick={() => void store.setDirectoryView(view)}
            className={`h-7 rounded-md text-[10px] font-medium ${
              directoryView === view
                ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {view === "active"
              ? copy(locale, "对话", "Chats")
              : view === "archived"
                ? copy(locale, "归档", "Archived")
                : copy(locale, "回收站", "Trash")}
          </button>
        ))}
      </div>

      <div
        className="mt-2"
        role="tree"
        aria-label={copy(locale, "我的对话目录", "My conversation directory")}
      >
        {sortedFolders.map((folder, index) =>
          renderGroup(folder.folder_id, folder.name, byFolder.get(folder.folder_id) ?? [], index),
        )}
        {(byFolder.get(UNGROUPED_ID)?.length ?? 0) > 0 &&
          renderGroup(
            UNGROUPED_ID,
            copy(locale, "未分类", "Ungrouped"),
            byFolder.get(UNGROUPED_ID) ?? [],
            sortedFolders.length,
          )}
        {conversations.length === 0 && (
          <div className="px-3 py-8 text-center">
            <ChatCircleDots
              aria-hidden="true"
              className="mx-auto text-[var(--color-text-muted)]"
              size={22}
            />
            <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
              {directoryQuery
                ? copy(locale, "没有匹配的对话", "No matching conversations")
                : directoryView === "trash"
                  ? copy(locale, "回收站为空", "Trash is empty")
                  : copy(locale, "暂无对话", "No conversations yet")}
            </p>
          </div>
        )}
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
          <form
            ref={dialogRef}
            onSubmit={submitEditor}
            onKeyDown={handleDialogKeyDown}
            className="w-full max-w-sm rounded-2xl border border-white/60 bg-[var(--color-bg-overlay)] p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-editor-title"
          >
            <h2 id="directory-editor-title" className="text-sm font-semibold">
              {editor.kind === "create-folder"
                ? copy(locale, "新建文件夹", "New folder")
                : editor.kind === "rename-folder" || editor.kind === "rename-conversation"
                  ? copy(locale, "重命名", "Rename")
                  : editor.kind === "move-conversation"
                    ? copy(locale, "移动对话", "Move conversation")
                    : editor.kind === "delete-folder"
                      ? copy(locale, "删除文件夹", "Delete folder")
                      : copy(locale, "移到回收站", "Move to trash")}
            </h2>
            {editor.kind === "delete-folder" ? (
              <p className="mt-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                {copy(
                  locale,
                  `删除“${editor.name}”后，其中的对话会保留并移到未分类。`,
                  `Deleting “${editor.name}” keeps its conversations and moves them to Ungrouped.`,
                )}
              </p>
            ) : editor.kind === "trash-conversation" ? (
              <p className="mt-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                {copy(
                  locale,
                  `“${editor.title}”将保留在回收站 30 天；运行中的对话不会被移动。`,
                  `“${editor.title}” will remain in Trash for 30 days; running conversations cannot be moved.`,
                )}
              </p>
            ) : editor.kind === "move-conversation" ? (
              <label className="mt-3 block text-[11px] text-[var(--color-text-secondary)]">
                {copy(locale, "目标文件夹", "Destination folder")}
                <select
                  value={editor.folderId}
                  onChange={(event) => setEditor({ ...editor, folderId: event.target.value })}
                  className="mt-1 h-10 w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-[12px]"
                >
                  <option value="">{copy(locale, "未分类", "Ungrouped")}</option>
                  {sortedFolders
                    .filter((folder) => folder.archived_at === null)
                    .map((folder) => (
                      <option key={folder.folder_id} value={folder.folder_id}>
                        {folder.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label className="mt-3 block text-[11px] text-[var(--color-text-secondary)]">
                {editor.kind === "rename-conversation"
                  ? copy(locale, "对话名称", "Conversation name")
                  : copy(locale, "文件夹名称", "Folder name")}
                <input
                  required
                  maxLength={editor.kind === "rename-conversation" ? 255 : 80}
                  value={editor.value}
                  onChange={(event) => setEditor({ ...editor, value: event.target.value })}
                  className="mt-1 h-10 w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-[12px] focus:border-[var(--color-border-focused)] focus:outline-none"
                />
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="h-9 rounded-lg px-3 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              >
                {copy(locale, "取消", "Cancel")}
              </button>
              <button
                type="submit"
                className={`h-9 rounded-lg px-3 text-[11px] font-semibold text-white ${
                  editor.kind === "delete-folder" || editor.kind === "trash-conversation"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[var(--color-text-primary)] hover:bg-[var(--color-accent-hover)]"
                }`}
              >
                {editor.kind === "delete-folder"
                  ? copy(locale, "删除文件夹", "Delete folder")
                  : editor.kind === "trash-conversation"
                    ? copy(locale, "移到回收站", "Move to trash")
                    : copy(locale, "保存", "Save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
