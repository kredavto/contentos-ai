ALTER TABLE "youtube_resolutions" ADD CONSTRAINT "youtube_resolution_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" DROP CONSTRAINT "youtube_resolution_task_valid";
--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" DROP CONSTRAINT "youtube_resolution_tasks_resolution_id_youtube_resolutions_id_fk";
--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" ADD CONSTRAINT "youtube_resolution_tasks_tenant_id_resolution_id_youtube_resolutions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","resolution_id") REFERENCES "public"."youtube_resolutions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" ADD CONSTRAINT "youtube_resolution_task_valid" CHECK (("youtube_resolution_tasks"."status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED') and "youtube_resolution_tasks"."attempt" between 0 and 3 and "youtube_resolution_tasks"."input_hash" ~ '^[a-f0-9]{64}$' and "youtube_resolution_tasks"."input"->>'tenantId'="youtube_resolution_tasks"."tenant_id"::text and "youtube_resolution_tasks"."input"->>'jobId'="youtube_resolution_tasks"."job_id"::text and "youtube_resolution_tasks"."input"->>'idempotencyKey'="youtube_resolution_tasks"."request_key"::text) is true);
