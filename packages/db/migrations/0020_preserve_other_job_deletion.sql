CREATE OR REPLACE FUNCTION contentos_preserve_performance_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.type = 'OPTIMIZE_STRATEGY' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Performance intent is immutable'; END IF;
    IF ROW(NEW.tenant_id,NEW.brand_id,NEW.requested_by,NEW.type,NEW.input,NEW.input_hash,NEW.idempotency_key,NEW.reservation_id,NEW.provider,NEW.model,NEW.correlation_id)
      IS DISTINCT FROM ROW(OLD.tenant_id,OLD.brand_id,OLD.requested_by,OLD.type,OLD.input,OLD.input_hash,OLD.idempotency_key,OLD.reservation_id,OLD.provider,OLD.model,OLD.correlation_id)
    THEN RAISE EXCEPTION 'Performance intent is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
