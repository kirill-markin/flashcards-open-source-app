# Analytical DB Access

Every analysis of people or their data (events, chats, cards, reviews) first drops the actors the shared exclusion rule names, exactly as the admin reports do: [Who counts as a person](admin-app.md#who-counts-as-a-person).

The persistent `reporting_readonly` role has two read-only access paths:

- manual/operator analytics through an SSM tunnel to a [bastion](../infra/aws/lib/analytics-access.ts), without making the production RDS instance publicly reachable
- server-side admin analytics, where the backend Lambda runs read-only admin reporting SQL inside the VPC ([admin reporting data path](admin-app.md#reporting-data-path))

The role and its password secret are part of the baseline schema and infrastructure in every environment; only the bastion is optional.

## How to enable it

Analytical access is enabled by default, so a normal deploy creates the bastion, and a stack never loses its only database path by forgetting a setting ([switch](../infra/aws/lib/stack.ts)). The optional root `.env` value `ANALYTICS_ACCESS_ENABLED` (`true` or `false`) reaches the GitHub Actions variable `CDK_ANALYTICS_ACCESS_ENABLED` through `bash scripts/setup/setup-github.sh`, which only adds missing variables and never overwrites one that exists.

An installation that predates the SSH removal deletes the stale variables nothing reads any more, and removes the matching `ANALYTICS_SSH_USERNAME`, `ANALYTICS_SSH_ALLOWED_CIDRS`, and `ANALYTICS_SSH_PUBLIC_KEYS` entries from root `.env`:

```bash
gh variable delete CDK_ANALYTICS_SSH_PUBLIC_KEYS --repo kirill-markin/flashcards-open-source-app
gh variable delete CDK_ANALYTICS_SSH_ALLOWED_CIDRS --repo kirill-markin/flashcards-open-source-app
gh variable delete CDK_ANALYTICS_SSH_USERNAME --repo kirill-markin/flashcards-open-source-app
```

An installation that never enabled analytical access gets the bastion, its instance role, and the `5432` ingress rule into the database security group on its next deploy. To keep it off, set `ANALYTICS_ACCESS_ENABLED=false` in root `.env` and `CDK_ANALYTICS_ACCESS_ENABLED=false` in GitHub before that deploy.

## How to disable it

1. Set the GitHub Actions variable to `false`:

```bash
gh variable set CDK_ANALYTICS_ACCESS_ENABLED --body false --repo kirill-markin/flashcards-open-source-app
```

2. Trigger the normal AWS deploy flow so CloudFormation removes the analytical access resources.
3. Confirm that the `AnalyticsSsmInstanceId` stack output is gone after deploy.

This removes the bastion and the operator tunnel only: the `reporting_readonly` role, its grants, and the reporting secret stay, because server-side admin analytics uses them.

## Operator path: SSM port forwarding

Session Manager port forwarding is the only operator path. It works from any network, and the bastion needs no inbound port because the SSM Agent establishes the tunnel outbound.

Every AWS command here uses the `flashcards-open-source-app` profile: the default profile reaches a different account, where the registration check returns the same empty list as a bastion that has not registered yet.

Local prerequisite: the AWS CLI plus the `session-manager-plugin`, which the AWS CLI shells out to for `aws ssm start-session`.

```bash
brew install --cask session-manager-plugin
```

Operator IAM prerequisite: credentials allowed to `ssm:StartSession` on the bastion instance and on `arn:aws:ssm:<region>::document/AWS-StartPortForwardingSessionToRemoteHost`, plus `ssm:TerminateSession` and `ssm:ResumeSession` on their own `arn:aws:ssm:*:*:session/*` sessions, plus `ssm:DescribeInstanceInformation` for the registration check below.

A deploy can change both the instance id and the database endpoint, so always re-read `<AnalyticsSsmInstanceId>` and `<DbEndpoint>` from the current stack outputs, which step 1 of the [Manual local workflow](#manual-local-workflow) prints as `ssmInstanceId` and `dbEndpoint`.

Verify that the bastion is registered with Systems Manager before opening a tunnel:

```bash
aws ssm describe-instance-information --profile flashcards-open-source-app \
  --filters Key=InstanceIds,Values=<AnalyticsSsmInstanceId>
```

An empty result right after a deploy is normal: the SSM Agent takes a few minutes to register, and backs off for longer while it still has no credentials. Retry before investigating. If it still does not register after several minutes, reboot the bastion and re-run the check, because an agent that came up before its instance role was usable keeps backing off until it restarts:

```bash
aws ec2 reboot-instances --profile flashcards-open-source-app --instance-ids <AnalyticsSsmInstanceId>
```

Open the tunnel:

```bash
aws ssm start-session --profile flashcards-open-source-app \
  --target <AnalyticsSsmInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<DbEndpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

The session forwards `127.0.0.1:15432` to `<DbEndpoint>:5432` through the bastion, so local clients connect as if the database were local. Close it with the id from the `Starting session with SessionId:` line, because killing the CLI leaves the plugin process and the session running:

```bash
aws ssm terminate-session --profile flashcards-open-source-app --session-id <SessionId>
```

`make local-admin` ([scripts/local/admin-prod-readonly.sh](../scripts/local/admin-prod-readonly.sh)) opens this same tunnel for the local admin app and terminates the session on exit.

The tunnel is not narrow: a principal holding `ssm:StartSession` on the bastion also gets an interactive shell on it and port forwarding to any host reachable from it. That is accepted because the only such principals in this account are already account administrators.

## Database role: `reporting_readonly`

[`0044_reporting_readonly_role.sql`](../db/migrations/0044_reporting_readonly_role.sql) owns the login role, its non-privileged attributes, session settings (read-only transactions and timeouts), and connection limit, which [`0046`](../db/migrations/0046_reporting_readonly_connection_limit.sql) raised on databases where 0044 had already been applied. It also grants the initial `SELECT` set, and later migrations add the rest, often column-scoped; each granted table with row-level security gets an explicit `USING (true)` `FOR SELECT` policy; no write access is ever granted. The deployed migration runner rotates the password through the reporting secret without changing the schema-owned role.

Read the current grants from the database rather than from a list:

```sql
SELECT table_schema, table_name
FROM information_schema.table_privileges
WHERE grantee = 'reporting_readonly' AND privilege_type = 'SELECT'
ORDER BY 1, 2;

SELECT table_schema, table_name, column_name
FROM information_schema.column_privileges
WHERE grantee = 'reporting_readonly' AND table_schema = '<schema>' AND table_name = '<table>'
ORDER BY 3;
```

The grants deliberately include hosted AI chat content, not metadata alone: `ai.chat_items.payload` (the stored transcript), `ai.chat_runs.turn_input` and `last_error_message`, `ai.chat_sessions.composer_suggestions`, and `ai.chat_composer_suggestion_generations.suggestions` ([grant](../db/migrations/0153_reporting_readonly_ai_chat_content.sql)). Answering how people actually use the AI features needs the content, and the privacy policy discloses it in its `Hosted AI and External AI Clients` section. Handle what you read as personal data belonging to the person who wrote it. Secret hashes, raw provider subjects, API key hashes and verbatim provider payloads stay hidden.

## Manual local workflow

1. Resolve the current access bundle with [the helper](../scripts/setup/get-analytics-db-access.sh), which prints the SSM instance id, database endpoint and name, username, secret ARN, and password as JSON from the current stack outputs:

```bash
AWS_PROFILE=flashcards-open-source-app bash scripts/setup/get-analytics-db-access.sh --stack-name FlashcardsOpenSourceApp
```

2. Open the tunnel as in [Operator path: SSM port forwarding](#operator-path-ssm-port-forwarding), with the printed `ssmInstanceId` and `dbEndpoint`.

3. Connect locally with `psql`, or point DataGrip or DBeaver at `127.0.0.1:15432`:

```bash
psql "postgresql://<dbUsername>:<password>@127.0.0.1:15432/<dbName>?sslmode=require"
```

4. Close the tunnel as in [Operator path: SSM port forwarding](#operator-path-ssm-port-forwarding).

## Usage guidance

Use `reporting_readonly` only for analytical queries and investigation. Before querying a table, read its table comment (`\dt+ <schema>.<table>` in `psql`) and column comments (`\d+ <schema>.<table>`): they say how to read it, for example why `community.friendships` holds two rows per friendship, how to price `ai.usage_events` against `ai.model_prices`, how to size `ai.chat_items` from `role` and `content_char_count` without reading `payload`, and why entitlement is resolved from purchases and grants rather than from `billing.entitlement_snapshots`. Where two `ai.model_prices` windows overlap for one usage row, price it with the later `effective_from`. Guest AI usage recorded before `ai.usage_events` metering began is gone. Provider periods, orders, payments, refunds, and import coverage follow the [native billing history contracts](billing-history.md).

### Guest upgrade reconstruction

Product analytics writes on the guest upgrade path are best effort: they run after the upgrade transaction committed, and on the merge path they are never retried, because that path revokes the guest session. `auth.guest_upgrade_history` is the reconstruction source for either loss on that path: `source_guest_user_id` and `target_user_id` rebuild a missing `analytics.identity_links` row, and together with `source_guest_session_id`, `target_workspace_id`, and `merged_at` rebuild a missing `guest_upgrade_completed` row, whose `event_id` is derived from the guest session id ([`serverEvents.ts`](../apps/backend/src/productAnalytics/serverFacts/serverEvents.ts)).

A bound completion, the ordinary first-time conversion, writes no history row and no identity link, because the guest user id is already the account id. It does not revoke the guest session either, so a repeated completion reaches the producer again, and the derived `event_id` keeps that conversion counted once.

### Auth origin sign-in rows

The auth origin writes its own web sign-in funnel rows into `analytics.product_events` ([Login facts](auth-service.md#login-facts)); [its catalog](../apps/auth/src/server/analytics/catalog.ts) states the caveats about each field it sends. Across sources:

- `trust_level` splits these rows into two permanent populations. Older `guest_client` rows were delivered on a `web` guest session the service minted per browser; current `anonymous_client` rows go to the credential-free collector. The [trusted-actor rule](../apps/admin/src/filters/filterSql.ts) excludes `anonymous_client`, so a cohort keyed on a person's first trusted event anywhere is discontinuous at that switch.
- `anonymous_client` rows resolve through `first_anonymous_link` to whichever account the browser's shared visitor id is linked to. `guest_client` rows resolve to the guest user id whenever that sign-in's best-effort link did not land, which a first-ever or slow sign-in usually missed; both carry the shared visitor id in `anonymous_id`, so joining on it still reaches the same browser's app-origin rows.
- The pair (`screen_viewed`, `screen = 'signin'`) has a second `platform = 'web'` producer, the web app's workspace-choice step after `signin_succeeded` (`resolveRootGateReport` in `apps/web/src/App.tsx`). Auth-origin rows are the ones with a null `app_version`. `device_locale`, `timezone` and `network_state` are null on both populations.
- The OAuth consent page runs the same exchange and reports nothing, so a `screen_viewed` with no outcome can be a completed sign-in.
- Web session counts are distorted both ways around the live `logged_in` cookie: without it, a signed-out visit goes out credential-free and contributes no session; with it, `canDeliverWithoutCredential` in `apps/web/src/analytics/deliveryRuntime.ts` keeps a public-route visit queued under its stamped `session_id` until the next confirmed account.
