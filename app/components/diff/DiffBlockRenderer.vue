<script setup lang="ts">
import { computed } from 'vue'
import { BingScrollbar } from '@moubing/bing-ui'

import type {
  DiffBlockPair,
  InlineDiffChunk,
  NormalizedDiffBlock,
  TableCellDiff,
} from '~~/shared/diff/rich-text-diff'
import { isEmptyParagraphNode } from '~~/shared/editor/document'
import DiffImageRenderer from './DiffImageRenderer.vue'
import DiffInlineChunk from './DiffInlineChunk.vue'
import ReadonlyCallout from '../editor/ReadonlyCallout.vue'
import ReadonlyCodeBlock from '../editor/ReadonlyCodeBlock.vue'
import { calloutToneChange } from '~~/shared/editor/callout'
import { buildTableDiffDisplay } from './table-diff-display'
import { buildRichTextDiff, normalizeDocument } from '~~/shared/diff/rich-text-diff'
import { containsTaskItems } from '~~/shared/editor/task-list'
import { containsDetails } from '~~/shared/editor/details'
import type { RichTextNode } from '~~/shared/editor/document'
import TaskCheckbox from '../editor/TaskCheckbox.vue'

const props = defineProps<{
  pair: DiffBlockPair
  side: 'base' | 'target'
}>()

const block = computed<NormalizedDiffBlock | null>(() => (props.side === 'base' ? props.pair.base : props.pair.target))
const chunks = computed<InlineDiffChunk[]>(() => (props.side === 'base' ? props.pair.baseChunks : props.pair.targetChunks))
const toneChange = computed(() => calloutToneChange(props.pair.base?.node, props.pair.target?.node))
const isTaskItem = computed(() => block.value?.type === 'taskItem')
// 只对完整节点展开子树；选区历史的局部字符仍按原选区展示。
const childBlocks = computed(() => {
  const node = block.value?.node
  if (!node || !(containsTaskItems(node) || containsDetails(node) || node.type === 'detailsContent')) return null
  const fullText = normalizeDocument({ type: 'doc', content: [node] })[0]?.text
  if (chunks.value.map(chunk => chunk.value).join('') !== fullText) return null
  return childPairs(props.pair.base?.node, props.pair.target?.node)
})
function childPairs(base?: RichTextNode | null, target?: RichTextNode | null) {
  return buildRichTextDiff({ type: 'doc', content: base?.content ?? [] }, { type: 'doc', content: target?.content ?? [] }).pairs
    .filter(pair => props.side === 'base' ? pair.base : pair.target)
}
const isMissing = computed(() => !block.value)
const isEmptyParagraph = computed(() => isEmptyParagraphNode(block.value?.node))
const tagName = computed(() => {
  const node = block.value?.node
  if (!node) return 'div'
  if (node.type === 'listItem') return 'p'
  if (node.type === 'heading') return `h${node.attrs?.level ?? 2}`
  if (node.type === 'codeBlock') return 'pre'
  if (node.type === 'blockquote') return 'blockquote'
  if (node.type === 'bulletList') return 'ul'
  if (node.type === 'orderedList') return 'ol'
  return 'p'
})
const isListItemBlock = computed(() => block.value?.type === 'listItem' || isTaskItem.value)
const isListBlock = computed(() => block.value?.type === 'bulletList' || block.value?.type === 'orderedList')
const tableRows = computed(() => props.pair.table?.rows ?? [])
const tableDisplay = computed(() => buildTableDiffDisplay(props.pair.base?.node, props.pair.target?.node))
const tableLayout = computed(() => tableDisplay.value[props.side])
const listLines = computed(() => splitChunksByLine(chunks.value))
const listMarker = computed(() => {
  const list = block.value?.list
  if (!list) return '•'
  return list.kind === 'orderedList' ? `${list.number}.` : '•'
})

function splitChunksByLine(sourceChunks: InlineDiffChunk[]) {
  const lines: InlineDiffChunk[][] = [[]]

  for (const chunk of sourceChunks) {
    const parts = chunk.value.split('\n')
    for (const [index, part] of parts.entries()) {
      if (index > 0) lines.push([])
      if (part) {
        lines[lines.length - 1]!.push({ ...chunk, value: part })
      }
    }
  }

  return lines.filter((line, index) => line.length || index === 0)
}

function tableCellNode(cell: TableCellDiff) {
  return props.side === 'base' ? cell.base : cell.target
}

function tableCellTag(cell: TableCellDiff) {
  const node = tableCellNode(cell) ?? cell.base ?? cell.target
  return node?.type === 'tableHeader' ? 'th' : 'td'
}

function tableCellChunks(cell: TableCellDiff) {
  return props.side === 'base' ? cell.baseChunks : cell.targetChunks
}

function tableCellAttribute(cell: TableCellDiff, name: 'colspan' | 'rowspan') {
  const node = tableCellNode(cell) ?? cell.base ?? cell.target
  const value = node?.attrs?.[name]
  return typeof value === 'number' ? value : undefined
}
</script>

