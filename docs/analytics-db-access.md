# Analytical DB Access

This document describes the supported analytical access paths for the persistent `reporting_readonly` role and the exact database permissions granted to it.

## Purpose

The supported read-only access paths are:

- manual/operator analytics and Metabase-style tunneling without making the production RDS instance itself publicly reachable
- controlled server-side admin analytics where the backend Lambda runs read-only admin reporting SQL inside the VPC

The `reporting_readonly` role is part of the baseline schema in every environment. When analytical access is enabled, the stack also creates:

- an EC2 bastion host dedicated to analytical tunneling, reachable both through AWS Systems Manager Session Manager and through public SSH
- an instance role with the AWS managed policy `AmazonSSMManagedInstanceCore`, which is what registers the bastion with Systems Manager
- a private network path from that bastion host to the RDS instance on `5432`

The current `reporting_readonly` password secret is also part of the baseline infrastructure in every environment, even when the SSH bastion is disabled. The deployed backend Lambda uses that same role for server-side admin analytics through a separate read-only pool and without SSH.

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
bash scripts/setup/setup-github.sh
```

and deploy through the normal AWS release path.

Important: `bash scripts/setup/setup-github.sh` only adds missing GitHub Actions variables and secrets. It does not remove or overwrite existing analytical SSH variables once they already exist in GitHub.

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
   - `AnalyticsSsmInstanceId`

Important current behavior: this disable flow removes the AWS-side bastion path only. It does not remove the baseline Postgres role `reporting_readonly`, its read grants, or the current reporting password secret/output used by server-side admin analytics.

That means disabling analytics SSH access should be treated as removing the bastion and both of its operator access paths, SSH and SSM. It should not be treated as a full schema-level removal of `reporting_readonly`.

## What gets exposed

After deployment, CloudFormation always includes:

- `ReportingDbSecretArn`
- existing `DbEndpoint`

When analytical access is enabled, CloudFormation also includes:

- `AnalyticsSsmInstanceId`
- `AnalyticsSshHost`
- `AnalyticsSshPort`
- `AnalyticsSshUsername`

Use those outputs as the source of truth for connection settings.

The supported operator shortcut is:

```bash
bash scripts/setup/get-analytics-db-access.sh --stack-name FlashcardsOpenSourceApp
```

That helper reads the current stack outputs, resolves the current reporting secret by ARN, and prints a JSON bundle with the current SSM, SSH, database, and password values.

The SSM path is additive, so `ssmInstanceId` is empty on any stack that has not yet deployed it. The helper only notes that on stderr and still prints the SSH, database, and password values, which remain the working path in that window.

## Preferred operator path: SSM port forwarding

Session Manager port forwarding is the preferred supported operator path. It works from any network, needs no inbound port on the bastion, and needs no entry in `ANALYTICS_SSH_ALLOWED_CIDRS`, because the tunnel is established outbound by the SSM Agent on the bastion.

Local prerequisite: the AWS CLI plus the `session-manager-plugin`, which the AWS CLI shells out to for `aws ssm start-session`.

```bash
brew install --cask session-manager-plugin
```

Operator IAM prerequisite: credentials allowed to `ssm:StartSession` on the bastion instance and on `arn:aws:ssm:<region>::document/AWS-StartPortForwardingSessionToRemoteHost`, plus `ssm:TerminateSession` and `ssm:ResumeSession` on their own `arn:aws:ssm:*:*:session/*` sessions, plus `ssm:DescribeInstanceInformation` for the registration check below. No SSH key and no source-IP allowlist entry are involved.

Verify that the bastion is registered with Systems Manager before opening a tunnel:

```bash
aws ssm describe-instance-information \
  --filters Key=InstanceIds,Values=<AnalyticsSsmInstanceId>
```

An empty result right after a deploy is normal rather than a broken deploy: the SSM Agent backs off while it has no credentials, so an already-running bastion that has just been given its instance role can take several minutes to appear. Retry before investigating further.

Open the tunnel with the instance id from `AnalyticsSsmInstanceId`:

```bash
aws ssm start-session \
  --target <AnalyticsSsmInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<DbEndpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

The session forwards `127.0.0.1:15432` to `<DbEndpoint>:5432` through the bastion, so every local client step below is identical to the SSH path.

The two paths are not equally narrow. The SSH path is restricted by sshd to a tunnel into `<DbEndpoint>:5432` with no interactive shell, while `AmazonSSMManagedInstanceCore` registers the bastion with Session Manager generally, so a principal holding `ssm:StartSession` on it also gets an interactive shell on the bastion and port forwarding to any host reachable from it. That is accepted here because the only principals holding `ssm:StartSession` in this account are already account administrators.

The public SSH path described in the rest of this document is still deployed and still supported. It is kept until the SSM path is confirmed in production, and it stays the path used by tools such as Metabase that speak SSH rather than SSM.

## Bastion behavior

The bastion host is public only for SSH and is expected to be protected by:

- `22/tcp` ingress limited to `ANALYTICS_SSH_ALLOWED_CIDRS`
- SSH key authentication only
- `PasswordAuthentication no`
- `AllowTcpForwarding yes`
- `PermitOpen <DbEndpoint>:5432`
- no interactive shell access for the analytics SSH user

These properties describe the SSH path. Over SSH the bastion exists only to forward traffic into the private database network: the RDS instance remains private, and the analytics SSH user is tunnel-only rather than a general shell user. The SSM path is not constrained by sshd, as described above.

## Database role: `reporting_readonly`

The baseline schema migration creates a dedicated login role and its read-only grants:

- role name: `reporting_readonly`
- login enabled
- `CONNECT` on database `flashcards`
- `USAGE` on schemas `org`, `content`, `sync`, `support`, `community`, `auth`, `ai`, `analytics`
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

Important current behavior: this role is intentionally persistent across later bastion disablement because it is part of the baseline schema. The disable flow removes the bastion and both of its operator access paths, SSH and SSM, while leaving this role, its grants, and the reporting secret in place.

## Granted schemas

The role gets `USAGE` on these schemas:

- `org`
- `content`
- `sync`
- `support`
- `community`
- `auth`
- `ai`
- `analytics`

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
- `support.feedback_submissions`
- `support.feedback_prompt_events`
- `community.public_profiles`
- `community.public_review_activity_facts`
- `community.leaderboard_snapshots`
- `community.leaderboard_snapshot_entries`
- selected audit columns on `community.friend_invitations`
- selected audit columns on `community.friendships`
- selected operational columns on `auth.user_identities`
- selected operational columns on `auth.guest_sessions`
- `auth.guest_ai_monthly_usage`
- selected audit columns on `auth.guest_upgrade_history`
- `auth.guest_replica_aliases`
- selected metadata columns on `ai.chat_sessions`
- selected metadata columns on `ai.chat_runs`
- selected metadata columns on `ai.chat_composer_suggestion_generations`
- `sync.workspace_sync_metadata`
- selected metadata columns on `sync.hot_changes`
- selected metadata columns on `sync.applied_operations_current`
- `analytics.product_events`
- `analytics.identity_links`
- `analytics.product_events_resolved`, the view that resolves anonymous events to their eventual account at read time

No write access is granted.

## Row-level security behavior

For granted tables that have row-level security enabled, migrations create explicit `FOR SELECT` policies for `reporting_readonly`.

Those policies currently use `USING (true)`, which means the role is allowed to read all rows from those allowed tables. This is intentional for manual operator analytics.

The granted `auth` analytics tables currently do not have row-level security enabled. Their `reporting_readonly` access is limited by explicit read-only column grants instead.

## Manual local workflow

1. Resolve the current access bundle:

```bash
bash scripts/setup/get-analytics-db-access.sh --stack-name FlashcardsOpenSourceApp
```

Example output:

```json
{
  "sshHost": "ec2-203-0-113-10.eu-central-1.compute.amazonaws.com",
  "sshPort": "22",
  "sshUsername": "analytics",
  "ssmInstanceId": "i-0123456789abcdef0",
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

3. Start a local tunnel. Preferred, with SSM port forwarding as described above:

```bash
aws ssm start-session \
  --target <ssmInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<dbEndpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

Or over the still-supported SSH path:

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

Use `reporting_readonly` only for analytical queries and investigation. It must remain read-only for both operator bastion access and backend-owned admin analytics.

Prefer querying stable business tables first:

- `org.workspaces`
- `org.workspace_memberships`
- `content.cards`
- `content.decks`
- `content.review_events`

Use sync tables only when the investigation actually needs sync-level state:

- `sync.workspace_replicas`
- `sync.installations`

Use support tables when the investigation needs submitted product feedback or automatic feedback prompt history:

- `support.feedback_submissions`
- `support.feedback_prompt_events`

Use community tables when the investigation needs leaderboard participation, public community activity, friend invitation status, or friendship counts:

- `community.public_profiles`
- `community.public_review_activity_facts`
- `community.leaderboard_snapshots`
- `community.leaderboard_snapshot_entries`
- `community.friend_invitations`
- `community.friendships`

Friend invitation analytics intentionally expose invitation ids, inviter ids, created/expiry timestamps, acceptance timestamps, and accepted-by user ids. They do not expose `community.friend_invitations.invite_token_hash`.

Friendship analytics intentionally expose directed relationship ids and creation metadata. One accepted friendship normally creates two `community.friendships` rows, one per viewer, so aggregate reports should count unordered pairs or divide symmetric directed rows by two when they need a human friendship count.

Use guest and account-conversion tables when the investigation needs guest activity, guest AI quota usage, or guest-to-account upgrade funnel data:

- `auth.user_identities`
- `auth.guest_sessions`
- `auth.guest_ai_monthly_usage`
- `auth.guest_upgrade_history`
- `auth.guest_replica_aliases`

Guest analytics intentionally do not expose guest session secret hashes, replay secret hashes, raw provider subjects, OTP challenge state, API key hashes, or admin entitlement rows.

Use AI operational tables when the investigation needs chat session volume, run health, model/cost-policy distribution, or stuck/failed run timing:

- `ai.chat_sessions`
- `ai.chat_runs`
- `ai.chat_composer_suggestion_generations`

AI operational analytics intentionally expose metadata only. They do not expose `ai.chat_items`, `ai.chat_items.payload`, `ai.chat_runs.turn_input`, `ai.chat_runs.last_error_message`, `ai.chat_sessions.composer_suggestions`, or `ai.chat_composer_suggestion_generations.suggestions`.

Use current sync diagnostic tables when the investigation needs sync retention metadata, hot-state mutation volume, or idempotency ledger diagnostics:

- `sync.workspace_sync_metadata`
- `sync.hot_changes`
- `sync.applied_operations_current`

Sync diagnostics intentionally do not expose the superseded `sync.changes` payload feed or legacy `sync.applied_operations` table.

Product analytics writes on the guest upgrade path are best effort: they run after the upgrade transaction already committed. On the merge path they are never retried, because that path revokes the guest session, so a client retry returns an idempotent replay and never reaches the producer again. `auth.guest_upgrade_history` is the reconstruction source for either loss on that path. `source_guest_user_id` and `target_user_id` rebuild a missing `analytics.identity_links` row, which is what makes that guest's pre-upgrade history resolve to the account instead of the guest id in `analytics.product_events_resolved`; those columns together with `source_guest_session_id`, `target_workspace_id`, and `merged_at` rebuild a missing `guest_upgrade_completed` row in `analytics.product_events`, whose `event_id` is derived from the guest session id by `apps/backend/src/productAnalytics/serverEvents.ts`. All of these columns are already granted to `reporting_readonly`.

A bound completion — the ordinary first-time guest-to-account conversion, where the Cognito subject is already bound to the guest user — writes no `auth.guest_upgrade_history` row at all, so there is nothing to query and nothing to reconstruct from. It also writes no identity link, because the guest user id is already the account id. It does not revoke the guest session either, so a repeated `POST /guest-auth/upgrade/complete` reaches the producer again, and the derived `event_id` conflicting in the writer is what keeps that conversion counted once.

The auth origin writes product analytics rows of its own: the web sign-in funnel, produced by
`apps/auth` into the same `analytics.product_events` feed and its resolved view. Read how in the
`Login funnel analytics` section of `docs/auth-service.md`, not from the rows. Each caveat below is
owned by the source it names, else by a comment in `apps/auth/src/server/analytics/catalog.ts`:

- The pair (`screen_viewed`, `screen = 'signin'`) has a second `platform = 'web'` producer: the web
  app reports it for the workspace-choice step, downstream of `signin_succeeded`, inflating a
  login-page denominator (`resolveSessionGateSurface` in `apps/web/src/App.tsx`). Auth-origin rows
  are the ones with a null `app_version`, true only because `postAnalyticsEvents` in `client.ts`
  sends no `x-client-version`. `device_locale`, `timezone` and `network_state` are null too: a
  `platform = 'web'` breakdown grouped by one buckets the funnel, and only a filter or join drops it.
- Auth-origin rows resolve to the visitor's guest user id, not the account, whenever the sign-in's
  best-effort identity link did not land, and nothing reconstructs it. A first-ever sign-in usually
  loses it, and so does a sign-in that ran slow (`analyticsReportBudgetMs` in `signInFunnel.ts`).
- A sign-in retires the visitor identity even where the funnel may not attribute it
  (`reportSignInSucceeded` in `signInFunnel.ts`), so a `screen_viewed` with no outcome can be a
  completed sign-in rather than an abandonment; `analytics_visitor_retired_unreported` in the auth
  Lambda log group counts those retirements, not that population. A report still in flight can
  restore the cookie: a revoked token then produces no rows until the cookie is gone, and a live one
  crosses the two people — already linked, it resolves the next account's own rows to the first
  person; unlinked, the first person's tail to that account.
- `signin_failed` carries no `screen`; a funnel filtered on `screen = 'signin'` reads it as zero.
- Web session counts include auth-origin sessions; a visitor whose posts run slow adds one per event.
- A conversion computed from `signin_succeeded` is a lower bound rather than a rate.
- `signin_failed` with `reason = 'server_error'` is a floor rather than the whole.
