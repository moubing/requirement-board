import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function verifyContextMenuCaret(page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    for (const collaborative of [false, true]) {
      await page.evaluate(collaborative => {
        const p = (id, text = '') => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
        const cell = (id, text, type = 'tableCell', attrs = {}) => ({ type, attrs: { diffId: id, ...attrs }, content: [p(`${id}-text`, text)] })
        return window.editorFixture.mount(collaborative, { type: 'doc', content: [
          p('before', '表格之前的文字'),
          { type: 'table', attrs: { diffId: 'table' }, content: [
            { type: 'tableRow', content: [cell('header', '方式', 'tableHeader'), cell('header-other', '说明', 'tableHeader')] },
            { type: 'tableRow', content: [cell('filled', '共同文档保存'), cell('tall', '其他单元格的多行说明。'.repeat(24))] },
            { type: 'tableRow', content: [cell('empty', ''), cell('other', '其他内容')] },
            { type: 'tableRow', content: [cell('merged', '合并单元格', 'tableCell', { colspan: 2 })] },
          ] }, p('after', '表格之后的文字'),
        ] })
      }, collaborative)
      const before = await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), updates: window.editorFixture.modelUpdates, localUpdates: window.editorFixture.localUpdates }))
      const menu = page.getByRole('menu', { name: '表格右键菜单', exact: true })
      for (const id of ['filled', 'empty', 'header', 'merged']) {
        const cell = page.locator(`.tiptap [data-diff-id="${id}"]`)
        for (const edge of ['top', 'bottom', 'text']) {
          await cell.scrollIntoViewIfNeeded()
          await cell.locator('p').click()
          const point = await cell.evaluate((element, edge) => {
            const rect = element.getBoundingClientRect(), paragraph = element.querySelector('p').getBoundingClientRect()
            return { x: rect.x + 60, y: edge === 'top' ? rect.top + 2 : edge === 'bottom' ? rect.bottom - 2 : paragraph.top + paragraph.height / 2 }
          }, edge)
          await page.evaluate(() => {
            const editor = window.editorFixture.editor()
            const trace = { start: editor.state.selection.head, events: [], frames: [], running: true, started: false }
            window.contextCaretTrace = trace
            trace.selectionUpdate = () => { if (trace.started) trace.events.push({ event: 'selection', head: editor.state.selection.head, parent: editor.state.selection.$head.parent.type.name }) }
            trace.mouseEvent = event => {
              if (event.type === 'mousedown') { trace.started = true; trace.start = editor.state.selection.head }
              trace.events.push({ event: event.type, head: editor.state.selection.head })
            }
            editor.on('selectionUpdate', trace.selectionUpdate)
            for (const type of ['mousedown', 'mouseup', 'contextmenu']) document.addEventListener(type, trace.mouseEvent, true)
            const sample = () => {
              if (!trace.running) return
              const caret = document.querySelector('.requirement-editor__smooth-caret')
              if (trace.started) trace.frames.push({ head: editor.state.selection.head, x: caret.style.getPropertyValue('--requirement-caret-x'), y: caret.style.getPropertyValue('--requirement-caret-y') })
              requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
          })
          await page.mouse.move(point.x, point.y)
          await page.mouse.down({ button: 'right' })
          if (edge !== 'text') await page.waitForTimeout(180)
          await page.mouse.up({ button: 'right' })
          await expect(menu).toBeVisible()
          await expect(menu.getByRole('menuitem').last()).toHaveCSS('opacity', '1')
          const trace = await page.evaluate(() => {
            const trace = window.contextCaretTrace
            trace.running = false
            window.editorFixture.editor().off('selectionUpdate', trace.selectionUpdate)
            for (const type of ['mousedown', 'mouseup', 'contextmenu']) document.removeEventListener(type, trace.mouseEvent, true)
            return { start: trace.start, events: trace.events, frames: trace.frames.filter((frame, index) => index === 0 || frame.head !== trace.frames[index - 1].head || frame.x !== trace.frames[index - 1].x || frame.y !== trace.frames[index - 1].y) }
          })
          const moved = trace.events.filter(event => event.event === 'selection' && event.head !== trace.start)
          expect(new Set(moved.map(event => event.head)).size, JSON.stringify({ id, edge, ...trace })).toBeLessThanOrEqual(1)
          // 每帧的光标绘制目标只能是起点或终点，不能先动画到另一个字符再折返。
          expect(new Set(trace.frames.map(frame => `${frame.x}:${frame.y}`)).size, JSON.stringify({ id, edge, ...trace })).toBeLessThanOrEqual(2)
          const state = await page.evaluate(() => {
            const editor = window.editorFixture.editor(), selection = editor.state.selection
            const coordinates = editor.view.coordsAtPos(selection.head, 1)
            const caret = document.querySelector('.requirement-editor__smooth-caret')
            const ancestors = Array.from({ length: selection.$head.depth }, (_, index) => selection.$head.node(index + 1))
            return { parent: selection.$head.parent.type.name, inline: selection.$head.parent.inlineContent,
              cell: ancestors.find(node => ['tableCell', 'tableHeader'].includes(node.type.name))?.attrs.diffId,
              coordinateHeight: coordinates.bottom - coordinates.top, caretHeight: caret.getBoundingClientRect().height,
              focused: editor.view.hasFocus(), visible: caret.classList.contains('requirement-editor__smooth-caret--visible') }
          })
          expect(state, `${collaborative ? '协作' : '普通'} ${id} ${edge} 的右键选区`).toMatchObject({ inline: true, cell: id, focused: true, visible: true })
          expect(state.caretHeight, `${id} ${edge} 不能显示 2px 圆点光标`).toBeGreaterThan(10)
          if (process.env.BROWSER_TEST_ARTIFACT_DIR && id === 'filled' && edge === 'bottom') {
            await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
            await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `table-context-caret-${collaborative ? 'collaborative' : 'plain'}.png`), animations: 'disabled' })
          }
          await menu.getByRole('menuitem').first().focus()
          await page.keyboard.press('Escape')
          await expect(menu).toBeHidden()
        }
      }
      expect(await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), updates: window.editorFixture.modelUpdates, localUpdates: window.editorFixture.localUpdates }))).toEqual(before)

      // 关闭菜单后继续输入和撤销；菜单命令仍作用于右键命中的单元格。
      await page.locator('.tiptap [data-diff-id="filled"] p').click()
      await page.keyboard.insertText('输入')
      await page.keyboard.press('Control+z')
      expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before.json)
      await page.locator('.tiptap [data-diff-id="filled"]').click({ button: 'right', position: { x: 18, y: 2 } })
      await menu.getByText('下方插入行', { exact: true }).click()
      await expect(page.locator('.tiptap tr')).toHaveCount(5)
      await expect(page.locator('.tiptap tr').nth(2)).toHaveText('')
      await page.locator('.tiptap [data-diff-id="filled"] p').click()
      await page.keyboard.press('Control+z')
      expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before.json)
    }
    console.log('通过：普通/协作表格的快速右键和按住后松开只定位一次，逐帧光标目标不折返；文字、上下留白、空单元格、表头与合并格保持有效光标，不产生正文更新，输入、行操作与撤销正常。')
  } finally {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }
}
