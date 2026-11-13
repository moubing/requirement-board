CREATE TABLE "agent_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_json" jsonb NOT NULL,
	"signature" text NOT NULL,
	"schema_version" integer NOT NULL,
	"edit_epoch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"change_note" varchar(500) NOT NULL,
	"operations" jsonb NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"reviewed_at" timestamp with time zone,
	"applied_edit_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "requirement_collaboration_documents" ADD COLUMN "edit_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_snapshots" ADD CONSTRAINT "agent_snapshots_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_snapshots" ADD CONSTRAINT "agent_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_snapshot_id_agent_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."agent_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_applied_edit_id_requirement_edit_events_id_fk" FOREIGN KEY ("applied_edit_id") REFERENCES "public"."requirement_edit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_snapshots_expiry_idx" ON "agent_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_suggestions_request_unique" ON "agent_suggestions" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "agent_suggestions_requirement_idx" ON "agent_suggestions" USING btree ("requirement_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tokens_owner_idx" ON "agent_tokens" USING btree ("user_id");