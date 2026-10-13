CREATE TABLE "course_availability_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "course_availability_cycle_number_unique" UNIQUE("course_id","number"),
	CONSTRAINT "course_availability_cycle_number_check" CHECK ("course_availability_cycle"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "course_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_interest_course_user_unique" UNIQUE("course_id","user_id"),
	CONSTRAINT "course_interest_status_check" CHECK ("course_interest"."status" in ('active', 'withdrawn', 'converted'))
);
--> statement-breakpoint
CREATE TABLE "course_interest_notification" (
	"interest_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_interest_notification_pk" PRIMARY KEY("interest_id","cycle_id")
);
--> statement-breakpoint
ALTER TABLE "course_availability_cycle" ADD CONSTRAINT "course_availability_cycle_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_interest" ADD CONSTRAINT "course_interest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_interest" ADD CONSTRAINT "course_interest_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_interest_notification" ADD CONSTRAINT "course_interest_notification_interest_id_course_interest_id_fk" FOREIGN KEY ("interest_id") REFERENCES "course_interest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_interest_notification" ADD CONSTRAINT "course_interest_notification_cycle_id_course_availability_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "course_availability_cycle"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_availability_cycle_open_idx" ON "course_availability_cycle" USING btree ("course_id") WHERE "course_availability_cycle"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "course_interest_course_status_idx" ON "course_interest" USING btree ("course_id","status");