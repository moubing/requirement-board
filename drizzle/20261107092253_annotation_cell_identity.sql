ALTER TABLE "requirement_collaboration_documents" ADD COLUMN "schema_version" integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
ALTER TABLE "requirement_collaboration_documents" ALTER COLUMN "schema_version" SET DEFAULT 3;
