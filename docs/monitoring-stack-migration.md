# Monitoring stack ownership

Monitoring runs in `FlashcardsOpenSourceAppMonitoring`; application resources,
SNS topic/subscription, log groups and retention resources remain in
`FlashcardsOpenSourceApp`. Monitoring imports core references; core does not
import monitoring. The freshness metric uses the producer's core `StackName`.
The [CDK entrypoint](../infra/aws/bin/app.ts) always creates the split topology
and rejects legacy context. Build, synthesize and deploy only through CI/CD.

## Verified completion evidence

The production native move completed in four batches of 8, 25, 25 and 8 resources,
preserving all 497 original physical identities. The
[first normal split release](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37061435128)
and its smokes passed. The private manifest and linked receipts are the preservation
proof; the public run supplies release evidence. Their read-only validators,
`scripts/deploy/migrate-monitoring-stack.py` and its sibling
`*monitoring-refactor*` and `reconcile-monitoring-*` modules, remain at commit
`03cec0c55`.

The [ordinary release at `0a530c7483b969b389e999a884e37fad326a5474`](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37073868147)
passed all nine jobs and all three smokes (web, Agent API and MCP), with platform,
web and admin deployed SHAs matching in SSM. Separate live verification
confirmed 431 core / 67 monitoring resources, all 66 original monitoring identities
preserved and the temporary refactor role absent. That later normal release
replaced one immutable Lambda version; the other 496 original physical identities,
including all 66 monitoring resources, remained unchanged. Migration preservation and later application updates are
separate comparisons. Resource counts describe this verified release, not a cap
on future monitoring additions.
