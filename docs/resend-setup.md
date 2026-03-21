# Resend Setup For Cognito OTP

One-time setup for sending Cognito `EMAIL_OTP` emails through Resend with a Cognito `CustomEmailSender` Lambda.

This repository officially supports Resend for transactional auth email delivery. If you want a different provider, modify the custom sender Lambda in your own fork.

## Default naming

- Transactional email subdomain: `mail.<domain>`
- Transactional sender: `no-reply@mail.<domain>`
- Reserved future marketing subdomain: `updates.<domain>`

`mail.<domain>` is intentionally dedicated to transactional auth traffic so future marketing traffic can live on a separate reputation domain.

## Prerequisites

1. `infra/aws/cdk.context.local.json` must already contain `region` and `domainName`.
2. Keep two separate local Resend secrets:
   - `RESEND_API_KEY` — the send-only runtime key that gets copied into AWS Secrets Manager for the deployed Cognito custom sender Lambda
   - `RESEND_ADMIN_API_KEY` — the admin key used only by the one-time local setup scripts for domain management
3. Cloudflare credentials must be available in `scripts/cloudflare/.env` or exported:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ZONE_ID`

## One-time setup

1. Store the Resend key in AWS Secrets Manager and write the deploy-time context values:

```bash
bash scripts/setup-resend-secret.sh --region eu-central-1
```

This creates or updates:

- AWS secret `flashcards-open-source-app/resend-api-key`
- context key `resendApiKeySecretArn`
- context key `resendSenderEmail=no-reply@mail.<domain>`

2. Create or reuse the Resend transactional domain, write its DNS records to Cloudflare, and ask Resend to verify it:

```bash
export RESEND_ADMIN_API_KEY="..."
bash scripts/setup-resend-domain.sh --domain flashcards-open-source-app.com --subdomain mail
```

This script:

- creates or reuses `mail.<domain>` in Resend
- fetches the required DNS records from Resend
- upserts them in Cloudflare
- triggers Resend domain verification

3. Sync deploy-time config to GitHub Actions:

```bash
bash scripts/setup-github.sh
```

4. Push the repo changes to `main` so CI/CD deploys the updated Cognito custom sender flow.

## Safe validation

Preview DNS changes without mutating Resend or Cloudflare:

```bash
export RESEND_ADMIN_API_KEY="..."
bash scripts/setup-resend-domain.sh --domain flashcards-open-source-app.com --subdomain mail --dry-run
```

## Notes

- The raw `RESEND_API_KEY` and `RESEND_ADMIN_API_KEY` must never be committed to git, written to `cdk.context.local.json`, or stored in GitHub Variables.
- Only `RESEND_API_KEY` belongs in AWS Secrets Manager because it is the deployed runtime credential. `RESEND_ADMIN_API_KEY` stays local-only.
- CI/CD stores only the AWS Secrets Manager ARN and sender email.
- The deployed auth flow still uses Cognito `EMAIL_OTP`; only the delivery path changes from AWS-managed email to Resend via the Cognito trigger Lambda.
