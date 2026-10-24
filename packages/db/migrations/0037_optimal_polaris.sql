CREATE INDEX "ai_call_created_tenant_idx" ON "ai_calls" USING btree ("created_at","tenant_id");--> statement-breakpoint
CREATE INDEX "jobs_created_tenant_idx" ON "jobs" USING btree ("created_at","tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_created_tenant_idx" ON "usage_ledger" USING btree ("created_at","tenant_id");--> statement-breakpoint
CREATE INDEX "settlement_created_tenant_idx" ON "payment_settlements" USING btree ("created_at","tenant_id");