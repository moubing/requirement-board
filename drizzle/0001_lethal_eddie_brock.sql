ALTER TABLE "requirements" DROP CONSTRAINT "requirements_status_id_requirement_statuses_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_statuses_project_id_unique" ON "requirement_statuses" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_status_fk" FOREIGN KEY ("project_id","status_id") REFERENCES "public"."requirement_statuses"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" DROP COLUMN "current_revision_id";
