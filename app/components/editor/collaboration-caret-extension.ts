import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { yCursorPlugin, yCursorPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'

/** 光标身份属于 Provider 会话；编辑副本可以包含尚未确认的本地正文。 */
export const RequirementCollaborationCaret = CollaborationCaret.extend({
  addProseMirrorPlugins() {
    const awareness = this.options.provider.awareness as Awareness
    const cursor = yCursorPlugin(awareness, {
      cursorBuilder: this.options.render,
      selectionBuilder: this.options.selectionRender,
      awarenessStateFilter: (_documentClientId: number, clientId: number, state: { editing?: boolean } | null) =>
        clientId !== awareness.clientID && state?.editing !== false,
    })
    // 保留父扩展的用户信息订阅及释放逻辑，仅配置光标插件的会话过滤器。
    return (this.parent?.() ?? []).map(plugin => plugin.spec.key === yCursorPluginKey ? cursor : plugin)
  },
})
