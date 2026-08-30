# Analytical DB Access

This document describes the supported analytical access paths for the persistent `reporting_readonly` role and the exact database permissions granted to it.

## Purpose

The supported read-only access paths are:

- manual/operator analytics through an SSM tunnel, without making the production RDS instance itself publicly reachable
- controlled server-side admin analytics where the backend Lambda runs read-only admin reporting SQL inside the VPC

The `reporting_readonly` role is part of the baseline schema in every environment. When analytical access is enabled, the stack also creates:

- an EC2 bastion host dedicated to analytical tunneling, reachable only through AWS Systems Manager Session Manager
- an instance role with the AWS managed policy `AmazonSSMManagedInstanceCore`, which is what registers the bastion with Systems Manager
- a private network path from that bastion host to the RDS instance on `5432`

The bastion exposes no public port and its security group has no ingress rules at all. The current `reporting_readonly` password secret is also part of the baseline infrastructure in every environment, even when the bastion is disabled. The deployed backend Lambda uses that same role for server-side admin analytics through a separate read-only pool.

## How to enable it

Analytical access is enabled by default. A normal deploy creates the bastion with no extra configuration, so a stack can never lose its only database access path by forgetting to set something.

The single optional switch is the root `.env` value:

```bash
ANALYTICS_ACCESS_ENABLED=true
```

`bash scripts/setup/setup-github.sh` copies it into the GitHub Actions variable `CDK_ANALYTICS_ACCESS_ENABLED`, which the deploy workflow turns into the CDK context key `analyticsAccessEnabled`. Only the exact strings `true` and `false` are accepted; anything else fails the synth, and an unset or missing value means enabled.

Important: `bash scripts/setup/setup-github.sh` only adds missing GitHub Actions variables and secrets. It does not overwrite `CDK_ANALYTICS_ACCESS_ENABLED` once it already exists in GitHub.

An installation that predates the SSH removal must delete these now-stale GitHub Actions variables, because nothing reads them any more:

```bash
gh variable delete CDK_ANALYTICS_SSH_PUBLIC_KEYS --repo kirill-markin/flashcards-open-source-app
gh variable delete CDK_ANALYTICS_SSH_ALLOWED_CIDRS --repo kirill-markin/flashcards-open-source-app
gh variable delete CDK_ANALYTICS_SSH_USERNAME --repo kirill-markin/flashcards-open-source-app
```

The matching `ANALYTICS_SSH_USERNAME`, `ANALYTICS_SSH_ALLOWED_CIDRS`, and `ANALYTICS_SSH_PUBLIC_KEYS` entries in root `.env` are dead too and should be removed.

