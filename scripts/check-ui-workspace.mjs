import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configurationName = 'dev-repos.local.json'
const setupHint = '请复制 dev-repos.example.json 为 dev-repos.local.json，填写 bingUi 和 bingUiDocs 的本机目录，再运行 pnpm ui:check。'

async function readJson(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`无法读取 ${path}（${error.code ?? '读取失败'}）。`)
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`JSON 格式错误：${path}。Windows 路径请使用 / 或双反斜杠。`)
  }
}

async function requirePath(path, directory = false) {
  let info
  try {
    info = await stat(path)
  } catch {
    throw new Error(`路径不存在或无法访问：${path}。`)
  }
  if (directory ? !info.isDirectory() : !info.isFile()) {
    throw new Error(`预期为${directory ? '目录' : '文件'}：${path}。`)
  }
}

/** 只读取显式配置，不搜索同级目录，也不修改或切换关联仓库。 */
export async function checkUiWorkspace({ projectRoot = projectDirectory, checkVersions = false } = {}) {
  const config = await readJson(resolve(projectRoot, configurationName))
  const paths = { bingUi: '', bingUiDocs: '' }
  for (const key of ['bingUi', 'bingUiDocs']) {
    const value = config?.[key]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${configurationName} 缺少有效的 ${key} 路径。`)
    }
    const path = resolve(projectRoot, value.trim())
    await requirePath(path, true)
    paths[key] = await realpath(path)
  }

  const library = await readJson(resolve(paths.bingUi, 'package.json'))
  const docs = await readJson(resolve(paths.bingUiDocs, 'package.json'))
  if (library?.name !== '@moubing/bing-ui') throw new Error(`bingUi 未指向 @moubing/bing-ui 源码项目：${paths.bingUi}。`)
  if (docs?.name !== 'bing-ui-docs') throw new Error(`bingUiDocs 未指向 bing-ui-docs 项目：${paths.bingUiDocs}。`)
  await requirePath(resolve(paths.bingUi, 'src/components'), true)
  await requirePath(resolve(paths.bingUiDocs, 'shared/docs/migration.ts'))
  await requirePath(resolve(paths.bingUiDocs, 'public/llms.txt'))
  const manifest = await readJson(resolve(paths.bingUiDocs, 'public/ai/manifest.json'))
  if (manifest?.packageName !== '@moubing/bing-ui' || typeof manifest.packageVersion !== 'string') {
    throw new Error(`bingUiDocs 的 public/ai/manifest.json 不是有效的 bing-ui 文档清单。`)
  }

  if (checkVersions) {
    const app = await readJson(resolve(projectRoot, 'package.json'))
    const installed = await readJson(resolve(projectRoot, 'node_modules/@moubing/bing-ui/package.json'))
    const docsInstalled = await readJson(resolve(paths.bingUiDocs, 'node_modules/@moubing/bing-ui/package.json'))
    const versions = {
      'requirement-board 声明': app.dependencies?.['@moubing/bing-ui'],
      'requirement-board 安装': installed.version,
      'bing-ui 源码': library.version,
      'bing-ui-docs 声明': docs.dependencies?.['@moubing/bing-ui'],
      'bing-ui-docs 安装': docsInstalled.version,
      'bing-ui-docs 导出': manifest.packageVersion,
    }
    const expected = installed.version
    if (!expected || Object.values(versions).some(version => version !== expected)) {
      throw new Error('版本尚未同步：\n' + Object.entries(versions).map(([name, version]) => `  ${name}：${version ?? '缺失'}`).join('\n')
        + '\n请完成组件库发版、两项目依赖升级与文档导出后重试；不要使用旧文档冒充新版用法。')
    }
  }

  return { ...paths, libraryVersion: library.version, docsVersion: manifest.packageVersion }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check-versions')) {
      throw new Error('用法：pnpm ui:check [--check-versions]')
    }
    const workspace = await checkUiWorkspace({ checkVersions: process.argv.includes('--check-versions') })
    console.log(`UI 工作区配置有效：\n  bing-ui：${workspace.bingUi}（${workspace.libraryVersion}）\n  bing-ui-docs：${workspace.bingUiDocs}（文档 ${workspace.docsVersion}）`)
    console.log(process.argv.includes('--check-versions')
      ? '版本检查通过：应用依赖、组件库源码、文档依赖与 AI 导出一致。'
      : '组件库修改必须同步文档正文、API、示例和 AI 导出；完成后运行 pnpm ui:check --check-versions。')
  } catch (error) {
    console.error(`已中断 UI 工作区检查：${error.message}\n${setupHint}\n配置检查通过前，停止组件库相关工作，不猜测或回退到其他目录。`)
    process.exitCode = 1
  }
}
