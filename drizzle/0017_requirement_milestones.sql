CREATE TABLE "requirement_milestone_assignees" (
	"requirement_id" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "requirement_milestone_assignees_requirement_id_kind_user_id_pk" PRIMARY KEY("requirement_id","kind","user_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_milestones" (
	"project_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"operation_id" text NOT NULL,
	"source" varchar(24) NOT NULL,
	CONSTRAINT "requirement_milestones_requirement_id_kind_pk" PRIMARY KEY("requirement_id","kind"),
	CONSTRAINT "milestone_kind_check" CHECK ("requirement_milestones"."kind" in ('first_testing', 'done')),
	CONSTRAINT "milestone_source_check" CHECK ("requirement_milestones"."source" in ('web', 'agent_review', 'agent_takeover'))
);
--> statement-breakpoint
CREATE TABLE "requirement_statistic_coverage" (
	"project_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"captured_from" timestamp (3) with time zone NOT NULL,
	"history_complete" boolean NOT NULL,
	"complete_from" timestamp (3) with time zone,
	"gap_reason" text,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp (3) with time zone,
	"observation" jsonb,
	CONSTRAINT "requirement_statistic_coverage_requirement_id_kind_pk" PRIMARY KEY("requirement_id","kind"),
	CONSTRAINT "statistic_coverage_kind_check" CHECK ("requirement_statistic_coverage"."kind" in ('first_testing', 'done')),
	CONSTRAINT "statistic_coverage_quality_check" CHECK ((
    "requirement_statistic_coverage"."history_complete" and "requirement_statistic_coverage"."complete_from" is not null and "requirement_statistic_coverage"."gap_reason" is null and "requirement_statistic_coverage"."observed_at" is null and "requirement_statistic_coverage"."observation" is null
  ) or (
    not "requirement_statistic_coverage"."history_complete" and "requirement_statistic_coverage"."gap_reason" is not null and (
      ("requirement_statistic_coverage"."complete_from" is null and "requirement_statistic_coverage"."observed_at" is null and "requirement_statistic_coverage"."observation" is null) or
      ("requirement_statistic_coverage"."complete_from" is not null and "requirement_statistic_coverage"."complete_from" > "requirement_statistic_coverage"."observed_at" and "requirement_statistic_coverage"."observed_at" is not null and "requirement_statistic_coverage"."observation" is not null)
    )
  ))
);
--> statement-breakpoint
ALTER TABLE "requirement_milestone_assignees" ADD CONSTRAINT "requirement_milestone_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_milestone_assignees" ADD CONSTRAINT "milestone_assignees_event_fk" FOREIGN KEY ("requirement_id","kind") REFERENCES "public"."requirement_milestones"("requirement_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_milestones" ADD CONSTRAINT "milestone_document_fk" FOREIGN KEY ("project_id","requirement_id") REFERENCES "public"."requirements"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_statistic_coverage" ADD CONSTRAINT "statistic_coverage_document_fk" FOREIGN KEY ("project_id","requirement_id") REFERENCES "public"."requirements"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_assignees_user_idx" ON "requirement_milestone_assignees" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "milestone_project_time_idx" ON "requirement_milestones" USING btree ("project_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "statistic_coverage_project_kind_idx" ON "requirement_statistic_coverage" USING btree ("project_id","kind");
--> statement-breakpoint
-- 存量没有可证明的创建初始事实，逐字段日志不能证明此前从未流转。
-- 只登记缺口与切换时已观察到的状态，不补造首次提测/完成时间或负责人。
-- BEGIN legacy coverage
WITH cutoff AS (SELECT transaction_timestamp()::timestamptz(3) AS at), legacy AS (
  SELECT r.id, r.project_id, k.kind, s.code, c.at,
    CASE WHEN (k.kind = 'first_testing' AND s.code = 'testing') OR (k.kind = 'done' AND s.code = 'done') THEN c.at END AS observed_at,
    COALESCE((SELECT jsonb_agg(a.user_id ORDER BY a.user_id COLLATE "C") FROM requirement_assignees a WHERE a.requirement_id = r.id), '[]'::jsonb) AS assignee_ids
  FROM requirements r
  JOIN requirement_statuses s ON s.id = r.status_id
  CROSS JOIN cutoff c
  CROSS JOIN LATERAL (SELECT 'done'::text AS kind UNION ALL SELECT 'first_testing' WHERE r.document_type = 'requirement') k
  WHERE r.document_type IN ('requirement', 'defect')
)
INSERT INTO requirement_statistic_coverage
  (project_id, requirement_id, kind, captured_from, history_complete, complete_from, gap_reason, evidence, observed_at, observation)
SELECT project_id, id, kind, at, false,
  CASE WHEN observed_at IS NOT NULL THEN observed_at + interval '1 millisecond' END,
  'missing_initial_state',
  jsonb_build_object('type', 'legacy_without_initial_state', 'source', 'migration', 'operationId', NULL),
  observed_at,
  CASE WHEN observed_at IS NOT NULL THEN jsonb_build_object('statusCode', code, 'assigneeIds', assignee_ids, 'source', 'migration', 'operationId', NULL) END
FROM legacy
ON CONFLICT (requirement_id, kind) DO NOTHING;
