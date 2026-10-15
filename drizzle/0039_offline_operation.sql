CREATE TABLE "offline_operation" (
	"user_id" text NOT NULL,
	"client_operation_id" uuid NOT NULL,
	"command" text NOT NULL,
	"lesson_id" uuid,
	"outcome" text NOT NULL,
	"reason" text,
	"client_created_at" timestamp with time zone,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_operation_pk" PRIMARY KEY("user_id","client_operation_id"),
	CONSTRAINT "offline_operation_outcome_check" CHECK ("offline_operation"."outcome" in ('applied', 'rejected')),
	CONSTRAINT "offline_operation_reason_check" CHECK (("offline_operation"."outcome" = 'rejected') = ("offline_operation"."reason" is not null)),
	CONSTRAINT "offline_operation_command_check" CHECK (char_length("offline_operation"."command") <= 64)
);
--> statement-breakpoint
ALTER TABLE "offline_operation" ADD CONSTRAINT "offline_operation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;