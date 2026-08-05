# Switching from mock to live Meta

Mock mode is complete and tested. Live mode is scaffolded but intentionally disabled until a client provides and verifies its own Meta assets.

## Required client assets

- Meta app with Instagram messaging, comments/webhooks, content publishing, and insights permissions approved for the intended account type.
- Instagram professional account and its account ID.
- App ID/secret, webhook verify token, and an appropriate long-lived access token.
- Public privacy policy, data deletion instructions, and app-review test instructions where Meta requires them.

## Procedure

1. Back up and keep `META_MODE=mock` while validating credentials in a non-production Meta asset.
2. Set `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_IG_ACCOUNT_ID`, and the API version reviewed for that date.
3. Configure Meta webhook callbacks to the DM/comment endpoints and subscribe only to required fields.
4. Add real HTTPS media CDN hosts to `ALLOWED_MEDIA_HOSTS`.
5. Verify Meta request signatures before accepting public production callbacks. The portfolio mock-token gate is not a substitute for `X-Hub-Signature-256` validation.
6. Run least-privilege read tests, then one DM reply and one test-account content publish.
7. Change `META_MODE=live`, recreate n8n, monitor `outbound_requests`/`error_logs`, and keep a rollback command ready.

The configured `META_API_VERSION` is a placeholder selected during implementation. Meta versions and permissions change; verify them against current official Meta documentation immediately before go-live. Carousel/story edge cases and container processing status should be tested with the client's exact media types.

## Rollback

Set `META_MODE=mock`, recreate n8n, and confirm mock health. Existing idempotency keys prevent replayed inbound IDs from sending again.
