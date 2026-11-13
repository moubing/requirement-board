<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { BingButton, BingDialog, BingIcon, BingScrollbar, BingTag, BingTextarea } from '@moubing/bing-ui'
import { Copy, Pencil, Trash2, MessageSquarePlus } from 'lucide-vue-next'
import { objectTargetPresentation, type AiAnnotation, type AnnotationResolution } from '~~/shared/agent/annotations'

const props = defineProps<{ notes: AiAnnotation[]; resolutions: AnnotationResolution[]; activeId: string; busy: boolean; copied: boolean; error: string; storageError: string; preview: string }>()
const overall = defineModel<string>('overall', { required: true })
const emit = defineEmits<{ select: [id: string]; edit: [note: AiAnnotation]; remove: [id: string]; clear: []; copy: []; preview: []; closePreview: []; previewCopied: []; retry: [] }>()
function copyPreview(event: ClipboardEvent) {
  const input = event.target as HTMLTextAreaElement
  if (!event.clipboardData || input.selectionStart !== 0 || input.selectionEnd !== input.value.length) return
  event.clipboardData.setData('text/plain', input.value)
  event.preventDefault()
  emit('previewCopied')
}
function targetLabel(note: AiAnnotation, index: number) {
  const target = props.resolutions[index]?.target ?? note.target
  return target && target.type !== 'text' ? objectTargetPresentation(target).title : note.section || '正文片段'
}
function thumbnail(note: AiAnnotation) { return note.target && note.target.type !== 'text' ? objectTargetPresentation(note.target).thumbnail : undefined }
const root = ref<HTMLElement>()
const clearOpen = ref(false)
const clearDescriptionId = useId()
function clearAll() {
  if (props.busy || !props.notes.length) return
  emit('clear')
  clearOpen.value = false
}
watch(() => props.activeId, async id => {
  await nextTick()
  const card = Array.from(root.value?.querySelectorAll<HTMLElement>('[data-annotation-id]') ?? []).find(card => card.dataset.annotationId === id)
  const viewport = card?.closest('.bing-scrollbar__viewport')
  if (card && viewport) viewport.scrollTo({ top: viewport.scrollTop + card.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12 })
})
</script>

<template>
  <section ref="root" class="ai-annotations" aria-label="AI 标注">
    <div class="ai-annotations__toolbar">
      <div class="ai-annotations__summary">
        <span class="ai-annotations__hint">{{ notes.length }} 条标注</span>
        <BingButton variant="ghost" size="xs" aria-label="清除所有标注" :disabled="!notes.length || busy" @click="clearOpen = true"><BingIcon :icon="Trash2" :size="14" decorative />清除全部</BingButton>
      </div>
      <p class="ai-annotations__hint">仅保存在此浏览器的当前账号下</p>
    </div>
    <BingScrollbar class="ai-annotations__scroll" height="100%" aria-label="标注列表">
      <div class="ai-annotations__list">
        <div v-if="!notes.length" class="ai-annotations__empty"><BingIcon :icon="MessageSquarePlus" :size="26" decorative /><p>选中文字添加 AI 标注，或通过节点的右键菜单标注整个提示块、图片、表格及单元格。</p></div>
        <article v-for="(note, index) in notes" :key="note.id" :data-annotation-id="note.id" class="ai-annotations__card" :class="{ 'is-active': note.id === activeId }">
          <header><button type="button" class="ai-annotations__location" :aria-label="`定位标注 ${index + 1}`" @click="emit('select', note.id)"><BingTag class="ai-annotations__number" tone="neutral" size="sm">{{ index + 1 }}</BingTag><span class="ai-annotations__section">{{ targetLabel(note, index) }}</span></button>
            <BingButton variant="ghost" size="xs" :aria-label="`编辑标注 ${index + 1}`" @click="emit('edit', note)"><BingIcon :icon="Pencil" :size="14" decorative /></BingButton>
            <BingButton variant="ghost" size="xs" :aria-label="`删除标注 ${index + 1}`" @click="emit('remove', note.id)"><BingIcon :icon="Trash2" :size="14" decorative /></BingButton>
          </header>
          <button type="button" class="ai-annotations__target" :aria-label="`查看标注 ${index + 1} 的原文`" @click="emit('select', note.id)">
            <img v-if="thumbnail(note)" class="ai-annotations__thumbnail" :src="thumbnail(note)" :alt="note.quote || '图片'" loading="lazy" />
            <span class="ai-annotations__quote">{{ note.quote }}</span><span class="ai-annotations__comment">{{ note.comment }}</span>
          </button>
          <p v-if="resolutions[index]?.status === 'unresolved'" class="ai-annotations__error" role="status">{{ resolutions[index]?.reason }}</p>
        </article>
      </div>
    </BingScrollbar>
    <footer class="ai-annotations__footer">
      <label>整体要求（可选）<BingTextarea v-model="overall" aria-label="标注整体要求" placeholder="例如：保持现有结构，补充验收规则" :rows="3" :max-length="2000" :clearable="false" block /></label>
      <p v-if="storageError || error" class="ai-annotations__error" role="alert">{{ error || storageError }}</p>
      <BingButton v-if="error.includes('核对')" variant="ghost" size="xs" @click="emit('retry')">重新核对处理结果</BingButton>
      <div class="ai-annotations__actions"><BingButton :disabled="!notes.length" :loading="busy" title="复制给 AI（Ctrl+Alt+2）" aria-keyshortcuts="Control+Alt+2" @click="emit('copy')"><BingIcon :icon="Copy" :size="15" decorative />复制给 AI</BingButton><BingButton variant="secondary" :disabled="!notes.length || busy" @click="emit('preview')">预览</BingButton></div>
      <small role="status">{{ copied ? '粘贴给已安装 Skill 的 Agent 即可。' : '复制原文、要求和定位信息，粘贴给你的 Agent。' }}</small>
      <small>整块标注需要最新版 Skill。<a href="/api/agent/setup?action=update" target="_blank" rel="noopener noreferrer">更新 Skill</a></small>
    </footer>
    <BingDialog v-model="clearOpen" title="清除所有标注" :width="400" :aria-describedby="clearDescriptionId" :show-peek="false"
      cancel-text="取消" confirm-text="确认清除" :confirm-disabled="!notes.length || busy" @confirm="clearAll">
      <p :id="clearDescriptionId">确定清除当前文档的全部 {{ notes.length }} 条标注吗？正文和整体要求会保留，清除后无法撤销。</p>
    </BingDialog>
    <BingDialog :model-value="Boolean(preview)" title="复制内容预览" :width="720" :show-footer="false" :show-peek="false" @update:model-value="!$event && emit('closePreview')">
      <p>包含文字片段或对象定位及修改要求，发送前可检查。表格完整内容由 Agent 读取最新快照。下方内容可全选后手动复制。</p>
      <textarea class="ai-annotations__preview" aria-label="AI 标注复制内容" :value="preview" readonly @focus="($event.target as HTMLTextAreaElement).select()" @copy="copyPreview" />
    </BingDialog>
  </section>
