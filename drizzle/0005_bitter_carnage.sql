CREATE TABLE "requirement_draft_assets" (
	"draft_id" text NOT NULL,
	"asset_id" text NOT NULL,
	CONSTRAINT "requirement_draft_assets_draft_id_asset_id_pk" PRIMARY KEY("draft_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"base_revision_id" text NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_json" jsonb NOT NULL,
	"change_note" varchar(500) DEFAULT '' NOT NULL,
	"pending_uploads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_mutation_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "upload_task_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "unreferenced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirement_revisions" ADD COLUMN "client_save_id" text;--> statement-breakpoint
ALTER TABLE "requirement_draft_assets" ADD CONSTRAINT "requirement_draft_assets_draft_id_requirement_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."requirement_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_draft_assets" ADD CONSTRAINT "requirement_draft_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_base_revision_id_requirement_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."requirement_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_drafts_owner_idx" ON "requirement_drafts" USING btree ("user_id","requirement_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_upload_task_unique" ON "assets" USING btree ("uploaded_by_id","upload_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_revisions_client_save_unique" ON "requirement_revisions" USING btree ("author_id","client_save_id");