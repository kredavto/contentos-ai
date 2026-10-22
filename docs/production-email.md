# Production authentication mail

The application already supports SMTP through its encrypted durable outbox. A production sender is not configured yet. Resend is a compatible suggested provider; no account, domain, paid plan or external message has been created by this project setup.

For Resend, add a domain/subdomain owned by the operator and install the exact DNS records supplied by that account. Keep existing DNS records intact. Disable open/click tracking for authentication messages so reset/verification URLs are not routed through a tracking service. Wait for verified status before enabling real account registration.

Configure protected runtime values on web and worker:

- `SMTP_URL`: `smtps://resend:URL_ENCODED_API_KEY@smtp.resend.com:465`
- `EMAIL_FROM`: an address at the verified sending domain, for example `CONTENTOS AI <accounts@auth.example.com>`.
- Matching `CREDENTIAL_ENCRYPTION_KEYS` and `CREDENTIAL_ACTIVE_KEY_ID` on both services.
- `APP_URL`: the exact stable HTTPS application origin used for links and CSRF validation.

The values above contain placeholders, not credentials. Put the real key in the server/Vercel secret configuration; do not commit it or paste it into chat. Use a sending-scoped key for the intended domain where supported. SMTP is contacted by the persistent worker, not the Vercel request handler. The generic SMTP adapter uses a stable Message-ID, which is not a deduplication guarantee. Migration 0071 and the worker fence submission separately from claiming: only a proven SMTP rejection before acceptance may retry. An unknown transport outcome or an expired submitted attempt becomes terminal `RECONCILIATION`; its encrypted payload is cleared and an `AUTH_EMAIL_RECONCILIATION_REQUIRED` audit event is recorded. It is never automatically resent. A crash before submission can safely recover. Existing in-flight rows are conservatively marked as submitted by the migration. Deploy this migration with the old worker stopped, then start the updated worker; do not mix old and new delivery workers.

Validate through an explicitly authorized registration/reset to an operator-controlled mailbox after configuration. Check the real inbox, link origin, token consumption and terminal outbox payload clearing; fixture tests alone do not establish production deliverability.

Official references checked 2026-10-09: [SMTP settings and prerequisites](https://resend.com/docs/send-with-smtp), [verified domains and tracking](https://resend.com/docs/dashboard/domains/introduction), [current pricing](https://resend.com/pricing). The pricing page currently lists a 100-message daily limit for Free; confirm current limits and avoid enabling paid overages without operator authorization.

## Uncertain delivery recovery

Inspect `email_outbox` rows with status `RECONCILIATION` and the matching audit event. Correlate the outbox UUID with the SMTP provider's delivery logs using Message-ID `<UUID@contentos.local>`. Do not change terminal rows back to PENDING or replay the old token. If the user still needs a link, the normal verification/reset request issues a new token and invalidates the previous one. Delivery logs may be inconclusive; preserve that uncertainty. Automated notification emails remain a separate unimplemented feature.

This design favors avoiding duplicate submissions over guaranteed delivery after a process crash. A crash between recording submission and opening the SMTP connection can therefore require a new user request. Token eligibility is checked again immediately before submission; a revocation racing an already submitted message cannot recall that message, but token validation still prevents use of the revoked link.
