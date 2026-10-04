INSERT INTO usage_policies(operation,unit,amount) VALUES ('GENERATE_VIDEO','VIDEO_SECONDS',180),('TRIAL_VIDEO_SECONDS','VIDEO_SECONDS',180) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO usage_ledger(tenant_id,unit,type,amount,available_delta,reserved_delta,idempotency_key,correlation_id)
SELECT g.tenant_id,p.unit,'GRANT',p.amount,p.amount,0,'trial-video:'||g.id,gen_random_uuid()
FROM trial_grants g CROSS JOIN usage_policies p WHERE p.operation='TRIAL_VIDEO_SECONDS'
ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
