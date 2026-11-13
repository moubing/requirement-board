import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { checkUiWorkspace } from '../../scripts/check-ui-workspace.mjs'
import { createUiCandidateConfig } from '../browser/ui-candidate'

const run = promisify(execFile)
const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rb-ui-workspace-'))
  roots.push(root)
  const projectRoot = join(root, 'app')
  const bingUi = join(root, '自定义 组件库')
  const bingUiDocs = join(root, '自定义 文档')
  async function save(path: string, value: string | object) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }
  await mkdir(join(bingUi, 'src/components'), { recursive: true })
  await save(join(bingUi, 'package.json'), { name: '@moubing/bing-ui', version: '0.9.0' })
  await save(join(bingUiDocs, 'package.json'), { name: 'bing-ui-docs', dependencies: { '@moubing/bing-ui': '0.9.0' } })
  await save(join(bingUiDocs, 'shared/docs/migration.ts'), 'export const docsVersion = {}')
  await save(join(bingUiDocs, 'public/llms.txt'), '# bing-ui')
  await save(join(bingUiDocs, 'public/ai/manifest.json'), { packageName: '@moubing/bing-ui', packageVersion: '0.9.0' })
  await save(join(projectRoot, 'package.json'), { dependencies: { '@moubing/bing-ui': '0.9.0' } })
  for (const folder of [projectRoot, bingUiDocs]) {
    await save(join(folder, 'node_modules/@moubing/bing-ui/package.json'), { version: '0.9.0' })
  }
  const config = join(projectRoot, 'dev-repos.local.json')
  await save(config, { bingUi: '../自定义 组件库', bingUiDocs })
  return { root, projectRoot, bingUi, bingUiDocs, config, save }
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('rb-ui-workspace-')) throw new Error('Invalid test cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})

describe('UI 关联仓库配置', () => {
  it('按项目根解析相对路径，接受含空格/中文的绝对路径并核对版本', async () => {
    const f = await fixture()
    const result = await checkUiWorkspace({ projectRoot: f.projectRoot, checkVersions: true })
    expect(result.bingUi).toBe(await realpath(f.bingUi))
    expect(result.bingUiDocs).toBe(await realpath(f.bingUiDocs))
    expect(result.docsVersion).toBe('0.9.0')
  })

  it('候选联调按配置的自定义目录加载并排除编译产物，保留业务源码的自动导入', async () => {
    const f = await fixture()
    const workspace = await checkUiWorkspace({ projectRoot: f.projectRoot })
    const config = createUiCandidateConfig(workspace.bingUi)
    const excluded = (id: string) => config.imports.transform.exclude.some(pattern => pattern.test(id))

    expect(config.alias['@moubing/bing-ui']).toBe(join(workspace.bingUi, 'dist/index.js'))
    expect(config.alias['@moubing/bing-ui/style.css']).toBe(join(workspace.bingUi, 'dist/bing-ui.css'))
    expect(excluded(config.alias['@moubing/bing-ui'])).toBe(true)
    expect(excluded(join(workspace.bingUi, 'dist/components/BingSplitPane/component.js') + '?v=1')).toBe(true)
    expect(excluded(join(workspace.bingUi, 'src/index.ts'))).toBe(false)
    expect(excluded(join(f.projectRoot, 'app/pages/index.vue'))).toBe(false)
    expect(excluded(join(f.projectRoot, 'node_modules/vue/index.js'))).toBe(true)
    expect(excluded(join(f.root, 'bing-ui/dist/index.js'))).toBe(false)
  })

  it.each([
    'D:\\worktrees\\组件库 (fix)+[v0.12]$^',
    '/home/dev/组件库 (fix)+[v0.12]$^',
    '\\\\server\\worktrees\\组件库 (fix)+[v0.12]$^\\',
  ])('候选排除规则支持路径分隔符并精确匹配特殊字符：%s', (directory) => {
    const config = createUiCandidateConfig(directory)
    const excluded = (id: string) => config.imports.transform.exclude.some(pattern => pattern.test(id))
    const root = directory.replaceAll('\\', '/').replace(/\/+$/, '')
    const moduleId = `${root}/dist/components/BingSplitPane/component.js`

    expect(excluded(moduleId)).toBe(true)
    expect(excluded(moduleId.replaceAll('/', '\\'))).toBe(true)
    expect(excluded(moduleId.replace('v0.12', 'v0x12'))).toBe(false)
    expect(excluded(`${root}-copy/dist/index.js`)).toBe(false)
    expect(excluded(`${root}/dist-copy/index.js`)).toBe(false)
    expect(excluded(`/another${root}/dist/index.js`)).toBe(false)
  })

  it('配置不存在时不猜目录；CLI 返回失败并给出设置步骤', async () => {
    const f = await fixture()
    await rm(f.config)
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot })).rejects.toThrow('dev-repos.local.json')
    const script = join(f.projectRoot, 'scripts/check-ui-workspace.mjs')
    await mkdir(dirname(script))
    await copyFile(fileURLToPath(new URL('../../scripts/check-ui-workspace.mjs', import.meta.url)), script)
    await expect(run(process.execPath, [script], { cwd: f.root })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('请复制 dev-repos.example.json'),
    })
    await f.save(f.config, { bingUi: '../自定义 组件库', bingUiDocs: f.bingUiDocs })
    const { stdout } = await run(process.execPath, [script, '--check-versions'], { cwd: f.root })
    expect(stdout).toContain('UI 工作区配置有效')
  })

  it('拒绝错误 JSON、缺失字段及不存在的目录', async () => {
    const f = await fixture()
    await f.save(f.config, '{bad json}')
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot })).rejects.toThrow('JSON 格式错误')
    await f.save(f.config, { bingUi: f.bingUi })
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot })).rejects.toThrow('bingUiDocs')
    await f.save(f.config, { bingUi: 'missing', bingUiDocs: f.bingUiDocs })
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot })).rejects.toThrow('路径不存在')
  })

  it('拒绝填反的项目路径或缺少 AI 文档入口的仓库', async () => {
    const f = await fixture()
    await f.save(f.config, { bingUi: f.bingUiDocs, bingUiDocs: f.bingUi })
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot })).rejects.toThrow('未指向 @moubing/bing-ui')
    await f.save(f.config, { bingUi: f.bingUi, bingUiDocs: f.bingUiDocs })
    await rm(join(f.bingUiDocs, 'public/llms.txt'))
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot })).rejects.toThrow('public')
  })

  it('允许在升级过程中检查路径，但结束检查拒绝陈旧文档或未安装的新版本', async () => {
    const f = await fixture()
    const manifest = join(f.bingUiDocs, 'public/ai/manifest.json')
    await f.save(manifest, { packageName: '@moubing/bing-ui', packageVersion: '0.8.2' })
    expect((await checkUiWorkspace({ projectRoot: f.projectRoot })).docsVersion).toBe('0.8.2')
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot, checkVersions: true })).rejects.toThrow('bing-ui-docs 导出：0.8.2')
    await f.save(manifest, { packageName: '@moubing/bing-ui', packageVersion: '0.9.0' })
    await f.save(join(f.bingUiDocs, 'node_modules/@moubing/bing-ui/package.json'), { version: '0.8.2' })
    await expect(checkUiWorkspace({ projectRoot: f.projectRoot, checkVersions: true })).rejects.toThrow('bing-ui-docs 安装：0.8.2')
  })
})
