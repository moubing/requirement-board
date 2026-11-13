CREATE UNIQUE INDEX "requirements_project_id_unique" ON "requirements" USING btree ("project_id","id");--> statement-breakpoint
CREATE TABLE "requirement_relations" (
	"project_id" text NOT NULL,
	"first_id" text NOT NULL,
	"second_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_relations_first_id_second_id_pk" PRIMARY KEY("first_id","second_id"),
	CONSTRAINT "requirement_relations_order_check" CHECK ("requirement_relations"."first_id" collate "C" < "requirement_relations"."second_id" collate "C")
);
--> statement-breakpoint
ALTER TABLE "requirement_relations" ADD CONSTRAINT "requirement_relations_first_fk" FOREIGN KEY ("project_id","first_id") REFERENCES "public"."requirements"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_relations" ADD CONSTRAINT "requirement_relations_second_fk" FOREIGN KEY ("project_id","second_id") REFERENCES "public"."requirements"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_relations_second_idx" ON "requirement_relations" USING btree ("project_id","second_id");