<template>
  <div
    class="diff-block"
    :class="[
      `diff-block--${pair.status}`,
      { 'diff-block--missing': isMissing, 'diff-block--table': block?.type === 'table' },
    ]"
  >
    <div v-if="isMissing" class="diff-block__empty" aria-hidden="true" />

    <div v-else-if="block?.type === 'details'" class="requirement-details requirement-details--diff is-open">
      <div class="requirement-details__body">
        <DiffBlockRenderer v-for="childPair in childBlocks" :key="childPair.id" :pair="childPair" :side="side" />
      </div>
    </div>
    <div v-else-if="block?.type === 'detailsSummary'" class="requirement-details__summary">
      <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
      <span v-if="!chunks.length" class="requirement-details__placeholder">折叠块标题</span>
    </div>
    <div v-else-if="block?.type === 'detailsContent'" class="requirement-details__content">
      <DiffBlockRenderer v-for="childPair in childBlocks" :key="childPair.id" :pair="childPair" :side="side" />
    </div>

    <DiffImageRenderer
      v-else-if="block?.type === 'image'"
      :base-node="pair.base?.node ?? null"
      :target-node="pair.target?.node ?? null"
      :chunks="chunks"
      :side="side"
    />

    <div v-else-if="block?.type === 'callout'">
      <div v-if="toneChange" class="diff-block__tone-change">{{ toneChange }}</div>
      <ReadonlyCallout class="diff-block__callout" :tone="block.node.attrs?.tone">
        <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
      </ReadonlyCallout>
    </div>

    <hr v-else-if="block?.type === 'horizontalRule'" class="diff-block__separator" />

    <div v-else-if="block?.type === 'table'">
      <div v-if="pair.table?.columnWidthsChanged" class="diff-block__column-change">列宽调整</div>
      <BingScrollbar class="diff-block__table-scroll" horizontal :vertical="false" aria-label="差异表格">
        <table class="diff-block__table" :style="{ width: tableLayout.width, minWidth: tableLayout.minWidth }">
          <colgroup>
            <col v-for="(width, index) in tableLayout.columns" :key="index" :style="{ width: tableDisplay.automatic ? undefined : `${width}px` }">
          </colgroup>
          <tbody>
            <tr v-for="(row, rowIndex) in tableRows" :key="rowIndex">
              <component
                :is="tableCellTag(cell)"
                v-for="(cell, cellIndex) in row.cells"
                :key="cellIndex"
                :colspan="tableCellAttribute(cell, 'colspan')"
                :rowspan="tableCellAttribute(cell, 'rowspan')"
                class="diff-block__table-cell"
                :class="[
                  `diff-block__table-cell--${cell.status}`,
                  { 'diff-block__table-cell--missing': !tableCellNode(cell) },
                ]"
              >
                <div v-if="containsTaskItems(tableCellNode(cell)) || containsDetails(tableCellNode(cell))" class="diff-block__task-children">
                  <DiffBlockRenderer v-for="childPair in childPairs(cell.base, cell.target)" :key="childPair.id" :pair="childPair" :side="side" />
                </div>
                <DiffInlineChunk v-else
                  v-for="(chunk, chunkIndex) in tableCellChunks(cell)"
                  :key="chunkIndex"
                  :chunk="chunk"
                  :side="side"
                />
              </component>
            </tr>
          </tbody>
        </table>
      </BingScrollbar>
    </div>

    <ReadonlyCodeBlock v-else-if="block?.type === 'codeBlock'" :language="block.node.attrs?.language as string | undefined" :title="block.node.attrs?.title as string | undefined" :text="block.node.content?.map(node => node.text ?? '').join('') ?? ''">
      <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
    </ReadonlyCodeBlock>

    <template v-else-if="isListItemBlock">
      <div class="diff-block__list-item" :class="{ 'requirement-task-item': isTaskItem }" :data-checked="isTaskItem ? block?.node.attrs?.checked === true : undefined">
        <TaskCheckbox v-if="isTaskItem" :checked="block?.node.attrs?.checked === true" />
        <span v-else class="diff-block__list-marker">{{ listMarker }}</span>
        <div v-if="childBlocks" class="requirement-task-item__content diff-block__task-children">
          <DiffBlockRenderer v-for="childPair in childBlocks" :key="childPair.id" :pair="childPair" :side="side" />
        </div>
        <component :is="tagName" v-else class="diff-block__text">
          <DiffInlineChunk
            v-for="(chunk, index) in chunks"
            :key="index"
            :chunk="chunk"
            :side="side"
          />
        </component>
      </div>
    </template>

    <component :is="tagName" v-else-if="childBlocks" class="diff-block__text diff-block__task-children">
      <DiffBlockRenderer v-for="childPair in childBlocks" :key="childPair.id" :pair="childPair" :side="side" />
    </component>

    <component :is="tagName" v-else-if="isListBlock" class="diff-block__text diff-block__list">
      <li v-for="(line, lineIndex) in listLines" :key="lineIndex">
        <DiffInlineChunk
          v-for="(chunk, chunkIndex) in line"
          :key="chunkIndex"
          :chunk="chunk"
          :side="side"
        />
      </li>
    </component>

    <component :is="tagName" v-else class="diff-block__text" :data-diff-id="block?.type === 'heading' ? block.node.attrs?.diffId : undefined">
      <span v-if="isEmptyParagraph" class="diff-block__empty-paragraph">
        <span class="diff-block__empty-paragraph-symbol" aria-hidden="true">¶</span>
        <span>空段落</span>
      </span>
      <template v-else>
        <DiffInlineChunk
          v-for="(chunk, index) in chunks"
          :key="index"
          :chunk="chunk"
          :side="side"
        />
      </template>
    </component>
  </div>
</template>
