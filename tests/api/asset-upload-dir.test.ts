import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getDefaultAssetUploadDir,
  resolveAssetUploadDir,
} from '../../server/utils/asset-upload-dir'

describe('asset upload directory configuration', () => {
  const cwd = resolve(process.cwd(), 'fixture-project')

  it('uses the private local-data directory by default outside tests', () => {
    expect(
      resolveAssetUploadDir({
        cwd,
        configuredDir: '',
        nodeEnv: 'development',
      }),
    ).toBe(getDefaultAssetUploadDir(cwd))
  })

  it('resolves configured relative paths from the project directory', () => {
    expect(
      resolveAssetUploadDir({
        cwd,
        configuredDir: '.tmp/api-uploads',
        nodeEnv: 'test',
      }),
    ).toBe(resolve(cwd, '.tmp/api-uploads'))
  })

  it('refuses to use the development upload directory in tests', () => {
    expect(() =>
      resolveAssetUploadDir({
        cwd,
        configuredDir: '',
        nodeEnv: 'test',
      }),
    ).toThrow(/isolated temporary directory/)
  })

  it('refuses any upload directory under public', () => {
    expect(() =>
      resolveAssetUploadDir({
        cwd,
        configuredDir: 'public/custom-uploads',
        nodeEnv: 'development',
      }),
    ).toThrow(/must not be inside the public directory/)
  })
})
