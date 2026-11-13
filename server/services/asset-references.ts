import { sql } from 'drizzle-orm'
import type { Transaction } from '../db/client'

// 引用写入可并发；GC 独占，避免扫描后、删除前又产生草稿或版本引用。
export async function lockAssetReferences(tx: Transaction, exclusive = false) {
  await tx.execute(exclusive
    ? sql`select pg_advisory_xact_lock(73421, 1)`
    : sql`select pg_advisory_xact_lock_shared(73421, 1)`)
}
