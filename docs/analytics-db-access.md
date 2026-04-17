# Analytical DB Access

This document describes the optional operator access path used for analytical access to the private Postgres database and the exact database permissions granted to the persistent `reporting_readonly` role.

## Purpose

This access path exists for manual operator analytics and Metabase-style SSH tunneling without making the production RDS instance itself publicly reachable.

The `reporting_readonly` role is part of the baseline schema in every environment. When analytical access is enabled, the stack also creates:

- a public EC2 bastion host dedicated to analytical SSH tunneling
- a private network path from that bastion host to the RDS instance on `5432`

The current `reporting_readonly` password secret is also part of the baseline infrastructure in every environment, even when the SSH bastion is disabled.

## How to enable it

Set these values together in the root `.env`:

```bash
ANALYTICS_SSH_USERNAME=analytics
ANALYTICS_SSH_ALLOWED_CIDRS=203.0.113.10/32,198.51.100.0/24
ANALYTICS_SSH_PUBLIC_KEYS='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKirill kirill@laptop
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleMetabase metabase@cloud'
```

`ANALYTICS_SSH_PUBLIC_KEYS` is a newline-separated list of public keys. Keep the value shell-quoted in `.env` so the embedded newlines survive `source`.

Then run the normal setup and deploy flow:

```bash
bash scripts/setup-github.sh
```

and deploy through the normal AWS release path.

Important: `bash scripts/setup-github.sh` only adds missing GitHub Actions variables and secrets. It does not remove or overwrite existing analytical SSH variables once they already exist in GitHub.

## How to disable it

To disable the analytical SSH bastion after it was previously enabled:

1. Remove `ANALYTICS_SSH_PUBLIC_KEYS`, `ANALYTICS_SSH_ALLOWED_CIDRS`, and `ANALYTICS_SSH_USERNAME` from the root `.env`.
2. Delete these GitHub Actions variables manually:

```bash
gh variable delete CDK_ANALYTICS_SSH_PUBLIC_KEYS --repo kirill-markin/flashcards-open-source-app
gh variable delete CDK_ANALYTICS_SSH_ALLOWED_CIDRS --repo kirill-markin/flashcards-open-source-app
gh variable delete CDK_ANALYTICS_SSH_USERNAME --repo kirill-markin/flashcards-open-source-app
```

3. Trigger the normal AWS deploy flow so CloudFormation removes the analytical access resources.
4. Confirm that these stack outputs are gone after deploy:
   - `AnalyticsSshHost`
   - `AnalyticsSshPort`
   - `AnalyticsSshUsername`

Important current behavior: this disable flow removes the AWS-side bastion path only. It does not remove the baseline Postgres role `reporting_readonly`, its read grants, or the current reporting password secret/output.

That means disabling analytics access should be treated as removing the supported operator access path only. It should not be treated as a full schema-level removal of `reporting_readonly`.

## What gets exposed

After deployment, CloudFormation always includes:

- `ReportingDbSecretArn`
- existing `DbEndpoint`

When analytical access is enabled, CloudFormation also includes:

- `AnalyticsSshHost`
- `AnalyticsSshPort`
- `AnalyticsSshUsername`

Use those outputs as the source of truth for connection settings.

The supported operator shortcut is:

```bash
bash scripts/get-analytics-db-access.sh --stack-name FlashcardsOpenSourceApp
```

That helper reads the current stack outputs, resolves the current reporting secret by ARN, and prints a JSON bundle with the current SSH, database, and password values.

## Bastion behavior

The bastion host is public only for SSH and is expected to be protected by:

- `22/tcp` ingress limited to `ANALYTICS_SSH_ALLOWED_CIDRS`
- SSH key authentication only
- `PasswordAuthentication no`
- `AllowTcpForwarding yes`
- `PermitOpen <DbEndpoint>:5432`
- no interactive shell access for the analytics SSH user

The bastion exists only to forward traffic into the private database network. The RDS instance remains private, and the analytics SSH user is tunnel-only rather than a general shell user.

## Database role: `reporting_readonly`

The baseline schema migration creates a dedicated login role and its read-only grants:

- role name: `reporting_readonly`
- login enabled
- `CONNECT` on database `flashcards`
- `USAGE` on schemas `org`, `content`, `sync`
- `SELECT` only on the allowed tables listed below

The baseline schema migration also enforces the persistent runtime policy for this role:

