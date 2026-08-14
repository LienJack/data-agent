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
  modelId?: string;
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
  modelId?: string;
}

/** 更新当前对话绑定的运行资源。空字符串表示恢复为系统自动解析。 */
export interface UpdateConversationResourcesInput {
  dataSourceId?: string;
  modelId?: string;
}

/** 发送消息请求 */
export interface SendMessageInput {
  content: string;
}

/** 对话列表项 */
export interface ConversationListItem {
  id: string;
  title: string;
  lastMessage?: string;
  dataSourceId?: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
}
