# AWS Deployment (CDK)

The CDK app ([`bin/app.ts`](bin/app.ts)) deploys the core stack ([`lib/stack.ts`](lib/stack.ts)) and its monitoring stack. AWS deploys run only through CI/CD; first deploys, second hosts and GitHub variables are in [Backend and Web Deployment](../../docs/backend-web-deployment.md), and the system shape in [Architecture](../../docs/architecture.md).

## Deploy config model

Deploy-time config is split across three places:

- Root `.env` is the local operator input for scripts; [`.env.example`](../../.env.example) lists the base values, and the second-host inputs are read by [`generate-cdk-context.sh`](../../scripts/generate/generate-cdk-context.sh).
- AWS Secrets Manager is the source of truth for deployed runtime secrets.
- GitHub repository variables are the source of truth for non-secret deploy config used by CI/CD.

Certificate ARNs and secret ARNs are discovered from AWS, not typed into local context by hand. Local CDK commands assemble `infra/aws/cdk.context.local.json` immediately before invoking CDK, and GitHub Actions assembles the same context inside the workflow job. Before direct CDK synthesis, run `bash scripts/deploy/prepare-lambda-build-inputs.sh` from the repo root to fetch the RDS CA bundle; the release workflow and `bootstrap.sh` do this themselves.

## Lambda asset cache

The release workflow reuses verified Lambda assets between runs ([lambda-input-cache.ts](lib/lambda-input-cache.ts), [lambda-asset-cache.py](../../scripts/deploy/lambda-asset-cache.py)). A corrupt or incomplete restored asset fails synthesis; delete the affected GitHub Actions cache and rerun to rebuild it.

## Analytical DB access

The `reporting_readonly` Postgres role is part of the baseline database schema in every environment. It is supported for two read-only paths:

- manual/operator analytics through the analytical bastion
- controlled server-side admin analytics from the backend Lambda inside the VPC

The bastion is deployed by default and carries exactly one operator access path: SSM Session Manager port forwarding, enabled by an instance role with the AWS managed policy `AmazonSSMManagedInstanceCore` and published as the `AnalyticsSsmInstanceId` output. Its security group has no ingress rules, so no port is exposed to the internet and no source-IP allowlist has to be maintained.

The SSM path is broad by design: registering the instance with Session Manager also gives a principal holding `ssm:StartSession` on it an interactive shell and forwarding to any host reachable from the bastion. That is accepted because the only such principals in this account are already account administrators.

The `reporting_readonly` password secret is also part of the baseline infrastructure in every environment. When analytical access is disabled through the `CDK_ANALYTICS_ACCESS_ENABLED` GitHub variable, only the bastion host, its instance role, and the `AnalyticsSsmInstanceId` output are removed; the underlying `reporting_readonly` database principal and its current password secret remain part of the baseline environment.

An installation that predates the removal of the analytical SSH path still carries the now-unused `CDK_ANALYTICS_SSH_*` repository variables, and `setup-github.sh` never deletes variables. The exact list to delete, and what an installation that never enabled analytical access has to do now that the bastion is on by default, are in [docs/analytics-db-access.md](../../docs/analytics-db-access.md#how-to-enable-it).

The reporting password secret now uses a stable baseline Secrets Manager name, but the supported operator discovery path remains the helper script or the stack outputs so operators always resolve the current deployed secret ARN. The database schema owns the reporting_readonly login role, read-only grants, and non-privileged role settings, while the deployed migration runner uses the secret only to rotate the current password.

Details, granted database permissions, the helper script, and the manual tunnel workflow:

- [docs/analytics-db-access.md](../../docs/analytics-db-access.md)

This AWS bootstrap helper does not manage the Android Google Cloud and Firebase Test Lab repository variables. Android CI/CD uses its own setup flow and helper script:

- docs: [`docs/android-ci-cd.md`](../../docs/android-ci-cd.md)
- sync command: `bash scripts/android/setup-github-android.sh`

## Review/demo accounts

`DEMO_EMAIL_DOSTIP` is a comma-separated allowlist of synthetic `@example.com`
review accounts. The auth Lambda reads their single shared Cognito password
from `flashcards-open-source-app/demo-password-dostip` in Secrets Manager;
these settings do not provision users.

Follow the canonical [reviewer account procedure](../../docs/connector-submission-operations.md#reviewer-demo-account)
for manual Cognito setup, allowlist updates, CI/CD deployment, verification,
and cleanup. Append accounts without replacing existing entries, and preserve
the shared secret while any concurrent review remains active.

## Post-deploy

1. Confirm the SNS subscription in the `ALERT_EMAIL` inbox.
2. Configure Resend DNS with `bash scripts/setup/setup-resend-domain.sh --domain <base-domain> --subdomain mail` ([Resend setup](../../docs/resend-setup.md)).
3. Configure Cloudflare public DNS with `bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp --domain <base-domain>`.
4. Populate any missing GitHub Actions config with `bash scripts/setup/setup-github.sh`.
5. Run `bash scripts/checks/check-public-endpoints.sh --stack-name FlashcardsOpenSourceApp` after DNS changes.
