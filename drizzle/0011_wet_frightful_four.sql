CREATE TABLE "agent_asset_uploads" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"create_request_id" text,
	"content_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_asset_uploads" ADD CONSTRAINT "agent_asset_uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_asset_uploads" ADD CONSTRAINT "agent_asset_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_asset_uploads_request_idx" ON "agent_asset_uploads" USING btree ("project_id","create_request_id");