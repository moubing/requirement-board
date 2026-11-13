ALTER TABLE "requirement_statuses" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- REQ-26：需求、缺陷、待办只保留 待处理/进行中/测试中/已完成/已关闭，说明只保留 草稿/已发布/已归档。
-- 补齐启用状态目录；名称或代码已存在时不重复创建。
INSERT INTO "requirement_statuses" ("id", "project_id", "code", "name", "color", "sort_order")
SELECT p."id" || ':status:' || c.code, p."id", c.code, c.name, c.color, c.sort_order
FROM "projects" p
CROSS JOIN (VALUES
  ('queued', '待处理', '#2f6fed', 10), ('doing', '进行中', '#c15d2b', 20), ('testing', '测试中', '#0891b2', 30),
  ('done', '已完成', '#198754', 40), ('closed', '已关闭', '#667085', 50),
  ('draft', '草稿', '#8a94a6', 60), ('published', '已发布', '#198754', 70), ('archived', '已归档', '#667085', 80)
) AS c(code, name, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "requirement_statuses" s
  WHERE s."project_id" = p."id" AND (s."code" = c.code OR s."name" = c.name OR s."id" = p."id" || ':status:' || c.code)
);--> statement-breakpoint
-- 旧状态行不删除（历史属性日志引用其 ID），只停用并排到启用状态之后。
UPDATE "requirement_statuses" SET
  "active" = "code" IN ('queued', 'doing', 'testing', 'done', 'closed', 'draft', 'published', 'archived'),
  "sort_order" = CASE "code"
    WHEN 'queued' THEN 10 WHEN 'doing' THEN 20 WHEN 'testing' THEN 30 WHEN 'done' THEN 40 WHEN 'closed' THEN 50
    WHEN 'draft' THEN 60 WHEN 'published' THEN 70 WHEN 'archived' THEN 80
    ELSE 1000 + "sort_order" END;--> statement-breakpoint
-- 按文档类型映射：需求与说明共用「草稿」，只有需求、缺陷、待办的草稿改为待处理。
CREATE TEMP TABLE "document_state_migration" AS
SELECT r."id" AS requirement_id, r."project_id", s."id" AS before_id, s."name" AS before_name, t."id" AS after_id, t."name" AS after_name
FROM "requirements" r
JOIN "requirement_statuses" s ON s."id" = r."status_id"
JOIN "requirement_statuses" t ON t."project_id" = r."project_id" AND t."code" = CASE
  WHEN r."document_type" = 'instruction' THEN CASE
    WHEN s."code" IN ('draft', 'published', 'archived') THEN s."code"
    WHEN s."code" = 'closed' THEN 'archived'
    ELSE 'draft' END
  ELSE CASE
    WHEN s."code" IN ('done', 'closed') THEN s."code"
    WHEN s."code" IN ('development', 'repairing', 'doing') THEN 'doing'
    WHEN s."code" IN ('testing', 'verification', 'acceptance', 'release') THEN 'testing'
    ELSE 'queued' END
  END
WHERE t."id" <> r."status_id";--> statement-breakpoint
-- 日志操作者固定取项目内启用的管理员（项目管理员或系统管理员，按加入时间、ID），没有时取最早的启用系统管理员。
CREATE TEMP TABLE "document_state_migration_actor" AS
SELECT m."project_id", (
  SELECT candidate.user_id FROM (
    SELECT u."id" AS user_id, 0 AS rank, pm."joined_at" AS at
    FROM "project_members" pm JOIN "users" u ON u."id" = pm."user_id"
    WHERE pm."project_id" = m."project_id" AND NOT u."banned" AND (u."role" = 'admin' OR EXISTS (
      SELECT 1 FROM "project_member_roles" pr
      WHERE pr."project_id" = pm."project_id" AND pr."user_id" = pm."user_id" AND pr."role" = 'project_admin'))
    UNION ALL
    SELECT u."id", 1, u."created_at" FROM "users" u WHERE u."role" = 'admin' AND NOT u."banned"
  ) candidate ORDER BY candidate.rank, candidate.at, candidate.user_id LIMIT 1
) AS actor_id
FROM (SELECT DISTINCT "project_id" FROM "document_state_migration") m;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "document_state_migration_actor" WHERE actor_id IS NULL) THEN
    RAISE EXCEPTION '文档状态迁移需要一个启用的管理员账号作为日志操作者';
  END IF;
END $$;--> statement-breakpoint
CREATE TEMP TABLE "document_state_migration_operation" AS
SELECT 'operation_' || replace(gen_random_uuid()::text, '-', '') AS id;--> statement-breakpoint
-- 每个状态变化写一条属性日志，同一次迁移共用一个 operationId；source=migration 不计入动态和统计。
INSERT INTO "audit_events" ("id", "project_id", "actor_id", "subject_user_id", "action", "target_id", "detail")
SELECT 'audit_' || replace(gen_random_uuid()::text, '-', ''), m."project_id", a.actor_id, NULL, 'requirement.property.change', m.requirement_id,
  jsonb_build_object('field', 'statusId', 'label', '状态',
    'before', jsonb_build_object('value', m.before_id, 'label', m.before_name),
    'after', jsonb_build_object('value', m.after_id, 'label', m.after_name),
    'operationId', o.id, 'source', 'migration')
FROM "document_state_migration" m
JOIN "document_state_migration_actor" a ON a."project_id" = m."project_id"
CROSS JOIN "document_state_migration_operation" o;--> statement-breakpoint
-- 只改状态；ID、编号、正文、版本、负责人及更新时间保持不变。
UPDATE "requirements" r SET "status_id" = m.after_id
FROM "document_state_migration" m WHERE r."id" = m.requirement_id;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "requirements" r JOIN "requirement_statuses" s ON s."id" = r."status_id"
    WHERE NOT ((r."document_type" = 'instruction' AND s."code" IN ('draft', 'published', 'archived'))
      OR (r."document_type" <> 'instruction' AND s."code" IN ('queued', 'doing', 'testing', 'done', 'closed')))
  ) THEN
    RAISE EXCEPTION '文档状态迁移后仍有文档处于其类型不可用的状态，请检查状态目录是否完整';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "document_state_migration", "document_state_migration_actor", "document_state_migration_operation";
