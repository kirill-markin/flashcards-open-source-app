# Deployment

## Local (Docker Compose)

### Start

```bash
make up
```

This starts:

1. `postgres` (Postgres 18)
2. `migrate` (runs `scripts/migrate.sh`)
3. `auth` (auth service on port 8081, requires Cognito env vars)

By default `AUTH_MODE=none` — sync endpoints accept any request with `userId=local`. Set `AUTH_MODE=cognito` and fill in Cognito env vars in `.env` to test real auth locally.

### Stop

```bash
make down
```

## AWS (CDK)

The CDK stack provisions:

- VPC + private subnets
- RDS Postgres
- Cognito User Pool (EMAIL_OTP passwordless auth)
- API Gateway + two Lambdas (backend + auth)
- Session encryption key in Secrets Manager
- CloudWatch alarms + SNS topic
- AWS Backup plan for RDS

### First deploy

```bash
export AWS_PROFILE=flashcards-open-source-app
bash scripts/bootstrap.sh --region eu-central-1
```

### CI/CD

GitHub Actions deploys on push to `main` using OIDC role from stack outputs.
