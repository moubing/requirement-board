CREATE TABLE "requirement_collaboration_documents" (
	"requirement_id" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirement_collaboration_documents" ADD CONSTRAINT "requirement_collaboration_documents_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;