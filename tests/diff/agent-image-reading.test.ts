import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateReadableAgentImage } from '../../server/services/agent-image-reading'
import { main } from '../../skills/requirement-board/scripts/rb.mjs'

const source = () => sharp({ create: { width: 12, height: 10, channels: 3, background: '#3468af' } })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('Agent 原图读取', () => {
  it.each(['png', 'jpeg', 'gif', 'webp'] as const)('真实解码 %s，返回实际格式与首帧说明', async format => {
    const bytes = await source().toFormat(format).toBuffer()
    expect(await validateReadableAgentImage(bytes)).toMatchObject({ width: 12, height: 10,
      mime: `image/${format}`, firstFrameOnly: ['gif', 'webp'].includes(format) })
  })
  it('拒绝 SVG、伪造/损坏位图和超出体积上限的资源', async () => {
    await expect(validateReadableAgentImage(Buffer.from('<svg/>'))).rejects.toMatchObject({ statusCode: 415 })
    const png = await source().png().toBuffer()
    await expect(validateReadableAgentImage(png.subarray(0, 24))).rejects.toMatchObject({ statusCode: 422 })
    await expect(validateReadableAgentImage(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ statusCode: 413 })
  })
  it('CLI 按文档来源只读下载，输出绝对路径、实际 MIME/字节数，禁止重定向与覆盖', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-image-cli-'))
    vi.stubEnv('RB_BASE_URL', 'https://board.example'); vi.stubEnv('RB_TOKEN', `rb_agent_${'a'.repeat(43)}`)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const bytes = await source().webp().toBuffer()
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array(bytes), {
      headers: { 'content-type': 'image/webp', 'x-rb-image-first-frame-only': 'true' },
    }))
    const file = join(root, 'original.webp')
    try {
      await main(['read-image', 'https://board.example/requirements/req_test', '--block', 'image_node', '--out', file])
      const output = JSON.parse(log.mock.calls.at(-1)![0])
      expect(output).toMatchObject({ path: file, mimeType: 'image/webp', bytes: bytes.length })
      expect(isAbsolute(output.path)).toBe(true)
      expect(output.limitations.join('')).toContain('首帧')
      expect(await readFile(file)).toEqual(bytes)
      expect(String(request.mock.calls[0]![0])).toBe('https://board.example/api/agent/v1/requirements/req_test/images/image_node')
      expect(request.mock.calls[0]![1]).toMatchObject({ redirect: 'error' })
      await expect(main(['read-image', 'req_test', '--block', 'image_node', '--out', file])).rejects.toThrow('EEXIST')
      await expect(main(['read-image', 'https://other.example/requirements/req_test', '--site', 'https://board.example', '--block', 'image_node'])).rejects.toThrow('不同站点')
      expect(request).toHaveBeenCalledTimes(2)
    } finally { await rm(root, { recursive: true }) }
  })
})
