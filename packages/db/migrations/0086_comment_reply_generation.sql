-- Configured internal credit price; can be managed as other usage policies.
INSERT INTO usage_policies(operation,unit,amount) VALUES ('DRAFT_COMMENT_REPLY','AI_CREDITS',2);
--> statement-breakpoint
CREATE TRIGGER comment_reply_versions_immutable BEFORE UPDATE OR DELETE ON comment_reply_versions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
