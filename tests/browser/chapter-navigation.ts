import { expect, type BrowserContext } from '@playwright/test'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'
import { DOCUMENT_NODE_CAPABILITIES } from '../../shared/editor/capabilities'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'

/** 使用真实 Nuxt 首屏、协作初始化和字体加载，检查章节到达后不会再次偏移。 */
export async function verifyChapterNavigation(context: BrowserContext, origin: string) {
  const created = await context.request.post(`${origin}/api/requirements`, { data: { title: '章节首屏定位回归', templateId: null } })
  expect(created.ok(), await created.text()).toBe(true)
  const requirement = await created.json() as { id: string }
  try {
    const contentJson: RichTextDocument = process.env.BROWSER_TEST_CHAPTER_DOCUMENT
      ? JSON.parse(await readFile(process.env.BROWSER_TEST_CHAPTER_DOCUMENT, 'utf8')).contentJson
      : { type: 'doc', content: Array.from({ length: 60 }, (_, index) => [
        { type: 'heading', attrs: { diffId: `chapter_${index}`, level: index % 3 + 1 }, content: [{ type: 'text', text: `第 ${index + 1} 章：定位与到达提示` }] },
        { type: 'paragraph', attrs: { diffId: `paragraph_${index}` }, content: [{ type: 'text', text: '新标签页需要等待协作正文与字体布局稳定，滚动后保留目标标题。'.repeat(5) }] },
      ]).flat() }
    const headingId = process.env.BROWSER_TEST_CHAPTER_ID ?? 'chapter_40'
    const sources = new Set<string>(), urls = new Map<string, string>()
    const visit = (node: RichTextNode, action: (node: RichTextNode) => void) => { action(node); node.content?.forEach(child => visit(child, action)) }
    visit(contentJson, node => { if (node.type === 'image') sources.add(String(node.attrs?.src ?? '')) })
    for (const source of sources) {
      const originals = process.env.BROWSER_TEST_CHAPTER_IMAGES_DIR
      if (!originals || !/^\/uploads\/asset_[\w-]+\.(png|jpe?g|gif|webp)$/i.test(source)) throw new Error('章节样本须提供原图目录及站内图片路径')
      const name = basename(source), extension = extname(name).slice(1)
      const upload = await context.request.post(`${origin}/api/assets/upload?requirementId=${requirement.id}`, {
        multipart: { file: { name, mimeType: `image/${extension === 'jpg' ? 'jpeg' : extension}`, buffer: await readFile(join(originals, name)) } },
      })
      expect(upload.ok(), await upload.text()).toBe(true)
      const asset = await upload.json()
      urls.set(source, asset.url)
    }
    visit(contentJson, node => { if (node.type === 'image' && node.attrs) node.attrs.src = urls.get(String(node.attrs.src)) })
    const seeded = await context.request.post(`${origin}/api/requirements/${requirement.id}/revisions`, {
      data: { schemaVersion: DOCUMENT_SCHEMA_VERSION, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES, title: '章节首屏定位回归', changeNote: '章节验证', contentJson },
    })
    expect(seeded.ok(), await seeded.text()).toBe(true)
    for (const width of [1440, 1920, 390]) for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const page = await context.newPage()
      await page.setViewportSize({ width, height: 1000 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('response', response => {
        if (response.status() >= 400 && response.url().includes('/api/')) {
          void response.text().then(text => errors.push(`${response.status()} ${response.url()} ${text.slice(0, 700)}`)).catch(() => {})
        }
      })
      await page.emulateMedia({ reducedMotion })
      await page.addInitScript(`(() => {
        const samples = []
        let started = 0
        Object.assign(window, { chapterSamples: samples })
        const tick = () => {
          const viewport = document.querySelector('[aria-label="文档正文"][role="region"]')
          const heading = [...document.querySelectorAll('.tiptap h1,.tiptap h2,.tiptap h3')].find(node => node.dataset.diffId === ${JSON.stringify(headingId)})
          if (viewport && heading) {
            started ||= performance.now()
            samples.push({ time: performance.now(), top: viewport.scrollTop,
            delta: heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
            width: viewport.clientWidth, height: viewport.clientHeight, font: document.fonts.status,
            emphasis: Boolean(document.querySelector('.chapter-links__emphasis')) })
          }
          if (!started || performance.now() - started < 5000) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })()`)
      try {
        await page.goto(`${origin}/requirements/${requirement.id}?block=${encodeURIComponent(headingId)}`)
        await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('.chapter-links__emphasis')).toBeVisible()
        if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
          await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
          await page.waitForTimeout(180)
          await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `chapter-arrival-${width}-${reducedMotion}.png`) })
        }
        await expect(page.locator('.chapter-links__emphasis')).toHaveCount(0)
        await page.waitForTimeout(1000)
        const samples = await page.evaluate(() => (window as typeof window & { chapterSamples: { delta: number; emphasis: boolean }[] }).chapterSamples)
        const arrived = samples.findIndex(sample => sample.emphasis)
        expect(arrived, '定位后显示到达提示').toBeGreaterThanOrEqual(0)
        expect(samples.slice(arrived).every(sample => Math.abs(sample.delta - 28) < 1), '到达后保持标题在 28px 处').toBe(true)
        expect(errors).toEqual([])
        console.log(`真实章节新页面：${width}px / ${reducedMotion} 到达后保持 28px，提示显示并消退。`)
      } catch (error) {
        console.error('章节定位失败', { errors, samples: await page.evaluate(() => (window as typeof window & { chapterSamples: unknown[] }).chapterSamples).catch(() => []) })
        throw error
      } finally { await page.close() }
    }
  } finally { await context.request.delete(`${origin}/api/requirements/${requirement.id}`) }
}
