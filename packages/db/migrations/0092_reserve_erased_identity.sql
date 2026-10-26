CREATE FUNCTION prevent_reserved_account_identity_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erased_at IS NULL AND lower(NEW.email) LIKE '%@account.invalid' THEN
  RAISE EXCEPTION 'Reserved account identity email namespace';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reserved_account_identity_email_guard BEFORE INSERT OR UPDATE OF email,erased_at ON users FOR EACH ROW EXECUTE FUNCTION prevent_reserved_account_identity_email();
