import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../../server/db/client'
import { documentWriteReceipt } from '../../server/services/document-write-receipts'

const actor = { projectId: 'project_main', userId: 'user_test' }
const requestId = 'receipt_failure_recovery_001'
const databaseError = (code: string) => Object.assign(new Error('Failed query: select secret_input from document_write_receipts params: private-value'), { cause: { code } })
function transaction() {
  const read = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockResolvedValue(undefined)
  const tx = { execute: vi.fn().mockResolvedValue([]), query: { documentWriteReceipts: { findFirst: read } },
    insert: vi.fn(() => ({ values: insert })) } as unknown as Transaction
  return { tx, read, insert }
}
afterEach(() => vi.restoreAllMocks())

describe('文档写入回执故障', () => {
  it('缺少迁移时返回可恢复的 503，不把 SQL 和输入带入响应', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tx, read } = transaction()
    read.mockRejectedValue(databaseError('42P01'))
    const error = await documentWriteReceipt(tx, actor, requestId, 'requirement.create', { title: '输入保留' }).catch(error => error)
    expect(error).toMatchObject({ statusCode: 503, message: '服务升级尚未完成，请联系管理员处理后重试。', data: { code: 'DATABASE_MIGRATION_REQUIRED' } })
    expect(JSON.stringify(error)).not.toMatch(/select|private-value|secret_input/)
    expect(JSON.stringify(error.cause)).not.toMatch(/select|private-value|secret_input/)
    expect(log).toHaveBeenCalledWith('文档写入回执查询失败', { code: '42P01' })
  })

  it('回执写入失败也不透传 SQL；业务冲突仍为 409，不当作成功或新提交', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tx, read, insert } = transaction()
    insert.mockRejectedValue(databaseError('08006'))
    const receipt = await documentWriteReceipt(tx, actor, requestId, 'requirement.create', { title: '原输入' })
    await expect(receipt.complete('req_test')).rejects.toMatchObject({ statusCode: 503,
      message: '暂时无法确认提交结果，请稍后重试。', data: { code: 'DOCUMENT_WRITE_UNAVAILABLE' } })
    read.mockResolvedValue({ operation: 'requirement.create', inputHash: 'different', resourceId: 'req_test' })
    await expect(documentWriteReceipt(tx, actor, requestId, 'requirement.create', { title: '不同输入' })).rejects.toMatchObject({ statusCode: 409 })
  })
})
