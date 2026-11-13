<script setup lang="ts">
import { computed, type Component } from 'vue'
import { BingButton, BingDropDown, BingDropDownItem, BingIcon, BingTooltip } from '@moubing/bing-ui'
import { ChevronDown, CodeXml, Ellipsis, History, Image, LinkIcon, MessageSquarePlus, Table2 } from 'lucide-vue-next'
import { editorFormatGroups } from './editor-toolbar'

interface Tool {
  label: string
  icon: Component
  shortcut?: string
  active?: boolean
  disabled?: boolean
  action?: () => void
}
const props = defineProps<{ groups?: Tool[][]; disabled?: boolean; annotations?: boolean }>()
const groups = computed<Tool[][]>(() => props.groups ?? editorFormatGroups)
const insertTools = [{ label: '设置链接', icon: LinkIcon }, { label: '打开表格工具', icon: Table2 }, { label: '图片', icon: Image }, { label: '代码块', icon: CodeXml }]
</script>

<template>
  <div class="requirement-editor__format-tools">
    <div v-for="(group, groupIndex) in groups" :key="groupIndex" class="requirement-editor__toolbar-group">
      <span v-if="groupIndex === 0" class="requirement-editor__paragraph-label">段落样式</span>
      <BingDropDown v-if="groupIndex === 0" trigger="click" aria-label="段落样式">
        <template #trigger="{ triggerProps }">
          <BingButton v-bind="triggerProps" class="requirement-editor__paragraph-style" variant="ghost" size="sm" :disabled="disabled" :aria-label="`段落样式：${group.find(item => item.active)?.label ?? '普通正文'}`">
            <span class="requirement-editor__paragraph-value">{{ group.find(item => item.active)?.label ?? '普通正文' }}<BingIcon :icon="ChevronDown" :size="14" decorative /></span>
          </BingButton>
        </template>
        <BingDropDownItem v-for="item in group" :key="item.label" :title="item.label" :icon="item.icon" type="radio" :checked="item.active" :disabled="disabled" @click="item.action?.()" />
      </BingDropDown>
      <BingTooltip v-for="item in groupIndex === 0 ? [] : group" :key="item.label" :content="item.label" :shortcut="item.shortcut" placement="bottom">
        <BingButton class="requirement-editor__tool" :class="{ 'requirement-editor__tool--active': item.active }" size="sm" variant="ghost" rounded="sm" :disabled="disabled || item.disabled" :aria-label="item.label" @click="item.action?.()">
          <template #prefix><BingIcon :icon="item.icon" :size="16" decorative /></template>
        </BingButton>
      </BingTooltip>
    </div>
    <div class="requirement-editor__toolbar-group">
      <slot name="insert">
        <BingTooltip v-for="(item, index) in insertTools" :key="item.label" :content="item.label" placement="bottom">
          <BingButton v-if="index < 2" class="requirement-editor__tool" size="sm" variant="ghost" rounded="sm" disabled :aria-label="item.label"><template #prefix><BingIcon :icon="item.icon" :size="16" decorative /></template></BingButton>
          <BingButton v-else class="requirement-editor__tool" size="sm" variant="ghost" rounded="sm" disabled :aria-label="item.label"><BingIcon :icon="item.icon" :size="16" decorative /></BingButton>
        </BingTooltip>
      </slot>
    </div>
    <div class="requirement-editor__toolbar-group">
      <slot name="extra">
        <BingButton class="requirement-editor__tool" variant="ghost" size="sm" aria-label="查看当前块历史" disabled><BingIcon :icon="History" :size="16" decorative /></BingButton>
        <BingButton v-if="annotations" class="requirement-editor__tool" variant="ghost" size="sm" aria-label="添加 AI 标注" disabled><BingIcon :icon="MessageSquarePlus" :size="16" decorative /></BingButton>
        <BingButton class="requirement-editor__tool" variant="ghost" size="sm" aria-label="更多格式工具" disabled><BingIcon :icon="Ellipsis" :size="16" decorative /></BingButton>
      </slot>
    </div>
    <slot />
  </div>
</template>
