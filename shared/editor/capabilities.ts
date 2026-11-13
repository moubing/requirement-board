// 新节点需要客户端显式声明支持，防止旧编辑器过滤未知节点后回写共同正文。
// 与持久化 schemaVersion 分开：新增节点能力不需要改写已有 JSON 或 Yjs。
export const DOCUMENT_NODE_CAPABILITIES = ['task_lists', 'details'] as const
