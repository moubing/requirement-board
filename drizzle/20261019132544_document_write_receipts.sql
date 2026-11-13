CREATE TABLE "document_write_receipts" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"operation" varchar(40) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_write_receipts_project_id_user_id_request_id_pk" PRIMARY KEY("project_id","user_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "document_write_receipts" ADD CONSTRAINT "document_write_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_write_receipts" ADD CONSTRAINT "document_write_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
