# Deployment

## Local (Docker Compose)

### Start

```bash
make up
```

This starts:

1. `postgres` (Postgres 18)
2. `migrate` (runs `scripts/migrate.sh`)
3. `worker` (scheduled background worker)

### Stop

```bash
make down
```

## AWS (CDK)

The CDK stack provisions:

- VPC + private subnets
- RDS Postgres
- API Gateway + Lambda backend
- Lambda worker + EventBridge schedule
- CloudWatch alarms + SNS topic
- AWS Backup plan for RDS

### First deploy

```bash
export AWS_PROFILE=flashcards-open-source-app
bash scripts/bootstrap.sh --region eu-central-1
```

### CI/CD

GitHub Actions deploys on push to `main` using OIDC role from stack outputs.
