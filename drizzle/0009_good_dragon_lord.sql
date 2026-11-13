CREATE TABLE "requirement_agent_locks" (
	"requirement_id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"token_id" text NOT NULL,
	"suggestion_id" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirement_agent_locks" ADD CONSTRAINT "requirement_agent_locks_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_agent_locks" ADD CONSTRAINT "requirement_agent_locks_snapshot_id_agent_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."agent_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_agent_locks" ADD CONSTRAINT "requirement_agent_locks_token_id_agent_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_agent_locks" ADD CONSTRAINT "requirement_agent_locks_suggestion_id_agent_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."agent_suggestions"("id") ON DELETE set null ON UPDATE no action;