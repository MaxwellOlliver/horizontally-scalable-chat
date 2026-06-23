CREATE TABLE "message_receipts" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"delivered_up_to" uuid,
	"read_up_to" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_receipts_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;