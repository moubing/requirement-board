<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { BingButton, BingInput, BingSelect, type BingSelectOption } from '@moubing/bing-ui'
import { useAppPreferences } from '../../composables/use-app-preferences'
import { createFontDetector, defaultEditorFont, editorFontFamily, editorFontKinds, editorFontPresets, editorFontSample, normalizeEditorFont, type EditorFontKind } from '../../utils/editor-fonts'
import { readLocalFontCache, saveLocalFontCache } from '../../utils/local-font-cache'

const props = defineProps<{ active: boolean }>()
const { preferences, setFont } = useAppPreferences()
const rows = [{ kind: 'body', label: '正文字体' }, { kind: 'code', label: '代码字体' }] as const
const available = ref<Record<string, boolean>>({})
const detected = ref(false)
const localFamilies = ref<string[]>([])
const hasLocalFontCache = ref(false)
const canReadLocal = ref(false)
const reading = ref(false)
const localMessage = ref('')
const localError = ref(false)
const manual = reactive(Object.fromEntries(editorFontKinds.map(kind => [kind, { open: false, value: '', error: '', pending: '' }])) as Record<EditorFontKind, { open: boolean; value: string; error: string; pending: string }>)
let detect: ((family: string) => boolean) | undefined
let disposed = false
let generation = 0
type FontWindow = Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }

function showLocalFonts(cache: { families: string[]; persisted: boolean }) {
  localFamilies.value = cache.families
  hasLocalFontCache.value = true
  localError.value = !cache.persisted
  localMessage.value = cache.persisted
    ? `已缓存 ${cache.families.length} 个字体系列，重新打开设置或刷新页面后仍可使用。安装或卸载字体后可重新读取。`
    : `已读取 ${cache.families.length} 个字体系列，但浏览器未能保存缓存，刷新页面后需重新读取。`
}

function refreshAvailability() {
  detect = createFontDetector(document)
  const families = [...editorFontPresets.body, ...editorFontPresets.code].map(item => item.family)
  families.push(...Object.values(preferences.value.editor.fonts).filter((family): family is string => Boolean(family)))
  available.value = Object.fromEntries(families.map(family => [family, localFamilies.value.includes(family) || detect!(family)]))
  detected.value = true
}
watch(() => props.active, async active => {
  const current = ++generation
  if (!active) return
  canReadLocal.value = window.isSecureContext && typeof (window as FontWindow).queryLocalFonts === 'function'
  const cache = readLocalFontCache()
  if (cache) showLocalFonts(cache)
  await document.fonts.ready
  if (!disposed && current === generation) refreshAvailability()
}, { immediate: true })
watch(() => preferences.value.editor.fonts, () => {
  for (const kind of editorFontKinds) { manual[kind].pending = ''; manual[kind].error = '' }
  if (detected.value) refreshAvailability()
})
onBeforeUnmount(() => { disposed = true; generation++ })

const options = computed(() => Object.fromEntries(editorFontKinds.map(kind => {
  const items: BingSelectOption[] = [{ value: '', label: `${defaultEditorFont}（默认）` }]
  const seen = new Set([defaultEditorFont.toLowerCase()])
  function add(family: string, label: string, installed: boolean) {
    if (seen.has(family.toLowerCase())) return
    seen.add(family.toLowerCase())
    items.push({ value: family, label: `${label}${!detected.value ? ' · 检测中' : installed ? '' : ' · 本机未安装'}`, disabled: !installed })
  }
  for (const preset of editorFontPresets[kind]) add(preset.family, preset.label, available.value[preset.family] === true)
  for (const family of localFamilies.value) add(family, family, true)
  const selected = preferences.value.editor.fonts[kind]
  if (selected) {
    // CSS 字体名不区分大小写，而 BingSelect 的值按严格相等匹配。
    const match = items.find(item => String(item.value || defaultEditorFont).toLowerCase() === selected.toLowerCase())
    if (match) match.value = selected
    else add(selected, selected, available.value[selected] === true)
  }
  return [kind, items]
})) as Record<EditorFontKind, BingSelectOption[]>)

