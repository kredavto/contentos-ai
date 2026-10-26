ALTER TABLE "account_erasures" DROP CONSTRAINT "account_erasures_request_id_account_deletion_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_user_id_uq" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "account_erasures" ADD CONSTRAINT "account_erasure_subject_request_fk" FOREIGN KEY ("user_id","request_id") REFERENCES "public"."account_deletion_requests"("user_id","id") ON DELETE no action ON UPDATE no action;
