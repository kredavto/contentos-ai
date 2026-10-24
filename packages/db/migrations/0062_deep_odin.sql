ALTER TABLE "publication_metrics" DROP CONSTRAINT "publication_metrics_source_valid";--> statement-breakpoint
ALTER TABLE "publication_analytics_jobs" DROP CONSTRAINT "publication_analytics_source_valid";--> statement-breakpoint
ALTER TABLE "publication_metrics" ADD CONSTRAINT "publication_metrics_source_valid" CHECK ("publication_metrics"."source" in ('MANUAL','API','DEMO'));--> statement-breakpoint
ALTER TABLE "publication_analytics_jobs" ADD CONSTRAINT "publication_analytics_source_valid" CHECK ("publication_analytics_jobs"."source" in ('API','DEMO'));