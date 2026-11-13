CREATE TABLE "requirement_assignees" (
	"requirement_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "requirement_assignees_requirement_id_user_id_pk" PRIMARY KEY("requirement_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_assignee_count_check";--> statement-breakpoint
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_assignee_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "requirements_assignee_idx";--> statement-breakpoint
ALTER TABLE "requirement_assignees" ADD CONSTRAINT "requirement_assignees_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_assignees" ADD CONSTRAINT "requirement_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_assignees_user_idx" ON "requirement_assignees" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "requirement_assignees" ("requirement_id", "user_id")
SELECT DISTINCT "requirements"."id", "assignee"."user_id"
FROM "requirements"
CROSS JOIN LATERAL unnest("requirements"."assignee_ids") AS "assignee"("user_id");--> statement-breakpoint
ALTER TABLE "requirements" DROP COLUMN "assignee_ids";--> statement-breakpoint
ALTER TABLE "requirements" DROP COLUMN "assignee_id";
