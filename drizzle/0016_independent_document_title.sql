-- 将旧系统已持久化的共同草稿标题提升为当前属性，避免改用独立保存后丢失尚未存版的改名。
-- 当前属性已偏离最新正式版时，视为已经独立改名，不用共同草稿覆盖。
-- 不修改历史版本、正文、Yjs 二进制或原有修改人记录。
WITH latest AS (
  SELECT DISTINCT ON ("requirement_id") "requirement_id", "title"
  FROM "requirement_revisions"
  ORDER BY "requirement_id", "version" DESC
), draft_titles AS (
  SELECT "requirement_id",
    regexp_replace("title", '^[[:space:]]+|[[:space:]]+$', '', 'g') AS "title",
    "updated_at"
  FROM "requirement_collaboration_documents"
)
UPDATE "requirements" AS r
SET "title" = d."title", "updated_at" = greatest(r."updated_at", d."updated_at")
FROM draft_titles AS d, latest AS v
WHERE r."id" = d."requirement_id" AND r."id" = v."requirement_id"
  AND r."title" = v."title" AND d."title" <> '' AND r."title" <> d."title";
