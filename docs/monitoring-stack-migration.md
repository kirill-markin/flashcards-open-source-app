# Monitoring stack ownership

Monitoring runs in `FlashcardsOpenSourceAppMonitoring`; application resources,
SNS topic/subscription, log groups and retention resources remain in
`FlashcardsOpenSourceApp`. Monitoring imports core references; core does not
import monitoring. The freshness metric uses the producer's core `StackName`.
The [CDK entrypoint](../infra/aws/bin/app.ts) always creates the split topology
and rejects legacy context. Build, synthesize and deploy only through CI/CD.

## Ordinary releases

The [AWS/Web Release workflow](../.github/workflows/aws-web-release.yml) serializes
releases under `main-release`. Every deployment job runs the read-only
`python3 scripts/deploy/migrate-monitoring-stack.py ownership` gate before
ordinary deployment, including web/admin-only releases. This is the helper's
only CLI command; it requires the GitHub release environment. Follow the
[release gates](release-gates.md) for deployment, smoke and deployed-SHA checks.

The [ownership helper](../scripts/deploy/migrate-monitoring-stack.py) and
[receipt verifier](../scripts/deploy/monitoring-refactor-batches.py) own the exact
contract. For the existing installation they require stable authoritative stack
IDs, verified retirement of three exact historical operations, and four linked
completed batch receipts bound to the immutable private manifest. They verify
historical requests, templates and server actions as well as current ownership.
The original 58 alarms and 8 metric filters must retain their physical identities
in monitoring, with none remaining in core. Additional alarms/filters are allowed
only in monitoring; its CDK metadata proves ordinary split deployment completed.
Legitimate later application releases are not pinned to historical Lambda versions
or live resource settings.

All three historical operations are read by exact ID and validated even if absent
from the list response. In this incident the obsolete preview remained directly
readable after `ListStackRefactors` omitted it; omission did not prove retirement.
The [retry retirement validator](../scripts/deploy/reconcile-monitoring-retry.py)
and [preview retirement validator](../scripts/deploy/reconcile-monitoring-preview.py)
validate immutable evidence and provide no repair CLI. Preserve the encrypted
private evidence and its bindings; publish only sanitized summaries.

With neither managed stack nor relevant listed operations, the helper reports
`fresh`. Existing stacks require the complete verified split. Partial ownership,
missing or mismatched evidence, unstable stacks and unknown/unresolved operations
fail explicitly. Ordinary releases cannot resume a partial migration or repair it.

## Troubleshooting

1. Keep the failed release's commit, job log and exact error. Inspect current
   stack IDs/statuses, resource ownership and the operation or evidence named by
   the failure using read-only access. An empty operation list is insufficient
   when an exact historical ID is known.
2. Compare current state with the bound private evidence and the helper contract.
   The 22 original alarm `UPDATE_FAILED` rows are historical; compare timestamps
   and live provider state before interpreting any error row as a current failure.
   Do not manufacture receipts, ignore an unknown operation or weaken ownership
   checks to deploy.
3. Stop dependent deployments when ownership or evidence is uncertain. Use the
   [AWS infrastructure change procedure](aws-infrastructure-changes.md) for a
   separately reviewed recovery. There is no automatic ownership recovery path.
   After transfer, use fix-forward split releases. Do not rerun historical workflow
   code, deploy the old topology, recreate monitoring resources or substitute
   retain/import. A reverse native move needs its own reviewed plan and CI execution.

## Verified completion evidence

The production native move completed in four batches of 8, 25, 25 and 8 resources,
preserving all 497 original physical identities. The
[first normal split release](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37061435128)
and its smokes passed. The private manifest and linked receipts are the preservation
proof; the public run supplies release evidence.

The [ordinary release at `0a530c7483b969b389e999a884e37fad326a5474`](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37073868147)
passed all nine jobs and all three smokes (web, Agent API and MCP), with platform,
web and admin deployed SHAs matching in SSM. Separate live verification
confirmed 431 core / 67 monitoring resources, all 66 original monitoring identities
preserved and the temporary refactor role absent. That later normal release
replaced one immutable Lambda version; the other 496 original physical identities,
including all 66 monitoring resources, remained unchanged. Migration preservation and later application updates are
separate comparisons. Resource counts describe this verified release, not a cap
on future monitoring additions.
