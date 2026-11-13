CREATE TABLE "document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_type" varchar(24) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "document_type" varchar(24) DEFAULT 'requirement' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "template_project_id" text;--> statement-breakpoint
ALTER TABLE "requirement_statuses" ADD COLUMN "code" varchar(100) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "document_type" varchar(24) DEFAULT 'requirement' NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "assignee_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_templates_project_idx" ON "document_templates" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_template_project_id_projects_id_fk" FOREIGN KEY ("template_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 保留已有状态 ID、文档链接与全部历史；只迁移元数据。
UPDATE "requirement_statuses" SET "code" = CASE "id"
  WHEN 'status_backlog' THEN 'draft' WHEN 'status_ready' THEN 'ready'
  WHEN 'status_progress' THEN 'development' WHEN 'status_review' THEN 'review'
  WHEN 'status_done' THEN 'done' ELSE 'legacy_' || md5("id") END;
--> statement-breakpoint
UPDATE "requirements" SET "assignee_ids" = ARRAY["assignee_id"] WHERE "assignee_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_statuses_project_code_unique" ON "requirement_statuses" USING btree ("project_id","code");--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_document_type_check" CHECK ("requirements"."document_type" in ('requirement', 'defect', 'instruction', 'todo'));--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_assignee_count_check" CHECK ("requirements"."document_type" = 'requirement' or cardinality("requirements"."assignee_ids") <= 1);

--> statement-breakpoint
-- 先统一已知状态的名称，释放“进行中”给待办流程。
WITH catalog(code, name, color, sort_order) AS (VALUES
('draft', '草稿', '#8a94a6', 10),
('review', '待评审', '#7c3aed', 20),
('ready', '待开发', '#2f6fed', 30),
('development', '开发中', '#c15d2b', 40),
('testing', '测试中', '#0891b2', 50),
('acceptance', '待验收', '#7c3aed', 60),
('release', '待上线', '#2f6fed', 70),
('done', '已完成', '#198754', 80),
('closed', '已关闭', '#667085', 90),
('confirmation', '待确认', '#7c3aed', 100),
('repair_ready', '待修复', '#2f6fed', 110),
('repairing', '修复中', '#c15d2b', 120),
('verification', '待验证', '#0891b2', 130),
('published', '已发布', '#198754', 140),
('archived', '已归档', '#667085', 150),
('queued', '待处理', '#2f6fed', 160),
('doing', '进行中', '#c15d2b', 170)
)
UPDATE requirement_statuses AS s SET name = c.name, color = c.color, sort_order = c.sort_order
FROM catalog c WHERE s.code = c.code
  AND NOT EXISTS (SELECT 1 FROM requirement_statuses other WHERE other.project_id = s.project_id AND other.name = c.name AND other.id <> s.id);
--> statement-breakpoint
WITH catalog(code, name, color, sort_order) AS (VALUES
('draft', '草稿', '#8a94a6', 10),
('review', '待评审', '#7c3aed', 20),
('ready', '待开发', '#2f6fed', 30),
('development', '开发中', '#c15d2b', 40),
('testing', '测试中', '#0891b2', 50),
('acceptance', '待验收', '#7c3aed', 60),
('release', '待上线', '#2f6fed', 70),
('done', '已完成', '#198754', 80),
('closed', '已关闭', '#667085', 90),
('confirmation', '待确认', '#7c3aed', 100),
('repair_ready', '待修复', '#2f6fed', 110),
('repairing', '修复中', '#c15d2b', 120),
('verification', '待验证', '#0891b2', 130),
('published', '已发布', '#198754', 140),
('archived', '已归档', '#667085', 150),
('queued', '待处理', '#2f6fed', 160),
('doing', '进行中', '#c15d2b', 170)
)
INSERT INTO requirement_statuses (id, project_id, code, name, color, sort_order)
SELECT p.id || ':status:' || c.code, p.id, c.code, c.name, c.color, c.sort_order FROM projects p CROSS JOIN catalog c
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 固定使用手册属于说明；不改正文、历史版本、Yjs 或更新时间。
UPDATE requirements r SET document_type = 'instruction', status_id = s.id
FROM requirement_statuses s WHERE s.project_id = r.project_id AND s.code = 'published'
AND r.id IN ('req_AesMxFEKIMbg', 'req_MW_CUlyWq8Ke', 'req_Z70DEAPyNSfx', 'req_nnHYXgmeMyuY', 'req_PnGYTL3Srr3_', 'req_fCtoq-Tut1w3', 'req_5r3GdqPL-P5T');
--> statement-breakpoint
UPDATE projects SET name = '文档看板', description = '项目文档、流程与共同编辑。' WHERE id = 'project_main' AND name = 'Requirement Board';
