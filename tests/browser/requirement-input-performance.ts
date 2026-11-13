import { expect, type Page, type CDPSession } from '@playwright/test'

// 记录浏览器有效输入事件至 DOM 更新后两个 rAF 的代理值；保留 Trace 另行核对呈现。
// CDP 组词仅覆盖浏览器 IME 协议，不能代替 Windows 输入法或低性能实机验收。
export async function verifyInputPerformance(page: Page, cdp: CDPSession, seconds: number, imeSeconds = 0) {
  const result: unknown[] = []
  const editor = page.locator('.tiptap[contenteditable="true"]')
  const paragraphs = editor.locator(':scope > p[data-diff-id]')
  const count = await paragraphs.count()
  await page.evaluate(() => {
    const samples: { start: number; type: string; composing: boolean; inputMs?: number; framesMs?: number }[] = []
    let current: typeof samples[number] | undefined
    const handlers = { before(event: Event) {
      if (!(event.target as Element)?.closest('.tiptap')) return
      current = { start: performance.now(), type: (event as InputEvent).inputType, composing: (event as InputEvent).isComposing }
      samples.push(current)
      performance.mark(`rb:input:${samples.length}`)
    }, after() {
      const sample = current
      if (!sample) return
      sample.inputMs = performance.now() - sample.start
      requestAnimationFrame(() => requestAnimationFrame(() => { sample.framesMs = performance.now() - sample.start }))
    } }
    document.addEventListener('beforeinput', handlers.before, true)
    document.addEventListener('input', handlers.after)
    Object.assign(window, { rbInputSamples: samples, rbInputCleanup() {
      document.removeEventListener('beforeinput', handlers.before, true)
      document.removeEventListener('input', handlers.after)
    } })
  })
  try {
    for (const [position, index] of [['start', 0], ['middle', Math.floor(count / 2)], ['end', count - 1]] as const) {
      const paragraph = paragraphs.nth(index)
      await paragraph.click()
      await page.keyboard.press('End')
      const initial = await paragraph.textContent()
      const start = Date.now()
      let expected = ''
      await page.evaluate(() => { (window as unknown as { rbInputSamples: unknown[] }).rbInputSamples.length = 0 })
      while (Date.now() - start < seconds * 1000) {
        await page.keyboard.type('a1,', { delay: 80 })
        expected += 'a1,'
      }
      await expect(paragraph).toContainText(expected)
      await page.waitForTimeout(300)
      const samples = await page.evaluate(() => (window as unknown as { rbInputSamples: unknown[] }).rbInputSamples)
      if (seconds > 0) result.push({ position, method: 'direct', elapsedMs: Date.now() - start, characters: expected.length, samples })
      // 保留正文结构；撤销使用真实快捷键与原 Yjs 历史。
      for (let attempt = 0; attempt < 10 && await paragraph.textContent() !== initial; attempt++) await page.keyboard.press('Control+z')
      expect(await paragraph.textContent(), '连续输入撤销后完整恢复').toBe(initial)
      await paragraph.click(); await page.keyboard.press('End')
      await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
      await cdp.send('Input.insertText', { text: '中文输入验证' })
      await expect(paragraph).toContainText('中文输入验证')
      await page.keyboard.press('Control+z')
      expect(await paragraph.textContent(), '组词确认只提交一次，撤销可恢复').toBe(initial)
      console.log(`输入测量：${position} ${expected.length} 字符，${samples.length} 个有效事件。`)
      if (imeSeconds > 0) {
        await paragraph.click(); await page.keyboard.press('End')
        await page.evaluate(() => { (window as unknown as { rbInputSamples: unknown[] }).rbInputSamples.length = 0 })
        const imeStart = Date.now()
        let confirmations = 0
        while (Date.now() - imeStart < imeSeconds * 1000) {
          await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
          await page.waitForTimeout(80)
          await cdp.send('Input.insertText', { text: '中文，1' })
          confirmations++
          await page.waitForTimeout(80)
        }
        await expect(paragraph).toContainText('中文，1'.repeat(confirmations))
        await page.waitForTimeout(300)
        const imeSamples = await page.evaluate(() => (window as unknown as { rbInputSamples: unknown[] }).rbInputSamples)
        result.push({ position, method: 'ime-cdp', elapsedMs: Date.now() - imeStart, characters: confirmations * 4, confirmations, samples: imeSamples })
        for (let attempt = 0; attempt < confirmations * 2 + 10 && await paragraph.textContent() !== initial; attempt++) await page.keyboard.press('Control+z')
        expect(await paragraph.textContent(), '连续中文确认撤销后完整恢复').toBe(initial)
        console.log(`中文协议测量：${position} ${confirmations} 次确认，${imeSamples.length} 个有效事件。`)
      }
    }
  } finally {
    await page.evaluate(() => (window as unknown as { rbInputCleanup: () => void }).rbInputCleanup())
  }
  return result
}
