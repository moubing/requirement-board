CREATE TABLE "requirement_edit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"intent" text NOT NULL,
	"update_hash" text NOT NULL,
	"block_ids" text[] NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirement_collaboration_documents" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "requirement_collaboration_documents" ADD COLUMN "attribution_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "requirement_revisions" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "requirement_revisions" ADD COLUMN "attribution_sequence" integer;--> statement-breakpoint
ALTER TABLE "requirement_edit_events" ADD CONSTRAINT "requirement_edit_events_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_edit_events" ADD CONSTRAINT "requirement_edit_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_edit_events_sequence_unique" ON "requirement_edit_events" USING btree ("requirement_id","sequence");