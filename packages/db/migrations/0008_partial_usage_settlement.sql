DROP INDEX ledger_settle_once;
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_capture_once ON usage_ledger(reservation_id) WHERE type = 'CAPTURE';
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_release_once ON usage_ledger(reservation_id) WHERE type = 'RELEASE';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contentos_check_ledger_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r usage_reservations%ROWTYPE; captured integer; released integer;
BEGIN
  IF NEW.reservation_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM usage_reservations WHERE id=NEW.reservation_id AND tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND OR r.unit<>NEW.unit OR r.status<>'HELD' THEN
    RAISE EXCEPTION 'Ledger entry does not match an active reservation' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(amount) FILTER(WHERE type='CAPTURE'),0),coalesce(sum(amount) FILTER(WHERE type='RELEASE'),0)
    INTO captured,released FROM usage_ledger WHERE reservation_id=r.id;
  IF (NEW.type='RESERVE' AND NEW.amount<>r.amount)
    OR (NEW.type='CAPTURE' AND (captured<>0 OR released<>0 OR NEW.amount>r.amount))
    OR (NEW.type='RELEASE' AND (released<>0 OR NEW.amount<>r.amount-captured)) THEN
    RAISE EXCEPTION 'Ledger entry does not match an active reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION contentos_check_reservation_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured integer; released integer;
BEGIN
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION 'Reservation intent is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status=OLD.status THEN RETURN NEW; END IF;
  SELECT coalesce(sum(amount) FILTER(WHERE type='CAPTURE'),0),coalesce(sum(amount) FILTER(WHERE type='RELEASE'),0)
    INTO captured,released FROM usage_ledger WHERE reservation_id=OLD.id;
  IF OLD.status<>'HELD' OR captured+released<>OLD.amount
    OR (NEW.status='CAPTURED' AND captured<=0)
    OR (NEW.status='RELEASED' AND (captured<>0 OR released<>OLD.amount))
    OR NEW.status NOT IN ('CAPTURED','RELEASED') THEN
    RAISE EXCEPTION 'Reservation status must match immutable ledger settlement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_reservation_settlement_check BEFORE UPDATE ON usage_reservations FOR EACH ROW EXECUTE FUNCTION contentos_check_reservation_settlement();