An installation that never enabled analytical access is affected in the opposite direction. Analytical access used to be opt-in and is now on by default, so the next AWS deploy creates the bastion, its instance role, and the `5432` ingress rule into the database security group even though that installation changed nothing. To keep it off, set `ANALYTICS_ACCESS_ENABLED=false` in root `.env` and `CDK_ANALYTICS_ACCESS_ENABLED=false` in GitHub before that deploy, as described in [How to disable it](#how-to-disable-it).

## How to disable it

To remove the analytical bastion:

1. Set the GitHub Actions variable to `false`:

```bash
gh variable set CDK_ANALYTICS_ACCESS_ENABLED --body false --repo kirill-markin/flashcards-open-source-app
```

2. Trigger the normal AWS deploy flow so CloudFormation removes the analytical access resources.
3. Confirm that the `AnalyticsSsmInstanceId` stack output is gone after deploy.

Important current behavior: this disable flow removes the AWS-side bastion path only. It does not remove the baseline Postgres role `reporting_readonly`, its read grants, or the current reporting password secret/output used by server-side admin analytics.

That means disabling analytical access should be treated as removing the bastion and the operator tunnel it carries. It should not be treated as a full schema-level removal of `reporting_readonly`.

## What gets exposed

After deployment, CloudFormation always includes:

- `ReportingDbSecretArn`
- existing `DbEndpoint`

When analytical access is enabled, CloudFormation also includes:

- `AnalyticsSsmInstanceId`

Use those outputs as the source of truth for connection settings.

The supported operator shortcut is:

```bash
bash scripts/setup/get-analytics-db-access.sh --stack-name FlashcardsOpenSourceApp
```

That helper reads the current stack outputs, resolves the current reporting secret by ARN, and prints a JSON bundle with the current SSM, database, and password values. It fails when `AnalyticsSsmInstanceId` is missing, because that output is the whole operator path.

## Operator path: SSM port forwarding

Session Manager port forwarding is the only supported operator path. It works from any network and needs no inbound port on the bastion, because the tunnel is established outbound by the SSM Agent on the bastion.

Local prerequisite: the AWS CLI plus the `session-manager-plugin`, which the AWS CLI shells out to for `aws ssm start-session`.

```bash
brew install --cask session-manager-plugin
```

Operator IAM prerequisite: credentials allowed to `ssm:StartSession` on the bastion instance and on `arn:aws:ssm:<region>::document/AWS-StartPortForwardingSessionToRemoteHost`, plus `ssm:TerminateSession` and `ssm:ResumeSession` on their own `arn:aws:ssm:*:*:session/*` sessions, plus `ssm:DescribeInstanceInformation` for the registration check below.

Verify that the bastion is registered with Systems Manager before opening a tunnel:

```bash
aws ssm describe-instance-information \
  --filters Key=InstanceIds,Values=<AnalyticsSsmInstanceId>
```

An empty result right after a deploy is normal rather than a broken deploy: the SSM Agent takes a few minutes to register, and it backs off for longer while it still has no credentials. Retry before investigating further.

If the bastion still does not register after several minutes, reboot it and re-run the check above. An SSM Agent that came up before its instance role was usable keeps backing off until it restarts, and this bastion has already needed that once:

```bash
aws ec2 reboot-instances --instance-ids <AnalyticsSsmInstanceId>
```

A deploy that changes the bastion may also change its instance id, so re-read `AnalyticsSsmInstanceId` from the current stack outputs instead of reusing a previously noted id.

Open the tunnel with the instance id from `AnalyticsSsmInstanceId`:

```bash
aws ssm start-session \
  --target <AnalyticsSsmInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<DbEndpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

The session forwards `127.0.0.1:15432` to `<DbEndpoint>:5432` through the bastion, so local clients below connect as if the database were local.

The tunnel is not narrow. `AmazonSSMManagedInstanceCore` registers the bastion with Session Manager generally, so a principal holding `ssm:StartSession` on it also gets an interactive shell on the bastion and port forwarding to any host reachable from it. That is accepted here because the only principals holding `ssm:StartSession` in this account are already account administrators, so narrowing the session with a preferences document or an IAM condition would buy nothing real.

## Bastion behavior

The bastion security group has no ingress rules, so nothing on the internet can open a connection to the host. Its only inbound reachability is the outbound session channel the SSM Agent maintains, and its only privileged network position is the `5432` rule that lets its security group reach the RDS instance. The RDS instance itself stays private.

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

Important current behavior: this role is intentionally persistent across later bastion disablement because it is part of the baseline schema. The disable flow removes the bastion and the operator tunnel it carries, while leaving this role, its grants, and the reporting secret in place.

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

3. Start a local tunnel with SSM port forwarding as described above:

```bash
aws ssm start-session \
  --target <ssmInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<dbEndpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

4. Connect locally with `psql` or a SQL client:

```bash
psql "postgresql://<dbUsername>:<password>@127.0.0.1:15432/<dbName>?sslmode=require"
```

The same tunnel can be reused by local desktop clients such as DataGrip or DBeaver by pointing them at `127.0.0.1:15432`.

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
- `signin_failed` carries no `screen`; a funnel filtered on `screen = 'signin'` reads it as zero.
- Web session counts include auth-origin sessions; a visitor whose posts run slow adds one per event.
- A conversion computed from `signin_succeeded` is a lower bound rather than a rate.
- `signin_failed` with `reason = 'server_error'` is a floor rather than the whole.
