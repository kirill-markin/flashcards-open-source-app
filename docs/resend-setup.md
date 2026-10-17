# Resend Setup For Cognito OTP

One-time setup for sending Cognito `EMAIL_OTP` emails through Resend with a Cognito `CustomEmailSender` Lambda. Cognito still issues the OTP; only delivery moves from AWS-managed email to Resend.

This repository officially supports Resend for transactional auth email delivery. If you want a different provider, modify the custom sender Lambda in your own fork.

## Naming

- Transactional sender: `no-reply@mail.<domain>`.
- `mail.<domain>` is dedicated to transactional auth traffic so future marketing traffic, reserved for `updates.<domain>`, can live on a separate reputation domain.

## Prerequisites

Keep `AWS_REGION`, `DOMAIN_NAME`, `RESEND_API_KEY`, `RESEND_ADMIN_API_KEY`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` in root `.env` or export them in the current shell. `RESEND_API_KEY` is the send-only runtime key copied into AWS Secrets Manager; `RESEND_ADMIN_API_KEY` manages the domain and stays local ([`.env.example`](../.env.example)). Neither raw key is ever committed or stored in GitHub; CI/CD holds only the secret ARN and the sender email.

## One-time setup

1. Store the runtime Resend key in AWS Secrets Manager:

```bash
bash scripts/setup/setup-resend-secret.sh --region eu-central-1
```

2. Create or reuse the Resend transactional domain, write its DNS records to Cloudflare, and ask Resend to verify it. Add `--dry-run` first to preview the DNS changes without mutating Resend or Cloudflare:

```bash
bash scripts/setup/setup-resend-domain.sh --domain flashcards-open-source-app.com --subdomain mail
```

3. Populate any missing deploy-time config in GitHub Actions:

```bash
bash scripts/setup/setup-github.sh
```

4. Push the repo changes to `main` so CI/CD deploys the updated Cognito custom sender flow.