- `NOCREATEDB`
- `NOCREATEROLE`
- `NOINHERIT`
- `default_transaction_read_only = on`
- `statement_timeout = '30s'`
- `lock_timeout = '5s'`
- `idle_in_transaction_session_timeout = '60s'`
- `CONNECTION LIMIT 3`

Privileged role attributes such as `NOSUPERUSER` and `NOREPLICATION` are currently outside the normal migration path on RDS/PostgreSQL 18 and are not managed here.

Important current behavior: this role is intentionally persistent across later bastion disablement because it is part of the baseline schema. The disable flow only removes the operator SSH access path.

## Granted schemas

The role gets `USAGE` on these schemas:

- `org`
- `content`
- `sync`

## Granted tables

The role gets `SELECT` on these tables only:

- `org.user_settings`
- `org.workspaces`
- `org.workspace_memberships`
- `content.cards`
- `content.decks`
- `content.review_events`
- `sync.workspace_replicas`
- `sync.installations`

No write access is granted.

## Row-level security behavior

The baseline schema migration creates explicit `FOR SELECT` policies for `reporting_readonly` on the same tables listed above.

Those policies currently use `USING (true)`, which means the role is allowed to read all rows from those allowed tables. This is intentional for manual operator analytics.

## Manual local workflow

1. Resolve the current access bundle:

```bash
bash scripts/get-analytics-db-access.sh --stack-name FlashcardsOpenSourceApp
```

Example output:

```json
{
  "sshHost": "ec2-203-0-113-10.eu-central-1.compute.amazonaws.com",
  "sshPort": "22",
  "sshUsername": "analytics",
  "dbEndpoint": "flashcards-db.abcdefghijkl.eu-central-1.rds.amazonaws.com",
  "dbName": "flashcards",
  "dbUsername": "reporting_readonly",
  "secretArn": "arn:aws:secretsmanager:eu-central-1:123456789012:secret:ReportingDbSecretAbCdEf",
  "password": "example-password"
}
```

2. If needed, read the reporting secret directly from the current ARN:

```bash
aws secretsmanager get-secret-value \
  --secret-id <ReportingDbSecretArn> \
  --query SecretString \
  --output text
```

3. Start a local tunnel:

```bash
ssh -N \
  -L 15432:<DbEndpoint>:5432 \
  -i ~/.ssh/your-analytics-key \
  <AnalyticsSshUsername>@<AnalyticsSshHost> \
  -p <AnalyticsSshPort>
```

4. Connect locally with `psql` or a SQL client:

```bash
psql "postgresql://<dbUsername>:<password>@127.0.0.1:15432/<dbName>?sslmode=require"
```

The same tunnel can be reused by local desktop clients such as DataGrip or DBeaver by pointing them at `127.0.0.1:15432`.

If you try a plain `ssh <AnalyticsSshUsername>@<AnalyticsSshHost> -p <AnalyticsSshPort>`, the connection is expected to refuse interactive shell access. That is intentional. To verify access, test an actual tunnel command instead.

## Metabase SSH tunnel setup

Configure the Postgres connection in Metabase like this:

- `Use an SSH tunnel for database connections`: `Yes`
- `Host`: `<DbEndpoint>`
- `Port`: `5432`
- `Database name`: `flashcards`
- `Username`: `reporting_readonly`
- `Password`: from the helper script JSON bundle or from `ReportingDbSecretArn`
- `SSH tunnel host`: `<AnalyticsSshHost>`
- `SSH tunnel port`: `<AnalyticsSshPort>`
- `SSH tunnel username`: `<AnalyticsSshUsername>`
- `SSH authentication`: `SSH Key`
- `SSH private key`: the private key paired with one of the configured public keys

Metabase should query the private RDS endpoint through the bastion. It should not target the bastion host as the Postgres host.

This stack still matches Metabase's SSH tunneling requirements:

- the bastion accepts SSH key authentication
- `AllowTcpForwarding` is enabled
- the allowed tunnel destination is restricted to `<DbEndpoint>:5432`
- no shell access is required for the Metabase connection flow

The reporting password secret now uses a stable baseline Secrets Manager name, but the supported operator discovery path remains the current `ReportingDbSecretArn` stack output and the helper script that resolves it. The deployed migration runner uses that secret to rotate the current database password without changing the schema-owned role policy.

## Usage guidance

Use `reporting_readonly` only for analytical queries and investigation.

Prefer querying stable business tables first:

- `org.workspaces`
- `org.workspace_memberships`
- `content.cards`
- `content.decks`
- `content.review_events`

Use sync tables only when the investigation actually needs sync-level state:

- `sync.workspace_replicas`
- `sync.installations`
