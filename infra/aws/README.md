# AWS Deployment (CDK)

This stack deploys v1 backend infrastructure for `flashcards-open-source-app`.

## What gets created

- VPC with private subnets
- RDS Postgres 18
- API Gateway (REST API) + Lambda backend
- Lambda worker + EventBridge schedule
- CloudWatch alarms + SNS notifications
- AWS Backup plan for RDS
- GitHub Actions OIDC deployment role

## Required context

Create `infra/aws/cdk.context.local.json` from the example and fill values:

- `region`
- `domainName`
- `alertEmail`
- `githubRepo`
- `apiCertificateArn` (optional, only for custom domain)

## Deploy

```bash
cd infra/aws
npm ci
npx cdk bootstrap --region eu-central-1
npx cdk deploy --all --require-approval never
```

## DNS (Cloudflare)

If custom API domain is enabled (`apiCertificateArn` set), run:

```bash
bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp
```

This creates/updates `api.<domain>` CNAME in Cloudflare from stack outputs.
