ALTER TABLE "billing_orders" DROP CONSTRAINT "billing_order_kind_valid";--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "change_from_term_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_tenant_id_change_from_term_id_subscription_terms_tenant_id_id_fk" FOREIGN KEY ("tenant_id","change_from_term_id") REFERENCES "public"."subscription_terms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_order_change_valid" CHECK (("billing_orders"."kind" in ('UPGRADE','DOWNGRADE')) = ("billing_orders"."change_from_term_id" is not null));--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_order_kind_valid" CHECK ("billing_orders"."kind" in ('START','RENEWAL','UPGRADE','DOWNGRADE'));--> statement-breakpoint
CREATE FUNCTION contentos_validate_plan_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_rank integer; target_rank integer;
BEGIN
  IF NEW.kind NOT IN ('UPGRADE','DOWNGRADE') THEN RETURN NEW; END IF;
  PERFORM 1 FROM organizations WHERE id=NEW.tenant_id FOR UPDATE;
  SELECT array_position(ARRAY['FREE','START','CREATOR','EXPERT','AGENCY'],p.code) INTO source_rank
    FROM subscription_terms t JOIN plan_versions q ON q.id=t.plan_version_id JOIN plans p ON p.id=q.plan_id
    WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.change_from_term_id
      AND NOT EXISTS (SELECT 1 FROM subscription_terms newer WHERE newer.tenant_id=t.tenant_id AND newer.ends_at>t.ends_at);
  SELECT array_position(ARRAY['FREE','START','CREATOR','EXPERT','AGENCY'],p.code) INTO target_rank
    FROM plan_versions q JOIN plans p ON p.id=q.plan_id WHERE q.id=NEW.plan_version_id
      AND q.amount_minor=NEW.amount_minor AND q.currency=NEW.currency AND q.ai_credits=NEW.ai_credits AND q.video_seconds=NEW.video_seconds;
  IF source_rank IS NULL OR target_rank IS NULL OR NOT ((NEW.kind='UPGRADE' AND target_rank>source_rank) OR (NEW.kind='DOWNGRADE' AND target_rank<source_rank))
    THEN RAISE EXCEPTION 'Plan change must match the latest paid term, target quote and direction'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER billing_order_plan_change_guard BEFORE INSERT ON billing_orders FOR EACH ROW EXECUTE FUNCTION contentos_validate_plan_change();