async function readLocalFonts() {
  if (reading.value) return
  reading.value = true
  localMessage.value = ''; localError.value = false
  try {
    // 必须直接在点击事件中调用，保留浏览器的用户激活状态。
    const fonts = await (window as FontWindow).queryLocalFonts!()
    const cache = saveLocalFontCache(fonts.map(font => font.family))
    if (disposed) return
    showLocalFonts(cache)
    refreshAvailability()
  } catch (error) {
    if (disposed) return
    localError.value = true
    localMessage.value = error instanceof Error && error.name === 'NotAllowedError'
      ? '未获得本机字体读取权限，仍可选择预设或手动输入字体。'
      : '无法读取本机字体，请检查浏览器权限，或选择预设、手动输入字体。'
  } finally { reading.value = false }
}

function applyManual(kind: EditorFontKind) {
  const state = manual[kind]
  state.pending = ''; state.error = ''
  const family = normalizeEditorFont(state.value)
  if (!family) {
    state.error = '请输入 1–64 个字符，仅支持中英文字母、数字、空格、短横线、下划线和点。'
    return
  }
  if (localFamilies.value.includes(family) || (detect ?? createFontDetector(document))(family)) {
    setFont(kind, family === defaultEditorFont ? null : family)
    state.open = false
  } else state.pending = family
}
function confirmFallback(kind: EditorFontKind) {
  const family = manual[kind].pending
  if (!family) return
  setFont(kind, family)
  manual[kind].open = false
}
function editManual(kind: EditorFontKind, value: string | number | null) {
  Object.assign(manual[kind], { value: String(value ?? ''), error: '', pending: '' })
}
</script>

<template>
  <div class="app-settings-fonts" aria-label="字体设置">
    <div v-for="row in rows" :key="row.kind" class="app-settings-fonts__row" :data-font-kind="row.kind">
      <div class="app-settings-fonts__heading"><span>{{ row.label }}</span><BingButton size="sm" variant="ghost" :throttle="false" :aria-expanded="manual[row.kind].open" :aria-label="`手动输入${row.label}`" @click="manual[row.kind].open = !manual[row.kind].open">手动输入</BingButton></div>
      <BingSelect :model-value="preferences.editor.fonts[row.kind] ?? ''" :options="options[row.kind]" :min-width="0" block searchable virtual="auto" :clearable="false" :aria-label="row.label" search-placeholder="搜索字体名称" no-search-results-text="未找到字体，可手动输入" @update:model-value="setFont(row.kind, typeof $event === 'string' && $event ? $event : null)" />
      <p class="app-settings-fonts__sample" :aria-label="`${row.label}示例`" :style="{ fontFamily: editorFontFamily(preferences.editor.fonts[row.kind]) }">{{ editorFontSample }}</p>
      <p v-if="detected && preferences.editor.fonts[row.kind] && !available[preferences.editor.fonts[row.kind]!]" class="app-settings-fonts__warning" role="status">本机未检测到该字体，将显示为回退字体</p>
      <div v-if="manual[row.kind].open" class="app-settings-fonts__manual">
        <div class="app-settings-fonts__input"><BingInput :model-value="manual[row.kind].value" block :aria-label="`${row.label}名称`" placeholder="输入字体系列名称" @update:model-value="editManual(row.kind, $event)" @enter="applyManual(row.kind)" /><BingButton size="sm" variant="secondary" :throttle="false" :aria-label="`检测并应用${row.label}`" @click="applyManual(row.kind)">应用</BingButton></div>
        <p v-if="manual[row.kind].error" class="app-settings-fonts__error" role="alert">{{ manual[row.kind].error }}</p>
        <div v-if="manual[row.kind].pending" class="app-settings-fonts__confirmation" role="status"><p>本机未检测到该字体，将显示为回退字体</p><BingButton size="sm" variant="secondary" :throttle="false" @click="confirmFallback(row.kind)">仍使用此字体</BingButton></div>
      </div>
    </div>
    <div class="app-settings-fonts__local">
      <BingButton v-if="canReadLocal" size="sm" variant="secondary" :disabled="reading" :throttle="false" @click="readLocalFonts">{{ reading ? '正在读取字体…' : hasLocalFontCache ? '重新读取本机字体' : '读取本机字体' }}</BingButton>
      <p v-else class="app-settings__help">当前浏览器不支持读取本机字体，可选择预设或手动输入。</p>
      <p v-if="localMessage" :class="localError ? 'app-settings-fonts__warning' : 'app-settings__help'" role="status">{{ localMessage }}</p>
    </div>
  </div>
</template>
