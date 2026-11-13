import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { run, mkdir, chmod } = vi.hoisted(() => ({ run: vi.fn(), mkdir: vi.fn(), chmod: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(() => {}, { [promisify.custom]: run }) }
})
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), mkdir, chmod,
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const sid = 'S-1-5-21-123-456-789-1001'
const identity = { stdout: '"本机\\测试用户","' + sid + '"\r\n' }
beforeEach(() => {
  vi.resetModules()
  run.mockReset()
  mkdir.mockReset().mockResolvedValue(undefined)
  chmod.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
})
afterEach(() => Object.defineProperty(process, 'platform', platform))

describe('CLI 配置与缓存目录权限', () => {
  it('并发和后续调用共用用户身份查询，每次仍设置目标目录 ACL', async () => {
    run.mockImplementation(async file => file === 'whoami.exe' ? identity : { stdout: '' })
    const { secureDirectory } = await import('../../skills/requirement-board/scripts/config.mjs')
    await Promise.all([secureDirectory('配置目录'), secureDirectory('缓存目录')])
    await secureDirectory('配置目录')
    expect(run.mock.calls.filter(([file]) => file === 'whoami.exe')).toEqual([
      ['whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }],
    ])
    expect(run.mock.calls.filter(([file]) => file === 'icacls.exe')).toEqual(
      ['配置目录', '缓存目录', '配置目录'].map(directory => [
        'icacls.exe', [directory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'], { windowsHide: true },
      ]),
    )
    expect(mkdir).toHaveBeenCalledTimes(3)
    expect(mkdir).toHaveBeenCalledWith('配置目录', { recursive: true, mode: 0o700 })
    expect(chmod).not.toHaveBeenCalled()
  })

  it.each(['', '"用户","not-a-sid"', '"用户","S-1-5-21-extra"', identity.stdout + '"另一个用户","S-1-5-18"'])(
    '身份输出异常时拒绝设置权限，后续调用重新查询：%j', async stdout => {
      run.mockResolvedValueOnce({ stdout })
      const { secureDirectory } = await import('../../skills/requirement-board/scripts/config.mjs')
      await expect(secureDirectory('配置目录')).rejects.toThrow('无法确认当前 Windows 用户')
      expect(run).toHaveBeenCalledTimes(1)
      run.mockResolvedValueOnce(identity).mockResolvedValueOnce({ stdout: '' })
      await secureDirectory('配置目录')
      expect(run.mock.calls.filter(([file]) => file === 'whoami.exe')).toHaveLength(2)
      expect(run.mock.calls.filter(([file]) => file === 'icacls.exe')).toHaveLength(1)
    },
  )

  it('身份查询进程失败后可重试，不留下失败的共享 Promise', async () => {
    run.mockRejectedValueOnce(new Error('查询进程失败'))
    const { secureDirectory } = await import('../../skills/requirement-board/scripts/config.mjs')
    const results = await Promise.allSettled([secureDirectory('配置目录'), secureDirectory('缓存目录')])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(run).toHaveBeenCalledTimes(1)
    run.mockResolvedValueOnce(identity).mockResolvedValueOnce({ stdout: '' })
    await secureDirectory('配置目录')
    expect(run.mock.calls.filter(([file]) => file === 'whoami.exe')).toHaveLength(2)
  })

  it('ACL 失败不会被当作成功；重试仍执行权限设置', async () => {
    run.mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error('ACL 设置失败'))
    const { secureDirectory } = await import('../../skills/requirement-board/scripts/config.mjs')
    await expect(secureDirectory('配置目录')).rejects.toThrow('ACL 设置失败')
    run.mockResolvedValueOnce({ stdout: '' })
    await secureDirectory('配置目录')
    expect(run.mock.calls.filter(([file]) => file === 'whoami.exe')).toHaveLength(1)
    expect(run.mock.calls.filter(([file]) => file === 'icacls.exe')).toHaveLength(2)
  })

  it('非 Windows 每次收紧目录到 700，不启动外部进程', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    const { secureDirectory } = await import('../../skills/requirement-board/scripts/config.mjs')
    await secureDirectory('配置目录')
    await secureDirectory('配置目录')
    expect(chmod.mock.calls).toEqual([['配置目录', 0o700], ['配置目录', 0o700]])
    expect(run).not.toHaveBeenCalled()
  })
})
