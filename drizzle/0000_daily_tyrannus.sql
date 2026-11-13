CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text,
	"file_name" varchar(240) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(16) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "requirement_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(24) NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key" varchar(40) NOT NULL,
	"title" varchar(240) NOT NULL,
	"status_id" text NOT NULL,
	"assignee_id" text,
	"reporter_id" text NOT NULL,
	"priority" varchar(24) DEFAULT 'medium' NOT NULL,
	"current_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"email" varchar(160) NOT NULL,
	"avatar_color" varchar(24) DEFAULT '#2b6ef3' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_revisions" ADD CONSTRAINT "requirement_revisions_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_revisions" ADD CONSTRAINT "requirement_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_statuses" ADD CONSTRAINT "requirement_statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_status_id_requirement_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."requirement_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_requirement_idx" ON "assets" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_revisions_requirement_version_unique" ON "requirement_revisions" USING btree ("requirement_id","version");--> statement-breakpoint
CREATE INDEX "requirement_revisions_requirement_created_idx" ON "requirement_revisions" USING btree ("requirement_id","created_at");--> statement-breakpoint
CREATE INDEX "requirement_statuses_project_sort_idx" ON "requirement_statuses" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_statuses_project_name_unique" ON "requirement_statuses" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "requirements_project_updated_idx" ON "requirements" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "requirements_status_idx" ON "requirements" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "requirements_assignee_idx" ON "requirements" USING btree ("assignee_id");