</template>

<style scoped>
.ai-annotations { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ai-annotations__toolbar { flex-shrink: 0; display: grid; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--bing-border); }
.ai-annotations__summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ai-annotations__scroll { flex: 1; min-height: 120px; }
.ai-annotations__list { padding: 12px; display: grid; gap: 12px; }
.ai-annotations__hint, .ai-annotations__empty, small { color: var(--bing-muted); font-size: 12px; line-height: 1.7; margin: 0; }
.ai-annotations__empty { padding: 24px 4px; font-size: 13px; text-align: center; }
.ai-annotations__card { padding: 10px; border: 1px solid var(--bing-border); border-radius: 8px; min-width: 0; }
.ai-annotations__card.is-active { border-color: var(--ui-accent); box-shadow: inset 2px 0 var(--ui-accent); }
header { display: flex; align-items: center; gap: 2px; }
.ai-annotations__location { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; padding: 0; border: 0; background: none; text-align: left; color: var(--bing-muted); font: inherit; font-size: 12px; cursor: pointer; }
.ai-annotations__section { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-annotations__number { flex-shrink: 0; }
.ai-annotations__target { display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ai-annotations__target:focus-visible, .ai-annotations__location:focus-visible { outline: 2px solid var(--bing-focus); outline-offset: 3px; border-radius: var(--bing-radius-sm); }
.ai-annotations__quote { display: block; margin: 12px 0 8px; padding: 6px 8px; border-left: 2px solid var(--bing-border); background: var(--bing-canvas); color: var(--bing-muted); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 140px; overflow: auto; }
.ai-annotations__comment { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; line-height: 1.7; }
.ai-annotations__thumbnail { display: block; max-width: 100%; width: 100%; height: 100px; object-fit: contain; margin-top: 10px; border-radius: 4px; }
.ai-annotations__footer { padding: 12px; border-top: 1px solid var(--bing-border); display: grid; gap: 10px; }
label { display: grid; gap: 8px; font-size: 12px; }
.ai-annotations__actions { display: flex; gap: 6px; }
.ai-annotations__actions > :first-child { flex: 1; }
.ai-annotations__error { color: var(--bing-danger-strong); font-size: 12px; line-height: 1.6; }
.ai-annotations__preview { width: 100%; min-height: 360px; padding: 12px; resize: vertical; border: 1px solid var(--bing-border); border-radius: 6px; background: var(--bing-canvas); color: var(--bing-text); font: 12px/1.6 monospace; }
</style>
