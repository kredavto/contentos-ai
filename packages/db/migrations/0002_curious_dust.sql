ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_type_valid" CHECK ("auth_tokens"."type" in ('VERIFY_EMAIL', 'RESET_PASSWORD'));--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_onboarding_step_valid" CHECK ("brands"."onboarding_step" between 0 and 14);--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_revision_valid" CHECK ("brands"."revision" >= 0);--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "members_role_valid" CHECK ("organization_members"."role" in ('OWNER', 'ADMIN', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(trim("users"."email")));--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_count_positive" CHECK ("rate_limits"."count" > 0);