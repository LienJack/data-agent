/**
 * Q&A 模块类型定义。
 */

/** 对话角色 */
export type MessageRole = "user" | "agent";

/** 消息内容类型 */
export type MessageType = "text" | "table" | "report" | "hypothesis" | "error";

/** 对话记录 */
export interface Conversation {
  id: string;
  title: string;
  dataSourceId?: string;
  modelProfileId?: string;
  resourceVersion: number;
  messageCount: number;
  folderId?: string;
  sortOrder: number;
  lifecycle: "ACTIVE" | "ARCHIVED" | "TRASH";
  archivedAt?: string;
  deletedAt?: string;
  purgeAfter?: string;
  liveState: "IDLE" | "RUNNING" | "WAITING_APPROVAL" | "WAITING_ANSWER" | "FAILED" | "COMPLETED";
  unreadCompleted: boolean;
  searchSnippet?: string;
  createdAt: string;
  updatedAt: string;
}

/** 对话消息 */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  type: MessageType;
  /** 关联的 Run ID（Agent 消息） */
  runId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** 创建对话请求 */
export interface CreateConversationInput {
  title: string;
  dataSourceId?: string;
  modelProfileId?: string;
}

/** 更新当前对话绑定的运行资源。另一项从当前权威投影或可运行目录默认值补齐。 */
export interface UpdateConversationResourcesInput {
  dataSourceId?: string;
  modelProfileId?: string;
}

/** 发送消息请求 */
export interface SendMessageInput {
  content: string;
}

export type QAView = "conversation" | "trajectory";

export interface TrajectoryFocus {
  runId: string;
  sequence: number;
}

/** 对话列表项 */
export interface ConversationListItem {
  id: string;
  title: string;
  lastMessage?: string;
  dataSourceId?: string;
  modelProfileId?: string;
  createdAt: string;
  updatedAt: string;
}
