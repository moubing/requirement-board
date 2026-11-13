import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { RequirementTaskItem } from '~~/shared/editor/task-list'
import RequirementTaskItemNode from './RequirementTaskItemNode.vue'

export { RequirementTaskList } from '~~/shared/editor/task-list'
export const EditableTaskItem = RequirementTaskItem.extend({
  addNodeView() {
    return VueNodeViewRenderer(RequirementTaskItemNode)
  },
})
