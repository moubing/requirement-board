<script setup lang="ts">
import ReadonlyCallout from '../editor/ReadonlyCallout.vue'
import ReadonlyCodeBlock from '../editor/ReadonlyCodeBlock.vue'
import { computed, ref, useId } from 'vue'
import { BingButton, BingCheckbox, BingColorPicker, BingDialog, BingIcon, BingRadio, BingScrollbar, BingSelect, BingSlider, BingTabs } from '@moubing/bing-ui'
import { MousePointer2, Palette, RotateCcw, Settings, Type } from 'lucide-vue-next'
import { useAppPreferences } from '../../composables/use-app-preferences'
import { useAppTheme, type AppTheme } from '../../composables/use-app-theme'
import { defaultAppPreferences, preferenceLimits, type EditorColorTheme, type EditorTextKind } from '../../utils/app-preferences'
import PreferenceNumberInput from './PreferenceNumberInput.vue'
import EditorFontSettings from './EditorFontSettings.vue'

const open = ref(false)
const tab = ref<string | number>('global')
const themeId = useId()
const { theme, setTheme, saveError: themeSaveError, retrySave: retryTheme } = useAppTheme()
const { preferences, setCustomCursor, setFontSize, setTextColor, setLineHeight, setDocumentWidth, setPanelWidth, setVersionMarkers,
  resetAppearance, resetReading, saveError: preferenceSaveError, retrySave: retryPreferences } = useAppPreferences()
const tabs = [{ value: 'global', label: '外观与交互' }, { value: 'editor', label: '阅读与编辑' }]
const widthDefaults = defaultAppPreferences().editor
const documentWidthMarks = [
  { value: 640, label: '640' },
  { value: widthDefaults.documentWidth, label: '默认' },
  { value: 1200, label: '1200' },
  { value: 1600, label: '1600' },
]
const panelWidthMarks = [
  { value: 320, label: '320' },
  { value: widthDefaults.panelWidth, label: '默认' },
  { value: 440, label: '440' },
  { value: 560, label: '560' },
]
const themes = [{ value: 'light', label: '亮色' }, { value: 'dark', label: '暗色' }, { value: 'system', label: '跟随系统' }]
const textRows: { kind: EditorTextKind; label: string }[] = [
  { kind: 'h1', label: '一级标题' }, { kind: 'h2', label: '二级标题' },
  { kind: 'h3', label: '三级标题' }, { kind: 'paragraph', label: '段落' },
]
const colorTheme = ref<EditorColorTheme>('light')
const colorThemeLabel = computed(() => colorTheme.value === 'dark' ? '暗色' : '亮色')
const saveError = computed(() => preferenceSaveError.value || themeSaveError.value)

function pickerColor(kind: EditorTextKind) {
  const custom = preferences.value.editor.text[kind].colors[colorTheme.value]
  if (custom) return custom
  // 与 bing-ui 语义色一致；实际正文的默认颜色始终引用主题变量。
  return colorTheme.value === 'dark' ? '#edf0f5' : '#20242a'
}

function previewText(kind: EditorTextKind) {
  const text = preferences.value.editor.text[kind]
  return { fontSize: text.fontSize ? `${text.fontSize}px` : undefined, color: text.colors[colorTheme.value] ?? 'var(--ui-text)' }
}
function reset() {
  if (tab.value === 'global') { resetAppearance(); setTheme('system') }
  else resetReading()
}
function retrySave() { retryPreferences(); retryTheme() }
</script>

