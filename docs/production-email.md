# Production authentication mail

The application already supports SMTP through its encrypted durable outbox. A production sender is not configured yet. Resend is a compatible suggested provider; no account, domain, paid plan or external message has been created by this project setup.

For Resend, add a domain/subdomain owned by the operator and install the exact DNS records supplied by that account. Keep existing DNS records intact. Disable open/click tracking for authentication messages so reset/verification URLs are not routed through a tracking service. Wait for verified status before enabling real account registration.

Configure protected runtime values on web and worker:

- `SMTP_URL`: `smtps://resend:URL_ENCODED_API_KEY@smtp.resend.com:465`
- `EMAIL_FROM`: an address at the verified sending domain, for example `CONTENTOS AI <accounts@auth.example.com>`.
- Matching `CREDENTIAL_ENCRYPTION_KEYS` and `CREDENTIAL_ACTIVE_KEY_ID` on both services.
- `APP_URL`: the exact stable HTTPS application origin used for links and CSRF validation.

The values above contain placeholders, not credentials. Put the real key in the server/Vercel secret configuration; do not commit it or paste it into chat. Use a sending-scoped key for the intended domain where supported. SMTP is contacted by the persistent worker, not the Vercel request handler. The current generic SMTP adapter uses a stable Message-ID but does not set Resend's optional provider-specific idempotency header; delivery is at-least-once after an uncertain acknowledgement.

Validate through an explicitly authorized registration/reset to an operator-controlled mailbox after configuration. Check the real inbox, link origin, token consumption and terminal outbox payload clearing; fixture tests alone do not establish production deliverability.

Official references checked 2026-10-09: [SMTP settings and prerequisites](https://resend.com/docs/send-with-smtp), [verified domains and tracking](https://resend.com/docs/dashboard/domains/introduction), [current pricing](https://resend.com/pricing). The pricing page currently lists a 100-message daily limit for Free; confirm current limits and avoid enabling paid overages without operator authorization.
