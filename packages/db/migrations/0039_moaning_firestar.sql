CREATE INDEX "audit_user_created_idx" ON "audit_logs" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_created_idx" ON "auth_tokens" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "consent_acceptor_created_idx" ON "consent_records" USING btree ("accepted_by_user_id","accepted_at","id");--> statement-breakpoint
CREATE INDEX "consent_revoker_created_idx" ON "consent_records" USING btree ("revoked_by_user_id","revoked_at","id");--> statement-breakpoint
CREATE INDEX "renewal_consent_actor_created_idx" ON "billing_renewal_consents" USING btree ("accepted_by","created_at","id");--> statement-breakpoint
CREATE INDEX "email_user_created_idx" ON "email_outbox" USING btree ("user_id","created_at","id");