<template>
  <BingButton variant="ghost" size="lg" class="app-header-control"
    :throttle="false" aria-label="设置" title="设置" @click="open = true">
    <span class="app-header-button-content"><BingIcon :icon="Settings" :size="18" decorative /><span class="app-header-action-label app-settings-label">设置</span></span>
  </BingButton>
  <BingDialog v-model="open" aria-label="设置" :width="900" :max-width="900" :height="600" :max-height="600" :show-peek="false" :overlay-blur="false">
    <template #title><h2 class="app-settings__title">设置</h2></template>
    <template #header-addon>
      <div class="app-settings__header">
        <p class="app-settings__intro">调整即时生效，自动保存到当前浏览器。</p>
        <BingTabs v-model="tab" :items="tabs" variant="soft" size="lg" aria-label="设置分类"
          style="--tabs-bg: transparent; --tabs-indicator-bg: var(--settings-accent-soft); --tabs-indicator-shadow: none; --tabs-active-color: var(--ui-accent)">
          <template #item="{ item }"><span class="app-settings__tab-label"><BingIcon :icon="item.value === 'global' ? Palette : Type" :size="16" decorative />{{ item.label }}</span></template>
        </BingTabs>
      </div>
    </template>
    <div class="app-settings">
      <section v-show="tab === 'global'" class="app-settings__global" aria-label="外观与交互">
        <div class="app-settings__theme-group">
          <div class="app-settings__group-heading"><h3>颜色主题</h3><p class="app-settings__help">选择你习惯的界面外观。</p></div>
          <div class="app-settings__themes" role="group" aria-label="颜色主题">
            <div v-for="item in themes" :key="item.value" class="app-settings__theme-option">
              <label :for="`${themeId}-${item.value}`" class="app-settings__theme-preview" :data-preview-theme="item.value" :aria-label="`${item.label}主题预览`"><span class="app-settings__theme-window" aria-hidden="true"><i /><span><b /><b /><b /></span></span></label>
              <div class="app-settings__theme-caption"><label :for="`${themeId}-${item.value}`">{{ item.label }}</label><BingRadio :id="`${themeId}-${item.value}`" :model-value="theme" :value="item.value" :name="themeId" size="sm" :aria-label="item.label" style="--bing-radio-color: var(--ui-accent); --bing-radio-color-strong: var(--ui-accent)" @update:model-value="setTheme($event as AppTheme)" /></div>
            </div>
          </div>
        </div>
        <div class="app-settings__row">
          <div class="app-settings__group-heading"><h3>自定义鼠标指针</h3><p>黑色指针，白色描边。</p></div>
          <div class="app-settings__cursor-options"><BingCheckbox :model-value="preferences.customCursor" label="启用自定义指针" style="--bing-checkbox-color: var(--ui-accent); --bing-checkbox-color-strong: var(--ui-accent)" @update:model-value="setCustomCursor" /><span class="app-settings__cursor-preview"><BingIcon :icon="MousePointer2" :size="16" decorative />指针样式</span></div>
        </div>
      </section>
      <section v-show="tab === 'editor'" class="app-settings__editor" aria-label="阅读与编辑">
        <div class="app-settings__controls">
          <EditorFontSettings :active="open" />
          <div class="app-settings__section-heading"><h3>文字样式</h3><div class="app-settings__color-theme"><span>编辑配色</span><BingSelect :model-value="colorTheme" :options="[{ value: 'light', label: '亮色配色' }, { value: 'dark', label: '暗色配色' }]" :min-width="0" :width="116" :clearable="false" :searchable="false" aria-label="编辑文字配色" @update:model-value="colorTheme = $event as EditorColorTheme" /></div></div>
          <div class="app-settings__text-labels" aria-hidden="true"><span>文字</span><span>字号 / px</span><span>文字颜色</span></div>
          <div v-for="row in textRows" :key="row.kind" class="app-settings__text-row">
            <span class="app-settings__text-label">{{ row.label }}</span>
            <PreferenceNumberInput :model-value="preferences.editor.text[row.kind].fontSize" :label="`${row.label}字号`"
              v-bind="row.kind === 'paragraph' ? preferenceLimits.paragraphSize : preferenceLimits.fontSize"
              @update:model-value="setFontSize(row.kind, $event)" />
            <div class="app-settings__color">
              <div class="app-settings__color-value" :title="preferences.editor.text[row.kind].colors[colorTheme] ?? '跟随主题'">
              <BingColorPicker :key="`${row.kind}-${colorTheme}`" :model-value="pickerColor(row.kind)" :min-width="0" block
                :aria-label="`${row.label}颜色（${colorThemeLabel}）`" @change="setTextColor(row.kind, colorTheme, $event.hexAlpha)" />
              </div>
              <BingButton variant="ghost" size="sm" :throttle="false" :aria-label="`${row.label}颜色跟随主题`" title="跟随主题"
                :disabled="!preferences.editor.text[row.kind].colors[colorTheme]" @click="setTextColor(row.kind, colorTheme, null)">
                <BingIcon :icon="RotateCcw" :size="14" decorative />
              </BingButton>
            </div>
          </div>
          <p class="app-settings__help">字号留空使用默认值；颜色按亮、暗主题分别保存。</p>
          <div class="app-settings__line-height">
            <div><span>正文行高</span><p class="app-settings__help">默认沿用当前阅读样式</p></div>
              <PreferenceNumberInput :model-value="preferences.editor.lineHeight" label="正文行高" v-bind="preferenceLimits.lineHeight" :step="0.1" @update:model-value="setLineHeight" />
          </div>
          <h3 class="app-settings__layout-heading">阅读布局</h3>
          <BingCheckbox :model-value="preferences.editor.versionMarkers" label="显示版本标记" @update:model-value="setVersionMarkers" />
          <p class="app-settings__help">在正文页边查看相对最新正式版本的修改。</p>
          <div class="app-settings__width">
            <div class="app-settings__width-label"><span>正文最大宽度</span><div class="app-settings__width-value"><PreferenceNumberInput :model-value="preferences.editor.documentWidth" label="正文最大宽度" v-bind="preferenceLimits.documentWidth" placeholder="880" @update:model-value="setDocumentWidth" /><span>px</span></div></div>
            <div class="app-settings__width-controls"><BingSlider :model-value="preferences.editor.documentWidth" v-bind="preferenceLimits.documentWidth" :step="1" :marks="documentWidthMarks" :reset-value="widthDefaults.documentWidth" aria-label="正文最大宽度滑杆" :format-value-text="value => `${value} 像素`" style="--bing-slider-color: var(--ui-accent)" @update:model-value="setDocumentWidth" /><BingButton variant="ghost" size="sm" aria-label="恢复正文默认宽度" title="恢复正文默认宽度" @click="setDocumentWidth(null)"><BingIcon :icon="RotateCcw" :size="16" decorative /></BingButton></div>
            <p class="app-settings__help">640–1800px，空间不足时自动适应。</p>
          </div>
          <div class="app-settings__width">
            <div class="app-settings__width-label"><span>辅助面板宽度</span><div class="app-settings__width-value"><PreferenceNumberInput :model-value="preferences.editor.panelWidth" label="辅助面板宽度" v-bind="preferenceLimits.panelWidth" placeholder="360" @update:model-value="setPanelWidth" /><span>px</span></div></div>
            <div class="app-settings__width-controls"><BingSlider :model-value="preferences.editor.panelWidth" v-bind="preferenceLimits.panelWidth" :step="1" :marks="panelWidthMarks" :reset-value="widthDefaults.panelWidth" aria-label="辅助面板宽度滑杆" :format-value-text="value => `${value} 像素`" style="--bing-slider-color: var(--ui-accent)" @update:model-value="setPanelWidth" /><BingButton variant="ghost" size="sm" aria-label="恢复辅助面板默认宽度" title="恢复辅助面板默认宽度" @click="setPanelWidth(null)"><BingIcon :icon="RotateCcw" :size="16" decorative /></BingButton></div>
            <p class="app-settings__help">目录、文档信息与 AI 标注共用；也可拖动面板边界。</p>
          </div>
        </div>
        <aside class="app-settings__preview" :data-preview-theme="colorTheme" aria-label="排版预览">
          <div class="app-settings__preview-heading"><span class="app-settings__preview-label">实时预览</span><span>{{ colorThemeLabel }}配色</span></div>
          <div class="app-settings-preview" :style="{ lineHeight: preferences.editor.lineHeight ?? 1.8 }">
            <h1 :style="previewText('h1')">工作台统计图表</h1>
            <h2 :style="previewText('h2')">背景与目标</h2>
            <p :style="previewText('paragraph')">先看清自己负责的工作，再了解本周的需求进展。</p>
            <h3 :style="previewText('h3')">验收标准</h3>
            <p :style="previewText('paragraph')">布局清晰，<a href="#" @click.prevent>链接可辨认</a>，<mark>重要内容</mark>仍保持强调。</p>
            <p :style="previewText('paragraph')">使用 <code>status = 'ready'</code> 查看代码字体。</p>
            <ReadonlyCodeBlock syntax language="typescript" :theme="colorTheme" :text="`const status: string = 'ready'\nconsole.log(status)`"
              :style="{ ...previewText('paragraph'), '--code-text-color': preferences.editor.text.paragraph.colors[colorTheme] ?? 'initial' }" />
            <ReadonlyCallout tone="note" :style="previewText('paragraph')">说明用于补充背景与统计口径。</ReadonlyCallout>
            <ReadonlyCallout tone="tip" :style="previewText('paragraph')">建议先确认验收标准，再开始实施。</ReadonlyCallout>
            <ReadonlyCallout tone="warning" :style="previewText('paragraph')">注意检查依赖与前置条件。</ReadonlyCallout>
            <ReadonlyCallout tone="danger" :style="previewText('paragraph')">风险操作执行前需要核对影响范围。</ReadonlyCallout>
            <BingScrollbar horizontal :vertical="false" aria-label="表格排版预览">
              <table class="diff-block__table" style="width: 480px" :style="previewText('paragraph')">
                <colgroup><col style="width: 80px"><col style="width: 120px"><col style="width: 280px"></colgroup>
                <thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead>
                <tbody><tr><td>状态</td><td>选项</td><td>跟踪需求从待处理到完成的进展。</td></tr></tbody>
              </table>
            </BingScrollbar>
          </div>
          <div class="app-settings__layout-preview" aria-label="宽度比例示意"><div class="app-settings__layout-window" :style="{ gridTemplateColumns: `40px minmax(0, ${preferences.editor.documentWidth}fr) minmax(0, ${preferences.editor.panelWidth}fr)` }" aria-hidden="true"><i /><span><b /><b /><b /></span><i /></div></div>
          <p class="app-settings__preview-label">正文上限 {{ preferences.editor.documentWidth }}px · 面板 {{ preferences.editor.panelWidth }}px</p>
          <p class="app-settings__help">仅改变你的阅读显示，不修改文档内容，也不影响其他协作者。</p>
        </aside>
      </section>
    </div>
    <template #footer>
      <div class="app-settings__footer">
        <BingButton variant="ghost" :throttle="false" @click="reset">恢复本页默认</BingButton>
        <span class="app-settings__save-status" :class="{ 'account-error': saveError }" :role="saveError ? 'alert' : 'status'">{{ saveError || '已自动保存' }}</span>
        <BingButton v-if="saveError" size="sm" variant="secondary" @click="retrySave">重试保存</BingButton>
        <BingButton :throttle="false" @click="open = false">完成</BingButton>
      </div>
    </template>
  </BingDialog>
</template>
