import { join } from 'node:path'

/** bingUi 来自 checkUiWorkspace 校验并解析后的实际仓库路径。 */
export function createUiCandidateConfig(bingUi: string) {
  const directoryPattern = bingUi.replaceAll('\\', '/').replace(/\/+$/, '').split('/')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]')

  return {
    alias: {
      '@moubing/bing-ui/style.css': join(bingUi, 'dist/bing-ui.css'),
      '@moubing/bing-ui': join(bingUi, 'dist/index.js'),
    },
    // 外部仓库的编译产物不再做 Nuxt 自动导入，避免压缩变量名被重复声明。
    imports: { transform: { exclude: [
      /[\\/]node_modules[\\/]/,
      new RegExp(`^${directoryPattern}[\\\\/]dist[\\\\/]`),
    ] } },
  }
}
