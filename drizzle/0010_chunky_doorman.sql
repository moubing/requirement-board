ALTER TABLE "agent_suggestions" ALTER COLUMN "snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ALTER COLUMN "requirement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_snapshots" ADD COLUMN "properties" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_snapshots" ADD COLUMN "base_revision_id" text;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "project_id" text DEFAULT 'project_main' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "kind" text DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "execution_mode" text DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "properties" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "property_changes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "revision_note" varchar(500);--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD COLUMN "saved_revision_id" text;--> statement-breakpoint
ALTER TABLE "agent_snapshots" ADD CONSTRAINT "agent_snapshots_base_revision_id_requirement_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."requirement_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_saved_revision_id_requirement_revisions_id_fk" FOREIGN KEY ("saved_revision_id") REFERENCES "public"."requirement_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_suggestions_project_idx" ON "agent_suggestions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("project_id","target_id","action","created_at","id");